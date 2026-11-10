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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/sonner"
import { routeTree } from "@/routeTree.gen"

/*
 * The capture loop (increment 11a): tap the drawing → pin placed → finding
 * form with the camera ready → photo + note → saved finding linked to the
 * pin, rendered through the real route tree on a raster drawing (no PDF.js
 * needed) with the Auth0 SDK and the API client replaced. The S3 PUT goes
 * to a fake XMLHttpRequest so the test can settle the upload itself.
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
  createFinding: vi.fn(),
  listPhotos: vi.fn(),
  presignPhotoUpload: vi.fn(),
  registerPhoto: vi.fn(),
  listDrawings: vi.fn(),
  readDrawing: vi.fn(),
  readDrawingViewUrl: vi.fn(),
  listPins: vi.fn(),
  createPin: vi.fn(),
  updatePin: vi.fn(),
}))

vi.mock("@/client", () => ({
  UsersService: { readUserMe: api.readUserMe },
  ProjectsService: {
    readProject: api.readProject,
    listMembers: api.listMembers,
  },
  InspectionsService: { listInspections: api.listInspections },
  ReportsService: { listReports: async () => ({ data: [] }) },
  FindingsService: {
    listFindings: api.listFindings,
    createFinding: api.createFinding,
  },
  PhotosService: {
    listPhotos: api.listPhotos,
    presignPhotoUpload: api.presignPhotoUpload,
    registerPhoto: api.registerPhoto,
  },
  DrawingsService: {
    listDrawings: api.listDrawings,
    readDrawing: api.readDrawing,
    readDrawingViewUrl: api.readDrawingViewUrl,
    listPins: api.listPins,
    createPin: api.createPin,
    updatePin: api.updatePin,
  },
  ItpsService: { listProjectItpItems: async () => ({ data: [] }) },
  WeatherService: { readWeather: async () => ({ data: undefined }) },
}))

const ok = <T,>(data: T) => ({ data })

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

const drawing = {
  id: 32,
  public_id: "drw_32",
  project_id: 7,
  title: "Flare skid layout",
  drawing_number: "M-201",
  discipline: "equipment_layout",
  filename: "flare.png",
  s3_key: "drawings/projects/7/bbb.png",
  file_type: "png",
  file_size: 400_000,
  view_url: null,
  thumbnail_url: null,
  page_width_pts: 1,
  page_height_pts: 1,
  uploaded_by: "stacey@example.com",
  created_at: "2026-07-03T09:00:00Z",
  updated_at: "2026-07-03T09:00:00Z",
}

const inspection = (
  id: number,
  title: string,
  created_at: string,
  status: "open" | "closed" = "open",
) => ({
  id,
  public_id: `insp_${id}`,
  project_id: 7,
  title,
  inspection_type: "mechanical",
  type: "mechanical",
  inspector: "Stacey Roberts",
  notes: null,
  status,
  inspection_status: status,
  signed_off_by: status === "closed" ? "stacey@example.com" : null,
  signed_off_at: status === "closed" ? "2026-07-04T09:00:00Z" : null,
  created_at,
  updated_at: created_at,
})

const inspections = [
  inspection(21, "Site Walk #1 - Civil", "2026-07-02T09:00:00Z"),
  inspection(22, "Flare skid pre-start", "2026-07-06T09:00:00Z"),
  inspection(23, "Signed-off walk", "2026-07-08T09:00:00Z", "closed"),
]

const members = [
  {
    id: 1,
    public_id: "mem_1",
    project_id: 7,
    email: "stacey@example.com",
    user_email: "stacey@example.com",
    user_sub: "auth0|stacey",
    role: "inspector",
    invited_by: null,
    created_at: "2026-07-01T12:00:00Z",
  },
]

let pinStore: Array<Record<string, unknown> & { id: number }> = []
let findingStore: Array<Record<string, unknown> & { id: number }> = []
let photoStore: Array<Record<string, unknown> & { id: number }> = []

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

const DRAWING_URL = "/projects/7/drawings/32"

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

function loadImage() {
  const image = screen.getByTestId("raster-image") as HTMLImageElement
  Object.defineProperty(image, "naturalWidth", { value: 1600 })
  Object.defineProperty(image, "naturalHeight", { value: 1200 })
  fireEvent.load(image)
}

/** Add pin → tap the sheet → pick a status; returns the status dialog. */
async function tapTheDrawing() {
  await screen.findByTestId("raster-image")
  loadImage()
  await waitFor(() => expect(screen.getByTestId("pin-mode")).toBeEnabled())
  await userEvent.click(screen.getByTestId("pin-mode"))
  fireEvent.click(screen.getByTestId("pin-overlay"), {
    clientX: 200,
    clientY: 100,
  })
  return screen.findByTestId("pin-status-dialog")
}

beforeEach(() => {
  // jsdom has no object URLs; the staged tiles only need a string.
  URL.createObjectURL = vi.fn(() => "blob:preview")
  URL.revokeObjectURL = vi.fn()
  api.readUserMe.mockResolvedValue(
    ok({
      sub: "auth0|stacey",
      name: "Stacey Roberts",
      email: "stacey@example.com",
      permissions: [],
    }),
  )
  api.readProject.mockResolvedValue(ok(project))
  api.listMembers.mockResolvedValue(ok(members))
  api.listInspections.mockResolvedValue(ok(inspections))
  api.listDrawings.mockResolvedValue(ok([drawing]))
  api.readDrawing.mockResolvedValue(ok(drawing))
  api.readDrawingViewUrl.mockResolvedValue(
    ok({ view_url: "https://files.example.com/32?sig=1" }),
  )

  pinStore = []
  findingStore = []
  photoStore = []
  api.listPins.mockImplementation(async () => ok(pinStore))
  api.createPin.mockImplementation(async ({ path, body }) => {
    const id = 903 + pinStore.length
    const created = {
      id,
      public_id: `pin_${id}`,
      drawing_id: path.drawing_id,
      finding_id: null,
      tag_number: null,
      label: null,
      notes: null,
      discipline_data: null,
      created_by: "stacey@example.com",
      created_at: "2026-07-03T10:00:00Z",
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
  api.listFindings.mockImplementation(async ({ query }) =>
    ok(findingStore.filter((f) => f.inspection_id === query.inspection_id)),
  )
  api.createFinding.mockImplementation(async ({ body }) => {
    const created = {
      id: 500 + findingStore.length + 1,
      public_id: `finding_${500 + findingStore.length + 1}`,
      resolved_by: null,
      resolved_at: null,
      resolution_notes: null,
      created_at: "2026-07-06T10:00:00Z",
      updated_at: "2026-07-06T10:00:00Z",
      ...body,
    }
    findingStore.push(created)
    return ok(created)
  })
  api.listPhotos.mockImplementation(async ({ query }) =>
    ok(photoStore.filter((p) => p.inspection_id === query.inspection_id)),
  )
  api.presignPhotoUpload.mockImplementation(async ({ body }) =>
    ok({
      upload_url: `https://s3.example.com/put/${body.inspection_id}?sig=1`,
      s3_key: `photos/inspections/${body.inspection_id}/abc.jpg`,
    }),
  )
  api.registerPhoto.mockImplementation(async ({ body }) => {
    const created = {
      id: 700 + photoStore.length + 1,
      public_id: `photo_${700 + photoStore.length + 1}`,
      uploaded_by: "stacey@example.com",
      created_at: "2026-07-06T10:00:05Z",
      view_url: "https://files.example.com/photo.jpg",
      ...body,
    }
    photoStore.push(created)
    return ok(created)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe("capture loop: drawing tap → finding with photo", () => {
  it("places the pin, opens the form prefilled, and saves finding + photo + link", async () => {
    stubOverlayRect()
    const s3 = stubXhr()
    renderApp(DRAWING_URL)
    const statusDialog = await tapTheDrawing()

    // The switch is on by default: the status tap goes on to the form.
    expect(
      within(statusDialog).getByTestId("pin-then-finding"),
    ).toHaveAttribute("data-state", "checked")
    await userEvent.click(
      within(statusDialog).getByTestId("pin-status-punch_item"),
    )
    await waitFor(() =>
      expect(api.createPin).toHaveBeenCalledWith({
        path: { drawing_id: 32 },
        body: { x_pct: 50, y_pct: 50, status: "punch_item", page_number: 1 },
      }),
    )
    // No "Pin placed" toast on the way through: one flow, one confirmation.
    expect(screen.queryByText("Pin placed")).not.toBeInTheDocument()

    const dialog = await screen.findByTestId("capture-finding-dialog")
    expect(dialog).toHaveTextContent("Log a finding at pin #903")
    // Pin mode ends so the next tap on the sheet is not another pin.
    expect(screen.getByTestId("pin-mode")).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    // Prefilled so Save works with nothing typed; newest open inspection chosen.
    expect(within(dialog).getByTestId("capture-title")).toHaveValue(
      "Pin #903 — Flare skid layout",
    )
    expect(within(dialog).getByTestId("capture-location")).toHaveValue(
      "Flare skid layout — pin #903",
    )
    await waitFor(() =>
      expect(within(dialog).getByTestId("capture-inspection")).toHaveValue(
        "22",
      ),
    )
    const options = within(dialog)
      .getAllByRole("option")
      .map((o) => o.textContent)
    expect(options).toContain("Flare skid pre-start")
    expect(options).not.toContain("Signed-off walk")

    // Take photo: the rear-camera input; the upload starts at once.
    const file = new File(["jpeg"], "IMG_0042.jpg", { type: "image/jpeg" })
    const camera = within(dialog).getByTestId("camera-input")
    expect(camera).toHaveAttribute("capture", "environment")
    fireEvent.change(camera, { target: { files: [file] } })
    await waitFor(() =>
      expect(api.presignPhotoUpload).toHaveBeenCalledWith({
        body: {
          inspection_id: 22,
          filename: "IMG_0042.jpg",
          content_type: "image/jpeg",
        },
      }),
    )
    const tile = await within(dialog).findByTestId("capture-photo")
    await waitFor(() => expect(s3.requests).toHaveLength(1))
    expect(s3.requests[0].method).toBe("PUT")
    expect(tile).toHaveAttribute("data-status", "uploading")
    // Nothing is registered until the finding exists.
    expect(api.registerPhoto).not.toHaveBeenCalled()

    // Meanwhile the note is typed (dictation needs a browser microphone).
    await userEvent.type(
      within(dialog).getByLabelText("What you see"),
      "Guard missing on the flare skid coupling",
    )

    // Save before the upload has finished: the form waits for it.
    await userEvent.click(within(dialog).getByTestId("capture-save"))
    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith({
        body: {
          inspection_id: 22,
          title: "Pin #903 — Flare skid layout",
          description: "Guard missing on the flare skid coupling",
          priority: "medium",
          location_ref: "Flare skid layout — pin #903",
          status: "open",
        },
      }),
    )
    expect(within(dialog).getByTestId("capture-save")).toHaveTextContent(
      "Uploading photo…",
    )
    expect(api.registerPhoto).not.toHaveBeenCalled()
    s3.succeed(0)

    await waitFor(() =>
      expect(api.registerPhoto).toHaveBeenCalledWith({
        body: {
          inspection_id: 22,
          finding_id: 501,
          s3_key: "photos/inspections/22/abc.jpg",
          filename: "IMG_0042.jpg",
          content_type: "image/jpeg",
          uploaded_by: "Stacey Roberts",
        },
      }),
    )
    await waitFor(() =>
      expect(api.updatePin).toHaveBeenCalledWith({
        path: { pin_id: 903 },
        body: { finding_id: 501 },
      }),
    )
    await waitFor(() =>
      expect(
        screen.queryByTestId("capture-finding-dialog"),
      ).not.toBeInTheDocument(),
    )
    expect(
      await screen.findByText(
        "Finding logged with 1 photo and linked to pin #903",
      ),
    ).toBeInTheDocument()
    expect(pinStore[0].finding_id).toBe(501)
    // The pin is now a linked pin on the sheet.
    expect(screen.getAllByTestId("pin-marker")).toHaveLength(1)
    // Remembered for the next finding on this project.
    expect(window.localStorage.getItem("vri.capture.inspection.7")).toBe("22")
  })

  it("pre-selects the inspection the viewer was opened from", async () => {
    stubOverlayRect()
    renderApp(`${DRAWING_URL}?inspection=21`)
    const statusDialog = await tapTheDrawing()
    await userEvent.click(
      within(statusDialog).getByTestId("pin-status-verified"),
    )
    const dialog = await screen.findByTestId("capture-finding-dialog")
    await waitFor(() =>
      expect(within(dialog).getByTestId("capture-inspection")).toHaveValue(
        "21",
      ),
    )
    expect(dialog).toHaveTextContent("saved to Site Walk #1 - Civil")
  })

  it("'Keep pin only' leaves the pin as placed and the switch can be turned off", async () => {
    stubOverlayRect()
    renderApp(DRAWING_URL)
    const statusDialog = await tapTheDrawing()
    await userEvent.click(
      within(statusDialog).getByTestId("pin-status-verified"),
    )
    const dialog = await screen.findByTestId("capture-finding-dialog")
    await userEvent.click(within(dialog).getByTestId("capture-keep-pin"))
    await waitFor(() =>
      expect(
        screen.queryByTestId("capture-finding-dialog"),
      ).not.toBeInTheDocument(),
    )
    expect(api.createFinding).not.toHaveBeenCalled()
    expect(api.updatePin).not.toHaveBeenCalled()
    expect(pinStore).toHaveLength(1)
    expect(pinStore[0].finding_id).toBeNull()

    // Second pin with the switch off: the legacy behaviour, remembered.
    await userEvent.click(screen.getByTestId("pin-mode"))
    fireEvent.click(screen.getByTestId("pin-overlay"), {
      clientX: 100,
      clientY: 50,
    })
    const again = await screen.findByTestId("pin-status-dialog")
    await userEvent.click(within(again).getByTestId("pin-then-finding"))
    expect(again).toHaveTextContent(
      "You can add a label, notes or a finding afterwards",
    )
    await userEvent.click(within(again).getByTestId("pin-status-not_started"))
    expect(await screen.findByText("Pin placed")).toBeInTheDocument()
    expect(
      screen.queryByTestId("capture-finding-dialog"),
    ).not.toBeInTheDocument()
    expect(window.localStorage.getItem("vri.capture.pinThenFinding")).toBe(
      "off",
    )
  })

  it("explains when the project has no open inspection and keeps the pin", async () => {
    stubOverlayRect()
    api.listInspections.mockResolvedValue(
      ok([inspection(23, "Signed-off walk", "2026-07-08T09:00:00Z", "closed")]),
    )
    renderApp(DRAWING_URL)
    const statusDialog = await tapTheDrawing()
    await userEvent.click(
      within(statusDialog).getByTestId("pin-status-verified"),
    )
    const dialog = await screen.findByTestId("capture-finding-dialog")
    expect(
      await within(dialog).findByTestId("capture-no-inspection"),
    ).toHaveTextContent("no open inspection")
    expect(within(dialog).queryByTestId("capture-save")).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByTestId("capture-keep-pin"))
    expect(pinStore).toHaveLength(1)
  })

  it("saves the finding and says so when the photo upload failed", async () => {
    stubOverlayRect()
    const s3 = stubXhr()
    renderApp(DRAWING_URL)
    const statusDialog = await tapTheDrawing()
    await userEvent.click(
      within(statusDialog).getByTestId("pin-status-verified"),
    )
    const dialog = await screen.findByTestId("capture-finding-dialog")
    await waitFor(() =>
      expect(within(dialog).getByTestId("capture-inspection")).toHaveValue(
        "22",
      ),
    )
    fireEvent.change(within(dialog).getByTestId("camera-input"), {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    })
    await waitFor(() => expect(s3.requests).toHaveLength(1))
    s3.fail(0)
    await waitFor(() =>
      expect(within(dialog).getByTestId("capture-photo")).toHaveAttribute(
        "data-status",
        "error",
      ),
    )
    await userEvent.click(within(dialog).getByTestId("capture-save"))
    await waitFor(() => expect(api.updatePin).toHaveBeenCalled())
    expect(api.registerPhoto).not.toHaveBeenCalled()
    expect(
      await screen.findByText("Finding logged and linked to pin #903"),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/1 photo did not upload/),
    ).toBeInTheDocument()
  })
})
