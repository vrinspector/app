import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ExternalLink, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { DrawingsService, type ItpItemRef, type PinPublic } from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { useProjectFindings } from "@/hooks/useProjectFindings"
import { formatDateTime } from "@/lib/format"
import { classificationInfo } from "@/lib/itp"
import { drawingKeys, itpItemsQuery, projectKeys } from "@/lib/queries"
import {
  PIN_STATUS_OPTIONS,
  PIN_STATUS_VALUES,
  pinStatusOption,
} from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * Legacy `showPinDetail`: the pin's number, page, status and notes with a
 * Delete button. The rebuild adds what the ported `PUT /pins/{id}` route
 * exists for (docs/API_PORT.md decision 10): change the status, give the pin
 * a label and notes, and link it to a finding in the same project — the
 * drawing-anchored finding that Block 9.5 builds on.
 */

const NONE = ""

const schema = z.object({
  status: z.enum(PIN_STATUS_VALUES),
  label: z.string().trim().max(255),
  notes: z.string().trim().max(5000),
  finding_id: z.string(),
  itp_item_id: z.string(),
})

type FormValues = z.infer<typeof schema>

function toFormValues(pin: PinPublic | null): FormValues {
  return {
    status: pinStatusOption(pin?.status).value,
    label: pin?.label ?? "",
    notes: pin?.notes ?? "",
    finding_id: pin?.finding_id ? String(pin.finding_id) : NONE,
    itp_item_id: pin?.itp_item_id ? String(pin.itp_item_id) : NONE,
  }
}

const nullIfBlank = (value: string) => (value.trim() ? value.trim() : null)

interface PinDetailDialogProps {
  projectId: number
  drawingId: number
  pin: PinPublic | null
  isPdf: boolean
  canWrite: boolean
  onClose: () => void
}

export function PinDetailDialog({
  projectId,
  drawingId,
  pin,
  isPdf,
  canWrite,
  onClose,
}: PinDetailDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [deleting, setDeleting] = useState(false)
  const open = pin !== null
  const projectFindings = useProjectFindings(projectId, open && canWrite)
  const itpItems = useQuery({ ...itpItemsQuery(projectId), enabled: open })
  const itpGroups = groupItpItems(itpItems.data ?? [])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(pin),
  })

  useEffect(() => {
    if (open) form.reset(toFormValues(pin))
  }, [open, pin, form])

  const updatePins = (updater: (pins: PinPublic[]) => PinPublic[]) => {
    queryClient.setQueryData<PinPublic[]>(drawingKeys.pins(drawingId), (c) =>
      c ? updater(c) : c,
    )
    queryClient.invalidateQueries({ queryKey: drawingKeys.pins(drawingId) })
  }

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!pin) throw new Error("No pin selected.")
      const itpItemId = values.itp_item_id ? Number(values.itp_item_id) : null
      const response = await DrawingsService.updatePin({
        path: { pin_id: pin.id },
        body: {
          status: values.status,
          label: nullIfBlank(values.label),
          notes: nullIfBlank(values.notes),
          finding_id: values.finding_id ? Number(values.finding_id) : null,
          // Sent only when changed, so the legacy body is unchanged otherwise.
          ...(itpItemId !== (pin.itp_item_id ?? null)
            ? { itp_item_id: itpItemId }
            : {}),
        },
      })
      return response.data as PinPublic
    },
    onSuccess: (saved) => {
      updatePins((pins) => pins.map((p) => (p.id === saved.id ? saved : p)))
      if (saved.itp_item_id !== pin?.itp_item_id) {
        queryClient.invalidateQueries({
          queryKey: projectKeys.itpItems(projectId),
        })
        queryClient.invalidateQueries({ queryKey: ["itps"] })
      }
      showSuccessToast("Pin updated")
      onClose()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!pin) throw new Error("No pin selected.")
      await DrawingsService.deletePin({ path: { pin_id: pin.id } })
      return pin.id
    },
    onSuccess: (id) => {
      updatePins((pins) => pins.filter((p) => p.id !== id))
      showSuccessToast("Pin deleted")
      setDeleting(false)
      onClose()
    },
    onError: (error: Error) => {
      setDeleting(false)
      showErrorToast(extractErrorMessage(error))
    },
  })

  const busy = saveMutation.isPending || deleteMutation.isPending
  const status = pinStatusOption(pin?.status)
  const linked = pin?.finding_id
    ? projectFindings.byId.get(pin.finding_id)
    : undefined
  const pinNumber = pin ? String(pin.tag_number || pin.id) : ""
  const linkedItp = pin?.itp_item_id
    ? itpItems.data?.find((item) => item.id === pin.itp_item_id)
    : undefined

  return (
    <>
      <Dialog
        open={open && !deleting}
        onOpenChange={(next) => {
          if (!next && !busy) onClose()
        }}
      >
        <DialogContent data-testid="pin-detail-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span
                className="inline-block size-3.5 rounded-full border border-white shadow"
                style={{ background: status.color }}
                aria-hidden="true"
              />
              Pin #{pinNumber}
            </DialogTitle>
            <DialogDescription>
              {isPdf ? `Page ${pin?.page_number ?? 1} · ` : ""}
              {status.label}
              {pin?.created_at
                ? ` · placed ${formatDateTime(pin.created_at)}`
                : ""}
              {pin?.created_by ? ` by ${pin.created_by}` : ""}
            </DialogDescription>
          </DialogHeader>

          {canWrite ? (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((values) =>
                  saveMutation.mutate(values),
                )}
                className="flex flex-col gap-4"
                noValidate
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <FormControl>
                          <NativeSelect
                            {...field}
                            data-testid="pin-status-select"
                          >
                            {PIN_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </NativeSelect>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="label"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Label</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Valve V-101" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="finding_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Linked finding</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          data-testid="pin-finding-select"
                        >
                          <option value={NONE}>No finding linked</option>
                          {projectFindings.groups.map((group) => (
                            <optgroup
                              key={group.inspection.id}
                              label={group.inspection.title}
                            >
                              {group.findings.map((finding) => (
                                <option
                                  key={finding.id}
                                  value={String(finding.id)}
                                >
                                  {finding.title}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="itp_item_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ITP line</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} data-testid="pin-itp-select">
                          <option value={NONE}>Not an ITP line</option>
                          {itpGroups.map((group) => (
                            <optgroup key={group.id} label={group.title}>
                              {group.items.map((item) => (
                                <option key={item.id} value={String(item.id)}>
                                  {
                                    classificationInfo(item.classification)
                                      .short
                                  }{" "}
                                  · {item.requirement}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder="What was seen here…"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter className="sm:justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(true)}
                    disabled={busy}
                    data-testid="delete-pin"
                  >
                    <Trash2 />
                    Delete pin
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onClose}
                      disabled={busy}
                    >
                      Close
                    </Button>
                    <LoadingButton
                      type="submit"
                      loading={saveMutation.isPending}
                      data-testid="save-pin"
                    >
                      Save
                    </LoadingButton>
                  </div>
                </DialogFooter>
              </form>
            </Form>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              {pin?.label ? <p className="font-medium">{pin.label}</p> : null}
              {pin?.notes ? (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {pin.notes}
                </p>
              ) : (
                <p className="text-muted-foreground">No notes.</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Close
                </Button>
              </DialogFooter>
            </div>
          )}

          {linkedItp ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="pin-linked-itp"
            >
              Marks{" "}
              {classificationInfo(linkedItp.classification).label.toLowerCase()}{" "}
              <Link
                to="/projects/$projectId/itps/$itpId"
                params={{
                  projectId: String(projectId),
                  itpId: String(linkedItp.project_itp_id),
                }}
                className="inline-flex items-center gap-1 text-vri-copper underline-offset-2 hover:underline"
              >
                {linkedItp.requirement}
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>{" "}
              in {linkedItp.itp_title}
              {linkedItp.classification === "hold"
                ? linkedItp.released
                  ? " — released."
                  : " — waiting for sign-off."
                : "."}
            </p>
          ) : null}
          {linked ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="pin-linked-finding"
            >
              Linked to{" "}
              <Link
                to="/projects/$projectId/inspections/$inspectionId"
                params={{
                  projectId: String(projectId),
                  inspectionId: String(linked.inspection.id),
                }}
                className="inline-flex items-center gap-1 text-vri-copper underline-offset-2 hover:underline"
              >
                {linked.finding.title}
                <ExternalLink className="size-3" aria-hidden="true" />
              </Link>{" "}
              in {linked.inspection.title}.
            </p>
          ) : pin?.finding_id ? (
            <p className="text-xs text-muted-foreground">
              Linked to finding #{pin.finding_id}.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this pin?"
        description={
          <>
            Pin <strong>#{pinNumber}</strong> will be removed from the drawing
            for every member. Any linked finding is kept.
          </>
        }
        confirmLabel="Delete pin"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  )
}

function groupItpItems(
  items: ItpItemRef[],
): Array<{ id: number; title: string; items: ItpItemRef[] }> {
  const groups = new Map<
    number,
    { id: number; title: string; items: ItpItemRef[] }
  >()
  for (const item of items) {
    const group = groups.get(item.project_itp_id) ?? {
      id: item.project_itp_id,
      title: item.area_name
        ? `${item.itp_title} (${item.area_name})`
        : item.itp_title,
      items: [],
    }
    group.items.push(item)
    groups.set(item.project_itp_id, group)
  }
  return [...groups.values()]
}
