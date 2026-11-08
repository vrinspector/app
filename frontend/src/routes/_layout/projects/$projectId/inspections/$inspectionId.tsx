import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  CheckCircle2,
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import {
  type InspectionPublic,
  InspectionsService,
  type ProjectPublic,
} from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { PageHeader } from "@/components/Common/PageHeader"
import { DetailState, NotFoundState } from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { DrawingPickerMenu } from "@/components/Drawings/DrawingPickerMenu"
import { FindingsSection } from "@/components/Findings/FindingsSection"
import { InspectionFormDialog } from "@/components/Inspections/InspectionFormDialog"
import { WeatherBadge } from "@/components/Inspections/WeatherBadge"
import { CaptureBar, usePhotoPicker } from "@/components/Photos/PhotoCapture"
import { PhotosSection } from "@/components/Photos/PhotosSection"
import { ReportsSection } from "@/components/Reports/ReportsSection"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { usePhotoUpload } from "@/hooks/usePhotoUpload"
import { useProjectRole } from "@/hooks/useProjectRole"
import { formatDate, formatDateTime } from "@/lib/format"
import {
  inspectionKeys,
  inspectionQuery,
  parseId,
  projectKeys,
  projectQuery,
} from "@/lib/queries"
import { INSPECTION_TYPE_OPTIONS, optionLabel } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute(
  "/_layout/projects/$projectId/inspections/$inspectionId",
)({
  component: InspectionScreen,
  head: () => ({
    meta: [
      {
        title: "Inspection - VR Inspector",
      },
    ],
  }),
})

/**
 * One inspection (legacy `openInspection` → `renderFindingsScreen`): the
 * details, the Block 8B sign-off bar and actions, then the site photos
 * (camera-first capture) and the findings with the Block 8A workflow. On
 * phones a sticky capture bar keeps Take photo / Log finding under the
 * thumb while scrolling. Reports (the legacy "📄 Report" button, now with
 * version history) close the screen. The Block 5 weather badge sits above
 * the photos as it did on the legacy screen (increment 10.5).
 */
function InspectionScreen() {
  const { projectId: rawProjectId, inspectionId: rawInspectionId } =
    Route.useParams()
  const projectId = parseId(rawProjectId)
  const inspectionId = parseId(rawInspectionId)

  if (projectId === undefined || inspectionId === undefined) {
    return (
      <NotFoundState
        noun="inspection"
        backTo="/projects"
        backLabel="Back to projects"
      />
    )
  }
  return <InspectionDetail projectId={projectId} inspectionId={inspectionId} />
}

interface InspectionDetailProps {
  projectId: number
  inspectionId: number
}

function InspectionDetail({ projectId, inspectionId }: InspectionDetailProps) {
  const query = useQuery(inspectionQuery(inspectionId))
  const projectQ = useQuery(projectQuery(projectId))

  return (
    <DetailState
      query={query}
      noun="inspection"
      backTo="/projects/$projectId"
      backParams={{ projectId: String(projectId) }}
      backLabel="Back to the project"
      errorTitle="Couldn't load this inspection"
    >
      {(inspection) =>
        inspection.project_id !== projectId ? (
          // The URL names a different project than the inspection belongs to.
          <NotFoundState
            noun="inspection"
            backTo="/projects"
            backLabel="Back to projects"
          />
        ) : (
          <InspectionBody inspection={inspection} project={projectQ.data} />
        )
      }
    </DetailState>
  )
}

interface InspectionBodyProps {
  inspection: InspectionPublic
  project: ProjectPublic | undefined
}

function InspectionBody({ inspection, project }: InspectionBodyProps) {
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { canWrite } = useProjectRole(inspection.project_id)

  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [signingOff, setSigningOff] = useState(false)
  const [loggingFinding, setLoggingFinding] = useState(false)

  const photoUpload = usePhotoUpload(inspection.id)
  const picker = usePhotoPicker(photoUpload.addFiles)

  const isClosed = inspection.inspection_status === "closed"
  const type = inspection.inspection_type ?? inspection.type
  const projectParams = { projectId: String(inspection.project_id) }

  const applyUpdate = (updated: InspectionPublic) => {
    queryClient.setQueryData(inspectionKeys.detail(updated.id), updated)
    queryClient.invalidateQueries({
      queryKey: projectKeys.inspections(updated.project_id),
    })
  }

  const signoffMutation = useMutation({
    mutationFn: async () =>
      (
        await InspectionsService.signoffInspection({
          path: { inspection_id: inspection.id },
        })
      ).data as InspectionPublic,
    onSuccess: (updated) => {
      setSigningOff(false)
      showSuccessToast("Inspection signed off")
      applyUpdate(updated)
    },
    onError: (error: Error) => {
      setSigningOff(false)
      showErrorToast(extractErrorMessage(error))
    },
  })

  const reopenMutation = useMutation({
    mutationFn: async () =>
      (
        await InspectionsService.reopenInspection({
          path: { inspection_id: inspection.id },
        })
      ).data as InspectionPublic,
    onSuccess: (updated) => {
      showSuccessToast("Inspection reopened")
      applyUpdate(updated)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      InspectionsService.deleteInspection({
        path: { inspection_id: inspection.id },
      }),
    onSuccess: () => {
      showSuccessToast("Inspection deleted")
      queryClient.removeQueries({
        queryKey: inspectionKeys.detail(inspection.id),
      })
      queryClient.invalidateQueries({
        queryKey: projectKeys.inspections(inspection.project_id),
      })
      navigate({
        to: "/projects/$projectId",
        params: projectParams,
        replace: true,
      })
    },
    onError: (error: Error) => {
      setDeleting(false)
      showErrorToast(extractErrorMessage(error))
    },
  })

  return (
    <>
      <PageHeader
        eyebrow={project?.name ?? "Inspection"}
        title={inspection.title}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge
              value={inspection.inspection_status || inspection.status}
              data-testid="inspection-status"
            />
            {type ? (
              <StatusBadge
                value={type}
                tone="neutral"
                label={optionLabel(INSPECTION_TYPE_OPTIONS, type)}
              />
            ) : null}
            <span>
              {inspection.inspector || "Unassigned"}
              {inspection.created_at
                ? ` — ${formatDate(inspection.created_at)}`
                : ""}
            </span>
          </span>
        }
        backTo="/projects/$projectId"
        backParams={projectParams}
        backLabel="Back to the project"
        actions={
          canWrite ? (
            <>
              {isClosed ? (
                <LoadingButton
                  variant="outline"
                  loading={reopenMutation.isPending}
                  onClick={() => reopenMutation.mutate()}
                  data-testid="reopen-inspection"
                >
                  <RotateCcw />
                  Reopen
                </LoadingButton>
              ) : (
                <Button
                  onClick={() => setSigningOff(true)}
                  data-testid="signoff-inspection"
                >
                  <CheckCircle2 />
                  Sign off
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Inspection actions"
                    data-testid="inspection-actions"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => setEditing(true)}
                    disabled={isClosed}
                  >
                    <Pencil />
                    Edit inspection
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleting(true)}
                  >
                    <Trash2 />
                    Delete inspection
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      />

      {isClosed ? (
        <div
          role="status"
          data-testid="signoff-bar"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-vri-charcoal px-4 py-2 text-sm text-white"
        >
          <Lock className="size-4 text-vri-gold" aria-hidden="true" />
          <span>
            Signed off by{" "}
            <strong>{inspection.signed_off_by || "unknown"}</strong>
            {inspection.signed_off_at
              ? ` — ${formatDateTime(inspection.signed_off_at)}`
              : ""}
          </span>
          <span className="text-white/70">
            Findings can no longer be added or changed. Photos can still be
            added.
          </span>
        </div>
      ) : null}

      <dl
        className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-lg border bg-card p-4 text-sm"
        data-testid="inspection-details"
      >
        <dt className="font-medium text-muted-foreground">Type</dt>
        <dd>
          {optionLabel(INSPECTION_TYPE_OPTIONS, type) ?? type ?? (
            <Muted>Not set</Muted>
          )}
        </dd>
        <dt className="font-medium text-muted-foreground">Inspector</dt>
        <dd>{inspection.inspector || <Muted>Unassigned</Muted>}</dd>
        <dt className="font-medium text-muted-foreground">Created</dt>
        <dd>{formatDateTime(inspection.created_at)}</dd>
        <dt className="font-medium text-muted-foreground">Notes</dt>
        <dd className="whitespace-pre-wrap">
          {inspection.notes || <Muted>No notes</Muted>}
        </dd>
      </dl>

      <WeatherBadge inspectionId={inspection.id} />

      <PhotosSection
        inspectionId={inspection.id}
        canWrite={canWrite}
        uploads={photoUpload.uploads}
        onTakePhoto={picker.openCamera}
        onChoosePhotos={picker.openLibrary}
        onRetryUpload={photoUpload.retry}
        onDismissUpload={photoUpload.dismiss}
      />

      <FindingsSection
        projectId={inspection.project_id}
        inspectionId={inspection.id}
        canWrite={canWrite}
        closed={isClosed}
        logging={loggingFinding}
        onLoggingChange={setLoggingFinding}
      />

      <ReportsSection inspectionId={inspection.id} />

      {picker.inputs}
      {canWrite ? (
        <>
          {/* Room for the capture bar so the last card is never hidden under it. */}
          <div className="h-16 sm:hidden" aria-hidden="true" />
          <CaptureBar
            onTakePhoto={picker.openCamera}
            onLogFinding={() => setLoggingFinding(true)}
            canLogFinding={!isClosed}
            extra={
              isClosed ? null : (
                <DrawingPickerMenu
                  projectId={inspection.project_id}
                  inspectionId={inspection.id}
                  compact
                />
              )
            }
          />
        </>
      ) : null}

      <InspectionFormDialog
        open={editing}
        onOpenChange={setEditing}
        projectId={inspection.project_id}
        inspection={inspection}
      />
      <ConfirmDialog
        open={signingOff}
        onOpenChange={setSigningOff}
        title="Sign off this inspection?"
        description="Signing off closes the inspection and records your name and the time. Findings and photos can no longer be added until it is reopened."
        confirmLabel="Sign off"
        pending={signoffMutation.isPending}
        onConfirm={() => signoffMutation.mutate()}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this inspection?"
        description={
          <>
            <strong>{inspection.title}</strong> and all of its findings and
            photos will be removed. This cannot be undone.
          </>
        }
        confirmLabel="Delete inspection"
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
