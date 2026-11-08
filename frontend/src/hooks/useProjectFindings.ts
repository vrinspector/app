import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import type { FindingPublic, InspectionPublic } from "@/client"
import { findingsQuery, inspectionsQuery } from "@/lib/queries"

/*
 * Every finding in a project, grouped by inspection — what the pin detail
 * dialog offers when linking a pin to a finding. Findings hang off
 * inspections in the API (`GET /findings?inspection_id=`), so this reads the
 * project's inspections and then each one's findings; the lists are the
 * same queries the inspection screen uses, so they are usually cached.
 */

export interface InspectionFindings {
  inspection: InspectionPublic
  findings: FindingPublic[]
}

export function useProjectFindings(projectId: number, enabled = true) {
  const inspections = useQuery({
    ...inspectionsQuery(projectId),
    enabled,
  })
  const list = inspections.data ?? []
  const findingQueries = useQueries({
    queries: list.map((inspection) => ({
      ...findingsQuery(inspection.id),
      enabled,
    })),
  })

  const groups = useMemo<InspectionFindings[]>(
    () =>
      list
        .map((inspection, index) => ({
          inspection,
          findings: findingQueries[index]?.data ?? [],
        }))
        .filter((group) => group.findings.length > 0),
    [list, findingQueries],
  )

  const byId = useMemo(() => {
    const map = new Map<
      number,
      { finding: FindingPublic; inspection: InspectionPublic }
    >()
    for (const group of groups) {
      for (const finding of group.findings) {
        map.set(finding.id, { finding, inspection: group.inspection })
      }
    }
    return map
  }, [groups])

  return {
    groups,
    byId,
    isPending:
      inspections.isPending || findingQueries.some((query) => query.isPending),
  }
}
