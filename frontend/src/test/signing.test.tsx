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
 * Increment 14: the no-account signing page (/sign/<token>), rendered
 * through the real route tree while signed out. The drawn signature is
 * stubbed (jsdom has no canvas).
 */

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    isAuthenticated: false,
    isLoading: false,
    user: undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  }),
  Auth0Provider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock("@/components/Signing/SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button
      type="button"
      onClick={() => onChange("data:image/png;base64,iVBORw0KGgo=")}
    >
      draw signature
    </button>
  ),
}))

const api = vi.hoisted(() => ({
  openSigningLink: vi.fn(),
  submitSignature: vi.fn(),
}))
vi.mock("@/client", () => ({
  SignoffService: {
    openSigningLink: api.openSigningLink,
    submitSignature: api.submitSignature,
  },
}))

const line = (id: number, extra: Record<string, unknown>) => ({
  id,
  number: id,
  section: "Pre-pour",
  requirement: `Line ${id}`,
  classification: "hold",
  status: "pass",
  result_label: null,
  measured_value: null,
  value_unit: null,
  out_of_tolerance: null,
  notes: null,
  conditions: null,
  acceptance_criteria: null,
  reference_doc: null,
  photo_count: 0,
  needs_you: true,
  sign_state: "ready",
  waiting_reason: null,
  ...extra,
})

const session = (extra: Record<string, unknown> = {}) => ({
  project_name: "Cedar Hollow Landfill RNG",
  project_client: "Sample Energy Partners",
  project_location: "Sample County, NC",
  kind: "itp",
  area_name: "Stage 1",
  role_name: "Owner's representative",
  party: "client",
  signer_email: "rep@example.com",
  expires_at: "2026-11-25T12:00:00Z",
  documents: [
    {
      itp_id: 3,
      doc_number: "ITP-CH-RNG-001",
      title: "Cast-in-place concrete — Stage 1",
      status: "in_progress",
      area_name: "Stage 1",
      lines: [
        line(1, {
          result_label: "Approved with conditions",
          conditions: "Re-tie two bars at C7",
        }),
        line(2, {
          status: "pending",
          sign_state: "waiting",
          waiting_reason: "Not recorded on site yet",
        }),
        line(3, { needs_you: false, sign_state: null, requirement: "Other" }),
      ],
    },
  ],
  ready_count: 1,
  waiting_count: 1,
  signed_count: 0,
  pack_url: "https://s3.test/packs/itps/3/v1.pdf",
  ...extra,
})

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth: { isAuthenticated: false } },
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
  api.openSigningLink.mockReset()
  api.submitSignature.mockReset()
})

describe("signing page", () => {
  it("shows the lines for the signer and signs them once", async () => {
    api.openSigningLink.mockResolvedValue({ data: session() })
    api.submitSignature.mockResolvedValue({
      data: {
        signed_lines: 1,
        documents: 1,
        signed_at: "2026-11-11T15:00:00Z",
        weather: { description: "Clear sky", temp_f: 60.2, wind_mph: 4 },
        still_waiting: 1,
      },
    })
    const user = userEvent.setup()
    const router = renderAt("/sign/tok-123")

    expect(await screen.findByText(/You are signing as/)).toBeInTheDocument()
    // Not sent to /login: no account needed.
    expect(router.state.location.pathname).toBe("/sign/tok-123")
    expect(api.openSigningLink).toHaveBeenCalledWith({
      path: { token: "tok-123" },
    })
    const lines = screen.getAllByTestId("sign-line")
    expect(lines).toHaveLength(2) // only the lines that need this role
    expect(within(lines[0]).getByText("Ready for you")).toBeInTheDocument()
    expect(within(lines[0]).getByText("Approved with conditions")).toBeVisible()
    expect(
      within(lines[1]).getByText(/Not ready: Not recorded on site yet/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /Download the full pack/ }),
    ).toHaveAttribute("href", "https://s3.test/packs/itps/3/v1.pdf")
    await user.click(screen.getByText("Show all 3 lines of this ITP"))
    expect(screen.getAllByTestId("sign-line")).toHaveLength(3)

    const submit = screen.getByTestId("sign-submit")
    expect(submit).toBeDisabled()
    await user.type(screen.getByTestId("signer-name"), "Morgan Reyes")
    await user.click(screen.getByText("draw signature"))
    expect(submit).toBeDisabled()
    await user.click(screen.getByTestId("sign-confirm"))
    await user.click(screen.getByLabelText(/Add my location/))
    await user.click(submit)

    expect(await screen.findByTestId("sign-done")).toHaveTextContent(
      "You signed 1 line",
    )
    expect(screen.getByTestId("sign-done")).toHaveTextContent(
      "Clear sky, 60 °F, wind 4 mph",
    )
    expect(screen.getByTestId("sign-done")).toHaveTextContent(
      "1 more line needs your signature",
    )
    expect(api.submitSignature).toHaveBeenCalledWith({
      path: { token: "tok-123" },
      body: {
        signer_name: "Morgan Reyes",
        signature_png: "data:image/png;base64,iVBORw0KGgo=",
        confirm: true,
        gps_lat: null,
        gps_lng: null,
      },
    })
  })

  it("explains a link that no longer works", async () => {
    api.openSigningLink.mockRejectedValue(
      new AxiosError("gone", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 410,
        statusText: "Gone",
        data: { detail: "This signing link has already been used." },
        headers: {},
        config: {} as never,
      }),
    )
    renderAt("/sign/used")
    const gone = await screen.findByTestId("sign-gone")
    expect(gone).toHaveTextContent("This link no longer works")
    expect(gone).toHaveTextContent("already been used")
  })

  it("says when nothing is ready yet and shows a refusal", async () => {
    api.openSigningLink.mockResolvedValue({
      data: session({ ready_count: 0 }),
    })
    renderAt("/sign/early")
    expect(await screen.findByTestId("sign-nothing-ready")).toBeInTheDocument()
    expect(screen.queryByTestId("sign-form")).toBeNull()
  })

  it("shows the API's reason when signing is refused", async () => {
    api.openSigningLink.mockResolvedValue({ data: session() })
    api.submitSignature.mockRejectedValue(
      new AxiosError("no", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 409,
        statusText: "Conflict",
        data: { detail: "Nothing is ready for your signature yet." },
        headers: {},
        config: {} as never,
      }),
    )
    const user = userEvent.setup()
    renderAt("/sign/tok")
    await user.type(await screen.findByTestId("signer-name"), "M")
    await user.click(screen.getByText("draw signature"))
    await user.click(screen.getByTestId("sign-confirm"))
    await user.click(screen.getByLabelText(/Add my location/))
    await user.click(screen.getByTestId("sign-submit"))
    await waitFor(() =>
      expect(screen.getByTestId("sign-error")).toHaveTextContent(
        "Nothing is ready",
      ),
    )
  })
})
