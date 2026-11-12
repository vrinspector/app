import { describe, expect, it } from "vitest"

import type { ItpImportDraft } from "@/client"
import { parseTemplateBody } from "./itp"
import { checkDraft, draftToBody, emptyLine, emptySection } from "./itpImport"

const draft = (): ItpImportDraft => ({
  name: "Pipe test",
  roles: [
    { name: "Contractor", party: "contractor" },
    { name: "Owner's representative", party: "client" },
  ],
  sections: [
    {
      title: "Before the test",
      lines: [
        {
          title: "Test pressure held",
          classification: "H",
          roles: ["Owner's representative"],
          acceptance_criteria: "  No drop   over 10 min ",
          photo_required: true,
        },
        { title: "Test pressure held", classification: "W" },
        {
          title: "Gauge reading",
          classification: "I",
          value_type: "number",
          unit: "psi",
        },
      ],
    },
    { title: "", lines: [] },
  ],
  notes: [],
})

describe("ITP import draft (increment 16)", () => {
  it("turns a draft into a valid template body", () => {
    const body = draftToBody(draft(), "Pipe test")
    expect(body.importedWithAi).toBe(true)
    const pages = body.pages as {
      name: string
      title: string
      elements: Record<string, unknown>[]
    }[]
    expect(pages).toHaveLength(1) // empty sections dropped
    expect(pages[0].elements.map((e) => e.name)).toEqual([
      "test-pressure-held",
      "test-pressure-held-2",
      "gauge-reading",
    ])
    expect(pages[0].elements[0]).toMatchObject({
      type: "radiogroup",
      classification: "hold",
      signoffRoles: ["Owner's representative"],
      acceptanceCriteria: "No drop over 10 min",
      photoRequired: true,
    })
    expect(pages[0].elements[2]).toMatchObject({
      type: "text",
      inputType: "number",
      unit: "psi",
    })
    const parsed = parseTemplateBody(body)
    expect(parsed.items).toHaveLength(3)
    expect(parsed.holdCount).toBe(1)
  })

  it("says what still stops saving", () => {
    expect(checkDraft(draft(), "Pipe test")).toEqual({
      ok: true,
      lines: 3,
      holds: 1,
      roles: 2,
    })
    expect(checkDraft(draft(), " ")).toMatchObject({ ok: false })

    const noSigner = draft()
    noSigner.sections![0].lines![0].roles = []
    expect(checkDraft(noSigner, "x")).toEqual({
      ok: false,
      error:
        "Hold point “Test pressure held” needs someone to release it — tick a role.",
    })

    const unknownRole = draft()
    unknownRole.sections![0].lines![1].roles = ["Engineer"]
    expect(checkDraft(unknownRole, "x")).toMatchObject({ ok: false })

    const blank = draft()
    blank.sections![0].lines!.push(emptyLine())
    expect(checkDraft(blank, "x")).toEqual({
      ok: false,
      error: "Line 4 needs a description.",
    })

    const twice = draft()
    twice.roles!.push({ name: "contractor", party: "contractor" })
    expect(checkDraft(twice, "x")).toMatchObject({ ok: false })

    expect(
      checkDraft({ ...draft(), sections: [{ title: "A", lines: [] }] }, "x"),
    ).toEqual({ ok: false, error: "Keep at least one line." })
    expect(emptySection().lines).toHaveLength(1)
  })
})
