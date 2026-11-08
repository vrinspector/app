import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"

import { DrawingsService, type PinPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useCustomToast from "@/hooks/useCustomToast"
import {
  pinThenFindingPreferred,
  setPinThenFindingPreferred,
} from "@/lib/capture"
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
 *
 * Increment 11a: the same tap can carry straight on to the finding form
 * ("Then log a finding with a photo", on by default and remembered on this
 * device), which is the PRD's drawing-tap → finding capture loop. Unticked,
 * the pin is placed on its own as before.
 */

interface PinStatusDialogProps {
  drawingId: number
  /** The tapped point; `null` keeps the dialog closed. */
  point: PointPercent | null
  /** 1-indexed page for PDFs; always 1 for raster drawings. */
  pageNumber: number
  isPdf: boolean
  onClose: () => void
  /** `logFinding` is the state of the "then log a finding" switch. */
  onPlaced?: (pin: PinPublic, options: { logFinding: boolean }) => void
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
  const [logFinding, setLogFinding] = useState(pinThenFindingPreferred)
  const switchId = useId()

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
      if (!logFinding) showSuccessToast("Pin placed")
      onClose()
      onPlaced?.(pin, { logFinding })
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
            {logFinding
              ? "The pin is saved at the spot you tapped, then the finding form opens with the camera ready."
              : "The pin is saved at the spot you tapped. You can add a label, notes or a finding afterwards."}
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
        <label
          htmlFor={switchId}
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <Checkbox
            id={switchId}
            checked={logFinding}
            disabled={mutation.isPending}
            onCheckedChange={(checked) => {
              const on = checked === true
              setLogFinding(on)
              setPinThenFindingPreferred(on)
            }}
            data-testid="pin-then-finding"
          />
          Then log a finding with a photo
        </label>
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
