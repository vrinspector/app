import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AxiosError } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/sonner"
import { routeTree } from "@/routeTree.gen"

/*
 * Drawings + the Block 8E viewer (increment 09), rendered through the real
 * route tree with the Auth0 SDK, the generated API client and PDF.js
 * replaced. PDF.js is stubbed at `@/lib/pdfjs` with a three-page letter-size
 * document whose render calls are recorded; the canvas 2D context is
 * stubbed because jsdom has none. Request bodies are asserted against what
 * the legacy SPA sent (docs/API_PORT.md, docs/SCREENS.md).
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
  listInspections: vi.fn(),
  listFindings: vi.fn(),
  listDrawings: vi.fn(),
  readDrawing: vi.fn(),
  readDrawingViewUrl: vi.fn(),
  presignDrawingUpload: vi.fn(),
  createDrawing: vi.fn(),
  updateDrawing: vi.fn(),
  deleteDrawing: vi.fn(),
  updateDrawingDimensions: vi.fn(),
  listPins: vi.fn(),
  createPin: vi.fn(),
  updatePin: vi.fn(),
  deletePin: vi.fn(),
}))

vi.mock("@/client", () => ({
  UsersService: { readUserMe: api.readUserMe },
  ProjectsService: {
    readProject: api.readProject,
    listMembers: api.listMembers,
  },
  InspectionsService: { listInspections: api.listInspections },
  // The reports section (increment 10) just needs to load empty here.
  ReportsService: { listReports: async () => ({ data: [] }) },
  FindingsService: { listFindings: api.listFindings },
  DrawingsService: {
    listDrawings: api.listDrawings,
    readDrawing: api.readDrawing,
    readDrawingViewUrl: api.readDrawingViewUrl,
    presignDrawingUpload: api.presignDrawingUpload,
    createDrawing: api.createDrawing,
    updateDrawing: api.updateDrawing,
    deleteDrawing: api.deleteDrawing,
    updateDrawingDimensions: api.updateDrawingDimensions,
    listPins: api.listPins,
    createPin: api.createPin,
    updatePin: api.updatePin,
    deletePin: api.deletePin,
  },
  // Weather (increment 10.5) is a silent badge; no reading here.
  ItpsService: { listProjectItpItems: async () => ({ data: [] }) },
  WeatherService: { readWeather: async () => ({ data: undefined }) },
}))

interface RenderCall {
  page: number
  viewport: { width: number; height: number }
  transform?: number[]
}

const pdfjs = vi.hoisted(() => ({
  openPdf: vi.fn(),
  renders: [] as RenderCall[],
  destroyed: 0,
}))

vi.mock("@/lib/pdfjs", () => ({
  openPdf: pdfjs.openPdf,
  isRenderingCancelled: (error: unknown) =>
    (error as { name?: string } | null)?.name === "RenderingCancelledException",
}))

/** A letter-size PDF with `numPages` pages whose renders are recorded. */
function fakePdf(numPages = 3, width = 612, height = 792) {
  return {
    numPages,
    getPage: async (page: number) => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: width * scale,
        height: height * scale,
      }),
      render: (params: RenderCall) => {
        pdfjs.renders.push({
          page,
          viewport: params.viewport,
          transform: params.transform,
        })
        return { promise: Promise.resolve(), cancel: vi.fn() }
      },
    }),
    destroy: () => {
      pdfjs.destroyed += 1
    },
  }
}

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

const pdfDrawing = {
  id: 31,
  public_id: "drw_31",
  project_id: 7,
  title: "Site grading plan",
  drawing_number: "C-101",
  discipline: "grading",
  filename: "C-101 grading.pdf",
  s3_key: "drawings/projects/7/aaa.pdf",
  file_type: "pdf",
  file_size: 1_200_000,
  view_url: null,
  thumbnail_url: null,
  page_width_pts: null,
  page_height_pts: null,
  uploaded_by: "stacey@example.com",
  created_at: "2026-07-03T09:00:00Z",
  updated_at: "2026-07-03T09:00:00Z",
}

const rasterDrawing = {
  ...pdfDrawing,
  id: 32,
  public_id: "drw_32",
  title: "Flare skid photo overlay",
  drawing_number: null,
  discipline: "equipment_layout",
  filename: "flare.png",
  s3_key: "drawings/projects/7/bbb.png",
  file_type: "png",
  page_width_pts: 1,
  page_height_pts: 1,
}

const pins = [
  {
    id: 901,
    public_id: "pin_901",
    drawing_id: 31,
    finding_id: null,
    tag_number: "V-101",
    label: "Isolation valve",
    x_pct: 25,
    y_pct: 40,
    status: "verified",
    notes: "Tag confirmed.",
    discipline_data: null,
    page_number: 1,
    created_by: "stacey@example.com",
    created_at: "2026-07-03T10:00:00Z",
  },
  {
    id: 902,
    public_id: "pin_902",
    drawing_id: 31,
    finding_id: 101,
    tag_number: null,
    label: null,
    x_pct: 60,
    y_pct: 70,
    status: "punch_item",
    notes: null,
    discipline_data: null,
    page_number: 2,
    created_by: "stacey@example.com",
    created_at: "2026-07-03T10:05:00Z",
  },
]

let pinStore: Array<
  Record<string, unknown> & { id: number; drawing_id: number }
> = []

const inspections = [
  {
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
  },
]

const findings = [
  {
    id: 101,
    public_id: "finding_101",
    inspection_id: 21,
    title: "Cracked footing NE corner",
    description: null,
    priority: "high",
    location_ref: "Grid A-4",
    status: "open",
    resolved_by: null,
    resolved_at: null,
    resolution_notes: null,
    created_at: "2026-07-02T10:00:00Z",
    updated_at: "2026-07-02T10:00:00Z",
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
      <Toaster />
    </QueryClientProvider>,
  )
  return router
}

const PROJECT_URL = "/projects/7"
const PDF_URL = "/projects/7/drawings/31"
const RASTER_URL = "/projects/7/drawings/32"

/** The overlay's box, so a click at (100, 50) is 25 % / 25 % of a 400 × 200 drawing. */
function stubOverlayRect() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    right: 400,
    bottom: 200,
    width: 400,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
}

/**
 * A fake XMLHttpRequest for the direct-to-S3 PUT. `succeed`/`fail` settle the
 * next request so the test can observe the tile between steps.
 */
function stubXhr() {
  const requests: Array<{
    method: string
    url: string
    headers: Record<string, string>
    body: unknown
    xhr: FakeXhr
  }> = []
  class FakeXhr {
    status = 0
    upload = { onprogress: null as null | ((e: ProgressEvent) => void) }
    onload: null | (() => void) = null
    onerror: null | (() => void) = null
    onabort: null | (() => void) = null
    private method = ""
    private url = ""
    private headers: Record<string, string> = {}
    open(method: string, url: string) {
      this.method = method
      this.url = url
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value
    }
    send(body: unknown) {
      requests.push({
        method: this.method,
        url: this.url,
        headers: this.headers,
        body,
        xhr: this,
      })
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr)
  return {
    requests,
    succeed(index = requests.length - 1) {
      const request = requests[index]
      request.xhr.status = 200
      request.xhr.onload?.()
    },
    fail(index = requests.length - 1) {
      const request = requests[index]
      request.xhr.status = 403
      request.xhr.onload?.()
    },
  }
}

beforeEach(() => {
  // The pin-then-finding capture loop (increment 11a) has its own suite
  // (capture-loop.test.tsx); here the switch is off so a status tap places
  // the pin on its own, as the legacy SPA did.
  window.localStorage.setItem("vri.capture.pinThenFinding", "off")
  pdfjs.renders.length = 0
  pdfjs.destroyed = 0
  pdfjs.openPdf.mockImplementation(async () => fakePdf())
  // jsdom has no canvas; the renderer only needs a truthy context.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ({}) as unknown as CanvasRenderingContext2D,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext

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
  api.listInspections.mockResolvedValue(ok(inspections))
  api.listFindings.mockResolvedValue(ok(findings))
  api.listDrawings.mockResolvedValue(ok([pdfDrawing, rasterDrawing]))
  api.readDrawing.mockImplementation(async ({ path }) => {
    if (path.drawing_id === 31) return ok(pdfDrawing)
    if (path.drawing_id === 32) return ok(rasterDrawing)
    throw apiError(404, "Drawing not found")
  })
  api.readDrawingViewUrl.mockImplementation(async ({ path }) =>
    ok({ view_url: `https://files.example.com/${path.drawing_id}?sig=1` }),
  )
  // The pin routes behave like the API: list reflects create / update / delete.
  pinStore = pins.map((pin) => ({ ...pin }))
  api.listPins.mockImplementation(async ({ path }) =>
    ok(pinStore.filter((pin) => pin.drawing_id === path.drawing_id)),
  )
  api.createPin.mockImplementation(async ({ path, body }) => {
    const created = {
      ...pins[1],
      id: 900 + pinStore.length + 1,
      public_id: `pin_${900 + pinStore.length + 1}`,
      drawing_id: path.drawing_id,
      finding_id: null,
      tag_number: null,
      label: null,
      notes: null,
      ...body,
    }
    pinStore.push(created)
    return ok(created)
  })
  api.updatePin.mockImplementation(async ({ path, body }) => {
    const index = pinStore.findIndex((pin) => pin.id === path.pin_id)
    pinStore[index] = { ...pinStore[index], ...body }
    return ok(pinStore[index])
  })
  api.deletePin.mockImplementation(async ({ path }) => {
    pinStore = pinStore.filter((pin) => pin.id !== path.pin_id)
    return ok(undefined)
  })
  api.updateDrawingDimensions.mockImplementation(async ({ path, body }) =>
    ok({ id: path.drawing_id, ...body }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("drawings section", () => {
  it("lists the project's drawings with discipline and PDF badges", async () => {
    renderApp(PROJECT_URL)

    const cards = await screen.findAllByTestId("drawing-card")
    expect(cards).toHaveLength(2)
    expect(screen.getByTestId("drawings-count")).toHaveTextContent("(2)")
    expect(api.listDrawings).toHaveBeenCalledWith({ query: { project_id: 7 } })

    expect(cards[0]).toHaveAttribute("data-kind", "pdf")
    expect(cards[0]).toHaveTextContent("Site grading plan")
    expect(cards[0]).toHaveTextContent("C-101")
    expect(cards[0]).toHaveTextContent("PDF")
    expect(
      within(cards[0]).getByTestId("drawing-discipline"),
    ).toHaveTextContent("Grading")
    expect(cards[0]).toHaveAttribute("href", "/projects/7/drawings/31")

    expect(cards[1]).toHaveAttribute("data-kind", "raster")
    expect(cards[1]).not.toHaveTextContent("PDF")
  })

  it("shows the empty state with upload guidance", async () => {
    api.listDrawings.mockResolvedValue(ok([]))
    renderApp(PROJECT_URL)

    expect(await screen.findByText("No drawings yet")).toBeInTheDocument()
    expect(screen.getByTestId("upload-drawing")).toBeInTheDocument()
  })

  it("hides Upload drawing from viewers", async () => {
    api.listMembers.mockResolvedValue(ok(members("viewer")))
    renderApp(PROJECT_URL)

    await screen.findAllByTestId("drawing-card")
    await waitFor(() =>
      expect(screen.queryByTestId("upload-drawing")).not.toBeInTheDocument(),
    )
  })

  it("uploads a drawing: presign → direct S3 PUT → register, then lists it", async () => {
    const xhr = stubXhr()
    api.presignDrawingUpload.mockResolvedValue(
      ok({
        upload_url: "https://s3.example.com/put?sig=1",
        s3_key: "drawings/projects/7/ccc.pdf",
      }),
    )
    const registered = {
      ...pdfDrawing,
      id: 33,
      public_id: "drw_33",
      title: "P&ID sheet 4",
      drawing_number: null,
      discipline: "general",
      filename: "P&ID sheet 4.pdf",
      s3_key: "drawings/projects/7/ccc.pdf",
    }
    api.createDrawing.mockResolvedValue(ok(registered))
    api.listDrawings
      .mockResolvedValueOnce(ok([pdfDrawing, rasterDrawing]))
      .mockResolvedValue(ok([registered, pdfDrawing, rasterDrawing]))

    renderApp(PROJECT_URL)
    await screen.findAllByTestId("drawing-card")

    const file = new File(["%PDF-1.4"], "P&ID sheet 4.pdf", {
      type: "application/pdf",
    })
    await userEvent.upload(screen.getByTestId("drawing-input"), file)

    await waitFor(() =>
      expect(api.presignDrawingUpload).toHaveBeenCalledWith({
        body: {
          project_id: 7,
          filename: "P&ID sheet 4.pdf",
          content_type: "application/pdf",
        },
      }),
    )
    await waitFor(() => expect(xhr.requests).toHaveLength(1))
    expect(xhr.requests[0].method).toBe("PUT")
    expect(xhr.requests[0].url).toBe("https://s3.example.com/put?sig=1")
    expect(xhr.requests[0].headers["Content-Type"]).toBe("application/pdf")
    expect(xhr.requests[0].body).toBe(file)
    expect(screen.getByTestId("drawing-upload")).toHaveAttribute(
      "data-status",
      "uploading",
    )
    expect(api.createDrawing).not.toHaveBeenCalled()

    xhr.succeed()

    await waitFor(() =>
      expect(api.createDrawing).toHaveBeenCalledWith({
        body: {
          project_id: 7,
          s3_key: "drawings/projects/7/ccc.pdf",
          filename: "P&ID sheet 4.pdf",
          title: "P&ID sheet 4",
          discipline: "general",
          file_type: "pdf",
          file_size: file.size,
          uploaded_by: "Stacey Roberts",
        },
      }),
    )
    await waitFor(() =>
      expect(screen.getAllByTestId("drawing-card")).toHaveLength(3),
    )
    expect(screen.queryByTestId("drawing-upload")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("drawing-card")[0]).toHaveTextContent(
      "P&ID sheet 4",
    )
  })

  it("refuses unsupported files and keys outside the project prefix", async () => {
    stubXhr()
    api.presignDrawingUpload.mockResolvedValue(
      ok({
        upload_url: "https://s3.example.com/put?sig=1",
        s3_key: "drawings/projects/8/zzz.png",
      }),
    )
    renderApp(PROJECT_URL)
    await screen.findAllByTestId("drawing-card")

    const input = screen.getByTestId("drawing-input")
    await userEvent.upload(
      input,
      new File(["x"], "notes.docx", { type: "application/msword" }),
      { applyAccept: false },
    )
    expect(
      await screen.findByText(/Only PDF, PNG, JPG and SVG drawings/),
    ).toBeInTheDocument()
    expect(api.presignDrawingUpload).not.toHaveBeenCalled()

    await userEvent.upload(
      input,
      new File(["png"], "plan.png", { type: "image/png" }),
    )
    const tile = await screen.findByTestId("drawing-upload")
    await waitFor(() => expect(tile).toHaveAttribute("data-status", "error"))
    expect(screen.getByTestId("drawing-upload-error")).toHaveTextContent(
      "not scoped to the active project",
    )
    expect(api.createDrawing).not.toHaveBeenCalled()
  })
})

describe("PDF viewer", () => {
  it("opens the PDF from the presigned URL and shows page 1 with its pins", async () => {
    renderApp(PDF_URL)

    await screen.findByTestId("drawing-viewer")
    expect(api.readDrawingViewUrl).toHaveBeenCalledWith({
      path: { drawing_id: 31 },
    })
    await waitFor(() =>
      expect(pdfjs.openPdf).toHaveBeenCalledWith(
        "https://files.example.com/31?sig=1",
      ),
    )
    expect(await screen.findByTestId("page-indicator")).toHaveTextContent(
      "Page 1 of 3",
    )
    await waitFor(() => expect(pdfjs.renders).toHaveLength(1))
    expect(pdfjs.renders[0].page).toBe(1)
    expect(pdfjs.renders[0].viewport).toEqual({ width: 612, height: 792 })

    const markers = await screen.findAllByTestId("pin-marker")
    expect(markers).toHaveLength(1)
    expect(markers[0]).toHaveAttribute("data-pin-id", "901")
    expect(markers[0]).toHaveStyle({ left: "25%", top: "40%" })
    expect(markers[0]).toHaveTextContent("V-101")
    expect(screen.getByTestId("pin-count")).toHaveTextContent(
      "1 pin on this page",
    )
    expect(screen.getByTestId("prev-page")).toBeDisabled()
    expect(screen.getByTestId("next-page")).toBeEnabled()
  })

  it("records the page size in points when the drawing has none (Block 8E R6)", async () => {
    renderApp(PDF_URL)
    await waitFor(() =>
      expect(api.updateDrawingDimensions).toHaveBeenCalledWith({
        path: { drawing_id: 31 },
        body: { page_width_pts: 612, page_height_pts: 792 },
      }),
    )
    expect(api.updateDrawingDimensions).toHaveBeenCalledTimes(1)
  })

  it("does not re-record dimensions already stored", async () => {
    api.readDrawing.mockResolvedValue(
      ok({ ...pdfDrawing, page_width_pts: 612, page_height_pts: 792 }),
    )
    renderApp(PDF_URL)
    await waitFor(() => expect(pdfjs.renders).toHaveLength(1))
    expect(api.updateDrawingDimensions).not.toHaveBeenCalled()
  })

  it("navigates pages and shows only that page's pins", async () => {
    renderApp(PDF_URL)
    await screen.findAllByTestId("pin-marker")

    await userEvent.click(screen.getByTestId("next-page"))
    expect(screen.getByTestId("page-indicator")).toHaveTextContent(
      "Page 2 of 3",
    )
    await waitFor(() =>
      expect(pdfjs.renders[pdfjs.renders.length - 1]?.page).toBe(2),
    )
    const markers = screen.getAllByTestId("pin-marker")
    expect(markers).toHaveLength(1)
    expect(markers[0]).toHaveAttribute("data-pin-id", "902")
    expect(markers[0]).toHaveAttribute("data-pin-status", "punch_item")

    await userEvent.click(screen.getByTestId("next-page"))
    expect(screen.getByTestId("page-indicator")).toHaveTextContent(
      "Page 3 of 3",
    )
    expect(screen.getByTestId("next-page")).toBeDisabled()
    expect(screen.queryAllByTestId("pin-marker")).toHaveLength(0)
    expect(screen.getByTestId("pin-count")).toHaveTextContent(
      "0 pins on this page",
    )

    // Keyboard: ← goes back.
    screen.getByTestId("viewer-stage").focus()
    await userEvent.keyboard("{ArrowLeft}")
    expect(screen.getByTestId("page-indicator")).toHaveTextContent(
      "Page 2 of 3",
    )
  })

  it("zooms with the buttons, re-rendering the page at the new scale", async () => {
    renderApp(PDF_URL)
    await waitFor(() => expect(pdfjs.renders).toHaveLength(1))
    expect(screen.getByTestId("zoom-indicator")).toHaveTextContent("100%")

    await userEvent.click(screen.getByTestId("zoom-in"))
    expect(screen.getByTestId("zoom-indicator")).toHaveTextContent("125%")
    await waitFor(() =>
      expect(pdfjs.renders[pdfjs.renders.length - 1]?.viewport).toEqual({
        width: 765,
        height: 990,
      }),
    )

    await userEvent.click(screen.getByTestId("zoom-out"))
    await userEvent.click(screen.getByTestId("zoom-out"))
    expect(screen.getByTestId("zoom-indicator")).toHaveTextContent("75%")
    await waitFor(() =>
      expect(pdfjs.renders[pdfjs.renders.length - 1]?.viewport).toEqual({
        width: 459,
        height: 594,
      }),
    )
    // The pin layer tracks the rendered box.
    expect(screen.getByTestId("drawing-box")).toHaveStyle({
      width: "459px",
      height: "594px",
    })
  })

  it("places a pin on the current page with the legacy body", async () => {
    stubOverlayRect()
    renderApp(PDF_URL)
    await screen.findAllByTestId("pin-marker")
    await userEvent.click(screen.getByTestId("next-page"))

    // Not in pin mode: a click on the drawing does nothing.
    fireEvent.click(screen.getByTestId("pin-overlay"), {
      clientX: 100,
      clientY: 50,
    })
    expect(screen.queryByTestId("pin-status-dialog")).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId("pin-mode"))
    expect(screen.getByTestId("pin-mode")).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByTestId("pin-mode-hint")).toHaveTextContent(
      "Tap page 2 to place a pin",
    )
    fireEvent.click(screen.getByTestId("pin-overlay"), {
      clientX: 100,
      clientY: 50,
    })
    const dialog = await screen.findByTestId("pin-status-dialog")
    expect(dialog).toHaveTextContent("Select pin status — page 2")

    await userEvent.click(
      within(dialog).getByTestId("pin-status-not_installed"),
    )
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        path: { drawing_id: 31 },
        body: { x_pct: 25, y_pct: 25, status: "not_installed", page_number: 2 },
      }),
    )
    await waitFor(() =>
      expect(screen.getAllByTestId("pin-marker")).toHaveLength(2),
    )
    expect(screen.getByText("Pin placed")).toBeInTheDocument()
  })

  it("opens a pin, updates its status and notes, and deletes it", async () => {
    renderApp(PDF_URL)
    const [marker] = await screen.findAllByTestId("pin-marker")

    await userEvent.click(marker)
    const dialog = await screen.findByTestId("pin-detail-dialog")
    expect(dialog).toHaveTextContent("Pin #V-101")
    expect(dialog).toHaveTextContent("Page 1 · Verified")
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("Tag confirmed.")

    await userEvent.selectOptions(
      within(dialog).getByTestId("pin-status-select"),
      "in_progress",
    )
    await userEvent.clear(within(dialog).getByLabelText("Notes"))
    await userEvent.type(
      within(dialog).getByLabelText("Notes"),
      "Re-check after hydrotest",
    )
    await userEvent.click(within(dialog).getByTestId("save-pin"))

    await waitFor(() =>
      expect(api.updatePin).toHaveBeenCalledWith({
        path: { pin_id: 901 },
        body: {
          status: "in_progress",
          label: "Isolation valve",
          notes: "Re-check after hydrotest",
          finding_id: null,
        },
      }),
    )
    await waitFor(() =>
      expect(screen.getAllByTestId("pin-marker")[0]).toHaveAttribute(
        "data-pin-status",
        "in_progress",
      ),
    )

    await userEvent.click(screen.getAllByTestId("pin-marker")[0])
    await userEvent.click(
      within(await screen.findByTestId("pin-detail-dialog")).getByTestId(
        "delete-pin",
      ),
    )
    const confirm = await screen.findByTestId("confirm-dialog")
    await userEvent.click(within(confirm).getByText("Delete pin"))
    await waitFor(() =>
      expect(api.deletePin).toHaveBeenCalledWith({ path: { pin_id: 901 } }),
    )
    await waitFor(() =>
      expect(screen.queryAllByTestId("pin-marker")).toHaveLength(0),
    )
  })

  it("links a pin to a finding in the project", async () => {
    renderApp(PDF_URL)
    await userEvent.click((await screen.findAllByTestId("pin-marker"))[0])
    const dialog = await screen.findByTestId("pin-detail-dialog")

    const select = within(dialog).getByTestId("pin-finding-select")
    await waitFor(() =>
      expect(
        within(select).getByRole("option", {
          name: "Cracked footing NE corner",
        }),
      ).toBeInTheDocument(),
    )
    await userEvent.selectOptions(select, "101")
    await userEvent.click(within(dialog).getByTestId("save-pin"))
    await waitFor(() =>
      expect(api.updatePin).toHaveBeenCalledWith({
        path: { pin_id: 901 },
        body: expect.objectContaining({ finding_id: 101 }),
      }),
    )
  })

  it("is read-only for viewers", async () => {
    api.listMembers.mockResolvedValue(ok(members("viewer")))
    renderApp(PDF_URL)
    const [marker] = await screen.findAllByTestId("pin-marker")
    await waitFor(() =>
      expect(screen.queryByTestId("pin-mode")).not.toBeInTheDocument(),
    )
    expect(screen.queryByTestId("drawing-actions")).not.toBeInTheDocument()

    await userEvent.click(marker)
    const dialog = await screen.findByTestId("pin-detail-dialog")
    expect(dialog).toHaveTextContent("Tag confirmed.")
    expect(within(dialog).queryByTestId("save-pin")).not.toBeInTheDocument()
    expect(within(dialog).queryByTestId("delete-pin")).not.toBeInTheDocument()
  })

  it("edits the drawing's title, number and discipline", async () => {
    api.updateDrawing.mockImplementation(async ({ path, body }) =>
      ok({ ...pdfDrawing, id: path.drawing_id, ...body }),
    )
    renderApp(PDF_URL)
    await screen.findByTestId("drawing-viewer")

    await userEvent.click(screen.getByTestId("drawing-actions"))
    await userEvent.click(await screen.findByText("Edit drawing"))
    const dialog = await screen.findByTestId("drawing-form-dialog")
    const title = within(dialog).getByLabelText("Title")
    await userEvent.clear(title)
    await userEvent.type(title, "Grading plan — Rev B")
    await userEvent.clear(within(dialog).getByLabelText("Drawing number"))
    await userEvent.type(
      within(dialog).getByLabelText("Drawing number"),
      "C-101-B",
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText("Discipline"),
      "civil_structural",
    )
    await userEvent.click(within(dialog).getByTestId("drawing-form-submit"))

    await waitFor(() =>
      expect(api.updateDrawing).toHaveBeenCalledWith({
        path: { drawing_id: 31 },
        body: {
          title: "Grading plan — Rev B",
          drawing_number: "C-101-B",
          discipline: "civil_structural",
        },
      }),
    )
    expect(
      await screen.findByRole("heading", { name: "Grading plan — Rev B" }),
    ).toBeInTheDocument()
  })

  it("deletes the drawing and returns to the project", async () => {
    api.deleteDrawing.mockResolvedValue(ok(undefined))
    const router = renderApp(PDF_URL)
    await screen.findByTestId("drawing-viewer")

    await userEvent.click(screen.getByTestId("drawing-actions"))
    await userEvent.click(await screen.findByText("Delete drawing"))
    const confirm = await screen.findByTestId("confirm-dialog")
    await userEvent.click(within(confirm).getByText("Delete drawing"))

    await waitFor(() =>
      expect(api.deleteDrawing).toHaveBeenCalledWith({
        path: { drawing_id: 31 },
      }),
    )
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/projects/7"),
    )
  })

  it("shows an error with retry when the PDF cannot be opened", async () => {
    pdfjs.openPdf.mockRejectedValueOnce(new Error("Invalid PDF structure"))
    renderApp(PDF_URL)

    expect(
      await screen.findByText("Couldn't open this drawing"),
    ).toBeInTheDocument()
    expect(screen.getByText(/Invalid PDF structure/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /try again/i }))
    await waitFor(() => expect(api.readDrawingViewUrl).toHaveBeenCalledTimes(2))
  })

  it("renders not-found for a hidden drawing and for a cross-project URL", async () => {
    renderApp("/projects/7/drawings/99")
    expect(await screen.findByTestId("not-found-state")).toHaveTextContent(
      "Drawing not found",
    )
  })

  it("renders not-found when the drawing belongs to another project", async () => {
    renderApp("/projects/8/drawings/31")
    expect(await screen.findByTestId("not-found-state")).toHaveTextContent(
      "Drawing not found",
    )
    expect(screen.queryByTestId("drawing-viewer")).not.toBeInTheDocument()
  })
})

describe("raster viewer", () => {
  function loadImage() {
    const image = screen.getByTestId("raster-image") as HTMLImageElement
    Object.defineProperty(image, "naturalWidth", { value: 1600 })
    Object.defineProperty(image, "naturalHeight", { value: 1200 })
    fireEvent.load(image)
    return image
  }

  it("shows the image without page controls and with every pin", async () => {
    pinStore = [{ ...pins[0], drawing_id: 32 }]
    renderApp(RASTER_URL)

    const viewer = await screen.findByTestId("drawing-viewer")
    expect(viewer).toHaveAttribute("data-kind", "raster")
    expect(screen.queryByTestId("page-controls")).not.toBeInTheDocument()
    expect(pdfjs.openPdf).not.toHaveBeenCalled()
    const image = loadImage()
    expect(image).toHaveAttribute("src", "https://files.example.com/32?sig=1")

    await waitFor(() =>
      expect(screen.getByTestId("zoom-indicator")).toHaveTextContent("100%"),
    )
    expect(screen.getByTestId("drawing-box")).toHaveStyle({
      width: "1600px",
      height: "1200px",
    })
    expect(await screen.findAllByTestId("pin-marker")).toHaveLength(1)
    expect(screen.getByTestId("pin-count")).toHaveTextContent("1 pin")
    expect(screen.getByTestId("pin-count")).not.toHaveTextContent(
      "on this page",
    )

    await userEvent.click(screen.getByTestId("zoom-out"))
    expect(screen.getByTestId("zoom-indicator")).toHaveTextContent("75%")
    expect(screen.getByTestId("drawing-box")).toHaveStyle({
      width: "1200px",
      height: "900px",
    })
    // Pins are percentages, so they keep their place as the image resizes.
    expect(screen.getByTestId("pin-marker")).toHaveStyle({
      left: "25%",
      top: "40%",
    })
  })

  it("places a pin on page 1 of a raster drawing", async () => {
    stubOverlayRect()
    renderApp(RASTER_URL)
    await screen.findByTestId("raster-image")
    loadImage()
    await waitFor(() => expect(screen.getByTestId("pin-mode")).toBeEnabled())

    await userEvent.click(screen.getByTestId("pin-mode"))
    fireEvent.click(screen.getByTestId("pin-overlay"), {
      clientX: 200,
      clientY: 100,
    })
    const dialog = await screen.findByTestId("pin-status-dialog")
    expect(dialog).toHaveTextContent("Select pin status")
    expect(dialog).not.toHaveTextContent("page")
    await userEvent.click(within(dialog).getByTestId("pin-status-verified"))
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        path: { drawing_id: 32 },
        body: { x_pct: 50, y_pct: 50, status: "verified", page_number: 1 },
      }),
    )
  })
})
