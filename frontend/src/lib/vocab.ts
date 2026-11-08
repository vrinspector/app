import type { InspectionCreate, ProjectCreate } from "@/client"

/*
 * The controlled vocabularies the forms offer, with the labels the legacy
 * SPA's <select>s showed. Values are the ones the API stores and validates
 * (see docs/API_PORT.md); labels are display only.
 */

export type ProjectStatus = NonNullable<ProjectCreate["status"]>
export type InspectionType = NonNullable<InspectionCreate["inspection_type"]>

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
