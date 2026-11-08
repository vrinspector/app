import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  ClipboardList,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"

import {
  type InspectionPublic,
  type ProjectPublic,
  ProjectsService,
} from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { FilterInput } from "@/components/Common/FilterInput"
import { ListCard } from "@/components/Common/ListCard"
import { PageHeader } from "@/components/Common/PageHeader"
import {
  DetailState,
  EmptyState,
  NotFoundState,
  QueryState,
} from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { DrawingsSection } from "@/components/Drawings/DrawingsSection"
import { InspectionFormDialog } from "@/components/Inspections/InspectionFormDialog"
import { ProjectFormDialog } from "@/components/Projects/ProjectFormDialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useProjectRole } from "@/hooks/useProjectRole"
import { formatDate, joinMeta, matchesFilter } from "@/lib/format"
import {
  inspectionsQuery,
  parseId,
  projectKeys,
  projectQuery,
} from "@/lib/queries"
import { INSPECTION_TYPE_OPTIONS, optionLabel } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute("/_layout/projects/$projectId/")({
  component: ProjectScreen,
  head: () => ({
    meta: [
      {
        title: "Project - VR Inspector",
      },
    ],
  }),
})

/**
 * One project (legacy `openProject` → `renderInspections`): the project's
 * details, then its inspections with a filter box and "New inspection".
 * Owners can edit or delete the project from the header menu. Drawings
 * (increment 09) follow the inspections, as on the legacy screen; the
 * members panel (increment 10) joins later.
 */
function ProjectScreen() {
  const { projectId: rawId } = Route.useParams()
  const projectId = parseId(rawId)

  if (projectId === undefined) {
    return (
      <NotFoundState
        noun="project"
        backTo="/projects"
        backLabel="Back to projects"
      />
    )
  }
  return <ProjectDetail projectId={projectId} />
}

function ProjectDetail({ projectId }: { projectId: number }) {
  const query = useQuery(projectQuery(projectId))

  return (
    <DetailState
      query={query}
      noun="project"
      backTo="/projects"
      backLabel="Back to projects"
      errorTitle="Couldn't load this project"
    >
      {(project) => <ProjectBody project={project} />}
    </DetailState>
  )
}

function ProjectBody({ project }: { project: ProjectPublic }) {
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { user } = useAuth()
  const { canWrite, canManage } = useProjectRole(project.id)

  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [creatingInspection, setCreatingInspection] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () =>
      ProjectsService.deleteProject({ path: { project_id: project.id } }),
    onSuccess: () => {
      showSuccessToast("Project deleted")
      queryClient.removeQueries({ queryKey: projectKeys.detail(project.id) })
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
      navigate({ to: "/projects", replace: true })
    },
    onError: (error: Error) => {
      setDeleting(false)
      showErrorToast(extractErrorMessage(error))
    },
  })

  const newInspectionButton = canWrite ? (
    <Button
      onClick={() => setCreatingInspection(true)}
      data-testid="new-inspection"
    >
      <Plus />
      New inspection
    </Button>
  ) : null

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title={project.name}
        description={joinMeta(
          project.client || "No client",
          project.location || "No location",
        )}
        backTo="/projects"
        backLabel="Back to projects"
        actions={
          <>
            {newInspectionButton}
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Project actions"
                    data-testid="project-actions"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil />
                    Edit project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(true)}
                  >
                    <Trash2 />
                    Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <dl
        className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-lg border bg-card p-4 text-sm"
        data-testid="project-details"
      >
        <dt className="font-medium text-muted-foreground">Status</dt>
        <dd>
          <StatusBadge value={project.status || "active"} />
        </dd>
        <dt className="font-medium text-muted-foreground">Client / owner</dt>
        <dd>{project.client || <Muted>Not set</Muted>}</dd>
        <dt className="font-medium text-muted-foreground">Location</dt>
        <dd>{project.location || <Muted>Not set</Muted>}</dd>
        <dt className="font-medium text-muted-foreground">Created</dt>
        <dd>
          {formatDate(project.created_at)}
          {project.created_by ? <Muted> by {project.created_by}</Muted> : null}
        </dd>
      </dl>

      <InspectionsSection
        projectId={project.id}
        newInspectionButton={newInspectionButton}
      />

      <DrawingsSection projectId={project.id} canWrite={canWrite} />

      <p className="text-xs text-muted-foreground">
        The members panel for this project is being rebuilt and will appear
        here.
      </p>

      <ProjectFormDialog
        open={editing}
        onOpenChange={setEditing}
        project={project}
        onSaved={(saved) =>
          queryClient.setQueryData(projectKeys.detail(saved.id), saved)
        }
      />
      <InspectionFormDialog
        open={creatingInspection}
        onOpenChange={setCreatingInspection}
        projectId={project.id}
        defaultInspector={user?.name}
        onSaved={(inspection) =>
          navigate({
            to: "/projects/$projectId/inspections/$inspectionId",
            params: {
              projectId: String(project.id),
              inspectionId: String(inspection.id),
            },
          })
        }
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this project?"
        description={
          <>
            <strong>{project.name}</strong> and all of its inspections,
            findings, photos and drawings will be removed for every member. This
            cannot be undone.
          </>
        }
        confirmLabel="Delete project"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

interface InspectionsSectionProps {
  projectId: number
  newInspectionButton: React.ReactNode
}

function InspectionsSection({
  projectId,
  newInspectionButton,
}: InspectionsSectionProps) {
  const query = useQuery(inspectionsQuery(projectId))
  const [filter, setFilter] = useState("")

  return (
    <section
      aria-labelledby="inspections-heading"
      className="flex flex-col gap-3"
    >
      <QueryState
        query={query}
        errorTitle="Couldn't load the inspections"
        empty={
          <>
            <h2 id="inspections-heading" className="text-lg font-semibold">
              Inspections <span className="text-muted-foreground">(0)</span>
            </h2>
            <EmptyState
              icon={<ClipboardList />}
              title="No inspections yet"
              description="Start your first site walk. Findings and photos are logged inside an inspection."
              action={newInspectionButton}
            />
          </>
        }
      >
        {(inspections) => (
          <InspectionList
            projectId={projectId}
            inspections={inspections}
            filter={filter}
            onFilterChange={setFilter}
          />
        )}
      </QueryState>
    </section>
  )
}

interface InspectionListProps {
  projectId: number
  inspections: InspectionPublic[]
  filter: string
  onFilterChange: (value: string) => void
}

function InspectionList({
  projectId,
  inspections,
  filter,
  onFilterChange,
}: InspectionListProps) {
  const visible = useMemo(
    () =>
      inspections.filter((inspection) =>
        matchesFilter(
          filter,
          inspection.title,
          inspection.type,
          inspection.inspection_type,
          optionLabel(INSPECTION_TYPE_OPTIONS, inspection.inspection_type),
          inspection.inspector,
        ),
      ),
    [inspections, filter],
  )

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="inspections-heading" className="text-lg font-semibold">
          Inspections{" "}
          <span
            className="text-muted-foreground"
            data-testid="inspections-count"
          >
            (
            {visible.length === inspections.length
              ? inspections.length
              : `${visible.length} of ${inspections.length}`}
            )
          </span>
        </h2>
        <FilterInput
          value={filter}
          onChange={onFilterChange}
          placeholder="Filter inspections…"
          label="Filter inspections"
          className="sm:w-72"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No inspections match"
          description={`Nothing matches “${filter.trim()}”. Try a title, type or inspector.`}
          action={
            <Button variant="outline" onClick={() => onFilterChange("")}>
              Clear filter
            </Button>
          }
          className="py-8"
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="inspection-list">
          {visible.map((inspection) => {
            const type = inspection.inspection_type ?? inspection.type
            return (
              <ListCard
                key={inspection.id}
                data-testid="inspection-card"
                to="/projects/$projectId/inspections/$inspectionId"
                params={{
                  projectId: String(projectId),
                  inspectionId: String(inspection.id),
                }}
                title={inspection.title}
                meta={joinMeta(
                  inspection.inspector || "Unassigned",
                  formatDate(inspection.created_at),
                )}
                badges={
                  <>
                    <StatusBadge
                      value={
                        inspection.inspection_status ||
                        inspection.status ||
                        "open"
                      }
                    />
                    {type ? (
                      <StatusBadge
                        value={type}
                        tone="neutral"
                        label={optionLabel(INSPECTION_TYPE_OPTIONS, type)}
                      />
                    ) : null}
                  </>
                }
              />
            )
          })}
        </ul>
      )}
    </>
  )
}
