import { useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef, useState } from "react"

import { type PhotoPublic, PhotosService } from "@/client"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { describeFile, type PhotoUpload, putToS3 } from "@/hooks/usePhotoUpload"
import { itpKeys } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * Evidence photos for one ITP line (increment 13.6): the same three steps as
 * site photos, filed under the line instead of an inspection —
 *
 *   1. POST /photos/presign {itp_item_id, filename, content_type}
 *   2. PUT the file straight to S3 (never via the API)
 *   3. POST /photos {itp_item_id, s3_key, filename, content_type}
 *
 * `onUploaded` runs after each registered photo so the ITP screen can
 * refresh the line's "photo on file" state.
 */

let nextId = 0

export function useItpPhotoUpload(itemId: number, onUploaded: () => void) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast } = useCustomToast()
  const [uploads, setUploads] = useState<PhotoUpload[]>([])
  const uploadsRef = useRef(uploads)
  uploadsRef.current = uploads

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
      current.map((u) => (u.id === id ? { ...u, ...changes } : u)),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setUploads((current) => {
      const target = current.find((u) => u.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((u) => u.id !== id)
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
              itp_item_id: itemId,
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
              itp_item_id: itemId,
              s3_key: presign.s3_key,
              filename,
              content_type: contentType,
              uploaded_by: user?.name ?? user?.email ?? null,
            },
          })
        ).data as PhotoPublic
        queryClient.setQueryData<PhotoPublic[]>(
          itpKeys.photos(itemId),
          (current) => (current ? [photo, ...current] : current),
        )
        queryClient.invalidateQueries({ queryKey: itpKeys.photos(itemId) })
        remove(upload.id)
        showSuccessToast("Photo added to the line")
        onUploaded()
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
    [itemId, patch, remove, queryClient, showSuccessToast, user, onUploaded],
  )

  const addFiles = useCallback(
    (files: ArrayLike<File> | null | undefined) => {
      if (!files || files.length === 0) return
      const items: PhotoUpload[] = Array.from(files)
        .filter((file) => !file.type || file.type.startsWith("image/"))
        .map((file) => {
          nextId += 1
          return {
            id: `itp-upload-${nextId}`,
            file,
            previewUrl: URL.createObjectURL(file),
            status: "presigning",
            progress: 0,
          }
        })
      if (!items.length) return
      setUploads((current) => [...items, ...current])
      for (const item of items) void run(item)
    },
    [run],
  )

  const retry = useCallback(
    (id: string) => {
      const target = uploadsRef.current.find((u) => u.id === id)
      if (target) void run(target)
    },
    [run],
  )

  return { uploads, addFiles, retry, dismiss: remove }
}
