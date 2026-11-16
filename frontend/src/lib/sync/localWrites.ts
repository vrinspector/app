/**
 * Saving findings and pins on the device while there is no connection
 * (rebuild increment 19, PRD v2.63 Block 11).
 *
 * Each function writes one row into the local SQLite copy. PowerSync puts the
 * write in its upload queue, and the queue (upload.ts) replays it against the
 * same `/api/v1/` endpoint the screen would have called online, so the API
 * still decides whether it is allowed.
 *
 * Every write carries `_metadata` (PowerSync's per-write metadata column) with
 * when it was made and a one-line description, which the sync history shows.
 *
 * Offline on purpose: creating and editing findings, placing and moving pins.
 * Everything else — status changes, resolving, deleting, photos, sign-offs —
 * still needs a connection.
 */
import { newLocalId } from "./upload"

/** The slice of the PowerSync database these writes use. */
export interface LocalWriter {
  execute(
    sql: string,
    params?: unknown[],
  ): Promise<{ rowsAffected?: number } | unknown>
}

/** A write that cannot be made on this device (shown to the person as is). */
export class OfflineWriteError extends Error {}

export interface WriteMetadata {
  queued_at: string
  /** e.g. "Logged finding “Crack at grid C4”" */
  action: string
}

export function writeMetadata(action: string, now = new Date()): string {
  return JSON.stringify({
    queued_at: now.toISOString(),
    action,
  } satisfies WriteMetadata)
}

export function parseWriteMetadata(
  value: string | null | undefined,
): WriteMetadata | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<WriteMetadata>
    if (typeof parsed.queued_at !== "string") return null
    return {
      queued_at: parsed.queued_at,
      action: typeof parsed.action === "string" ? parsed.action : "",
    }
  } catch {
    return null
  }
}

function affected(result: unknown): number | undefined {
  const value = (result as { rowsAffected?: unknown } | null)?.rowsAffected
  return typeof value === "number" ? value : undefined
}

async function update(
  db: LocalWriter,
  sql: string,
  params: unknown[],
  missing: string,
): Promise<void> {
  const result = await db.execute(sql, params)
  if (affected(result) === 0) throw new OfflineWriteError(missing)
}

export interface FindingFields {
  title: string
  description: string | null
  priority: string
  location_ref: string | null
  discipline?: string | null
}

export async function saveFindingOffline(
  db: LocalWriter,
  inspectionId: number | string,
  fields: FindingFields & { status?: string },
  now = new Date(),
): Promise<string> {
  const id = newLocalId()
  const stamp = now.toISOString()
  await db.execute(
    "INSERT INTO findings (id, inspection_id, title, description, priority, " +
      "location_ref, status, discipline, created_at, updated_at, _metadata) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      String(inspectionId),
      fields.title,
      fields.description,
      fields.priority,
      fields.location_ref,
      fields.status ?? "open",
      fields.discipline ?? null,
      stamp,
      stamp,
      writeMetadata(`Logged finding “${fields.title}”`, now),
    ],
  )
  return id
}

export async function updateFindingOffline(
  db: LocalWriter,
  findingId: number | string,
  fields: FindingFields,
  now = new Date(),
): Promise<void> {
  const columns = ["title", "description", "priority", "location_ref"]
  const values: unknown[] = [
    fields.title,
    fields.description,
    fields.priority,
    fields.location_ref,
  ]
  if (fields.discipline !== undefined) {
    columns.push("discipline")
    values.push(fields.discipline)
  }
  await update(
    db,
    `UPDATE findings SET ${columns.map((c) => `${c} = ?`).join(", ")}, ` +
      "_metadata = ? WHERE id = ?",
    [
      ...values,
      writeMetadata(`Edited finding “${fields.title}”`, now),
      String(findingId),
    ],
    "This finding is not on this device yet, so it can only be edited with a connection.",
  )
}

export interface PinPlacement {
  x_pct: number
  y_pct: number
  status: string
  page_number: number
  itp_item_id?: number | null
  /** How the history names it, e.g. "Placed a Punch item pin". */
  description?: string
}

export async function placePinOffline(
  db: LocalWriter,
  drawingId: number | string,
  pin: PinPlacement,
  now = new Date(),
): Promise<string> {
  const id = newLocalId()
  await db.execute(
    "INSERT INTO inspection_pins (id, drawing_id, itp_item_id, x_pct, y_pct, " +
      "status, page_number, position_check, created_at, _metadata) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [
      id,
      String(drawingId),
      pin.itp_item_id === null || pin.itp_item_id === undefined
        ? null
        : String(pin.itp_item_id),
      pin.x_pct,
      pin.y_pct,
      pin.status,
      pin.page_number,
      now.toISOString(),
      writeMetadata(pin.description ?? `Placed a ${pin.status} pin`, now),
    ],
  )
  return id
}

export async function movePinOffline(
  db: LocalWriter,
  pinId: number | string,
  to: { x_pct: number; y_pct: number; page_number: number },
  label: string,
  now = new Date(),
): Promise<void> {
  await update(
    db,
    "UPDATE inspection_pins SET x_pct = ?, y_pct = ?, page_number = ?, " +
      "_metadata = ? WHERE id = ?",
    [
      to.x_pct,
      to.y_pct,
      to.page_number,
      writeMetadata(`Moved pin ${label}`, now),
      String(pinId),
    ],
    "This pin is not on this device yet, so it can only be moved with a connection.",
  )
}
