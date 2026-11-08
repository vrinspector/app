import { cn } from "@/lib/utils"

/**
 * Semantic tone for a status/priority badge. Maps to the `status-*` tokens in
 * index.css, which carry the legacy SPA's badge colours forward.
 */
export type StatusTone =
  | "positive"
  | "attention"
  | "critical"
  | "settled"
  | "neutral"

/**
 * Legacy vocabulary → tone. Keys are the values the API stores (see
 * docs/API_PORT.md): project status, inspection status, finding status and
 * finding priority share one lookup so a badge for "open" looks the same on
 * every screen.
 */
const TONE_BY_VALUE: Record<string, StatusTone> = {
  // project status (PROJECT_STATUSES)
  active: "positive",
  on_hold: "neutral",
  complete: "settled",
  // inspection status (INSPECTION_STATUSES) — "open" shared with findings
  closed: "settled",
  // finding status (FINDING_STATUSES)
  open: "attention",
  in_progress: "attention",
  resolved: "positive",
  // finding priority (FindingPriority)
  high: "critical",
  medium: "attention",
  low: "positive",
  // pin status (PIN_STATUSES)
  verified: "positive",
  punch_item: "critical",
  not_installed: "neutral",
  not_started: "neutral",
}

const TONE_CLASSES: Record<StatusTone, string> = {
  positive: "bg-status-positive-bg text-status-positive-fg",
  attention: "bg-status-attention-bg text-status-attention-fg",
  critical: "bg-status-critical-bg text-status-critical-fg",
  settled: "bg-status-settled-bg text-status-settled-fg",
  neutral: "bg-status-neutral-bg text-status-neutral-fg",
}

export function toneFor(value: string | null | undefined): StatusTone {
  if (!value) return "neutral"
  return TONE_BY_VALUE[value.toLowerCase().replace(/-/g, "_")] ?? "neutral"
}

/** "on_hold" → "On hold", "signed_off" → "Signed off". */
export function statusLabel(value: string | null | undefined): string {
  if (!value) return "Unknown"
  const words = value.replace(/[_-]+/g, " ").trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

interface StatusBadgeProps extends React.ComponentProps<"span"> {
  /** Raw value from the API, e.g. "open", "high", "on_hold". */
  value: string | null | undefined
  /** Override the inferred tone. */
  tone?: StatusTone
  /** Override the generated label. */
  label?: string
}

export function StatusBadge({
  value,
  tone,
  label,
  className,
  ...props
}: StatusBadgeProps) {
  const resolvedTone = tone ?? toneFor(value)
  return (
    <span
      data-slot="status-badge"
      data-tone={resolvedTone}
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap",
        TONE_CLASSES[resolvedTone],
        className,
      )}
      {...props}
    >
      {label ?? statusLabel(value)}
    </span>
  )
}
