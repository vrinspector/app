import { describe, expect, it } from "vitest"

import type { SignLinkPublic } from "@/client"
import {
  batchSummary,
  fileSize,
  goneTitle,
  LINK_STATUS,
  linkActions,
  weatherText,
} from "./signoff"

const link = (status: string) => ({ status }) as SignLinkPublic

describe("signoff helpers", () => {
  it("labels every link state and offers the right actions", () => {
    for (const s of ["active", "used", "expired", "revoked", "replaced"]) {
      expect(LINK_STATUS[s].label).toBeTruthy()
    }
    expect(linkActions(link("active"))).toEqual({
      remind: true,
      withdraw: true,
    })
    expect(linkActions(link("expired"))).toEqual({
      remind: true,
      withdraw: false,
    })
    expect(linkActions(link("used"))).toEqual({
      remind: false,
      withdraw: false,
    })
    expect(linkActions(link("replaced")).remind).toBe(false)
  })

  it("summarises a batch of links", () => {
    expect(batchSummary({ links: [], skipped: ["x"] })).toBe(
      "No signing links sent",
    )
    expect(
      batchSummary({
        links: [
          { role_name: "Contractor" },
          { role_name: "Owner's representative" },
        ] as SignLinkPublic[],
        skipped: [],
      }),
    ).toBe("Signing links sent to Contractor, Owner's representative")
  })

  it("reads a weather stamp in words", () => {
    expect(
      weatherText({
        description: "Partly cloudy",
        temp_f: 61.3,
        wind_mph: 6.8,
      }),
    ).toBe("Partly cloudy, 61 °F, wind 7 mph")
    expect(weatherText({ description: "Fog", temp_f: 50 })).toBe("Fog, 50 °F")
    expect(weatherText(null)).toBeNull()
    expect(weatherText({ description: "x" })).toBeNull()
  })

  it("formats sizes and gone titles", () => {
    expect(fileSize(900)).toBe("900 B")
    expect(fileSize(128_000)).toBe("125 KB")
    expect(fileSize(3_500_000)).toBe("3.3 MB")
    expect(goneTitle(410)).toBe("This link no longer works")
    expect(goneTitle(404)).toBe("This link is not valid")
    expect(goneTitle(undefined)).toBe("Couldn't open this link")
  })
})
