import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef, useState } from "react"

import { type DrawingPublic, DrawingsService } from "@/client"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { putToS3 } from "@/hooks/usePhotoUpload"
import {
  contentTypeForExtension,
  fileExtension,
  MAX_DRAWING_BYTES,
} from "@/lib/drawings"
import { projectKeys } from "@/lib/queries"
import { DRAWING_FILE_TYPES, type DrawingFileType } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * The legacy drawing upload (`handleDrawingUpload`), three steps per file
 * and never through the API (Hard Rule 8):
 *
 *   1. POST /drawings/presign {project_id, filename, content_type}
 *      → {upload_url, s3_key}; the SPA refused a key outside
 *      `drawings/projects/{project_id}/` and so does this hook
 *   2. PUT the file straight to S3 at upload_url
 *   3. POST /drawings {project_id, s3_key, filename, title, discipline,
 *      file_type, file_size, uploaded_by}
 *
 * As with photos (increment 08) each file is its own item with progress,
 * several may run at once, and a failure keeps the item with its reason and
 * a Retry. The legacy input took one file at a time; a P&ID set is often a
 * folder of sheets, so the picker allows several.
 */

export type DrawingUploadStatus =
  | "presigning"
  | "uploading"
  | "registering"
  | "error"

export interface DrawingUpload {
  id: string
  file: File
  status: DrawingUploadStatus
  progress: number
  error?: string
}

let nextUploadId = 0

function newUploadId(): string {
  nextUploadId += 1
  return `drawing-upload-${nextUploadId}`
}

/** Why a file cannot be uploaded, or `undefined` when it can. */
export function rejectDrawingFile(file: File): string | undefined {
  const ext = fileExtension(file.name)
  if (!(DRAWING_FILE_TYPES as string[]).includes(ext)) {
    return "Only PDF, PNG, JPG and SVG drawings can be uploaded."
  }
  if (file.size > MAX_DRAWING_BYTES) {
    return "Drawings must be 50 MB or smaller."
  }
  return undefined
}

export function useDrawingUpload(projectId: number) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [uploads, setUploads] = useState<DrawingUpload[]>([])
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  const patch = useCallback((id: string, changes: Partial<DrawingUpload>) => {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === id ? { ...upload, ...changes } : upload,
      ),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== id))
  }, [])

  const run = useCallback(
    async (upload: DrawingUpload) => {
      const { file } = upload
      const ext = fileExtension(file.name) as DrawingFileType
      const contentType = file.type || contentTypeForExtension(ext)
      try {
        patch(upload.id, {
          status: "presigning",
          progress: 0,
          error: undefined,
        })
        const presign = (
          await DrawingsService.presignDrawingUpload({
            body: {
              project_id: projectId,
              filename: file.name,
              content_type: contentType,
            },
          })
        ).data
        if (!presign) throw new Error("No upload URL was returned.")
        const expectedPrefix = `drawings/projects/${projectId}/`
        if (!presign.s3_key.startsWith(expectedPrefix)) {
          throw new Error("Upload key is not scoped to the active project.")
        }

        patch(upload.id, { status: "uploading" })
        await putToS3(presign.upload_url, file, contentType, (percent) =>
          patch(upload.id, { progress: percent }),
        )

        patch(upload.id, { status: "registering", progress: 100 })
        const drawing = (
          await DrawingsService.createDrawing({
            body: {
              project_id: projectId,
              s3_key: presign.s3_key,
              filename: file.name,
              title: file.name.replace(/\.[^.]+$/, ""),
              discipline: "general",
              file_type: ext,
              file_size: file.size || null,
              uploaded_by: user?.name ?? user?.email ?? null,
            },
          })
        ).data as DrawingPublic

        queryClient.setQueryData<DrawingPublic[]>(
          projectKeys.drawings(projectId),
          (current) => (current ? [drawing, ...current] : current),
        )
        queryClient.invalidateQueries({
          queryKey: projectKeys.drawings(projectId),
        })
        remove(upload.id)
        showSuccessToast("Drawing uploaded")
      } catch (error) {
        patch(upload.id, {
          status: "error",
          error:
            error instanceof Error
              ? extractErrorMessage(error)
              : "Upload failed.",
        })
      }
    },
    [projectId, patch, remove, queryClient, showSuccessToast, user],
  )

  const addFiles = useCallback(
    (files: ArrayLike<File> | null | undefined) => {
      if (!files || files.length === 0) return
      const items: DrawingUpload[] = []
      for (const file of Array.from(files)) {
        const reason = rejectDrawingFile(file)
        if (reason) {
          showErrorToast(`${file.name}: ${reason}`)
          continue
        }
        items.push({
          id: newUploadId(),
          file,
          status: "presigning",
          progress: 0,
        })
      }
      if (!items.length) return
      setUploads((current) => [...items, ...current])
      for (const item of items) void run(item)
    },
    [run, showErrorToast],
  )

  const retry = useCallback(
    (id: string) => {
      const target = uploadsRef.current.find((upload) => upload.id === id)
      if (target) void run(target)
    },
    [run],
  )

  return { uploads, addFiles, retry, dismiss: remove }
}
