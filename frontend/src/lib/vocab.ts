import type {
  DrawingCreate,
  FindingCreate,
  InspectionCreate,
  PinCreate,
  ProjectCreate,
} from "@/client"

/*
 * The controlled vocabularies the forms offer, with the labels the legacy
 * SPA's <select>s showed. Values are the ones the API stores and validates
 * (see docs/API_PORT.md); labels are display only.
 */

export type ProjectStatus = NonNullable<ProjectCreate["status"]>
export type InspectionType = NonNullable<InspectionCreate["inspection_type"]>
export type FindingPriority = NonNullable<FindingCreate["priority"]>
export type FindingStatus = NonNullable<FindingCreate["status"]>
export type DrawingDiscipline = NonNullable<DrawingCreate["discipline"]>
export type DrawingFileType = NonNullable<DrawingCreate["file_type"]>
export type PinStatus = NonNullable<PinCreate["status"]>

export interface Option<T extends string> {
  value: T
  label: string
}

/** Block 8D drawing disciplines, as the API validates them. */
export const DRAWING_DISCIPLINE_OPTIONS: Option<DrawingDiscipline>[] = [
  { value: "general", label: "General" },
  { value: "pid", label: "P&ID" },
  { value: "grading", label: "Grading" },
  { value: "civil_structural", label: "Civil / structural" },
  { value: "equipment_layout", label: "Equipment layout" },
  { value: "steel_erection", label: "Steel erection" },
  { value: "electrical", label: "Electrical" },
  { value: "other", label: "Other" },
]

/** The file types the legacy upload input accepted (and the API validates). */
export const DRAWING_FILE_TYPES: DrawingFileType[] = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "svg",
]

/**
 * Block 8D pin statuses with the legacy SPA's marker colours (`PIN_COLORS`),
 * in the order its status picker listed them. The colours are fixed
 * semantics on the drawing (the Help page documents them), so they are kept
 * as literal values rather than mapped to the theme.
 */
export interface PinStatusOption extends Option<PinStatus> {
  color: string
}

export const PIN_STATUS_OPTIONS: PinStatusOption[] = [
  { value: "not_started", label: "Not started", color: "#6c757d" },
  { value: "in_progress", label: "In progress", color: "#007bff" },
  { value: "verified", label: "Verified", color: "#28a745" },
  { value: "punch_item", label: "Punch item", color: "#ffc107" },
  { value: "not_installed", label: "Not installed", color: "#dc3545" },
]

export function pinStatusOption(
  value: string | null | undefined,
): PinStatusOption {
  return (
    PIN_STATUS_OPTIONS.find((option) => option.value === value) ??
    PIN_STATUS_OPTIONS[0]
  )
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

export const DRAWING_DISCIPLINE_VALUES = DRAWING_DISCIPLINE_OPTIONS.map(
  (option) => option.value,
) as [DrawingDiscipline, ...DrawingDiscipline[]]

export const PIN_STATUS_VALUES = PIN_STATUS_OPTIONS.map(
  (option) => option.value,
) as [PinStatus, ...PinStatus[]]
