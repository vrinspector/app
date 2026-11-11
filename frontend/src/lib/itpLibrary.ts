/*
 * Starter ITP template library (increment 13.7; aligned with the owner's
 * field guide and commissioning guide in 13.9 — sources and the known-errors
 * list in `docs/reference/`).
 *
 * `itpLibrary.json` is a copy of the API's
 * `backend/app/itp-library.json` (a backend test fails if they drift). The
 * API seeds these masters into every new account; this copy feeds the
 * "Start from" picker in the template editor and the demo build.
 *
 * Every line carries a measurable acceptance criterion, a reference, the
 * record required and an H / W / R / I code. Where a number is set by the
 * project rather than the code, the criterion says so:
 * "Project-specific value required — verify before issue".
 */

import library from "./itpLibrary.json"

export interface StarterTemplate {
  key: string
  name: string
  description: string
  body: Record<string, unknown>
}

export const STARTER_LIBRARY: StarterTemplate[] =
  library.templates as StarterTemplate[]

export const PROJECT_SPECIFIC =
  "Project-specific value required — verify before issue."

export function starterTemplate(key: string): StarterTemplate {
  const found = STARTER_LIBRARY.find((t) => t.key === key)
  if (!found) throw new Error(`No starter template “${key}”`)
  return found
}

/**
 * The outline a template written from scratch starts from: one section, one
 * line showing where every field goes, and the three default roles.
 */
export const BLANK_TEMPLATE = {
  title: "",
  signoffRoles: [
    { name: "Contractor", party: "contractor" },
    { name: "Owner's representative", party: "client" },
    { name: "Third-party inspector", party: "engineer" },
  ],
  pages: [
    {
      name: "section-1",
      title: "1 Section title",
      elements: [
        {
          type: "radiogroup",
          name: "line-1",
          title: "What is checked",
          choices: ["Pass", "Fail", "N/A"],
          classification: "hold",
          signoffRoles: ["Contractor", "Owner's representative"],
          acceptanceCriteria: `The measurable condition that makes this line pass. ${PROJECT_SPECIFIC}`,
          reference: "Drawing, specification section or standard",
          recordRequired: "What is kept as evidence",
          photoRequired: true,
        },
      ],
    },
  ],
}
