import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowRight, ClipboardList, FolderKanban } from "lucide-react"

import type { DashboardPublic } from "@/client"
import { PageHeader } from "@/components/Common/PageHeader"
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
} from "@/components/Common/States"
import { ProjectHealthTable } from "@/components/Dashboard/ProjectHealthTable"
import { RecentActivity } from "@/components/Dashboard/RecentActivity"
import { SummaryTiles } from "@/components/Dashboard/SummaryTiles"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import { dashboardQuery } from "@/lib/queries"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "Dashboard - VR Inspector",
      },
    ],
  }),
})

/**
 * The landing screen (legacy `loadDashboard` → `renderDashboard`): the five
 * summary tiles, the Project Health table and Recent Activity, from the
 * Block 6 roll-up at `GET /dashboard`. Re-read on every visit, as the
 * legacy screen was.
 */
function Dashboard() {
  const { user } = useAuth()
  const greeting = user?.name || user?.email || "Inspector"
  const query = useQuery(dashboardQuery())

  return (
    <>
      <PageHeader
        title={
          <span data-testid="greeting">
            Hi, {greeting} <span aria-hidden="true">👋</span>
          </span>
        }
        description="Here is where things stand across your projects."
        actions={
          <Button asChild variant="outline">
            <Link to="/projects" data-testid="all-projects">
              <FolderKanban />
              All projects
            </Link>
          </Button>
        }
      />

      {query.isPending ? (
        <DashboardSkeleton />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load the dashboard"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : (
        <DashboardBody data={query.data} />
      )}
    </>
  )
}

function DashboardBody({ data }: { data: DashboardPublic }) {
  return (
    <>
      <SummaryTiles summary={data.summary} />

      <section aria-labelledby="health-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="health-heading" className="text-lg font-semibold">
            Project health
          </h2>
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link to="/projects">
              All projects
              <ArrowRight />
            </Link>
          </Button>
        </div>
        {data.projects.length === 0 ? (
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            description="Create your first project to start logging inspections."
            action={
              <Button asChild>
                <Link to="/projects">Go to projects</Link>
              </Button>
            }
            className="py-8"
          />
        ) : (
          <ProjectHealthTable projects={data.projects} />
        )}
      </section>

      <section
        aria-labelledby="activity-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="activity-heading" className="text-lg font-semibold">
          Recent activity
        </h2>
        {data.recent_inspections.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No inspections yet"
            description="The ten most recent inspections across your projects appear here."
            className="py-8"
          />
        ) : (
          <RecentActivity inspections={data.recent_inspections} />
        )}
      </section>
    </>
  )
}

function DashboardSkeleton() {
  return (
    <output
      aria-busy="true"
      aria-label="Loading the dashboard"
      data-testid="dashboard-skeleton"
      className="flex flex-col gap-6"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {["projects", "inspections", "open", "high", "photos"].map((key) => (
          <Skeleton key={key} className="h-24 rounded-lg" />
        ))}
      </div>
      <ListSkeleton rows={3} />
    </output>
  )
}
