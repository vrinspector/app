import type { CommonPowerSyncDatabase } from "@powersync/common"
import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useMemo, useRef } from "react"

import { PhotosService } from "@/client"
import { useOnline } from "@/components/Common/SyncProvider"
import useCustomToast from "@/hooks/useCustomToast"
import { putToS3, uploadErrorStatus } from "@/hooks/usePhotoUpload"
import { photoQueue, usePhotoQueue } from "@/lib/photoQueue"
import type {
  ParentState,
  PhotoUploadDeps,
  RegisterBody,
} from "@/lib/photoQueue/process"
import { useSync } from "@/lib/sync/context"
import { extractErrorMessage } from "@/utils"

/*
 * Sends the photos kept on this device (rebuild increment 20) whenever there
 * is signal: when the app opens, when the connection comes back, when a new
 * photo is queued, when the offline sync has just uploaded the findings the
 * photos hang on, every minute while photos are waiting, and on "Sync now"
 * (the sync panel fires `requestPhotoUpload()`).
 *
 * Mounted once in the signed-in shell; renders nothing.
 */

const DRAIN_EVENT = "vri:upload-photos"
const RETRY_EVERY_MS = 60_000

/** Ask the runner to send waiting photos now ("Sync now", Retry). */
export function requestPhotoUpload(): void {
  window.dispatchEvent(new Event(DRAIN_EVENT))
}

/** How a parent made offline stands in the offline sync's own bookkeeping. */
async function resolveLocal(
  db: CommonPowerSyncDatabase | null,
  table: "findings" | "inspections",
  localId: string,
): Promise<ParentState> {
  if (!db) return { state: "waiting" }
  const mapped = await db.getOptional<{ server_id: string }>(
    "SELECT server_id FROM local_id_map WHERE table_name = ? AND local_id = ?",
    [table, localId],
  )
  if (mapped?.server_id)
    return { state: "uploaded", serverId: mapped.server_id }
  const refused = await db.getOptional<{ detail: string | null }>(
    "SELECT detail FROM upload_rejections WHERE table_name = ? AND row_id = ? " +
      "AND op = 'PUT' ORDER BY created_at DESC LIMIT 1",
    [table, localId],
  )
  if (refused) {
    return { state: "refused", reason: refused.detail || "no reason given" }
  }
  return { state: "waiting" }
}

/** The queue's three steps against the real API and S3. */
export function apiPhotoDeps(
  db: CommonPowerSyncDatabase | null,
): PhotoUploadDeps {
  return {
    async presign(body) {
      const data = (await PhotosService.presignPhotoUpload({ body })).data
      if (!data) throw new Error("No upload URL was returned.")
      return data
    },
    put: (url, file, contentType) =>
      putToS3(url, file, contentType, () => undefined),
    async register(body: RegisterBody) {
      const data = (await PhotosService.registerPhoto({ body })).data as
        | { id: number }
        | undefined
      if (!data) throw new Error("The photo was not saved.")
      return data
    },
    resolveLocal: (table, localId) => resolveLocal(db, table, localId),
    describe: (error) =>
      error instanceof Error ? extractErrorMessage(error) : "Upload failed.",
    status: uploadErrorStatus,
  }
}

export function PhotoQueueRunner() {
  const { db, snapshot } = useSync()
  const queue = usePhotoQueue()
  const online = useOnline()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const deps = useMemo(() => apiPhotoDeps(db), [db])

  const run = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return
    const before = photoQueue.getSnapshot().failed
    const result = await photoQueue.drain(deps)
    if (result.uploaded.length > 0) {
      const count = result.uploaded.length
      showSuccessToast(
        `${count} photo${count === 1 ? "" : "s"} from this device uploaded`,
      )
      // Show the server's copies in place of the device's.
      void queryClient.invalidateQueries()
    }
    if (result.failed > before) {
      showErrorToast(
        "A photo was not accepted by the server. It is still on this device: open the sync panel to see why, then Retry or delete it.",
      )
    }
  }, [deps, queryClient, showSuccessToast, showErrorToast])

  // A photo left "uploading" by a tab that closed goes back in line.
  useEffect(() => {
    void photoQueue.recover()
  }, [])

  // Signal back, or a newly queued photo while online: send now.
  const count = queue.items.length
  const lastCount = useRef(0)
  useEffect(() => {
    const grew = count > lastCount.current
    lastCount.current = count
    if (online && queue.waiting > 0 && grew) void run()
  }, [count, online, queue.waiting, run])

  const wasOnline = useRef(online)
  useEffect(() => {
    if (online && !wasOnline.current && photoQueue.getSnapshot().waiting > 0) {
      void run()
    }
    wasOnline.current = online
  }, [online, run])

  // The offline sync has just uploaded everything: photos waiting for a
  // finding made offline can now go.
  const lastPending = useRef(snapshot.pending)
  useEffect(() => {
    if (lastPending.current > 0 && snapshot.pending === 0) void run()
    lastPending.current = snapshot.pending
  }, [snapshot.pending, run])

  // While photos wait with signal, try again every minute.
  useEffect(() => {
    if (!online || queue.waiting === 0) return
    const timer = window.setInterval(() => void run(), RETRY_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [online, queue.waiting, run])

  useEffect(() => {
    const handler = () => void run()
    window.addEventListener(DRAIN_EVENT, handler)
    return () => window.removeEventListener(DRAIN_EVENT, handler)
  }, [run])

  return null
}
