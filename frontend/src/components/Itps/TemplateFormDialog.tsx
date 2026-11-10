import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { ItpsService, type ItpTemplatePublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { checkTemplateText, STARTER_TEMPLATE } from "@/lib/itp"
import { itpKeys } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * New master template / edit a master (which saves the next version).
 *
 * The body is SurveyJS JSON typed or pasted into the box (the SurveyJS
 * visual builder is a paid product; PRD v2.63 §5 has templates authored as
 * JSON or generated). A new template starts from a worked concrete-pour
 * example. The box is checked as it changes with the same rules the API
 * applies, so "5 lines · 1 hold point" or the exact problem shows before
 * saving.
 */

interface TemplateFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this version (saves v+1) instead of creating a master. */
  template?: ItpTemplatePublic
  onSaved?: (template: ItpTemplatePublic) => void
}

export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: TemplateFormDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const editing = template !== undefined
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [status, setStatus] = useState<"draft" | "published">("published")
  const [source, setSource] = useState("")

  useEffect(() => {
    if (!open) return
    setName(template?.name ?? "")
    setDescription(template?.description ?? "")
    setStatus("published")
    setSource(JSON.stringify(template?.body ?? STARTER_TEMPLATE, null, 2))
  }, [open, template])

  const check = useMemo(() => checkTemplateText(source), [source])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!check.ok) throw new Error(check.error)
      const body = check.body
      if (template) {
        const response = await ItpsService.updateTemplate({
          path: { template_id: template.id },
          body: {
            name: name.trim(),
            description: description.trim() || null,
            body,
          },
        })
        return response.data as ItpTemplatePublic
      }
      const response = await ItpsService.createTemplate({
        body: {
          name: name.trim(),
          description: description.trim() || null,
          status,
          body,
        },
      })
      return response.data as ItpTemplatePublic
    },
    onSuccess: (saved) => {
      showSuccessToast(
        editing ? `Saved as version ${saved.version}` : "Template created",
      )
      queryClient.invalidateQueries({ queryKey: itpKeys.templates })
      onOpenChange(false)
      onSaved?.(saved)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const canSave = name.trim().length > 0 && check.ok && !mutation.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl"
        data-testid="template-form-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${template.name}` : "New ITP template"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? `Saving creates version ${template.version + 1}. ITPs already applied to projects keep the version they were made from.`
              : "Sections, lines, Hold / Witness / Review / Information classifications, acceptance criteria and evidence, and the roles that sign each line, as SurveyJS JSON."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) mutation.mutate()
          }}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="template-name">Name</Label>
              <Input
                id="template-name"
                value={name}
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Concrete pour — suspended slab"
                data-testid="template-name"
              />
            </div>
            {editing ? null : (
              <div className="flex flex-col gap-2">
                <Label htmlFor="template-status">Status</Label>
                <NativeSelect
                  id="template-status"
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as "draft" | "published")
                  }
                >
                  <option value="published">Published</option>
                  <option value="draft">Draft</option>
                </NativeSelect>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-description">Description</Label>
            <Input
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Scope, standard, when to use it"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-body">Template (SurveyJS JSON)</Label>
            <Textarea
              id="template-body"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              rows={16}
              spellCheck={false}
              className="font-mono text-xs leading-relaxed"
              data-testid="template-body"
            />
            {check.ok ? (
              <p
                className="flex items-center gap-1.5 text-sm text-status-positive-fg"
                data-testid="template-check"
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {check.parsed.items.length} line
                {check.parsed.items.length === 1 ? "" : "s"} ·{" "}
                {check.parsed.holdCount} hold point
                {check.parsed.holdCount === 1 ? "" : "s"} ·{" "}
                {check.parsed.roles.length} sign-off role
                {check.parsed.roles.length === 1 ? "" : "s"}
              </p>
            ) : (
              <p
                className="flex items-start gap-1.5 text-sm text-destructive"
                role="alert"
                data-testid="template-check"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                {check.error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Every question needs <code>"classification"</code> (hold, witness,
              review or information — or H, W, R, I). Hold points list the roles
              that release them in <code>"signoffRoles"</code>; declare roles
              and their party (contractor, client for the owner's
              representative, engineer for a third-party inspector) at the top.
            </p>
            <p className="text-xs text-muted-foreground">
              Optional on any question: <code>"acceptanceCriteria"</code>,{" "}
              <code>"reference"</code>, <code>"recordRequired"</code>,{" "}
              <code>"photoRequired": true</code> (no Pass or sign-off without a
              photo), and for a measured value <code>"valueType"</code> (number
              or text), <code>"unit"</code> (e.g. in, psi, °F),{" "}
              <code>"min"</code> and <code>"max"</code>. A number question (
              <code>"inputType": "number"</code>) takes a value without saying
              so.
            </p>
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
              disabled={!canSave}
              data-testid="save-template"
            >
              {editing ? "Save new version" : "Create template"}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
