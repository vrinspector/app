import { AlertTriangle, CloudUpload, Loader2 } from "lucide-react"

import { requestPhotoUpload } from "@/components/Common/PhotoQueueRunner"
import { Button } from "@/components/ui/button"
import {
  photoQueue,
  type QueuedPhotoMeta,
  useQueuedPreview,
} from "@/lib/photoQueue"
import { cn } from "@/lib/utils"

/*
 * A photo kept on this device and not uploaded yet (rebuild increment 20),
 * shown where it belongs — the inspection's site photos, a finding's strip,
 * an ITP line or one of its three-shot slots — with the same "Not uploaded
 * yet" marker as findings and pins waiting to upload. A photo the server
 * refused shows the reason and a Retry; deleting it is done in the sync
 * panel, so a tap here can never lose it.
 */

export function queuedPhotoStatusText(photo: QueuedPhotoMeta): string {
  if (photo.status === "failed") return "Not accepted"
  if (photo.status === "uploading") return "Uploading…"
  return "Not uploaded yet"
}

interface QueuedPhotoTileProps {
  photo: QueuedPhotoMeta
  /** "tile": grid square; "strip": small thumbnail in a finding's strip. */
  variant?: "tile" | "strip"
  className?: string
}

export function QueuedPhotoTile({
  photo,
  variant = "tile",
  className,
}: QueuedPhotoTileProps) {
  const preview = useQueuedPreview(photo.id)
  const failed = photo.status === "failed"
  const status = queuedPhotoStatusText(photo)
  const label = `${photo.filename}: ${status}${failed && photo.error ? ` — ${photo.error}` : ""}`

  if (variant === "strip") {
    return (
      <li
        className={cn("relative list-none", className)}
        data-testid="queued-photo"
        data-status={photo.status}
      >
        <span
          className={cn(
            "relative block size-14 overflow-hidden rounded-md border-2 border-dashed bg-muted",
            failed ? "border-destructive" : "border-vri-gold",
          )}
          role="img"
          aria-label={label}
          title={label}
        >
          {preview ? (
            <img
              src={preview}
              alt=""
              className="absolute inset-0 size-full object-cover opacity-80"
            />
          ) : null}
          <span className="absolute right-0.5 bottom-0.5 flex size-5 items-center justify-center rounded-full bg-background/90">
            {failed ? (
              <AlertTriangle
                className="size-3.5 text-destructive"
                aria-hidden="true"
              />
            ) : (
              <CloudUpload
                className="size-3.5 text-vri-copper"
                aria-hidden="true"
              />
            )}
          </span>
        </span>
      </li>
    )
  }

  return (
    <li
      className={cn("list-none", className)}
      data-testid="queued-photo"
      data-status={photo.status}
    >
      <div
        className={cn(
          "relative flex flex-col overflow-hidden rounded-lg border-2 border-dashed bg-card",
          failed ? "border-destructive/70" : "border-vri-gold",
        )}
        role="status"
        aria-label={label}
      >
        <span className="relative block aspect-square w-full bg-muted">
          {preview ? (
            <img
              src={preview}
              alt=""
              className="absolute inset-0 size-full object-cover opacity-80"
            />
          ) : null}
          <span className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-background/90 px-1 py-0.5 text-[11px] font-medium">
            {failed ? (
              <AlertTriangle
                className="size-3.5 shrink-0 text-destructive"
                aria-hidden="true"
              />
            ) : photo.status === "uploading" ? (
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-vri-green"
                aria-hidden="true"
              />
            ) : (
              <CloudUpload
                className="size-3.5 shrink-0 text-vri-copper"
                aria-hidden="true"
              />
            )}
            <span data-testid="queued-photo-status">{status}</span>
          </span>
        </span>
        {failed ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="m-1 h-7 text-xs"
            onClick={async () => {
              await photoQueue.retry(photo.id)
              requestPhotoUpload()
            }}
            data-testid="queued-photo-retry"
          >
            Retry
          </Button>
        ) : null}
      </div>
      {failed && photo.error ? (
        <p
          className="mt-1 text-xs text-destructive"
          data-testid="queued-photo-error"
        >
          {photo.error}
        </p>
      ) : null}
    </li>
  )
}
