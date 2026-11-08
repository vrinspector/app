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
 * The signed-in shell, exercised end to end through the real route tree with
 * the Auth0 SDK and the API client replaced. Playwright covers the signed-out
 * journey against a real build; this is where the layout, navigation and
 * session wiring are checked without a tenant.
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

const readUserMe = vi.hoisted(() => vi.fn())
const listProjects = vi.hoisted(() => vi.fn(async () => ({ data: [] })))
const readDashboard = vi.hoisted(() =>
  vi.fn(async () => ({
    data: {
      summary: {
        total_projects: 0,
        total_inspections: 0,
        open_findings: 0,
        high_priority_findings: 0,
        total_photos: 0,
      },
      projects: [],
      recent_inspections: [],
    },
  })),
)
vi.mock("@/client", () => ({
  UsersService: { readUserMe },
  ProjectsService: { listProjects },
  // The dashboard itself (increment 10) is covered in dashboard.test.tsx.
  DashboardService: { readDashboard },
}))

function renderApp(path: string, isAuthenticated = true) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth: { isAuthenticated } },
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
  auth0.isAuthenticated = true
  readUserMe.mockResolvedValue({
    data: {
      sub: "auth0|stacey",
      name: "Stacey Roberts",
      email: "stacey@example.com",
      permissions: [],
    },
  })
})

describe("application shell", () => {
  it("shows the brand sidebar, the section header and the signed-in person", async () => {
    renderApp("/")

    expect(await screen.findByTestId("app-header")).toBeInTheDocument()
    expect(screen.getByTestId("header-section")).toHaveTextContent("Dashboard")

    const nav = within(screen.getByTestId("main-nav"))
    expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(nav.getByRole("link", { name: "Projects" })).not.toHaveAttribute(
      "aria-current",
    )
    expect(nav.getByRole("link", { name: "Help" })).toBeInTheDocument()

    expect(await screen.findByTestId("greeting")).toHaveTextContent(
      "Hi, Stacey Roberts",
    )
    expect(screen.getByTestId("user-menu")).toHaveTextContent(
      "stacey@example.com",
    )
  })

  it("reads /users/me once for the session and renders the home screen", async () => {
    renderApp("/")

    expect(await screen.findByTestId("summary-tiles")).toBeInTheDocument()
    await waitFor(() => expect(readUserMe).toHaveBeenCalledTimes(1))
  })

  it("keeps the shell usable when the dashboard roll-up fails", async () => {
    readDashboard.mockRejectedValueOnce(new Error("Network Error"))
    renderApp("/")

    const error = await screen.findByTestId("error-state")
    expect(error).toHaveTextContent(/couldn't load the dashboard/i)

    await userEvent.click(within(error).getByTestId("retry-button"))
    expect(await screen.findByTestId("summary-tiles")).toBeInTheDocument()
    // The navigation stayed usable throughout.
    expect(screen.getByTestId("main-nav")).toBeInTheDocument()
  })

  it("navigates between sections and keeps the header in step", async () => {
    renderApp("/")
    await screen.findByTestId("app-header")

    await userEvent.click(
      within(screen.getByTestId("main-nav")).getByRole("link", {
        name: "Projects",
      }),
    )
    expect(
      await screen.findByRole("heading", { name: "Projects" }),
    ).toBeVisible()
    expect(screen.getByTestId("header-section")).toHaveTextContent("Projects")
    // No projects in the mock → the list's empty state.
    expect(await screen.findByTestId("empty-state")).toHaveTextContent(
      "No projects yet",
    )
    expect(
      within(screen.getByTestId("main-nav")).getByRole("link", {
        name: "Projects",
      }),
    ).toHaveAttribute("aria-current", "page")
  })

  it("offers Help from the header except on the Help screen itself", async () => {
    const router = renderApp("/projects")
    await screen.findByTestId("app-header")
    expect(screen.getByTestId("header-help")).toBeInTheDocument()

    await router.navigate({ to: "/help" })
    expect(await screen.findByRole("heading", { name: "Help" })).toBeVisible()
    expect(screen.queryByTestId("header-help")).not.toBeInTheDocument()
    expect(screen.getByTestId("help-guide")).toBeInTheDocument()
  })

  it("sends a signed-out visitor to the gate and remembers the destination", async () => {
    auth0.isAuthenticated = false
    const router = renderApp("/projects", false)

    expect(await screen.findByTestId("login-gate")).toBeInTheDocument()
    expect(router.state.location.pathname).toBe("/login")
    expect(router.state.location.search).toEqual({ returnTo: "/projects" })
    expect(screen.queryByTestId("app-sidebar")).not.toBeInTheDocument()
  })

  it("explains an expired session on the gate", async () => {
    auth0.isAuthenticated = false
    renderApp("/login?returnTo=%2Fprojects&reason=expired", false)

    expect(await screen.findByTestId("session-expired")).toHaveTextContent(
      /your session ended/i,
    )
  })
})
