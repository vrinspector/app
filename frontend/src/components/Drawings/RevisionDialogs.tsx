import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { FileUp } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { type DrawingPublic, DrawingsService } from "@/client"
import { QueryState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { rejectDrawingFile } from "@/hooks/useDrawingUpload"
import { putToS3 } from "@/hooks/usePhotoUpload"
import {
  contentTypeForExtension,
  DRAWING_ACCEPT,
  fileExtension,
} from "@/lib/drawings"
import { formatDate, formatDateTime } from "@/lib/format"
import {
  nextRevisionLabel,
  normaliseRevisionLabel,
  revisionLabel,
} from "@/lib/pinView"
import { drawingKeys, drawingRevisionsQuery, projectKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import type { DrawingFileType } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * Increment 14.5 — drawing revisions (owner decision 2026-11-10).
 *
 * NewRevisionDialog: "Upload new revision" in the drawing's menu. The file
 * goes up exactly like a new drawing (presign → straight to S3, Hard Rule
 * 8), then `POST /drawings/{id}/revisions` registers it as the sheet's next
 * revision. Every pin is copied to the same page and spot and flagged
 * "check position"; the old revision stays viewable, read-only.
 *
 * RevisionsDialog: the sheet's revisions newest first, the current one
 * marked, each one opening in the viewer.
 */

interface NewRevisionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  drawing: DrawingPublic
  /** Called with the new revision once it is registered. */
  onUploaded: (revision: DrawingPublic) => void
}

export function NewRevisionDialog({
  open,
  onOpenChange,
  drawing,
  onUploaded,
}: NewRevisionDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const fileId = useId()
  const suggested = nextRevisionLabel(drawing.revision ?? null)
  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState(suggested)
  const [progress, setProgress] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setFile(null)
      setLabel(suggested)
      setProgress(0)
      setProblem(null)
    }
  }, [open, suggested])

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose the new revision's file first.")
      const ext = fileExtension(file.name) as DrawingFileType
      const contentType = file.type || contentTypeForExtension(ext)
      const presign = (
        await DrawingsService.presignDrawingUpload({
          body: {
            project_id: drawing.project_id,
            filename: file.name,
            content_type: contentType,
          },
        })
      ).data
      if (!presign) throw new Error("No upload URL was returned.")
      if (
        !presign.s3_key.startsWith(`drawings/projects/${drawing.project_id}/`)
      ) {
        throw new Error("Upload key is not scoped to the active project.")
      }
      await putToS3(presign.upload_url, file, contentType, setProgress)
      return (
        await DrawingsService.createDrawingRevision({
          path: { drawing_id: drawing.id },
          body: {
            filename: file.name,
            s3_key: presign.s3_key,
            file_type: ext,
            file_size: file.size || null,
            revision: normaliseRevisionLabel(label),
          },
        })
      ).data as DrawingPublic
    },
    onSuccess: (revision) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.drawings(drawing.project_id),
      })
      queryClient.invalidateQueries({
        queryKey: drawingKeys.detail(drawing.id),
      })
      queryClient.invalidateQueries({
        queryKey: drawingKeys.revisions(drawing.id),
      })
      queryClient.invalidateQueries({ queryKey: ["itps"] })
      queryClient.invalidateQueries({
        queryKey: projectKeys.itpItems(drawing.project_id),
      })
      const carried = revision.pins_to_check ?? 0
      showSuccessToast(
        `${revisionLabel(revision) ?? "New revision"} uploaded${
          carried
            ? ` — ${carried} pin${carried === 1 ? "" : "s"} carried over to check`
            : ""
        }`,
      )
      onOpenChange(false)
      onUploaded(revision)
    },
    onError: (error: Error) => setProblem(extractErrorMessage(error)),
  })

  const busy = upload.isPending
  const pickFile = (picked: File | undefined) => {
    setProblem(null)
    if (!picked) return
    const reason = rejectDrawingFile(picked)
    if (reason) {
      setProblem(reason)
      setFile(null)
      return
    }
    setFile(picked)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent data-testid="new-revision-dialog">
        <DialogHeader>
          <DialogTitle>Upload a new revision</DialogTitle>
          <DialogDescription>
            The new file replaces{" "}
            <strong>{revisionLabel(drawing) ?? "the current sheet"}</strong> as
            the one everybody sees. Its pins are copied to the same spot, marked
            “check position”, and the old revision is kept read-only.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            upload.mutate()
          }}
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={fileId}>File</Label>
            <input
              ref={inputRef}
              id={fileId}
              type="file"
              accept={DRAWING_ACCEPT}
              className="sr-only"
              data-testid="revision-file-input"
              onChange={(event) => {
                pickFile(event.target.files?.[0])
                event.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              data-testid="revision-file-button"
            >
              <FileUp />
              <span className="truncate">
                {file ? file.name : "Choose PDF, PNG, JPG or SVG…"}
              </span>
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={labelId}>Revision</Label>
            <Input
              id={labelId}
              value={label}
              maxLength={20}
              onChange={(event) => setLabel(event.target.value)}
              disabled={busy}
              className="w-32"
              data-testid="revision-label"
            />
            <p className="text-xs text-muted-foreground">
              Suggested: {suggested}. Use the label printed in the title block.
            </p>
          </div>
          {busy ? (
            <div
              className="h-2 overflow-hidden rounded bg-muted"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Upload progress"
            >
              <div
                className="h-full bg-vri-green transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : null}
          {problem ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="revision-problem"
            >
              {problem}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <LoadingButton
              type="submit"
              loading={busy}
              disabled={!file}
              data-testid="revision-upload"
            >
              Upload revision
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface RevisionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  drawing: DrawingPublic
}

export function RevisionsDialog({
  open,
  onOpenChange,
  drawing,
}: RevisionsDialogProps) {
  const revisions = useQuery({
    ...drawingRevisionsQuery(drawing.id),
    enabled: open,
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="revisions-dialog">
        <DialogHeader>
          <DialogTitle>Revisions</DialogTitle>
          <DialogDescription>
            Newest first. Older revisions open read-only, with their pins as
            they were.
          </DialogDescription>
        </DialogHeader>
        <QueryState
          query={revisions}
          errorTitle="Couldn't load the revisions"
          empty={
            <p className="text-sm text-muted-foreground">No revisions found.</p>
          }
        >
          {(rows) => (
            <ul className="flex flex-col gap-1.5">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    to="/projects/$projectId/drawings/$drawingId"
                    params={{
                      projectId: String(row.project_id),
                      drawingId: String(row.id),
                    }}
                    onClick={() => onOpenChange(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-md border px-3 py-2 text-sm hover:border-vri-gold",
                      row.id === drawing.id && "border-vri-green bg-muted",
                    )}
                    data-testid="revision-row"
                    data-current={row.is_current ? "true" : "false"}
                    aria-current={row.id === drawing.id ? "page" : undefined}
                  >
                    <span className="min-w-12 font-semibold">
                      {revisionLabel(row) ?? "Original"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {row.filename} · {formatDate(row.created_at)}
                    </span>
                    {row.is_current ? (
                      <span className="rounded bg-vri-green px-1.5 py-0.5 text-[0.65rem] font-bold text-vri-offwhite">
                        Current
                      </span>
                    ) : (
                      <span
                        className="text-xs text-muted-foreground"
                        title={
                          row.superseded_at
                            ? `Replaced ${formatDateTime(row.superseded_at)}`
                            : undefined
                        }
                      >
                        Read-only
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </DialogContent>
    </Dialog>
  )
}
