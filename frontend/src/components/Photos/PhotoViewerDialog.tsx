import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { type PhotoPublic, PhotosService } from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
import { formatDateTime } from "@/lib/format"
import { inspectionKeys, itpKeys } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"
import { PhotoFilingPanel } from "./PhotoFilingPanel"

/*
 * Full-size view of one site photo with its filename, who took it and
 * when, previous / next through the inspection's photos, and Delete for
 * inspectors and owners. The legacy grid only showed thumbnails; a photo
 * had to be opened in a new tab to be read. Increment 15 adds the photo's
 * filing (category, defects, severity) and AI analysis under inspection
 * photos — see PhotoFilingPanel.
 */

interface PhotoViewerDialogProps {
  photos: PhotoPublic[]
  /** Index into `photos`, or `null` when closed. */
  index: number | null
  onIndexChange: (index: number | null) => void
  canWrite: boolean
  /** Called after a delete (the ITP screen refreshes its photo counts). */
  onDeleted?: (photo: PhotoPublic) => void
}

export function PhotoViewerDialog({
  photos,
  index,
  onIndexChange,
  canWrite,
  onDeleted,
}: PhotoViewerDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [deleting, setDeleting] = useState(false)

  const photo = index === null ? undefined : photos[index]
  const open = photo !== undefined

  // The list shrank underneath us (a delete elsewhere): close cleanly.
  useEffect(() => {
    if (index !== null && index >= photos.length) {
      onIndexChange(photos.length ? photos.length - 1 : null)
    }
  }, [index, photos.length, onIndexChange])

  const deleteMutation = useMutation({
    mutationFn: (target: PhotoPublic) =>
      PhotosService.deletePhoto({ path: { photo_id: target.id } }),
    onSuccess: (_result, target) => {
      showSuccessToast("Photo deleted")
      setDeleting(false)
      // Inspection photos, or an ITP line's evidence (increment 13.6).
      const key =
        target.inspection_id !== null
          ? inspectionKeys.photos(target.inspection_id)
          : itpKeys.photos(target.itp_item_id ?? 0)
      queryClient.setQueryData<PhotoPublic[]>(key, (current) =>
        current?.filter((item) => item.id !== target.id),
      )
      queryClient.invalidateQueries({ queryKey: key })
      onDeleted?.(target)
      onIndexChange(null)
    },
    onError: (error: Error) => {
      setDeleting(false)
      showErrorToast(extractErrorMessage(error))
    },
  })

  const step = (delta: number) => {
    if (index === null) return
    const next = index + delta
    if (next >= 0 && next < photos.length) onIndexChange(next)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) onIndexChange(null)
        }}
      >
        <DialogContent
          data-testid="photo-viewer"
          className="flex max-h-[95vh] flex-col gap-3 bg-vri-charcoal p-3 text-white sm:max-w-4xl [&>[data-slot=dialog-close]]:text-white"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") step(-1)
            if (event.key === "ArrowRight") step(1)
          }}
        >
          {photo ? (
            <>
              <DialogTitle className="truncate pr-8 text-base font-semibold">
                {photo.filename || "Photo"}
              </DialogTitle>
              <DialogDescription className="text-xs text-white/70">
                {photo.uploaded_by ? `${photo.uploaded_by} — ` : ""}
                {formatDateTime(photo.created_at)}
                {photos.length > 1
                  ? ` · ${(index ?? 0) + 1} of ${photos.length}`
                  : ""}
              </DialogDescription>
              <div className="relative flex min-h-0 flex-1 items-center justify-center">
                {photo.view_url ? (
                  <img
                    src={photo.view_url}
                    alt={photo.filename || "Site photo"}
                    className="max-h-[70vh] max-w-full rounded object-contain"
                    data-testid="photo-viewer-image"
                  />
                ) : (
                  <p className="py-12 text-sm text-white/70">
                    This photo cannot be displayed right now.
                  </p>
                )}
                {photos.length > 1 ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute top-1/2 left-1 size-10 -translate-y-1/2 opacity-90"
                      onClick={() => step(-1)}
                      disabled={index === 0}
                      aria-label="Previous photo"
                    >
                      <ChevronLeft />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="absolute top-1/2 right-1 size-10 -translate-y-1/2 opacity-90"
                      onClick={() => step(1)}
                      disabled={index === photos.length - 1}
                      aria-label="Next photo"
                    >
                      <ChevronRight />
                    </Button>
                  </>
                ) : null}
              </div>
              {photo.inspection_id !== null ? (
                <PhotoFilingPanel photo={photo} canWrite={canWrite} />
              ) : null}
              {canWrite ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleting(true)}
                    data-testid="delete-photo"
                  >
                    <Trash2 />
                    Delete photo
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this photo?"
        description="The photo is removed from this inspection and from storage. This cannot be undone."
        confirmLabel="Delete photo"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => photo && deleteMutation.mutate(photo)}
      />
    </>
  )
}
