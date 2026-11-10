import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { ClipboardCheck, Plus, UserCheck } from "lucide-react"
import { useMemo, useState } from "react"

import { EmptyState, QueryState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { areasQuery, projectItpsQuery } from "@/lib/queries"

import { ApplyTemplateDialog } from "./ApplyTemplateDialog"
import { ItpCard } from "./ItpCard"
import { SignoffRolesDialog } from "./SignoffRolesDialog"

/*
 * The project's ITPs (Block 9.5): each card shows its area, status, how
 * many lines are recorded and whether a hold point is waiting. "Apply
 * template" makes a frozen copy for the whole project or one per selected
 * area; "Sign-off roles" says who releases the hold points.
 */

const ALL = "all"
const WHOLE = "whole"

interface ItpsSectionProps {
  projectId: number
  canWrite: boolean
  canManage: boolean
}

export function ItpsSection({
  projectId,
  canWrite,
  canManage,
}: ItpsSectionProps) {
  const navigate = useNavigate()
  const query = useQuery(projectItpsQuery(projectId))
  const areas = useQuery(areasQuery(projectId))
  const [applying, setApplying] = useState(false)
  const [roles, setRoles] = useState(false)
  const [areaFilter, setAreaFilter] = useState(ALL)

  const visible = useMemo(
    () =>
      (query.data ?? []).filter((itp) =>
        areaFilter === ALL
          ? true
          : areaFilter === WHOLE
            ? itp.area_id === null
            : String(itp.area_id) === areaFilter,
      ),
    [query.data, areaFilter],
  )

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        onClick={() => setRoles(true)}
        data-testid="signoff-roles"
      >
        <UserCheck />
        Sign-off roles
      </Button>
      {canWrite ? (
        <Button onClick={() => setApplying(true)} data-testid="apply-template">
          <Plus />
          Apply template
        </Button>
      ) : null}
    </div>
  )

  return (
    <section aria-labelledby="itps-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="itps-heading" className="text-lg font-semibold">
          ITPs{" "}
          <span className="text-muted-foreground" data-testid="itps-count">
            (
            {visible.length === (query.data?.length ?? 0)
              ? visible.length
              : `${visible.length} of ${query.data?.length ?? 0}`}
            )
          </span>
        </h2>
        {query.data?.length ? actions : null}
      </div>
      {query.data?.length && areas.data?.length ? (
        <NativeSelect
          aria-label="Show ITPs for"
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="sm:w-72"
          data-testid="itp-area-filter"
        >
          <option value={ALL}>All areas</option>
          <option value={WHOLE}>Whole project only</option>
          {areas.data.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
      ) : null}
      <QueryState
        query={query}
        errorTitle="Couldn't load the ITPs"
        empty={
          <EmptyState
            icon={<ClipboardCheck />}
            title="No ITPs yet"
            description="Apply a master inspection and test plan to the project, or to each of its areas in one go."
            action={actions}
            className="py-8"
          />
        }
      >
        {() => (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="itp-list">
            {visible.map((itp) => (
              <ItpCard key={itp.id} projectId={projectId} itp={itp} />
            ))}
          </ul>
        )}
      </QueryState>
      <ApplyTemplateDialog
        open={applying}
        onOpenChange={setApplying}
        projectId={projectId}
        onCreatedOne={(itp) =>
          navigate({
            to: "/projects/$projectId/itps/$itpId",
            params: { projectId: String(projectId), itpId: String(itp.id) },
          })
        }
      />
      <SignoffRolesDialog
        open={roles}
        onOpenChange={setRoles}
        projectId={projectId}
        canManage={canManage}
      />
    </section>
  )
}
