import type { DrawingPublic, ItpItemRef, PinPublic } from "@/client"
import { PIN_STATUS_OPTIONS } from "@/lib/vocab"

/*
 * Increment 14.5 — drawing pins, round two. The pure half of three viewer
 * features, kept out of the components so they are testable on their own:
 *
 *   revisions  — how a revision is labelled ("Rev B") and described
 *   filters    — show / hide pins by status and by what they are linked to,
 *                remembered per device and per project
 *   clusters   — pins whose markers would overlap at the current zoom
 *                collapse into one numbered marker
 */

// --- Revisions --------------------------------------------------------------

/** "Rev B", or null for a drawing that was never labelled. */
export function revisionLabel(
  drawing: Pick<DrawingPublic, "revision"> | null | undefined,
): string | null {
  return drawing?.revision ? `Rev ${drawing.revision}` : null
}

/** "Rev B" for a carried pin's source, falling back to "the previous revision". */
export function carriedFromText(pin: Pick<PinPublic, "carried_from_revision">) {
  return pin.carried_from_revision
    ? `Rev ${pin.carried_from_revision}`
    : "the previous revision"
}

/**
 * The API's revision-label rules (backend `app/core/drawing_revisions.py`),
 * so the upload dialog can suggest the label the server would pick: drop a
 * typed "Rev" prefix and upper-case; A → B, Z → AA, 0 → 1, P1 → P2, an
 * unlabelled sheet counts as Rev A.
 */
export function normaliseRevisionLabel(value: unknown): string | null {
  const label = String(value ?? "")
    .replace(/^\s*rev(?:ision)?(?:\.\s*|\s+|(?=\d))/i, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase()
    .slice(0, 20)
  return label || null
}

export function nextRevisionLabel(current: string | null | undefined): string {
  const label = normaliseRevisionLabel(current)
  if (!label) return "B"
  const number = /^(.*?)(\d+)$/.exec(label)
  if (number) {
    const bumped = String(Number(number[2]) + 1).padStart(number[2].length, "0")
    return `${number[1]}${bumped}`.slice(0, 20)
  }
  if (/^[A-Z]{1,2}$/.test(label)) {
    const chars = label.split("")
    for (let i = chars.length - 1; i >= 0; i -= 1) {
      if (chars[i] !== "Z") {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1)
        return chars.join("")
      }
      chars[i] = "A"
    }
    return `A${chars.join("")}`
  }
  return `${label}-2`.slice(0, 20)
}

export function needsPositionCheck(pin: Pick<PinPublic, "position_check">) {
  return Boolean(pin.position_check)
}

// --- Filters ------------------------------------------------------------------

/**
 * What a pin is linked to:
 *   all      — every pin
 *   itp      — pins that mark an ITP line (any, or the one ITP in `itpId`)
 *   finding  — pins linked to a finding
 *   unlinked — pins linked to neither
 *   check    — pins carried from an earlier revision, position not yet checked
 */
export type PinLinkFilter = "all" | "itp" | "finding" | "unlinked" | "check"

export interface PinFilters {
  /** Statuses switched off. Stored as "hidden" so a new status shows by default. */
  hiddenStatuses: string[]
  link: PinLinkFilter
  /** With `link: "itp"`, only pins marking lines of this project ITP. */
  itpId: number | null
}

export const DEFAULT_PIN_FILTERS: PinFilters = {
  hiddenStatuses: [],
  link: "all",
  itpId: null,
}

export const PIN_LINK_OPTIONS: { value: PinLinkFilter; label: string }[] = [
  { value: "all", label: "All pins" },
  { value: "itp", label: "Linked to an ITP line" },
  { value: "finding", label: "Linked to a finding" },
  { value: "unlinked", label: "Not linked" },
  { value: "check", label: "Position to check" },
]

export function pinFiltersActive(filters: PinFilters): boolean {
  return filters.hiddenStatuses.length > 0 || filters.link !== "all"
}

export function pinMatchesFilters(
  pin: PinPublic,
  filters: PinFilters,
  itpItems?: Map<number, Pick<ItpItemRef, "project_itp_id">>,
): boolean {
  if (filters.hiddenStatuses.includes(pin.status)) return false
  switch (filters.link) {
    case "itp": {
      if (!pin.itp_item_id) return false
      if (filters.itpId === null) return true
      return itpItems?.get(pin.itp_item_id)?.project_itp_id === filters.itpId
    }
    case "finding":
      return Boolean(pin.finding_id)
    case "unlinked":
      return !pin.finding_id && !pin.itp_item_id
    case "check":
      return needsPositionCheck(pin)
    default:
      return true
  }
}

export function applyPinFilters(
  pins: PinPublic[],
  filters: PinFilters,
  itpItems?: Map<number, Pick<ItpItemRef, "project_itp_id">>,
): PinPublic[] {
  if (!pinFiltersActive(filters)) return pins
  return pins.filter((pin) => pinMatchesFilters(pin, filters, itpItems))
}

const STORAGE_PREFIX = "vri.pinFilters.v1."
const KNOWN_LINKS = new Set(PIN_LINK_OPTIONS.map((o) => o.value))
const KNOWN_STATUSES = new Set<string>(PIN_STATUS_OPTIONS.map((o) => o.value))

/** The filters last used on this device for this project (never throws). */
export function loadPinFilters(projectId: number): PinFilters {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`)
    if (!raw) return DEFAULT_PIN_FILTERS
    const parsed = JSON.parse(raw) as Partial<PinFilters>
    const link = KNOWN_LINKS.has(parsed.link as PinLinkFilter)
      ? (parsed.link as PinLinkFilter)
      : "all"
    return {
      hiddenStatuses: Array.isArray(parsed.hiddenStatuses)
        ? parsed.hiddenStatuses.filter(
            (s): s is string => typeof s === "string" && KNOWN_STATUSES.has(s),
          )
        : [],
      link,
      itpId:
        link === "itp" && typeof parsed.itpId === "number"
          ? parsed.itpId
          : null,
    }
  } catch {
    return DEFAULT_PIN_FILTERS
  }
}

/** Remember the filters on this device (best effort: private windows may refuse). */
export function savePinFilters(projectId: number, filters: PinFilters): void {
  try {
    const key = `${STORAGE_PREFIX}${projectId}`
    if (pinFiltersActive(filters)) {
      window.localStorage.setItem(key, JSON.stringify(filters))
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Storage unavailable: the filters still apply for this visit.
  }
}

// --- Clusters -------------------------------------------------------------------

/**
 * Markers are 24 px wide and drawn above their point; two whose points are
 * closer than this many screen pixels overlap enough to be hard to tap.
 */
export const CLUSTER_RADIUS_PX = 22

export interface PinCluster {
  /** Stable key: the lowest pin id in the cluster. */
  key: number
  pins: PinPublic[]
  /** Centre in percent of the page (the mean of its pins). */
  x_pct: number
  y_pct: number
}

/**
 * Greedy screen-space clustering: each pin joins the first cluster whose
 * centre is within `radius` px at the current box size, else starts one.
 * Pins are taken in id order so clusters do not jump between renders.
 * O(n × clusters) — a sheet carries tens to a few hundred pins.
 */
export function clusterPins(
  pins: PinPublic[],
  box: { width: number; height: number },
  radius = CLUSTER_RADIUS_PX,
): PinCluster[] {
  const clusters: (PinCluster & { sx: number; sy: number })[] = []
  const sorted = [...pins].sort((a, b) => a.id - b.id)
  for (const pin of sorted) {
    const px = (Number(pin.x_pct) / 100) * box.width
    const py = (Number(pin.y_pct) / 100) * box.height
    const home = clusters.find((c) => Math.hypot(c.sx - px, c.sy - py) < radius)
    if (home) {
      const n = home.pins.length
      home.pins.push(pin)
      home.sx = (home.sx * n + px) / (n + 1)
      home.sy = (home.sy * n + py) / (n + 1)
      home.x_pct = (home.x_pct * n + Number(pin.x_pct)) / (n + 1)
      home.y_pct = (home.y_pct * n + Number(pin.y_pct)) / (n + 1)
    } else {
      clusters.push({
        key: pin.id,
        pins: [pin],
        x_pct: Number(pin.x_pct),
        y_pct: Number(pin.y_pct),
        sx: px,
        sy: py,
      })
    }
  }
  return clusters.map(({ sx: _sx, sy: _sy, ...cluster }) => cluster)
}

/**
 * The zoom that spreads a cluster's pins apart: enough that its two closest
 * pins sit `radius` px apart with some room, at least one step closer, and
 * capped at `maxZoom`. Returns `zoom` unchanged when even `maxZoom` cannot
 * separate them (pins on the very same spot) — the caller lists them then.
 */
export function zoomToSeparate(
  cluster: PinCluster,
  box: { width: number; height: number },
  zoom: number,
  maxZoom: number,
  radius = CLUSTER_RADIUS_PX,
): number {
  let closest = Number.POSITIVE_INFINITY
  const pts = cluster.pins.map((p) => ({
    x: (Number(p.x_pct) / 100) * box.width,
    y: (Number(p.y_pct) / 100) * box.height,
  }))
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      closest = Math.min(
        closest,
        Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y),
      )
    }
  }
  // Pins that would still overlap at full zoom (or share one spot) never
  // separate: the caller lists them instead.
  if (!(closest * (maxZoom / zoom) >= radius)) return zoom
  const factor = Math.max(1.5, (radius * 1.4) / closest)
  return Math.min(maxZoom, zoom * factor)
}

/** The status that dominates a cluster's colour: the most urgent present. */
const URGENCY = [
  "punch_item",
  "not_installed",
  "in_progress",
  "not_started",
  "verified",
]

export function clusterStatus(cluster: PinCluster): string {
  const present = new Set(cluster.pins.map((p) => p.status))
  return (
    URGENCY.find((s) => present.has(s)) ??
    cluster.pins[0]?.status ??
    "not_started"
  )
}
