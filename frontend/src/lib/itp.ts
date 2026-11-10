/*
 * Block 9.5 ITPs (increment 13): vocabularies, the starter template, and a
 * reader for SurveyJS template bodies.
 *
 * `parseTemplateBody` is a line-for-line port of the API's
 * `app/core/itp.py::parse_template_body`, so the template editor can show
 * "5 lines, 1 hold point" (or the exact problem) while the JSON is typed, and
 * the demo build can import a template the way the API does. The API stays
 * the authority: it re-checks every body it is sent.
 */

import type { StatusTone } from "@/components/Common/StatusBadge"

export type Classification = "hold" | "witness" | "surveillance" | "record"
export type ItemStatus = "pending" | "pass" | "fail" | "na"
export type AreaType = "level" | "lot" | "stage" | "chainage" | "other"
export type ItpStatus = "not_started" | "in_progress" | "complete" | "voided"
export type Party = "contractor" | "client" | "engineer"

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
  surveillance: {
    label: "Surveillance",
    short: "S",
    tone: "neutral",
    help: "Checked by the inspector during the work.",
  },
  record: {
    label: "Record",
    short: "R",
    tone: "settled",
    help: "A result or document is recorded.",
  },
}

export const CLASSIFICATION_VALUES = Object.keys(
  CLASSIFICATIONS,
) as Classification[]

export function classificationInfo(value: string | null | undefined) {
  return (
    CLASSIFICATIONS[(value as Classification) ?? "record"] ??
    CLASSIFICATIONS.record
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

export const PARTY_OPTIONS: { value: Party; label: string }[] = [
  { value: "contractor", label: "Contractor" },
  { value: "client", label: "Client" },
  { value: "engineer", label: "Engineer" },
]

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
      party = "contractor"
    } else if (isObject(entry)) {
      name = text(entry.name) ?? ""
      party = String(entry.party || "contractor")
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
      const classification = element.classification
      if (
        typeof classification !== "string" ||
        !CLASSIFICATION_VALUES.includes(classification as Classification)
      ) {
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
        classification: classification as Classification,
        roles: itemRoles,
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
      `Every question needs a classification (hold, witness, surveillance or record). Missing on ${shown}${more}`,
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
        roles.push({ name: role, party: "contractor" })
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

/**
 * The template a new master starts from: a short concrete-pour ITP that
 * shows every feature (pages as sections, a panel, all four
 * classifications, a hold point that two roles release).
 */
export const STARTER_TEMPLATE = {
  title: "Concrete pour",
  signoffRoles: [
    { name: "Site engineer", party: "contractor" },
    { name: "Client engineer", party: "client" },
  ],
  pages: [
    {
      name: "pre-pour",
      title: "Pre-pour",
      elements: [
        {
          type: "radiogroup",
          name: "formwork",
          title: "Formwork set out and checked against drawings",
          choices: ["Pass", "Fail", "N/A"],
          classification: "surveillance",
        },
        {
          type: "radiogroup",
          name: "rebar",
          title: "Reinforcement inspected before pour",
          choices: ["Pass", "Fail", "N/A"],
          classification: "hold",
          signoffRoles: ["Site engineer", "Client engineer"],
        },
        {
          type: "text",
          name: "cover",
          title: "Cover to reinforcement (mm)",
          inputType: "number",
          classification: "record",
        },
      ],
    },
    {
      name: "pour",
      title: "Pour",
      elements: [
        {
          type: "radiogroup",
          name: "pour",
          title: "Pour witnessed",
          choices: ["Pass", "Fail", "N/A"],
          classification: "witness",
          signoffRoles: ["Client engineer"],
        },
        {
          type: "text",
          name: "cylinders",
          title: "Test cylinders taken (count)",
          inputType: "number",
          classification: "record",
        },
      ],
    },
  ],
}
