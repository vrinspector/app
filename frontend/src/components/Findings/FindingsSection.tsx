import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { type FindingPublic, FindingsService, type PhotoPublic } from "@/client"
import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { FilterInput } from "@/components/Common/FilterInput"
import { EmptyState, QueryState } from "@/components/Common/States"
import { DrawingPickerMenu } from "@/components/Drawings/DrawingPickerMenu"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import useCustomToast from "@/hooks/useCustomToast"
import { matchesFilter } from "@/lib/format"
import { findingsQuery, inspectionKeys, photosQuery } from "@/lib/queries"
import { FINDING_STATUS_OPTIONS } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"
import { FindingCard } from "./FindingCard"
import { FindingFormDialog } from "./FindingFormDialog"
import { ResolveFindingDialog } from "./ResolveFindingDialog"

/*
 * The "Findings (N)" half of the legacy findings screen: search box, status
 * filter, "Log finding", and the cards. Filtering is client-side over the
 * loaded list, as `filterFindings` was. `canWrite` comes from the project
 * role; `closed` from the inspection's sign-off state — either one hides
 * the write actions, and the API enforces both.
 *
 * Increment 11a: "Pin on drawing" opens a drawing with this inspection
 * pre-selected for the capture loop, and each card shows the photos filed
 * under its finding (`photos.finding_id`).
 */

interface FindingsSectionProps {
  projectId: number
  inspectionId: number
  canWrite: boolean
  closed: boolean
  /** Opened by the capture bar on phones as well as the section button. */
  logging: boolean
  onLoggingChange: (open: boolean) => void
}

export function FindingsSection({
  projectId,
  inspectionId,
  canWrite,
  closed,
  logging,
  onLoggingChange,
}: FindingsSectionProps) {
  const query = useQuery(findingsQuery(inspectionId))
  const photos = useQuery(photosQuery(inspectionId))
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [filter, setFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [resolving, setResolving] = useState<FindingPublic | null>(null)
  const [editing, setEditing] = useState<FindingPublic | null>(null)
  const [deleting, setDeleting] = useState<FindingPublic | null>(null)

  const readOnly = !canWrite || closed

  const deleteMutation = useMutation({
    mutationFn: (finding: FindingPublic) =>
      FindingsService.deleteFinding({ path: { finding_id: finding.id } }),
    onSuccess: () => {
      showSuccessToast("Finding deleted")
      setDeleting(null)
      queryClient.invalidateQueries({
        queryKey: inspectionKeys.findings(inspectionId),
      })
    },
    onError: (error: Error) => {
      setDeleting(null)
      showErrorToast(extractErrorMessage(error))
    },
  })

  const logButton = readOnly ? null : (
    <div className="flex gap-2">
      <DrawingPickerMenu projectId={projectId} inspectionId={inspectionId} />
      <Button onClick={() => onLoggingChange(true)} data-testid="log-finding">
        <Plus />
        Log finding
      </Button>
    </div>
  )

  const photosByFinding = useMemo(() => {
    const map = new Map<number, PhotoPublic[]>()
    for (const photo of photos.data ?? []) {
      if (photo.finding_id === null || photo.finding_id === undefined) continue
      const list = map.get(photo.finding_id) ?? []
      list.push(photo)
      map.set(photo.finding_id, list)
    }
    return map
  }, [photos.data])

  return (
    <section aria-labelledby="findings-heading" className="flex flex-col gap-3">
      <QueryState
        query={query}
        errorTitle="Couldn't load the findings"
        empty={
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 id="findings-heading" className="text-lg font-semibold">
                Findings <span className="text-muted-foreground">(0)</span>
              </h2>
              {logButton}
            </div>
            <EmptyState
              icon={<ClipboardCheck />}
              title="No findings logged"
              description={
                closed
                  ? "This inspection was signed off with nothing to report."
                  : "All clear — or log your first observation."
              }
              className="py-8"
            />
          </>
        }
      >
        {(findings) => (
          <FindingList
            findings={findings}
            filter={filter}
            onFilterChange={setFilter}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            readOnly={readOnly}
            logButton={logButton}
            photosByFinding={photosByFinding}
            onResolve={setResolving}
            onEdit={setEditing}
            onDelete={setDeleting}
          />
        )}
      </QueryState>

      <FindingFormDialog
        open={logging}
        onOpenChange={onLoggingChange}
        inspectionId={inspectionId}
      />
      <FindingFormDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        inspectionId={inspectionId}
        finding={editing ?? undefined}
      />
      <ResolveFindingDialog
        finding={resolving}
        onOpenChange={(open) => {
          if (!open) setResolving(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleting(null)
        }}
        title="Delete this finding?"
        description={
          <>
            <strong>{deleting?.title}</strong> will be removed from this
            inspection. Pins on drawings that point to it are kept but unlinked.
            This cannot be undone.
          </>
        }
        confirmLabel="Delete finding"
        variant="destructive"
        pending={deleteMutation.isPending}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
      />
    </section>
  )
}

interface FindingListProps {
  findings: FindingPublic[]
  filter: string
  onFilterChange: (value: string) => void
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  readOnly: boolean
  logButton: React.ReactNode
  photosByFinding: Map<number, PhotoPublic[]>
  onResolve: (finding: FindingPublic) => void
  onEdit: (finding: FindingPublic) => void
  onDelete: (finding: FindingPublic) => void
}

function FindingList({
  findings,
  filter,
  onFilterChange,
  statusFilter,
  onStatusFilterChange,
  readOnly,
  logButton,
  photosByFinding,
  onResolve,
  onEdit,
  onDelete,
}: FindingListProps) {
  const visible = useMemo(
    () =>
      findings.filter(
        (finding) =>
          (!statusFilter || (finding.status || "open") === statusFilter) &&
          matchesFilter(
            filter,
            finding.title,
            finding.description,
            finding.location_ref,
          ),
      ),
    [findings, filter, statusFilter],
  )

  const openCount = findings.filter(
    (finding) => (finding.status || "open") !== "resolved",
  ).length

  const clearFilters = () => {
    onFilterChange("")
    onStatusFilterChange("")
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="findings-heading" className="text-lg font-semibold">
          Findings{" "}
          <span className="text-muted-foreground" data-testid="findings-count">
            (
            {visible.length === findings.length
              ? findings.length
              : `${visible.length} of ${findings.length}`}
            )
          </span>
          {openCount > 0 && openCount < findings.length ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {openCount} open
            </span>
          ) : null}
        </h2>
        {logButton}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <FilterInput
          value={filter}
          onChange={onFilterChange}
          placeholder="Search findings…"
          label="Search findings"
          className="flex-1"
        />
        <NativeSelect
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value)}
          aria-label="Filter by status"
          data-testid="findings-status-filter"
          className="sm:w-44"
        >
          <option value="">All statuses</option>
          {FINDING_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No findings match"
          description="Nothing matches the search or status filter."
          action={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
          className="py-8"
        />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="finding-list">
          {visible.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              photos={photosByFinding.get(finding.id)}
              readOnly={readOnly}
              onResolve={onResolve}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}
    </>
  )
}
