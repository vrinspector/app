/**
 * Reading the synced copy when there is no signal (rebuild increment 21).
 *
 * Increment 19 made changes saveable offline, but the screens still read
 * from the API, so an app opened from the home screen with no signal had
 * nothing to show. Now the field screens — projects, a project, its
 * inspections and drawings, an inspection's findings, a drawing and its
 * pins, and the project's members (for the role) — try the API first and,
 * only when the request could not reach the server at all, read the same
 * rows from this device's PowerSync copy (increment 18).
 *
 * Nothing is cached here: the synced copy is the PowerSync database that
 * already exists. API errors that came back from the server (401, 403, 404,
 * validation) are never replaced by local rows.
 *
 * No PowerSync code is imported (types only), so builds without offline
 * sync pay nothing; the database is handed in by SyncProvider once open.
 */
import type { CommonPowerSyncDatabase } from "@powersync/common"
import { AxiosError } from "axios"

import type {
  DrawingPublic,
  FindingPublic,
  InspectionPublic,
  MemberPublic,
  PinPublic,
  ProjectPublic,
} from "@/client"
import { derivedProjectCode } from "@/lib/itp"

import { type LocalRow, localFinding, localPin, numericId } from "./merge"

/** The small part of the PowerSync database this module uses. */
export type LocalReader = Pick<CommonPowerSyncDatabase, "getAll">

let reader: LocalReader | null = null

/** Called by SyncProvider when the device's copy opens (null on close). */
export function setOfflineReader(db: LocalReader | null): void {
  reader = db
}

export function getOfflineReader(): LocalReader | null {
  return reader
}

/** Plain words for a screen that needs signal and has no copy on the device. */
export class OfflineError extends Error {
  constructor(
    message = "No signal. This needs a connection and is not saved on this device yet — open it once while you have signal.",
  ) {
    super(message)
    this.name = "OfflineError"
  }
}

/**
 * The request never reached the server (no signal, DNS, TLS, timeout).
 * A response from the server — any status — is not a network failure.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof AxiosError) return !error.response
  if (error instanceof TypeError) return true // fetch's "Failed to fetch"
  return typeof navigator !== "undefined" && navigator.onLine === false
}

/**
 * Ask the API; if the request cannot reach the server, answer from the
 * device's synced copy instead. `fromLocal` returns undefined when the copy
 * does not hold the row (then a plain "needs signal" error is raised).
 */
export async function withLocalFallback<T>(
  fromApi: () => Promise<T>,
  fromLocal: (db: LocalReader) => Promise<T | undefined>,
  offlineMessage?: string,
): Promise<T> {
  try {
    return await fromApi()
  } catch (error) {
    if (!isNetworkFailure(error)) throw error
    const db = reader
    if (!db) throw new OfflineError(offlineMessage)
    let local: T | undefined
    try {
      local = await fromLocal(db)
    } catch (localError) {
      console.warn("The device's copy could not be read", localError)
      local = undefined
    }
    if (local === undefined) throw new OfflineError(offlineMessage)
    return local
  }
}

/** For screens with no local copy (dashboard, reports…): a clear message. */
export async function withOfflineMessage<T>(
  fromApi: () => Promise<T>,
  offlineMessage: string,
): Promise<T> {
  try {
    return await fromApi()
  } catch (error) {
    if (isNetworkFailure(error)) throw new OfflineError(offlineMessage)
    throw error
  }
}

// ---------------------------------------------------------------- mappers

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function stamp(value: unknown): string {
  return text(value) ?? new Date(0).toISOString()
}

export function localProject(row: LocalRow): ProjectPublic {
  const id = numericId(row.id)
  const name = text(row.name) ?? ""
  const code = text(row.code)
  return {
    id,
    public_id: text(row.public_id) ?? row.id,
    name,
    client: text(row.client),
    location: text(row.location),
    status: text(row.status) ?? "active",
    created_by: text(row.created_by),
    created_at: stamp(row.created_at),
    updated_at: stamp(row.updated_at),
    code,
    itp_code: code?.trim() ? code.trim() : derivedProjectCode(name, id),
  }
}

export function localInspection(row: LocalRow): InspectionPublic {
  const inspectionType = text(row.inspection_type)
  return {
    id: numericId(row.id),
    public_id: text(row.public_id) ?? row.id,
    project_id: numericId(row.project_id),
    title: text(row.title) ?? "",
    inspection_type: inspectionType,
    type: inspectionType,
    inspector: text(row.inspector),
    notes: text(row.notes),
    status: text(row.status) ?? "draft",
    inspection_status: text(row.inspection_status) ?? "open",
    signed_off_by: text(row.signed_off_by),
    signed_off_at: text(row.signed_off_at),
    created_at: stamp(row.created_at),
    updated_at: stamp(row.updated_at),
  }
}

export function localDrawing(
  row: LocalRow & { revision_count?: unknown },
): DrawingPublic {
  const superseded = text(row.superseded_at)
  return {
    id: numericId(row.id),
    public_id: text(row.public_id) ?? row.id,
    project_id: numericId(row.project_id),
    title: text(row.title) ?? "",
    drawing_number: text(row.drawing_number),
    discipline: text(row.discipline) ?? "general",
    filename: text(row.filename) ?? "",
    s3_key: text(row.s3_key) ?? "",
    file_type: text(row.file_type) ?? "",
    file_size: nullableNumber(row.file_size),
    // Presigned links are never stored; the viewer uses the copy kept on
    // the device (offlineDrawings.ts) or says it needs signal.
    view_url: null,
    thumbnail_url: null,
    page_width_pts: nullableNumber(row.page_width_pts),
    page_height_pts: nullableNumber(row.page_height_pts),
    uploaded_by: text(row.uploaded_by),
    created_at: stamp(row.created_at),
    updated_at: stamp(row.updated_at),
    series_id: nullableNumber(row.series_id),
    revision: text(row.revision),
    superseded_at: superseded,
    revision_count: Math.max(1, Number(row.revision_count ?? 1) || 1),
    pins_to_check: 0,
    is_current: !superseded,
  }
}

export function localMember(row: LocalRow): MemberPublic {
  const email = text(row.user_email) ?? ""
  return {
    id: numericId(row.id),
    public_id: row.id,
    project_id: numericId(row.project_id),
    email,
    user_email: email,
    // Not synced: the role is matched by email (findOwnMembership).
    user_sub: null,
    role: text(row.role) ?? "viewer",
    invited_by: null,
    created_at: stamp(row.created_at),
  }
}

// ---------------------------------------------------------------- readers

export async function readLocalProjects(
  db: LocalReader,
): Promise<ProjectPublic[]> {
  // Same order as the API: newest first.
  const rows = await db.getAll<LocalRow>(
    "SELECT * FROM projects ORDER BY created_at DESC",
  )
  return rows.map(localProject)
}

export async function readLocalProject(
  db: LocalReader,
  projectId: number,
): Promise<ProjectPublic | undefined> {
  const rows = await db.getAll<LocalRow>(
    "SELECT * FROM projects WHERE id = ?",
    [String(projectId)],
  )
  return rows[0] ? localProject(rows[0]) : undefined
}

export async function readLocalMembers(
  db: LocalReader,
  projectId: number,
): Promise<MemberPublic[] | undefined> {
  const rows = await db.getAll<LocalRow>(
    "SELECT * FROM project_members WHERE project_id = ? ORDER BY created_at",
    [String(projectId)],
  )
  return rows.length ? rows.map(localMember) : undefined
}

export async function readLocalInspections(
  db: LocalReader,
  projectId: number,
): Promise<InspectionPublic[] | undefined> {
  if (!(await readLocalProject(db, projectId))) return undefined
  const rows = await db.getAll<LocalRow>(
    "SELECT * FROM inspections WHERE project_id = ? ORDER BY created_at DESC",
    [String(projectId)],
  )
  return rows.map(localInspection)
}

export async function readLocalInspection(
  db: LocalReader,
  inspectionId: number,
): Promise<InspectionPublic | undefined> {
  const rows = await db.getAll<LocalRow>(
    "SELECT * FROM inspections WHERE id = ?",
    [String(inspectionId)],
  )
  return rows[0] ? localInspection(rows[0]) : undefined
}

export async function readLocalFindings(
  db: LocalReader,
  inspectionId: number,
): Promise<FindingPublic[] | undefined> {
  if (!(await readLocalInspection(db, inspectionId))) return undefined
  const rows = await db.getAll<LocalRow>(
    "SELECT * FROM findings WHERE inspection_id = ? ORDER BY created_at DESC",
    [String(inspectionId)],
  )
  return rows.map(localFinding)
}

const DRAWING_SELECT = `SELECT d.*, (
    SELECT COUNT(*) FROM drawings r
    WHERE r.series_id IS NOT NULL AND r.series_id = d.series_id
  ) AS revision_count FROM drawings d`

export async function readLocalDrawings(
  db: LocalReader,
  projectId: number,
): Promise<DrawingPublic[] | undefined> {
  if (!(await readLocalProject(db, projectId))) return undefined
  // The API lists the current revision of each sheet.
  const rows = await db.getAll<LocalRow>(
    `${DRAWING_SELECT} WHERE d.project_id = ? AND d.superseded_at IS NULL ORDER BY d.created_at DESC`,
    [String(projectId)],
  )
  return rows.map(localDrawing)
}

export async function readLocalDrawing(
  db: LocalReader,
  drawingId: number,
): Promise<DrawingPublic | undefined> {
  const rows = await db.getAll<LocalRow>(`${DRAWING_SELECT} WHERE d.id = ?`, [
    String(drawingId),
  ])
  return rows[0] ? localDrawing(rows[0]) : undefined
}

export async function readLocalPins(
  db: LocalReader,
  drawingId: number,
): Promise<PinPublic[] | undefined> {
  if (!(await readLocalDrawing(db, drawingId))) return undefined
  const rows = await db.getAll<LocalRow>(
    "SELECT * FROM inspection_pins WHERE drawing_id = ? ORDER BY created_at",
    [String(drawingId)],
  )
  return rows.map(localPin)
}
