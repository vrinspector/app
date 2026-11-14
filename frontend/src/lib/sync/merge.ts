/**
 * Showing changes saved on this device next to the server's list (rebuild
 * increment 19).
 *
 * The screens still load findings and pins from the API. While a change made
 * offline is waiting to upload, the device's copy of that row (from the local
 * SQLite database) is laid over the API's list: an edited row shows its new
 * values, a row created offline is added, and both are marked unsynced so the
 * screen can say so. Once the upload goes through, the API's list has the row
 * and the overlay drops away.
 *
 * Rows created offline carry a `local-…` text id; the screens key everything
 * by number, so they get a stable negative number here (server ids are
 * always positive).
 */
import type { FindingPublic, PinPublic } from "@/client"
import { rowKey } from "./status"
import { isLocalId } from "./upload"

export type LocalRow = Record<string, unknown> & { id: string }

/** A stable negative id for a row created offline. */
export function localNumericId(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0
  }
  // Never 0, always negative.
  return -((Math.abs(hash) % 2_000_000_000) + 1)
}

export function numericId(id: unknown): number {
  if (typeof id === "number") return id
  if (isLocalId(id)) return localNumericId(id)
  const value = Number(id)
  return Number.isFinite(value) ? value : localNumericId(String(id))
}

function nullableId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  return numericId(value)
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

export function localFinding(row: LocalRow): FindingPublic {
  const now = new Date().toISOString()
  return {
    id: numericId(row.id),
    public_id: text(row.public_id) ?? row.id,
    inspection_id: numericId(row.inspection_id),
    title: text(row.title) ?? "",
    description: text(row.description),
    priority: text(row.priority) ?? "medium",
    location_ref: text(row.location_ref),
    status: text(row.status) ?? "open",
    resolved_by: text(row.resolved_by),
    resolved_at: text(row.resolved_at),
    resolution_notes: text(row.resolution_notes),
    discipline: text(row.discipline),
    created_at: text(row.created_at) ?? now,
    updated_at: text(row.updated_at) ?? text(row.created_at) ?? now,
  }
}

export function localPin(row: LocalRow): PinPublic {
  return {
    id: numericId(row.id),
    public_id: text(row.public_id) ?? row.id,
    drawing_id: numericId(row.drawing_id),
    finding_id: nullableId(row.finding_id),
    itp_item_id: nullableId(row.itp_item_id),
    tag_number: text(row.tag_number),
    label: text(row.label),
    x_pct: Number(row.x_pct ?? 0),
    y_pct: Number(row.y_pct ?? 0),
    status: text(row.status) ?? "open",
    notes: text(row.notes),
    discipline_data: null,
    page_number: Number(row.page_number ?? 1) || 1,
    created_by: text(row.created_by),
    created_at: text(row.created_at) ?? new Date().toISOString(),
    position_check: Boolean(Number(row.position_check ?? 0)),
  }
}

export interface MergedRows<T> {
  rows: T[]
  /** Ids (as the screens see them) of rows with a change waiting. */
  unsynced: Set<number>
}

/**
 * The API's rows with this device's waiting changes laid over them.
 * Only rows whose `table:id` is in `pendingKeys` are taken from the local
 * copy; everything else is exactly what the API returned.
 */
export function overlayPending<T extends { id: number; public_id: string }>(
  apiRows: readonly T[],
  localRows: readonly LocalRow[],
  pendingKeys: ReadonlySet<string>,
  table: string,
  toPublic: (row: LocalRow) => T,
): MergedRows<T> {
  const unsynced = new Set<number>()
  if (pendingKeys.size === 0 || localRows.length === 0) {
    return { rows: [...apiRows], unsynced }
  }
  const waiting = new Map<number, T>()
  for (const row of localRows) {
    if (!pendingKeys.has(rowKey(table, row.id))) continue
    const value = toPublic(row)
    waiting.set(value.id, value)
  }
  if (waiting.size === 0) return { rows: [...apiRows], unsynced }
  const rows: T[] = apiRows.map((row) => {
    const local = waiting.get(row.id)
    if (!local) return row
    waiting.delete(row.id)
    unsynced.add(row.id)
    // Keep the API's extra fields (e.g. ai_suggestion_id, view links).
    return { ...row, ...local, public_id: row.public_id }
  })
  for (const [id, value] of waiting) {
    unsynced.add(id)
    rows.push(value)
  }
  return { rows, unsynced }
}
