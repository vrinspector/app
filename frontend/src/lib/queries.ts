import { queryOptions } from "@tanstack/react-query"

import {
  type FindingPublic,
  FindingsService,
  type InspectionPublic,
  InspectionsService,
  type MemberPublic,
  type PhotoPublic,
  PhotosService,
  type ProjectPublic,
  ProjectsService,
} from "@/client"

/*
 * Query keys and options for the project → inspection hierarchy, in one
 * place so screens, dialogs and mutations invalidate the same keys.
 *
 *   ["projects"]                       the caller's project list
 *   ["projects", id]                   one project
 *   ["projects", id, "members"]        its members (role lookup, increment 10 panel)
 *   ["projects", id, "inspections"]    its inspections
 *   ["inspections", id]                one inspection
 *   ["inspections", id, "findings"]    its findings (increment 08)
 *   ["inspections", id, "photos"]      its photos, each with a presigned view_url
 *
 * Invalidating ["projects", id] therefore also refreshes that project's
 * members and inspections — what the legacy SPA did by reloading the screen.
 * Likewise ["inspections", id] covers the inspection, its findings and its
 * photos (the legacy `loadFindingsScreen` re-fetched all three).
 */

export const projectKeys = {
  all: ["projects"] as const,
  detail: (projectId: number) => ["projects", projectId] as const,
  members: (projectId: number) => ["projects", projectId, "members"] as const,
  inspections: (projectId: number) =>
    ["projects", projectId, "inspections"] as const,
}

export const inspectionKeys = {
  detail: (inspectionId: number) => ["inspections", inspectionId] as const,
  findings: (inspectionId: number) =>
    ["inspections", inspectionId, "findings"] as const,
  photos: (inspectionId: number) =>
    ["inspections", inspectionId, "photos"] as const,
}

export const projectsQuery = () =>
  queryOptions<ProjectPublic[]>({
    queryKey: projectKeys.all,
    queryFn: async () => (await ProjectsService.listProjects()).data ?? [],
  })

export const projectQuery = (projectId: number) =>
  queryOptions<ProjectPublic>({
    queryKey: projectKeys.detail(projectId),
    queryFn: async () =>
      (await ProjectsService.readProject({ path: { project_id: projectId } }))
        .data as ProjectPublic,
  })

export const membersQuery = (projectId: number) =>
  queryOptions<MemberPublic[]>({
    queryKey: projectKeys.members(projectId),
    queryFn: async () =>
      (await ProjectsService.listMembers({ path: { project_id: projectId } }))
        .data ?? [],
  })

export const inspectionsQuery = (projectId: number) =>
  queryOptions<InspectionPublic[]>({
    queryKey: projectKeys.inspections(projectId),
    queryFn: async () =>
      (
        await InspectionsService.listInspections({
          query: { project_id: projectId },
        })
      ).data ?? [],
  })

export const inspectionQuery = (inspectionId: number) =>
  queryOptions<InspectionPublic>({
    queryKey: inspectionKeys.detail(inspectionId),
    queryFn: async () =>
      (
        await InspectionsService.readInspection({
          path: { inspection_id: inspectionId },
        })
      ).data as InspectionPublic,
  })

export const findingsQuery = (inspectionId: number) =>
  queryOptions<FindingPublic[]>({
    queryKey: inspectionKeys.findings(inspectionId),
    queryFn: async () =>
      (
        await FindingsService.listFindings({
          query: { inspection_id: inspectionId },
        })
      ).data ?? [],
  })

/**
 * Photos carry a presigned `view_url` minted per response; the API's URLs
 * outlive a screen visit comfortably, but the list is still re-read on every
 * mount so a thumbnail never points at an expired link.
 */
export const photosQuery = (inspectionId: number) =>
  queryOptions<PhotoPublic[]>({
    queryKey: inspectionKeys.photos(inspectionId),
    queryFn: async () =>
      (
        await PhotosService.listPhotos({
          query: { inspection_id: inspectionId },
        })
      ).data ?? [],
    staleTime: 0,
  })

/** Route params arrive as strings; anything that is not a positive integer is a 404. */
export function parseId(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}
