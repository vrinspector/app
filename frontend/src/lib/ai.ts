import { queryOptions, useQuery } from "@tanstack/react-query"

import { AiService, type AiStatus } from "@/client"
import type { FindingPriority } from "./vocab"

/*
 * AI capture assistance (increment 15; PRD v2.62 Block 10A / 10B).
 *
 * The screens only ever show AI output as a *draft*: nothing is saved until
 * the inspector taps the usual Save / Log finding / File photo button, and
 * that save carries the draft's id so the server can log the confirmation
 * (and whether it was edited) next to the prompt and model version.
 *
 * `/ai/status` says whether the feature is switched on (an API key is set on
 * the server). When it is off — or the call fails — every AI button is
 * hidden and the app behaves exactly as before this increment.
 */

export const aiKeys = {
  status: ["ai", "status"] as const,
  findingLog: (findingId: number) => ["ai", "finding", findingId] as const,
}

export const aiStatusQuery = () =>
  queryOptions({
    queryKey: aiKeys.status,
    queryFn: async () => (await AiService.readStatus()).data as AiStatus,
    staleTime: 5 * 60_000,
    retry: false,
  })

/** True when AI drafts can be asked for (false while loading or on error). */
export function useAiEnabled(): boolean {
  const status = useQuery(aiStatusQuery())
  return status.data?.enabled === true
}

export const PHOTO_CATEGORY_OPTIONS = [
  { value: "progress", label: "Progress" },
  { value: "defect", label: "Defect" },
  { value: "safety", label: "Safety" },
  { value: "materials", label: "Materials" },
  { value: "equipment", label: "Equipment" },
  { value: "documentation", label: "Documentation" },
  { value: "other", label: "Other" },
] as const

export type PhotoCategory = (typeof PHOTO_CATEGORY_OPTIONS)[number]["value"]

export const DEFECT_TYPE_OPTIONS = [
  { value: "crack", label: "Crack" },
  { value: "corrosion", label: "Corrosion" },
  { value: "water_ingress", label: "Water ingress" },
  { value: "damage", label: "Damage" },
  { value: "safety_hazard", label: "Safety hazard" },
] as const

export type DefectType = (typeof DEFECT_TYPE_OPTIONS)[number]["value"]

export const SEVERITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const

export type Severity = (typeof SEVERITY_OPTIONS)[number]["value"]

export function labelOf(
  options: readonly { value: string; label: string }[],
  value: string | null | undefined,
): string {
  if (!value) return ""
  return options.find((o) => o.value === value)?.label ?? value
}

/** The defect list of a 10A photo draft, as the API returns it. */
export interface PhotoDraftDefect {
  type: DefectType
  note?: string
  confidence?: number | null
}

export interface PhotoDraft {
  category: PhotoCategory
  defects: PhotoDraftDefect[]
  severity: Severity | null
  title: string
  description: string
}

/** A 10B voice draft, as the API returns it. */
export interface VoiceDraft {
  title: string
  status: "open" | "in-progress" | "resolved"
  priority: FindingPriority
  discipline: string
  description: string
  location_ref: string | null
}

/** Pre-filled values for "Log as finding" from a photo draft. */
export interface FindingDraftSeed {
  suggestionId: number
  title: string
  description: string
  priority: FindingPriority
}

export function findingSeedFromPhotoDraft(
  suggestionId: number,
  draft: PhotoDraft,
): FindingDraftSeed {
  return {
    suggestionId,
    title: draft.title || "",
    description: draft.description || "",
    priority: draft.severity ?? "medium",
  }
}

/** Short, readable confidence ("82 %"), or nothing when the model gave none. */
export function confidenceText(value: number | null | undefined): string {
  if (value === null || value === undefined) return ""
  return `${Math.round(value * 100)} %`
}
