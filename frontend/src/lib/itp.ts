/*
 * Block 9.5 ITPs (increment 13): vocabularies and a reader for SurveyJS
 * template bodies. The starter library (increment 13.7) is in `itpLibrary.ts`.
 *
 * `parseTemplateBody` is a line-for-line port of the API's
 * `app/core/itp.py::parse_template_body`, so the template editor can show
 * "5 lines, 1 hold point" (or the exact problem) while the JSON is typed, and
 * the demo build can import a template the way the API does. The API stays
 * the authority: it re-checks every body it is sent.
 */

import type { StatusTone } from "@/components/Common/StatusBadge"

export type Classification = "hold" | "witness" | "review" | "information"
export type ValueType = "number" | "text"
export type ItemStatus = "pending" | "pass" | "fail" | "na"
export type AreaType = "level" | "lot" | "stage" | "chainage" | "other"
export type ItpStatus = "not_started" | "in_progress" | "complete" | "voided"
export type Party = "contractor" | "client" | "engineer"
export type PhotoSet = "three_shot"
export type ShotSlot = "context" | "intermediate" | "closeup"

/*
 * Increment 13.8 — the three-shot photo set (owner's field guide Ch. 10):
 * one wide shot that says where, one that shows the element in its
 * surroundings, one tight shot with a scale in frame. A line asking for the
 * set is evidenced only when every slot has a photo.
 */
export const THREE_SHOT_SLOTS: {
  value: ShotSlot
  label: string
  hint: string
}[] = [
  {
    value: "context",
    label: "Context",
    hint: "Wide shot that shows where this is — gridlines, a landmark, the whole element.",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    hint: "The element and what is around it, close enough to see the work.",
  },
  {
    value: "closeup",
    label: "Close-up with scale",
    hint: "Tight on the detail with a tape, ruler or scale card in the frame.",
  },
]

export function shotLabel(slot: string | null | undefined): string | null {
  return THREE_SHOT_SLOTS.find((s) => s.value === slot)?.label ?? null
}

/** What photo evidence a line still lacks, in words; null when it has it. */
export function evidenceGap(item: {
  photo_required?: boolean
  photo_count?: number
  photo_set?: string | null
  shot_slots?: string[]
}): string | null {
  if (item.photo_set === "three_shot") {
    const have = new Set(item.shot_slots ?? [])
    const missing = THREE_SHOT_SLOTS.filter((s) => !have.has(s.value))
    return missing.length
      ? `Three-shot set: still missing ${missing.map((s) => s.label).join(", ")}`
      : null
  }
  if (item.photo_required && !item.photo_count) return "Photo required"
  return null
}

/** The project code ITP numbers use while an owner has not set one. */
export function derivedProjectCode(name: string, id: number): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? []
  let code =
    words.length >= 2
      ? words
          .map((w) => w[0])
          .join("")
          .slice(0, 6)
      : (words[0] ?? "").slice(0, 4)
  code = code.toUpperCase()
  return code.length < 2 ? `P${id}` : code
}

/** Mirrors `normalise_project_code`: "" → null, else upper-case, hyphens. */
export function normaliseProjectCode(raw: string): {
  code: string | null
  error: string | null
} {
  const code = raw
    .trim()
    .replace(/[\s_]+/g, "-")
    .toUpperCase()
  if (!code) return { code: null, error: null }
  if (code.length > 20) {
    return { code, error: "At most 20 characters" }
  }
  if (!/^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/.test(code)) {
    return {
      code,
      error:
        "Letters, digits and hyphens only; start and end with a letter or digit",
    }
  }
  return { code, error: null }
}

export function itpDocNumber(code: string, seq: number): string {
  return `ITP-${code}-${String(seq).padStart(3, "0")}`
}

export const CLASSIFICATIONS: Record<
  Classification,
  { label: string; short: string; tone: StatusTone; help: string }
> = {
  hold: {
    label: "Hold point",
    short: "H",
    tone: "critical",
    help: "Work stops here until every required role has signed.",
  },
  witness: {
    label: "Witness point",
    short: "W",
    tone: "attention",
    help: "The named party is notified and may attend; work may continue.",
  },
  review: {
    label: "Review",
    short: "R",
    tone: "settled",
    help: "A document or record is reviewed and accepted.",
  },
  information: {
    label: "Information",
    short: "I",
    tone: "neutral",
    help: "Checked and noted by the inspector; no one is held up.",
  },
}

/** Words used before increment 13.6, still read in template bodies. */
const LEGACY_CLASSIFICATIONS: Record<string, Classification> = {
  surveillance: "information",
  record: "review",
}
const CLASSIFICATION_LETTERS: Record<string, Classification> = {
  h: "hold",
  w: "witness",
  r: "review",
  i: "information",
}

/** hold / witness / review / information, H / W / R / I or an old word. */
export function normaliseClassification(value: unknown): Classification | null {
  if (typeof value !== "string") return null
  let key = value.trim().toLowerCase()
  key = CLASSIFICATION_LETTERS[key] ?? key
  key = LEGACY_CLASSIFICATIONS[key] ?? key
  return key in CLASSIFICATIONS ? (key as Classification) : null
}

export const CLASSIFICATION_VALUES = Object.keys(
  CLASSIFICATIONS,
) as Classification[]

export function classificationInfo(value: string | null | undefined) {
  return (
    CLASSIFICATIONS[normaliseClassification(value) ?? "information"] ??
    CLASSIFICATIONS.information
  )
}

/** Field-first result buttons: large, three choices, as on paper ITPs. */
export const ITEM_RESULTS: {
  value: Exclude<ItemStatus, "pending">
  label: string
  tone: StatusTone
}[] = [
  { value: "pass", label: "Pass", tone: "positive" },
  { value: "fail", label: "Fail", tone: "critical" },
  { value: "na", label: "N/A", tone: "neutral" },
]

export const AREA_TYPE_OPTIONS: { value: AreaType; label: string }[] = [
  { value: "level", label: "Level" },
  { value: "lot", label: "Lot" },
  { value: "stage", label: "Stage" },
  { value: "chainage", label: "Chainage" },
  { value: "other", label: "Other" },
]

/*
 * The stored party words stay contractor / client / engineer; owner review
 * 2026-11-10 named the parties as US projects do.
 */
export const PARTY_OPTIONS: { value: Party; label: string }[] = [
  { value: "contractor", label: "Contractor" },
  { value: "client", label: "Owner's representative" },
  { value: "engineer", label: "Third-party inspector" },
]

export function partyLabel(value: string): string {
  return PARTY_OPTIONS.find((p) => p.value === value)?.label ?? value
}

/** The three roles a project starts from (`POST …/signoff-roles/defaults`). */
export const DEFAULT_ROLES: ParsedRole[] = [
  { name: "Contractor", party: "contractor" },
  { name: "Owner's representative", party: "client" },
  { name: "Third-party inspector", party: "engineer" },
]
const DEFAULT_PARTIES = new Map(
  DEFAULT_ROLES.map((r) => [r.name.toLowerCase(), r.party]),
)
const defaultParty = (name: string): Party =>
  DEFAULT_PARTIES.get(name.toLowerCase()) ?? "contractor"

/** Common US customary units for measured values. */
export const US_UNITS = ["in", "ft", "psi", "°F", "%", "pcf", "yd³", "lb"]

/** "2.5 in", or the bare value when the line has no unit. */
export function formatMeasured(
  value: string | null | undefined,
  unit: string | null | undefined,
): string {
  if (!value) return ""
  return unit ? `${value} ${unit}` : value
}

/** "1.5–3 in", "≥ 1.5 in", "≤ 3 in", or "" when the line has no limits. */
export function toleranceLabel(
  min: number | null | undefined,
  max: number | null | undefined,
  unit: string | null | undefined,
): string {
  const u = unit ? ` ${unit}` : ""
  if (min != null && max != null) return `${min}–${max}${u}`
  if (min != null) return `≥ ${min}${u}`
  if (max != null) return `≤ ${max}${u}`
  return ""
}

export const ITP_STATUS_TONE: Record<string, StatusTone> = {
  not_started: "neutral",
  in_progress: "attention",
  complete: "positive",
  voided: "settled",
}

export function itemStatusLabel(value: string): string {
  if (value === "na") return "N/A"
  if (value === "pending") return "To record"
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function percent(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0
}

// ── Template bodies ─────────────────────────────────────────────────────────

const LAYOUT_TYPES = new Set(["html", "image", "expression"])
const CONTAINER_TYPES = new Set(["panel", "paneldynamic"])
const PARTIES = new Set<string>(["contractor", "client", "engineer"])
export const MAX_TEMPLATE_ITEMS = 500

export interface ParsedRole {
  name: string
  party: Party
}

export interface ParsedItem {
  section: string | null
  elementName: string
  requirement: string
  classification: Classification
  roles: string[]
  acceptanceCriteria: string | null
  reference: string | null
  recordRequired: string | null
  photoRequired: boolean
  photoSet: PhotoSet | null
  valueType: ValueType | null
  unit: string | null
  min: number | null
  max: number | null
}

export interface ParsedTemplate {
  title: string | null
  roles: ParsedRole[]
  items: ParsedItem[]
  holdCount: number
}

export class TemplateError extends Error {}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (isObject(value)) {
    for (const key of ["default", "en"]) {
      const v = value[key]
      if (typeof v === "string" && v.trim()) return v.trim()
    }
  }
  return null
}

function readRoles(raw: unknown): ParsedRole[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    throw new TemplateError("signoffRoles must be a list of {name, party}")
  }
  const seen = new Set<string>()
  return raw.map((entry) => {
    let name: string
    let party: string
    if (typeof entry === "string") {
      name = entry.trim()
      party = defaultParty(name)
    } else if (isObject(entry)) {
      name = text(entry.name) ?? ""
      party = String(entry.party || defaultParty(name))
    } else {
      throw new TemplateError("signoffRoles must be a list of {name, party}")
    }
    if (!name) throw new TemplateError("Every sign-off role needs a name")
    if (name.length > 255) {
      throw new TemplateError(`Role name is too long: ${name.slice(0, 40)}…`)
    }
    if (!PARTIES.has(party)) {
      throw new TemplateError(
        `Role “${name}” has party “${party}”; use one of contractor, client, engineer`,
      )
    }
    const key = name.toLowerCase()
    if (seen.has(key)) throw new TemplateError(`Role “${name}” is listed twice`)
    seen.add(key)
    return { name, party: party as Party }
  })
}

function* walk(
  elements: unknown,
  section: string | null,
): Generator<[string | null, Json]> {
  if (elements === undefined || elements === null) return
  if (!Array.isArray(elements))
    throw new TemplateError("elements must be a list")
  for (const element of elements) {
    if (!isObject(element)) {
      throw new TemplateError("Every element must be an object")
    }
    const kind = String(element.type ?? "")
    if (CONTAINER_TYPES.has(kind)) {
      yield* walk(
        element.elements ?? element.templateElements,
        text(element.title) ?? section,
      )
    } else if (!LAYOUT_TYPES.has(kind)) {
      yield [section, element]
    }
  }
}

function readNumber(element: Json, key: string, label: string): number | null {
  const raw = element[key]
  if (raw === undefined || raw === null || raw === "") return null
  const value = typeof raw === "boolean" ? Number.NaN : Number(raw)
  if (!Number.isFinite(value)) {
    throw new TemplateError(`“${label}”: ${key} must be a number`)
  }
  return value
}

function readShort(
  element: Json,
  key: string,
  label: string,
  limit: number,
): string | null {
  const value = text(element[key])
  if (value !== null && value.length > limit) {
    throw new TemplateError(
      `“${label}”: ${key} is longer than ${limit} characters`,
    )
  }
  return value
}

function readValueType(element: Json, label: string): ValueType | null {
  const raw = element.valueType
  if (raw !== undefined && raw !== null) {
    const kind = typeof raw === "string" ? raw.trim().toLowerCase() : ""
    if (!["number", "text", "none"].includes(kind)) {
      throw new TemplateError(
        `“${label}”: valueType must be number, text or none`,
      )
    }
    return kind === "none" ? null : (kind as ValueType)
  }
  if (element.type === "text") {
    return element.inputType === "number" ? "number" : "text"
  }
  if (element.type === "comment") return "text"
  return null
}

/** Increment 13.8; a port of `app/core/itp.py::_photo_set`. */
function readPhotoSet(element: Json, label: string): PhotoSet | null {
  const raw = element.photoSet
  if (raw === undefined || raw === null || raw === false) return null
  let kind =
    typeof raw === "string"
      ? raw.trim().replace(/[-\s]/g, "_").toLowerCase()
      : null
  if (kind === "threeshot") kind = "three_shot"
  if (kind === "" || kind === "none") return null
  if (kind !== "three_shot") {
    throw new TemplateError(`“${label}”: photoSet must be three_shot or none`)
  }
  return kind
}

/** Increment 13.6 line evidence; a port of `app/core/itp.py::_evidence`. */
function readEvidence(element: Json, label: string) {
  const photo = element.photoRequired ?? false
  if (typeof photo !== "boolean") {
    throw new TemplateError(`“${label}”: photoRequired must be true or false`)
  }
  const photoSet = readPhotoSet(element, label)
  const valueType = readValueType(element, label)
  const min = readNumber(element, "min", label)
  const max = readNumber(element, "max", label)
  if (min !== null && max !== null && min > max) {
    throw new TemplateError(`“${label}”: min is greater than max`)
  }
  return {
    acceptanceCriteria: text(element.acceptanceCriteria),
    reference: readShort(element, "reference", label, 255),
    recordRequired: text(element.recordRequired),
    photoRequired: photo,
    photoSet,
    valueType,
    unit: valueType ? readShort(element, "unit", label, 40) : null,
    min: valueType === "number" ? min : null,
    max: valueType === "number" ? max : null,
  }
}

export function parseTemplateBody(body: unknown): ParsedTemplate {
  if (!isObject(body))
    throw new TemplateError("The template must be a JSON object")
  let pages = body.pages
  if (pages === undefined && "elements" in body) {
    pages = [{ elements: body.elements }]
  }
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new TemplateError("The template needs at least one page of questions")
  }
  const roles = readRoles(body.signoffRoles)
  const declared = new Set(roles.map((r) => r.name.toLowerCase()))
  const names = new Set<string>()
  const problems: string[] = []
  const items: ParsedItem[] = []

  for (const page of pages) {
    if (!isObject(page)) throw new TemplateError("Every page must be an object")
    const pageSection = text(page.title) ?? text(page.name)
    for (const [section, element] of walk(page.elements, pageSection)) {
      const name = text(element.name)
      if (!name) throw new TemplateError("Every question needs a name")
      if (names.has(name)) {
        throw new TemplateError(`Question name “${name}” is used twice`)
      }
      names.add(name)
      const label = text(element.title) ?? name
      const classification = normaliseClassification(element.classification)
      if (classification === null) {
        problems.push(label)
        continue
      }
      let rawRoles = element.signoffRoles ?? []
      if (typeof rawRoles === "string") rawRoles = [rawRoles]
      if (
        !Array.isArray(rawRoles) ||
        !rawRoles.every((r) => typeof r === "string" && r.trim())
      ) {
        throw new TemplateError(
          `“${label}”: signoffRoles must be a list of role names`,
        )
      }
      const itemRoles = [
        ...new Set((rawRoles as string[]).map((r) => r.trim())),
      ]
      for (const role of itemRoles) {
        if (declared.size && !declared.has(role.toLowerCase())) {
          throw new TemplateError(
            `“${label}” needs role “${role}”, which is not in the template's signoffRoles list`,
          )
        }
      }
      if (classification === "hold" && itemRoles.length === 0) {
        throw new TemplateError(
          `Hold point “${label}” needs at least one sign-off role`,
        )
      }
      items.push({
        section: section ? section.slice(0, 255) : null,
        elementName: name.slice(0, 255),
        requirement: label,
        classification,
        roles: itemRoles,
        ...readEvidence(element, label),
      })
    }
  }

  if (problems.length) {
    const shown = problems
      .slice(0, 5)
      .map((p) => `“${p}”`)
      .join(", ")
    const more = problems.length > 5 ? ` and ${problems.length - 5} more` : ""
    throw new TemplateError(
      `Every question needs a classification (hold, witness, review or information). Missing on ${shown}${more}`,
    )
  }
  if (items.length === 0)
    throw new TemplateError("The template has no questions")
  if (items.length > MAX_TEMPLATE_ITEMS) {
    throw new TemplateError(
      `A template can have at most ${MAX_TEMPLATE_ITEMS} questions`,
    )
  }
  const known = new Set(roles.map((r) => r.name.toLowerCase()))
  for (const item of items) {
    for (const role of item.roles) {
      if (!known.has(role.toLowerCase())) {
        known.add(role.toLowerCase())
        roles.push({ name: role, party: defaultParty(role) })
      }
    }
  }
  return {
    title: text(body.title),
    roles,
    items,
    holdCount: items.filter((i) => i.classification === "hold").length,
  }
}

/** Parse a JSON string the user typed; the error message is user-facing. */
export function checkTemplateText(
  source: string,
):
  | { ok: true; body: Json; parsed: ParsedTemplate }
  | { ok: false; error: string } {
  let body: unknown
  try {
    body = JSON.parse(source)
  } catch (error) {
    return {
      ok: false,
      error: `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  try {
    return { ok: true, body: body as Json, parsed: parseTemplateBody(body) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
