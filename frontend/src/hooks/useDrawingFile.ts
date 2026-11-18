import { queryOptions, useQuery } from "@tanstack/react-query"
import { useEffect } from "react"

import { type DrawingPublic, DrawingsService } from "@/client"
import {
  getKeptDrawing,
  KEPT_DRAWING_MAX_BYTES,
  keepDrawing,
} from "@/lib/offlineDrawings"
import { drawingKeys } from "@/lib/queries"
import {
  getOfflineReader,
  OfflineError,
  withOfflineMessage,
} from "@/lib/sync/offlineRead"

export interface DrawingFile {
  /** What the viewer loads: a presigned URL or a local blob: URL. */
  url: string
  /** "device" = the copy kept on this device; "server" = fetched now. */
  source: "device" | "server"
  /** A blob: URL this hook created (revoked when the viewer closes). */
  objectUrl: boolean
}

export const DRAWING_NEEDS_SIGNAL =
  "No signal. This drawing has not been opened on this device yet, so it needs a connection. Open it once with signal and it is kept for next time (when there is room on the device)."

/** May the file be downloaded here to keep a copy? */
export function shouldKeepCopy(
  drawing: Pick<DrawingPublic, "file_size">,
  offlineSyncOn: boolean,
): boolean {
  const size = drawing.file_size ?? 0
  return offlineSyncOn && size > 0 && size <= KEPT_DRAWING_MAX_BYTES
}

async function presignedUrl(drawingId: number): Promise<string> {
  return (
    (
      await DrawingsService.readDrawingViewUrl({
        path: { drawing_id: drawingId },
      })
    ).data as { view_url: string }
  ).view_url
}

/**
 * The drawing file for the viewer (rebuild increment 21).
 *
 * 1. A copy kept on this device opens straight away, with or without signal
 *    (no download).
 * 2. Otherwise the API mints the presigned GET, as before (legacy
 *    `openDrawingViewer`). When offline sync is on, the file is downloaded
 *    once, shown from memory and kept on the device if the storage check
 *    allows (lib/offlineDrawings.ts). If that download cannot be made (for
 *    example the bucket refuses the browser), the viewer simply loads the
 *    presigned URL as before.
 * 3. With no signal and no kept copy, a plain "needs signal" message.
 */
export const drawingFileQuery = (
  drawing: Pick<DrawingPublic, "id" | "s3_key" | "file_size">,
) =>
  queryOptions<DrawingFile>({
    queryKey: [...drawingKeys.viewUrl(drawing.id), "file", drawing.s3_key],
    queryFn: async () => {
      const kept = await getKeptDrawing(drawing)
      if (kept) {
        return {
          url: URL.createObjectURL(kept),
          source: "device",
          objectUrl: true,
        }
      }
      const url = await withOfflineMessage(
        () => presignedUrl(drawing.id),
        DRAWING_NEEDS_SIGNAL,
      )
      if (shouldKeepCopy(drawing, getOfflineReader() !== null)) {
        try {
          const response = await fetch(url)
          if (response.ok) {
            const blob = await response.blob()
            void keepDrawing(drawing, blob)
            return {
              url: URL.createObjectURL(blob),
              source: "server",
              objectUrl: true,
            }
          }
        } catch {
          // Fall through to the presigned URL.
        }
      }
      return { url, source: "server", objectUrl: false }
    },
    // Presigned links expire: never reused after the visit.
    staleTime: 0,
    gcTime: 0,
    networkMode: "always",
    retry: (count, error) => !(error instanceof OfflineError) && count < 1,
  })

export function useDrawingFile(
  drawing: Pick<DrawingPublic, "id" | "s3_key" | "file_size">,
) {
  const query = useQuery(drawingFileQuery(drawing))
  const data = query.data

  // Release the in-memory copy when the viewer closes or reloads.
  useEffect(() => {
    if (!data?.objectUrl) return
    return () => URL.revokeObjectURL(data.url)
  }, [data])

  return query
}
