import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import { z } from "zod"

import { type DrawingPublic, DrawingsService } from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { PageHeader } from "@/components/Common/PageHeader"
import {
  DetailState,
  LoadingState,
  NotFoundState,
} from "@/components/Common/States"
import { DrawingFormDialog } from "@/components/Drawings/DrawingFormDialog"
import { DrawingViewer } from "@/components/Drawings/DrawingViewer"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useCustomToast from "@/hooks/useCustomToast"
import { useProjectRole } from "@/hooks/useProjectRole"
import { formatDate, joinMeta } from "@/lib/format"
import {
  drawingKeys,
  drawingQuery,
  drawingViewUrlQuery,
  parseId,
  projectKeys,
  projectQuery,
} from "@/lib/queries"
import { DRAWING_DISCIPLINE_OPTIONS, optionLabel } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/**
 * `?inspection=N` — the inspection the viewer was opened from (increment
 * 11a): findings logged from a pin are pre-filed into it. Anything else is
 * ignored rather than rejected.
 */
const searchSchema = z.object({
  inspection: z.coerce.number().int().positive().optional().catch(undefined),
  /** Increment 13: place a pin that marks this ITP line ("Mark on drawing"). */
  itpItem: z.coerce.number().int().positive().optional().catch(undefined),
})

export const Route = createFileRoute(
  "/_layout/projects/$projectId/drawings/$drawingId",
)({
  component: DrawingScreen,
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      {
        title: "Drawing - VR Inspector",
      },
    ],
  }),
})

/**
 * One drawing with its pins (legacy `openDrawingViewer`): header with the
 * sheet's title, number and discipline, then the viewer. Inspectors and
 * owners can rename the sheet or delete it from the header menu.
 */
function DrawingScreen() {
  const { projectId: rawProjectId, drawingId: rawDrawingId } = Route.useParams()
  const projectId = parseId(rawProjectId)
  const drawingId = parseId(rawDrawingId)

  if (projectId === undefined) {
    return (
      <NotFoundState
        noun="project"
        backTo="/projects"
        backLabel="Back to projects"
      />
    )
  }
  if (drawingId === undefined) {
    return <DrawingNotFound projectId={projectId} />
  }
  return <DrawingDetail projectId={projectId} drawingId={drawingId} />
}

function DrawingNotFound({ projectId }: { projectId: number }) {
  return (
    <NotFoundState
      noun="drawing"
      backTo="/projects/$projectId"
      backParams={{ projectId: String(projectId) }}
      backLabel="Back to project"
    />
  )
}

function DrawingDetail({
  projectId,
  drawingId,
}: {
  projectId: number
  drawingId: number
}) {
  const query = useQuery(drawingQuery(drawingId))

  return (
    <DetailState
      query={query}
      noun="drawing"
      backTo="/projects/$projectId"
      backParams={{ projectId: String(projectId) }}
      backLabel="Back to project"
      errorTitle="Couldn't load this drawing"
    >
      {(drawing) =>
        drawing.project_id !== projectId ? (
          <DrawingNotFound projectId={projectId} />
        ) : (
          <DrawingBody projectId={projectId} drawing={drawing} />
        )
      }
    </DetailState>
  )
}

function DrawingBody({
  projectId,
  drawing,
}: {
  projectId: number
  drawing: DrawingPublic
}) {
  const navigate = Route.useNavigate()
  const { inspection: inspectionId, itpItem: itpItemId } = Route.useSearch()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { canWrite } = useProjectRole(projectId)
  const project = useQuery(projectQuery(projectId))
  const viewUrl = useQuery(drawingViewUrlQuery(drawing.id))
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () =>
      DrawingsService.deleteDrawing({ path: { drawing_id: drawing.id } }),
    onSuccess: () => {
      showSuccessToast("Drawing deleted")
      queryClient.removeQueries({ queryKey: drawingKeys.detail(drawing.id) })
      queryClient.invalidateQueries({
        queryKey: projectKeys.drawings(projectId),
      })
      navigate({
        to: "/projects/$projectId",
        params: { projectId: String(projectId) },
        replace: true,
      })
    },
    onError: (error: Error) => {
      setDeleting(false)
      showErrorToast(extractErrorMessage(error))
    },
  })

  const discipline = optionLabel(DRAWING_DISCIPLINE_OPTIONS, drawing.discipline)

  return (
    <>
      <PageHeader
        eyebrow={project.data?.name ?? "Drawing"}
        title={drawing.title || drawing.filename}
        description={joinMeta(
          drawing.drawing_number,
          discipline ?? drawing.discipline,
          formatDate(drawing.created_at),
        )}
        backTo="/projects/$projectId"
        backParams={{ projectId: String(projectId) }}
        backLabel="Back to project"
        className="pb-3"
        actions={
          canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Drawing actions"
                  data-testid="drawing-actions"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil />
                  Edit drawing
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleting(true)}
                >
                  <Trash2 />
                  Delete drawing
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />

      {viewUrl.isPending ? (
        <LoadingState message="Fetching the drawing…" />
      ) : viewUrl.isError ? (
        <DetailState
          query={viewUrl}
          noun="drawing"
          backTo="/projects/$projectId"
          backParams={{ projectId: String(projectId) }}
          backLabel="Back to project"
          errorTitle="Couldn't fetch the drawing file"
        >
          {() => null}
        </DetailState>
      ) : (
        <DrawingViewer
          key={viewUrl.data}
          projectId={projectId}
          drawing={drawing}
          viewUrl={viewUrl.data}
          canWrite={canWrite}
          onRetry={() => viewUrl.refetch()}
          inspectionId={inspectionId ?? null}
          itpItemId={itpItemId ?? null}
        />
      )}

      <DrawingFormDialog
        open={editing}
        onOpenChange={setEditing}
        drawing={drawing}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this drawing?"
        description={
          <>
            <strong>{drawing.title || drawing.filename}</strong> and every pin
            on it will be removed for every member. Findings linked from its
            pins are kept. This cannot be undone.
          </>
        }
        confirmLabel="Delete drawing"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  )
}
