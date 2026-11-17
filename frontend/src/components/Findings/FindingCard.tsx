import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Camera,
  CheckCircle2,
  ChevronDown,
  CloudUpload,
  MapPin,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react"
import { useRef, useState } from "react"

import { type FindingPublic, FindingsService, type PhotoPublic } from "@/client"
import { AiProvenance } from "@/components/Ai/AiProvenance"
import { requestPhotoUpload } from "@/components/Common/PhotoQueueRunner"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { PhotoViewerDialog } from "@/components/Photos/PhotoViewerDialog"
import { QueuedPhotoTile } from "@/components/Photos/QueuedPhotoTile"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  deviceOffline,
  KEPT_ON_DEVICE_MESSAGE,
  keepPhotoOnDevice,
} from "@/hooks/usePhotoUpload"
import { formatDate, formatDateTime } from "@/lib/format"
import { isFindingPhoto, useQueuedPhotos } from "@/lib/photoQueue"
import { inspectionKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import {
  DRAWING_DISCIPLINE_OPTIONS,
  FINDING_PRIORITY_OPTIONS,
  optionLabel,
} from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * One finding (the legacy `.card` in `renderFindingsScreen`): title,
 * description excerpt, priority / status / location badges, resolution
 * line, and the Block 8A actions for its status —
 *
 *   open         → In progress · Resolve
 *   in-progress  → Reopen · Resolve
 *   resolved     → Reopen
 *
 * Tapping the title expands the card to the full description, dates and
 * resolution notes (the legacy card's `viewFinding` was never wired up).
 * Write actions are hidden for viewers and while the inspection is signed
 * off; the API also refuses them (403 / 409).
 *
 * Increment 11a: photos filed under the finding (`photos.finding_id`, taken
 * in the capture loop) show as a thumbnail strip and open in the viewer.
 *
 * Increment 19: a finding saved on this device and not uploaded yet carries a
 * "Not uploaded yet" badge and no actions until the upload has gone through.
 *
 * Increment 15: the discipline shows beside the location, an "AI-assisted"
 * mark when the finding was confirmed from an AI draft, and the expanded card
 * says how it was drafted (model, prompt version, who confirmed, edited).
 *
 * Increment 20: **Add photo** files a photo under the finding — also under a
 * finding saved on this device and not uploaded yet. The photo is kept on
 * the device first (lib/photoQueue) and goes up through presign → S3 →
 * register as soon as there is signal and the finding itself is on the
 * server; until then it shows in the strip with a dashed "not uploaded" edge.
 */

/** The id a photo for this finding is queued under (`local-…` when made offline). */
export function findingQueueId(finding: FindingPublic): string {
  return finding.id < 0 && finding.public_id
    ? finding.public_id
    : String(finding.id)
}

export type FindingStatusValue = "open" | "in-progress" | "resolved"

const EXCERPT_LENGTH = 80

export function excerpt(text: string | null | undefined): string {
  if (!text) return ""
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > EXCERPT_LENGTH
    ? `${oneLine.slice(0, EXCERPT_LENGTH).trimEnd()}…`
    : oneLine
}

interface FindingCardProps {
  finding: FindingPublic
  /** Photos filed under this finding, newest first (increment 11a). */
  photos?: PhotoPublic[]
  /** Hide every write action (viewer, or the inspection is signed off). */
  readOnly: boolean
  /**
   * Increment 19: a change to this finding is saved on this device only and
   * has not been uploaded yet.
   */
  unsynced?: boolean
  /**
   * Increment 20: may photos be added (a write role and an open inspection),
   * even while the finding itself is waiting to upload.
   */
  canAddPhoto?: boolean
  onResolve: (finding: FindingPublic) => void
  onEdit: (finding: FindingPublic) => void
  onDelete: (finding: FindingPublic) => void
}

export function FindingCard({
  finding,
  photos = [],
  readOnly,
  unsynced = false,
  canAddPhoto = false,
  onResolve,
  onEdit,
  onDelete,
}: FindingCardProps) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [expanded, setExpanded] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const queued = useQueuedPhotos(isFindingPhoto(finding))
  const photoInputRef = useRef<HTMLInputElement>(null)

  const addPhotos = async (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(
      (file) => !file.type || file.type.startsWith("image/"),
    )
    let kept = 0
    for (const file of list) {
      const problem = await keepPhotoOnDevice(
        file,
        {
          kind: "finding",
          inspectionId: String(finding.inspection_id),
          findingId: findingQueueId(finding),
        },
        `Photo for finding “${finding.title}”`,
        user?.name ?? user?.email ?? null,
      )
      if (problem) {
        showErrorToast(problem)
        break
      }
      kept += 1
    }
    if (kept === 0) return
    if (deviceOffline() || unsynced) {
      showSuccessToast(
        unsynced && !deviceOffline()
          ? "Photo kept on this device. It uploads right after the finding does."
          : KEPT_ON_DEVICE_MESSAGE,
      )
    } else {
      showSuccessToast(
        kept === 1 ? "Uploading photo…" : `Uploading ${kept} photos…`,
      )
    }
    requestPhotoUpload()
  }

  const status = (finding.status || "open") as FindingStatusValue
  const resolved = status === "resolved"
  const inProgress = status === "in-progress"
  const detailsId = `finding-${finding.id}-details`

  const statusMutation = useMutation({
    mutationFn: async (next: FindingStatusValue) =>
      (
        await FindingsService.setFindingStatus({
          path: { finding_id: finding.id },
          body: { status: next },
        })
      ).data as FindingPublic,
    onSuccess: (updated) => {
      showSuccessToast(
        updated.status === "in-progress"
          ? "Finding marked in progress"
          : "Finding reopened",
      )
      queryClient.invalidateQueries({
        queryKey: inspectionKeys.findings(updated.inspection_id),
      })
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const pendingStatus = statusMutation.isPending
    ? statusMutation.variables
    : undefined

  return (
    <li
      data-testid="finding-card"
      data-status={status}
      data-unsynced={unsynced ? "true" : undefined}
      className={cn(
        "list-none rounded-lg border bg-card p-4",
        inProgress && "border-l-4 border-l-vri-copper",
        resolved && "border-l-4 border-l-vri-green opacity-80",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          data-testid="finding-toggle"
          className="group flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <ChevronDown
            className={cn(
              "mt-1 size-4 shrink-0 text-vri-gold transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            <h3 className="font-semibold group-hover:underline">
              {finding.title}
            </h3>
            {!expanded && finding.description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">
                {excerpt(finding.description)}
              </p>
            ) : null}
          </span>
        </button>
        {!readOnly ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mt-1 -mr-2 size-9 shrink-0"
                aria-label={`Actions for ${finding.title}`}
                data-testid="finding-actions"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(finding)}>
                <Pencil />
                Edit finding
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => onDelete(finding)}
              >
                <Trash2 />
                Delete finding
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {expanded ? (
        <div
          id={detailsId}
          data-testid="finding-details"
          className="mt-3 flex flex-col gap-2 pl-6 text-sm"
        >
          <p className="whitespace-pre-wrap">
            {finding.description || (
              <span className="text-muted-foreground">No description</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Logged {formatDateTime(finding.created_at)}
            {finding.updated_at && finding.updated_at !== finding.created_at
              ? ` · updated ${formatDateTime(finding.updated_at)}`
              : ""}
          </p>
          {finding.ai_suggestion_id && !unsynced ? (
            <AiProvenance findingId={finding.id} />
          ) : null}
        </div>
      ) : null}

      {resolved && (finding.resolved_by || finding.resolution_notes) ? (
        <div className="mt-2 pl-6 text-xs" data-testid="finding-resolution">
          {finding.resolved_by ? (
            <p className="flex items-center gap-1 text-vri-green">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Resolved by {finding.resolved_by}
              {finding.resolved_at
                ? ` — ${formatDate(finding.resolved_at)}`
                : ""}
            </p>
          ) : null}
          {finding.resolution_notes ? (
            <p className="mt-0.5 text-muted-foreground italic">
              {expanded
                ? finding.resolution_notes
                : excerpt(finding.resolution_notes)}
            </p>
          ) : null}
        </div>
      ) : null}

      {photos.length > 0 || queued.length > 0 ? (
        <ul
          className="mt-3 flex flex-wrap gap-1.5 pl-6"
          aria-label={`${photos.length} photo${photos.length === 1 ? "" : "s"} for ${finding.title}${queued.length ? `, ${queued.length} not uploaded yet` : ""}`}
          data-testid="finding-photos"
        >
          {queued.map((photo) => (
            <QueuedPhotoTile key={photo.id} photo={photo} variant="strip" />
          ))}
          {photos.map((photo, index) => (
            <li key={photo.id} className="list-none">
              <button
                type="button"
                onClick={() => setViewing(index)}
                className="block size-14 overflow-hidden rounded-md border bg-muted transition-colors hover:border-vri-gold focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Open ${photo.filename || "photo"}`}
                data-testid="finding-photo"
              >
                {photo.view_url ? (
                  <img
                    src={photo.view_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <Camera
                    className="m-auto size-5 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
        <StatusBadge
          value={finding.priority || "medium"}
          label={optionLabel(FINDING_PRIORITY_OPTIONS, finding.priority)}
          data-testid="finding-priority"
        />
        <StatusBadge value={status} data-testid="finding-status" />
        {unsynced ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-status-attention-bg px-2 py-0.5 text-xs font-medium text-status-attention-fg"
            title="Saved on this device. It uploads when there is a connection; until then it cannot be changed again."
            data-testid="finding-unsynced"
          >
            <CloudUpload className="size-3.5" aria-hidden="true" />
            Not uploaded yet
          </span>
        ) : null}
        {finding.location_ref ? (
          <span className="inline-flex items-center gap-1 text-xs text-vri-copper">
            <MapPin className="size-3.5" aria-hidden="true" />
            {finding.location_ref}
          </span>
        ) : null}
        {finding.discipline ? (
          <span
            className="text-xs text-muted-foreground"
            data-testid="finding-discipline"
          >
            {optionLabel(DRAWING_DISCIPLINE_OPTIONS, finding.discipline) ??
              finding.discipline}
          </span>
        ) : null}
        {finding.ai_suggestion_id ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-vri-copper"
            title="Confirmed by the inspector from an AI draft"
            data-testid="finding-ai-assisted"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            AI-assisted
          </span>
        ) : null}
      </div>

      {queued.some((photo) => photo.status === "failed") ? (
        <p
          className="mt-1 pl-6 text-xs text-destructive"
          data-testid="finding-queued-error"
        >
          A photo was not accepted:{" "}
          {queued.find((photo) => photo.status === "failed")?.error}. It is
          still on this device; open the sync panel to Retry or delete it.
        </p>
      ) : null}

      {canAddPhoto && readOnly ? (
        <div className="mt-3 flex flex-wrap gap-2 pl-6">
          <AddPhotoButton
            inputRef={photoInputRef}
            onFiles={addPhotos}
            title={finding.title}
          />
        </div>
      ) : null}

      {!readOnly ? (
        <div className="mt-3 flex flex-wrap gap-2 pl-6">
          {canAddPhoto ? (
            <AddPhotoButton
              inputRef={photoInputRef}
              onFiles={addPhotos}
              title={finding.title}
            />
          ) : null}
          {status === "open" ? (
            <LoadingButton
              size="sm"
              variant="outline"
              loading={pendingStatus === "in-progress"}
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate("in-progress")}
              data-testid="finding-in-progress"
            >
              <Wrench />
              In progress
            </LoadingButton>
          ) : (
            <LoadingButton
              size="sm"
              variant="outline"
              loading={pendingStatus === "open"}
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate("open")}
              data-testid="finding-reopen"
            >
              <RotateCcw />
              Reopen
            </LoadingButton>
          )}
          {!resolved ? (
            <Button
              size="sm"
              disabled={statusMutation.isPending}
              onClick={() => onResolve(finding)}
              data-testid="finding-resolve"
            >
              <CheckCircle2 />
              Resolve
            </Button>
          ) : null}
        </div>
      ) : null}

      {photos.length > 0 ? (
        <PhotoViewerDialog
          photos={photos}
          index={viewing}
          onIndexChange={setViewing}
          canWrite={!readOnly}
        />
      ) : null}
    </li>
  )
}

function AddPhotoButton({
  inputRef,
  onFiles,
  title,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  onFiles: (files: FileList | null) => void
  title: string
}) {
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="finding-photo-input"
        onChange={(event) => {
          onFiles(event.target.files)
          event.target.value = ""
        }}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        aria-label={`Add photo to ${title}`}
        data-testid="finding-add-photo"
      >
        <Camera />
        Add photo
      </Button>
    </>
  )
}
