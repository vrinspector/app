/**
 * Sending one queued photo (rebuild increment 20).
 *
 * The same three steps as an online photo — presign → direct S3 PUT →
 * register — against the existing `/api/v1/` endpoints, so the API decides
 * exactly as it does online (membership, roles, sign-off and hold-point
 * locks). A parent that was itself made offline (a finding with a `local-…`
 * id) is looked up in the offline sync's id map first; until its own upload
 * has gone through, the photo waits.
 *
 * Outcomes:
 *  - uploaded — registered on the server; the device copy can go.
 *  - wait     — no signal, the server was busy, the sign-in needs refreshing,
 *               or the parent has not uploaded yet: keep it and try later.
 *  - failed   — the server (or the parent's upload) refused it: keep it on
 *               the device with the reason, for a person to Retry or delete.
 *               Never dropped silently.
 */
import type { ShotSlot } from "@/lib/itp"

import type { PhotoTarget, QueuedPhoto } from "./types"

export interface PresignBody {
  inspection_id?: number
  itp_item_id?: number
  filename: string
  content_type: string
}

export interface RegisterBody {
  inspection_id?: number
  finding_id?: number
  itp_item_id?: number
  s3_key: string
  filename: string
  content_type: string
  uploaded_by: string | null
  captured_at: string | null
  shot_slot?: ShotSlot | null
}

/** How a `local-…` parent stands in the offline sync. */
export type ParentState =
  | { state: "uploaded"; serverId: string }
  | { state: "waiting" }
  | { state: "refused"; reason: string }

export interface PhotoUploadDeps {
  presign(body: PresignBody): Promise<{ upload_url: string; s3_key: string }>
  put(url: string, file: File, contentType: string): Promise<void>
  register(body: RegisterBody): Promise<{ id: number }>
  /** Look up a parent created offline (no offline sync → always waiting). */
  resolveLocal(
    table: "findings" | "inspections",
    localId: string,
  ): Promise<ParentState>
  /** Plain-words reason from an error (the API's `detail` when there is one). */
  describe(error: unknown): string
  /** HTTP status of an error, undefined when the request could not be made. */
  status(error: unknown): number | undefined
}

export type PhotoOutcome =
  | { kind: "uploaded"; photoId: number }
  | {
      kind: "wait"
      reason: string
      /** Waiting for a parent made offline, not for signal. */
      forParent?: boolean
    }
  | { kind: "failed"; reason: string; status: number }

const LOCAL_PREFIX = "local-"

/** Statuses worth trying again later rather than asking a person. */
export function isTransient(status: number | undefined): boolean {
  return (
    status === undefined ||
    status === 0 ||
    status === 401 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  )
}

class Wait extends Error {}
class Refuse extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const PARENT_NOUN: Record<"findings" | "inspections", string> = {
  findings: "finding",
  inspections: "inspection",
}

async function resolveId(
  deps: PhotoUploadDeps,
  table: "findings" | "inspections",
  id: string,
): Promise<number> {
  if (!id.startsWith(LOCAL_PREFIX)) {
    const value = Number(id)
    if (!Number.isInteger(value) || value <= 0) {
      throw new Refuse(`The ${PARENT_NOUN[table]} id “${id}” is not valid.`, 0)
    }
    return value
  }
  const parent = await deps.resolveLocal(table, id)
  if (parent.state === "uploaded") return Number(parent.serverId)
  if (parent.state === "refused") {
    throw new Refuse(
      `The ${PARENT_NOUN[table]} it belongs to was not accepted by the server (${parent.reason}), so the photo has nowhere to go.`,
      0,
    )
  }
  throw new Wait(
    `Waiting for the ${PARENT_NOUN[table]} it belongs to, which was also saved without signal, to upload first.`,
  )
}

interface ResolvedTarget {
  presign: Pick<PresignBody, "inspection_id" | "itp_item_id">
  register: Pick<
    RegisterBody,
    "inspection_id" | "finding_id" | "itp_item_id" | "shot_slot"
  >
}

async function resolveTarget(
  deps: PhotoUploadDeps,
  target: PhotoTarget,
): Promise<ResolvedTarget> {
  if (target.kind === "itp_item") {
    const itemId = Number(target.itemId)
    if (!Number.isInteger(itemId) || itemId <= 0) {
      throw new Refuse("The ITP line id is not valid.", 0)
    }
    return {
      presign: { itp_item_id: itemId },
      register: { itp_item_id: itemId, shot_slot: target.slot ?? null },
    }
  }
  const inspectionId = await resolveId(deps, "inspections", target.inspectionId)
  if (target.kind === "inspection") {
    return {
      presign: { inspection_id: inspectionId },
      register: { inspection_id: inspectionId },
    }
  }
  const findingId = await resolveId(deps, "findings", target.findingId)
  return {
    presign: { inspection_id: inspectionId },
    register: { inspection_id: inspectionId, finding_id: findingId },
  }
}

function classify(deps: PhotoUploadDeps, error: unknown): PhotoOutcome {
  if (error instanceof Wait) {
    return { kind: "wait", reason: error.message, forParent: true }
  }
  if (error instanceof Refuse) {
    return { kind: "failed", reason: error.message, status: error.status }
  }
  const status = deps.status(error)
  const reason = deps.describe(error)
  if (isTransient(status)) return { kind: "wait", reason }
  return { kind: "failed", reason, status: status ?? 0 }
}

/** Send one queued photo; never throws. */
export async function uploadQueuedPhoto(
  photo: QueuedPhoto,
  deps: PhotoUploadDeps,
): Promise<PhotoOutcome> {
  try {
    const target = await resolveTarget(deps, photo.target)
    const body = {
      filename: photo.filename,
      content_type: photo.contentType,
    }
    let presign = await deps.presign({ ...target.presign, ...body })
    try {
      await deps.put(presign.upload_url, photo.file, photo.contentType)
    } catch (error) {
      // A presigned URL lasts minutes; one that expired while the request
      // was slow is refused by S3 with 403. Ask for a fresh one once.
      if (deps.status(error) !== 403) throw error
      presign = await deps.presign({ ...target.presign, ...body })
      await deps.put(presign.upload_url, photo.file, photo.contentType)
    }
    const saved = await deps.register({
      ...target.register,
      ...body,
      s3_key: presign.s3_key,
      uploaded_by: photo.uploadedBy,
      captured_at: photo.capturedAt,
    })
    return { kind: "uploaded", photoId: saved.id }
  } catch (error) {
    return classify(deps, error)
  }
}
