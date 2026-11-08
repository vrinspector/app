import { afterEach, describe, expect, it } from "vitest"

import type { InspectionPublic, PinPublic } from "@/client"
import {
  defaultFindingTitle,
  defaultLocationRef,
  openInspections,
  pickCaptureInspection,
  pinThenFindingPreferred,
  recallCaptureInspection,
  rememberCaptureInspection,
  setPinThenFindingPreferred,
  titleFromTranscript,
} from "./capture"

const inspection = (
  id: number,
  created_at: string,
  status: "open" | "closed" = "open",
): InspectionPublic => ({
  id,
  public_id: `insp_${id}`,
  project_id: 7,
  title: `Inspection ${id}`,
  inspection_type: "civil",
  type: "civil",
  inspector: null,
  notes: null,
  status,
  inspection_status: status,
  signed_off_by: null,
  signed_off_at: null,
  created_at,
  updated_at: created_at,
})

const pin = (overrides: Partial<PinPublic> = {}): PinPublic => ({
  id: 903,
  public_id: "pin_903",
  drawing_id: 31,
  finding_id: null,
  tag_number: null,
  label: null,
  x_pct: 10,
  y_pct: 20,
  status: "punch_item",
  notes: null,
  discipline_data: null,
  page_number: 2,
  created_by: null,
  created_at: "2026-07-03T10:00:00Z",
  ...overrides,
})

afterEach(() => {
  window.localStorage.clear()
})

describe("which inspection a drawing finding goes into", () => {
  const older = inspection(21, "2026-07-01T09:00:00Z")
  const newer = inspection(22, "2026-07-05T09:00:00Z")
  const closed = inspection(23, "2026-07-09T09:00:00Z", "closed")

  it("lists only open inspections, newest first", () => {
    expect(openInspections([older, closed, newer]).map((i) => i.id)).toEqual([
      22, 21,
    ])
    expect(openInspections(undefined)).toEqual([])
  })

  it("prefers the inspection the viewer was opened from", () => {
    expect(pickCaptureInspection([older, newer], 21, 22)?.id).toBe(21)
  })

  it("falls back to the one remembered for the project, then the newest", () => {
    expect(pickCaptureInspection([older, newer], null, 21)?.id).toBe(21)
    expect(
      pickCaptureInspection([older, newer], undefined, undefined)?.id,
    ).toBe(22)
  })

  it("never picks a closed or unknown inspection", () => {
    expect(pickCaptureInspection([older, closed], 23, 99)?.id).toBe(21)
    expect(pickCaptureInspection([closed], 23, 23)).toBeNull()
    expect(pickCaptureInspection([], 1, 1)).toBeNull()
  })

  it("remembers the last choice per project on this device", () => {
    expect(recallCaptureInspection(7)).toBeNull()
    rememberCaptureInspection(7, 22)
    expect(recallCaptureInspection(7)).toBe(22)
    expect(recallCaptureInspection(8)).toBeNull()
    window.localStorage.setItem("vri.capture.inspection.7", "nonsense")
    expect(recallCaptureInspection(7)).toBeNull()
  })
})

describe("the pin → finding switch", () => {
  it("is on by default and remembered when turned off", () => {
    expect(pinThenFindingPreferred()).toBe(true)
    setPinThenFindingPreferred(false)
    expect(pinThenFindingPreferred()).toBe(false)
    setPinThenFindingPreferred(true)
    expect(pinThenFindingPreferred()).toBe(true)
    expect(window.localStorage.getItem("vri.capture.pinThenFinding")).toBeNull()
  })
})

describe("what the finding form starts with", () => {
  const sheet = { title: "Site grading plan", filename: "C-101.pdf" }

  it("names the pin and the sheet", () => {
    expect(defaultFindingTitle(pin(), sheet)).toBe(
      "Pin #903 — Site grading plan",
    )
    expect(defaultFindingTitle(pin({ tag_number: "V-101" }), sheet)).toBe(
      "Pin #V-101 — Site grading plan",
    )
    expect(defaultFindingTitle(pin(), { title: "", filename: "x.png" })).toBe(
      "Pin #903 — x.png",
    )
  })

  it("puts the page in the location only for PDFs", () => {
    expect(defaultLocationRef(pin(), sheet, true)).toBe(
      "Site grading plan, page 2 — pin #903",
    )
    expect(defaultLocationRef(pin(), sheet, false)).toBe(
      "Site grading plan — pin #903",
    )
  })

  it("turns the first dictated sentence into the title", () => {
    expect(titleFromTranscript("Cracked footing at the NE corner.")).toBe(
      "Cracked footing at the NE corner",
    )
    expect(
      titleFromTranscript(
        "Missing U-bolt at support PS-12. Line is unsupported between PS-11 and PS-13.",
      ),
    ).toBe("Missing U-bolt at support PS-12")
    expect(titleFromTranscript("   ")).toBe("")
    const long = titleFromTranscript(
      "the anchor bolts on the north side of the compressor skid are not torqued and two of the washers are missing entirely",
    )
    expect(long.length).toBeLessThanOrEqual(81)
    expect(long.endsWith("…")).toBe(true)
    expect(long).not.toMatch(/\s…$/)
  })
})
