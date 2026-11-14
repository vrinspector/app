/**
 * The sync history (rebuild increment 19, PRD v2.63 Block 11 "last-write-wins
 * with audit trail"): one line per change this device uploaded, read from the
 * local-only `sync_audit` table that the upload queue writes (connector.ts).
 */
import type { AuditOutcome } from "./upload"

/** A `sync_audit` row as SQLite returns it. */
export interface AuditRow {
  id: string
  table_name: string | null
  op: string | null
  row_id: string | null
  outcome: string | null
  http_status: number | null
  detail: string | null
  action: string | null
  payload: string | null
  replaced: string | null
  queued_at: string | null
  created_at: string | null
}

export interface AuditEntry {
  id: string
  outcome: AuditOutcome
  /** What was done, e.g. "Logged finding “Crack at grid C4”". */
  what: string
  /** When it was done on the device (falls back to when it uploaded). */
  madeAt: string | null
  uploadedAt: string | null
  /** Plain-words result. */
  result: string
  /** "overwrote": field → the server value that was replaced. */
  replaced: Array<{ field: string; value: string }>
}

const NOUNS: Record<string, string> = {
  findings: "finding",
  inspection_pins: "pin",
  inspections: "inspection",
  itp_items: "ITP line",
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  priority: "Priority",
  location_ref: "Location",
  discipline: "Discipline",
  inspection_type: "Type",
  inspector: "Inspector",
  notes: "Notes",
  status: "Status",
}

function fallbackWhat(row: AuditRow): string {
  const noun = NOUNS[row.table_name ?? ""] ?? row.table_name ?? "record"
  if (row.op === "PUT") return `Added a ${noun}`
  if (row.op === "DELETE") return `Deleted a ${noun}`
  return `Changed a ${noun}`
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function asOutcome(value: string | null): AuditOutcome {
  return value === "overwrote" || value === "refused" ? value : "applied"
}

export function toAuditEntry(row: AuditRow): AuditEntry {
  const outcome = asOutcome(row.outcome)
  const replaced = Object.entries(parseObject(row.replaced)).map(
    ([field, value]) => ({
      field: FIELD_LABELS[field] ?? field,
      value:
        value === null || value === undefined || value === ""
          ? "(blank)"
          : String(value),
    }),
  )
  let result: string
  if (outcome === "refused") {
    result = `Not accepted by the server: ${row.detail || "no reason given"}. The server's version is shown instead.`
  } else if (outcome === "overwrote") {
    result =
      "Uploaded. Someone had changed it on the server in the meantime; this device's change was later, so it replaced theirs (last change wins)."
  } else {
    result = "Uploaded."
  }
  return {
    id: row.id,
    outcome,
    what: row.action || fallbackWhat(row),
    madeAt: row.queued_at ?? row.created_at,
    uploadedAt: row.created_at,
    result,
    replaced,
  }
}

/** Newest first; refused and overwritten lines are what needs a look. */
export function needsAttention(entry: AuditEntry): boolean {
  return entry.outcome !== "applied"
}
