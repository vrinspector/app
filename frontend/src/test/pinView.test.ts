import { afterEach, describe, expect, it } from "vitest"

import type { PinPublic } from "@/client"
import {
  applyPinFilters,
  CLUSTER_RADIUS_PX,
  clusterPins,
  clusterStatus,
  DEFAULT_PIN_FILTERS,
  loadPinFilters,
  nextRevisionLabel,
  normaliseRevisionLabel,
  pinFiltersActive,
  revisionLabel,
  savePinFilters,
  zoomToSeparate,
} from "@/lib/pinView"

/* Increment 14.5: the pure half of revisions, pin filters and clustering. */

function pin(id: number, x: number, y: number, extra: Partial<PinPublic> = {}) {
  return {
    id,
    public_id: `pin_${id}`,
    drawing_id: 1,
    finding_id: null,
    tag_number: null,
    label: null,
    x_pct: x,
    y_pct: y,
    status: "not_started",
    notes: null,
    discipline_data: null,
    page_number: 1,
    created_by: null,
    created_at: "2026-11-12T00:00:00Z",
    itp_item_id: null,
    ...extra,
  } as PinPublic
}

afterEach(() => window.localStorage.clear())

describe("revision labels", () => {
  it.each([
    [null, "B"],
    ["A", "B"],
    ["Z", "AA"],
    ["AY", "AZ"],
    ["0", "1"],
    ["9", "10"],
    ["P1", "P2"],
    ["C09", "C10"],
    ["IFC", "IFC-2"],
  ])("after %s comes %s (same rules as the API)", (current, next) => {
    expect(nextRevisionLabel(current)).toBe(next)
  })

  it("normalises what people type", () => {
    expect(normaliseRevisionLabel(" rev. b ")).toBe("B")
    expect(normaliseRevisionLabel("Revision 3")).toBe("3")
    expect(normaliseRevisionLabel("rev2")).toBe("2")
    expect(normaliseRevisionLabel("Review set")).toBe("REVIEW SET")
    expect(normaliseRevisionLabel("   ")).toBeNull()
  })

  it("labels a drawing", () => {
    expect(revisionLabel({ revision: "B" })).toBe("Rev B")
    expect(revisionLabel({ revision: null })).toBeNull()
  })
})

describe("pin filters", () => {
  const itpItems = new Map([
    [11, { project_itp_id: 5 }],
    [12, { project_itp_id: 6 }],
  ])
  const pins = [
    pin(1, 10, 10, { status: "verified" }),
    pin(2, 20, 20, { status: "punch_item", finding_id: 7 }),
    pin(3, 30, 30, { itp_item_id: 11 }),
    pin(4, 40, 40, { itp_item_id: 12, position_check: true }),
  ]
  const ids = (list: PinPublic[]) => list.map((p) => p.id)

  it("shows everything by default", () => {
    expect(pinFiltersActive(DEFAULT_PIN_FILTERS)).toBe(false)
    expect(applyPinFilters(pins, DEFAULT_PIN_FILTERS)).toBe(pins)
  })

  it("hides statuses and filters by link", () => {
    const f = { ...DEFAULT_PIN_FILTERS }
    expect(
      ids(applyPinFilters(pins, { ...f, hiddenStatuses: ["verified"] })),
    ).toEqual([2, 3, 4])
    expect(ids(applyPinFilters(pins, { ...f, link: "finding" }))).toEqual([2])
    expect(ids(applyPinFilters(pins, { ...f, link: "unlinked" }))).toEqual([1])
    expect(ids(applyPinFilters(pins, { ...f, link: "check" }))).toEqual([4])
    expect(ids(applyPinFilters(pins, { ...f, link: "itp" }, itpItems))).toEqual(
      [3, 4],
    )
    expect(
      ids(applyPinFilters(pins, { ...f, link: "itp", itpId: 6 }, itpItems)),
    ).toEqual([4])
  })

  it("remembers filters per project and ignores junk", () => {
    savePinFilters(7, { hiddenStatuses: ["verified"], link: "itp", itpId: 5 })
    expect(loadPinFilters(7)).toEqual({
      hiddenStatuses: ["verified"],
      link: "itp",
      itpId: 5,
    })
    expect(loadPinFilters(8)).toEqual(DEFAULT_PIN_FILTERS)
    savePinFilters(7, DEFAULT_PIN_FILTERS)
    expect(window.localStorage.getItem("vri.pinFilters.v1.7")).toBeNull()
    window.localStorage.setItem(
      "vri.pinFilters.v1.9",
      JSON.stringify({
        hiddenStatuses: ["nope", 3],
        link: "weird",
        itpId: "x",
      }),
    )
    expect(loadPinFilters(9)).toEqual(DEFAULT_PIN_FILTERS)
    window.localStorage.setItem("vri.pinFilters.v1.9", "{not json")
    expect(loadPinFilters(9)).toEqual(DEFAULT_PIN_FILTERS)
  })
})

describe("pin clusters", () => {
  const box = { width: 1000, height: 1000 }

  it("groups pins closer than the radius at this box size", () => {
    const pins = [
      pin(1, 10, 10),
      pin(2, 11, 10),
      pin(3, 50, 50),
      pin(4, 10.5, 11),
    ]
    const clusters = clusterPins(pins, box)
    expect(clusters.map((c) => c.pins.map((p) => p.id))).toEqual([
      [1, 2, 4],
      [3],
    ])
    expect(clusters[0].key).toBe(1)
    expect(clusters[0].x_pct).toBeCloseTo(10.5)
    // Zoomed in, the same pins separate.
    expect(clusterPins(pins, { width: 5000, height: 5000 })).toHaveLength(4)
  })

  it("zooms just enough to separate, or not at all for one spot", () => {
    const [cluster] = clusterPins([pin(1, 10, 10), pin(2, 11, 10)], box)
    // 10 px apart at zoom 1 → about 3× brings them past the radius.
    const next = zoomToSeparate(cluster, box, 1, 3)
    expect(next).toBeGreaterThan(1.5)
    expect(next * 10).toBeGreaterThanOrEqual(CLUSTER_RADIUS_PX)
    const [same] = clusterPins([pin(1, 10, 10), pin(2, 10, 10)], box)
    expect(zoomToSeparate(same, box, 1, 3)).toBe(1)
  })

  it("colours a cluster by its most urgent status", () => {
    const [cluster] = clusterPins(
      [
        pin(1, 10, 10, { status: "verified" }),
        pin(2, 10, 10, { status: "punch_item" }),
      ],
      box,
    )
    expect(clusterStatus(cluster)).toBe("punch_item")
  })
})
