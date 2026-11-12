/*
 * Demo build only: increment 14 — external sign-off answered in the browser,
 * with the same rules as the API (app/api/routes/signoff.py): one live link
 * per role and document, single use, 14 days, withdraw, reminders that
 * replace the link; the no-account signing page; sign-off packs versioned
 * only when something on them changed; witness / hold point notices.
 *
 * Nothing is emailed: links show as "emailed" and the demo opens them with
 * "Copy link". A sample link is seeded so the owner can walk the signing
 * page: /sign/demo-owners-rep (Stage 1 concrete, Owner's representative).
 */
import type {
  ItpSignaturePublic,
  SignDocument,
  SignLine,
  SignLinkPublic,
  SignPackPublic,
} from "@/client"

type Body = Record<string, unknown>
type Handler = (args: {
  params: string[]
  query: URLSearchParams
  body: Body
}) => unknown

interface Item {
  id: number
  project_itp_id: number
  section: string | null
  requirement: string
  classification: string
  status: string
  notes: string | null
  role_ids: number[]
  acceptance_criteria: string | null
  reference_doc: string | null
  conditions: string | null
  measured_value: string | null
  value_unit: string | null
}
interface ItemState {
  item: Item
  sigs: { signoff_role_id: number | null }[]
  blockedBy: { requirement: string } | null
  evidenced: boolean
  photoCount: number
}
interface Itp {
  id: number
  project_id: number
  area_id: number | null
  title: string
  status: string
  seq: number
}
interface Area {
  id: number
  project_id: number
  name: string
}
interface Role {
  id: number
  project_id: number
  role_name: string
  party: string
  signer_email: string | null
}
type SignatureRow = ItpSignaturePublic & { project_itp_id: number }

export interface SignoffContext {
  on: (method: string, pattern: string, handler: Handler) => void
  fail: (status: number, detail: string) => never
  me: string
  nextPublicId: () => string
  itps: Itp[]
  areas: Area[]
  roles: Role[]
  signatures: SignatureRow[]
  itemStates: (itpId: number) => ItemState[]
  docNumber: (itp: Itp) => string | null
  resultLabel: (item: Item) => string | null
  outOfTolerance: (item: Item) => boolean | null
  projectName: (projectId: number) => string
  projectClient: (projectId: number) => string | null
  projectLocation: (projectId: number) => string | null
  canWrite: (projectId: number) => boolean
  packUrl: string
}

interface LinkRow extends Omit<SignLinkPublic, "status" | "link"> {
  token: string
  revoked: boolean
  revoked_reason: string | null
}
interface PackRow extends SignPackPublic {
  hash: string
}

const DAY = 86_400_000
const stamp = () => new Date().toISOString()
const num = (value: string) => Number.parseInt(value, 10)
const nextId = (rows: { id: number }[]) =>
  rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
const DEMO_WEATHER = {
  description: "Partly cloudy",
  temp_f: 64.4,
  humidity: 58,
  wind_mph: 6.2,
  weather_code: 2,
  location: "Sample County, NC",
  source: "open-meteo",
}

export function registerSignoffRoutes(ctx: SignoffContext) {
  const { on, fail, me } = ctx
  const links: LinkRow[] = []
  const packs: PackRow[] = []
  const notices: { itemId: number; at: number }[] = []

  const statusOf = (link: LinkRow): string => {
    if (link.used_at) return "used"
    if (link.revoked)
      return link.revoked_reason === "replaced" ? "replaced" : "revoked"
    if (Date.parse(link.expires_at) <= Date.now()) return "expired"
    return "active"
  }
  // The demo shows every link (it has no email to carry them), as a start
  // URL of the demo page: demo.html?start=/sign/<token>.
  const publicLink = (link: LinkRow, _created = false): SignLinkPublic => {
    const { token, revoked: _r, revoked_reason: _rr, ...rest } = link
    return {
      ...rest,
      status: statusOf(link),
      link: `${window.location.origin}${window.location.pathname}?start=/sign/${token}`,
    }
  }

  // ── scope ──────────────────────────────────────────────────────────────
  type Scope = { itp?: Itp; area?: Area; projectId: number; docs: Itp[] }
  const itpScope = (id: number): Scope => {
    const itp = ctx.itps.find((i) => i.id === id) ?? fail(404, "ITP not found")
    return { itp, projectId: itp.project_id, docs: [itp] }
  }
  const areaScope = (id: number): Scope => {
    const area =
      ctx.areas.find((a) => a.id === id) ?? fail(404, "Area not found")
    return {
      area,
      projectId: area.project_id,
      docs: ctx.itps
        .filter((i) => i.area_id === area.id && i.status !== "voided")
        .sort((a, b) => a.seq - b.seq),
    }
  }
  const scopeOf = (link: LinkRow): Scope =>
    link.project_itp_id !== null
      ? itpScope(link.project_itp_id)
      : areaScope(link.area_id as number)
  const sameScope = (link: LinkRow, scope: Scope) =>
    scope.itp
      ? link.project_itp_id === scope.itp.id
      : link.area_id === scope.area?.id

  type RoleLine = {
    itp: Itp
    state: ItemState
    signState: "ready" | "signed" | "waiting"
    reason: string | null
  }
  const roleLines = (scope: Scope, roleId: number): RoleLine[] => {
    const out: RoleLine[] = []
    for (const itp of scope.docs) {
      if (itp.status === "voided") continue
      for (const state of ctx.itemStates(itp.id)) {
        const { item } = state
        if (!item.role_ids.includes(roleId)) continue
        let signState: RoleLine["signState"] = "ready"
        let reason: string | null = null
        if (state.sigs.some((s) => s.signoff_role_id === roleId)) {
          signState = "signed"
        } else if (state.blockedBy) {
          signState = "waiting"
          reason = `Waiting for hold point “${state.blockedBy.requirement}” to be released`
        } else if (item.status === "pending") {
          signState = "waiting"
          reason = "Not recorded on site yet"
        } else if (item.status === "fail") {
          signState = "waiting"
          reason = "Recorded as failed — waiting for the work to be fixed"
        } else if (item.status === "pass" && !state.evidenced) {
          signState = "waiting"
          reason = "Photo evidence still to be added"
        }
        out.push({ itp, state, signState, reason })
      }
    }
    return out
  }
  const rolesNeeded = (scope: Scope): Role[] => {
    const ids = new Set<number>()
    for (const itp of scope.docs) {
      if (itp.status === "voided") continue
      for (const s of ctx.itemStates(itp.id))
        for (const rid of s.item.role_ids) ids.add(rid)
    }
    return ctx.roles.filter((r) => ids.has(r.id)).sort((a, b) => a.id - b.id)
  }
  const nothingReady = (role: Role, lines: RoleLine[]) => {
    if (lines.length && lines.every((l) => l.signState === "signed"))
      return `${role.role_name} has already signed every line`
    const reason = lines.find((l) => l.reason)?.reason
    return `Nothing is ready for ${role.role_name} to sign yet${
      reason ? ` (${reason.toLowerCase()})` : ""
    }`
  }

  const issue = (
    scope: Scope,
    role: Role,
    email: string,
    reminderCount = 0,
    token = `demo-${crypto.randomUUID()}`,
  ): LinkRow => {
    for (const old of links) {
      if (
        sameScope(old, scope) &&
        old.signoff_role_id === role.id &&
        !old.used_at &&
        !old.revoked
      ) {
        old.revoked = true
        old.revoked_at = stamp()
        old.revoked_reason = "replaced"
      }
    }
    const link: LinkRow = {
      id: nextId(links),
      public_id: ctx.nextPublicId(),
      token,
      project_itp_id: scope.itp?.id ?? null,
      area_id: scope.area?.id ?? null,
      signoff_role_id: role.id,
      role_name: role.role_name,
      signer_email: email,
      expires_at: new Date(Date.now() + 14 * DAY).toISOString(),
      used_at: null,
      revoked: false,
      revoked_at: null,
      revoked_reason: null,
      reminder_count: reminderCount,
      created_by: me,
      created_at: stamp(),
      email_status: "sent",
    }
    links.unshift(link)
    return link
  }

  const requestLinks = (scope: Scope, body: Body) => {
    if (!ctx.canWrite(scope.projectId)) fail(403, "Not enough permissions")
    const needed = rolesNeeded(scope)
    const roleId = body.signoff_role_id
    const override = (body.signer_email as string | null | undefined) || null
    if (roleId !== undefined && roleId !== null) {
      const role =
        needed.find((r) => r.id === Number(roleId)) ??
        fail(422, "No line here needs that sign-off role")
      const lines = roleLines(scope, role.id)
      if (lines.every((l) => l.signState === "signed"))
        fail(409, nothingReady(role, lines))
      const email = override ?? role.signer_email
      if (!email)
        fail(
          422,
          `${role.role_name} has no signer email — enter one, or add it under Sign-off roles`,
        )
      if (!lines.some((l) => l.signState === "ready"))
        fail(409, nothingReady(role, lines))
      return {
        links: [publicLink(issue(scope, role, email as string), true)],
        skipped: [],
      }
    }
    if (override) fail(422, "Choose a role to send to a different email")
    const created: SignLinkPublic[] = []
    const skipped: string[] = []
    for (const role of needed) {
      const lines = roleLines(scope, role.id)
      if (lines.every((l) => l.signState === "signed")) continue
      if (!role.signer_email) {
        skipped.push(
          `${role.role_name}: no signer email — add one under Sign-off roles`,
        )
        continue
      }
      if (!lines.some((l) => l.signState === "ready")) {
        skipped.push(`${role.role_name}: nothing ready to sign yet`)
        continue
      }
      created.push(publicLink(issue(scope, role, role.signer_email), true))
    }
    if (!created.length && !skipped.length)
      fail(409, "Every required signature is already on file")
    return { links: created, skipped }
  }

  const listLinks = (scope: Scope) =>
    links.filter((l) => sameScope(l, scope)).map((l) => publicLink(l))

  on("GET", "/itps/{itp_id}/sign-links", ({ params }) =>
    listLinks(itpScope(num(params[0]))),
  )
  on("POST", "/itps/{itp_id}/sign-links", ({ params, body }) => {
    const scope = itpScope(num(params[0]))
    if (scope.itp?.status === "voided") fail(409, "This ITP is voided")
    return requestLinks(scope, body)
  })
  on("GET", "/areas/{area_id}/sign-links", ({ params }) =>
    listLinks(areaScope(num(params[0]))),
  )
  on("POST", "/areas/{area_id}/sign-links", ({ params, body }) => {
    const scope = areaScope(num(params[0]))
    if (!scope.docs.length) fail(409, "This area has no ITPs to sign")
    return requestLinks(scope, body)
  })
  const linkById = (id: number) =>
    links.find((l) => l.id === id) ?? fail(404, "Signing link not found")
  on("POST", "/sign-links/{link_id}/remind", ({ params }) => {
    const link = linkById(num(params[0]))
    const scope = scopeOf(link)
    if (!ctx.canWrite(scope.projectId)) fail(403, "Not enough permissions")
    const status = statusOf(link)
    if (status === "used")
      fail(409, "This link has been used; send a new request for anything left")
    if (status === "replaced")
      fail(409, "This link was already replaced by a newer one")
    if (Date.now() - Date.parse(link.created_at) < 60_000)
      fail(
        429,
        "This link was sent moments ago — wait a minute before reminding",
      )
    const role =
      ctx.roles.find((r) => r.id === link.signoff_role_id) ??
      fail(404, "Signing link not found")
    const lines = roleLines(scope, role.id)
    if (!lines.some((l) => l.signState === "ready"))
      fail(409, nothingReady(role, lines))
    return publicLink(
      issue(scope, role, link.signer_email, link.reminder_count + 1),
      true,
    )
  })
  on("POST", "/sign-links/{link_id}/revoke", ({ params }) => {
    const link = linkById(num(params[0]))
    if (!ctx.canWrite(scopeOf(link).projectId))
      fail(403, "Not enough permissions")
    if (link.used_at)
      fail(409, "This link has already been used; its signatures stand")
    if (!link.revoked) {
      link.revoked = true
      link.revoked_at = stamp()
      link.revoked_reason = "withdrawn"
    }
    return publicLink(link)
  })

  // ── packs ──────────────────────────────────────────────────────────────
  const fingerprint = (scope: Scope) =>
    JSON.stringify(
      scope.docs.map((itp) => [
        itp.status,
        ctx
          .itemStates(itp.id)
          .map((s) => [
            s.item.status,
            s.item.notes,
            s.item.measured_value,
            s.item.conditions,
            s.photoCount,
          ]),
        ctx.signatures.filter((s) => s.project_itp_id === itp.id).length,
      ]),
    )
  const packsOf = (scope: Scope) =>
    packs
      .filter((p) =>
        scope.itp
          ? p.project_itp_id === scope.itp.id
          : p.area_id === scope.area?.id,
      )
      .sort((a, b) => b.version - a.version)
  const strip = ({ hash: _h, ...p }: PackRow, regenerated = false) => ({
    ...p,
    regenerated,
  })
  const ensurePack = (scope: Scope) => {
    const hash = fingerprint(scope)
    const [latest] = packsOf(scope)
    if (latest && latest.hash === hash) return strip(latest)
    const version = (latest?.version ?? 0) + 1
    const name = scope.area
      ? scope.area.name
      : (ctx.docNumber(scope.itp as Itp) ?? (scope.itp as Itp).title)
    const pack: PackRow = {
      id: nextId(packs),
      project_itp_id: scope.itp?.id ?? null,
      area_id: scope.area?.id ?? null,
      version,
      filename: `${name.replace(/[^\w]+/g, "-")}-sign-off-pack-v${version}.pdf`,
      file_size: 412_000 + version * 3_100,
      signature_count: ctx.signatures.filter((s) =>
        scope.docs.some((d) => d.id === s.project_itp_id),
      ).length,
      generated_by: me,
      created_at: stamp(),
      download_url: ctx.packUrl,
      regenerated: true,
      hash,
    }
    packs.push(pack)
    return strip(pack, true)
  }
  on("GET", "/itps/{itp_id}/packs", ({ params }) =>
    packsOf(itpScope(num(params[0]))).map((p) => strip(p)),
  )
  on("POST", "/itps/{itp_id}/packs", ({ params }) =>
    ensurePack(itpScope(num(params[0]))),
  )
  on("GET", "/areas/{area_id}/packs", ({ params }) =>
    packsOf(areaScope(num(params[0]))).map((p) => strip(p)),
  )
  on("POST", "/areas/{area_id}/packs", ({ params }) =>
    ensurePack(areaScope(num(params[0]))),
  )

  // ── witness / hold point notice ────────────────────────────────────────
  on("POST", "/itp-items/{item_id}/witness-notice", ({ params }) => {
    const itemId = num(params[0])
    let found: { itp: Itp; state: ItemState } | undefined
    for (const itp of ctx.itps) {
      const state = ctx.itemStates(itp.id).find((s) => s.item.id === itemId)
      if (state) found = { itp, state }
    }
    if (!found) return fail(404, "ITP item not found")
    const { itp, state } = found
    if (!ctx.canWrite(itp.project_id)) fail(403, "Not enough permissions")
    if (!["witness", "hold"].includes(state.item.classification))
      fail(422, "Notices are for witness and hold points only")
    if (itp.status === "voided" || itp.status === "complete")
      fail(409, `This ITP is ${itp.status}`)
    if (notices.some((n) => n.itemId === itemId && Date.now() - n.at < 60_000))
      fail(429, "A notice for this line was sent moments ago — wait a minute")
    const sentTo: string[] = []
    const skipped: string[] = []
    for (const rid of state.item.role_ids) {
      const role = ctx.roles.find((r) => r.id === rid)
      if (!role) continue
      if (role.signer_email) sentTo.push(role.signer_email)
      else
        skipped.push(
          `${role.role_name}: no signer email — add one under Sign-off roles`,
        )
    }
    if (!sentTo.length)
      fail(
        422,
        `No one to notify: ${skipped.join("; ") || "this line names no sign-off role"}`,
      )
    notices.push({ itemId, at: Date.now() })
    return { sent_to: sentTo, skipped }
  })

  // ── the no-account signing page ────────────────────────────────────────
  const GONE: Record<string, string> = {
    used: "This signing link has already been used. If there is more to sign, the project team will send a new link.",
    expired:
      "This signing link has expired. Ask the project team to send a new one.",
    revoked: "This signing link was withdrawn by the project team.",
    replaced:
      "This signing link was replaced by a newer one — use the most recent email you received.",
  }
  const openToken = (token: string) => {
    const link =
      links.find((l) => l.token === token) ??
      fail(
        404,
        "This signing link is not valid. Check that the whole link was copied.",
      )
    const status = statusOf(link)
    if (status !== "active") fail(410, GONE[status])
    return link
  }

  on("GET", "/sign/{token}", ({ params }) => {
    const link = openToken(decodeURIComponent(params[0]))
    const scope = scopeOf(link)
    const role =
      ctx.roles.find((r) => r.id === link.signoff_role_id) ??
      fail(404, "This signing link is not valid.")
    const lines = roleLines(scope, role.id)
    const byItem = new Map(lines.map((l) => [l.state.item.id, l]))
    const documents: SignDocument[] = scope.docs
      .filter((d) => d.status !== "voided")
      .map((itp) => ({
        itp_id: itp.id,
        doc_number: ctx.docNumber(itp),
        title: itp.title,
        status: itp.status,
        area_name: ctx.areas.find((a) => a.id === itp.area_id)?.name ?? null,
        lines: ctx.itemStates(itp.id).map((state, index): SignLine => {
          const { item } = state
          const rl = byItem.get(item.id)
          return {
            id: item.id,
            number: index + 1,
            section: item.section,
            requirement: item.requirement,
            classification: item.classification,
            status: item.status,
            result_label: ctx.resultLabel(item),
            measured_value: item.measured_value,
            value_unit: item.value_unit,
            out_of_tolerance: ctx.outOfTolerance(item),
            notes: item.notes,
            conditions: item.conditions,
            acceptance_criteria: item.acceptance_criteria,
            reference_doc: item.reference_doc,
            photo_count: state.photoCount,
            needs_you: Boolean(rl),
            sign_state: rl?.signState ?? null,
            waiting_reason: rl?.reason ?? null,
          }
        }),
      }))
    return {
      project_name: ctx.projectName(scope.projectId),
      project_client: ctx.projectClient(scope.projectId),
      project_location: ctx.projectLocation(scope.projectId),
      kind: scope.area ? "area" : "itp",
      area_name: scope.area?.name ?? null,
      role_name: role.role_name,
      party: role.party,
      signer_email: link.signer_email,
      expires_at: link.expires_at,
      documents,
      ready_count: lines.filter((l) => l.signState === "ready").length,
      waiting_count: lines.filter((l) => l.signState === "waiting").length,
      signed_count: lines.filter((l) => l.signState === "signed").length,
      pack_url: ctx.packUrl,
    }
  })

  on("POST", "/sign/{token}", ({ params, body }) => {
    if (body.confirm !== true)
      fail(422, "Tick the box to confirm you reviewed the lines")
    const png = String(body.signature_png ?? "")
    if (!png.startsWith("data:image/png;base64,"))
      fail(422, "The signature must be a PNG image")
    const name = String(body.signer_name ?? "").trim()
    if (!name) fail(422, "Enter your name")
    const link = openToken(decodeURIComponent(params[0]))
    const scope = scopeOf(link)
    const role =
      ctx.roles.find((r) => r.id === link.signoff_role_id) ??
      fail(404, "This signing link is not valid.")
    if (!roleLines(scope, role.id).some((l) => l.signState === "ready"))
      fail(
        409,
        "Nothing is ready for your signature yet. This link still works — come back when the project team tells you the work is ready.",
      )
    const signedAt = stamp()
    const sign = (itpId: number, itemId: number | null) => {
      ctx.signatures.push({
        id: nextId(ctx.signatures),
        project_itp_id: itpId,
        itp_item_id: itemId,
        signoff_role_id: role.id,
        role_name: role.role_name,
        party: role.party,
        signer_name: name,
        signer_email: link.signer_email,
        method: "external_link",
        signed_at: signedAt,
        gps_lat: (body.gps_lat as number | null) ?? null,
        gps_lng: (body.gps_lng as number | null) ?? null,
        weather: DEMO_WEATHER,
        signature_url: png,
      })
    }
    let signed = 0
    const touched = new Set<number>()
    for (let guard = 0; guard < 500; guard++) {
      const ready = roleLines(scope, role.id).filter(
        (l) => l.signState === "ready",
      )
      if (!ready.length) break
      for (const l of ready) {
        sign(l.itp.id, l.state.item.id)
        touched.add(l.itp.id)
        signed++
      }
    }
    for (const itpId of touched) sign(itpId, null)
    link.used_at = signedAt
    return {
      signed_lines: signed,
      documents: touched.size,
      signed_at: signedAt,
      weather: DEMO_WEATHER,
      still_waiting: roleLines(scope, role.id).filter(
        (l) => l.signState === "waiting",
      ).length,
    }
  })

  return {
    /** Seed a link with a known token (the demo's walk-through link). */
    seedLink(itpId: number, roleName: string, email: string, token: string) {
      const scope = itpScope(itpId)
      const role = ctx.roles.find(
        (r) => r.project_id === scope.projectId && r.role_name === roleName,
      )
      if (!role) throw new Error(`demo seed: no role ${roleName}`)
      const link = issue(scope, role, email, 0, token)
      link.created_at = new Date(Date.now() - 2 * DAY).toISOString()
    },
  }
}
