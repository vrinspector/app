/*
 * Increment 17 — public ITP generator (PRD v2.63 Block 10D). Small pure
 * helpers for the no-account page at /itp-generator, kept here so they are
 * unit-tested.
 */

/** Example scopes a visitor can start from (one tap fills the box). */
export const EXAMPLE_SCOPES: { label: string; scope: string }[] = [
  {
    label: "Concrete slab",
    scope:
      "Place a 6 in reinforced concrete slab on grade, 40 ft x 60 ft, for a pump house: subgrade preparation, vapor retarder, #4 rebar both ways, placement, finishing and curing.",
  },
  {
    label: "Underground conduit",
    scope:
      "Install a 4-way 4 in PVC duct bank, concrete encased, 300 ft from the substation to the MCC building, with pull boxes every 100 ft, then backfill and compact.",
  },
  {
    label: "Piping hydrotest",
    scope:
      "Fabricate and install 600 ft of 6 in carbon steel process piping (ASME B31.3) on an existing pipe rack, including welding, NDE and a hydrostatic pressure test.",
  },
  {
    label: "Steel erection",
    scope:
      "Erect a two-story structural steel frame for a 50 ft x 80 ft equipment building: anchor bolt survey, column setting, high-strength bolted connections and grouting base plates.",
  },
]

/** "1,240 / 2,000" — or a hint while the scope is still too short. */
export function scopeCounter(
  text: string,
  min: number,
  max: number,
): { label: string; ok: boolean } {
  const length = text.trim().length
  if (length < min) {
    return {
      label:
        length === 0
          ? `At least ${min} characters`
          : `${min - length} more character${min - length === 1 ? "" : "s"}`,
      ok: false,
    }
  }
  return {
    label: `${length.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}`,
    ok: length <= max,
  }
}

/** A file name for the downloads: "draft-itp-cast-in-place-slab.json". */
export function draftFileName(name: string, extension: "json" | "pdf"): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "")
  return `draft-itp${slug ? `-${slug}` : ""}.${extension}`
}

/** "about 20 minutes" for a Retry-After in seconds. */
export function waitText(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds < 90) return "about a minute"
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `about ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  return `about ${hours} hour${hours === 1 ? "" : "s"}`
}

/** Save a JSON value as a file in the browser. */
export function downloadJson(value: unknown, fileName: string): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
