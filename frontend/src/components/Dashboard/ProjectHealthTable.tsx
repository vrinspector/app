import { Link } from "@tanstack/react-router"
import { ArrowRight } from "lucide-react"

import type { DashboardProject } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * The legacy "Project Health" table: one row per project with inspection,
 * open-finding, high-priority and photo counts, the last inspection date
 * and an "Inspect" button that opens the project. Open and high counts are
 * emphasised in copper / red when above zero, as the legacy cells were.
 *
 * On phones the table scrolls sideways inside its card rather than
 * squeezing seven columns into 360 px; the project name column stays
 * readable and the Inspect button is at the end of the row.
 */
export function ProjectHealthTable({
  projects,
}: {
  projects: DashboardProject[]
}) {
  return (
    <>
      {/* Phones: one card per project; seven columns do not fit 360 px. */}
      <ul className="grid gap-3 sm:hidden" data-testid="project-health-cards">
        {projects.map((project) => (
          <li key={project.id} className="list-none">
            <Link
              to="/projects/$projectId"
              params={{ projectId: String(project.id) }}
              className="group flex items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-vri-gold focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold">{project.name}</h3>
                <p className="truncate text-sm text-muted-foreground">
                  {project.client || "No client"} · last inspected{" "}
                  {project.last_inspected}
                </p>
                <dl className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                  <Stat label="Insp" value={project.inspection_count} />
                  <Stat
                    label="Open"
                    value={project.open_finding_count}
                    tone="copper"
                  />
                  <Stat
                    label="High"
                    value={project.high_finding_count}
                    tone="red"
                  />
                  <Stat label="Photos" value={project.photo_count} />
                </dl>
              </div>
              <ArrowRight
                className="size-5 shrink-0 text-vri-gold transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-lg border bg-card sm:block">
        <Table data-testid="project-health">
          <TableHeader>
            <TableRow className="bg-vri-green hover:bg-vri-green">
              <TableHead className="text-vri-offwhite">Project</TableHead>
              <TableHead className="text-center text-vri-offwhite">
                Insp
              </TableHead>
              <TableHead className="text-center text-vri-offwhite">
                Open
              </TableHead>
              <TableHead className="text-center text-vri-offwhite">
                High
              </TableHead>
              <TableHead className="text-center text-vri-offwhite">
                Photos
              </TableHead>
              <TableHead className="text-vri-offwhite">Last insp</TableHead>
              <TableHead className="text-vri-offwhite">
                <span className="sr-only">Open project</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id} data-testid="health-row">
                <TableCell className="max-w-[16rem]">
                  <div className="truncate font-semibold">{project.name}</div>
                  {project.client ? (
                    <div className="truncate text-xs text-muted-foreground">
                      {project.client}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-center tabular-nums">
                  {project.inspection_count}
                </TableCell>
                <Count value={project.open_finding_count} tone="copper" />
                <Count value={project.high_finding_count} tone="red" />
                <TableCell className="text-center tabular-nums">
                  {project.photo_count}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {project.last_inspected}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: String(project.id) }}
                      aria-label={`Inspect ${project.name}`}
                    >
                      Inspect
                      <ArrowRight />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: "copper" | "red"
}) {
  return (
    <div className="rounded-md bg-background px-1 py-1.5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "text-base font-semibold tabular-nums",
          value > 0 && tone === "copper" && "text-vri-copper",
          value > 0 && tone === "red" && "text-status-critical-fg",
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function Count({ value, tone }: { value: number; tone: "copper" | "red" }) {
  return (
    <TableCell
      className={cn(
        "text-center tabular-nums",
        value > 0
          ? cn(
              "font-bold",
              tone === "copper" ? "text-vri-copper" : "text-status-critical-fg",
            )
          : "text-muted-foreground",
      )}
      data-nonzero={value > 0 ? "true" : undefined}
    >
      {value}
    </TableCell>
  )
}
