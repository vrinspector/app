import { describe, expect, it } from "vitest"

import type { PinPublic } from "@/client"
import {
  clampZoom,
  drawingFileKind,
  fileExtension,
  fitWidthZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  pdfRenderLimits,
  pinsOnPage,
  pointToPercent,
  safeRenderDpr,
  scrollForZoom,
  zoomStepIn,
  zoomStepOut,
} from "./drawings"

describe("drawingFileKind", () => {
  it("treats pdf by file_type, filename or title as PDF", () => {
    expect(
      drawingFileKind({ file_type: "pdf", filename: "x", title: "x" }),
    ).toBe("pdf")
    expect(
      drawingFileKind({ file_type: "", filename: "plan.PDF", title: "" }),
    ).toBe("pdf")
    expect(
      drawingFileKind({ file_type: "png", filename: "plan.png", title: "" }),
    ).toBe("raster")
    expect(drawingFileKind(null)).toBe("raster")
  })
})

describe("zoom steps", () => {
  it("steps through the legacy levels and clamps at both ends", () => {
    expect(zoomStepIn(1)).toBe(1.25)
    expect(zoomStepIn(1.1)).toBe(1.25)
    expect(zoomStepIn(MAX_ZOOM)).toBe(MAX_ZOOM)
    expect(zoomStepOut(1)).toBe(0.75)
    expect(zoomStepOut(0.9)).toBe(0.75)
    expect(zoomStepOut(MIN_ZOOM)).toBe(MIN_ZOOM)
    expect(clampZoom(10)).toBe(MAX_ZOOM)
    expect(clampZoom(0)).toBe(MIN_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it("fits a wide sheet to the stage width", () => {
    // 36 × 24 in sheet is 2592 pt wide; a 390 px phone with 16 px padding.
    expect(fitWidthZoom(2592, 390)).toBeCloseTo(0.25, 2)
    // A letter page on a desktop stage stops at 3.0.
    expect(fitWidthZoom(612, 4000)).toBe(MAX_ZOOM)
    expect(fitWidthZoom(0, 400)).toBe(1)
  })
})

describe("safeRenderDpr (Samsung Chrome memory hotfix)", () => {
  const desktop = pdfRenderLimits("Mozilla/5.0 (X11; Linux x86_64)", 16)
  const phone = pdfRenderLimits("Mozilla/5.0 (Linux; Android 14) Mobile", 4)

  it("classifies devices and budgets", () => {
    expect(desktop.isMobile).toBe(false)
    expect(desktop.maxDpr).toBe(2)
    expect(phone.isMobile).toBe(true)
    expect(phone.maxDpr).toBe(1.25)
    expect(phone.maxArea).toBe(8_388_608)
    expect(
      pdfRenderLimits("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", 0).maxArea,
    ).toBe(12_582_912)
  })

  it("keeps a small page at the device ratio", () => {
    expect(safeRenderDpr(612, 792, 2, desktop)).toBe(2)
    expect(safeRenderDpr(612, 792, 3, phone)).toBe(1.25)
  })

  it("reduces the ratio so the backing store stays inside the budget", () => {
    // 2592 × 1728 at 200 %: 5184 × 3456 CSS px.
    const dpr = safeRenderDpr(5184, 3456, 3, phone)
    expect(dpr * 5184 * dpr * 3456).toBeLessThanOrEqual(phone.maxArea + 1)
    expect(dpr * 5184).toBeLessThanOrEqual(phone.maxDim + 1)
    expect(dpr).toBeGreaterThanOrEqual(0.1)
  })
})

describe("pointToPercent", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 }

  it("converts a client point to two-decimal percentages", () => {
    expect(pointToPercent(rect, 300, 150)).toEqual({ x_pct: 50, y_pct: 50 })
    expect(pointToPercent(rect, 101, 51)).toEqual({ x_pct: 0.25, y_pct: 0.5 })
  })

  it("clamps outside points and refuses an empty box", () => {
    expect(pointToPercent(rect, 0, 0)).toEqual({ x_pct: 0, y_pct: 0 })
    expect(pointToPercent(rect, 900, 900)).toEqual({ x_pct: 100, y_pct: 100 })
    expect(pointToPercent({ ...rect, width: 0 }, 300, 150)).toBeNull()
  })
})

describe("pinsOnPage", () => {
  const pin = (id: number, page_number: number) =>
    ({ id, page_number }) as unknown as PinPublic

  it("filters PDF pins to the current page, defaulting old rows to page 1", () => {
    const pins = [pin(1, 1), pin(2, 2), pin(3, 0 as number)]
    expect(pinsOnPage(pins, "pdf", 1).map((p) => p.id)).toEqual([1, 3])
    expect(pinsOnPage(pins, "pdf", 2).map((p) => p.id)).toEqual([2])
    expect(pinsOnPage(pins, "raster", 1)).toHaveLength(3)
    expect(pinsOnPage(undefined, "pdf", 1)).toEqual([])
  })
})

describe("scrollForZoom", () => {
  it("keeps the focal point stationary", () => {
    // Content point under the cursor: (100 + 50) = 150 → ×2 = 300; minus cursor 50 → 250.
    expect(scrollForZoom({ left: 100, top: 20 }, { x: 50, y: 10 }, 2)).toEqual({
      left: 250,
      top: 50,
    })
    expect(scrollForZoom({ left: 0, top: 0 }, { x: 50, y: 10 }, 0.5)).toEqual({
      left: 0,
      top: 0,
    })
  })
})

describe("fileExtension", () => {
  it("lower-cases the extension and handles none", () => {
    expect(fileExtension("Site Plan.PDF")).toBe("pdf")
    expect(fileExtension("photo.jpeg")).toBe("jpeg")
    expect(fileExtension("README")).toBe("")
  })
})
