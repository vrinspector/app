import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { FolderKanban, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import type { ProjectPublic } from "@/client"
import { FilterInput } from "@/components/Common/FilterInput"
import { ListCard } from "@/components/Common/ListCard"
import { PageHeader } from "@/components/Common/PageHeader"
import { EmptyState, QueryState } from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { ProjectFormDialog } from "@/components/Projects/ProjectFormDialog"
import { Button } from "@/components/ui/button"
import { joinMeta, matchesFilter } from "@/lib/format"
import { projectsQuery } from "@/lib/queries"

export const Route = createFileRoute("/_layout/projects/")({
  component: ProjectsScreen,
  head: () => ({
    meta: [
      {
        title: "Projects - VR Inspector",
      },
    ],
  }),
})

/**
 * The project list (legacy `renderProjects`): every project the signed-in
 * person is a member of, newest first as the API returns them, a
 * client-side filter box, and "New project". Tapping a card opens the
 * project (its inspections).
 */
function ProjectsScreen() {
  const query = useQuery(projectsQuery())
  const [filter, setFilter] = useState("")
  const [creating, setCreating] = useState(false)
  const navigate = Route.useNavigate()

  const newProjectButton = (
    <Button onClick={() => setCreating(true)} data-testid="new-project">
      <Plus />
      New project
    </Button>
  )

  return (
    <>
      <PageHeader
        title="Projects"
        description="Every project you are a member of, with its inspections."
        actions={newProjectButton}
      />

      <QueryState
        query={query}
        errorTitle="Couldn't load your projects"
        empty={
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            description="Create your first project to start logging inspections."
            action={newProjectButton}
          />
        }
      >
        {(projects) => (
          <ProjectList
            projects={projects}
            filter={filter}
            onFilterChange={setFilter}
          />
        )}
      </QueryState>

      <ProjectFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(project) =>
          navigate({
            to: "/projects/$projectId",
            params: { projectId: String(project.id) },
          })
        }
      />
    </>
  )
}

interface ProjectListProps {
  projects: ProjectPublic[]
  filter: string
  onFilterChange: (value: string) => void
}

function ProjectList({ projects, filter, onFilterChange }: ProjectListProps) {
  const visible = useMemo(
    () =>
      projects.filter((project) =>
        matchesFilter(filter, project.name, project.client, project.location),
      ),
    [projects, filter],
  )

  return (
    <section aria-labelledby="projects-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="projects-heading" className="text-lg font-semibold">
          Projects{" "}
          <span className="text-muted-foreground" data-testid="projects-count">
            (
            {visible.length === projects.length
              ? projects.length
              : `${visible.length} of ${projects.length}`}
            )
          </span>
        </h2>
        <FilterInput
          value={filter}
          onChange={onFilterChange}
          placeholder="Filter projects…"
          label="Filter projects"
          className="sm:w-72"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No projects match"
          description={`Nothing matches “${filter.trim()}”. Try another name, client or location.`}
          action={
            <Button variant="outline" onClick={() => onFilterChange("")}>
              Clear filter
            </Button>
          }
          className="py-8"
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="project-list">
          {visible.map((project) => (
            <ListCard
              key={project.id}
              data-testid="project-card"
              to="/projects/$projectId"
              params={{ projectId: String(project.id) }}
              title={project.name}
              meta={joinMeta(
                project.client || "No client",
                project.location || "No location",
              )}
              badges={<StatusBadge value={project.status || "active"} />}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
