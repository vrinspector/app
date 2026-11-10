import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  ArrowDown,
  ArrowUp,
  Layers,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useEffect, useState } from "react"

import { type AreaPublic, AreasService } from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { EmptyState, QueryState } from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
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
import useCustomToast from "@/hooks/useCustomToast"
import { AREA_TYPE_OPTIONS, type AreaType } from "@/lib/itp"
import { areasQuery, projectKeys } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

import { ItpProgress } from "./ItpBadges"

/*
 * Areas (owner decision 2026-11-08): the levels, lots, stages or chainages a
 * project is split into, so one master ITP can be applied to each of them.
 * Add one, or a numbered series in one go ("Level" 1–12 → Level 1 … Level
 * 12); rename, retype or nest; move up and down; delete (refused by the API
 * once an area has signed ITPs). Each row opens the area view with its ITPs.
 */

const areaTypeLabel = (value: string) =>
  AREA_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value

interface AreasSectionProps {
  projectId: number
  canWrite: boolean
}

export function AreasSection({ projectId, canWrite }: AreasSectionProps) {
  const query = useQuery(areasQuery(projectId))
  const [adding, setAdding] = useState(false)
  const [bulk, setBulk] = useState(false)

  const actions = canWrite ? (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => setBulk(true)}
        data-testid="add-area-series"
      >
        <ListPlus />
        Add a series
      </Button>
      <Button
        variant="outline"
        onClick={() => setAdding(true)}
        data-testid="add-area"
      >
        <Plus />
        Add area
      </Button>
    </div>
  ) : null

  return (
    <section aria-labelledby="areas-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="areas-heading" className="text-lg font-semibold">
          Areas{" "}
          <span className="text-muted-foreground" data-testid="areas-count">
            ({query.data?.length ?? 0})
          </span>
        </h2>
        {query.data?.length ? actions : null}
      </div>
      <QueryState
        query={query}
        errorTitle="Couldn't load the areas"
        empty={
          <EmptyState
            icon={<Layers />}
            title="No areas yet"
            description="Split the project into levels, lots, stages or chainages to apply one ITP to each and sign them off area by area."
            action={actions}
            className="py-8"
          />
        }
      >
        {(areas) => (
          <AreaList projectId={projectId} areas={areas} canWrite={canWrite} />
        )}
      </QueryState>
      <AreaFormDialog
        open={adding}
        onOpenChange={setAdding}
        projectId={projectId}
        areas={query.data ?? []}
      />
      <BulkAreasDialog
        open={bulk}
        onOpenChange={setBulk}
        projectId={projectId}
        areas={query.data ?? []}
      />
    </section>
  )
}

function AreaList({
  projectId,
  areas,
  canWrite,
}: {
  projectId: number
  areas: AreaPublic[]
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editing, setEditing] = useState<AreaPublic | null>(null)
  const [deleting, setDeleting] = useState<AreaPublic | null>(null)
  const byId = new Map(areas.map((a) => [a.id, a]))

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["projects", projectId] })

  const orderMutation = useMutation({
    mutationFn: async (ids: number[]) =>
      (
        await AreasService.reorderAreas({
          path: { project_id: projectId },
          body: { area_ids: ids },
        })
      ).data as AreaPublic[],
    onSuccess: (saved) => {
      queryClient.setQueryData(projectKeys.areas(projectId), saved)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (area: AreaPublic) =>
      AreasService.deleteArea({ path: { area_id: area.id } }),
    onSuccess: () => {
      showSuccessToast("Area deleted")
      setDeleting(null)
      refresh()
    },
    onError: (error: Error) => {
      setDeleting(null)
      showErrorToast(extractErrorMessage(error))
    },
  })

  const move = (index: number, delta: number) => {
    const ids = areas.map((a) => a.id)
    const target = index + delta
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    orderMutation.mutate(ids)
  }

  return (
    <>
      <ul
        className="divide-y rounded-lg border bg-card"
        data-testid="area-list"
      >
        {areas.map((area, index) => {
          const parent = area.parent_area_id
            ? byId.get(area.parent_area_id)
            : undefined
          return (
            <li
              key={area.id}
              className="flex items-center gap-3 px-4 py-3"
              data-testid="area-row"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/projects/$projectId/areas/$areaId"
                    params={{
                      projectId: String(projectId),
                      areaId: String(area.id),
                    }}
                    className="truncate font-semibold hover:text-vri-copper"
                  >
                    {area.name}
                  </Link>
                  <StatusBadge
                    value={area.area_type}
                    tone="neutral"
                    label={areaTypeLabel(area.area_type)}
                  />
                  {parent ? (
                    <span className="text-xs text-muted-foreground">
                      in {parent.name}
                    </span>
                  ) : null}
                </div>
                {area.itp_count ? (
                  <ItpProgress
                    className="mt-1.5 max-w-xs"
                    done={area.done_count ?? 0}
                    total={area.item_count ?? 0}
                    openHolds={area.open_hold_count ?? 0}
                  />
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    No ITPs yet
                  </p>
                )}
              </div>
              {area.itp_count ? (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {area.complete_count}/{area.itp_count} ITP
                  {area.itp_count === 1 ? "" : "s"} complete
                </span>
              ) : null}
              {canWrite ? (
                <div className="flex items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${area.name} up`}
                    disabled={index === 0 || orderMutation.isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Move ${area.name} down`}
                    disabled={
                      index === areas.length - 1 || orderMutation.isPending
                    }
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${area.name} actions`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(area)}>
                        <Pencil />
                        Rename / change type
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleting(area)}
                      >
                        <Trash2 />
                        Delete area
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <AreaFormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        projectId={projectId}
        areas={areas}
        area={editing ?? undefined}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Delete this area?"
        description={
          <>
            <strong>{deleting?.name}</strong> is removed. Its unsigned ITPs are
            kept as whole-project ITPs and any areas inside it move to the top
            level. An area with signed ITPs cannot be deleted.
          </>
        }
        confirmLabel="Delete area"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting) deleteMutation.mutate(deleting)
        }}
      />
    </>
  )
}

interface AreaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  areas: AreaPublic[]
  /** Edit this area instead of adding one. */
  area?: AreaPublic
}

function ParentSelect({
  id,
  areas,
  value,
  onChange,
  exclude,
}: {
  id: string
  areas: AreaPublic[]
  value: string
  onChange: (value: string) => void
  exclude?: number
}) {
  return (
    <NativeSelect
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">None (top level)</option>
      {areas
        .filter((a) => a.id !== exclude)
        .map((a) => (
          <option key={a.id} value={String(a.id)}>
            {a.name}
          </option>
        ))}
    </NativeSelect>
  )
}

export function AreaFormDialog({
  open,
  onOpenChange,
  projectId,
  areas,
  area,
}: AreaDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [name, setName] = useState("")
  const [type, setType] = useState<AreaType>("level")
  const [parent, setParent] = useState("")

  useEffect(() => {
    if (!open) return
    setName(area?.name ?? "")
    setType((area?.area_type as AreaType | undefined) ?? "level")
    setParent(area?.parent_area_id ? String(area.parent_area_id) : "")
  }, [open, area])

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        area_type: type,
        parent_area_id: parent ? Number(parent) : null,
      }
      if (area) {
        return AreasService.updateArea({ path: { area_id: area.id }, body })
      }
      return AreasService.createArea({ path: { project_id: projectId }, body })
    },
    onSuccess: () => {
      showSuccessToast(area ? "Area updated" : "Area added")
      queryClient.invalidateQueries({ queryKey: ["projects", projectId] })
      if (area) queryClient.invalidateQueries({ queryKey: ["areas", area.id] })
      onOpenChange(false)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
    >
      <DialogContent data-testid="area-form-dialog">
        <DialogHeader>
          <DialogTitle>{area ? "Edit area" : "Add an area"}</DialogTitle>
          <DialogDescription>
            A level, lot, stage or chainage that gets its own ITPs and sign-off.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) mutation.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="area-name">Name</Label>
            <Input
              id="area-name"
              value={name}
              maxLength={255}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Level 3, Lot 14, CH 1200–1400"
              data-testid="area-name"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-type">Type</Label>
              <NativeSelect
                id="area-type"
                value={type}
                onChange={(e) => setType(e.target.value as AreaType)}
              >
                {AREA_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-parent">Inside</Label>
              <ParentSelect
                id="area-parent"
                areas={areas}
                value={parent}
                onChange={setParent}
                exclude={area?.id}
              />
            </div>
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
              disabled={!name.trim()}
              data-testid="save-area"
            >
              {area ? "Save" : "Add area"}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function BulkAreasDialog({
  open,
  onOpenChange,
  projectId,
  areas,
}: AreaDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [prefix, setPrefix] = useState("Level")
  const [start, setStart] = useState("1")
  const [end, setEnd] = useState("12")
  const [type, setType] = useState<AreaType>("level")
  const [parent, setParent] = useState("")

  useEffect(() => {
    if (open) {
      setPrefix("Level")
      setStart("1")
      setEnd("12")
      setType("level")
      setParent("")
    }
  }, [open])

  const from = Number.parseInt(start, 10)
  const to = Number.parseInt(end, 10)
  const count = Number.isFinite(from) && Number.isFinite(to) ? to - from + 1 : 0
  const problem = !prefix.trim()
    ? "Give the series a name, e.g. Level or Lot."
    : !Number.isFinite(from) || !Number.isFinite(to) || from < 0
      ? "Enter the first and last numbers."
      : count < 1
        ? "The last number is before the first."
        : count > 200
          ? "Add at most 200 areas at a time."
          : null

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await AreasService.bulkCreateAreas({
          path: { project_id: projectId },
          body: {
            prefix: prefix.trim(),
            start: from,
            end: to,
            area_type: type,
            parent_area_id: parent ? Number(parent) : null,
          },
        })
      ).data as AreaPublic[],
    onSuccess: (created) => {
      showSuccessToast(`${created.length} areas added`)
      queryClient.invalidateQueries({ queryKey: ["projects", projectId] })
      onOpenChange(false)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}
    >
      <DialogContent data-testid="bulk-areas-dialog">
        <DialogHeader>
          <DialogTitle>Add a numbered series</DialogTitle>
          <DialogDescription>
            For example Level 1 to Level 12, or Lot 1 to Lot 40.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            if (!problem) mutation.mutate()
          }}
        >
          <div className="grid grid-cols-[1fr_5rem_5rem] gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="series-prefix">Name</Label>
              <Input
                id="series-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                data-testid="series-prefix"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="series-start">From</Label>
              <Input
                id="series-start"
                inputMode="numeric"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                data-testid="series-start"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="series-end">To</Label>
              <Input
                id="series-end"
                inputMode="numeric"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                data-testid="series-end"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="series-type">Type</Label>
              <NativeSelect
                id="series-type"
                value={type}
                onChange={(e) => setType(e.target.value as AreaType)}
              >
                {AREA_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="series-parent">Inside</Label>
              <ParentSelect
                id="series-parent"
                areas={areas}
                value={parent}
                onChange={setParent}
              />
            </div>
          </div>
          <p
            className={
              problem
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
            data-testid="series-preview"
          >
            {problem ??
              `${count} area${count === 1 ? "" : "s"}: ${prefix.trim()} ${from}${count > 1 ? ` … ${prefix.trim()} ${to}` : ""}`}
          </p>
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
              disabled={problem !== null}
              data-testid="save-area-series"
            >
              Add {count > 0 && !problem ? count : ""} areas
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
