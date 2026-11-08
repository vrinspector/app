import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  AlertTriangle,
  FileImage,
  FileText,
  FileUp,
  Loader2,
  X,
} from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import type { DrawingPublic } from "@/client"
import { FilterInput } from "@/components/Common/FilterInput"
import { EmptyState, QueryState } from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { type DrawingUpload, useDrawingUpload } from "@/hooks/useDrawingUpload"
import { DRAWING_ACCEPT, drawingFileKind } from "@/lib/drawings"
import { formatDate, matchesFilter } from "@/lib/format"
import { drawingsQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { DRAWING_DISCIPLINE_OPTIONS, optionLabel } from "@/lib/vocab"

/*
 * "Drawings (N)" on the project screen — the legacy `renderDrawingsSection`:
 * one card per drawing (title, discipline, PDF badge) that opens the viewer,
 * and Upload drawing. Uploads in flight render as cards at the front of
 * the grid with progress and a Retry, like the photo tiles of increment 08.
 */

interface DrawingsSectionProps {
  projectId: number
  canWrite: boolean
}

export function DrawingsSection({ projectId, canWrite }: DrawingsSectionProps) {
  const query = useQuery(drawingsQuery(projectId))
  const { uploads, addFiles, retry, dismiss } = useDrawingUpload(projectId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState("")

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      addFiles(event.target.files)
      event.target.value = ""
    },
    [addFiles],
  )

  const uploadButton = canWrite ? (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={DRAWING_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="drawing-input"
        onChange={handleChange}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        data-testid="upload-drawing"
      >
        <FileUp />
        Upload drawing
      </Button>
    </>
  ) : null

  const heading = (count: number, total?: number) => (
    <h2 id="drawings-heading" className="text-lg font-semibold">
      Drawings{" "}
      <span className="text-muted-foreground" data-testid="drawings-count">
        (
        {total !== undefined && total !== count
          ? `${count} of ${total}`
          : count}
        )
      </span>
    </h2>
  )

  return (
    <section aria-labelledby="drawings-heading" className="flex flex-col gap-3">
      <QueryState
        query={query}
        errorTitle="Couldn't load the drawings"
        isEmpty={(drawings) => drawings.length === 0 && uploads.length === 0}
        empty={
          <>
            <div className="flex items-center justify-between gap-3">
              {heading(0)}
              {uploadButton}
            </div>
            <EmptyState
              icon={<FileText />}
              title="No drawings yet"
              description={
                canWrite
                  ? "Upload a P&ID or site plan (PDF, PNG, JPG or SVG, up to 50 MB) to start pinning."
                  : "Drawings uploaded to this project will appear here."
              }
              className="py-8"
            />
          </>
        }
      >
        {(drawings) => (
          <DrawingGrid
            projectId={projectId}
            drawings={drawings}
            uploads={uploads}
            filter={filter}
            onFilterChange={setFilter}
            heading={heading}
            uploadButton={uploadButton}
            onRetry={retry}
            onDismiss={dismiss}
          />
        )}
      </QueryState>
    </section>
  )
}

interface DrawingGridProps {
  projectId: number
  drawings: DrawingPublic[]
  uploads: DrawingUpload[]
  filter: string
  onFilterChange: (value: string) => void
  heading: (count: number, total?: number) => React.ReactNode
  uploadButton: React.ReactNode
  onRetry: (id: string) => void
  onDismiss: (id: string) => void
}

function DrawingGrid({
  projectId,
  drawings,
  uploads,
  filter,
  onFilterChange,
  heading,
  uploadButton,
  onRetry,
  onDismiss,
}: DrawingGridProps) {
  const visible = useMemo(
    () =>
      drawings.filter((drawing) =>
        matchesFilter(
          filter,
          drawing.title,
          drawing.drawing_number,
          drawing.filename,
          drawing.discipline,
          optionLabel(DRAWING_DISCIPLINE_OPTIONS, drawing.discipline),
        ),
      ),
    [drawings, filter],
  )

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {heading(visible.length, drawings.length)}
        <div className="flex flex-wrap items-center gap-2">
          {drawings.length > 3 ? (
            <FilterInput
              value={filter}
              onChange={onFilterChange}
              placeholder="Filter drawings…"
              label="Filter drawings"
              className="sm:w-60"
            />
          ) : null}
          {uploadButton}
        </div>
      </div>

      {visible.length === 0 && uploads.length === 0 ? (
        <EmptyState
          title="No drawings match"
          description={`Nothing matches “${filter.trim()}”. Try a title, number or discipline.`}
          action={
            <Button variant="outline" onClick={() => onFilterChange("")}>
              Clear filter
            </Button>
          }
          className="py-8"
        />
      ) : (
        <ul
          className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3"
          data-testid="drawing-grid"
        >
          {uploads.map((upload) => (
            <UploadCard
              key={upload.id}
              upload={upload}
              onRetry={() => onRetry(upload.id)}
              onDismiss={() => onDismiss(upload.id)}
            />
          ))}
          {visible.map((drawing) => (
            <DrawingCard
              key={drawing.id}
              projectId={projectId}
              drawing={drawing}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function DrawingCard({
  projectId,
  drawing,
}: {
  projectId: number
  drawing: DrawingPublic
}) {
  const kind = drawingFileKind(drawing)
  const label = drawing.title || drawing.filename || "Drawing"
  const thumb =
    kind === "raster" ? drawing.thumbnail_url || drawing.view_url : null
  return (
    <li className="list-none">
      <Link
        to="/projects/$projectId/drawings/$drawingId"
        params={{ projectId: String(projectId), drawingId: String(drawing.id) }}
        data-testid="drawing-card"
        data-kind={kind}
        className="group flex h-full w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-vri-gold focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Open ${label}`}
      >
        <span className="relative block aspect-[4/3] w-full bg-muted">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : kind === "pdf" ? (
            <FileText
              className="absolute inset-0 m-auto size-8 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <FileImage
              className="absolute inset-0 m-auto size-8 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          {kind === "pdf" ? (
            <span className="absolute top-2 right-2 rounded bg-vri-green px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide text-vri-offwhite">
              PDF
            </span>
          ) : null}
        </span>
        <span className="flex flex-col gap-1 px-2.5 py-2">
          <span className="truncate text-sm font-medium" title={label}>
            {label}
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {drawing.drawing_number ? (
              <span className="truncate">{drawing.drawing_number}</span>
            ) : null}
            <StatusBadge
              value={drawing.discipline}
              tone="neutral"
              label={optionLabel(
                DRAWING_DISCIPLINE_OPTIONS,
                drawing.discipline,
              )}
              className="px-2 py-0 text-[0.6rem]"
              data-testid="drawing-discipline"
            />
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {formatDate(drawing.created_at)}
          </span>
        </span>
      </Link>
    </li>
  )
}

const STATUS_TEXT: Record<DrawingUpload["status"], string> = {
  presigning: "Preparing…",
  uploading: "Uploading…",
  registering: "Saving…",
  error: "Failed",
}

function UploadCard({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: DrawingUpload
  onRetry: () => void
  onDismiss: () => void
}) {
  const failed = upload.status === "error"
  return (
    <li
      className="list-none"
      data-testid="drawing-upload"
      data-status={upload.status}
    >
      <div
        className={cn(
          "flex h-full flex-col overflow-hidden rounded-lg border bg-card",
          failed ? "border-destructive/60" : "border-vri-gold/60",
        )}
        role="status"
        aria-live="polite"
        aria-label={`${upload.file.name}: ${
          failed ? (upload.error ?? "Failed") : STATUS_TEXT[upload.status]
        }`}
      >
        <span className="relative flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-muted p-2 text-center text-xs font-medium">
          {failed ? (
            <AlertTriangle
              className="size-6 text-destructive"
              aria-hidden="true"
            />
          ) : (
            <Loader2
              className="size-6 animate-spin text-vri-green"
              aria-hidden="true"
            />
          )}
          <span>
            {failed
              ? "Failed"
              : upload.status === "uploading"
                ? `${upload.progress}%`
                : STATUS_TEXT[upload.status]}
          </span>
          {!failed ? (
            <span
              className="absolute right-0 bottom-0 left-0 h-1 bg-vri-gold/30"
              aria-hidden="true"
            >
              <span
                className="block h-full bg-vri-gold transition-[width]"
                style={{ width: `${upload.progress}%` }}
              />
            </span>
          ) : null}
        </span>
        <span className="truncate px-2.5 pt-2 text-sm font-medium">
          {upload.file.name}
        </span>
        {failed ? (
          <div className="flex items-center justify-between gap-1 px-1.5 py-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-xs"
              onClick={onRetry}
              data-testid="retry-drawing-upload"
            >
              Retry
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={onDismiss}
              aria-label="Discard this upload"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <span className="px-2.5 pb-2 text-xs text-muted-foreground">
            {STATUS_TEXT[upload.status]}
          </span>
        )}
      </div>
      {failed && upload.error ? (
        <p
          className="mt-1 text-xs text-destructive"
          data-testid="drawing-upload-error"
        >
          {upload.error}
        </p>
      ) : null}
    </li>
  )
}
