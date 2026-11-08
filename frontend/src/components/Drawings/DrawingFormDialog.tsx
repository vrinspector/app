import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { type DrawingPublic, DrawingsService } from "@/client"
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
import useCustomToast from "@/hooks/useCustomToast"
import { drawingKeys, projectKeys } from "@/lib/queries"
import {
  DRAWING_DISCIPLINE_OPTIONS,
  DRAWING_DISCIPLINE_VALUES,
} from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * "Edit drawing": title, drawing number and discipline via the ported
 * `PUT /drawings/{id}`. Uploads register with the file name as the title
 * and discipline "general" (as the legacy SPA did); this is where a sheet
 * gets its real number and discipline. The file itself is not replaceable —
 * pins are tied to its page geometry — so a revised sheet is a new upload.
 */

const schema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
  drawing_number: z.string().trim().max(100),
  discipline: z.enum(DRAWING_DISCIPLINE_VALUES),
})

type FormValues = z.infer<typeof schema>

function toFormValues(drawing: DrawingPublic): FormValues {
  const stored = drawing.discipline ?? ""
  return {
    title: drawing.title ?? "",
    drawing_number: drawing.drawing_number ?? "",
    discipline: (DRAWING_DISCIPLINE_VALUES as readonly string[]).includes(
      stored,
    )
      ? (stored as FormValues["discipline"])
      : "general",
  }
}

interface DrawingFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  drawing: DrawingPublic
  onSaved?: (drawing: DrawingPublic) => void
}

export function DrawingFormDialog({
  open,
  onOpenChange,
  drawing,
  onSaved,
}: DrawingFormDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(drawing),
  })

  useEffect(() => {
    if (open) form.reset(toFormValues(drawing))
  }, [open, drawing, form])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await DrawingsService.updateDrawing({
        path: { drawing_id: drawing.id },
        body: {
          title: values.title.trim(),
          drawing_number: values.drawing_number.trim() || null,
          discipline: values.discipline,
        },
      })
      return response.data as DrawingPublic
    },
    onSuccess: (saved) => {
      showSuccessToast("Drawing updated")
      queryClient.setQueryData(drawingKeys.detail(saved.id), saved)
      queryClient.invalidateQueries({
        queryKey: projectKeys.drawings(drawing.project_id),
      })
      onOpenChange(false)
      onSaved?.(saved)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={mutation.isPending ? undefined : onOpenChange}
    >
      <DialogContent data-testid="drawing-form-dialog">
        <DialogHeader>
          <DialogTitle>Edit drawing</DialogTitle>
          <DialogDescription>
            Name the sheet the way the drawing register does. The file itself
            stays as uploaded; a revised sheet is a new upload.
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
                      placeholder="e.g. Site grading plan"
                      autoFocus
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="drawing_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Drawing number</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. C-101 Rev B" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="discipline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Discipline</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        {DRAWING_DISCIPLINE_OPTIONS.map((option) => (
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
                data-testid="drawing-form-submit"
              >
                Save changes
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
