import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import type { ProjectItpSummary } from "@/client"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { formatDate, joinMeta } from "@/lib/format"

import { ItpProgress, ItpStatusBadge } from "./ItpBadges"

/** One ITP as a tappable card: title, area, status, progress, hold points. */
export function ItpCard({
  projectId,
  itp,
  showArea = true,
}: {
  projectId: number
  itp: ProjectItpSummary
  showArea?: boolean
}) {
  return (
    <li className="list-none">
      <Link
        to="/projects/$projectId/itps/$itpId"
        params={{ projectId: String(projectId), itpId: String(itp.id) }}
        data-testid="itp-card"
        className="group flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-vri-gold focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{itp.title}</h3>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {joinMeta(
              showArea ? (itp.area_name ?? "Whole project") : null,
              itp.template_version ? `template v${itp.template_version}` : null,
              formatDate(itp.created_at),
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ItpStatusBadge value={itp.status} />
            {itp.hold_count ? (
              <StatusBadge
                value="hold"
                tone={itp.open_hold_count ? "critical" : "positive"}
                label={
                  itp.open_hold_count
                    ? `${itp.open_hold_count} hold point${itp.open_hold_count === 1 ? "" : "s"} waiting`
                    : "Hold points released"
                }
                data-testid="itp-hold-badge"
              />
            ) : null}
            {itp.fail_count ? (
              <StatusBadge
                value="fail"
                tone="critical"
                label={`${itp.fail_count} failed`}
              />
            ) : null}
          </div>
          <ItpProgress
            className="mt-2"
            done={itp.done_count}
            total={itp.item_count}
          />
        </div>
        <ChevronRight
          className="size-5 shrink-0 text-vri-gold transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </Link>
    </li>
  )
}
