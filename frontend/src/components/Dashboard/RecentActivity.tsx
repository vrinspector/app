import type { DashboardInspection } from "@/client"
import { ListCard } from "@/components/Common/ListCard"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { formatDate, joinMeta } from "@/lib/format"

/**
 * The legacy "Recent Activity" cards: the ten newest inspections across the
 * caller's projects with project name, inspector, date and a finding count
 * badge. Each card opens the inspection (the legacy cards were not
 * tappable; the API now returns `project_id`, so they can be).
 */
export function RecentActivity({
  inspections,
}: {
  inspections: DashboardInspection[]
}) {
  return (
    <ul className="grid gap-3 md:grid-cols-2" data-testid="recent-activity">
      {inspections.map((inspection) => (
        <ListCard
          key={inspection.id}
          data-testid="recent-inspection"
          to="/projects/$projectId/inspections/$inspectionId"
          params={{
            projectId: String(inspection.project_id),
            inspectionId: String(inspection.id),
          }}
          title={inspection.title}
          meta={joinMeta(
            inspection.project_name,
            inspection.inspector || null,
            formatDate(inspection.created_at),
          )}
          badges={
            <StatusBadge
              value="open"
              tone={inspection.finding_count > 0 ? "attention" : "neutral"}
              label={`${inspection.finding_count} finding${
                inspection.finding_count === 1 ? "" : "s"
              }`}
            />
          }
        />
      ))}
    </ul>
  )
}
