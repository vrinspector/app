import { StatusBadge, type StatusTone } from "@/components/Common/StatusBadge"
import { classificationInfo, ITP_STATUS_TONE, percent } from "@/lib/itp"
import { cn } from "@/lib/utils"

/** Hold point / Witness point / Surveillance / Record. */
export function ClassificationBadge({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  const info = classificationInfo(value)
  return (
    <StatusBadge
      value={value}
      tone={info.tone}
      label={info.label}
      title={info.help}
      className={className}
      data-classification={value}
    />
  )
}

const CHIP_TONES: Record<StatusTone, string> = {
  positive:
    "border-status-positive-fg/40 bg-status-positive-bg text-status-positive-fg",
  attention:
    "border-status-attention-fg/40 bg-status-attention-bg text-status-attention-fg",
  critical:
    "border-status-critical-fg/40 bg-status-critical-bg text-status-critical-fg",
  settled:
    "border-status-settled-fg/40 bg-status-settled-bg text-status-settled-fg",
  neutral:
    "border-status-neutral-fg/30 bg-status-neutral-bg text-status-neutral-fg",
}

/**
 * Increment 13.8: the H / W / R / I letter in the line's left gutter. A hold
 * point that has been released turns green; the full name is the tooltip and
 * the accessible label.
 */
export function ClassificationChip({
  value,
  released = false,
}: {
  value: string
  released?: boolean
}) {
  const info = classificationInfo(value)
  const tone: StatusTone =
    info.short === "H" && released ? "positive" : info.tone
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md border font-heading text-sm font-bold",
        CHIP_TONES[tone],
      )}
      title={`${info.label}${info.short === "H" && released ? " (released)" : ""} — ${info.help}`}
      role="img"
      aria-label={info.label}
      data-testid="itp-classification-chip"
      data-classification={value}
    >
      {info.short}
    </span>
  )
}

/** Increment 13.8: the ITP's document number, e.g. ITP-LC4-007. */
export function DocNumber({
  value,
  className,
}: {
  value: string | null | undefined
  className?: string
}) {
  if (!value) return null
  return (
    <span
      className={cn(
        "font-mono text-xs font-semibold tracking-wide text-vri-copper",
        className,
      )}
      data-testid="itp-doc-number"
    >
      {value}
    </span>
  )
}

export function ItpStatusBadge({ value }: { value: string }) {
  return (
    <StatusBadge value={value} tone={ITP_STATUS_TONE[value] ?? "neutral"} />
  )
}

/** "12 of 20 recorded" with a slim bar; brick when a hold point waits. */
export function ItpProgress({
  done,
  total,
  openHolds = 0,
  className,
}: {
  done: number
  total: number
  openHolds?: number
  className?: string
}) {
  const pct = percent(done, total)
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${done} of ${total} lines recorded`}
      >
        <div
          className="h-full rounded-full bg-vri-green transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {done} of {total} recorded
        {openHolds ? (
          <span className="font-semibold text-status-critical-fg">
            {" "}
            · {openHolds} hold point{openHolds === 1 ? "" : "s"} waiting
          </span>
        ) : null}
      </p>
    </div>
  )
}
