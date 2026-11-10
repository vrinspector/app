import { describe, expect, it } from "vitest"

import {
  checkTemplateText,
  parseTemplateBody,
  percent,
  STARTER_TEMPLATE,
  TemplateError,
} from "./itp"

describe("ITP template bodies (mirror of the API's parser)", () => {
  it("reads the starter template into lines, sections and roles", () => {
    const parsed = parseTemplateBody(STARTER_TEMPLATE)
    expect(parsed.items.map((i) => i.elementName)).toEqual([
      "formwork",
      "rebar",
      "cover",
      "pour",
      "cylinders",
    ])
    expect(parsed.items.map((i) => i.section)).toEqual([
      "Pre-pour",
      "Pre-pour",
      "Pre-pour",
      "Pour",
      "Pour",
    ])
    expect(parsed.holdCount).toBe(1)
    expect(parsed.roles).toEqual([
      { name: "Contractor", party: "contractor" },
      { name: "Owner's representative", party: "client" },
    ])
    expect(parsed.items.map((i) => i.classification)).toEqual([
      "information",
      "hold",
      "review",
      "witness",
      "review",
    ])
    expect(parsed.items[1]).toMatchObject({
      photoRequired: true,
      reference: "ACI 301 §3.3; approved shop drawings",
      valueType: null,
    })
    expect(parsed.items[2]).toMatchObject({
      valueType: "number",
      unit: "in",
      min: 1.5,
      max: null,
    })
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
    const ok = checkTemplateText(JSON.stringify(STARTER_TEMPLATE))
    expect(ok.ok).toBe(true)
  })

  it("rounds progress", () => {
    expect(percent(1, 3)).toBe(33)
    expect(percent(0, 0)).toBe(0)
  })
})
