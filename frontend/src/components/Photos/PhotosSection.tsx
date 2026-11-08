import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Camera, ImagePlus, Loader2, X } from "lucide-react"
import { useState } from "react"

import type { PhotoPublic } from "@/client"
import { EmptyState, QueryState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"
import type { PhotoUpload } from "@/hooks/usePhotoUpload"
import { formatDate } from "@/lib/format"
import { photosQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { PhotoViewerDialog } from "./PhotoViewerDialog"

/*
 * "Site Photos (N)" — the thumbnail grid from the legacy findings screen
 * with the capture buttons in its header. Uploads in flight render as
 * tiles at the front of the grid (local preview, progress, retry) so the
 * person sees the photo land where it will live.
 */

interface PhotosSectionProps {
  inspectionId: number
  canWrite: boolean
  uploads: PhotoUpload[]
  onTakePhoto: () => void
  onChoosePhotos: () => void
  onRetryUpload: (id: string) => void
  onDismissUpload: (id: string) => void
}

export function PhotosSection({
  inspectionId,
  canWrite,
  uploads,
  onTakePhoto,
  onChoosePhotos,
  onRetryUpload,
  onDismissUpload,
}: PhotosSectionProps) {
  const query = useQuery(photosQuery(inspectionId))
  const [viewing, setViewing] = useState<number | null>(null)

  const captureButtons = canWrite ? (
    <div className="flex gap-2">
      <Button onClick={onTakePhoto} data-testid="take-photo">
        <Camera />
        Take photo
      </Button>
      <Button
        variant="outline"
        onClick={onChoosePhotos}
        data-testid="choose-photos"
        aria-label="Upload photos from the device"
      >
        <ImagePlus />
        <span className="hidden sm:inline">Upload</span>
      </Button>
    </div>
  ) : null

  const heading = (count: number, total?: number) => (
    <h2 id="photos-heading" className="text-lg font-semibold">
      Site photos{" "}
      <span className="text-muted-foreground" data-testid="photos-count">
        (
        {total !== undefined && total !== count
          ? `${count} of ${total}`
          : count}
        )
      </span>
    </h2>
  )

  return (
    <section aria-labelledby="photos-heading" className="flex flex-col gap-3">
      <QueryState
        query={query}
        errorTitle="Couldn't load the photos"
        isEmpty={(photos) => photos.length === 0 && uploads.length === 0}
        empty={
          <>
            <div className="flex items-center justify-between gap-3">
              {heading(0)}
              {captureButtons}
            </div>
            <EmptyState
              icon={<Camera />}
              title="No photos yet"
              description={
                canWrite
                  ? "Tap Take photo to use the camera. Photos are stored with this inspection."
                  : "Photos taken on site will appear here."
              }
              className="py-8"
            />
          </>
        }
      >
        {(photos) => (
          <>
            <div className="flex items-center justify-between gap-3">
              {heading(photos.length)}
              {captureButtons}
            </div>
            <ul
              className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2"
              data-testid="photo-grid"
            >
              {uploads.map((upload) => (
                <UploadTile
                  key={upload.id}
                  upload={upload}
                  onRetry={() => onRetryUpload(upload.id)}
                  onDismiss={() => onDismissUpload(upload.id)}
                />
              ))}
              {photos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  onOpen={() => setViewing(index)}
                />
              ))}
            </ul>
            <PhotoViewerDialog
              photos={photos}
              index={viewing}
              onIndexChange={setViewing}
              canWrite={canWrite}
            />
          </>
        )}
      </QueryState>
    </section>
  )
}

function PhotoTile({
  photo,
  onOpen,
}: {
  photo: PhotoPublic
  onOpen: () => void
}) {
  const label = photo.filename || "Photo"
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onOpen}
        data-testid="photo-thumb"
        className="group flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-vri-gold focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Open ${label}`}
      >
        <span className="relative block aspect-square w-full bg-muted">
          {photo.view_url ? (
            <img
              src={photo.view_url}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <Camera
              className="absolute inset-0 m-auto size-6 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="truncate px-2 py-1 text-xs text-muted-foreground">
          {formatDate(photo.created_at) || label}
        </span>
      </button>
    </li>
  )
}

const STATUS_TEXT: Record<PhotoUpload["status"], string> = {
  presigning: "Preparing…",
  uploading: "Uploading…",
  registering: "Saving…",
  error: "Failed",
}

function UploadTile({
  upload,
  onRetry,
  onDismiss,
}: {
  upload: PhotoUpload
  onRetry: () => void
  onDismiss: () => void
}) {
  const failed = upload.status === "error"
  return (
    <li
      className="list-none"
      data-testid="photo-upload"
      data-status={upload.status}
    >
      <div
        className={cn(
          "relative flex flex-col overflow-hidden rounded-lg border bg-card",
          failed ? "border-destructive/60" : "border-vri-gold/60",
        )}
        role="status"
        aria-live="polite"
        aria-label={`${upload.file.name || "Photo"}: ${
          failed ? (upload.error ?? "Failed") : STATUS_TEXT[upload.status]
        }`}
      >
        <span className="relative block aspect-square w-full bg-muted">
          <img
            src={upload.previewUrl}
            alt=""
            className={cn(
              "absolute inset-0 size-full object-cover",
              !failed && "opacity-60",
            )}
          />
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1 text-center text-xs font-medium">
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
            <span className="rounded bg-background/80 px-1">
              {failed
                ? "Failed"
                : upload.status === "uploading"
                  ? `${upload.progress}%`
                  : STATUS_TEXT[upload.status]}
            </span>
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
        {failed ? (
          <div className="flex items-center justify-between gap-1 px-1 py-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-xs"
              onClick={onRetry}
              data-testid="retry-upload"
            >
              Retry
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7"
              onClick={onDismiss}
              aria-label="Discard this photo"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : (
          <span className="truncate px-2 py-1 text-xs text-muted-foreground">
            {STATUS_TEXT[upload.status]}
          </span>
        )}
      </div>
      {failed && upload.error ? (
        <p className="mt-1 text-xs text-destructive" data-testid="upload-error">
          {upload.error}
        </p>
      ) : null}
    </li>
  )
}
