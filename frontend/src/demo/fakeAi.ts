/*
 * Demo build only: the AI capture routes (increment 15; Block 10A / 10B).
 *
 * The clickable demo has no server and no model. These handlers answer the
 * same routes with canned photo analyses (by sample file name) and a small
 * keyword reading of a dictated note, so the owner can walk the whole
 * draft → check → confirm flow. The real app sends the photo or note to the
 * Claude API instead; the screens cannot tell the difference.
 */
import type { AiSuggestionLog, FindingPublic, PhotoPublic } from "@/client"

type Body = Record<string, unknown>
type Handler = (args: {
  params: string[]
  query: URLSearchParams
  body: Body
}) => unknown

interface AiDeps {
  on: (method: string, pattern: string, handler: Handler) => void
  fail: (status: number, detail: string) => never
  me: string
  photos: () => PhotoPublic[]
  findings: () => FindingPublic[]
  projectOfInspection: (inspectionId: number) => number
}

const DEMO_MODEL = "claude-sonnet-4-5 (demo — canned answers)"
const stamp = () => new Date().toISOString()

type PhotoAnswer = {
  category: string
  defects: { type: string; note: string; confidence: number }[]
  severity: string | null
  title: string
  description: string
}

const CANNED_PHOTOS: Record<string, PhotoAnswer> = {
  "flange-ft104.jpg": {
    category: "defect",
    defects: [
      {
        type: "corrosion",
        note: "Surface rust on the flange face and two stud nuts, lower half",
        confidence: 0.86,
      },
    ],
    severity: "medium",
    title: "Corrosion on flange FT-104 studs",
    description:
      "Surface rust visible on the flange face and on two stud nuts at the lower half of the joint.",
  },
  "valve-xv205.jpg": {
    category: "defect",
    defects: [
      {
        type: "damage",
        note: "Bent handwheel spoke, upper right",
        confidence: 0.71,
      },
    ],
    severity: "low",
    title: "Bent handwheel on valve XV-205",
    description: "One handwheel spoke on valve XV-205 appears bent.",
  },
  "cable-tray.jpg": {
    category: "safety",
    defects: [
      {
        type: "safety_hazard",
        note: "Tray cover missing over a walkway section, centre",
        confidence: 0.64,
      },
    ],
    severity: "high",
    title: "Cable tray cover missing over walkway",
    description:
      "A section of cable tray over the walkway has no cover fitted.",
  },
  "condensate-drain.jpg": {
    category: "defect",
    defects: [
      {
        type: "corrosion",
        note: "Rust staining at the drain outlet",
        confidence: 0.77,
      },
      {
        type: "water_ingress",
        note: "Standing water around the drain base",
        confidence: 0.52,
      },
    ],
    severity: "medium",
    title: "Corrosion and standing water at condensate drain",
    description:
      "Rust staining at the condensate drain outlet with standing water around its base.",
  },
  "pad-ponding.jpg": {
    category: "defect",
    defects: [
      {
        type: "water_ingress",
        note: "Ponding across the pad, left two-thirds of the frame",
        confidence: 0.9,
      },
    ],
    severity: "medium",
    title: "Water ponding on equipment pad",
    description: "Water is ponding across most of the equipment pad surface.",
  },
}

const PLAIN_PHOTO: PhotoAnswer = {
  category: "progress",
  defects: [],
  severity: null,
  title: "",
  description: "",
}

function sentenceCase(text: string): string {
  const t = text.trim()
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

/** A rough, local stand-in for 10B: enough to show the flow in the demo. */
export function demoVoiceDraft(transcript: string, location: string | null) {
  const text = transcript.replace(/\s+/g, " ").trim()
  const lower = text.toLowerCase()
  const has = (re: RegExp) => re.test(lower)
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(sentenceCase)
    .filter(Boolean)
  const first = sentences[0]?.replace(/[.!?]+$/, "") ?? "Observation"
  const title = first.length > 70 ? `${first.slice(0, 67).trimEnd()}…` : first
  const discipline = has(/flange|valve|pipe|piping|gasket|bolt/)
    ? "pid"
    : has(/cable|conduit|panel|breaker|ground|electrical|tray/)
      ? "electrical"
      : has(/rebar|concrete|footing|slab|grout|form/)
        ? "civil_structural"
        : has(/beam|column|weld|steel|girder|brace/)
          ? "steel_erection"
          : has(/grade|grading|compaction|soil|ponding|drain/)
            ? "grading"
            : "general"
  const priority = has(
    /unsafe|danger|hazard|leak|crack|missing|failed|broken|exposed/,
  )
    ? "high"
    : has(/cosmetic|housekeeping|minor|touch.?up|label/)
      ? "low"
      : "medium"
  const status = has(/\b(fixed|repaired|verified|corrected)\b/)
    ? "resolved"
    : has(/being (fixed|repaired)|in progress|crew is (fixing|working)/)
      ? "in-progress"
      : "open"
  const spokenLocation =
    text.match(
      /\b(grid(?:line)?\s*[a-z]-?\d+|level\s+\d+|room\s+\w+|station\s+[\d+]+)\b/i,
    )?.[1] ?? null
  return {
    title,
    status,
    priority,
    discipline,
    description: sentences
      .map((s) => (/[.!?]$/.test(s) ? s : `${s}.`))
      .join(" "),
    location_ref: spokenLocation ? sentenceCase(spokenLocation) : location,
  }
}

export function registerAiRoutes(deps: AiDeps) {
  const { on, fail, me } = deps
  const suggestions: AiSuggestionLog[] = []

  const add = (row: Omit<AiSuggestionLog, "id" | "created_at">) => {
    const created: AiSuggestionLog = {
      ...row,
      id: suggestions.length + 1,
      created_at: stamp(),
    }
    suggestions.push(created)
    return created
  }

  on("GET", "/ai/status", () => ({
    enabled: true,
    model: DEMO_MODEL,
    daily_limit: 200,
    used_today: suggestions.length,
  }))

  on("POST", "/ai/photo-analysis", ({ body }) => {
    const photo = deps.photos().find((p) => p.id === Number(body.photo_id))
    if (!photo || photo.inspection_id === null) fail(404, "Photo not found")
    const p = photo as PhotoPublic
    const answer = CANNED_PHOTOS[p.filename ?? ""] ?? PLAIN_PHOTO
    return add({
      kind: "photo",
      status: "draft",
      project_id: deps.projectOfInspection(p.inspection_id as number),
      inspection_id: p.inspection_id as number,
      photo_id: p.id,
      model: DEMO_MODEL,
      prompt_version: "10A-2026-11-12",
      draft: structuredClone(answer),
      edited: null,
      requested_by: me,
      decided_by: null,
      decided_at: null,
      system_prompt: "(demo)",
      user_prompt: "(demo)",
      input_text: null,
      error: null,
      input_tokens: null,
      output_tokens: null,
      finding_id: null,
    })
  })

  on("POST", "/ai/voice-finding", ({ body }) => {
    const transcript = String(body.transcript ?? "").trim()
    if (!transcript) fail(422, "Say or type the observation first")
    const inspectionId = Number(body.inspection_id)
    return add({
      kind: "voice",
      status: "draft",
      project_id: deps.projectOfInspection(inspectionId),
      inspection_id: inspectionId,
      photo_id: null,
      model: DEMO_MODEL,
      prompt_version: "10B-2026-11-12",
      draft: demoVoiceDraft(
        transcript,
        (body.location_ref as string | null) ?? null,
      ),
      edited: null,
      requested_by: me,
      decided_by: null,
      decided_at: null,
      system_prompt: "(demo)",
      user_prompt: "(demo)",
      input_text: transcript,
      error: null,
      input_tokens: null,
      output_tokens: null,
      finding_id: null,
    })
  })

  const findRow = (id: number) =>
    suggestions.find((s) => s.id === id) ?? fail(404, "Suggestion not found")

  on("GET", "/ai/suggestions/{suggestion_id}", ({ params }) =>
    findRow(Number(params[0])),
  )
  on("GET", "/ai/suggestions", ({ query }) => {
    const findingId = query.get("finding_id")
    const photoId = query.get("photo_id")
    if (findingId) {
      return suggestions.filter((s) => s.finding_id === Number(findingId))
    }
    if (photoId)
      return suggestions.filter((s) => s.photo_id === Number(photoId))
    return fail(422, "Give exactly one of finding_id or photo_id")
  })
  on("POST", "/ai/suggestions/{suggestion_id}/dismiss", ({ params }) => {
    const row = findRow(Number(params[0]))
    if (row.status !== "draft") fail(409, `This draft is already ${row.status}`)
    row.status = "dismissed"
    row.decided_by = me
    row.decided_at = stamp()
    return row
  })

  /** Used by the findings / photo-filing handlers when a draft is confirmed. */
  function confirm(
    id: number,
    edited: boolean,
    findingId?: number,
  ): AiSuggestionLog {
    const row = findRow(id)
    if (row.status === "failed" || row.status === "dismissed") {
      fail(409, `This draft is ${row.status}`)
    }
    if (findingId !== undefined) {
      if (row.finding_id !== null) {
        fail(409, "A finding was already saved from this AI draft")
      }
      row.finding_id = findingId
    }
    row.edited = Boolean(row.edited) || edited
    if (row.status === "draft") {
      row.status = "confirmed"
      row.decided_by = me
      row.decided_at = stamp()
    }
    return row
  }

  function findingDiffers(id: number, values: Body): boolean {
    const row = findRow(id)
    const draft = (row.draft ?? {}) as Record<string, unknown>
    const proposed: Record<string, unknown> =
      row.kind === "photo"
        ? {
            title: draft.title,
            description: draft.description,
            priority: draft.severity ?? "medium",
          }
        : draft
    return Object.keys(proposed).some(
      (key) =>
        key in values &&
        (proposed[key] || null) !== ((values[key] as unknown) || null),
    )
  }

  function tagsDiffer(id: number, values: Body): boolean {
    const draft = (findRow(id).draft ?? {}) as PhotoAnswer
    const proposed = [...new Set(draft.defects.map((d) => d.type))].sort()
    const given = [...new Set((values.defect_tags as string[]) ?? [])].sort()
    return (
      draft.category !== (values.category ?? null) ||
      proposed.join() !== given.join() ||
      (draft.severity ?? null) !== (values.severity ?? null)
    )
  }

  return { confirm, findingDiffers, tagsDiffer }
}
