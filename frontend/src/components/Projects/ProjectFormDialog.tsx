import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { type ProjectPublic, ProjectsService } from "@/client"
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
import {
  derivedProjectCode,
  itpDocNumber,
  normaliseProjectCode,
} from "@/lib/itp"
import { projectKeys } from "@/lib/queries"
import { PROJECT_STATUS_OPTIONS, PROJECT_STATUS_VALUES } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * "New Project" / "Edit project" — the legacy modal's four fields (name*,
 * client/owner, location, status). Blank optional fields are sent as null,
 * as the SPA did; `created_by` is no longer sent because the API stamps the
 * verified identity itself (docs/API_PORT.md, Authorization).
 *
 * Increment 13.8 adds an optional ITP code — the PROJECT CODE in ITP document
 * numbers (ITP-<CODE>-001). Left blank, one is derived from the name, and
 * the field shows which.
 */

const schema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(200),
  client: z.string().trim().max(200),
  location: z.string().trim().max(200),
  status: z.enum(PROJECT_STATUS_VALUES),
  code: z
    .string()
    .max(30)
    .refine((value) => !normaliseProjectCode(value).error, {
      message:
        "Letters, digits and hyphens only (up to 20); start and end with a letter or digit",
    }),
})

type FormValues = z.infer<typeof schema>

function toFormValues(project?: ProjectPublic): FormValues {
  return {
    name: project?.name ?? "",
    client: project?.client ?? "",
    location: project?.location ?? "",
    status: (PROJECT_STATUS_VALUES as readonly string[]).includes(
      project?.status ?? "",
    )
      ? (project?.status as FormValues["status"])
      : "active",
    code: project?.code ?? "",
  }
}

const nullIfBlank = (value: string) => (value.trim() ? value.trim() : null)

function codeChange(typed: string, project?: ProjectPublic): { code?: string } {
  const code = normaliseProjectCode(typed).code
  if (code === (project?.code ?? null)) return {}
  return { code: code ?? "" }
}

interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When given the dialog edits this project instead of creating one. */
  project?: ProjectPublic
  onSaved?: (project: ProjectPublic) => void
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: ProjectFormDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const editing = project !== undefined

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toFormValues(project),
  })

  // Re-seed when the dialog (re)opens or a different project is edited.
  useEffect(() => {
    if (open) form.reset(toFormValues(project))
  }, [open, project, form])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const body = {
        name: values.name.trim(),
        client: nullIfBlank(values.client),
        location: nullIfBlank(values.location),
        status: values.status,
        // Sent only when it changes, so the legacy body stays as it was; ""
        // clears a code on edit (the derived one is used again).
        ...codeChange(values.code, project),
      }
      if (editing) {
        const response = await ProjectsService.updateProject({
          path: { project_id: project.id },
          body,
        })
        return response.data as ProjectPublic
      }
      const response = await ProjectsService.createProject({ body })
      return response.data as ProjectPublic
    },
    onSuccess: (saved) => {
      showSuccessToast(editing ? "Project updated" : "Project created")
      queryClient.invalidateQueries({ queryKey: projectKeys.all })
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
      <DialogContent data-testid="project-form-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Change the project's details. Inspections and members are not affected."
              : "A project groups the inspections, drawings and members for one site or contract."}
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
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Landfill Gas Project"
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
              name="client"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client / owner</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Redtail Renewables" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Richmond VA" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => {
                const typed = normaliseProjectCode(field.value)
                const name = form.watch("name")
                const code =
                  typed.code && !typed.error
                    ? typed.code
                    : derivedProjectCode(name, project?.id ?? 0)
                return (
                  <FormItem>
                    <FormLabel>ITP code (optional)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={derivedProjectCode(name, project?.id ?? 0)}
                        autoCapitalize="characters"
                        data-testid="project-code"
                        {...field}
                      />
                    </FormControl>
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="project-code-preview"
                    >
                      ITPs are numbered {itpDocNumber(code, 1)},{" "}
                      {itpDocNumber(code, 2)} …
                      {typed.code ? "" : " (from the project name)"}
                    </p>
                    <FormMessage />
                  </FormItem>
                )
              }}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      {PROJECT_STATUS_OPTIONS.map((option) => (
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
                data-testid="project-form-submit"
              >
                {editing ? "Save changes" : "Create project"}
              </LoadingButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
