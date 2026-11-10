import { describe, expect, it } from "vitest"

import {
  checkTemplateText,
  parseTemplateBody,
  percent,
  TemplateError,
} from "./itp"
import { BLANK_TEMPLATE, starterTemplate } from "./itpLibrary"

describe("ITP template bodies (mirror of the API's parser)", () => {
  it("reads the concrete starter into lines, sections and roles", () => {
    const parsed = parseTemplateBody(
      starterTemplate("cast-in-place-concrete").body,
    )
    expect(parsed.items).toHaveLength(27)
    expect(parsed.holdCount).toBe(8)
    expect([...new Set(parsed.items.map((i) => i.section))]).toEqual([
      "1 Before work",
      "2 Formwork and embeds",
      "3 Rebar inspection",
      "4 Pre-pour release",
      "5 Placement and after",
    ])
    expect(parsed.roles).toEqual([
      { name: "Contractor", party: "contractor" },
      { name: "Owner's representative", party: "client" },
      { name: "Third-party inspector", party: "engineer" },
    ])
    const cover = parsed.items.find((i) => i.elementName === "clear-cover")
    expect(cover).toMatchObject({
      classification: "hold",
      photoRequired: true,
      reference: "ACI 318 §20.5.1.3; ACI 117",
      valueType: "number",
      unit: "in",
      roles: ["Third-party inspector"],
    })
    const temperature = parsed.items.find(
      (i) => i.elementName === "concrete-temperature",
    )
    expect(temperature).toMatchObject({ valueType: "number", max: 95 })
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
