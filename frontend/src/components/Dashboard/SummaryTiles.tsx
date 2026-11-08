import {
  AlertTriangle,
  Camera,
  CircleAlert,
  FolderKanban,
  Search,
} from "lucide-react"

import type { DashboardSummary } from "@/client"
import { cn } from "@/lib/utils"

/**
 * The five legacy `dashCard`s: Projects, Inspections, Open Findings, High
 * Priority, Photos. A tile turns brick-red when its count is above zero and
 * asks for attention (open and high-priority findings), exactly as the
 * legacy `#7a2020` background did.
 */
export function SummaryTiles({ summary }: { summary: DashboardSummary }) {
  const tiles = [
    {
      key: "projects",
      label: "Projects",
      value: summary.total_projects,
      icon: FolderKanban,
      alert: false,
    },
    {
      key: "inspections",
      label: "Inspections",
      value: summary.total_inspections,
      icon: Search,
      alert: false,
    },
    {
      key: "open",
      label: "Open findings",
      value: summary.open_findings,
      icon: AlertTriangle,
      alert: summary.open_findings > 0,
    },
    {
      key: "high",
      label: "High priority",
      value: summary.high_priority_findings,
      icon: CircleAlert,
      alert: summary.high_priority_findings > 0,
    },
    {
      key: "photos",
      label: "Photos",
      value: summary.total_photos,
      icon: Camera,
      alert: false,
    },
  ]

  return (
    <ul
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      data-testid="summary-tiles"
      aria-label="Totals across your projects"
    >
      {tiles.map((tile) => (
        <li
          key={tile.key}
          data-testid={`tile-${tile.key}`}
          data-alert={tile.alert ? "true" : undefined}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg px-3 py-4 text-center text-vri-offwhite shadow-sm last:col-span-2 sm:last:col-span-1",
            tile.alert ? "bg-vri-brick" : "bg-vri-green",
          )}
        >
          <tile.icon className="size-6 opacity-90" aria-hidden="true" />
          <span className="text-3xl font-bold leading-none tabular-nums">
            {tile.value}
          </span>
          <span className="text-[0.7rem] font-medium uppercase tracking-wider opacity-85">
            {tile.label}
          </span>
        </li>
      ))}
    </ul>
  )
}
