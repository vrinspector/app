import type { DrawingPublic, PinPublic } from "@/client"

/*
 * The arithmetic of the Block 8E drawing viewer, ported from the legacy
 * single-file SPA so the behaviour is testable on its own: which renderer a
 * drawing needs, the memory-safe canvas resolution (the Samsung Chrome
 * hotfix), the zoom steps, and the pin coordinate maths. Everything here is
 * pure; the components in `components/Drawings/` hold the DOM.
 */

export type DrawingKind = "pdf" | "raster"

/**
 * Legacy `drawingFileKind`: PDFs get the PDF.js canvas (page navigation,
 * page-aware pins); everything else (PNG, JPG, SVG) is shown as an image.
 */
export function drawingFileKind(
  drawing: Pick<DrawingPublic, "file_type" | "filename" | "title"> | null,
): DrawingKind {
  const raw = (
    drawing?.file_type ||
    drawing?.filename ||
    drawing?.title ||
    ""
  ).toLowerCase()
  if (raw.includes("pdf") || raw.endsWith(".pdf")) return "pdf"
  return "raster"
}

/**
 * Zoom is a plain scale factor on the page's unit viewport (1.0 = 72 dpi,
 * one PDF point per CSS pixel, as the legacy viewer rendered). The button
 * steps are the legacy `zoomLevels` with one step added at each end; pinch
 * and ctrl+wheel move continuously between MIN_ZOOM and MAX_ZOOM.
 *
 * The legacy viewer clamped to 0.5–2.0; the wider range here is what
 * makes a whole D-size sheet fit a phone (≈0.3) and a dimension readable on
 * a laptop (3.0). Memory stays bounded by `safeRenderDpr`, not the zoom.
 */
export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const
export const MIN_ZOOM = ZOOM_LEVELS[0]
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The next button step above `zoom` (or the top step). */
export function zoomStepIn(zoom: number): number {
  return ZOOM_LEVELS.find((level) => level > zoom + 1e-6) ?? MAX_ZOOM
}

/** The next button step below `zoom` (or the bottom step). */
export function zoomStepOut(zoom: number): number {
  for (let i = ZOOM_LEVELS.length - 1; i >= 0; i -= 1) {
    if (ZOOM_LEVELS[i] < zoom - 1e-6) return ZOOM_LEVELS[i]
  }
  return MIN_ZOOM
}

/**
 * The zoom at which a page of `pageWidth` CSS px (at zoom 1) fills a stage
 * `stageWidth` px wide, less a little padding. The initial zoom of the
 * viewer: on a phone a 36-inch sheet opens whole instead of at its top-left
 * corner.
 */
export function fitWidthZoom(
  pageWidth: number,
  stageWidth: number,
  padding = 16,
): number {
  if (!(pageWidth > 0) || !(stageWidth > 0)) return 1
  return clampZoom((stageWidth - padding * 2) / pageWidth)
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

export interface RenderLimits {
  isMobile: boolean
  /** Backing-store pixels (width × height) the canvas may use. */
  maxArea: number
  /** Longest backing-store edge in pixels. */
  maxDim: number
  /** Device pixel ratio cap. */
  maxDpr: number
}

/**
 * Legacy `getPdfRenderLimits` — the mobile memory hotfix. Android Chrome can
 * kill the tab before a canvas allocation throws, so phone backing stores
 * stay under ~48 MB (12 M RGBA pixels), 32 MB on phones reporting ≤ 4 GB.
 */
export function pdfRenderLimits(
  userAgent: string = typeof navigator === "undefined"
    ? ""
    : navigator.userAgent,
  deviceMemory: number = typeof navigator === "undefined"
    ? 0
    : Number((navigator as { deviceMemory?: number }).deviceMemory || 0),
): RenderLimits {
  const isMobile = /Android|iPad|iPhone|iPod|Mobile/i.test(userAgent)
  const maxArea = isMobile
    ? deviceMemory && deviceMemory <= 4
      ? 8_388_608
      : 12_582_912
    : 67_108_864
  return {
    isMobile,
    maxArea,
    maxDim: isMobile ? 4096 : 8192,
    maxDpr: isMobile ? 1.25 : 2.0,
  }
}

/**
 * Legacy `getSafeRenderDpr`: the device pixel ratio to render at for a
 * viewport of `width` × `height` CSS px, reduced until the backing store
 * fits the limits. Never below 0.1 so a huge sheet still draws, just softer.
 */
export function safeRenderDpr(
  width: number,
  height: number,
  devicePixelRatio: number,
  limits: RenderLimits,
): number {
  const desired = Math.min(devicePixelRatio || 1, limits.maxDpr)
  const byArea = Math.sqrt(limits.maxArea / Math.max(1, width * height))
  const byDim = Math.min(
    limits.maxDim / Math.max(1, width),
    limits.maxDim / Math.max(1, height),
  )
  return Math.max(0.1, Math.min(desired, byArea, byDim))
}

export interface PointPercent {
  x_pct: number
  y_pct: number
}

/**
 * Legacy `handleDrawingClick`: a client point over the rendered drawing →
 * percentages of its width and height, two decimals, clamped to 0–100. The
 * rectangle is the drawing's *rendered* box, so the same maths holds at any
 * zoom and on any page.
 */
export function pointToPercent(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): PointPercent | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null
  const x = Number.parseFloat(
    (((clientX - rect.left) / rect.width) * 100).toFixed(2),
  )
  const y = Number.parseFloat(
    (((clientY - rect.top) / rect.height) * 100).toFixed(2),
  )
  return {
    x_pct: Math.max(0, Math.min(100, x)),
    y_pct: Math.max(0, Math.min(100, y)),
  }
}

/**
 * Legacy `renderPins` filter: on a PDF only the current page's pins show
 * (`page_number` is 1-indexed; rows from before Block 8E default to 1). A
 * raster drawing has one page, so every pin shows.
 */
export function pinsOnPage(
  pins: PinPublic[] | undefined,
  kind: DrawingKind,
  currentPage: number,
): PinPublic[] {
  if (!pins) return []
  if (kind !== "pdf") return pins
  return pins.filter((pin) => Number(pin.page_number || 1) === currentPage)
}

/** The marker label: the tag number when set, else the pin's position in the list (legacy). */
export function pinLabel(pin: PinPublic, index: number): string {
  return String(pin.tag_number || index + 1)
}

/** Distance between two pointers, for pinch. */
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Keep the content under a focal point (client coordinates within the
 * stage) in place when the zoom changes: the new scroll offsets for a stage
 * whose content grows by `ratio`.
 */
export function scrollForZoom(
  scroll: { left: number; top: number },
  focal: { x: number; y: number },
  ratio: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, (scroll.left + focal.x) * ratio - focal.x),
    top: Math.max(0, (scroll.top + focal.y) * ratio - focal.y),
  }
}

/** The 50 MB cap the current product documents for drawing uploads. */
export const MAX_DRAWING_BYTES = 50 * 1024 * 1024

export const DRAWING_ACCEPT =
  "image/png,image/jpeg,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.svg,.pdf"

/** Lower-case extension without the dot, or "" when there is none. */
export function fileExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename)
  return match ? match[1].toLowerCase() : ""
}

export function contentTypeForExtension(ext: string): string {
  switch (ext) {
    case "pdf":
      return "application/pdf"
    case "png":
      return "image/png"
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "svg":
      return "image/svg+xml"
    default:
      return "application/octet-stream"
  }
}
