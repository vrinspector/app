import { describe, expect, it } from "vitest"

import { parseTemplateBody } from "./itp"
import {
  BLANK_TEMPLATE,
  PROJECT_SPECIFIC,
  STARTER_LIBRARY,
  starterTemplate,
} from "./itpLibrary"

describe("starter ITP library (increment 13.7)", () => {
  it("has the four starters, each a valid template", () => {
    expect(STARTER_LIBRARY.map((t) => t.key)).toEqual([
      "cast-in-place-concrete",
      "earthwork-compaction",
      "underground-conduit-duct-bank",
      "piping-pressure-test",
    ])
    const counts = STARTER_LIBRARY.map((t) => {
      const parsed = parseTemplateBody(t.body)
      return [parsed.items.length, parsed.holdCount]
    })
    expect(counts).toEqual([
      [27, 8],
      [9, 2],
      [12, 1],
      [10, 2],
    ])
  })

  it.each(STARTER_LIBRARY.map((t) => [t.key, t] as const))(
    "%s: every line has a criterion, reference and code; holds need a photo",
    (_, starter) => {
      for (const item of parseTemplateBody(starter.body).items) {
        expect(item.acceptanceCriteria?.length ?? 0).toBeGreaterThan(40)
        expect(item.reference).toBeTruthy()
        if (/\bper spec/i.test(item.acceptanceCriteria ?? "")) {
          expect(item.acceptanceCriteria).toContain(PROJECT_SPECIFIC)
        }
        if (item.classification === "hold") {
          expect(item.photoRequired).toBe(true)
          expect(item.roles.length).toBeGreaterThan(0)
        }
        if (item.valueType === "number") expect(item.unit).toBeTruthy()
      }
    },
  )

  it("flags project-specific numbers instead of inventing them", () => {
    const parsed = parseTemplateBody(
      starterTemplate("piping-pressure-test").body,
    )
    const pressure = parsed.items.find((i) => i.elementName === "test-pressure")
    expect(pressure?.acceptanceCriteria).toContain(PROJECT_SPECIFIC)
    expect(pressure?.min).toBeNull()
  })

  it("the blank outline is a valid one-line template", () => {
    const parsed = parseTemplateBody(BLANK_TEMPLATE)
    expect(parsed.items).toHaveLength(1)
    expect(parsed.holdCount).toBe(1)
    expect(() => starterTemplate("nope")).toThrow()
  })
})
