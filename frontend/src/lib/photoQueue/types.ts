/**
 * Offline photo queue — shared types (rebuild increment 20, PRD v2.63
 * Block 11; owner decision 2026-11-16, issue #39).
 *
 * A photo taken with no signal is kept on the device — the original bytes,
 * file name, type and capture time, untouched — until it can go through the
 * same three steps as an online photo:
 *
 *   1. POST /photos/presign   (key bound to the parent, as online)
 *   2. PUT straight to S3 at the presigned URL (never via the API)
 *   3. POST /photos           (register, linked to its parent)
 *
 * S3 stays the only file store on the server; the device copy is deleted the
 * moment the server has registered the photo.
 */
import type { ShotSlot } from "@/lib/itp"

/** What the photo belongs to. Ids are strings: a parent made offline has a `local-…` id. */
export type PhotoTarget =
  | { kind: "inspection"; inspectionId: string }
  | { kind: "finding"; inspectionId: string; findingId: string }
  | { kind: "itp_item"; itemId: string; slot?: ShotSlot | null }

/**
 * waiting   — kept on the device, will upload when there is signal
 * uploading — going up right now
 * failed    — the server refused it (or its parent); kept, with the reason and a Retry
 */
export type QueuedPhotoStatus = "waiting" | "uploading" | "failed"

/** One photo kept on the device, without its bytes (what the screens read). */
export interface QueuedPhotoMeta {
  id: string
  target: PhotoTarget
  filename: string
  contentType: string
  /** The file's own date (camera shutter / library file), ISO. */
  capturedAt: string | null
  size: number
  /** Who took it (sent as `uploaded_by`). */
  uploadedBy: string | null
  /** One line for the sync panel and history, e.g. "Site photo for “Level 3 pour”". */
  description: string
  queuedAt: string
  status: QueuedPhotoStatus
  /** Plain-words reason the last attempt did not go through. */
  error: string | null
  attempts: number
  lastAttemptAt: string | null
}

/** A queued photo with its original bytes. */
export interface QueuedPhoto extends QueuedPhotoMeta {
  file: File
}

/** One line of the photo history (shown in the sync panel's history). */
export interface PhotoHistoryEntry {
  id: string
  photoId: string
  outcome: "applied" | "refused"
  description: string
  madeAt: string
  at: string
  detail: string
}
