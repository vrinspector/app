import { describe, expect, it } from "vitest"

import {
  draftFileName,
  EXAMPLE_SCOPES,
  scopeCounter,
  waitText,
} from "./generator"

describe("public ITP generator helpers", () => {
  it("counts the scope and says how much more is needed", () => {
    expect(scopeCounter("", 20, 2000)).toEqual({
      label: "At least 20 characters",
      ok: false,
    })
    expect(scopeCounter("  Pour a slab  ", 20, 2000)).toEqual({
      label: "9 more characters",
      ok: false,
    })
    expect(scopeCounter("x".repeat(19), 20, 2000).label).toBe(
      "1 more character",
    )
    expect(scopeCounter("x".repeat(1240), 20, 2000)).toEqual({
      label: "1,240 / 2,000",
      ok: true,
    })
    expect(scopeCounter("x".repeat(2001), 20, 2000).ok).toBe(false)
  })

  it("makes tidy download names", () => {
    expect(draftFileName("Cast-in-place concrete: slab (Rev A)", "json")).toBe(
      "draft-itp-cast-in-place-concrete-slab-rev-a.json",
    )
    expect(draftFileName("Béton coulé", "pdf")).toBe(
      "draft-itp-beton-coule.pdf",
    )
    expect(draftFileName("", "json")).toBe("draft-itp.json")
    expect(draftFileName("a".repeat(100), "pdf")).toBe(
      `draft-itp-${"a".repeat(60)}.pdf`,
    )
  })

  it("puts a wait into words", () => {
    expect(waitText(undefined)).toBeNull()
    expect(waitText(0)).toBeNull()
    expect(waitText(30)).toBe("about a minute")
    expect(waitText(1200)).toBe("about 20 minutes")
    expect(waitText(3600)).toBe("about 60 minutes")
    expect(waitText(7200)).toBe("about 2 hours")
    expect(waitText(5400)).toBe("about 2 hours")
  })

  it("offers examples long enough to send", () => {
    expect(EXAMPLE_SCOPES.length).toBeGreaterThanOrEqual(3)
    for (const example of EXAMPLE_SCOPES) {
      expect(scopeCounter(example.scope, 20, 2000).ok).toBe(true)
    }
  })
})
