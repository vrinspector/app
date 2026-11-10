import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useId, useState } from "react"

import { ItpsService, type ProjectItpPublic } from "@/client"
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
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import useCustomToast from "@/hooks/useCustomToast"
import { areasQuery, templatesQuery } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * Apply a master template to the project — the "frozen-copy import" — either
 * once for the whole project or, in one action, to any number of its areas
 * (bulk apply: one copy per area, all or none). Masters are the signed-in
 * person's own (owner decision 35); archived ones are not offered.
 */

interface ApplyTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  /** Pre-select these areas (the area view passes its own). */
  presetAreaIds?: number[]
  /** Called with the new ITP when exactly one was created. */
  onCreatedOne?: (itp: ProjectItpPublic) => void
}

export function ApplyTemplateDialog({
  open,
  onOpenChange,
  projectId,
  presetAreaIds,
  onCreatedOne,
}: ApplyTemplateDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const templates = useQuery({ ...templatesQuery(false), enabled: open })
  const areas = useQuery({ ...areasQuery(projectId), enabled: open })
  const [templateId, setTemplateId] = useState("")
  const [target, setTarget] = useState<"project" | "areas">("project")
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const allId = useId()

  useEffect(() => {
    if (!open) return
    setTemplateId("")
    setTarget(presetAreaIds?.length ? "areas" : "project")
    setSelected(new Set(presetAreaIds ?? []))
  }, [open, presetAreaIds])

  useEffect(() => {
    if (open && !templateId && templates.data?.length) {
      setTemplateId(String(templates.data[0].id))
    }
  }, [open, templateId, templates.data])

  const areaList = areas.data ?? []
  const chosen = target === "areas" ? [...selected] : []
  const valid = templateId !== "" && (target === "project" || chosen.length > 0)

  const mutation = useMutation({
    mutationFn: async () => {
      const id = Number(templateId)
      if (target === "areas" && chosen.length > 1) {
        const response = await ItpsService.bulkCreateProjectItps({
          path: { project_id: projectId },
          body: { template_id: id, area_ids: chosen },
        })
        return { count: response.data?.length ?? chosen.length, one: null }
      }
      const response = await ItpsService.createProjectItp({
        path: { project_id: projectId },
        body: { template_id: id, area_id: chosen[0] ?? null },
      })
      return { count: 1, one: response.data as ProjectItpPublic }
    },
    onSuccess: ({ count, one }) => {
      showSuccessToast(
        count === 1 ? "ITP added" : `${count} ITPs added — one per area`,
      )
      queryClient.invalidateQueries({ queryKey: ["projects", projectId] })
      for (const areaId of chosen) {
        queryClient.invalidateQueries({ queryKey: ["areas", areaId] })
      }
      onOpenChange(false)
      if (one) onCreatedOne?.(one)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const toggle = (id: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const noTemplates = templates.isSuccess && templates.data.length === 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
    >
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto"
        data-testid="apply-template-dialog"
      >
        <DialogHeader>
          <DialogTitle>Apply an ITP template</DialogTitle>
          <DialogDescription>
            The project gets its own copy. Later edits to the master don't
            change it.
          </DialogDescription>
        </DialogHeader>
        {noTemplates ? (
          <p className="text-sm text-muted-foreground">
            You have no published or draft templates yet.{" "}
            <Link
              to="/itp-templates"
              className="text-vri-copper underline-offset-2 hover:underline"
            >
              Create one
            </Link>{" "}
            first.
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              if (valid) mutation.mutate()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-template">Template</Label>
              <NativeSelect
                id="apply-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                data-testid="apply-template-select"
              >
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name} (v{t.version}, {t.item_count} lines)
                  </option>
                ))}
              </NativeSelect>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Apply to</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="apply-target"
                  checked={target === "project"}
                  onChange={() => setTarget("project")}
                  data-testid="apply-target-project"
                />
                The whole project
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="apply-target"
                  checked={target === "areas"}
                  disabled={areaList.length === 0}
                  onChange={() => setTarget("areas")}
                  data-testid="apply-target-areas"
                />
                Selected areas — one copy each
                {areaList.length === 0 ? (
                  <span className="text-muted-foreground">(no areas yet)</span>
                ) : null}
              </label>
            </fieldset>
            {target === "areas" ? (
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <label
                  htmlFor={allId}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <Checkbox
                    id={allId}
                    checked={
                      selected.size === areaList.length
                        ? true
                        : selected.size
                          ? "indeterminate"
                          : false
                    }
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked === true
                          ? new Set(areaList.map((a) => a.id))
                          : new Set(),
                      )
                    }
                    data-testid="apply-select-all"
                  />
                  All areas ({selected.size} of {areaList.length} selected)
                </label>
                <ul className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">
                  {areaList.map((area) => (
                    <li key={area.id}>
                      <label
                        htmlFor={`${allId}-${area.id}`}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          id={`${allId}-${area.id}`}
                          checked={selected.has(area.id)}
                          onCheckedChange={(c) => toggle(area.id, c === true)}
                          data-testid="apply-area"
                        />
                        {area.name}
                        {area.itp_count ? (
                          <span className="text-xs text-muted-foreground">
                            ({area.itp_count} ITP
                            {area.itp_count === 1 ? "" : "s"})
                          </span>
                        ) : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
                disabled={!valid}
                data-testid="apply-template-submit"
              >
                {target === "areas" && chosen.length > 1
                  ? `Apply to ${chosen.length} areas`
                  : "Apply template"}
              </LoadingButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
