import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { routeTree } from "@/routeTree.gen"

/*
 * The dashboard (increment 10): the Block 6 roll-up rendered as the legacy
 * `renderDashboard` did — five tiles, the Project Health table, Recent
 * Activity — plus the in-app Help guide. Rendered through the real route
 * tree with the Auth0 SDK and the generated client replaced.
 */

const auth0 = vi.hoisted(() => ({
  isAuthenticated: true,
  isLoading: false,
  error: undefined as Error | undefined,
  user: {
    sub: "auth0|stacey",
    name: "Stacey Roberts",
    email: "stacey@example.com",
  },
  loginWithRedirect: vi.fn(),
  logout: vi.fn(),
  getAccessTokenSilently: vi.fn(async () => "token"),
}))

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => auth0,
  Auth0Provider: ({ children }: { children: React.ReactNode }) => children,
}))

const api = vi.hoisted(() => ({
  readUserMe: vi.fn(),
  readDashboard: vi.fn(),
  listProjects: vi.fn(),
  readProject: vi.fn(),
  listMembers: vi.fn(),
  listInspections: vi.fn(),
  listDrawings: vi.fn(),
  readInspection: vi.fn(),
  listFindings: vi.fn(),
  listPhotos: vi.fn(),
  listReports: vi.fn(),
}))

vi.mock("@/client", () => ({
  UsersService: { readUserMe: api.readUserMe },
  DashboardService: { readDashboard: api.readDashboard },
  ProjectsService: {
    listProjects: api.listProjects,
    readProject: api.readProject,
    listMembers: api.listMembers,
  },
  InspectionsService: {
    listInspections: api.listInspections,
    readInspection: api.readInspection,
  },
  DrawingsService: { listDrawings: api.listDrawings },
  FindingsService: { listFindings: api.listFindings },
  PhotosService: { listPhotos: api.listPhotos },
  ReportsService: { listReports: api.listReports },
  // Weather (increment 10.5) is a silent badge; no reading here.
  WeatherService: { readWeather: async () => ({ data: undefined }) },
}))

const ok = <T,>(data: T) => ({ data })

const dashboard = {
  summary: {
    total_projects: 2,
    total_inspections: 5,
    open_findings: 3,
    high_priority_findings: 0,
    total_photos: 14,
  },
  projects: [
    {
      id: 7,
      name: "Landfill Gas Project",
      client: "Redtail Renewables",
      status: "active",
      inspection_count: 4,
      open_finding_count: 3,
      high_finding_count: 0,
      photo_count: 12,
      last_inspected: "2026-07-03",
    },
    {
      id: 3,
      name: "Substation Upgrade",
      client: null,
      status: "complete",
      inspection_count: 1,
      open_finding_count: 0,
      high_finding_count: 0,
      photo_count: 2,
      last_inspected: "Never",
    },
  ],
  recent_inspections: [
    {
      id: 22,
      project_id: 7,
      project_name: "Landfill Gas Project",
      title: "Piping punch list",
      inspector: null,
      created_at: "2026-07-03T09:00:00Z",
      finding_count: 3,
    },
    {
      id: 21,
      project_id: 7,
      project_name: "Landfill Gas Project",
      title: "Site Walk #1 - Civil",
      inspector: "Stacey Roberts",
      created_at: "2026-07-02T09:00:00Z",
      finding_count: 1,
    },
  ],
}

const project = {
  id: 7,
  public_id: "prj_7",
  name: "Landfill Gas Project",
  client: "Redtail Renewables",
  location: "Richmond VA",
  status: "active",
  created_by: "stacey@example.com",
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
}

function renderApp(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth: { isAuthenticated: true } },
    defaultPendingMs: 0,
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  api.readUserMe.mockResolvedValue(
    ok({
      sub: "auth0|stacey",
      name: "Stacey Roberts",
      email: "stacey@example.com",
      permissions: [],
    }),
  )
  api.readDashboard.mockResolvedValue(ok(dashboard))
  api.listProjects.mockResolvedValue(ok([project]))
  api.readProject.mockResolvedValue(ok(project))
  api.listMembers.mockResolvedValue(ok([]))
  api.listInspections.mockResolvedValue(ok([]))
  api.listDrawings.mockResolvedValue(ok([]))
  api.listFindings.mockResolvedValue(ok([]))
  api.listPhotos.mockResolvedValue(ok([]))
  api.listReports.mockResolvedValue(ok([]))
})

describe("dashboard", () => {
  it("shows the five summary tiles with the legacy attention colouring", async () => {
    renderApp("/")

    const tiles = within(await screen.findByTestId("summary-tiles"))
    expect(tiles.getByTestId("tile-projects")).toHaveTextContent("2")
    expect(tiles.getByTestId("tile-inspections")).toHaveTextContent("5")
    expect(tiles.getByTestId("tile-open")).toHaveTextContent("3")
    expect(tiles.getByTestId("tile-high")).toHaveTextContent("0")
    expect(tiles.getByTestId("tile-photos")).toHaveTextContent("14")
    // Open findings > 0 → brick; high priority = 0 → forest green.
    expect(tiles.getByTestId("tile-open")).toHaveAttribute("data-alert", "true")
    expect(tiles.getByTestId("tile-high")).not.toHaveAttribute("data-alert")
    expect(api.readDashboard).toHaveBeenCalledTimes(1)
  })

  it("renders the project health table with counts, last inspection and Inspect links", async () => {
    renderApp("/")

    const table = within(await screen.findByTestId("project-health"))
    const rows = table.getAllByTestId("health-row")
    expect(rows).toHaveLength(2)

    const first = within(rows[0])
    expect(rows[0]).toHaveTextContent("Landfill Gas Project")
    expect(rows[0]).toHaveTextContent("Redtail Renewables")
    const cells = rows[0].querySelectorAll("td")
    expect(cells[1]).toHaveTextContent("4") // inspections
    expect(cells[2]).toHaveTextContent("3") // open, emphasised
    expect(cells[2]).toHaveAttribute("data-nonzero", "true")
    expect(cells[3]).toHaveTextContent("0") // high, muted
    expect(cells[3]).not.toHaveAttribute("data-nonzero")
    expect(cells[4]).toHaveTextContent("12") // photos
    expect(cells[5]).toHaveTextContent("2026-07-03")
    expect(
      first.getByRole("link", { name: "Inspect Landfill Gas Project" }),
    ).toHaveAttribute("href", "/projects/7")

    expect(rows[1]).toHaveTextContent("Never")
  })

  it("lists recent activity as cards that open the inspection", async () => {
    renderApp("/")

    const cards = await screen.findAllByTestId("recent-inspection")
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveAttribute("href", "/projects/7/inspections/22")
    expect(cards[0]).toHaveTextContent("Piping punch list")
    expect(cards[0]).toHaveTextContent("Landfill Gas Project")
    expect(cards[0]).toHaveTextContent("3 findings")
    expect(cards[1]).toHaveTextContent("Stacey Roberts")
    expect(cards[1]).toHaveTextContent("1 finding")
  })

  it("navigates from Inspect into the project screen", async () => {
    const router = renderApp("/")
    await screen.findByTestId("project-health")

    await userEvent.click(
      screen.getByRole("link", { name: "Inspect Landfill Gas Project" }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/7"),
    )
    expect(
      await screen.findByRole("heading", { name: "Landfill Gas Project" }),
    ).toBeVisible()
  })

  it("shows empty states for a member of no projects", async () => {
    api.readDashboard.mockResolvedValueOnce(
      ok({
        summary: {
          total_projects: 0,
          total_inspections: 0,
          open_findings: 0,
          high_priority_findings: 0,
          total_photos: 0,
        },
        projects: [],
        recent_inspections: [],
      }),
    )
    renderApp("/")

    await screen.findByTestId("summary-tiles")
    const empties = screen.getAllByTestId("empty-state")
    expect(empties).toHaveLength(2)
    expect(empties[0]).toHaveTextContent("No projects yet")
    expect(empties[1]).toHaveTextContent("No inspections yet")
    expect(screen.queryByTestId("project-health")).not.toBeInTheDocument()
  })

  it("shows a retryable error when the roll-up fails", async () => {
    api.readDashboard.mockRejectedValueOnce(new Error("Network Error"))
    renderApp("/")

    const error = await screen.findByTestId("error-state")
    expect(error).toHaveTextContent(/couldn't load the dashboard/i)
    await userEvent.click(within(error).getByTestId("retry-button"))
    expect(await screen.findByTestId("summary-tiles")).toBeInTheDocument()
    expect(api.readDashboard).toHaveBeenCalledTimes(2)
  })

  it("re-reads the roll-up on every visit, as the legacy screen did", async () => {
    const router = renderApp("/")
    await screen.findByTestId("summary-tiles")
    expect(api.readDashboard).toHaveBeenCalledTimes(1)

    await router.navigate({ to: "/help" })
    await screen.findByTestId("help-guide")
    await router.navigate({ to: "/" })
    await screen.findByTestId("summary-tiles")
    await waitFor(() => expect(api.readDashboard).toHaveBeenCalledTimes(2))
  })
})

describe("help guide", () => {
  it("renders the seven sections with the topic navigation and the pin legend", async () => {
    renderApp("/help")

    const guide = within(await screen.findByTestId("help-guide"))
    const nav = guide.getByRole("navigation", { name: "Help topics" })
    const topics = within(nav).getAllByRole("link")
    expect(topics.map((a) => a.textContent)).toEqual([
      "Getting started",
      "Device split",
      "Core workflows",
      "Field-to-office handoff",
      "Without signal",
      "Access",
      "Troubleshooting",
    ])
    expect(topics[0]).toHaveAttribute("href", "#help-getting-started")

    for (const id of [
      "getting-started",
      "device-split",
      "workflows",
      "handoff",
      "offline",
      "access",
      "troubleshooting",
    ]) {
      expect(guide.getByTestId(`help-${id}`)).toBeInTheDocument()
    }
    expect(
      within(guide.getByTestId("getting-started-steps")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(4)

    // The five pin statuses in the legacy picker order, with their colours.
    const legend = within(guide.getByTestId("pin-legend")).getAllByRole(
      "listitem",
    )
    expect(legend.map((li) => li.textContent)).toEqual([
      "Not started",
      "In progress",
      "Verified",
      "Punch item",
      "Not installed",
    ])
    expect(legend[2].querySelector("span")).toHaveStyle({
      backgroundColor: "#28a745",
    })
  })

  it("describes the rebuilt screens rather than the legacy ones", async () => {
    renderApp("/help")
    const guide = await screen.findByTestId("help-guide")

    // Button names as the rebuilt app spells them …
    expect(guide).toHaveTextContent("Take photo")
    expect(guide).toHaveTextContent("Log finding")
    expect(guide).toHaveTextContent("Upload drawing")
    expect(guide).toHaveTextContent("Generate report")
    // … the viewer behaviour from decisions 20–21 …
    expect(guide).toHaveTextContent("25 % to 300 %")
    expect(guide).toHaveTextContent(/raster images open as one page/i)
    expect(guide).toHaveTextContent(/they still zoom, pan and take pins/i)
    // … and no leftover legacy wording.
    expect(guide).not.toHaveTextContent("Capture Photo")
    expect(guide).not.toHaveTextContent("+ Log Finding")
    expect(guide).not.toHaveTextContent("Block 8E")

    expect(screen.getByTestId("public-help-link")).toHaveAttribute(
      "href",
      "https://vrinspector.com/help/",
    )
  })

  it("offers the footer shortcuts back to the dashboard and projects", async () => {
    const router = renderApp("/help")
    await screen.findByTestId("help-guide")

    await userEvent.click(
      screen.getByRole("link", { name: "Back to dashboard" }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe("/"))
    expect(await screen.findByTestId("summary-tiles")).toBeInTheDocument()
  })
})
