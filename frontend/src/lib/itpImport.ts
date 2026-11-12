import type {
  ImportLine,
  ImportRole,
  ImportSection,
  ItpImportDraft,
} from "@/client"
import { type Classification, parseTemplateBody, TemplateError } from "./itp"

/*
 * ITP import (increment 16; PRD v2.63 Block 10E).
 *
 * The server reads an uploaded ITP (PDF, spreadsheet or photos) into a draft
 * of sections and lines; the review form edits that draft, and "Save as
 * master template" sends it back. The server turns it into the template body
 * (`app/core/itp_import.py: draft_to_body`) — `draftToBody` here is the same
 * conversion, used to check the draft with the template rules as it is
 * edited (and by the clickable demo, which has no server).
 */

export type Letter = "H" | "W" | "R" | "I"
export type DraftValueType = "none" | "number" | "text"

export const LETTER_WORDS: Record<Letter, Classification> = {
  H: "hold",
  W: "witness",
  R: "review",
  I: "information",
}

export const LETTER_OPTIONS: { value: Letter; label: string }[] = [
  { value: "H", label: "H — Hold point" },
  { value: "W", label: "W — Witness point" },
  { value: "R", label: "R — Review" },
  { value: "I", label: "I — Information" },
]

export const VALUE_OPTIONS: { value: DraftValueType; label: string }[] = [
  { value: "none", label: "Pass / Fail / N/A" },
  { value: "number", label: "Measured number" },
  { value: "text", label: "Text reading" },
]

export function emptyLine(): ImportLine {
  return {
    title: "",
    classification: "I",
    acceptance_criteria: null,
    reference: null,
    record_required: null,
    roles: [],
    photo_required: false,
    value_type: "none",
    unit: null,
  }
}

export function emptySection(): ImportSection {
  return { title: "", lines: [emptyLine()] }
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "line"

const clean = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim()

/** The master template body for a draft (mirrors the server's conversion). */
export function draftToBody(
  draft: ItpImportDraft,
  name: string,
): Record<string, unknown> {
  const used = new Set<string>()
  const unique = (base: string) => {
    let candidate = base
    let n = 2
    while (used.has(candidate)) {
      candidate = `${base}-${n}`
      n += 1
    }
    used.add(candidate)
    return candidate
  }
  const sections = (draft.sections ?? []).filter((s) => s.lines?.length)
  const pages = sections.map((section, index) => {
    const elements = (section.lines ?? []).map((line) => {
      const title = clean(line.title)
      const valueType = (line.value_type ?? "none") as DraftValueType
      const element: Record<string, unknown> =
        valueType === "number"
          ? { type: "text", inputType: "number" }
          : valueType === "text"
            ? { type: "text" }
            : { type: "radiogroup", choices: ["Pass", "Fail", "N/A"] }
      element.name = unique(slug(title))
      element.title = title
      element.classification =
        LETTER_WORDS[(line.classification ?? "I") as Letter] ?? "information"
      if (line.roles?.length) element.signoffRoles = [...line.roles]
      if (clean(line.acceptance_criteria))
        element.acceptanceCriteria = clean(line.acceptance_criteria)
      if (clean(line.reference)) element.reference = clean(line.reference)
      if (clean(line.record_required))
        element.recordRequired = clean(line.record_required)
      if (line.photo_required) element.photoRequired = true
      if (valueType !== "none" && clean(line.unit))
        element.unit = clean(line.unit)
      return element
    })
    return {
      name: unique(`section-${index + 1}`),
      title: clean(section.title) || `Section ${index + 1}`,
      elements,
    }
  })
  return {
    title: name,
    importedWithAi: true,
    signoffRoles: (draft.roles ?? []).map((r: ImportRole) => ({
      name: clean(r.name),
      party: r.party ?? "contractor",
    })),
    pages,
  }
}

export type DraftCheck =
  | { ok: true; lines: number; holds: number; roles: number }
  | { ok: false; error: string }

/** What still stops the draft being saved, in words for the form. */
export function checkDraft(draft: ItpImportDraft, name: string): DraftCheck {
  if (!clean(name)) return { ok: false, error: "Give the template a name." }
  const roles = (draft.roles ?? []).map((r) => clean(r.name))
  if (roles.some((r) => !r))
    return { ok: false, error: "Every sign-off role needs a name." }
  const lower = roles.map((r) => r.toLowerCase())
  if (new Set(lower).size !== lower.length)
    return { ok: false, error: "A sign-off role is listed twice." }
  let lines = 0
  for (const section of draft.sections ?? []) {
    for (const line of section.lines ?? []) {
      lines += 1
      const title = clean(line.title)
      if (!title)
        return { ok: false, error: `Line ${lines} needs a description.` }
      for (const role of line.roles ?? []) {
        if (!lower.includes(role.toLowerCase())) {
          return {
            ok: false,
            error: `“${title}” is signed by “${role}”, which isn't in the roles list.`,
          }
        }
      }
      if (line.classification === "H" && !line.roles?.length) {
        return {
          ok: false,
          error: `Hold point “${title}” needs someone to release it — tick a role.`,
        }
      }
    }
  }
  if (lines === 0) return { ok: false, error: "Keep at least one line." }
  try {
    const parsed = parseTemplateBody(draftToBody(draft, clean(name)))
    return {
      ok: true,
      lines: parsed.items.length,
      holds: parsed.holdCount,
      roles: parsed.roles.length,
    }
  } catch (error) {
    if (error instanceof TemplateError)
      return { ok: false, error: error.message }
    throw error
  }
}

/** Accepted upload types for the file picker. */
export const IMPORT_ACCEPT =
  ".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/*"
