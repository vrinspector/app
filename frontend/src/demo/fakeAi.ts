/*
 * Demo build only: the AI capture routes (increment 15; Block 10A / 10B;
 * increment 16: 10C report drafting and 10E ITP import).
 *
 * The clickable demo has no server and no model. These handlers answer the
 * same routes with canned photo analyses (by sample file name) and a small
 * keyword reading of a dictated note, so the owner can walk the whole
 * draft → check → confirm flow. The real app sends the photo or note to the
 * Claude API instead; the screens cannot tell the difference.
 *
 * Report drafting writes a summary from the inspection's sample findings;
 * ITP import answers any uploaded file with one canned, plausible draft (a
 * structural steel bolting ITP with a deliberate unreadable-line note) so the
 * review form can be tried.
 */
import type {
  AiSuggestionLog,
  FindingPublic,
  InspectionPublic,
  ItpImportDraft,
  ItpTemplatePublic,
  PhotoPublic,
} from "@/client"
import { draftToBody } from "@/lib/itpImport"

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
  inspection: (inspectionId: number) => InspectionPublic
  photoCount: (inspectionId: number) => number
  createTemplate: (
    name: string,
    description: string | null,
    body: Record<string, unknown>,
  ) => ItpTemplatePublic
}

const DEMO_MODEL = "claude-haiku-5-5 (demo — canned answers)"
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

const PRIORITY_WORD: Record<string, string> = {
  high: "high-priority",
  medium: "medium-priority",
  low: "low-priority",
}

/** A local stand-in for 10C, built only from the recorded findings. */
export function demoReportSummary(
  inspection: InspectionPublic,
  findings: FindingPublic[],
  photos: number,
): string {
  const type = (inspection.inspection_type ?? "general").replace(/_/g, " ")
  const date = (inspection.created_at ?? "").slice(0, 10)
  const first = `This ${type} inspection, “${inspection.title}”, was recorded on ${date}${
    photos ? ` with ${photos} site photo${photos === 1 ? "" : "s"}` : ""
  }.`
  if (!findings.length) return `${first}\n\nNo findings were recorded.`
  const high = findings.filter((f) => f.priority === "high")
  const counts = ["high", "medium", "low"]
    .map((p) => [p, findings.filter((f) => f.priority === p).length] as const)
    .filter(([, n]) => n)
    .map(([p, n]) => `${n} ${PRIORITY_WORD[p]}`)
  let second = `${findings.length} finding${findings.length === 1 ? " was" : "s were"} recorded (${counts.join(", ")}).`
  if (high.length) {
    second += ` High priority: ${high
      .slice(0, 4)
      .map((f) => f.title)
      .join("; ")}.`
  }
  const open = findings.filter((f) => f.status === "open").length
  const progress = findings.filter((f) => f.status === "in-progress").length
  const resolved = findings.filter((f) => f.status === "resolved").length
  const third = `${open} remain${open === 1 ? "s" : ""} open, ${progress} in progress and ${resolved} resolved.`
  return [first, second, third].join("\n\n")
}

const CANNED_IMPORT: ItpImportDraft = {
  name: "Structural steel — high-strength bolting",
  description:
    "Receiving, installation and pretension checks for high-strength bolted connections.",
  roles: [
    { name: "Steel erector", party: "contractor" },
    { name: "Owner's representative", party: "client" },
    { name: "Special inspector", party: "engineer" },
  ],
  sections: [
    {
      title: "1 Receiving and storage",
      lines: [
        {
          title: "Bolt, nut and washer certifications match the delivered lots",
          classification: "R",
          acceptance_criteria:
            "Manufacturer certifications on file for every lot; lot numbers match the kegs.",
          reference: "RCSC Specification Section 2",
          record_required: "Material certifications",
          roles: ["Owner's representative"],
          photo_required: false,
          value_type: "none",
          unit: null,
        },
        {
          title: "Fasteners stored dry and protected",
          classification: "I",
          acceptance_criteria:
            "Kept in closed containers, protected from dirt and moisture.",
          reference: null,
          record_required: null,
          roles: [],
          photo_required: false,
          value_type: "none",
          unit: null,
        },
      ],
    },
    {
      title: "2 Pre-installation verification",
      lines: [
        {
          title: "Pre-installation verification test in tension calibrator",
          classification: "W",
          acceptance_criteria:
            "Three assemblies per lot reach at least the minimum pretension.",
          reference: "RCSC Specification Section 7",
          record_required: "Verification test record",
          roles: ["Special inspector"],
          photo_required: false,
          value_type: "number",
          unit: "kip",
        },
      ],
    },
    {
      title: "3 Installation and pretensioning",
      lines: [
        {
          title:
            "Connection plies in firm contact (snug-tight) before pretensioning",
          classification: "W",
          acceptance_criteria: null,
          reference: "RCSC Specification Section 8",
          record_required: null,
          roles: ["Special inspector"],
          photo_required: false,
          value_type: "none",
          unit: null,
        },
        {
          title: "Turn-of-nut match-marks visible and rotation achieved",
          classification: "H",
          acceptance_criteria:
            "Required nut rotation achieved on every bolt (match-marks checked).",
          reference: "RCSC Specification Section 8.2.1",
          record_required: "Bolting inspection report",
          roles: ["Special inspector"],
          photo_required: true,
          value_type: "none",
          unit: null,
        },
      ],
    },
  ],
  notes: [
    "Demo answer: the same sample draft is returned for any file.",
    "Row 9 on page 2 was partly cut off and is left out — check the original.",
  ],
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

  // ── increment 16: 10C report drafting ────────────────────────────────────
  on("POST", "/ai/report-draft", ({ body }) => {
    const inspectionId = Number(body.inspection_id)
    const inspection = deps.inspection(inspectionId)
    const findings = deps
      .findings()
      .filter((f) => f.inspection_id === inspectionId)
    return add({
      kind: "report",
      status: "draft",
      project_id: inspection.project_id,
      inspection_id: inspectionId,
      photo_id: null,
      template_id: null,
      source_files: null,
      model: DEMO_MODEL,
      prompt_version: "10C-2026-11-12",
      draft: {
        summary: demoReportSummary(
          inspection,
          findings,
          deps.photoCount(inspectionId),
        ),
      },
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

  // ── increment 16: 10E ITP import ─────────────────────────────────────────
  on("POST", "/ai/itp-import", ({ body }) => {
    const form = body as unknown
    const files =
      form instanceof FormData
        ? (form.getAll("files").filter((f) => f instanceof Blob) as File[])
        : []
    if (!files.length) fail(422, "Choose a file to import")
    const hint = form instanceof FormData ? form.get("hint") : null
    return add({
      kind: "itp_import",
      status: "draft",
      project_id: null,
      inspection_id: null,
      photo_id: null,
      template_id: null,
      source_files: files.map((f) => ({
        name: f.name || "upload",
        content_type: f.type || "application/octet-stream",
        size: f.size,
      })),
      model: DEMO_MODEL,
      prompt_version: "10E-2026-11-12",
      draft: structuredClone(CANNED_IMPORT) as Record<string, unknown>,
      edited: null,
      requested_by: me,
      decided_by: null,
      decided_at: null,
      system_prompt: "(demo)",
      user_prompt: "(demo)",
      input_text: typeof hint === "string" && hint ? hint : null,
      error: null,
      input_tokens: null,
      output_tokens: null,
      finding_id: null,
    })
  })

  on("POST", "/ai/itp-import/{suggestion_id}/save", ({ params, body }) => {
    const row = findRow(Number(params[0]))
    if (row.kind !== "itp_import")
      fail(422, "That AI draft is for something else")
    if (row.status !== "draft") fail(409, `This draft is already ${row.status}`)
    const draft = body.draft as ItpImportDraft
    const name = String(body.name ?? "").trim()
    const lines = (draft.sections ?? []).reduce(
      (n, s) => n + (s.lines?.length ?? 0),
      0,
    )
    if (!lines) fail(422, "Keep at least one line")
    const template = deps.createTemplate(
      name,
      (body.description as string) ?? null,
      draftToBody(draft, name),
    )
    const keys = ["roles", "sections"] as const
    const before = row.draft as ItpImportDraft
    row.edited =
      name !== before.name ||
      keys.some((k) => JSON.stringify(before[k]) !== JSON.stringify(draft[k]))
    row.status = "confirmed"
    row.decided_by = me
    row.decided_at = stamp()
    row.template_id = template.id
    return template
  })

  on("GET", "/ai/suggestions/{suggestion_id}", ({ params }) =>
    findRow(Number(params[0])),
  )
  on("GET", "/ai/suggestions", ({ query }) => {
    const findingId = query.get("finding_id")
    const photoId = query.get("photo_id")
    const templateId = query.get("template_id")
    if (templateId) {
      return suggestions.filter((s) => s.template_id === Number(templateId))
    }
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

  /** Increment 16: a report generated with an AI-drafted summary. */
  function confirmReport(id: number, inspectionId: number, summary: string) {
    const row = findRow(id)
    if (row.inspection_id !== inspectionId) fail(404, "Suggestion not found")
    if (row.kind !== "report") fail(422, "That AI draft is for something else")
    if (row.status !== "draft") fail(409, `This draft is already ${row.status}`)
    const proposed = String((row.draft as { summary?: string })?.summary ?? "")
    row.edited = proposed.trim() !== summary
    row.status = "confirmed"
    row.decided_by = me
    row.decided_at = stamp()
  }

  return { confirm, findingDiffers, tagsDiffer, confirmReport }
}
