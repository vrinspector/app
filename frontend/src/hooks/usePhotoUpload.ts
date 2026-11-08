import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"

import { type PhotoPublic, PhotosService } from "@/client"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { inspectionKeys } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * The legacy photo capture flow (`handlePhotoCapture`), three steps per file:
 *
 *   1. POST /photos/presign {inspection_id, filename, content_type}
 *      → {upload_url, s3_key}      (key bound to the inspection)
 *   2. PUT the file straight to S3 at upload_url   (never via the API)
 *   3. POST /photos {inspection_id, s3_key, filename, content_type, uploaded_by}
 *
 * Differences from the SPA: several files can be in flight at once (the
 * library picker allows multi-select), each shows its own progress and can
 * be retried from the step that failed, and a local preview is shown while
 * the upload runs so the capture loop feels immediate on site.
 */

export type UploadStatus = "presigning" | "uploading" | "registering" | "error"

export interface PhotoUpload {
  id: string
  file: File
  /** Object URL for the local preview; revoked when the item is removed. */
  previewUrl: string
  status: UploadStatus
  /** 0–100 for the S3 PUT. */
  progress: number
  error?: string
}

let nextUploadId = 0

function newUploadId(): string {
  nextUploadId += 1
  return `upload-${nextUploadId}`
}

function describeFile(file: File) {
  const contentType = file.type || "image/jpeg"
  // Camera captures on some phones arrive as "image.jpg" or with no name at all.
  const fallbackExt = contentType === "image/png" ? ".png" : ".jpg"
  const filename =
    file.name && file.name !== "blob"
      ? file.name
      : `photo-${new Date().toISOString().replace(/[:.]/g, "-")}${fallbackExt}`
  return { contentType, filename }
}

/** PUT to the presigned URL with upload progress (fetch has none). */
export function putToS3(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", url)
    xhr.setRequestHeader("Content-Type", contentType)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Storage upload failed (${xhr.status}).`))
    }
    xhr.onerror = () =>
      reject(
        new Error(
          "Could not reach file storage. Check your connection and try again.",
        ),
      )
    xhr.onabort = () => reject(new Error("Upload cancelled."))
    xhr.send(file)
  })
}

export function usePhotoUpload(inspectionId: number) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast } = useCustomToast()
  const [uploads, setUploads] = useState<PhotoUpload[]>([])
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

  // Release preview URLs when the hook unmounts (navigating away mid-list).
  useEffect(
    () => () => {
      for (const upload of uploadsRef.current) {
        URL.revokeObjectURL(upload.previewUrl)
      }
    },
    [],
  )

  const patch = useCallback((id: string, changes: Partial<PhotoUpload>) => {
    setUploads((current) =>
      current.map((upload) =>
        upload.id === id ? { ...upload, ...changes } : upload,
      ),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setUploads((current) => {
      const target = current.find((upload) => upload.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((upload) => upload.id !== id)
    })
  }, [])

  const run = useCallback(
    async (upload: PhotoUpload) => {
      const { contentType, filename } = describeFile(upload.file)
      try {
        patch(upload.id, {
          status: "presigning",
          progress: 0,
          error: undefined,
        })
        const presign = (
          await PhotosService.presignPhotoUpload({
            body: {
              inspection_id: inspectionId,
              filename,
              content_type: contentType,
            },
          })
        ).data
        if (!presign) throw new Error("No upload URL was returned.")

        patch(upload.id, { status: "uploading" })
        await putToS3(presign.upload_url, upload.file, contentType, (percent) =>
          patch(upload.id, { progress: percent }),
        )

        patch(upload.id, { status: "registering", progress: 100 })
        const photo = (
          await PhotosService.registerPhoto({
            body: {
              inspection_id: inspectionId,
              s3_key: presign.s3_key,
              filename,
              content_type: contentType,
              uploaded_by: user?.name ?? user?.email ?? null,
            },
          })
        ).data as PhotoPublic

        // Put the new photo at the front of the cached list so the thumbnail
        // appears at once; the invalidation then confirms it from the API.
        queryClient.setQueryData<PhotoPublic[]>(
          inspectionKeys.photos(inspectionId),
          (current) => (current ? [photo, ...current] : current),
        )
        queryClient.invalidateQueries({
          queryKey: inspectionKeys.photos(inspectionId),
        })
        remove(upload.id)
        showSuccessToast("Photo uploaded")
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
    [inspectionId, patch, remove, queryClient, showSuccessToast, user],
  )

  const addFiles = useCallback(
    (files: ArrayLike<File> | null | undefined) => {
      if (!files || files.length === 0) return
      const items: PhotoUpload[] = Array.from(files)
        .filter((file) => !file.type || file.type.startsWith("image/"))
        .map((file) => ({
          id: newUploadId(),
          file,
          previewUrl: URL.createObjectURL(file),
          status: "presigning",
          progress: 0,
        }))
      if (!items.length) return
      setUploads((current) => [...items, ...current])
      for (const item of items) void run(item)
    },
    [run],
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
