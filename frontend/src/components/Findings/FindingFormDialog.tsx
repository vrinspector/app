import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Mic, Square } from "lucide-react"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

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
import { useDictation } from "@/hooks/useDictation"
import { inspectionKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { FINDING_PRIORITY_OPTIONS, FINDING_PRIORITY_VALUES } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * "New Finding" / "Edit finding" — the legacy modal's fields (title*,
 * description with Dictate, priority, location reference). New findings
 * are sent with `status: "open"` exactly as the SPA did; the API refuses
 * them with 409 while the inspection is signed off, which the screen
 * explains before this dialog can open.
 */

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
  description: z.string().trim().max(5000),
  priority: z.enum(FINDING_PRIORITY_VALUES),
  location_ref: z.string().trim().max(255),
})

type FormValues = z.infer<typeof schema>

function toFormValues(finding?: FindingPublic): FormValues {
  const storedPriority = finding?.priority ?? ""
  return {
    title: finding?.title ?? "",
    description: finding?.description ?? "",
    priority: (FINDING_PRIORITY_VALUES as readonly string[]).includes(
      storedPriority,
    )
      ? (storedPriority as FormValues["priority"])
      : "medium",
    location_ref: finding?.location_ref ?? "",
  }
}

const nullIfBlank = (value: string) => (value.trim() ? value.trim() : null)

interface FindingFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  inspectionId: number
  /** When given the dialog edits this finding instead of creating one. */
  finding?: FindingPublic
  onSaved?: (finding: FindingPublic) => void
}

export function FindingFormDialog({
  open,
  onOpenChange,
  inspectionId,
  finding,
  onSaved,
}: FindingFormDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const editing = finding !== undefined

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(finding),
  })

  useEffect(() => {
    if (open) form.reset(toFormValues(finding))
  }, [open, finding, form])

  const dictation = useDictation({
    onTranscript: (text) => {
      const current = form.getValues("description")
      form.setValue("description", current ? `${current} ${text}` : text, {
        shouldDirty: true,
      })
    },
  })

  // Stop listening when the dialog closes so the microphone is released.
  useEffect(() => {
    if (!open) dictation.stop()
  }, [open, dictation.stop])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const fields = {
        title: values.title.trim(),
        description: nullIfBlank(values.description),
        priority: values.priority,
        location_ref: nullIfBlank(values.location_ref),
      }
      if (editing) {
        const response = await FindingsService.updateFinding({
          path: { finding_id: finding.id },
          body: fields,
        })
        return response.data as FindingPublic
      }
      const response = await FindingsService.createFinding({
        body: { inspection_id: inspectionId, ...fields, status: "open" },
      })
      return response.data as FindingPublic
    },
    onSuccess: (saved) => {
      showSuccessToast(editing ? "Finding updated" : "Finding logged")
      queryClient.invalidateQueries({
        queryKey: inspectionKeys.findings(inspectionId),
      })
      onOpenChange(false)
      onSaved?.(saved)
    },
    onError: (error: Error) => {
      showErrorToast(extractErrorMessage(error))
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={mutation.isPending ? undefined : onOpenChange}
    >
      <DialogContent data-testid="finding-form-dialog">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit finding" : "Log a finding"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Change what was observed. Its status and resolution are managed from the card."
              : "One observation, as you would write it in the field notebook. You can dictate the description."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
            className="flex flex-col gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Cracked footing NE corner"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-2">
                    <FormLabel>Description</FormLabel>
                    {dictation.supported ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={dictation.toggle}
                        aria-pressed={dictation.listening}
                        data-testid="dictate-button"
                        className={cn(
                          "h-8 text-vri-copper",
                          dictation.listening &&
                            "animate-pulse text-destructive hover:text-destructive",
                        )}
                      >
                        {dictation.listening ? <Square /> : <Mic />}
                        {dictation.listening ? "Stop" : "Dictate"}
                      </Button>
                    ) : null}
                  </div>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the issue…"
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  {dictation.listening ? (
                    <p
                      className="text-xs text-destructive"
                      role="status"
                      aria-live="polite"
                    >
                      Listening… speak, then tap Stop.
                    </p>
                  ) : dictation.error ? (
                    <p className="text-xs text-muted-foreground" role="status">
                      {dictation.error}
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {FINDING_PRIORITY_OPTIONS.map((option) => (
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
                name="location_ref"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location reference</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Grid A-4, Elev. 102.5"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
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
                type="submit"
                loading={mutation.isPending}
                data-testid="finding-form-submit"
              >
                {editing ? "Save changes" : "Log finding"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
