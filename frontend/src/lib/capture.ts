import type { DrawingPublic, InspectionPublic, PinPublic } from "@/client"

/*
 * Capture loop (increment 11a): the choices the drawing-tap → finding flow
 * makes on the inspector's behalf, kept pure so they can be unit tested.
 *
 *   - which inspection a finding logged from a drawing goes into
 *   - whether placing a pin should go straight on to the finding form
 *   - the title / location the form starts with so Save works after a
 *     photo and a dictated sentence, with nothing typed
 *
 * Both remembered preferences live in localStorage (per device, like the
 * theme) and fail soft when storage is unavailable.
 */

const PIN_THEN_FINDING_KEY = "vri.capture.pinThenFinding"
const INSPECTION_KEY = (projectId: number) =>
  `vri.capture.inspection.${projectId}`

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private mode / storage disabled: the preference simply is not kept.
  }
}

/** Default on: the status tap places the pin and opens the finding form. */
export function pinThenFindingPreferred(): boolean {
  return read(PIN_THEN_FINDING_KEY) !== "off"
}

export function setPinThenFindingPreferred(on: boolean): void {
  write(PIN_THEN_FINDING_KEY, on ? null : "off")
}

export function rememberCaptureInspection(
  projectId: number,
  inspectionId: number,
): void {
  write(INSPECTION_KEY(projectId), String(inspectionId))
}

export function recallCaptureInspection(projectId: number): number | null {
  const raw = read(INSPECTION_KEY(projectId))
  if (raw === null) return null
  const id = Number.parseInt(raw, 10)
  return Number.isFinite(id) && id > 0 ? id : null
}

export function isOpenInspection(inspection: InspectionPublic): boolean {
  return (inspection.inspection_status || inspection.status) !== "closed"
}

/**
 * The inspections a finding may be logged into (sign-off locks findings),
 * newest first — the order the picker lists them in.
 */
export function openInspections(
  inspections: InspectionPublic[] | undefined,
): InspectionPublic[] {
  return (inspections ?? [])
    .filter(isOpenInspection)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
}

/**
 * Which inspection to pre-select: the one the inspector came from
 * (`?inspection=` on the drawing route), else the one last used on this
 * device for the project, else the newest open inspection. A closed or
 * foreign id never wins.
 */
export function pickCaptureInspection(
  inspections: InspectionPublic[] | undefined,
  preferredId: number | null | undefined,
  rememberedId: number | null | undefined,
): InspectionPublic | null {
  const open = openInspections(inspections)
  if (!open.length) return null
  for (const candidate of [preferredId, rememberedId]) {
    if (candidate === null || candidate === undefined) continue
    const match = open.find((inspection) => inspection.id === candidate)
    if (match) return match
  }
  return open[0]
}

export function pinNumber(pin: PinPublic): string {
  return String(pin.tag_number || pin.id)
}

/** "Pin #7 — Site plan" — overwritten by the first dictated sentence. */
export function defaultFindingTitle(
  pin: PinPublic,
  drawing: Pick<DrawingPublic, "title" | "filename">,
): string {
  const sheet = drawing.title || drawing.filename
  return `Pin #${pinNumber(pin)} — ${sheet}`.slice(0, 255)
}

/** "Site plan, page 2 — pin #7": the finding's location reference. */
export function defaultLocationRef(
  pin: PinPublic,
  drawing: Pick<DrawingPublic, "title" | "filename">,
  isPdf: boolean,
): string {
  const sheet = drawing.title || drawing.filename
  const page = isPdf && pin.page_number ? `, page ${pin.page_number}` : ""
  return `${sheet}${page} — pin #${pinNumber(pin)}`.slice(0, 255)
}

const TITLE_MAX = 80

/**
 * A title from dictated text: the first sentence, cut at a word boundary
 * when longer than 80 characters.
 */
export function titleFromTranscript(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  if (!oneLine) return ""
  const sentence = oneLine.split(/(?<=[.!?])\s/)[0] ?? oneLine
  const clean = sentence.replace(/[.!?]+$/, "")
  if (clean.length <= TITLE_MAX) return clean
  const cut = clean.slice(0, TITLE_MAX)
  const space = cut.lastIndexOf(" ")
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`
}
