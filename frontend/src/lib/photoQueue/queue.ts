/**
 * The device's photo queue (rebuild increment 20).
 *
 * One queue per browser profile. Screens add photos with `enqueue`, read the
 * list through `subscribe` / `getSnapshot` (usePhotoQueue), and the runner
 * (components/Common/PhotoQueueRunner.tsx) calls `drain` when there is
 * signal: at start-up, when the connection comes back, after the offline
 * sync has uploaded what the photos hang on, every minute while photos are
 * waiting, and on "Sync now".
 *
 * Photos go up one at a time, oldest first, so a slow connection gives each
 * one the whole pipe and the order on the server follows the order taken.
 */
import { type PhotoUploadDeps, uploadQueuedPhoto } from "./process"
import {
  assessStorage,
  estimateStorage,
  requestPersistentStorage,
} from "./storage"
import type { PhotoStore } from "./store"
import type { PhotoHistoryEntry, PhotoTarget, QueuedPhotoMeta } from "./types"

export interface PhotoQueueSnapshot {
  /** Has the list been read from the device yet. */
  loaded: boolean
  items: readonly QueuedPhotoMeta[]
  /** Waiting or uploading. */
  waiting: number
  /** Refused, kept with a reason and a Retry. */
  failed: number
}

export const EMPTY_PHOTO_QUEUE: PhotoQueueSnapshot = {
  loaded: false,
  items: [],
  waiting: 0,
  failed: 0,
}

/** The photo could not be kept on the device (shown to the person as is). */
export class PhotoQueueError extends Error {}

export interface EnqueueInput {
  file: File
  target: PhotoTarget
  description: string
  uploadedBy: string | null
  filename: string
  contentType: string
  capturedAt: string | null
}

export interface DrainResult {
  uploaded: Array<{ queuedId: string; photoId: number; target: PhotoTarget }>
  failed: number
  waiting: number
}

type Estimate = () => Promise<{ quota?: number; usage?: number } | null>

let idCounter = 0
function newQueueId(): string {
  idCounter += 1
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${idCounter}`
  return `queued-photo-${random}`
}

export class PhotoQueue {
  private snapshot: PhotoQueueSnapshot = EMPTY_PHOTO_QUEUE
  private readonly listeners = new Set<() => void>()
  private draining: Promise<DrainResult> | null = null
  private drainAgain = false

  constructor(
    private store: PhotoStore,
    private readonly estimate: Estimate = estimateStorage,
    private readonly persist: () => Promise<boolean> = requestPersistentStorage,
  ) {}

  /** Swap the store (tests). */
  useStore(store: PhotoStore): void {
    this.store = store
    this.snapshot = EMPTY_PHOTO_QUEUE
    void this.refresh()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.snapshot.loaded) void this.refresh()
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): PhotoQueueSnapshot => this.snapshot

  async refresh(): Promise<PhotoQueueSnapshot> {
    let items: QueuedPhotoMeta[] = []
    try {
      items = await this.store.list()
    } catch (error) {
      console.warn("Could not read the photo queue", error)
    }
    this.snapshot = {
      loaded: true,
      items,
      waiting: items.filter((item) => item.status !== "failed").length,
      failed: items.filter((item) => item.status === "failed").length,
    }
    for (const listener of this.listeners) listener()
    return this.snapshot
  }

  /** Keep a photo on the device; throws PhotoQueueError when it cannot. */
  async enqueue(input: EnqueueInput, now = new Date()): Promise<string> {
    const room = assessStorage(await this.estimate(), input.file.size)
    if (room.level === "full") throw new PhotoQueueError(room.message)
    const id = newQueueId()
    try {
      await this.store.put({
        id,
        file: input.file,
        target: input.target,
        filename: input.filename,
        contentType: input.contentType,
        capturedAt: input.capturedAt,
        size: input.file.size,
        uploadedBy: input.uploadedBy,
        description: input.description,
        queuedAt: now.toISOString(),
        status: "waiting",
        error: null,
        attempts: 0,
        lastAttemptAt: null,
      })
    } catch (error) {
      const quota =
        error instanceof DOMException && error.name === "QuotaExceededError"
      throw new PhotoQueueError(
        quota
          ? "This device is full, so the photo cannot be kept on it. Upload the photos that are waiting or free up space, then try again."
          : "The photo could not be kept on this device. Try again, or take it again when you have signal.",
      )
    }
    void this.persist()
    await this.refresh()
    return id
  }

  /**
   * Send every waiting photo, oldest first. One drain at a time: a call
   * while one runs waits for it and then runs once more.
   */
  async drain(deps: PhotoUploadDeps): Promise<DrainResult> {
    if (this.draining) {
      this.drainAgain = true
      return this.draining
    }
    this.draining = (async () => {
      const total: DrainResult = { uploaded: [], failed: 0, waiting: 0 }
      try {
        do {
          this.drainAgain = false
          const result = await this.drainOnce(deps)
          total.uploaded.push(...result.uploaded)
          total.failed = result.failed
          total.waiting = result.waiting
        } while (this.drainAgain)
      } finally {
        this.draining = null
      }
      return total
    })()
    return this.draining
  }

  private async drainOnce(deps: PhotoUploadDeps): Promise<DrainResult> {
    const result: DrainResult = { uploaded: [], failed: 0, waiting: 0 }
    const items = (await this.store.list()).filter(
      (item) => item.status !== "failed",
    )
    let stopForSignal = false
    for (const item of items) {
      if (stopForSignal) {
        result.waiting += 1
        continue
      }
      const photo = await this.store.get(item.id)
      if (!photo) continue
      const attemptAt = new Date().toISOString()
      await this.store.patch(item.id, { status: "uploading" })
      await this.refresh()
      const outcome = await uploadQueuedPhoto(photo, deps)
      if (outcome.kind === "uploaded") {
        await this.store.remove(item.id)
        await this.log(photo, "applied", "Uploaded.")
        result.uploaded.push({
          queuedId: item.id,
          photoId: outcome.photoId,
          target: photo.target,
        })
      } else if (outcome.kind === "failed") {
        await this.store.patch(item.id, {
          status: "failed",
          error: outcome.reason,
          attempts: photo.attempts + 1,
          lastAttemptAt: attemptAt,
        })
        await this.log(
          photo,
          "refused",
          `Not accepted by the server: ${outcome.reason} The photo is still on this device; Retry or delete it in the sync panel.`,
        )
        result.failed += 1
      } else {
        await this.store.patch(item.id, {
          status: "waiting",
          error: outcome.reason,
          attempts: photo.attempts + 1,
          lastAttemptAt: attemptAt,
        })
        result.waiting += 1
        // A photo waiting for its parent does not stop the others; a lost
        // connection does (the rest would only fail the same way).
        stopForSignal = !outcome.forParent
      }
      await this.refresh()
    }
    const all = await this.store.list()
    result.failed = all.filter((item) => item.status === "failed").length
    return result
  }

  private async log(
    photo: QueuedPhotoMeta,
    outcome: PhotoHistoryEntry["outcome"],
    detail: string,
  ): Promise<void> {
    try {
      await this.store.addHistory({
        id: newQueueId().replace("queued-photo", "photo-history"),
        photoId: photo.id,
        outcome,
        description: photo.description,
        madeAt: photo.queuedAt,
        at: new Date().toISOString(),
        detail,
      })
    } catch (error) {
      console.warn("Could not write the photo history", error)
    }
  }

  /** Put a refused photo back in line (the person pressed Retry). */
  async retry(id: string): Promise<void> {
    await this.store.patch(id, { status: "waiting", error: null })
    await this.refresh()
  }

  /** Delete one photo from the device (only on the person's say-so). */
  async remove(id: string): Promise<void> {
    await this.store.remove(id)
    await this.refresh()
  }

  /** The original file of a queued photo (for its preview). */
  async file(id: string): Promise<File | undefined> {
    return (await this.store.get(id))?.file
  }

  history(): Promise<PhotoHistoryEntry[]> {
    return this.store.history()
  }

  async clearHistory(): Promise<void> {
    await this.store.clearHistory()
  }

  /** Sign-out: remove every photo and the history from the device. */
  async clear(): Promise<void> {
    await this.store.clear()
    await this.refresh()
  }

  /** On start-up: a photo left "uploading" by a closed tab goes back in line. */
  async recover(): Promise<void> {
    for (const item of await this.store.list()) {
      if (item.status === "uploading") {
        await this.store.patch(item.id, { status: "waiting" })
      }
    }
    await this.refresh()
  }
}

/** Queued photos for one parent, oldest first. */
export function queuedFor(
  items: readonly QueuedPhotoMeta[],
  match: (target: PhotoTarget) => boolean,
): QueuedPhotoMeta[] {
  return items.filter((item) => match(item.target))
}
