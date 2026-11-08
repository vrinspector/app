import { useMutation, useQueryClient } from "@tanstack/react-query"

import { DrawingsService, type PinPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
import type { PointPercent } from "@/lib/drawings"
import { drawingKeys } from "@/lib/queries"
import { PIN_STATUS_OPTIONS, type PinStatus } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * Legacy `showPinStatusPicker` + `placePin`: after a tap on the drawing the
 * five statuses are offered as large coloured buttons and the pin is saved
 * with one more tap — `POST /drawings/{id}/pins {x_pct, y_pct, status,
 * page_number}`, the SPA's body. Label, notes and a finding link are added
 * afterwards from the pin's detail dialog.
 */

interface PinStatusDialogProps {
  drawingId: number
  /** The tapped point; `null` keeps the dialog closed. */
  point: PointPercent | null
  /** 1-indexed page for PDFs; always 1 for raster drawings. */
  pageNumber: number
  isPdf: boolean
  onClose: () => void
  onPlaced?: (pin: PinPublic) => void
}

export function PinStatusDialog({
  drawingId,
  point,
  pageNumber,
  isPdf,
  onClose,
  onPlaced,
}: PinStatusDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: async (status: PinStatus) => {
      if (!point) throw new Error("No point selected.")
      const response = await DrawingsService.createPin({
        path: { drawing_id: drawingId },
        body: {
          x_pct: point.x_pct,
          y_pct: point.y_pct,
          status,
          page_number: pageNumber,
        },
      })
      return response.data as PinPublic
    },
    onSuccess: (pin) => {
      queryClient.setQueryData<PinPublic[]>(drawingKeys.pins(drawingId), (c) =>
        c ? [...c, pin] : [pin],
      )
      queryClient.invalidateQueries({ queryKey: drawingKeys.pins(drawingId) })
      showSuccessToast("Pin placed")
      onClose()
      onPlaced?.(pin)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Dialog
      open={point !== null}
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="sm:max-w-xs" data-testid="pin-status-dialog">
        <DialogHeader>
          <DialogTitle>
            Select pin status{isPdf ? ` — page ${pageNumber}` : ""}
          </DialogTitle>
          <DialogDescription>
            The pin is saved at the spot you tapped. You can add a label, notes
            or a finding afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {PIN_STATUS_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              className="h-11 justify-start text-white hover:brightness-110"
              style={{ background: option.color }}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(option.value)}
              data-testid={`pin-status-${option.value}`}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
