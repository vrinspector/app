/*
 * Demo build only: an in-browser stand-in for the VR Inspector API.
 *
 * The generated client sends every request through an axios instance; the
 * demo gives it one whose adapter answers from an in-memory copy of the
 * sample data (seed.ts) instead of the network. It mirrors the real API's
 * routes, shapes and 404 object-hiding closely enough for every screen to
 * work. Changes last until the page is reloaded.
 */
import axios, {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios"

import type {
  DashboardPublic,
  DrawingPublic,
  FindingPublic,
  InspectionPublic,
  MemberPublic,
  PhotoPublic,
  PinPublic,
  ProjectPublic,
  ReportPublic,
} from "@/client"

import { DEMO_USER } from "./auth0-stub"
import { demoUploadUrl, forgetStoredFile, storedFileUrl } from "./fakeS3"
import {
  ASSET_URLS,
  createSeed,
  type DemoDb,
  nextPublicId,
  SAMPLE_REPORT_URL,
} from "./seed"

const db: DemoDb = createSeed()
const me = DEMO_USER.email

const nextId = (rows: { id: number }[]) =>
  rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
const stamp = () => new Date().toISOString()

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail)
  }
}
const notFound = (what: string): never => {
  throw new HttpError(404, `${what} not found`)
}

function fileUrl(s3Key: string): string | null {
  return storedFileUrl(s3Key) ?? ASSET_URLS[s3Key] ?? null
}

function find<T extends { id: number }>(rows: T[], id: number, what: string) {
  return rows.find((row) => row.id === id) ?? notFound(what)
}

function remove<T>(rows: T[], keep: (row: T) => boolean): void {
  const kept = rows.filter(keep)
  rows.splice(0, rows.length, ...kept)
}

type Body = Record<string, unknown>
type Query = URLSearchParams

function withPhotoUrl(photo: PhotoPublic): PhotoPublic {
  return { ...photo, view_url: fileUrl(photo.s3_key) }
}

function deleteInspection(id: number) {
  const findingIds = new Set(
    db.findings.filter((f) => f.inspection_id === id).map((f) => f.id),
  )
  remove(db.findings, (f) => f.inspection_id !== id)
  remove(db.photos, (p) => p.inspection_id !== id)
  remove(db.reports, (r) => r.inspection_id !== id)
  for (const pin of db.pins) {
    if (pin.finding_id !== null && findingIds.has(pin.finding_id)) {
      pin.finding_id = null
    }
  }
  remove(db.inspections, (i) => i.id !== id)
}

function dashboard(): DashboardPublic {
  const openFindings = db.findings.filter((f) => f.status !== "resolved")
  const projects = db.projects.map((project) => {
    const inspections = db.inspections.filter(
      (i) => i.project_id === project.id,
    )
    const ids = new Set(inspections.map((i) => i.id))
    const open = openFindings.filter((f) => ids.has(f.inspection_id))
    const dates = inspections.map((i) => i.created_at).sort()
    const last = dates[dates.length - 1]
    return {
      id: project.id,
      name: project.name,
      client: project.client,
      status: project.status,
      inspection_count: inspections.length,
      open_finding_count: open.length,
      high_finding_count: open.filter((f) => f.priority === "high").length,
      photo_count: db.photos.filter((p) => ids.has(p.inspection_id)).length,
      last_inspected: last ? last.slice(0, 10) : "Never",
    }
  })
  const recent = [...db.inspections]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map((i) => ({
      id: i.id,
      project_id: i.project_id,
      project_name:
        db.projects.find((p) => p.id === i.project_id)?.name ?? "Project",
      title: i.title,
      inspector: i.inspector,
      created_at: i.created_at,
      finding_count: db.findings.filter((f) => f.inspection_id === i.id).length,
    }))
  return {
    summary: {
      total_projects: db.projects.length,
      total_inspections: db.inspections.length,
      open_findings: openFindings.length,
      high_priority_findings: openFindings.filter((f) => f.priority === "high")
        .length,
      total_photos: db.photos.length,
    },
    projects,
    recent_inspections: recent,
  }
}

type Handler = (args: { params: string[]; query: Query; body: Body }) => unknown

const routes: Array<[string, RegExp, Handler]> = []
const on = (method: string, pattern: string, handler: Handler) => {
  const regex = new RegExp(
    `^/api/v1${pattern.replace(/\{[a-z_]+\}/g, "(\\d+)")}/?$`,
  )
  for (const m of method.split("|")) routes.push([m, regex, handler])
}
const num = (value: string) => Number.parseInt(value, 10)

// --- Users / utils ---------------------------------------------------------
on("GET", "/users/me", () => ({
  sub: DEMO_USER.sub,
  email: DEMO_USER.email,
  name: DEMO_USER.name,
  picture: null,
  permissions: [],
}))
on("GET", "/utils/health-check", () => true)
on("GET", "/dashboard", () => dashboard())
// Weather badge (increment 10.5): a fixed, plausible reading for the demo.
on("GET", "/weather", () => ({
  description: "Partly cloudy",
  temp_f: 61,
  humidity: 58,
  wind_mph: 7,
  weather_code: 2,
}))

// --- Projects & members ----------------------------------------------------
on("GET", "/projects", () => db.projects)
on("POST", "/projects", ({ body }) => {
  const project: ProjectPublic = {
    id: nextId(db.projects),
    public_id: nextPublicId(),
    name: String(body.name ?? "Untitled project"),
    client: (body.client as string) ?? null,
    location: (body.location as string) ?? null,
    status: (body.status as string) ?? "active",
    created_by: me,
    created_at: stamp(),
    updated_at: stamp(),
  }
  db.projects.push(project)
  db.members.push({
    id: nextId(db.members),
    public_id: nextPublicId(),
    project_id: project.id,
    email: me,
    user_email: me,
    user_sub: DEMO_USER.sub,
    role: "owner",
    invited_by: null,
    created_at: stamp(),
  })
  return project
})
on("GET", "/projects/{project_id}", ({ params }) =>
  find(db.projects, num(params[0]), "Project"),
)
on("PUT|PATCH", "/projects/{project_id}", ({ params, body }) => {
  const project = find(db.projects, num(params[0]), "Project")
  Object.assign(project, body, { updated_at: stamp() })
  return project
})
on("DELETE", "/projects/{project_id}", ({ params }) => {
  const id = num(params[0])
  find(db.projects, id, "Project")
  for (const i of db.inspections.filter((x) => x.project_id === id)) {
    deleteInspection(i.id)
  }
  const drawingIds = new Set(
    db.drawings.filter((d) => d.project_id === id).map((d) => d.id),
  )
  remove(db.pins, (p) => !drawingIds.has(p.drawing_id))
  remove(db.drawings, (d) => d.project_id !== id)
  remove(db.members, (m) => m.project_id !== id)
  remove(db.projects, (p) => p.id !== id)
  return null
})
on("GET", "/projects/{project_id}/members", ({ params }) => {
  const id = num(params[0])
  find(db.projects, id, "Project")
  return db.members.filter((m) => m.project_id === id)
})
on("POST", "/projects/{project_id}/members", ({ params, body }) => {
  const id = num(params[0])
  find(db.projects, id, "Project")
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase()
  if (db.members.some((m) => m.project_id === id && m.email === email)) {
    throw new HttpError(409, "That person is already a member of this project")
  }
  const created: MemberPublic = {
    id: nextId(db.members),
    public_id: nextPublicId(),
    project_id: id,
    email,
    user_email: email,
    user_sub: null,
    role: (body.role as string) ?? "inspector",
    invited_by: me,
    created_at: stamp(),
  }
  db.members.push(created)
  return created
})
on("DELETE", "/projects/{project_id}/members/{member_id}", ({ params }) => {
  find(db.members, num(params[1]), "Member")
  remove(db.members, (m) => m.id !== num(params[1]))
  return null
})

// --- Inspections -----------------------------------------------------------
on("GET", "/inspections", ({ query }) => {
  const projectId = num(query.get("project_id") ?? "0")
  find(db.projects, projectId, "Project")
  return db.inspections
    .filter((i) => i.project_id === projectId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
})
on("POST", "/inspections", ({ body }) => {
  const projectId = Number(body.project_id)
  find(db.projects, projectId, "Project")
  const type = (body.inspection_type as string) ?? "general"
  const created: InspectionPublic = {
    id: nextId(db.inspections),
    public_id: nextPublicId(),
    project_id: projectId,
    title: String(body.title ?? "Inspection"),
    inspection_type: type,
    type,
    inspector: (body.inspector as string) ?? DEMO_USER.name,
    notes: (body.notes as string) ?? null,
    status: "open",
    inspection_status: "open",
    signed_off_by: null,
    signed_off_at: null,
    created_at: stamp(),
    updated_at: stamp(),
  }
  db.inspections.push(created)
  return created
})
on("GET", "/inspections/{inspection_id}", ({ params }) =>
  find(db.inspections, num(params[0]), "Inspection"),
)
on("PUT|PATCH", "/inspections/{inspection_id}", ({ params, body }) => {
  const inspection = find(db.inspections, num(params[0]), "Inspection")
  Object.assign(inspection, body, { updated_at: stamp() })
  if (body.inspection_type) inspection.type = String(body.inspection_type)
  return inspection
})
on("DELETE", "/inspections/{inspection_id}", ({ params }) => {
  find(db.inspections, num(params[0]), "Inspection")
  deleteInspection(num(params[0]))
  return null
})
on("PATCH|POST|PUT", "/inspections/{inspection_id}/signoff", ({ params }) => {
  const inspection = find(db.inspections, num(params[0]), "Inspection")
  Object.assign(inspection, {
    inspection_status: "closed",
    signed_off_by: me,
    signed_off_at: stamp(),
    updated_at: stamp(),
  })
  return inspection
})
on("PATCH|POST|PUT", "/inspections/{inspection_id}/reopen", ({ params }) => {
  const inspection = find(db.inspections, num(params[0]), "Inspection")
  Object.assign(inspection, {
    inspection_status: "open",
    signed_off_by: null,
    signed_off_at: null,
    updated_at: stamp(),
  })
  return inspection
})

// --- Findings --------------------------------------------------------------
on("GET", "/findings", ({ query }) => {
  const inspectionId = num(query.get("inspection_id") ?? "0")
  find(db.inspections, inspectionId, "Inspection")
  return db.findings
    .filter((f) => f.inspection_id === inspectionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
})
on("POST", "/findings", ({ body }) => {
  const inspectionId = Number(body.inspection_id)
  find(db.inspections, inspectionId, "Inspection")
  const created: FindingPublic = {
    id: nextId(db.findings),
    public_id: nextPublicId(),
    inspection_id: inspectionId,
    title: String(body.title ?? "Finding"),
    description: (body.description as string) ?? null,
    priority: (body.priority as string) ?? "medium",
    location_ref: (body.location_ref as string) ?? null,
    status: (body.status as string) ?? "open",
    resolved_by: null,
    resolved_at: null,
    resolution_notes: null,
    created_at: stamp(),
    updated_at: stamp(),
  }
  db.findings.push(created)
  return created
})
on("GET", "/findings/{finding_id}", ({ params }) =>
  find(db.findings, num(params[0]), "Finding"),
)
on("PUT|PATCH", "/findings/{finding_id}", ({ params, body }) => {
  const f = find(db.findings, num(params[0]), "Finding")
  Object.assign(f, body, { updated_at: stamp() })
  return f
})
on("DELETE", "/findings/{finding_id}", ({ params }) => {
  const id = num(params[0])
  find(db.findings, id, "Finding")
  remove(db.findings, (f) => f.id !== id)
  for (const pin of db.pins) if (pin.finding_id === id) pin.finding_id = null
  for (const photo of db.photos) {
    if (photo.finding_id === id) photo.finding_id = null
  }
  return null
})
on("PATCH|POST|PUT", "/findings/{finding_id}/status", ({ params, body }) => {
  const f = find(db.findings, num(params[0]), "Finding")
  const status = String(body.status ?? "open")
  Object.assign(f, { status, updated_at: stamp() })
  if (status !== "resolved") {
    Object.assign(f, {
      resolved_by: null,
      resolved_at: null,
      resolution_notes: null,
    })
  }
  return f
})
on("PATCH|POST|PUT", "/findings/{finding_id}/resolve", ({ params, body }) => {
  const f = find(db.findings, num(params[0]), "Finding")
  Object.assign(f, {
    status: "resolved",
    resolved_by: me,
    resolved_at: stamp(),
    resolution_notes: (body.resolution_notes as string) ?? null,
    updated_at: stamp(),
  })
  return f
})

// --- Photos ----------------------------------------------------------------
on("POST", "/photos/presign", ({ body }) => {
  const inspectionId = Number(body.inspection_id)
  find(db.inspections, inspectionId, "Inspection")
  const name = String(body.filename ?? "photo.jpg").replace(/[^\w.-]/g, "_")
  const key = `photos/inspections/${inspectionId}/${Date.now()}-${name}`
  return { upload_url: demoUploadUrl(key), s3_key: key }
})
on("GET", "/photos", ({ query }) => {
  const inspectionId = num(query.get("inspection_id") ?? "0")
  find(db.inspections, inspectionId, "Inspection")
  const findingId = query.get("finding_id")
  return db.photos
    .filter((p) => p.inspection_id === inspectionId)
    .filter((p) => findingId === null || p.finding_id === num(findingId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(withPhotoUrl)
})
on("POST", "/photos", ({ body }) => {
  const inspectionId = Number(body.inspection_id)
  find(db.inspections, inspectionId, "Inspection")
  // Increment 11a: a photo may be filed under a finding of the same inspection.
  let findingId: number | null = null
  if (body.finding_id !== undefined && body.finding_id !== null) {
    const finding = db.findings.find((f) => f.id === Number(body.finding_id))
    if (!finding || finding.inspection_id !== inspectionId) {
      notFound("Finding")
    }
    findingId = Number(body.finding_id)
  }
  const s3Key = String(body.s3_key)
  const created: PhotoPublic = {
    id: nextId(db.photos),
    public_id: nextPublicId(),
    inspection_id: inspectionId,
    finding_id: findingId,
    s3_key: s3Key,
    filename: (body.filename as string) ?? null,
    content_type: (body.content_type as string) ?? "image/jpeg",
    uploaded_by: me,
    created_at: stamp(),
    view_url: fileUrl(s3Key),
  }
  db.photos.push(created)
  return created
})
on("GET", "/photos/{photo_id}", ({ params }) =>
  withPhotoUrl(find(db.photos, num(params[0]), "Photo")),
)
on("DELETE", "/photos/{photo_id}", ({ params }) => {
  const photo = find(db.photos, num(params[0]), "Photo")
  forgetStoredFile(photo.s3_key)
  remove(db.photos, (p) => p.id !== photo.id)
  return null
})

// --- Drawings & pins -------------------------------------------------------
on("POST", "/drawings/presign", ({ body }) => {
  const projectId = Number(body.project_id)
  find(db.projects, projectId, "Project")
  const name = String(body.filename ?? "drawing.pdf").replace(/[^\w.-]/g, "_")
  const key = `drawings/projects/${projectId}/${Date.now()}-${name}`
  return { upload_url: demoUploadUrl(key), s3_key: key }
})
on("GET", "/drawings", ({ query }) => {
  const projectId = num(query.get("project_id") ?? "0")
  find(db.projects, projectId, "Project")
  const discipline = query.get("discipline")
  return db.drawings
    .filter(
      (d) =>
        d.project_id === projectId &&
        (!discipline || d.discipline === discipline),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
})
on("POST", "/drawings", ({ body }) => {
  const projectId = Number(body.project_id)
  find(db.projects, projectId, "Project")
  const created: DrawingPublic = {
    id: nextId(db.drawings),
    public_id: nextPublicId(),
    project_id: projectId,
    title: String(body.title ?? body.filename ?? "Drawing"),
    drawing_number: (body.drawing_number as string) ?? null,
    discipline: (body.discipline as string) ?? "general",
    filename: String(body.filename ?? "drawing"),
    s3_key: String(body.s3_key),
    file_type: (body.file_type as string) ?? "pdf",
    file_size: (body.file_size as number) ?? null,
    view_url: null,
    thumbnail_url: null,
    page_width_pts: null,
    page_height_pts: null,
    uploaded_by: me,
    created_at: stamp(),
    updated_at: stamp(),
  }
  db.drawings.push(created)
  return created
})
on("GET", "/drawings/{drawing_id}", ({ params }) =>
  find(db.drawings, num(params[0]), "Drawing"),
)
on("PUT|PATCH", "/drawings/{drawing_id}", ({ params, body }) => {
  const d = find(db.drawings, num(params[0]), "Drawing")
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && value !== undefined) {
      ;(d as Record<string, unknown>)[key] = value
    }
  }
  d.updated_at = stamp()
  return d
})
on("DELETE", "/drawings/{drawing_id}", ({ params }) => {
  const d = find(db.drawings, num(params[0]), "Drawing")
  forgetStoredFile(d.s3_key)
  remove(db.pins, (p) => p.drawing_id !== d.id)
  remove(db.drawings, (x) => x.id !== d.id)
  return null
})
on("PATCH|PUT", "/drawings/{drawing_id}/dimensions", ({ params, body }) => {
  const d = find(db.drawings, num(params[0]), "Drawing")
  d.page_width_pts = Number(body.page_width_pts)
  d.page_height_pts = Number(body.page_height_pts)
  return {
    id: d.id,
    page_width_pts: d.page_width_pts,
    page_height_pts: d.page_height_pts,
  }
})
on("GET", "/drawings/{drawing_id}/view-url", ({ params }) => {
  const d = find(db.drawings, num(params[0]), "Drawing")
  return { view_url: fileUrl(d.s3_key) ?? notFound("Drawing") }
})
on("GET", "/drawings/{drawing_id}/pins", ({ params }) => {
  const id = num(params[0])
  find(db.drawings, id, "Drawing")
  return db.pins.filter((p) => p.drawing_id === id)
})
on("POST", "/drawings/{drawing_id}/pins", ({ params, body }) => {
  const drawingId = num(params[0])
  find(db.drawings, drawingId, "Drawing")
  const created: PinPublic = {
    id: nextId(db.pins),
    public_id: nextPublicId(),
    drawing_id: drawingId,
    finding_id: (body.finding_id as number) ?? null,
    tag_number: (body.tag_number as string) ?? null,
    label: (body.label as string) ?? null,
    x_pct: Number(body.x_pct),
    y_pct: Number(body.y_pct),
    status: (body.status as string) ?? "not_started",
    notes: (body.notes as string) ?? null,
    discipline_data: null,
    page_number: Number(body.page_number ?? 1),
    created_by: me,
    created_at: stamp(),
  }
  db.pins.push(created)
  return created
})
on("GET", "/pins/{pin_id}", ({ params }) =>
  find(db.pins, num(params[0]), "Pin"),
)
on("PUT|PATCH", "/pins/{pin_id}", ({ params, body }) => {
  const pin = find(db.pins, num(params[0]), "Pin")
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) (pin as Record<string, unknown>)[key] = value
  }
  return pin
})
on("DELETE", "/pins/{pin_id}", ({ params }) => {
  find(db.pins, num(params[0]), "Pin")
  remove(db.pins, (p) => p.id !== num(params[0]))
  return null
})

// --- Reports ---------------------------------------------------------------
on("GET", "/reports", ({ query }) => {
  const inspectionId = num(query.get("inspection_id") ?? "0")
  find(db.inspections, inspectionId, "Inspection")
  return db.reports
    .filter((r) => r.inspection_id === inspectionId)
    .sort((a, b) => b.version - a.version)
})
on("POST", "/reports/generate", ({ body }) => {
  const inspectionId = Number(body.inspection_id)
  const inspection = find(db.inspections, inspectionId, "Inspection")
  const version =
    db.reports
      .filter((r) => r.inspection_id === inspectionId)
      .reduce((max, r) => Math.max(max, r.version), 0) + 1
  const slug = inspection.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")
  const created: ReportPublic = {
    id: nextId(db.reports),
    public_id: nextPublicId(),
    inspection_id: inspectionId,
    version,
    s3_key: `reports/demo/inspection-${inspectionId}-v${version}.pdf`,
    filename: `${slug}-v${version}.pdf`,
    file_size: 171843,
    finding_count: db.findings.filter((f) => f.inspection_id === inspectionId)
      .length,
    photo_count: db.photos.filter((p) => p.inspection_id === inspectionId)
      .length,
    generated_by: me,
    created_at: stamp(),
    download_url: SAMPLE_REPORT_URL,
  }
  db.reports.push(created)
  return created
})
on("GET", "/reports/{report_id}", ({ params }) =>
  find(db.reports, num(params[0]), "Report"),
)
on("DELETE", "/reports/{report_id}", ({ params }) => {
  find(db.reports, num(params[0]), "Report")
  remove(db.reports, (r) => r.id !== num(params[0]))
  return null
})

// --- Adapter ---------------------------------------------------------------
const delay = (ms: number) => new Promise((r) => window.setTimeout(r, ms))

function parseBody(data: unknown): Body {
  if (typeof data === "string" && data.length > 0) {
    try {
      return JSON.parse(data) as Body
    } catch {
      return {}
    }
  }
  if (data && typeof data === "object") return data as Body
  return {}
}

async function demoAdapter(
  config: InternalAxiosRequestConfig,
): Promise<AxiosResponse> {
  const method = (config.method ?? "get").toUpperCase()
  const url = new URL(config.url ?? "/", "https://demo.invalid")
  if (config.params && typeof config.params === "object") {
    for (const [k, v] of Object.entries(config.params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
    }
  }
  // Small, varied latency so loading states show the way they do on site.
  await delay(120 + Math.random() * 220)

  const respond = (status: number, data: unknown): AxiosResponse => ({
    data,
    status,
    statusText: String(status),
    headers: {},
    config,
    request: {},
  })

  for (const [m, regex, handler] of routes) {
    if (m !== method) continue
    const match = regex.exec(url.pathname)
    if (!match) continue
    try {
      const data = handler({
        params: match.slice(1),
        query: url.searchParams,
        body: parseBody(config.data),
      })
      const status = data === null ? 204 : method === "POST" ? 201 : 200
      return respond(status, data === null ? "" : structuredClone(data))
    } catch (error) {
      if (error instanceof HttpError) {
        const response = respond(error.status, { detail: error.detail })
        throw new AxiosError(
          error.detail,
          AxiosError.ERR_BAD_REQUEST,
          config,
          {},
          response,
        )
      }
      throw error
    }
  }
  const response = respond(404, { detail: "Not Found" })
  throw new AxiosError(
    `Demo API has no route for ${method} ${url.pathname}`,
    AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    response,
  )
}

export const demoAxios = axios.create({ adapter: demoAdapter })
