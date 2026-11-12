/*
 * Demo build only: the Block 9.5 ITP / Areas routes (increment 13) answered
 * in the browser, with the same rules as the API — frozen copies, hold
 * points that block later lines and completion, in-app sign-off by role,
 * pins that mark ITP lines, areas with bulk add / reorder / bulk apply.
 * The template body is read with the same parser the editor uses
 * (`parseTemplateBody`, a port of the API's).
 *
 * Increment 13.6: line evidence — acceptance criteria / reference / record,
 * photos filed under a line (`photos.itp_item_id`, with `photoRequired`
 * blocking Pass and sign-off), measured values with out-of-tolerance flags,
 * the H / W / R / I vocabulary and the three default sign-off roles.
 *
 * Increment 13.7: the sample account's masters are the starter library
 * (`src/lib/itpLibrary.json`, the same file the API seeds new accounts from).
 *
 * Increment 13.8: document numbers (`seq`, `doc_number` from the project's
 * ITP code), the three-shot photo set (`photo_set`, `shot_slots`,
 * `evidenced`; photos carry `shot_slot`), and a failed sample line.
 *
 * Increment 14: external sign-off lives in `fakeSignoff.ts`, registered at
 * the end with this module's tables.
 */
import type {
  AreaPublic,
  ItpItemPublic,
  ItpItemRef,
  ItpSignaturePublic,
  ItpTemplatePublic,
  ItpTemplateSummary,
  PhotoPublic,
  PinPublic,
  ProjectItpPublic,
  ProjectItpSummary,
  SignoffRolePublic,
} from "@/client"
import {
  DEFAULT_ROLES,
  evidenceGap,
  itpDocNumber,
  parseTemplateBody,
  TemplateError,
  THREE_SHOT_SLOTS,
} from "@/lib/itp"
import { STARTER_LIBRARY } from "@/lib/itpLibrary"
import { registerSignoffRoutes } from "./fakeSignoff"

type Body = Record<string, unknown>
type Handler = (args: {
  params: string[]
  query: URLSearchParams
  body: Body
}) => unknown

export interface ItpContext {
  on: (method: string, pattern: string, handler: Handler) => void
  fail: (status: number, detail: string) => never
  me: string
  isOwner: (projectId: number) => boolean
  projectExists: (projectId: number) => boolean
  /** The code the project's ITP numbers use (13.8). */
  projectCode: (projectId: number) => string
  pins: PinPublic[]
  photos: PhotoPublic[]
  drawingTitle: (drawingId: number) => string | null
  /** Increment 14.5: false for an old drawing revision (its pins are history). */
  drawingCurrent: (drawingId: number) => boolean
  drawingProject: (drawingId: number) => number | undefined
  nextPublicId: () => string
  // Increment 14 (external sign-off, `fakeSignoff.ts`).
  projectName: (projectId: number) => string
  projectClient: (projectId: number) => string | null
  projectLocation: (projectId: number) => string | null
  canWrite: (projectId: number) => boolean
  packUrl: string
}

interface TemplateRow {
  id: number
  public_id: string
  template_key: string
  version: number
  name: string
  description: string | null
  status: string
  body: Body
  created_by: string
  created_at: string
  updated_at: string
}
interface AreaRow {
  id: number
  public_id: string
  project_id: number
  parent_area_id: number | null
  name: string
  area_type: string
  sort_order: number
  created_by: string
  created_at: string
  updated_at: string
}
interface ItpRow {
  id: number
  public_id: string
  project_id: number
  area_id: number | null
  template_id: number | null
  template_version: number | null
  seq: number
  title: string
  status: string
  body: Body
  created_by: string
  created_at: string
  updated_at: string
}
interface ItemRow {
  id: number
  public_id: string
  project_itp_id: number
  section: string | null
  element_name: string
  requirement: string
  classification: string
  status: string
  notes: string | null
  sort_order: number
  updated_at: string
  role_ids: number[]
  acceptance_criteria: string | null
  reference_doc: string | null
  record_required: string | null
  photo_required: boolean
  photo_set: string | null
  // Increment 13.9: release lines.
  result_scale: string | null
  approved_label: string | null
  conditions: string | null
  value_type: string | null
  value_unit: string | null
  value_min: number | null
  value_max: number | null
  measured_value: string | null
}
interface RoleRow {
  id: number
  public_id: string
  project_id: number
  role_name: string
  party: string
  signer_email: string | null
  created_at: string
}
type SignatureRow = ItpSignaturePublic & { project_itp_id: number }

const stamp = () => new Date().toISOString()
const nextId = (rows: { id: number }[]) =>
  rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
const num = (value: string) => Number.parseInt(value, 10)

export function registerItpRoutes(ctx: ItpContext) {
  const { on, fail, me } = ctx
  const templates: TemplateRow[] = []
  const areas: AreaRow[] = []
  const itps: ItpRow[] = []
  const items: ItemRow[] = []
  const roles: RoleRow[] = []
  const signatures: SignatureRow[] = []

  const get = <T extends { id: number }>(rows: T[], id: number, what: string) =>
    rows.find((r) => r.id === id) ?? fail(404, `${what} not found`)
  const project = (id: number) => {
    if (!ctx.projectExists(id)) fail(404, "Project not found")
  }
  const parse = (body: unknown) => {
    try {
      return parseTemplateBody(body)
    } catch (error) {
      if (error instanceof TemplateError) fail(422, error.message)
      throw error
    }
  }

  // ── read model ────────────────────────────────────────────────────────────
  function itemStates(itpId: number) {
    const rows = items
      .filter((i) => i.project_itp_id === itpId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    let gate: ItemRow | null = null
    return rows.map((item) => {
      const sigs = signatures.filter((s) => s.itp_item_id === item.id)
      const missing = item.role_ids.filter(
        (rid) => !sigs.some((s) => s.signoff_role_id === rid),
      )
      const released = item.classification !== "hold" || missing.length === 0
      const blockedBy = gate
      if (!gate && !released) gate = item
      const linePhotos = ctx.photos.filter((p) => p.itp_item_id === item.id)
      const photoCount = linePhotos.length
      const shotSlots = THREE_SHOT_SLOTS.map((s) => s.value).filter((slot) =>
        linePhotos.some((p) => p.shot_slot === slot),
      )
      const evidenced =
        evidenceGap({
          photo_required: item.photo_required,
          photo_count: photoCount,
          photo_set: item.photo_set,
          shot_slots: shotSlots,
        }) === null
      return {
        item,
        sigs,
        missing,
        released,
        blockedBy,
        photoCount,
        shotSlots,
        evidenced,
      }
    })
  }

  function itemPublic(s: ReturnType<typeof itemStates>[number]): ItpItemPublic {
    const { item } = s
    return {
      id: item.id,
      public_id: item.public_id,
      project_itp_id: item.project_itp_id,
      section: item.section,
      element_name: item.element_name,
      requirement: item.requirement,
      classification: item.classification,
      status: item.status,
      notes: item.notes,
      sort_order: item.sort_order,
      updated_at: item.updated_at,
      acceptance_criteria: item.acceptance_criteria,
      reference_doc: item.reference_doc,
      record_required: item.record_required,
      photo_required: item.photo_required,
      photo_count: s.photoCount,
      photo_set: item.photo_set,
      shot_slots: s.shotSlots,
      evidenced: s.evidenced,
      value_type: item.value_type,
      value_unit: item.value_unit,
      value_min: item.value_min,
      value_max: item.value_max,
      measured_value: item.measured_value,
      out_of_tolerance: outOfTolerance(item),
      result_scale: item.result_scale,
      approved_label: item.approved_label,
      conditions: item.conditions,
      result_label: resultLabel(item),
      required_roles: item.role_ids.map((rid) => {
        const r = get(roles, rid, "Role")
        return {
          id: r.id,
          role_name: r.role_name,
          party: r.party,
          signer_email: r.signer_email,
        }
      }),
      signatures: s.sigs.map(({ project_itp_id: _, ...sig }) => sig),
      released: s.released,
      blocked_by_item_id: s.blockedBy?.id ?? null,
      pins: ctx.pins
        .filter(
          (p) => p.itp_item_id === item.id && ctx.drawingCurrent(p.drawing_id),
        )
        .map((p) => ({
          id: p.id,
          drawing_id: p.drawing_id,
          drawing_title: ctx.drawingTitle(p.drawing_id),
          page_number: p.page_number,
          label: p.label,
          tag_number: p.tag_number,
          status: p.status,
        })),
    }
  }

  function outOfTolerance(item: ItemRow): boolean | null {
    if (item.value_type !== "number" || item.measured_value === null)
      return null
    if (item.value_min === null && item.value_max === null) return null
    const value = Number(item.measured_value)
    return (
      (item.value_min !== null && value < item.value_min) ||
      (item.value_max !== null && value > item.value_max)
    )
  }

  function blockers(states: ReturnType<typeof itemStates>): string[] {
    const out: string[] = []
    const pending = states.filter((s) => s.item.status === "pending").length
    if (pending)
      out.push(`${pending} line${pending === 1 ? "" : "s"} still to record`)
    const failed = states.filter((s) => s.item.status === "fail").length
    if (failed) {
      out.push(
        `${failed} line${failed === 1 ? "" : "s"} failed — fix and re-record`,
      )
    }
    for (const s of states) {
      if (s.item.classification === "hold" && !s.released) {
        const names = s.missing.map((rid) => get(roles, rid, "Role").role_name)
        out.push(
          `Hold point “${s.item.requirement}” is waiting for ${names.join(", ")}`,
        )
      }
    }
    return out
  }

  function summary(itp: ItpRow): ProjectItpSummary {
    const states = itemStates(itp.id)
    const holds = states.filter((s) => s.item.classification === "hold")
    return {
      id: itp.id,
      public_id: itp.public_id,
      project_id: itp.project_id,
      area_id: itp.area_id,
      area_name: areas.find((a) => a.id === itp.area_id)?.name ?? null,
      template_id: itp.template_id,
      template_version: itp.template_version,
      seq: itp.seq,
      doc_number: itpDocNumber(ctx.projectCode(itp.project_id), itp.seq),
      title: itp.title,
      status: itp.status,
      item_count: states.length,
      done_count: states.filter((s) => s.item.status !== "pending").length,
      fail_count: states.filter((s) => s.item.status === "fail").length,
      hold_count: holds.length,
      open_hold_count: holds.filter((s) => !s.released).length,
      signature_count: signatures.filter((s) => s.project_itp_id === itp.id)
        .length,
      created_by: itp.created_by,
      created_at: itp.created_at,
      updated_at: itp.updated_at,
    }
  }

  function detail(itp: ItpRow): ProjectItpPublic {
    const states = itemStates(itp.id)
    return {
      ...summary(itp),
      body: itp.body,
      items: states.map(itemPublic),
      completion_blockers: blockers(states),
    }
  }

  function areaPublic(area: AreaRow): AreaPublic {
    const mine = itps.filter((i) => i.area_id === area.id).map(summary)
    return {
      ...area,
      itp_count: mine.length,
      complete_count: mine.filter((i) => i.status === "complete").length,
      item_count: mine.reduce((n, i) => n + i.item_count, 0),
      done_count: mine.reduce((n, i) => n + i.done_count, 0),
      open_hold_count: mine.reduce((n, i) => n + i.open_hold_count, 0),
      signed: mine.some((i) => i.signature_count > 0),
    }
  }
  const projectAreas = (projectId: number) =>
    areas
      .filter((a) => a.project_id === projectId)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)

  function templateSummary(t: TemplateRow): ItpTemplateSummary {
    const parsed = parseTemplateBody(t.body)
    return {
      id: t.id,
      public_id: t.public_id,
      template_key: t.template_key,
      version: t.version,
      name: t.name,
      description: t.description,
      status: t.status,
      item_count: parsed.items.length,
      hold_count: parsed.holdCount,
      role_names: parsed.roles.map((r) => r.name),
      created_by: t.created_by,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }
  }
  function templatePublic(t: TemplateRow): ItpTemplatePublic {
    return {
      ...templateSummary(t),
      body: t.body,
      versions: templates
        .filter((v) => v.template_key === t.template_key)
        .sort((a, b) => b.version - a.version)
        .map((v) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          created_at: v.created_at,
        })),
    }
  }

  function addTemplate(
    name: string,
    description: string | null,
    status: string,
    body: Body,
    key?: string,
    version = 1,
  ): TemplateRow {
    const row: TemplateRow = {
      id: nextId(templates),
      public_id: ctx.nextPublicId(),
      template_key: key ?? ctx.nextPublicId(),
      version,
      name,
      description,
      status,
      body,
      created_by: me,
      created_at: stamp(),
      updated_at: stamp(),
    }
    templates.push(row)
    return row
  }

  function importItp(
    template: TemplateRow,
    projectId: number,
    areaId: number | null,
    title: string,
  ): ItpRow {
    const parsed = parse(template.body)
    for (const r of parsed.roles) {
      const exists = roles.some(
        (x) =>
          x.project_id === projectId &&
          x.role_name.toLowerCase() === r.name.toLowerCase(),
      )
      if (!exists) {
        roles.push({
          id: nextId(roles),
          public_id: ctx.nextPublicId(),
          project_id: projectId,
          role_name: r.name,
          party: r.party,
          signer_email: null,
          created_at: stamp(),
        })
      }
    }
    const itp: ItpRow = {
      id: nextId(itps),
      public_id: ctx.nextPublicId(),
      project_id: projectId,
      area_id: areaId,
      template_id: template.id,
      template_version: template.version,
      seq:
        itps
          .filter((i) => i.project_id === projectId)
          .reduce((max, i) => Math.max(max, i.seq), 0) + 1,
      title,
      status: "not_started",
      body: structuredClone(template.body),
      created_by: me,
      created_at: stamp(),
      updated_at: stamp(),
    }
    itps.push(itp)
    parsed.items.forEach((p, index) => {
      items.push({
        id: nextId(items),
        public_id: ctx.nextPublicId(),
        project_itp_id: itp.id,
        section: p.section,
        element_name: p.elementName,
        requirement: p.requirement,
        classification: p.classification,
        status: "pending",
        notes: null,
        sort_order: (index + 1) * 10,
        updated_at: stamp(),
        acceptance_criteria: p.acceptanceCriteria,
        reference_doc: p.reference,
        record_required: p.recordRequired,
        photo_required: p.photoRequired,
        photo_set: p.photoSet,
        result_scale: p.resultScale,
        approved_label: p.approvedLabel,
        conditions: null,
        value_type: p.valueType,
        value_unit: p.unit,
        value_min: p.min,
        value_max: p.max,
        measured_value: null,
        role_ids: p.roles.map(
          (name) =>
            roles.find(
              (x) =>
                x.project_id === projectId &&
                x.role_name.toLowerCase() === name.toLowerCase(),
            )?.id ?? 0,
        ),
      })
    })
    return itp
  }

  const areaInProject = (areaId: number, projectId: number) => {
    const a = areas.find((x) => x.id === areaId)
    if (!a || a.project_id !== projectId) fail(404, "Area not found")
    return a as AreaRow
  }

  // ── templates ─────────────────────────────────────────────────────────────
  on("GET", "/itp-templates", ({ query }) => {
    const latest = new Map<string, TemplateRow>()
    for (const t of [...templates].sort((a, b) => b.version - a.version)) {
      if (!latest.has(t.template_key)) latest.set(t.template_key, t)
    }
    const archived = query.get("include_archived") === "true"
    return [...latest.values()]
      .filter((t) => archived || t.status !== "archived")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id - b.id)
      .map(templateSummary)
  })
  on("POST", "/itp-templates", ({ body }) => {
    parse(body.body)
    return templatePublic(
      addTemplate(
        String(body.name),
        (body.description as string) ?? null,
        String(body.status ?? "draft"),
        body.body as Body,
      ),
    )
  })
  on("GET", "/itp-templates/{template_id}", ({ params }) =>
    templatePublic(get(templates, num(params[0]), "Template")),
  )
  on("PUT", "/itp-templates/{template_id}", ({ params, body }) => {
    const t = get(templates, num(params[0]), "Template")
    const latest = templates
      .filter((v) => v.template_key === t.template_key)
      .sort((a, b) => b.version - a.version)[0]
    if (latest.id !== t.id) {
      fail(409, `Edit the latest version (v${latest.version}) instead`)
    }
    const newBody = (body.body as Body) ?? t.body
    parse(newBody)
    const created = addTemplate(
      (body.name as string) || t.name,
      "description" in body
        ? ((body.description as string) ?? null)
        : t.description,
      t.status,
      newBody,
      t.template_key,
      t.version + 1,
    )
    return templatePublic(created)
  })
  on("PATCH", "/itp-templates/{template_id}/status", ({ params, body }) => {
    const t = get(templates, num(params[0]), "Template")
    t.status = String(body.status)
    t.updated_at = stamp()
    return templatePublic(t)
  })

  // ── sign-off roles ───────────────────────────────────────────────────────
  const rolePublic = (r: RoleRow): SignoffRolePublic => ({
    ...r,
    item_count: items.filter((i) => i.role_ids.includes(r.id)).length,
  })
  on("GET", "/projects/{project_id}/signoff-roles", ({ params }) => {
    project(num(params[0]))
    return roles.filter((r) => r.project_id === num(params[0])).map(rolePublic)
  })
  on("POST", "/projects/{project_id}/signoff-roles", ({ params, body }) => {
    const pid = num(params[0])
    project(pid)
    const name = String(body.role_name).trim()
    if (
      roles.some(
        (r) =>
          r.project_id === pid &&
          r.role_name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      fail(409, `There is already a role called “${name}”`)
    }
    const row: RoleRow = {
      id: nextId(roles),
      public_id: ctx.nextPublicId(),
      project_id: pid,
      role_name: name,
      party: String(body.party ?? "contractor"),
      signer_email: (body.signer_email as string) || null,
      created_at: stamp(),
    }
    roles.push(row)
    return rolePublic(row)
  })
  on("POST", "/projects/{project_id}/signoff-roles/defaults", ({ params }) => {
    const pid = num(params[0])
    project(pid)
    for (const d of DEFAULT_ROLES) {
      const taken = roles.some(
        (r) =>
          r.project_id === pid &&
          r.role_name.toLowerCase() === d.name.toLowerCase(),
      )
      if (!taken) {
        roles.push({
          id: nextId(roles),
          public_id: ctx.nextPublicId(),
          project_id: pid,
          role_name: d.name,
          party: d.party,
          signer_email: null,
          created_at: stamp(),
        })
      }
    }
    return roles.filter((r) => r.project_id === pid).map(rolePublic)
  })
  on("PUT", "/signoff-roles/{role_id}", ({ params, body }) => {
    const r = get(roles, num(params[0]), "Sign-off role")
    if (body.role_name) r.role_name = String(body.role_name).trim()
    if (body.party) r.party = String(body.party)
    if ("signer_email" in body)
      r.signer_email = (body.signer_email as string) || null
    return rolePublic(r)
  })
  on("DELETE", "/signoff-roles/{role_id}", ({ params }) => {
    const r = get(roles, num(params[0]), "Sign-off role")
    if (rolePublic(r).item_count) {
      fail(
        409,
        "ITP lines still need this role; it can be renamed but not deleted",
      )
    }
    roles.splice(roles.indexOf(r), 1)
    return null
  })

  // ── areas ─────────────────────────────────────────────────────────────────
  on("GET", "/projects/{project_id}/areas", ({ params }) => {
    project(num(params[0]))
    return projectAreas(num(params[0])).map(areaPublic)
  })
  const nextSort = (pid: number) =>
    projectAreas(pid).reduce((m, a) => Math.max(m, a.sort_order), 0) + 10
  const newArea = (
    pid: number,
    name: string,
    type: string,
    parent: number | null,
    sort: number,
  ) => {
    const row: AreaRow = {
      id: nextId(areas),
      public_id: ctx.nextPublicId(),
      project_id: pid,
      parent_area_id: parent,
      name,
      area_type: type,
      sort_order: sort,
      created_by: me,
      created_at: stamp(),
      updated_at: stamp(),
    }
    areas.push(row)
    return row
  }
  on("POST", "/projects/{project_id}/areas", ({ params, body }) => {
    const pid = num(params[0])
    project(pid)
    const parent = (body.parent_area_id as number) ?? null
    if (parent) areaInProject(parent, pid)
    return areaPublic(
      newArea(
        pid,
        String(body.name).trim(),
        String(body.area_type ?? "other"),
        parent,
        nextSort(pid),
      ),
    )
  })
  on("POST", "/projects/{project_id}/areas/bulk", ({ params, body }) => {
    const pid = num(params[0])
    project(pid)
    const start = Number(body.start)
    const end = Number(body.end)
    if (end < start) fail(422, "The last number is before the first")
    if (end - start + 1 > 200) fail(422, "Add at most 200 areas at a time")
    const parent = (body.parent_area_id as number) ?? null
    if (parent) areaInProject(parent, pid)
    const base = nextSort(pid)
    const created = []
    for (let n = start; n <= end; n++) {
      created.push(
        newArea(
          pid,
          `${String(body.prefix).trim()} ${n}`,
          String(body.area_type ?? "other"),
          parent,
          base + (n - start) * 10,
        ),
      )
    }
    return created.map(areaPublic)
  })
  on("PUT", "/projects/{project_id}/areas/order", ({ params, body }) => {
    const pid = num(params[0])
    const ids = body.area_ids as number[]
    const mine = projectAreas(pid)
    if (ids.length !== mine.length || !mine.every((a) => ids.includes(a.id))) {
      fail(422, "Send every area of the project exactly once")
    }
    ids.forEach((id, index) => {
      get(areas, id, "Area").sort_order = (index + 1) * 10
    })
    return projectAreas(pid).map(areaPublic)
  })
  on("GET", "/areas/{area_id}", ({ params }) =>
    areaPublic(get(areas, num(params[0]), "Area")),
  )
  on("PUT", "/areas/{area_id}", ({ params, body }) => {
    const a = get(areas, num(params[0]), "Area")
    if (body.name) a.name = String(body.name).trim()
    if (body.area_type) a.area_type = String(body.area_type)
    if ("parent_area_id" in body) {
      let p: number | null = (body.parent_area_id as number) ?? null
      const target = p
      while (p) {
        if (p === a.id) fail(422, "An area cannot sit inside itself")
        p = areaInProject(p, a.project_id).parent_area_id
      }
      a.parent_area_id = target
    }
    a.updated_at = stamp()
    return areaPublic(a)
  })
  on("DELETE", "/areas/{area_id}", ({ params }) => {
    const a = get(areas, num(params[0]), "Area")
    if (areaPublic(a).signed)
      fail(409, "This area has signed ITPs and cannot be deleted")
    for (const itp of itps) if (itp.area_id === a.id) itp.area_id = null
    for (const child of areas)
      if (child.parent_area_id === a.id) child.parent_area_id = null
    areas.splice(areas.indexOf(a), 1)
    return null
  })

  // ── project ITPs ──────────────────────────────────────────────────────────
  const importable = (id: number) => {
    const t = get(templates, id, "Template")
    if (t.status === "archived") {
      fail(409, "This template is archived; restore it before applying it")
    }
    return t
  }
  on("GET", "/projects/{project_id}/itps", ({ params, query }) => {
    const pid = num(params[0])
    project(pid)
    const area = query.get("area_id")
    return itps
      .filter(
        (i) => i.project_id === pid && (!area || i.area_id === Number(area)),
      )
      .map(summary)
  })
  on("POST", "/projects/{project_id}/itps", ({ params, body }) => {
    const pid = num(params[0])
    project(pid)
    const t = importable(Number(body.template_id))
    const area = body.area_id ? areaInProject(Number(body.area_id), pid) : null
    const title =
      (body.title as string) || (area ? `${t.name} — ${area.name}` : t.name)
    return detail(importItp(t, pid, area?.id ?? null, title))
  })
  on("POST", "/projects/{project_id}/itps/bulk", ({ params, body }) => {
    const pid = num(params[0])
    project(pid)
    const t = importable(Number(body.template_id))
    const ids = [...new Set(body.area_ids as number[])]
    const chosen = ids.map((id) => areaInProject(id, pid))
    return chosen.map((a) =>
      summary(importItp(t, pid, a.id, `${t.name} — ${a.name}`)),
    )
  })
  on("GET", "/projects/{project_id}/itp-items", ({ params }) => {
    const pid = num(params[0])
    project(pid)
    const refs: ItpItemRef[] = []
    for (const itp of itps.filter(
      (i) => i.project_id === pid && i.status !== "voided",
    )) {
      for (const s of itemStates(itp.id)) {
        refs.push({
          id: s.item.id,
          project_itp_id: itp.id,
          itp_title: itp.title,
          doc_number: itpDocNumber(ctx.projectCode(pid), itp.seq),
          area_name: areas.find((a) => a.id === itp.area_id)?.name ?? null,
          section: s.item.section,
          requirement: s.item.requirement,
          classification: s.item.classification,
          status: s.item.status,
          released: s.released,
        })
      }
    }
    return refs
  })
  on("GET", "/itps/{itp_id}", ({ params }) =>
    detail(get(itps, num(params[0]), "ITP")),
  )
  on("PUT", "/itps/{itp_id}", ({ params, body }) => {
    const itp = get(itps, num(params[0]), "ITP")
    if (body.title) itp.title = String(body.title)
    if ("area_id" in body) {
      const area = body.area_id
        ? areaInProject(Number(body.area_id), itp.project_id)
        : null
      itp.area_id = area?.id ?? null
    }
    const status = body.status as string | undefined
    if (status && status !== itp.status) {
      if (
        (status === "voided" || itp.status === "voided") &&
        !ctx.isOwner(itp.project_id)
      ) {
        fail(403, "Only a project owner can void or restore an ITP")
      }
      if (status === "complete") {
        const b = blockers(itemStates(itp.id))
        if (b.length) fail(409, `Not ready to complete: ${b.join("; ")}`)
      }
      itp.status = status
    }
    itp.updated_at = stamp()
    return detail(itp)
  })
  on("DELETE", "/itps/{itp_id}", ({ params }) => {
    const itp = get(itps, num(params[0]), "ITP")
    if (signatures.some((s) => s.project_itp_id === itp.id)) {
      fail(
        409,
        "This ITP has signatures and cannot be deleted; void it instead",
      )
    }
    const ids = new Set(
      items.filter((i) => i.project_itp_id === itp.id).map((i) => i.id),
    )
    for (const pin of ctx.pins) {
      if (pin.itp_item_id && ids.has(pin.itp_item_id)) pin.itp_item_id = null
    }
    for (let i = ctx.photos.length - 1; i >= 0; i--) {
      const itemId = ctx.photos[i].itp_item_id
      if (itemId && ids.has(itemId)) ctx.photos.splice(i, 1)
    }
    for (let i = items.length - 1; i >= 0; i--) {
      if (ids.has(items[i].id)) items.splice(i, 1)
    }
    itps.splice(itps.indexOf(itp), 1)
    return null
  })

  // ── lines ─────────────────────────────────────────────────────────────────
  const lineState = (itemId: number) => {
    const item = get(items, itemId, "ITP item")
    const itp = get(itps, item.project_itp_id, "ITP item")
    const state = itemStates(itp.id).find((s) => s.item.id === itemId)
    if (!state) return fail(404, "ITP item not found")
    return { item, itp, state }
  }
  const ensureRecordable = (state: ReturnType<typeof itemStates>[number]) => {
    if (state.blockedBy) {
      fail(
        409,
        `Waiting for hold point “${state.blockedBy.requirement}” to be signed off before this line can be recorded`,
      )
    }
    if (state.sigs.length)
      fail(409, "This line is signed; its result can no longer change")
  }
  const measured = (item: ItemRow, raw: unknown): string | null => {
    const value = typeof raw === "string" ? raw.trim() : ""
    if (!value) return null
    if (!item.value_type) fail(422, "This line does not take a measured value")
    if (item.value_type === "number") {
      const n = Number(value.replace(/,/g, ""))
      if (!Number.isFinite(n)) fail(422, `“${value}” is not a number`)
      return String(n)
    }
    return value
  }

  /** May evidence photos be added to / listed for this line? */
  function checkEvidence(itemId: number, opts: { read?: boolean } = {}) {
    const { itp, state } = lineState(itemId)
    if (opts.read) return
    if (itp.status === "complete")
      fail(409, "This ITP is complete; reopen it to change its photos")
    if (itp.status === "voided") fail(409, "This ITP is voided")
    if (state.blockedBy) {
      fail(
        409,
        `Waiting for hold point “${state.blockedBy.requirement}” to be signed off before this line can be recorded`,
      )
    }
    if (state.sigs.length)
      fail(409, "This line is signed; its photos can no longer change")
  }
  function checkEvidenceDelete(photo: PhotoPublic) {
    const itemId = photo.itp_item_id as number
    checkEvidence(itemId)
    const { item } = lineState(itemId)
    if (item.status !== "pass" || !(item.photo_required || item.photo_set))
      return
    const others = ctx.photos.filter(
      (p) => p.itp_item_id === itemId && p.id !== photo.id,
    )
    const gap = evidenceGap({
      photo_required: item.photo_required,
      photo_count: others.length,
      photo_set: item.photo_set,
      shot_slots: others.map((p) => p.shot_slot ?? "").filter(Boolean),
    })
    if (gap)
      fail(
        409,
        "This line passed with its required photo; set it back to pending before removing the last photo",
      )
  }
  /** Shot slots only on a line that asks for the three-shot set (13.8). */
  function checkShotSlot(itemId: number, slot: string) {
    const { item } = lineState(itemId)
    if (
      item.photo_set !== "three_shot" ||
      !THREE_SHOT_SLOTS.some((s) => s.value === slot)
    ) {
      fail(
        422,
        "Only a line that asks for the three-shot set takes a shot slot",
      )
    }
  }
  const gapMessage = (state: ReturnType<typeof itemStates>[number]) => {
    if (state.item.photo_set === "three_shot") {
      const missing = THREE_SHOT_SLOTS.filter(
        (s) => !state.shotSlots.includes(s.value),
      ).map((s) => s.label)
      return `the three-shot photo set (still missing: ${missing.join(", ")})`
    }
    return "a photo on file"
  }

  function resultLabel(item: ItemRow): string | null {
    if (item.result_scale !== "release") return null
    if (item.status === "pass") {
      return item.conditions
        ? "Approved with conditions"
        : item.approved_label || "Approved"
    }
    return item.status === "fail" ? "Rejected" : null
  }

  on("PUT", "/itp-items/{item_id}", ({ params, body }) => {
    const { item, itp, state } = lineState(num(params[0]))
    if (itp.status === "complete")
      fail(409, "This ITP is complete; reopen it to change results")
    if (itp.status === "voided") fail(409, "This ITP is voided")
    if ("measured_value" in body) {
      const value = measured(item, body.measured_value)
      if (value !== item.measured_value) {
        ensureRecordable(state)
        item.measured_value = value
      }
    }
    const status = body.status as string | undefined
    if (item.result_scale === "release") {
      // Increment 13.9, as the API's `_apply_release`.
      if (status === "na") {
        fail(
          422,
          "A release line is recorded as Approved, Approved with conditions or Rejected, not N/A",
        )
      }
      const after = status ?? item.status
      if ("conditions" in body) {
        const text = String(body.conditions ?? "").trim() || null
        if (text && after !== "pass") {
          fail(422, "Conditions go with an approval; record it first")
        }
        if (text !== item.conditions) {
          ensureRecordable(state)
          item.conditions = text
        }
      }
      if (after !== "pass" && item.conditions) {
        ensureRecordable(state)
        item.conditions = null
      }
    } else if (body.conditions) {
      fail(422, "Only a release line takes conditions")
    }
    if (status && status !== item.status) {
      ensureRecordable(state)
      if (status === "pass" && !state.evidenced) {
        fail(
          409,
          `This line needs ${gapMessage(state)} before it can pass — take or upload the photo first`,
        )
      }
      item.status = status
      if (itp.status === "not_started") itp.status = "in_progress"
    }
    if ("notes" in body) item.notes = (body.notes as string) ?? null
    item.updated_at = stamp()
    return itemPublic(lineState(item.id).state)
  })
  on("POST", "/itp-items/{item_id}/signatures", ({ params, body }) => {
    const { item, itp, state } = lineState(num(params[0]))
    if (itp.status === "voided") fail(409, "This ITP is voided")
    const role = roles.find(
      (r) =>
        r.id === Number(body.signoff_role_id) && item.role_ids.includes(r.id),
    )
    if (!role) return fail(422, "This line does not need that sign-off role")
    if (state.sigs.some((s) => s.signoff_role_id === role.id)) {
      fail(409, `${role.role_name} has already signed this line`)
    }
    if (state.blockedBy) {
      fail(
        409,
        `Waiting for hold point “${state.blockedBy.requirement}” to be signed off first`,
      )
    }
    if (item.status !== "pass" && item.status !== "na") {
      fail(409, "Record this line as Pass or N/A before it is signed")
    }
    if (item.status === "pass" && !state.evidenced) {
      fail(409, `This line needs ${gapMessage(state)} before it can be signed`)
    }
    if (role.signer_email) {
      if (role.signer_email.toLowerCase() !== me.toLowerCase()) {
        fail(403, `Only ${role.signer_email} can sign as ${role.role_name}`)
      }
    } else if (!ctx.isOwner(itp.project_id)) {
      fail(
        403,
        `${role.role_name} has no signer email; a project owner signs for it`,
      )
    }
    const sig: SignatureRow = {
      id: nextId(signatures),
      project_itp_id: itp.id,
      itp_item_id: item.id,
      signoff_role_id: role.id,
      role_name: role.role_name,
      party: role.party,
      signer_name: (body.signer_name as string) || "Demo Inspector",
      signer_email: me,
      method: "in_app",
      signed_at: stamp(),
      gps_lat: (body.gps_lat as number) ?? null,
      gps_lng: (body.gps_lng as number) ?? null,
    }
    signatures.push(sig)
    if (itp.status === "not_started") itp.status = "in_progress"
    const { project_itp_id: _, ...out } = sig
    return out
  })

  /** A pin may only mark a line of the same project. */
  function checkPinItem(drawingId: number, itemId: unknown) {
    if (itemId === null || itemId === undefined) return
    const item = items.find((i) => i.id === Number(itemId))
    const itp = item
      ? itps.find((x) => x.id === item.project_itp_id)
      : undefined
    if (!itp || itp.project_id !== ctx.drawingProject(drawingId)) {
      fail(404, "ITP item not found")
    }
  }

  // ── sample data (13.7, revised 13.9): the starter library as the account's masters,
  // three stages of project 1 with concrete on two and a pressure test on
  // the third, and the duct bank for the whole project ───────────────────────
  const masters = STARTER_LIBRARY.map((starter) =>
    addTemplate(
      starter.name,
      starter.description,
      "published",
      structuredClone(starter.body) as Body,
    ),
  )
  // Seeded together, as the API does: one timestamp, listed in library order.
  const seededAt = stamp()
  for (const m of masters) {
    m.created_at = seededAt
    m.updated_at = seededAt
  }
  const masterFor = (key: string) =>
    masters[STARTER_LIBRARY.findIndex((t) => t.key === key)]
  const concrete = masterFor("cast-in-place-concrete")
  const pressureTest = masterFor("piping-pressure-test")
  const stage1 = newArea(1, "Stage 1 — Compressor pad", "stage", null, 10)
  const stage2 = newArea(1, "Stage 2 — Flare pad", "stage", null, 20)
  const stage3 = newArea(1, "Stage 3 — Condensate area", "stage", null, 30)
  const first = importItp(
    concrete,
    1,
    stage1.id,
    `${concrete.name} — ${stage1.name}`,
  )
  const second = importItp(
    concrete,
    1,
    stage2.id,
    `${concrete.name} — ${stage2.name}`,
  )
  const third = importItp(
    pressureTest,
    1,
    stage3.id,
    `${pressureTest.name} — ${stage3.name}`,
  )
  // A whole-project ITP (no area): the site duct bank, not started.
  const conduit = masterFor("underground-conduit-duct-bank")
  importItp(conduit, 1, null, conduit.name)

  const lineOf = (itp: ItpRow, name: string) => {
    const found = items.find(
      (i) => i.project_itp_id === itp.id && i.element_name === name,
    )
    if (!found) throw new Error(`demo seed: no line ${name}`)
    return found
  }
  // Sample assets the demo already ships stand in for site photos.
  const filePhoto = (
    itemId: number,
    s3Key: string,
    filename: string,
    slot: string | null = null,
  ) => {
    ctx.photos.push({
      id: ctx.photos.reduce((max, p) => Math.max(max, p.id), 0) + 1,
      public_id: ctx.nextPublicId(),
      inspection_id: null,
      itp_item_id: itemId,
      finding_id: null,
      s3_key: s3Key,
      filename,
      content_type: "image/jpeg",
      uploaded_by: me,
      created_at: stamp(),
      shot_slot: slot,
      captured_at: stamp(),
      view_url: null,
    })
  }
  const record = (
    itp: ItpRow,
    name: string,
    notes: string | null = null,
    value: string | null = null,
  ) => {
    const line = lineOf(itp, name)
    if (line.photo_set === "three_shot") {
      for (const slot of THREE_SHOT_SLOTS) {
        filePhoto(
          line.id,
          "photos/demo/compressor-skid.jpg",
          `${name}-${slot.value}.jpg`,
          slot.value,
        )
      }
    } else if (line.photo_required) {
      filePhoto(line.id, "photos/demo/compressor-skid.jpg", `${name}.jpg`)
    }
    line.status = "pass"
    line.notes = notes
    line.measured_value = value
    itp.status = "in_progress"
    return line
  }
  const signAs = (itp: ItpRow, line: ItemRow, roleName: string) => {
    const role = roles.find(
      (r) => r.project_id === itp.project_id && r.role_name === roleName,
    )
    if (!role) return
    signatures.push({
      id: nextId(signatures),
      project_itp_id: itp.id,
      itp_item_id: line.id,
      signoff_role_id: role.id,
      role_name: role.role_name,
      party: role.party,
      signer_name: "Demo Inspector",
      signer_email: me,
      method: "in_app",
      signed_at: stamp(),
      gps_lat: 35.7796,
      gps_lng: -78.6382,
    })
  }

  const recordAll = (itp: ItpRow, names: string[]) => {
    for (const name of names) record(itp, name)
  }

  // Stage 1 concrete (13.9): every pre-pour check of Checklist A-1 done and
  // the six rebar hold points released by the inspector; the written
  // pre-pour release is "Approved with conditions" and waits for the
  // Contractor and the Owner's representative to sign.
  record(first, "rebar-submittals", "Shop drawings S-201 rev C on site")
  record(first, "formwork-drawings", "Forms FW-03 rev B approved")
  record(first, "embeds-submittal", "Anchor bolt submittal AB-02 approved")
  record(first, "subgrade", "Density report DR-07: 97 % of D1557")
  record(first, "form-dimensions", "Set-out checked against S-101 rev C")
  recordAll(first, [
    "form-clean",
    "release-agent",
    "construction-joints",
    "chamfers-joints",
    "shoring",
  ])
  const spacing = record(
    first,
    "rebar-size-spacing",
    "#5 Grade 60 — A615; 14 bars counted each way in both mats",
    "12, 11 3/4, 12 1/4",
  )
  const rebarValues: Record<string, [string | null, string | null]> = {
    "concrete-cover": ["Smallest at the north edge", "3"],
    "lap-splices": ["Shortest lap 30 in (S-201 schedule: 30 in)", null],
    "rebar-clean": [null, null],
    couplers: ["No couplers in this pour", null],
    "dowels-hooks-ties": [null, null],
  }
  signAs(first, spacing, "Third-party inspector")
  for (const [name, [notes, value]] of Object.entries(rebarValues)) {
    signAs(first, record(first, name, notes, value), "Third-party inspector")
  }
  lineOf(first, "couplers").status = "na"
  record(
    first,
    "anchor-bolt-templates",
    "Template surveyed; all bolts in tolerance",
  )
  recordAll(first, [
    "anchor-bolt-projection",
    "sleeves-blockouts",
    "conduit-utilities",
    "grounding",
  ])
  record(first, "mix-design", "Mix 4000-AE, approved rev 1")
  recordAll(first, [
    "batch-tickets-plan",
    "vibrators",
    "curing-materials",
    "test-equipment",
  ])
  lineOf(first, "weather-plan").status = "na"
  lineOf(first, "weather-plan").notes = "Forecast 58–71 °F, dry"
  record(first, "pre-pour-form", "Checklist complete; no blanks")
  record(first, "eor-notified", "EOR emailed 07:10; reply 07:32 — proceed")
  record(first, "stop-plan")
  const release = record(first, "pre-pour-release")
  release.conditions =
    "1. Re-tie two loose bars at grid C7 before the first truck\n2. Pump operator to keep the hose within 4 ft of the deck"
  const padPin = ctx.pins.find((p) => p.id === 5)
  if (padPin) padPin.itp_item_id = spacing.id

  // Stage 2 concrete (13.8): submittals accepted, the forms failed and are
  // being re-set — a failed line shows tinted with its note beneath.
  record(second, "rebar-submittals", "Shop drawings S-202 rev A on site")
  record(second, "formwork-drawings", "Forms FW-04 rev A approved")
  record(second, "embeds-submittal", "Sleeve submittal SL-01 approved")
  record(second, "subgrade", "Density report DR-09: 96 % of D1557")
  const forms = lineOf(second, "form-dimensions")
  forms.status = "fail"
  forms.notes =
    "East form 3/4 in out of line at gridline C — re-set and re-check before rebar"
  second.status = "in_progress"

  // Stage 3 pressure test (field guide Checklist A-3): the package checks
  // are done and the first boundary blind check is passed and waiting for
  // both signatures.
  record(third, "test-package", "Test pack TP-CD-03 accepted; 225 psig")
  record(third, "boundary-pid", "P&ID CD-101 rev 4")
  record(third, "nde-complete", "Weld log complete; RT accepted")
  record(third, "gauges", "Gauges G-114 / G-115, calibrated 2026-09")
  record(third, "relief", "PRV-7 set at 245 psig")
  record(third, "test-medium", "Hydrant water, potable")
  record(third, "blinds", "Blinds B-1 to B-6 installed and tight")

  // Increment 14: signing links, packs, notices and the signing page; one
  // seeded link opens Stage 1's pre-pour release for the Owner's
  // representative at /sign/demo-owners-rep.
  const signoff = registerSignoffRoutes({
    on,
    fail,
    me,
    nextPublicId: ctx.nextPublicId,
    itps,
    areas,
    roles,
    signatures,
    itemStates,
    docNumber: (itp) => itpDocNumber(ctx.projectCode(itp.project_id), itp.seq),
    resultLabel: (item) => resultLabel(item as ItemRow),
    outOfTolerance: (item) => outOfTolerance(item as ItemRow),
    projectName: ctx.projectName,
    projectClient: ctx.projectClient,
    projectLocation: ctx.projectLocation,
    canWrite: ctx.canWrite,
    packUrl: ctx.packUrl,
  })
  signoff.seedLink(
    first.id,
    "Owner's representative",
    "owners.rep@example.com",
    "demo-owners-rep",
  )

  return { checkPinItem, checkEvidence, checkEvidenceDelete, checkShotSlot }
}
