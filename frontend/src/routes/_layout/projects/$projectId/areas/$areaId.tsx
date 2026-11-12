import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ClipboardCheck, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import type { AreaPublic } from "@/client"
import { PageHeader } from "@/components/Common/PageHeader"
import {
  DetailState,
  EmptyState,
  NotFoundState,
  QueryState,
} from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { ApplyTemplateDialog } from "@/components/Itps/ApplyTemplateDialog"
import { ItpProgress } from "@/components/Itps/ItpBadges"
import { ItpCard } from "@/components/Itps/ItpCard"
import { SignoffPanel } from "@/components/Itps/SignoffPanel"
import { Button } from "@/components/ui/button"
import { useProjectRole } from "@/hooks/useProjectRole"
import { joinMeta } from "@/lib/format"
import { AREA_TYPE_OPTIONS } from "@/lib/itp"
import {
  areaQuery,
  areasQuery,
  parseId,
  projectItpsQuery,
  projectQuery,
} from "@/lib/queries"

export const Route = createFileRoute(
  "/_layout/projects/$projectId/areas/$areaId",
)({
  component: AreaScreen,
  head: () => ({ meta: [{ title: "Area - VR Inspector" }] }),
})

function AreaScreen() {
  const { projectId: rawProject, areaId: rawArea } = Route.useParams()
  const projectId = parseId(rawProject)
  const areaId = parseId(rawArea)
  if (projectId === undefined) {
    return (
      <NotFoundState
        noun="project"
        backTo="/projects"
        backLabel="Back to projects"
      />
    )
  }
  if (areaId === undefined) return <AreaNotFound projectId={projectId} />
  return <AreaDetail projectId={projectId} areaId={areaId} />
}

function AreaNotFound({ projectId }: { projectId: number }) {
  return (
    <NotFoundState
      noun="area"
      backTo="/projects/$projectId"
      backParams={{ projectId: String(projectId) }}
      backLabel="Back to project"
    />
  )
}

function AreaDetail({
  projectId,
  areaId,
}: {
  projectId: number
  areaId: number
}) {
  const query = useQuery(areaQuery(areaId))
  return (
    <DetailState
      query={query}
      noun="area"
      backTo="/projects/$projectId"
      backParams={{ projectId: String(projectId) }}
      backLabel="Back to project"
      errorTitle="Couldn't load this area"
    >
      {(area) =>
        area.project_id !== projectId ? (
          <AreaNotFound projectId={projectId} />
        ) : (
          <AreaBody projectId={projectId} area={area} />
        )
      }
    </DetailState>
  )
}

/**
 * An area (level, lot, stage, chainage): its ITPs with completion and
 * hold-point status, any areas inside it, and "Apply template" pre-set to
 * this area, and (increment 14) the area's combined sign-off pack with one
 * signing link per signer for the whole area.
 */
function AreaBody({
  projectId,
  area,
}: {
  projectId: number
  area: AreaPublic
}) {
  const navigate = Route.useNavigate()
  const project = useQuery(projectQuery(projectId))
  const areas = useQuery(areasQuery(projectId))
  const itps = useQuery(projectItpsQuery(projectId))
  const { canWrite } = useProjectRole(projectId)
  const [applying, setApplying] = useState(false)
  const preset = useMemo(() => [area.id], [area.id])

  const parent = areas.data?.find((a) => a.id === area.parent_area_id)
  const children = (areas.data ?? []).filter(
    (a) => a.parent_area_id === area.id,
  )
  const typeLabel =
    AREA_TYPE_OPTIONS.find((o) => o.value === area.area_type)?.label ??
    area.area_type

  const itpQueryForArea = {
    ...itps,
    data: itps.data?.filter((itp) => itp.area_id === area.id),
  }

  const applyButton = canWrite ? (
    <Button onClick={() => setApplying(true)} data-testid="apply-template">
      <Plus />
      Apply template
    </Button>
  ) : null

  return (
    <>
      <PageHeader
        eyebrow={project.data?.name ?? "Area"}
        title={area.name}
        description={joinMeta(typeLabel, parent ? `in ${parent.name}` : null)}
        backTo="/projects/$projectId"
        backParams={{ projectId: String(projectId) }}
        backLabel="Back to project"
        actions={applyButton}
      />
      <div
        className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center"
        data-testid="area-summary"
      >
        <StatusBadge
          value="itps"
          tone={
            area.itp_count && area.complete_count === area.itp_count
              ? "positive"
              : "neutral"
          }
          label={`${area.complete_count} of ${area.itp_count} ITPs complete`}
        />
        <ItpProgress
          className="flex-1"
          done={area.done_count ?? 0}
          total={area.item_count ?? 0}
          openHolds={area.open_hold_count ?? 0}
        />
      </div>

      {children.length ? (
        <p className="text-sm text-muted-foreground">
          Inside this {typeLabel.toLowerCase()}:{" "}
          {children.map((c, i) => (
            <span key={c.id}>
              {i ? ", " : ""}
              <button
                type="button"
                className="text-vri-copper underline-offset-2 hover:underline"
                onClick={() =>
                  navigate({
                    to: "/projects/$projectId/areas/$areaId",
                    params: {
                      projectId: String(projectId),
                      areaId: String(c.id),
                    },
                  })
                }
              >
                {c.name}
              </button>
            </span>
          ))}
        </p>
      ) : null}

      <section
        aria-labelledby="area-itps-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="area-itps-heading" className="text-lg font-semibold">
          ITPs{" "}
          <span className="text-muted-foreground">
            ({itpQueryForArea.data?.length ?? 0})
          </span>
        </h2>
        <QueryState
          query={itpQueryForArea}
          errorTitle="Couldn't load the ITPs"
          empty={
            <EmptyState
              icon={<ClipboardCheck />}
              title="No ITPs in this area yet"
              description="Apply a template here, or to many areas at once from the project screen."
              action={applyButton}
              className="py-8"
            />
          }
        >
          {(list) => (
            <ul
              className="grid gap-3 md:grid-cols-2"
              data-testid="area-itp-list"
            >
              {list.map((itp) => (
                <ItpCard
                  key={itp.id}
                  projectId={projectId}
                  itp={itp}
                  showArea={false}
                />
              ))}
            </ul>
          )}
        </QueryState>
      </section>

      <SignoffPanel
        kind="area"
        id={area.id}
        projectId={projectId}
        canWrite={canWrite}
        disabled={
          itpQueryForArea.data && itpQueryForArea.data.length === 0
            ? "Apply an ITP to this area first."
            : undefined
        }
      />

      <ApplyTemplateDialog
        open={applying}
        onOpenChange={setApplying}
        projectId={projectId}
        presetAreaIds={preset}
        onCreatedOne={(itp) =>
          navigate({
            to: "/projects/$projectId/itps/$itpId",
            params: { projectId: String(projectId), itpId: String(itp.id) },
          })
        }
      />
    </>
  )
}
