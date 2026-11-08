import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2 } from "lucide-react"
import { useEffect, useState } from "react"

import { type FindingPublic, FindingsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { inspectionKeys } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * Block 8A "Resolve Finding": optional resolution notes, then
 * `PATCH /findings/{id}/resolve {resolution_notes}` — blank notes are sent
 * as `null` like the legacy modal did. The API records who resolved it and
 * when.
 */

interface ResolveFindingDialogProps {
  finding: FindingPublic | null
  onOpenChange: (open: boolean) => void
}

export function ResolveFindingDialog({
  finding,
  onOpenChange,
}: ResolveFindingDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [notes, setNotes] = useState("")
  const open = finding !== null

  useEffect(() => {
    if (open) setNotes("")
  }, [open])

  const mutation = useMutation({
    mutationFn: async (target: FindingPublic) =>
      (
        await FindingsService.resolveFinding({
          path: { finding_id: target.id },
          body: { resolution_notes: notes.trim() ? notes.trim() : null },
        })
      ).data as FindingPublic,
    onSuccess: (updated) => {
      showSuccessToast("Finding resolved")
      queryClient.invalidateQueries({
        queryKey: inspectionKeys.findings(updated.inspection_id),
      })
      onOpenChange(false)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={mutation.isPending ? undefined : onOpenChange}
    >
      <DialogContent data-testid="resolve-dialog">
        <DialogHeader>
          <DialogTitle>Resolve this finding?</DialogTitle>
          <DialogDescription>
            {finding ? (
              <>
                <strong>{finding.title}</strong> will be marked resolved with
                your name and the time. Notes are optional.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="resolution-notes">Resolution notes</Label>
          <Textarea
            id="resolution-notes"
            rows={4}
            placeholder="Describe how this was resolved…"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <LoadingButton
            type="button"
            loading={mutation.isPending}
            onClick={() => finding && mutation.mutate(finding)}
            data-testid="resolve-submit"
          >
            <CheckCircle2 />
            Mark resolved
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
