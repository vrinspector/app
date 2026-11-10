import { StatusBadge } from "@/components/Common/StatusBadge"
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
