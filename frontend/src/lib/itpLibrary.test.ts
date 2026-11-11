import { describe, expect, it } from "vitest"

import { parseTemplateBody } from "./itp"
import {
  BLANK_TEMPLATE,
  PROJECT_SPECIFIC,
  STARTER_LIBRARY,
  starterTemplate,
} from "./itpLibrary"

describe("starter ITP library (increments 13.7 / 13.9)", () => {
  it("has the book-aligned starters, each a valid template", () => {
    expect(STARTER_LIBRARY.map((t) => t.key)).toEqual([
      "cast-in-place-concrete",
      "earthwork-compaction",
      "underground-conduit-duct-bank",
      "structural-steel-connections",
      "piping-pressure-test",
      "electrical-pre-energization",
      "instrument-calibration",
      "cx-pre-commissioning-readiness",
      "cx-cold-commissioning",
      "cx-hot-commissioning",
      "cx-rfsu",
    ])
    const counts = STARTER_LIBRARY.map((t) => {
      const parsed = parseTemplateBody(t.body)
      return [parsed.items.length, parsed.holdCount]
    })
    expect(counts).toEqual([
      [48, 7],
      [9, 2],
      [12, 1],
      [25, 1],
      [25, 3],
      [28, 1],
      [20, 1],
      [26, 1],
      [26, 1],
      [26, 1],
      [26, 1],
    ])
  })

  it.each(STARTER_LIBRARY.map((t) => [t.key, t] as const))(
    "%s: every line has a criterion, reference and code; holds name a signer",
    (_, starter) => {
      for (const item of parseTemplateBody(starter.body).items) {
        expect(item.acceptanceCriteria?.length ?? 0).toBeGreaterThan(40)
        expect(item.reference).toBeTruthy()
        if (/\bper spec/i.test(item.acceptanceCriteria ?? "")) {
          expect(item.acceptanceCriteria).toContain(PROJECT_SPECIFIC)
        }
        if (item.classification === "hold") {
          expect(item.roles.length).toBeGreaterThan(0)
        }
        if (item.resultScale === "release") {
          expect(item.classification).toBe("hold")
        }
        if (item.valueType === "number") expect(item.unit).toBeTruthy()
      }
    },
  )

  it("the concrete release is the three-way written result", () => {
    const parsed = parseTemplateBody(
      starterTemplate("cast-in-place-concrete").body,
    )
    const release = parsed.items.find(
      (i) => i.elementName === "pre-pour-release",
    )
    expect(release?.resultScale).toBe("release")
    expect(release?.approvedLabel).toBe("Approved to pour")
    const spacing = parsed.items.find(
      (i) => i.elementName === "rebar-size-spacing",
    )
    expect(spacing?.photoSet).toBe("three_shot")
  })

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
