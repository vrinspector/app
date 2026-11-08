import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AxiosError } from "axios"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { routeTree } from "@/routeTree.gen"

/*
 * The projects → inspections screens (increment 07), rendered through the
 * real route tree with the Auth0 SDK and the generated API client replaced.
 * Request bodies are asserted against what the legacy SPA sent
 * (docs/API_PORT.md): these screens must keep talking to the same API.
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
  listProjects: vi.fn(),
  createProject: vi.fn(),
  readProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  listMembers: vi.fn(),
  listInspections: vi.fn(),
  createInspection: vi.fn(),
  readInspection: vi.fn(),
  updateInspection: vi.fn(),
  deleteInspection: vi.fn(),
  signoffInspection: vi.fn(),
  reopenInspection: vi.fn(),
  listFindings: vi.fn(),
  listPhotos: vi.fn(),
}))

vi.mock("@/client", () => ({
  UsersService: { readUserMe: api.readUserMe },
  ProjectsService: {
    listProjects: api.listProjects,
    createProject: api.createProject,
    readProject: api.readProject,
    updateProject: api.updateProject,
    deleteProject: api.deleteProject,
    listMembers: api.listMembers,
  },
  InspectionsService: {
    listInspections: api.listInspections,
    createInspection: api.createInspection,
    readInspection: api.readInspection,
    updateInspection: api.updateInspection,
    deleteInspection: api.deleteInspection,
    signoffInspection: api.signoffInspection,
    reopenInspection: api.reopenInspection,
  },
  // The inspection screen's findings + photos sections (increment 08) are
  // exercised in findings.test.tsx; here they just need to load empty.
  FindingsService: { listFindings: api.listFindings },
  PhotosService: { listPhotos: api.listPhotos },
}))

const ok = <T,>(data: T) => ({ data })

function notFound(detail: string) {
  return new AxiosError(
    "Request failed with status code 404",
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    {
      status: 404,
      statusText: "Not Found",
      data: { detail },
      headers: {},
      config: {} as never,
    },
  )
}

const projects = [
  {
    id: 7,
    public_id: "prj_7",
    name: "Landfill Gas Project",
    client: "Redtail Renewables",
    location: "Richmond VA",
    status: "active",
    created_by: "stacey@example.com",
    created_at: "2026-07-01T12:00:00Z",
    updated_at: "2026-07-01T12:00:00Z",
  },
  {
    id: 3,
    public_id: "prj_3",
    name: "Substation Upgrade",
    client: null,
    location: null,
    status: "complete",
    created_by: null,
    created_at: "2026-05-01T12:00:00Z",
    updated_at: "2026-05-01T12:00:00Z",
  },
]

const inspections = [
  {
    id: 21,
    public_id: "insp_21",
    project_id: 7,
    title: "Site Walk #1 - Civil",
    inspection_type: "civil",
    type: "civil",
    inspector: "Stacey Roberts",
    notes: "Initial observations",
    status: "open",
    inspection_status: "open",
    signed_off_by: null,
    signed_off_at: null,
    created_at: "2026-07-02T09:00:00Z",
    updated_at: "2026-07-02T09:00:00Z",
  },
  {
    id: 22,
    public_id: "insp_22",
    project_id: 7,
    title: "Piping punch list",
    inspection_type: "piping",
    type: "piping",
    inspector: null,
    notes: null,
    status: "closed",
    inspection_status: "closed",
    signed_off_by: "stacey@example.com",
    signed_off_at: "2026-07-03T15:30:00Z",
    created_at: "2026-07-03T09:00:00Z",
    updated_at: "2026-07-03T15:30:00Z",
  },
]

const members = (role: string) => [
  {
    id: 1,
    public_id: "mem_1",
    project_id: 7,
    email: "stacey@example.com",
    user_email: "stacey@example.com",
    user_sub: "auth0|stacey",
    role,
    invited_by: null,
    created_at: "2026-07-01T12:00:00Z",
  },
]

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
  api.listProjects.mockResolvedValue(ok(projects))
  api.readProject.mockImplementation(async ({ path }) => {
    const project = projects.find((p) => p.id === path.project_id)
    if (!project) throw notFound("Project not found")
    return ok(project)
  })
  api.listMembers.mockResolvedValue(ok(members("owner")))
  api.listInspections.mockResolvedValue(ok(inspections))
  api.listFindings.mockResolvedValue(ok([]))
  api.listPhotos.mockResolvedValue(ok([]))
  api.readInspection.mockImplementation(async ({ path }) => {
    const inspection = inspections.find((i) => i.id === path.inspection_id)
    if (!inspection) throw notFound("Inspection not found")
    return ok(inspection)
  })
})

describe("projects list", () => {
  it("lists the caller's projects as cards with client, location and status", async () => {
    renderApp("/projects")

    const cards = await screen.findAllByTestId("project-card")
    expect(cards).toHaveLength(2)
    expect(screen.getByTestId("projects-count")).toHaveTextContent("(2)")

    const first = within(cards[0])
    expect(first.getByRole("heading", { name: "Landfill Gas Project" }))
    expect(cards[0]).toHaveTextContent("Redtail Renewables — Richmond VA")
    expect(first.getByText("Active")).toHaveAttribute("data-tone", "positive")
    expect(cards[0]).toHaveAttribute("href", "/projects/7")

    expect(cards[1]).toHaveTextContent("No client — No location")
    expect(within(cards[1]).getByText("Complete")).toHaveAttribute(
      "data-tone",
      "settled",
    )
  })

  it("filters the cards by name, client or location without another request", async () => {
    renderApp("/projects")
    await screen.findAllByTestId("project-card")

    await userEvent.type(screen.getByTestId("filter-input"), "redtail")
    expect(screen.getAllByTestId("project-card")).toHaveLength(1)
    expect(screen.getByTestId("projects-count")).toHaveTextContent("(1 of 2)")

    await userEvent.clear(screen.getByTestId("filter-input"))
    await userEvent.type(screen.getByTestId("filter-input"), "nothing here")
    expect(screen.queryAllByTestId("project-card")).toHaveLength(0)
    const empty = screen.getByTestId("empty-state")
    expect(empty).toHaveTextContent(/no projects match/i)

    await userEvent.click(
      within(empty).getByRole("button", { name: "Clear filter" }),
    )
    expect(screen.getAllByTestId("project-card")).toHaveLength(2)
    expect(api.listProjects).toHaveBeenCalledTimes(1)
  })

  it("shows the empty state with a call to action when there are no projects", async () => {
    api.listProjects.mockResolvedValue(ok([]))
    renderApp("/projects")

    const empty = await screen.findByTestId("empty-state")
    expect(empty).toHaveTextContent("No projects yet")
    expect(within(empty).getByTestId("new-project")).toBeInTheDocument()
  })

  it("shows a retryable error when the list cannot be loaded", async () => {
    api.listProjects.mockRejectedValueOnce(new Error("Network Error"))
    renderApp("/projects")

    const error = await screen.findByTestId("error-state")
    expect(error).toHaveTextContent(/couldn't load your projects/i)
    await userEvent.click(within(error).getByTestId("retry-button"))
    expect(await screen.findAllByTestId("project-card")).toHaveLength(2)
  })

  it("creates a project with the legacy request body and opens it", async () => {
    api.createProject.mockResolvedValue(
      ok({ ...projects[0], id: 99, name: "New Yard" }),
    )
    const router = renderApp("/projects")
    await screen.findAllByTestId("project-card")

    await userEvent.click(screen.getByTestId("new-project"))
    const dialog = await screen.findByTestId("project-form-dialog")

    // Required-field validation happens before any request.
    await userEvent.click(within(dialog).getByTestId("project-form-submit"))
    expect(await within(dialog).findByText("Project name is required"))
    expect(api.createProject).not.toHaveBeenCalled()

    await userEvent.type(
      within(dialog).getByLabelText("Project name"),
      "New Yard",
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Status"),
      "on_hold",
    )
    await userEvent.click(within(dialog).getByTestId("project-form-submit"))

    await waitFor(() =>
      expect(api.createProject).toHaveBeenCalledWith({
        body: {
          name: "New Yard",
          client: null,
          location: null,
          status: "on_hold",
        },
      }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/99"),
    )
  })
})

describe("project screen", () => {
  it("shows the project, its details and its inspections", async () => {
    renderApp("/projects/7")

    expect(
      await screen.findByRole("heading", { name: "Landfill Gas Project" }),
    ).toBeVisible()
    expect(screen.getByTestId("header-section")).toHaveTextContent("Projects")
    expect(screen.getByTestId("back-link")).toHaveAttribute("href", "/projects")
    expect(screen.getByTestId("project-details")).toHaveTextContent(
      "Redtail Renewables",
    )

    const cards = await screen.findAllByTestId("inspection-card")
    expect(cards).toHaveLength(2)
    expect(screen.getByTestId("inspections-count")).toHaveTextContent("(2)")
    expect(cards[0]).toHaveAttribute("href", "/projects/7/inspections/21")
    expect(cards[0]).toHaveTextContent("Stacey Roberts —")
    expect(within(cards[0]).getByText("Open")).toHaveAttribute(
      "data-tone",
      "attention",
    )
    expect(within(cards[0]).getByText("Civil")).toBeInTheDocument()
    expect(cards[1]).toHaveTextContent("Unassigned")
    expect(within(cards[1]).getByText("Closed")).toHaveAttribute(
      "data-tone",
      "settled",
    )
    expect(within(cards[1]).getByText("Piping / P&ID")).toBeInTheDocument()
    expect(api.listInspections).toHaveBeenCalledWith({
      query: { project_id: 7 },
    })
  })

  it("filters inspections by title, type or inspector", async () => {
    renderApp("/projects/7")
    await screen.findAllByTestId("inspection-card")

    await userEvent.type(screen.getByTestId("filter-input"), "piping")
    expect(screen.getAllByTestId("inspection-card")).toHaveLength(1)
    expect(screen.getByTestId("inspections-count")).toHaveTextContent(
      "(1 of 2)",
    )
  })

  it("creates an inspection in the project with the legacy body, inspector pre-filled", async () => {
    api.createInspection.mockResolvedValue(
      ok({ ...inspections[0], id: 31, title: "Site Walk #2" }),
    )
    const router = renderApp("/projects/7")
    await screen.findAllByTestId("inspection-card")

    await userEvent.click(screen.getByTestId("new-inspection"))
    const dialog = await screen.findByTestId("inspection-form-dialog")
    expect(within(dialog).getByLabelText("Inspector name")).toHaveValue(
      "Stacey Roberts",
    )

    await userEvent.type(within(dialog).getByLabelText("Title"), "Site Walk #2")
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Type"),
      "electrical",
    )
    await userEvent.type(within(dialog).getByLabelText("Notes"), "  Windy  ")
    await userEvent.click(within(dialog).getByTestId("inspection-form-submit"))

    await waitFor(() =>
      expect(api.createInspection).toHaveBeenCalledWith({
        body: {
          project_id: 7,
          status: "open",
          title: "Site Walk #2",
          inspection_type: "electrical",
          inspector: "Stacey Roberts",
          notes: "Windy",
        },
      }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/7/inspections/31"),
    )
  })

  it("shows the empty state when the project has no inspections", async () => {
    api.listInspections.mockResolvedValue(ok([]))
    renderApp("/projects/7")

    const empty = await screen.findByTestId("empty-state")
    expect(empty).toHaveTextContent("No inspections yet")
    expect(within(empty).getByTestId("new-inspection")).toBeInTheDocument()
  })

  it("hides write and manage actions from a viewer", async () => {
    api.listMembers.mockResolvedValue(ok(members("viewer")))
    renderApp("/projects/7")
    await screen.findAllByTestId("inspection-card")

    await waitFor(() =>
      expect(screen.queryByTestId("new-inspection")).not.toBeInTheDocument(),
    )
    expect(screen.queryByTestId("project-actions")).not.toBeInTheDocument()
  })

  it("lets an owner delete the project and returns to the list", async () => {
    api.deleteProject.mockResolvedValue(ok(undefined))
    const router = renderApp("/projects/7")
    await screen.findAllByTestId("inspection-card")

    await userEvent.click(await screen.findByTestId("project-actions"))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /delete project/i }),
    )
    const confirm = await screen.findByTestId("confirm-dialog")
    expect(confirm).toHaveTextContent("Landfill Gas Project")
    await userEvent.click(within(confirm).getByTestId("confirm-button"))

    await waitFor(() =>
      expect(api.deleteProject).toHaveBeenCalledWith({
        path: { project_id: 7 },
      }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects"),
    )
  })

  it("renders not-found inside the shell for a project the caller cannot see", async () => {
    renderApp("/projects/404")

    const state = await screen.findByTestId("not-found-state")
    expect(state).toHaveTextContent("Project not found")
    expect(
      within(state).getByRole("link", { name: "Back to projects" }),
    ).toHaveAttribute("href", "/projects")
    expect(screen.getByTestId("main-nav")).toBeInTheDocument()
  })

  it("treats a malformed id as not found without calling the API", async () => {
    renderApp("/projects/not-a-number")

    expect(await screen.findByTestId("not-found-state")).toBeInTheDocument()
    expect(api.readProject).not.toHaveBeenCalled()
  })
})

describe("inspection screen", () => {
  it("shows the inspection with its project as the eyebrow and the details", async () => {
    renderApp("/projects/7/inspections/21")

    expect(
      await screen.findByRole("heading", { name: "Site Walk #1 - Civil" }),
    ).toBeVisible()
    expect(await screen.findByText("Landfill Gas Project")).toBeInTheDocument()
    expect(screen.getByTestId("back-link")).toHaveAttribute(
      "href",
      "/projects/7",
    )
    expect(screen.getByTestId("inspection-status")).toHaveTextContent("Open")
    expect(screen.getByTestId("inspection-details")).toHaveTextContent(
      "Initial observations",
    )
    expect(screen.queryByTestId("signoff-bar")).not.toBeInTheDocument()
    expect(screen.getByTestId("signoff-inspection")).toBeInTheDocument()
  })

  it("signs off after confirmation and shows the sign-off bar", async () => {
    const closed = {
      ...inspections[0],
      status: "closed",
      inspection_status: "closed",
      signed_off_by: "stacey@example.com",
      signed_off_at: "2026-07-04T10:00:00Z",
    }
    api.signoffInspection.mockResolvedValue(ok(closed))
    renderApp("/projects/7/inspections/21")
    await screen.findByTestId("signoff-inspection")

    await userEvent.click(screen.getByTestId("signoff-inspection"))
    const confirm = await screen.findByTestId("confirm-dialog")
    await userEvent.click(within(confirm).getByTestId("confirm-button"))

    await waitFor(() =>
      expect(api.signoffInspection).toHaveBeenCalledWith({
        path: { inspection_id: 21 },
      }),
    )
    const bar = await screen.findByTestId("signoff-bar")
    expect(bar).toHaveTextContent("Signed off by stacey@example.com")
    expect(screen.getByTestId("inspection-status")).toHaveTextContent("Closed")
    expect(screen.getByTestId("reopen-inspection")).toBeInTheDocument()
    expect(screen.queryByTestId("signoff-inspection")).not.toBeInTheDocument()
  })

  it("reopens a signed-off inspection", async () => {
    api.reopenInspection.mockResolvedValue(
      ok({
        ...inspections[1],
        status: "open",
        inspection_status: "open",
        signed_off_by: null,
        signed_off_at: null,
      }),
    )
    renderApp("/projects/7/inspections/22")

    expect(await screen.findByTestId("signoff-bar")).toHaveTextContent(
      "stacey@example.com",
    )
    await userEvent.click(screen.getByTestId("reopen-inspection"))

    await waitFor(() =>
      expect(api.reopenInspection).toHaveBeenCalledWith({
        path: { inspection_id: 22 },
      }),
    )
    await waitFor(() =>
      expect(screen.queryByTestId("signoff-bar")).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId("signoff-inspection")).toBeInTheDocument()
  })

  it("edits the inspection through the actions menu with the legacy body", async () => {
    api.updateInspection.mockImplementation(async ({ body }) =>
      ok({ ...inspections[0], ...body }),
    )
    renderApp("/projects/7/inspections/21")
    await screen.findByTestId("inspection-actions")

    await userEvent.click(screen.getByTestId("inspection-actions"))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /edit inspection/i }),
    )
    const dialog = await screen.findByTestId("inspection-form-dialog")
    const title = within(dialog).getByLabelText("Title")
    expect(title).toHaveValue("Site Walk #1 - Civil")
    await userEvent.clear(title)
    await userEvent.type(title, "Site Walk #1 - Civil (rev)")
    await userEvent.click(within(dialog).getByTestId("inspection-form-submit"))

    await waitFor(() =>
      expect(api.updateInspection).toHaveBeenCalledWith({
        path: { inspection_id: 21 },
        body: {
          title: "Site Walk #1 - Civil (rev)",
          inspection_type: "civil",
          inspector: "Stacey Roberts",
          notes: "Initial observations",
        },
      }),
    )
    expect(
      await screen.findByRole("heading", {
        name: "Site Walk #1 - Civil (rev)",
      }),
    ).toBeVisible()
  })

  it("renders not-found when the inspection belongs to another project", async () => {
    renderApp("/projects/3/inspections/21")

    expect(await screen.findByTestId("not-found-state")).toHaveTextContent(
      "Inspection not found",
    )
  })

  it("renders not-found for an inspection the API hides", async () => {
    renderApp("/projects/7/inspections/999")

    expect(await screen.findByTestId("not-found-state")).toHaveTextContent(
      "Inspection not found",
    )
  })
})
