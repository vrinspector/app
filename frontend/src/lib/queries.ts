import { queryOptions } from "@tanstack/react-query"

import {
  type DashboardPublic,
  DashboardService,
  type DrawingPublic,
  DrawingsService,
  type FindingPublic,
  FindingsService,
  type InspectionPublic,
  InspectionsService,
  type MemberPublic,
  type PhotoPublic,
  PhotosService,
  type PinPublic,
  type ProjectPublic,
  ProjectsService,
  type ReportPublic,
  ReportsService,
  type WeatherReading,
  WeatherService,
} from "@/client"

/*
 * Query keys and options for the project → inspection hierarchy, in one
 * place so screens, dialogs and mutations invalidate the same keys.
 *
 *   ["dashboard"]                      the Block 6 roll-up (increment 10)
 *   ["projects"]                       the caller's project list
 *   ["projects", id]                   one project
 *   ["projects", id, "members"]        its members (role lookup + the members panel)
 *   ["projects", id, "inspections"]    its inspections
 *   ["projects", id, "drawings"]       its drawings (increment 09)
 *   ["inspections", id]                one inspection
 *   ["inspections", id, "findings"]    its findings (increment 08)
 *   ["inspections", id, "photos"]      its photos, each with a presigned view_url
 *   ["inspections", id, "reports"]     its report versions (increment 10)
 *   ["drawings", id]                   one drawing
 *   ["drawings", id, "view-url"]       its presigned view URL (1 hour)
 *   ["drawings", id, "pins"]           its pins, every page
 *
 * Invalidating ["projects", id] therefore also refreshes that project's
 * members, inspections and drawings — what the legacy SPA did by reloading
 * the screen. Likewise ["inspections", id] covers the inspection, its
 * findings and its photos (the legacy `loadFindingsScreen` re-fetched all
 * three), and ["drawings", id] the drawing with its pins. The dashboard is
 * re-read on every visit (as the legacy `loadDashboard` did) rather than
 * invalidated by each mutation that moves a count.
 */

export const dashboardKeys = {
  all: ["dashboard"] as const,
}

export const projectKeys = {
  all: ["projects"] as const,
  detail: (projectId: number) => ["projects", projectId] as const,
  members: (projectId: number) => ["projects", projectId, "members"] as const,
  inspections: (projectId: number) =>
    ["projects", projectId, "inspections"] as const,
  drawings: (projectId: number) => ["projects", projectId, "drawings"] as const,
}

export const drawingKeys = {
  detail: (drawingId: number) => ["drawings", drawingId] as const,
  viewUrl: (drawingId: number) => ["drawings", drawingId, "view-url"] as const,
  pins: (drawingId: number) => ["drawings", drawingId, "pins"] as const,
}

export const inspectionKeys = {
  detail: (inspectionId: number) => ["inspections", inspectionId] as const,
  findings: (inspectionId: number) =>
    ["inspections", inspectionId, "findings"] as const,
  photos: (inspectionId: number) =>
    ["inspections", inspectionId, "photos"] as const,
  reports: (inspectionId: number) =>
    ["inspections", inspectionId, "reports"] as const,
  weather: (inspectionId: number) =>
    ["inspections", inspectionId, "weather"] as const,
}

export const dashboardQuery = () =>
  queryOptions<DashboardPublic>({
    queryKey: dashboardKeys.all,
    queryFn: async () =>
      (await DashboardService.readDashboard()).data as DashboardPublic,
    staleTime: 0,
  })

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

/**
 * Report versions, newest first, each with a presigned `download_url` (one
 * hour). Re-read on every mount like the photos so a link is never stale.
 */
export const reportsQuery = (inspectionId: number) =>
  queryOptions<ReportPublic[]>({
    queryKey: inspectionKeys.reports(inspectionId),
    queryFn: async () =>
      (
        await ReportsService.listReports({
          query: { inspection_id: inspectionId },
        })
      ).data ?? [],
    staleTime: 0,
  })

/**
 * The Block 5 weather badge (legacy `GET /weather?location&inspection_id`).
 * The API resolves the project's location itself when none is passed; the
 * reading is cached server-side for ten minutes, so the same staleTime here
 * keeps a crew's repeated opens to one request. Never retried and never a
 * toast: the legacy SPA treated weather as non-blocking.
 */
export const weatherQuery = (inspectionId: number) =>
  queryOptions<WeatherReading>({
    queryKey: inspectionKeys.weather(inspectionId),
    queryFn: async () =>
      (
        await WeatherService.readWeather({
          query: { inspection_id: inspectionId },
        })
      ).data as WeatherReading,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })

export const drawingsQuery = (projectId: number) =>
  queryOptions<DrawingPublic[]>({
    queryKey: projectKeys.drawings(projectId),
    queryFn: async () =>
      (
        await DrawingsService.listDrawings({
          query: { project_id: projectId },
        })
      ).data ?? [],
  })

export const drawingQuery = (drawingId: number) =>
  queryOptions<DrawingPublic>({
    queryKey: drawingKeys.detail(drawingId),
    queryFn: async () =>
      (await DrawingsService.readDrawing({ path: { drawing_id: drawingId } }))
        .data as DrawingPublic,
  })

/**
 * The presigned GET for the file itself (`GET /drawings/{id}/view-url`,
 * one hour). Re-read on every viewer visit, as the legacy `openDrawingViewer`
 * did, so a link is never used past its expiry; cached for the visit so a
 * zoom or page change does not mint another.
 */
export const drawingViewUrlQuery = (drawingId: number) =>
  queryOptions<string>({
    queryKey: drawingKeys.viewUrl(drawingId),
    queryFn: async () =>
      (
        (
          await DrawingsService.readDrawingViewUrl({
            path: { drawing_id: drawingId },
          })
        ).data as { view_url: string }
      ).view_url,
    staleTime: 0,
    gcTime: 0,
  })

export const pinsQuery = (drawingId: number) =>
  queryOptions<PinPublic[]>({
    queryKey: drawingKeys.pins(drawingId),
    queryFn: async () =>
      (await DrawingsService.listPins({ path: { drawing_id: drawingId } }))
        .data ?? [],
  })

/** Route params arrive as strings; anything that is not a positive integer is a 404. */
export function parseId(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}
