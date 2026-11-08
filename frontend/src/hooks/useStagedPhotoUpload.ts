import { useCallback, useEffect, useRef, useState } from "react"

import { type PhotoPublic, PhotosService } from "@/client"
import useAuth from "@/hooks/useAuth"
import { describeFile, putToS3 } from "@/hooks/usePhotoUpload"
import { extractErrorMessage } from "@/utils"

/*
 * Photo upload for the capture loop (increment 11a), where the photo is
 * taken *before* the finding it documents exists:
 *
 *   on pick   → POST /photos/presign + PUT to S3 straight away, so the
 *               upload runs while the inspector dictates the note
 *   on save   → register(findingId): POST /photos {…, finding_id} for every
 *               staged photo, once the finding has an id
 *
 * The same three legacy steps as `usePhotoUpload`, split around the moment
 * the finding is created. Nothing is registered against the inspection
 * until the form is saved, so cancelling the dialog leaves no orphan rows
 * (the S3 object of an abandoned upload is harmless and keyed under the
 * inspection like any other).
 */

export type StagedStatus = "presigning" | "uploading" | "ready" | "error"

export interface StagedPhoto {
  id: string
  file: File
  /** Object URL for the local preview; revoked when the item is removed. */
  previewUrl: string
  status: StagedStatus
  /** 0–100 for the S3 PUT. */
  progress: number
  /** Set once the S3 PUT has succeeded; what `register` sends. */
  s3Key?: string
  filename: string
  contentType: string
  error?: string
}

let nextStagedId = 0

function newStagedId(): string {
  nextStagedId += 1
  return `staged-${nextStagedId}`
}

export function useStagedPhotoUpload(inspectionId: number | null) {
  const { user } = useAuth()
  const [photos, setPhotos] = useState<StagedPhoto[]>([])
  const photosRef = useRef(photos)
  photosRef.current = photos

  useEffect(
    () => () => {
      for (const photo of photosRef.current) {
        URL.revokeObjectURL(photo.previewUrl)
      }
    },
    [],
  )

  const patch = useCallback((id: string, changes: Partial<StagedPhoto>) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, ...changes } : photo,
      ),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((photo) => photo.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setPhotos((current) => {
      for (const photo of current) URL.revokeObjectURL(photo.previewUrl)
      return []
    })
  }, [])

  const stage = useCallback(
    async (photo: StagedPhoto) => {
      if (inspectionId === null) {
        patch(photo.id, {
          status: "error",
          error: "Choose an inspection before adding photos.",
        })
        return
      }
      try {
        patch(photo.id, { status: "presigning", progress: 0, error: undefined })
        const presign = (
          await PhotosService.presignPhotoUpload({
            body: {
              inspection_id: inspectionId,
              filename: photo.filename,
              content_type: photo.contentType,
            },
          })
        ).data
        if (!presign) throw new Error("No upload URL was returned.")

        patch(photo.id, { status: "uploading" })
        await putToS3(
          presign.upload_url,
          photo.file,
          photo.contentType,
          (percent) => patch(photo.id, { progress: percent }),
        )
        patch(photo.id, {
          status: "ready",
          progress: 100,
          s3Key: presign.s3_key,
        })
      } catch (error) {
        patch(photo.id, {
          status: "error",
          error:
            error instanceof Error
              ? extractErrorMessage(error)
              : "Upload failed.",
        })
      }
    },
    [inspectionId, patch],
  )

  const addFiles = useCallback(
    (files: ArrayLike<File> | null | undefined) => {
      if (!files || files.length === 0) return
      const items: StagedPhoto[] = Array.from(files)
        .filter((file) => !file.type || file.type.startsWith("image/"))
        .map((file) => {
          const { contentType, filename } = describeFile(file)
          return {
            id: newStagedId(),
            file,
            previewUrl: URL.createObjectURL(file),
            status: "presigning" as const,
            progress: 0,
            filename,
            contentType,
          }
        })
      if (!items.length) return
      setPhotos((current) => [...current, ...items])
      for (const item of items) void stage(item)
    },
    [stage],
  )

  const retry = useCallback(
    (id: string) => {
      const target = photosRef.current.find((photo) => photo.id === id)
      if (target) void stage(target)
    },
    [stage],
  )

  /**
   * Register every uploaded photo against the finding. Photos still in
   * flight are awaited first (the caller shows "Uploading photo…"); a photo
   * whose upload failed is skipped and reported back so the form can say so.
   */
  const register = useCallback(
    async (
      findingId: number,
    ): Promise<{ saved: PhotoPublic[]; failed: number }> => {
      if (inspectionId === null) return { saved: [], failed: 0 }
      // Wait for in-flight uploads (poll the ref: the PUTs patch state as they go).
      const settled = () =>
        photosRef.current.every(
          (photo) => photo.status === "ready" || photo.status === "error",
        )
      while (!settled()) {
        await new Promise((resolve) => window.setTimeout(resolve, 150))
      }
      const saved: PhotoPublic[] = []
      let failed = 0
      for (const photo of photosRef.current) {
        if (photo.status !== "ready" || !photo.s3Key) {
          failed += 1
          continue
        }
        try {
          const created = (
            await PhotosService.registerPhoto({
              body: {
                inspection_id: inspectionId,
                finding_id: findingId,
                s3_key: photo.s3Key,
                filename: photo.filename,
                content_type: photo.contentType,
                uploaded_by: user?.name ?? user?.email ?? null,
              },
            })
          ).data as PhotoPublic
          saved.push(created)
        } catch (error) {
          failed += 1
          patch(photo.id, {
            status: "error",
            error:
              error instanceof Error
                ? extractErrorMessage(error)
                : "Could not save the photo.",
          })
        }
      }
      return { saved, failed }
    },
    [inspectionId, patch, user],
  )

  const uploading = photos.some(
    (photo) => photo.status === "presigning" || photo.status === "uploading",
  )
  const ready = photos.filter((photo) => photo.status === "ready").length

  return { photos, addFiles, retry, remove, clear, register, uploading, ready }
}
