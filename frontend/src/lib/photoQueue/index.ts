/**
 * The offline photo queue (rebuild increment 20) — one per browser profile.
 *
 * In a browser the photos are kept in IndexedDB; where there is none (unit
 * tests, very old browsers) they are kept in memory for the session.
 */
import { useEffect, useState, useSyncExternalStore } from "react"

import { PhotoQueue, type PhotoQueueSnapshot } from "./queue"
import { indexedDbPhotoStore, memoryPhotoStore } from "./store"
import type { PhotoTarget, QueuedPhotoMeta } from "./types"

export * from "./queue"
export * from "./storage"
export * from "./types"

export const photoQueue = new PhotoQueue(
  typeof indexedDB !== "undefined" ? indexedDbPhotoStore() : memoryPhotoStore(),
)

export function usePhotoQueue(): PhotoQueueSnapshot {
  return useSyncExternalStore(
    photoQueue.subscribe,
    photoQueue.getSnapshot,
    photoQueue.getSnapshot,
  )
}

/** Queued photos for one parent, oldest first. */
export function useQueuedPhotos(
  match: (target: PhotoTarget) => boolean,
): QueuedPhotoMeta[] {
  const { items } = usePhotoQueue()
  return items.filter((item) => match(item.target))
}

/** An object URL for a queued photo's preview (revoked when no longer shown). */
export function useQueuedPreview(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    photoQueue
      .file(id)
      .then((file) => {
        if (cancelled || !file || typeof URL.createObjectURL !== "function") {
          return
        }
        created = URL.createObjectURL(file)
        setUrl(created)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [id])
  return url
}

/** Does this queued photo belong to the inspection's own site photos? */
export function isInspectionPhoto(inspectionId: number) {
  return (target: PhotoTarget) =>
    target.kind === "inspection" && target.inspectionId === String(inspectionId)
}

/**
 * Does this queued photo belong to the finding? A finding made offline is
 * known on screen by a negative number; its `public_id` carries the
 * `local-…` id the photo was queued under.
 */
export function isFindingPhoto(finding: { id: number; public_id?: string }) {
  const keys = new Set([String(finding.id)])
  if (finding.public_id) keys.add(finding.public_id)
  return (target: PhotoTarget) =>
    target.kind === "finding" && keys.has(target.findingId)
}

export function isItpItemPhoto(itemId: number) {
  return (target: PhotoTarget) =>
    target.kind === "itp_item" && target.itemId === String(itemId)
}
