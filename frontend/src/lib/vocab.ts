import type { FindingCreate, InspectionCreate, ProjectCreate } from "@/client"

/*
 * The controlled vocabularies the forms offer, with the labels the legacy
 * SPA's <select>s showed. Values are the ones the API stores and validates
 * (see docs/API_PORT.md); labels are display only.
 */

export type ProjectStatus = NonNullable<ProjectCreate["status"]>
export type InspectionType = NonNullable<InspectionCreate["inspection_type"]>
export type FindingPriority = NonNullable<FindingCreate["priority"]>
export type FindingStatus = NonNullable<FindingCreate["status"]>

export interface Option<T extends string> {
  value: T
  label: string
}

export const PROJECT_STATUS_OPTIONS: Option<ProjectStatus>[] = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "complete", label: "Complete" },
]

export const INSPECTION_TYPE_OPTIONS: Option<InspectionType>[] = [
  { value: "civil", label: "Civil" },
  { value: "structural", label: "Structural" },
  { value: "mechanical", label: "Mechanical" },
  { value: "electrical", label: "Electrical" },
  { value: "piping", label: "Piping / P&ID" },
  { value: "general", label: "General" },
]

/** The legacy "New Finding" select: High / Medium (default) / Low. */
export const FINDING_PRIORITY_OPTIONS: Option<FindingPriority>[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

/** Block 8A defect-repair workflow, in the order the legacy status filter listed them. */
export const FINDING_STATUS_OPTIONS: Option<FindingStatus>[] = [
  { value: "open", label: "Open" },
  { value: "in-progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
]

export function optionLabel<T extends string>(
  options: Option<T>[],
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined
  return options.find((option) => option.value === value)?.label
}

export const PROJECT_STATUS_VALUES = PROJECT_STATUS_OPTIONS.map(
  (option) => option.value,
) as [ProjectStatus, ...ProjectStatus[]]

export const INSPECTION_TYPE_VALUES = INSPECTION_TYPE_OPTIONS.map(
  (option) => option.value,
) as [InspectionType, ...InspectionType[]]

export const FINDING_PRIORITY_VALUES = FINDING_PRIORITY_OPTIONS.map(
  (option) => option.value,
) as [FindingPriority, ...FindingPriority[]]

export const FINDING_STATUS_VALUES = FINDING_STATUS_OPTIONS.map(
  (option) => option.value,
) as [FindingStatus, ...FindingStatus[]]
