import { describe, expect, it } from "vitest"

import {
  checkTemplateText,
  derivedProjectCode,
  evidenceGap,
  itpDocNumber,
  normaliseProjectCode,
  parseTemplateBody,
  percent,
  releaseChoice,
  releaseResults,
  TemplateError,
} from "./itp"
import { BLANK_TEMPLATE, starterTemplate } from "./itpLibrary"

describe("ITP template bodies (mirror of the API's parser)", () => {
  it("reads the concrete starter into lines, sections and roles", () => {
    const parsed = parseTemplateBody(
      starterTemplate("cast-in-place-concrete").body,
    )
    expect(parsed.items).toHaveLength(48)
    expect(parsed.holdCount).toBe(7)
    expect([...new Set(parsed.items.map((i) => i.section))]).toEqual([
      "1 Before work",
      "2 Formwork and shoring",
      "3 Reinforcement (hold points)",
      "4 Embedded items",
      "5 Concrete mix and delivery readiness",
      "6 Documentation and pre-pour release",
      "7 During pour — test set",
      "8 Post-pour — curing and protection",
    ])
    expect(parsed.roles).toEqual([
      { name: "Contractor", party: "contractor" },
      { name: "Owner's representative", party: "client" },
      { name: "Third-party inspector", party: "engineer" },
    ])
    const cover = parsed.items.find((i) => i.elementName === "concrete-cover")
    expect(cover).toMatchObject({
      classification: "hold",
      photoRequired: true,
      valueType: "number",
      unit: "in",
      roles: ["Third-party inspector"],
    })
    expect(cover?.reference).toMatch(/^Field guide Checklist A-1 item 8;/)
    const curing = parsed.items.find((i) => i.elementName === "cylinder-curing")
    expect(curing).toMatchObject({ valueType: "number", min: 60, max: 80 })
  })

  it("reads resultScale like the API", () => {
    const body = (extra: Record<string, unknown>) => ({
      elements: [
        { type: "radiogroup", name: "a", classification: "H", ...extra },
      ],
    })
    const roles = { signoffRoles: ["Contractor"] }
    const read = (extra: Record<string, unknown>) =>
      parseTemplateBody(body({ ...roles, ...extra })).items[0]
    expect(read({ resultScale: " Release " })).toMatchObject({
      resultScale: "release",
      approvedLabel: null,
    })
    expect(
      read({ resultScale: "release", approvedLabel: "Approved to pour" })
        .approvedLabel,
    ).toBe("Approved to pour")
    expect(read({ resultScale: "none" }).resultScale).toBeNull()
    expect(() => read({ resultScale: "approve" })).toThrow(/resultScale/)
    expect(() => read({ approvedLabel: "Go" })).toThrow(/approvedLabel needs/)
  })

  it("names a release line's result", () => {
    expect(releaseChoice({ status: "pass", conditions: null })).toBe("approved")
    expect(releaseChoice({ status: "pass", conditions: "1. Tie bars" })).toBe(
      "conditional",
    )
    expect(releaseChoice({ status: "fail" })).toBe("rejected")
    expect(releaseChoice({ status: "pending" })).toBeNull()
    expect(releaseResults("Approved to pour").map((r) => r.label)).toEqual([
      "Approved to pour",
      "Approved with conditions",
      "Rejected",
    ])
    expect(releaseResults(null)[0].label).toBe("Approved")
  })

  it("reads the old words and the H / W / R / I letters", () => {
    const parsed = parseTemplateBody({
      elements: [
        { type: "boolean", name: "a", classification: "surveillance" },
        { type: "boolean", name: "b", classification: "record" },
        { type: "boolean", name: "c", classification: "W" },
        { type: "comment", name: "d", classification: "i" },
      ],
    })
    expect(parsed.items.map((i) => i.classification)).toEqual([
      "information",
      "review",
      "witness",
      "information",
    ])
    expect(parsed.items[3].valueType).toBe("text")
  })

  it("refuses bad evidence properties with a reason", () => {
    const q = (extra: Record<string, unknown>) => ({
      elements: [
        { type: "text", name: "a", classification: "review", ...extra },
      ],
    })
    expect(() => parseTemplateBody(q({ photoRequired: "yes" }))).toThrow(
      /photoRequired must be true or false/,
    )
    expect(() => parseTemplateBody(q({ valueType: "date" }))).toThrow(
      /valueType must be/,
    )
    expect(() => parseTemplateBody(q({ min: 5, max: 1 }))).toThrow(
      /min is greater than max/,
    )
    expect(() => parseTemplateBody(q({ min: "low" }))).toThrow(
      /min must be a number/,
    )
  })

  it("uses panel titles as sections, skips layout elements, adds undeclared roles", () => {
    const parsed = parseTemplateBody({
      elements: [
        { type: "html", name: "intro" },
        {
          type: "panel",
          title: "Footings",
          elements: [
            {
              type: "boolean",
              name: "a",
              title: { default: "Check A" },
              classification: "hold",
              signoffRoles: "Surveyor",
            },
          ],
        },
      ],
    })
    expect(parsed.items[0]).toMatchObject({
      section: "Footings",
      requirement: "Check A",
      roles: ["Surveyor"],
    })
    expect(parsed.roles).toEqual([{ name: "Surveyor", party: "contractor" }])
  })

  it.each([
    [[], "JSON object"],
    [{ pages: [] }, "at least one page"],
    [
      { pages: [{ elements: [{ type: "text", name: "a" }] }] },
      "classification",
    ],
    [
      {
        pages: [
          { elements: [{ type: "text", name: "a", classification: "hold" }] },
        ],
      },
      "at least one sign-off role",
    ],
    [
      {
        signoffRoles: [{ name: "A", party: "nobody" }],
        pages: [
          { elements: [{ type: "text", name: "a", classification: "record" }] },
        ],
      },
      "party",
    ],
  ])("refuses %j with a reason", (body, message) => {
    expect(() => parseTemplateBody(body)).toThrow(TemplateError)
    expect(() => parseTemplateBody(body)).toThrow(message)
  })

  it("checks typed text, including JSON syntax errors", () => {
    expect(checkTemplateText("{")).toMatchObject({ ok: false })
    const ok = checkTemplateText(JSON.stringify(BLANK_TEMPLATE))
    expect(ok.ok).toBe(true)
  })

  it("rounds progress", () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(0, 0)).toBe(0)
  })
})

describe("increment 13.8: document numbers and the three-shot set", () => {
  it("derives a project code the way the API does", () => {
    expect(derivedProjectCode("Landfill Cell 4", 1)).toBe("LC4")
    expect(derivedProjectCode("Cedar Hollow Landfill RNG", 1)).toBe("CHLR")
    expect(derivedProjectCode("Riverside", 1)).toBe("RIVE")
    expect(derivedProjectCode("X", 7)).toBe("P7")
    expect(derivedProjectCode("", 7)).toBe("P7")
  })

  it("normalises and checks a typed code", () => {
    expect(normaliseProjectCode(" lc-4 ")).toEqual({
      code: "LC-4",
      error: null,
    })
    expect(normaliseProjectCode("gw plant")).toEqual({
      code: "GW-PLANT",
      error: null,
    })
    expect(normaliseProjectCode("")).toEqual({ code: null, error: null })
    expect(normaliseProjectCode("-AB").error).not.toBeNull()
    expect(normaliseProjectCode("A/B").error).not.toBeNull()
    expect(normaliseProjectCode("X".repeat(21)).error).not.toBeNull()
    expect(itpDocNumber("LC4", 7)).toBe("ITP-LC4-007")
  })

  it("reads photoSet like the API and names what is missing", () => {
    const body = (photoSet: unknown) => ({
      pages: [
        {
          elements: [
            { type: "radiogroup", name: "a", classification: "W", photoSet },
          ],
        },
      ],
    })
    for (const value of ["three_shot", "three-shot", "threeShot"]) {
      expect(parseTemplateBody(body(value)).items[0].photoSet).toBe(
        "three_shot",
      )
    }
    expect(parseTemplateBody(body("none")).items[0].photoSet).toBeNull()
    expect(() => parseTemplateBody(body("two_shot"))).toThrow(TemplateError)

    expect(
      evidenceGap({ photo_set: "three_shot", shot_slots: ["context"] }),
    ).toBe("Three-shot set: still missing Intermediate, Close-up with scale")
    expect(
      evidenceGap({
        photo_set: "three_shot",
        shot_slots: ["context", "intermediate", "closeup"],
      }),
    ).toBeNull()
    expect(evidenceGap({ photo_required: true, photo_count: 0 })).toBe(
      "Photo required",
    )
    expect(evidenceGap({ photo_required: true, photo_count: 1 })).toBeNull()
  })
})
