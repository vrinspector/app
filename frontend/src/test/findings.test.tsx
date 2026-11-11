import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AxiosError } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/sonner"
import { routeTree } from "@/routeTree.gen"

/*
 * The findings + photo capture half of the inspection screen (increment
 * 08), rendered through the real route tree with the Auth0 SDK and the
 * generated API client replaced. Request bodies are asserted against what
 * the legacy SPA sent (docs/API_PORT.md); the S3 PUT is observed through a
 * stubbed XMLHttpRequest because files must never pass through the API.
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
  readProject: vi.fn(),
  listMembers: vi.fn(),
  readInspection: vi.fn(),
  listFindings: vi.fn(),
  createFinding: vi.fn(),
  updateFinding: vi.fn(),
  deleteFinding: vi.fn(),
  setFindingStatus: vi.fn(),
  resolveFinding: vi.fn(),
  listPhotos: vi.fn(),
  presignPhotoUpload: vi.fn(),
  registerPhoto: vi.fn(),
  deletePhoto: vi.fn(),
  readWeather: vi.fn(),
  listDrawings: vi.fn(),
  readDrawing: vi.fn(),
}))

vi.mock("@/client", () => ({
  UsersService: { readUserMe: api.readUserMe },
  ProjectsService: {
    readProject: api.readProject,
    listMembers: api.listMembers,
  },
  InspectionsService: { readInspection: api.readInspection },
  FindingsService: {
    listFindings: api.listFindings,
    createFinding: api.createFinding,
    updateFinding: api.updateFinding,
    deleteFinding: api.deleteFinding,
    setFindingStatus: api.setFindingStatus,
    resolveFinding: api.resolveFinding,
  },
  // The reports section (increment 10) just needs to load empty here.
  ReportsService: { listReports: async () => ({ data: [] }) },
  PhotosService: {
    listPhotos: api.listPhotos,
    presignPhotoUpload: api.presignPhotoUpload,
    registerPhoto: api.registerPhoto,
    deletePhoto: api.deletePhoto,
  },
  WeatherService: { readWeather: api.readWeather },
  // "Pin on drawing" (increment 11a) lists the project's drawings; the
  // viewer itself is covered in drawings.test.tsx / capture-loop.test.tsx.
  DrawingsService: {
    listDrawings: api.listDrawings,
    readDrawing: api.readDrawing,
    readDrawingViewUrl: async () => ({
      data: { view_url: "https://files.example.com/32?sig=1" },
    }),
    listPins: async () => ({ data: [] }),
  },
}))

const ok = <T,>(data: T) => ({ data })

function apiError(status: number, detail: string) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    {
      status,
      statusText: "Error",
      data: { detail },
      headers: {},
      config: {} as never,
    },
  )
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

const openInspection = {
  id: 21,
  public_id: "insp_21",
  project_id: 7,
  title: "Site Walk #1 - Civil",
  inspection_type: "civil",
  type: "civil",
  inspector: "Stacey Roberts",
  notes: null,
  status: "open",
  inspection_status: "open",
  signed_off_by: null,
  signed_off_at: null,
  created_at: "2026-07-02T09:00:00Z",
  updated_at: "2026-07-02T09:00:00Z",
}

const closedInspection = {
  ...openInspection,
  id: 22,
  public_id: "insp_22",
  title: "Piping punch list",
  status: "closed",
  inspection_status: "closed",
  signed_off_by: "stacey@example.com",
  signed_off_at: "2026-07-03T15:30:00Z",
}

const findings = [
  {
    id: 101,
    public_id: "finding_101",
    inspection_id: 21,
    title: "Cracked footing NE corner",
    description:
      "Hairline crack running diagonally across the footing, roughly 400 mm long, no displacement visible yet.",
    priority: "high",
    location_ref: "Grid A-4",
    status: "open",
    resolved_by: null,
    resolved_at: null,
    resolution_notes: null,
    created_at: "2026-07-02T10:00:00Z",
    updated_at: "2026-07-02T10:00:00Z",
  },
  {
    id: 102,
    public_id: "finding_102",
    inspection_id: 21,
    title: "Rebar cover short",
    description: "Cover 30 mm where 50 mm specified.",
    priority: "medium",
    location_ref: null,
    status: "in-progress",
    resolved_by: null,
    resolved_at: null,
    resolution_notes: null,
    created_at: "2026-07-02T09:30:00Z",
    updated_at: "2026-07-02T11:00:00Z",
  },
  {
    id: 103,
    public_id: "finding_103",
    inspection_id: 21,
    title: "Missing silt fence",
    description: null,
    priority: "low",
    location_ref: "South boundary",
    status: "resolved",
    resolved_by: "stacey@example.com",
    resolved_at: "2026-07-02T12:00:00Z",
    resolution_notes: "Fence installed same day.",
    created_at: "2026-07-02T09:15:00Z",
    updated_at: "2026-07-02T12:00:00Z",
  },
]

const photos = [
  {
    id: 501,
    public_id: "pho_501",
    inspection_id: 21,
    s3_key: "photos/inspections/21/aaa.jpg",
    filename: "footing.jpg",
    content_type: "image/jpeg",
    uploaded_by: "stacey@example.com",
    created_at: "2026-07-02T10:05:00Z",
    view_url: "https://files.example.com/aaa.jpg?sig=1",
  },
  {
    id: 502,
    public_id: "pho_502",
    inspection_id: 21,
    s3_key: "photos/inspections/21/bbb.jpg",
    filename: "rebar.jpg",
    content_type: "image/jpeg",
    uploaded_by: "stacey@example.com",
    created_at: "2026-07-02T09:35:00Z",
    view_url: "https://files.example.com/bbb.jpg?sig=1",
  },
]

const drawing32 = {
  id: 32,
  public_id: "drw_32",
  project_id: 7,
  title: "Flare skid layout",
  drawing_number: "M-201",
  discipline: "equipment_layout",
  filename: "flare.png",
  s3_key: "drawings/projects/7/bbb.png",
  file_type: "png",
  file_size: 1,
  view_url: null,
  thumbnail_url: null,
  page_width_pts: null,
  page_height_pts: null,
  uploaded_by: null,
  created_at: "2026-07-03T09:00:00Z",
  updated_at: "2026-07-03T09:00:00Z",
}

const weather = {
  description: "Partly cloudy",
  temp_f: 61.3,
  humidity: 72,
  wind_mph: 6.8,
  weather_code: 2,
  location: "Richmond, Virginia, US",
  observed_at: "2026-11-08T09:15",
}

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
      {/* main.tsx mounts the toaster outside the router; error toasts are asserted here. */}
      <Toaster />
    </QueryClientProvider>,
  )
  return router
}

const INSPECTION_URL = "/projects/7/inspections/21"

beforeEach(() => {
  api.readUserMe.mockResolvedValue(
    ok({
      sub: "auth0|stacey",
      name: "Stacey Roberts",
      email: "stacey@example.com",
      permissions: [],
    }),
  )
  api.readProject.mockResolvedValue(ok(project))
  api.listMembers.mockResolvedValue(ok(members("owner")))
  api.readInspection.mockImplementation(async ({ path }) =>
    ok(path.inspection_id === 22 ? closedInspection : openInspection),
  )
  api.listFindings.mockResolvedValue(ok(findings))
  api.listPhotos.mockResolvedValue(ok(photos))
  api.readWeather.mockResolvedValue(ok(weather))
  api.listDrawings.mockResolvedValue(ok([drawing32]))
  api.readDrawing.mockResolvedValue(ok(drawing32))
  // jsdom has no object URLs; the upload tiles only need a string.
  URL.createObjectURL = vi.fn(() => "blob:preview")
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("findings list", () => {
  it("lists findings with excerpt, priority, status, location and resolution", async () => {
    renderApp(INSPECTION_URL)

    const cards = await screen.findAllByTestId("finding-card")
    expect(cards).toHaveLength(3)
    expect(screen.getByTestId("findings-count")).toHaveTextContent("(3)")
    expect(api.listFindings).toHaveBeenCalledWith({
      query: { inspection_id: 21 },
    })

    const first = within(cards[0])
    expect(first.getByRole("heading", { name: "Cracked footing NE corner" }))
    // 80-character excerpt with an ellipsis; the full text appears on expand.
    expect(cards[0]).toHaveTextContent(/roughly 400 mm long, no di…/)
    expect(cards[0]).not.toHaveTextContent("displacement visible yet")
    expect(first.getByTestId("finding-priority")).toHaveTextContent("High")
    expect(first.getByTestId("finding-priority")).toHaveAttribute(
      "data-tone",
      "critical",
    )
    expect(first.getByTestId("finding-status")).toHaveTextContent("Open")
    expect(cards[0]).toHaveTextContent("Grid A-4")

    expect(cards[1]).toHaveAttribute("data-status", "in-progress")
    expect(within(cards[1]).getByTestId("finding-status")).toHaveTextContent(
      "In progress",
    )

    expect(cards[2]).toHaveAttribute("data-status", "resolved")
    expect(
      within(cards[2]).getByTestId("finding-resolution"),
    ).toHaveTextContent(/Resolved by stacey@example.com/)
    expect(cards[2]).toHaveTextContent("Fence installed same day.")
  })

  it("expands a card to the full description and dates", async () => {
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    await userEvent.click(within(cards[0]).getByTestId("finding-toggle"))
    const details = within(cards[0]).getByTestId("finding-details")
    expect(details).toHaveTextContent("no displacement visible yet.")
    expect(details).toHaveTextContent(/Logged/)
    expect(within(cards[0]).getByTestId("finding-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  it("filters by text and by status without another request", async () => {
    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("finding-card")

    await userEvent.type(screen.getByLabelText("Search findings"), "rebar")
    expect(screen.getAllByTestId("finding-card")).toHaveLength(1)
    expect(screen.getByTestId("findings-count")).toHaveTextContent("(1 of 3)")
    await userEvent.clear(screen.getByLabelText("Search findings"))

    await userEvent.selectOptions(
      screen.getByTestId("findings-status-filter"),
      "resolved",
    )
    expect(screen.getAllByTestId("finding-card")).toHaveLength(1)
    expect(screen.getByTestId("findings-count")).toHaveTextContent("(1 of 3)")

    await userEvent.type(screen.getByLabelText("Search findings"), "footing")
    expect(screen.queryAllByTestId("finding-card")).toHaveLength(0)
    const empty = screen.getByText("No findings match").closest("div")
    await userEvent.click(
      within(empty as HTMLElement).getByRole("button", {
        name: "Clear filters",
      }),
    )
    expect(screen.getAllByTestId("finding-card")).toHaveLength(3)
    expect(api.listFindings).toHaveBeenCalledTimes(1)
  })

  it("shows the empty state with the log button when there are no findings", async () => {
    api.listFindings.mockResolvedValue(ok([]))
    renderApp(INSPECTION_URL)

    expect(await screen.findByText("No findings logged")).toBeVisible()
    expect(screen.getByTestId("log-finding")).toBeInTheDocument()
  })

  it("shows a retryable error when the findings cannot be loaded", async () => {
    api.listFindings.mockRejectedValueOnce(new Error("Network Error"))
    renderApp(INSPECTION_URL)

    const errors = await screen.findAllByTestId("error-state")
    const error = errors.find((element) =>
      /couldn't load the findings/i.test(element.textContent ?? ""),
    )
    expect(error).toBeDefined()
    await userEvent.click(
      within(error as HTMLElement).getByTestId("retry-button"),
    )
    expect(await screen.findAllByTestId("finding-card")).toHaveLength(3)
  })
})

describe("logging and editing findings", () => {
  it("logs a finding with the legacy request body", async () => {
    api.createFinding.mockResolvedValue(
      ok({ ...findings[0], id: 199, title: "Ponding at ramp" }),
    )
    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("finding-card")

    await userEvent.click(screen.getByTestId("log-finding"))
    const dialog = await screen.findByTestId("finding-form-dialog")

    // Required-field validation happens before any request.
    await userEvent.click(within(dialog).getByTestId("finding-form-submit"))
    expect(await within(dialog).findByText("Title is required"))
    expect(api.createFinding).not.toHaveBeenCalled()

    await userEvent.type(
      within(dialog).getByLabelText("Title"),
      "Ponding at ramp",
    )
    await userEvent.type(
      within(dialog).getByLabelText("Description"),
      "Water standing after rain",
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Priority"),
      "low",
    )
    await userEvent.click(within(dialog).getByTestId("finding-form-submit"))

    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          title: "Ponding at ramp",
          description: "Water standing after rain",
          priority: "low",
          location_ref: null,
          status: "open",
        },
      }),
    )
    await waitFor(() =>
      expect(screen.queryByTestId("finding-form-dialog")).toBeNull(),
    )
    expect(api.listFindings).toHaveBeenCalledTimes(2)
  })

  it("hides the dictate button when the browser has no speech recognition", async () => {
    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("finding-card")
    await userEvent.click(screen.getByTestId("log-finding"))
    await screen.findByTestId("finding-form-dialog")
    expect(screen.queryByTestId("dictate-button")).toBeNull()
  })

  it("appends dictated speech to the description", async () => {
    class FakeRecognition {
      lang = ""
      interimResults = false
      maxAlternatives = 1
      continuous = false
      onstart: (() => void) | null = null
      onresult: ((event: unknown) => void) | null = null
      onerror: ((event: { error: string }) => void) | null = null
      onend: (() => void) | null = null
      static instance: FakeRecognition | null = null
      constructor() {
        FakeRecognition.instance = this
      }
      start() {
        this.onstart?.()
      }
      stop() {
        this.onend?.()
      }
      abort() {
        this.onend?.()
      }
    }
    ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      FakeRecognition

    try {
      renderApp(INSPECTION_URL)
      await screen.findAllByTestId("finding-card")
      await userEvent.click(screen.getByTestId("log-finding"))
      const dialog = await screen.findByTestId("finding-form-dialog")
      const description = within(dialog).getByLabelText("Description")
      await userEvent.type(description, "Crack at base.")

      await userEvent.click(within(dialog).getByTestId("dictate-button"))
      expect(within(dialog).getByTestId("dictate-button")).toHaveTextContent(
        "Stop",
      )
      FakeRecognition.instance?.onresult?.({
        resultIndex: 0,
        results: [[{ transcript: " about half a metre long " }]],
      })
      FakeRecognition.instance?.onend?.()

      await waitFor(() =>
        expect(description).toHaveValue(
          "Crack at base. about half a metre long",
        ),
      )
      expect(within(dialog).getByTestId("dictate-button")).toHaveTextContent(
        "Dictate",
      )
    } finally {
      delete (window as unknown as { SpeechRecognition?: unknown })
        .SpeechRecognition
    }
  })

  it("edits a finding from the card menu with only the editable fields", async () => {
    api.updateFinding.mockResolvedValue(
      ok({ ...findings[1], title: "Rebar cover short (verified)" }),
    )
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    await userEvent.click(within(cards[1]).getByTestId("finding-actions"))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /edit finding/i }),
    )
    const dialog = await screen.findByTestId("finding-form-dialog")
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Rebar cover short",
    )
    await userEvent.type(within(dialog).getByLabelText("Title"), " (verified)")
    await userEvent.type(
      within(dialog).getByLabelText("Location reference"),
      "Pier 3",
    )
    await userEvent.click(within(dialog).getByTestId("finding-form-submit"))

    await waitFor(() =>
      expect(api.updateFinding).toHaveBeenCalledWith({
        path: { finding_id: 102 },
        body: {
          title: "Rebar cover short (verified)",
          description: "Cover 30 mm where 50 mm specified.",
          priority: "medium",
          location_ref: "Pier 3",
        },
      }),
    )
  })

  it("deletes a finding after confirmation", async () => {
    api.deleteFinding.mockResolvedValue(ok(undefined))
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    await userEvent.click(within(cards[2]).getByTestId("finding-actions"))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /delete finding/i }),
    )
    const confirm = await screen.findByTestId("confirm-dialog")
    expect(confirm).toHaveTextContent("Missing silt fence")
    await userEvent.click(within(confirm).getByTestId("confirm-button"))

    await waitFor(() =>
      expect(api.deleteFinding).toHaveBeenCalledWith({
        path: { finding_id: 103 },
      }),
    )
  })
})

describe("finding status workflow (Block 8A)", () => {
  it("moves an open finding to in progress", async () => {
    api.setFindingStatus.mockResolvedValue(
      ok({ ...findings[0], status: "in-progress" }),
    )
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    const first = within(cards[0])
    expect(first.getByTestId("finding-in-progress")).toBeInTheDocument()
    expect(first.getByTestId("finding-resolve")).toBeInTheDocument()
    expect(first.queryByTestId("finding-reopen")).toBeNull()

    await userEvent.click(first.getByTestId("finding-in-progress"))
    await waitFor(() =>
      expect(api.setFindingStatus).toHaveBeenCalledWith({
        path: { finding_id: 101 },
        body: { status: "in-progress" },
      }),
    )
  })

  it("reopens an in-progress or resolved finding", async () => {
    api.setFindingStatus.mockResolvedValue(
      ok({ ...findings[2], status: "open" }),
    )
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    // in-progress: Reopen + Resolve; resolved: Reopen only.
    expect(within(cards[1]).getByTestId("finding-reopen")).toBeInTheDocument()
    expect(within(cards[1]).getByTestId("finding-resolve")).toBeInTheDocument()
    expect(within(cards[2]).getByTestId("finding-reopen")).toBeInTheDocument()
    expect(within(cards[2]).queryByTestId("finding-resolve")).toBeNull()

    await userEvent.click(within(cards[2]).getByTestId("finding-reopen"))
    await waitFor(() =>
      expect(api.setFindingStatus).toHaveBeenCalledWith({
        path: { finding_id: 103 },
        body: { status: "open" },
      }),
    )
  })

  it("resolves with optional notes through the resolve dialog", async () => {
    api.resolveFinding.mockResolvedValue(
      ok({ ...findings[1], status: "resolved" }),
    )
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    await userEvent.click(within(cards[1]).getByTestId("finding-resolve"))
    const dialog = await screen.findByTestId("resolve-dialog")
    expect(dialog).toHaveTextContent("Rebar cover short")
    await userEvent.type(
      within(dialog).getByLabelText("Resolution notes"),
      "Cover restored with repair mortar.",
    )
    await userEvent.click(within(dialog).getByTestId("resolve-submit"))

    await waitFor(() =>
      expect(api.resolveFinding).toHaveBeenCalledWith({
        path: { finding_id: 102 },
        body: { resolution_notes: "Cover restored with repair mortar." },
      }),
    )
  })

  it("sends null resolution notes when the field is left blank", async () => {
    api.resolveFinding.mockResolvedValue(
      ok({ ...findings[0], status: "resolved" }),
    )
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    await userEvent.click(within(cards[0]).getByTestId("finding-resolve"))
    const dialog = await screen.findByTestId("resolve-dialog")
    await userEvent.click(within(dialog).getByTestId("resolve-submit"))

    await waitFor(() =>
      expect(api.resolveFinding).toHaveBeenCalledWith({
        path: { finding_id: 101 },
        body: { resolution_notes: null },
      }),
    )
  })

  it("explains a 409 from the API when the inspection was signed off elsewhere", async () => {
    api.setFindingStatus.mockRejectedValue(
      apiError(409, "Inspection is signed off"),
    )
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    await userEvent.click(within(cards[0]).getByTestId("finding-in-progress"))
    expect(await screen.findByText("Inspection is signed off")).toBeVisible()
  })
})

describe("read-only states", () => {
  it("hides every write action while the inspection is signed off", async () => {
    api.listFindings.mockResolvedValue(
      ok(findings.map((finding) => ({ ...finding, inspection_id: 22 }))),
    )
    renderApp("/projects/7/inspections/22")
    const cards = await screen.findAllByTestId("finding-card")

    expect(screen.queryByTestId("log-finding")).toBeNull()
    expect(screen.queryByTestId("capture-bar-finding")).toBeNull()
    for (const card of cards) {
      expect(within(card).queryByTestId("finding-actions")).toBeNull()
      expect(within(card).queryByTestId("finding-in-progress")).toBeNull()
      expect(within(card).queryByTestId("finding-resolve")).toBeNull()
      expect(within(card).queryByTestId("finding-reopen")).toBeNull()
    }
    // Photos can still be added to a signed-off inspection (the API allows it).
    expect(screen.getByTestId("take-photo")).toBeInTheDocument()
    expect(screen.getByTestId("capture-bar-photo")).toBeInTheDocument()
  })

  it("hides write actions and the capture bar from a viewer", async () => {
    api.listMembers.mockResolvedValue(ok(members("viewer")))
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    await waitFor(() => expect(screen.queryByTestId("log-finding")).toBeNull())
    expect(screen.queryByTestId("take-photo")).toBeNull()
    expect(screen.queryByTestId("capture-bar")).toBeNull()
    expect(within(cards[0]).queryByTestId("finding-resolve")).toBeNull()

    // Viewers can still open a photo, but not delete it.
    await userEvent.click(screen.getAllByTestId("photo-thumb")[0])
    const viewer = await screen.findByTestId("photo-viewer")
    expect(within(viewer).queryByTestId("delete-photo")).toBeNull()
  })
})

describe("site photos", () => {
  it("shows the photo grid with thumbnails from the presigned view URLs", async () => {
    renderApp(INSPECTION_URL)

    const thumbs = await screen.findAllByTestId("photo-thumb")
    expect(thumbs).toHaveLength(2)
    expect(screen.getByTestId("photos-count")).toHaveTextContent("(2)")
    expect(api.listPhotos).toHaveBeenCalledWith({
      query: { inspection_id: 21 },
    })
    // Decorative <img alt=""> (the button carries the name), so query the tag.
    expect(thumbs[0].querySelector("img")).toHaveAttribute(
      "src",
      "https://files.example.com/aaa.jpg?sig=1",
    )
    expect(thumbs[0]).toHaveAccessibleName("Open footing.jpg")
  })

  it("opens a photo full size, steps through them and deletes one", async () => {
    api.deletePhoto.mockResolvedValue(ok(undefined))
    renderApp(INSPECTION_URL)
    const thumbs = await screen.findAllByTestId("photo-thumb")

    await userEvent.click(thumbs[0])
    const viewer = await screen.findByTestId("photo-viewer")
    expect(within(viewer).getByTestId("photo-viewer-image")).toHaveAttribute(
      "src",
      "https://files.example.com/aaa.jpg?sig=1",
    )
    expect(viewer).toHaveTextContent("footing.jpg")
    expect(viewer).toHaveTextContent("1 of 2")

    await userEvent.click(
      within(viewer).getByRole("button", { name: "Next photo" }),
    )
    expect(within(viewer).getByTestId("photo-viewer-image")).toHaveAttribute(
      "src",
      "https://files.example.com/bbb.jpg?sig=1",
    )
    expect(viewer).toHaveTextContent("2 of 2")

    await userEvent.click(within(viewer).getByTestId("delete-photo"))
    const confirm = await screen.findByTestId("confirm-dialog")
    await userEvent.click(within(confirm).getByTestId("confirm-button"))

    await waitFor(() =>
      expect(api.deletePhoto).toHaveBeenCalledWith({
        path: { photo_id: 502 },
      }),
    )
    await waitFor(() => expect(screen.queryByTestId("photo-viewer")).toBeNull())
  })

  it("shows the empty state and the capture buttons when there are no photos", async () => {
    api.listPhotos.mockResolvedValue(ok([]))
    renderApp(INSPECTION_URL)

    expect(await screen.findByText("No photos yet")).toBeVisible()
    expect(screen.getByTestId("take-photo")).toBeInTheDocument()
    expect(screen.getByTestId("choose-photos")).toBeInTheDocument()
    expect(screen.getByTestId("camera-input")).toHaveAttribute(
      "capture",
      "environment",
    )
    expect(screen.getByTestId("library-input")).toHaveAttribute("multiple")
    expect(screen.getByTestId("library-input")).not.toHaveAttribute("capture")
  })
})

/** A stand-in for the browser's XMLHttpRequest that records the S3 PUT. */
function stubXhr(status: number) {
  const sent: Array<{
    url: string
    headers: Record<string, string>
    body: unknown
  }> = []
  class FakeXhr {
    static sent = sent
    status = 0
    upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    private url = ""
    private headers: Record<string, string> = {}
    open(_method: string, url: string) {
      this.url = url
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value
    }
    send(body: unknown) {
      sent.push({ url: this.url, headers: this.headers, body })
      setTimeout(() => {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 1,
          total: 2,
        } as ProgressEvent)
        this.status = status
        this.onload?.()
      }, 0)
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr)
  return sent
}

describe("photo capture flow", () => {
  it("presigns, PUTs the file to storage and registers it with the legacy body", async () => {
    const sent = stubXhr(200)
    api.presignPhotoUpload.mockResolvedValue(
      ok({
        upload_url:
          "https://bucket.example.com/photos/inspections/21/new.jpg?X-Amz=1",
        s3_key: "photos/inspections/21/new.jpg",
      }),
    )
    const registered = {
      ...photos[0],
      id: 503,
      s3_key: "photos/inspections/21/new.jpg",
      filename: "IMG_0001.jpg",
      view_url: "https://files.example.com/new.jpg?sig=1",
    }
    api.registerPhoto.mockResolvedValue(ok(registered))

    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("photo-thumb")
    // After registration the list is re-read; the API now includes the photo.
    api.listPhotos.mockResolvedValue(ok([registered, ...photos]))

    const file = new File(["jpeg-bytes"], "IMG_0001.jpg", {
      type: "image/jpeg",
    })
    await userEvent.upload(screen.getByTestId("camera-input"), file)

    await waitFor(() =>
      expect(api.presignPhotoUpload).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          filename: "IMG_0001.jpg",
          content_type: "image/jpeg",
        },
      }),
    )
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].url).toBe(
      "https://bucket.example.com/photos/inspections/21/new.jpg?X-Amz=1",
    )
    expect(sent[0].headers).toEqual({ "Content-Type": "image/jpeg" })
    expect(sent[0].body).toBe(file)

    await waitFor(() =>
      expect(api.registerPhoto).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          s3_key: "photos/inspections/21/new.jpg",
          filename: "IMG_0001.jpg",
          content_type: "image/jpeg",
          uploaded_by: "Stacey Roberts",
          // 13.8: when the device says the picture was taken.
          captured_at: new Date(file.lastModified).toISOString(),
        },
      }),
    )
    // The new photo joins the grid and the in-flight tile is gone.
    await waitFor(() =>
      expect(screen.getAllByTestId("photo-thumb")).toHaveLength(3),
    )
    expect(screen.queryByTestId("photo-upload")).toBeNull()
    expect(api.listPhotos).toHaveBeenCalledTimes(2)
  })

  it("keeps a failed upload as a tile with the error and lets it be retried", async () => {
    stubXhr(403)
    api.presignPhotoUpload.mockResolvedValue(
      ok({
        upload_url: "https://bucket.example.com/x",
        s3_key: "photos/inspections/21/x.jpg",
      }),
    )
    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("photo-thumb")

    const file = new File(["jpeg-bytes"], "IMG_0002.jpg", {
      type: "image/jpeg",
    })
    await userEvent.upload(screen.getByTestId("library-input"), file)

    const tile = await screen.findByTestId("photo-upload")
    await waitFor(() => expect(tile).toHaveAttribute("data-status", "error"))
    expect(screen.getByTestId("upload-error")).toHaveTextContent(
      "Storage upload failed (403).",
    )
    expect(api.registerPhoto).not.toHaveBeenCalled()

    stubXhr(200)
    api.registerPhoto.mockResolvedValue(
      ok({ ...photos[0], id: 504, filename: "IMG_0002.jpg" }),
    )
    await userEvent.click(within(tile).getByTestId("retry-upload"))
    await waitFor(() => expect(api.registerPhoto).toHaveBeenCalledTimes(1))
    expect(api.presignPhotoUpload).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(screen.queryByTestId("photo-upload")).toBeNull())
  })

  it("shows the API's reason when the upload cannot be presigned", async () => {
    api.presignPhotoUpload.mockRejectedValue(
      apiError(403, "Viewers cannot add photos"),
    )
    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("photo-thumb")

    await userEvent.upload(
      screen.getByTestId("camera-input"),
      new File(["x"], "a.jpg", { type: "image/jpeg" }),
    )
    expect(await screen.findByTestId("upload-error")).toHaveTextContent(
      "Viewers cannot add photos",
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Discard this photo" }),
    )
    expect(screen.queryByTestId("photo-upload")).toBeNull()
  })

  it("opens the finding dialog from the phone capture bar", async () => {
    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("finding-card")

    await userEvent.click(screen.getByTestId("capture-bar-finding"))
    expect(await screen.findByTestId("finding-form-dialog")).toBeInTheDocument()
  })
})

describe("capture loop entry points (increment 11a)", () => {
  it("shows the photos filed under a finding on its card", async () => {
    api.listPhotos.mockResolvedValue(
      ok([
        { ...photos[0], finding_id: 101 },
        { ...photos[1], finding_id: null },
      ]),
    )
    renderApp(INSPECTION_URL)
    const cards = await screen.findAllByTestId("finding-card")

    const strip = await within(cards[0]).findByTestId("finding-photos")
    expect(strip).toHaveAccessibleName("1 photo for Cracked footing NE corner")
    const thumb = within(strip).getByTestId("finding-photo")
    expect(thumb.querySelector("img")).toHaveAttribute(
      "src",
      "https://files.example.com/aaa.jpg?sig=1",
    )
    expect(
      within(cards[1]).queryByTestId("finding-photos"),
    ).not.toBeInTheDocument()
    // Site photos are still all in the grid; filing takes nothing away.
    expect(screen.getAllByTestId("photo-thumb")).toHaveLength(2)

    await userEvent.click(thumb)
    expect(await screen.findByTestId("photo-viewer")).toHaveTextContent(
      "footing.jpg",
    )
  })

  it("'Pin on drawing' opens a drawing with this inspection pre-selected", async () => {
    const router = renderApp(INSPECTION_URL)
    await screen.findAllByTestId("finding-card")

    // Header button and the compact one in the phone capture bar.
    const buttons = screen.getAllByTestId("pin-on-drawing")
    expect(buttons).toHaveLength(2)
    await userEvent.click(buttons[0])
    const item = await screen.findByTestId("pin-on-drawing-item")
    expect(item).toHaveTextContent("Flare skid layout")
    expect(item).toHaveTextContent("M-201")
    await userEvent.click(item)

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/7/drawings/32"),
    )
    expect(router.state.location.search).toEqual({ inspection: 21 })
    // Let the drawing screen finish loading before the test tears jsdom
    // down, or the router's pending transition rejects after unmount.
    expect(await screen.findByTestId("drawing-viewer")).toBeInTheDocument()
  })

  it("has no 'Pin on drawing' when the project has no drawings", async () => {
    api.listDrawings.mockResolvedValue(ok([]))
    renderApp(INSPECTION_URL)
    await screen.findAllByTestId("finding-card")
    expect(screen.queryByTestId("pin-on-drawing")).not.toBeInTheDocument()
  })
})

describe("weather badge (increment 10.5)", () => {
  it("shows the reading above the photos, asked for by inspection id", async () => {
    renderApp(INSPECTION_URL)

    const badge = await screen.findByTestId("weather-badge")
    expect(badge).toHaveTextContent("Partly cloudy")
    expect(badge).toHaveTextContent("61°F")
    expect(badge).toHaveTextContent("72%")
    expect(badge).toHaveTextContent("7 mph")
    expect(badge).toHaveTextContent("Richmond, Virginia, US")
    expect(badge).toHaveAccessibleName(
      "Weather at Richmond, Virginia, US: Partly cloudy, 61 degrees Fahrenheit, 72 percent humidity, wind 7 miles per hour",
    )
    // The API resolves the project's location itself; the screen sends
    // only the inspection id (the legacy SPA passed the text along).
    expect(api.readWeather).toHaveBeenCalledWith({
      query: { inspection_id: 21 },
    })
    // Badge first, photos next — the legacy order.
    const photosHeading = screen.getByTestId("photos-count")
    expect(
      badge.compareDocumentPosition(photosHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it("is silent when the lookup fails and never toasts", async () => {
    api.readWeather.mockRejectedValue(apiError(404, "Project has no location"))
    renderApp(INSPECTION_URL)

    await screen.findAllByTestId("finding-card")
    await waitFor(() => expect(api.readWeather).toHaveBeenCalled())
    expect(screen.queryByTestId("weather-badge")).toBeNull()
    expect(screen.queryByText("Project has no location")).toBeNull()
  })
})
