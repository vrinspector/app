import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { Fragment, useEffect, useMemo, useState } from "react"

import {
  type ItpItemPublic,
  ItpsService,
  type ProjectItpPublic,
} from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { PageHeader } from "@/components/Common/PageHeader"
import { DetailState, NotFoundState } from "@/components/Common/States"
import {
  DocNumber,
  ItpProgress,
  ItpStatusBadge,
} from "@/components/Itps/ItpBadges"
import { ItpItemRow, type SignerContext } from "@/components/Itps/ItpItemRow"
import { SurveyPreview } from "@/components/Itps/SurveyPreview"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useProjectRole } from "@/hooks/useProjectRole"
import { formatDate, joinMeta } from "@/lib/format"
import {
  areasQuery,
  itpKeys,
  itpQuery,
  parseId,
  projectKeys,
  projectQuery,
} from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute(
  "/_layout/projects/$projectId/itps/$itpId",
)({
  component: ItpScreen,
  head: () => ({ meta: [{ title: "ITP - VR Inspector" }] }),
})

function ItpScreen() {
  const { projectId: rawProject, itpId: rawItp } = Route.useParams()
  const projectId = parseId(rawProject)
  const itpId = parseId(rawItp)
  if (projectId === undefined) {
    return (
      <NotFoundState
        noun="project"
        backTo="/projects"
        backLabel="Back to projects"
      />
    )
  }
  if (itpId === undefined) return <ItpNotFound projectId={projectId} />
  return <ItpDetail projectId={projectId} itpId={itpId} />
}

function ItpNotFound({ projectId }: { projectId: number }) {
  return (
    <NotFoundState
      noun="ITP"
      backTo="/projects/$projectId"
      backParams={{ projectId: String(projectId) }}
      backLabel="Back to project"
    />
  )
}

function ItpDetail({ projectId, itpId }: { projectId: number; itpId: number }) {
  const query = useQuery(itpQuery(itpId))
  return (
    <DetailState
      query={query}
      noun="ITP"
      backTo="/projects/$projectId"
      backParams={{ projectId: String(projectId) }}
      backLabel="Back to project"
      errorTitle="Couldn't load this ITP"
    >
      {(itp) =>
        itp.project_id !== projectId ? (
          <ItpNotFound projectId={projectId} />
        ) : (
          <ItpBody projectId={projectId} itp={itp} />
        )
      }
    </DetailState>
  )
}

/**
 * One project ITP (Block 9.5): the checklist grouped by section with
 * Pass / Fail / N/A per line, hold-point locks and sign-off, pins in both
 * directions, and the SurveyJS form view of the frozen copy. "Mark complete"
 * stays available but explains what is still in the way.
 */
function ItpBody({
  projectId,
  itp,
}: {
  projectId: number
  itp: ProjectItpPublic
}) {
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { user } = useAuth()
  const project = useQuery(projectQuery(projectId))
  const { canWrite, canManage, role } = useProjectRole(projectId)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const editable = itp.status !== "complete" && itp.status !== "voided"
  const who: SignerContext = {
    email: user?.email,
    isOwner: role === "owner",
    canWrite,
  }
  const byId = useMemo(
    () => new Map(itp.items.map((item) => [item.id, item])),
    [itp.items],
  )
  const sections = useMemo(() => groupBySection(itp.items), [itp.items])
  const lineIndex = useMemo(
    () => new Map(itp.items.map((item, i) => [item.id, i])),
    [itp.items],
  )
  const results = useMemo(
    () =>
      Object.fromEntries(
        itp.items
          .filter((i) => i.element_name)
          .map((i) => [i.element_name as string, i.status]),
      ),
    [itp.items],
  )

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["projects", projectId] })
    if (itp.area_id) {
      queryClient.invalidateQueries({ queryKey: itpKeys.area(itp.area_id) })
    }
  }

  const statusMutation = useMutation({
    mutationFn: async (status: ProjectItpPublic["status"]) =>
      (
        await ItpsService.updateProjectItp({
          path: { itp_id: itp.id },
          body: { status: status as never },
        })
      ).data as ProjectItpPublic,
    onSuccess: (saved) => {
      queryClient.setQueryData(itpKeys.detail(saved.id), saved)
      invalidate()
      showSuccessToast(
        saved.status === "complete"
          ? "ITP complete"
          : saved.status === "voided"
            ? "ITP voided"
            : "ITP reopened",
      )
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      ItpsService.deleteProjectItp({ path: { itp_id: itp.id } }),
    onSuccess: () => {
      showSuccessToast("ITP deleted")
      queryClient.removeQueries({ queryKey: itpKeys.detail(itp.id) })
      invalidate()
      navigate({
        to: "/projects/$projectId",
        params: { projectId: String(projectId) },
        replace: true,
      })
    },
    onError: (error: Error) => {
      setDeleting(false)
      showErrorToast(extractErrorMessage(error))
    },
  })

  let lineNumber = 0

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            {itp.doc_number ? (
              <>
                <DocNumber value={itp.doc_number} className="text-xs" />
                <span aria-hidden="true"> · </span>
              </>
            ) : null}
            {project.data?.name ?? "ITP"}
          </>
        }
        title={itp.title}
        description={joinMeta(
          itp.area_name ?? "Whole project",
          itp.template_version ? `template v${itp.template_version}` : null,
          `added ${formatDate(itp.created_at)}`,
        )}
        backTo={
          itp.area_id
            ? "/projects/$projectId/areas/$areaId"
            : "/projects/$projectId"
        }
        backParams={
          itp.area_id
            ? { projectId: String(projectId), areaId: String(itp.area_id) }
            : { projectId: String(projectId) }
        }
        backLabel={itp.area_id ? `Back to ${itp.area_name}` : "Back to project"}
        actions={
          canWrite ? (
            <>
              {editable ? (
                <LoadingButton
                  onClick={() => statusMutation.mutate("complete")}
                  loading={statusMutation.isPending}
                  disabled={itp.completion_blockers.length > 0}
                  title={itp.completion_blockers.join("\n") || undefined}
                  data-testid="itp-complete"
                >
                  <CheckCircle2 />
                  Mark complete
                </LoadingButton>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="ITP actions"
                    data-testid="itp-actions"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    <Pencil />
                    Rename / move to area
                  </DropdownMenuItem>
                  {itp.status === "complete" ? (
                    <DropdownMenuItem
                      onSelect={() => statusMutation.mutate("in_progress")}
                    >
                      <RotateCcw />
                      Reopen
                    </DropdownMenuItem>
                  ) : null}
                  {canManage ? (
                    itp.status === "voided" ? (
                      <DropdownMenuItem
                        onSelect={() => statusMutation.mutate("in_progress")}
                      >
                        <RotateCcw />
                        Restore
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onSelect={() => statusMutation.mutate("voided")}
                      >
                        <Ban />
                        Void
                      </DropdownMenuItem>
                    )
                  ) : null}
                  {itp.signature_count === 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleting(true)}
                      >
                        <Trash2 />
                        Delete ITP
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      />

      <div
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center"
        data-testid="itp-summary"
      >
        <ItpStatusBadge value={itp.status} />
        <ItpProgress
          className="flex-1"
          done={itp.done_count}
          total={itp.item_count}
          openHolds={itp.open_hold_count}
        />
        <span className="text-sm text-muted-foreground">
          {itp.signature_count} signature{itp.signature_count === 1 ? "" : "s"}
        </span>
      </div>

      {editable && itp.completion_blockers.length ? (
        <div
          className="flex gap-2 rounded-lg border border-status-attention-fg/30 bg-status-attention-bg p-3 text-sm text-status-attention-fg"
          data-testid="itp-blockers"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">Before this ITP can be completed:</p>
            <ul className="mt-1 list-disc pl-5">
              {itp.completion_blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {itp.status === "voided" ? (
        <p className="rounded-lg bg-muted p-3 text-sm">
          This ITP is voided. It is kept as a record; nothing can be recorded on
          it.
        </p>
      ) : null}

      <Tabs defaultValue="checklist">
        <TabsList>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="form" data-testid="itp-form-tab">
            Form view
          </TabsTrigger>
        </TabsList>
        <TabsContent value="checklist" className="flex flex-col gap-4 pt-2">
          {sections.map(([section, items]) => {
            const first = lineNumber
            lineNumber += items.length
            return (
              <ChecklistSection
                key={`${section ?? "_"}-${first}`}
                title={section}
                items={items}
                firstIndex={first}
                lineIndex={lineIndex}
                byId={byId}
                render={(item, index) => (
                  <ItpItemRow
                    key={item.id}
                    projectId={projectId}
                    itp={itp}
                    item={item}
                    index={index}
                    who={who}
                    editable={editable}
                    blockedBy={
                      item.blocked_by_item_id
                        ? byId.get(item.blocked_by_item_id)
                        : undefined
                    }
                  />
                )}
              />
            )
          })}
        </TabsContent>
        <TabsContent value="form" className="pt-2">
          <p className="mb-2 text-sm text-muted-foreground">
            The frozen copy of the template as a form, with the results recorded
            on the checklist.
          </p>
          <SurveyPreview body={itp.body} results={results} />
        </TabsContent>
      </Tabs>

      <EditItpDialog
        open={editing}
        onOpenChange={setEditing}
        projectId={projectId}
        itp={itp}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this ITP?"
        description={
          <>
            <strong>{itp.title}</strong> and its recorded results are removed.
            Pins that mark its lines stay on the drawings.
          </>
        }
        confirmLabel="Delete ITP"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />
    </>
  )
}

/**
 * Increment 13.8: one section of the checklist under a green header bar
 * (serif title, lines recorded, "Sign-off required" while a hold point in it
 * waits) and a single lock notice above the first locked line, instead of a
 * banner on every locked line.
 */
function ChecklistSection({
  title,
  items,
  firstIndex,
  lineIndex,
  byId,
  render,
}: {
  title: string | null
  items: ItpItemPublic[]
  firstIndex: number
  lineIndex: Map<number, number>
  byId: Map<number, ItpItemPublic>
  render: (item: ItpItemPublic, index: number) => React.ReactNode
}) {
  const done = items.filter((i) => i.status !== "pending").length
  const openHolds = items.filter(
    (i) => i.classification === "hold" && !i.released,
  ).length
  const firstLocked = items.find((i) => i.blocked_by_item_id)
  const gate = firstLocked?.blocked_by_item_id
    ? byId.get(firstLocked.blocked_by_item_id)
    : undefined
  const waitingFor = gate
    ? gate.required_roles
        .filter((r) => !gate.signatures.some((s) => s.signoff_role_id === r.id))
        .map((r) => r.role_name)
    : []

  return (
    <section
      className="overflow-hidden rounded-lg border bg-card"
      data-testid="itp-section"
    >
      <header
        className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-vri-green px-4 py-2.5 text-vri-offwhite"
        data-testid="itp-section-header"
      >
        <h2 className="min-w-0 flex-1 font-heading text-base font-semibold">
          {title ?? "Checklist"}
        </h2>
        {openHolds ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-vri-brick px-2.5 py-0.5 text-xs font-semibold text-vri-offwhite"
            data-testid="itp-section-signoff"
          >
            <Lock className="size-3" aria-hidden="true" />
            Sign-off required
          </span>
        ) : null}
        <span className="text-xs tabular-nums text-vri-offwhite/80">
          {done} / {items.length}
        </span>
      </header>
      <ol className="divide-y">
        {items.map((item, i) => (
          <Fragment key={item.id}>
            {item === firstLocked && gate ? (
              <li
                className="flex items-start gap-2 bg-status-critical-bg px-4 py-2.5 text-sm text-status-critical-fg"
                data-testid="itp-section-lock"
              >
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {item === items[0]
                    ? "This section is locked"
                    : `Locked from line ${firstIndex + i + 1}`}{" "}
                  until the hold point on line{" "}
                  {(lineIndex.get(gate.id) ?? 0) + 1}, “{gate.requirement}”, is
                  signed off
                  {waitingFor.length ? ` by ${waitingFor.join(" and ")}` : ""}.
                </span>
              </li>
            ) : null}
            {render(item, firstIndex + i)}
          </Fragment>
        ))}
      </ol>
    </section>
  )
}

function groupBySection(
  items: ItpItemPublic[],
): Array<[string | null, ItpItemPublic[]]> {
  const groups: Array<[string | null, ItpItemPublic[]]> = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last[0] === item.section) last[1].push(item)
    else groups.push([item.section, [item]])
  }
  return groups
}

function EditItpDialog({
  open,
  onOpenChange,
  projectId,
  itp,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  itp: ProjectItpPublic
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const areas = useQuery({ ...areasQuery(projectId), enabled: open })
  const [title, setTitle] = useState(itp.title)
  const [area, setArea] = useState(itp.area_id ? String(itp.area_id) : "")

  useEffect(() => {
    if (open) {
      setTitle(itp.title)
      setArea(itp.area_id ? String(itp.area_id) : "")
    }
  }, [open, itp])

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await ItpsService.updateProjectItp({
          path: { itp_id: itp.id },
          body: { title: title.trim(), area_id: area ? Number(area) : null },
        })
      ).data as ProjectItpPublic,
    onSuccess: (saved) => {
      queryClient.setQueryData(itpKeys.detail(saved.id), saved)
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
      queryClient.invalidateQueries({ queryKey: ["areas"] })
      showSuccessToast("ITP updated")
      onOpenChange(false)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename or move this ITP</DialogTitle>
          <DialogDescription>
            An ITP belongs to the whole project or to one area.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (title.trim()) mutation.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="itp-title">Title</Label>
            <Input
              id="itp-title"
              value={title}
              maxLength={255}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="itp-area">Area</Label>
            <NativeSelect
              id="itp-area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="">Whole project</option>
              {(areas.data ?? []).map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
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
              disabled={!title.trim()}
            >
              Save
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
