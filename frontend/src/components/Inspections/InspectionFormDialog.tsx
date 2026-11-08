import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { type InspectionPublic, InspectionsService } from "@/client"
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
import { inspectionKeys, projectKeys } from "@/lib/queries"
import { INSPECTION_TYPE_OPTIONS, INSPECTION_TYPE_VALUES } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * "New Inspection" / "Edit inspection" — the legacy modal's fields (title*,
 * type, inspector name, notes). New inspections open with `status: "open"`
 * as the SPA sent; the type defaults to Civil (the legacy select's first
 * option) and the inspector field to the signed-in person's name so the
 * common case is one tap.
 */

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  inspection_type: z.enum(INSPECTION_TYPE_VALUES),
  inspector: z.string().trim().max(200),
  notes: z.string().trim().max(5000),
})

type FormValues = z.infer<typeof schema>

function toFormValues(
  inspection?: InspectionPublic,
  defaultInspector?: string,
): FormValues {
  const storedType = inspection?.inspection_type ?? inspection?.type ?? ""
  return {
    title: inspection?.title ?? "",
    inspection_type: (INSPECTION_TYPE_VALUES as readonly string[]).includes(
      storedType,
    )
      ? (storedType as FormValues["inspection_type"])
      : "civil",
    inspector: inspection
      ? (inspection.inspector ?? "")
      : (defaultInspector ?? ""),
    notes: inspection?.notes ?? "",
  }
}

const nullIfBlank = (value: string) => (value.trim() ? value.trim() : null)

interface InspectionFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  /** When given the dialog edits this inspection instead of creating one. */
  inspection?: InspectionPublic
  /** Pre-fills "Inspector" on a new inspection. */
  defaultInspector?: string
  onSaved?: (inspection: InspectionPublic) => void
}

export function InspectionFormDialog({
  open,
  onOpenChange,
  projectId,
  inspection,
  defaultInspector,
  onSaved,
}: InspectionFormDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const editing = inspection !== undefined

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(inspection, defaultInspector),
  })

  useEffect(() => {
    if (open) form.reset(toFormValues(inspection, defaultInspector))
  }, [open, inspection, defaultInspector, form])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const fields = {
        title: values.title.trim(),
        inspection_type: values.inspection_type,
        inspector: nullIfBlank(values.inspector),
        notes: nullIfBlank(values.notes),
      }
      if (editing) {
        const response = await InspectionsService.updateInspection({
          path: { inspection_id: inspection.id },
          body: fields,
        })
        return response.data as InspectionPublic
      }
      const response = await InspectionsService.createInspection({
        body: { project_id: projectId, status: "open", ...fields },
      })
      return response.data as InspectionPublic
    },
    onSuccess: (saved) => {
      showSuccessToast(editing ? "Inspection updated" : "Inspection created")
      queryClient.invalidateQueries({
        queryKey: projectKeys.inspections(projectId),
      })
      if (editing) {
        queryClient.setQueryData(inspectionKeys.detail(saved.id), saved)
      }
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
      <DialogContent data-testid="inspection-form-dialog">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit inspection" : "New inspection"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Change the inspection's details. Findings and photos are not affected."
              : "One inspection is one site walk. Findings and photos are logged inside it."}
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
                      placeholder="e.g. Site Walk #1 - Civil"
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
              name="inspection_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {INSPECTION_TYPE_OPTIONS.map((option) => (
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
              name="inspector"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Inspector name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Stacey Roberts" {...field} />
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
                      placeholder="Initial observations..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                data-testid="inspection-form-submit"
              >
                {editing ? "Save changes" : "Create inspection"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
