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

import { Toaster } from "@/components/ui/sonner"
import { routeTree } from "@/routeTree.gen"

/*
 * The members panel on the project screen and the reports section on the
 * inspection screen (increment 10), rendered through the real route tree
 * with the Auth0 SDK and the generated client replaced. Request bodies are
 * the legacy SPA's (`submitInvite`, `removeMember`, `generateReport`).
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
  inviteMember: vi.fn(),
  removeMember: vi.fn(),
  listInspections: vi.fn(),
  readInspection: vi.fn(),
  listDrawings: vi.fn(),
  listFindings: vi.fn(),
  listPhotos: vi.fn(),
  listReports: vi.fn(),
  generateReport: vi.fn(),
  listProjectEmails: vi.fn(),
  resendMemberInvite: vi.fn(),
  readStatus: vi.fn(),
  reportDraft: vi.fn(),
  dismissSuggestion: vi.fn(),
}))

vi.mock("@/client", () => ({
  UsersService: { readUserMe: api.readUserMe },
  ProjectsService: {
    readProject: api.readProject,
    listMembers: api.listMembers,
    inviteMember: api.inviteMember,
    removeMember: api.removeMember,
  },
  InspectionsService: {
    listInspections: api.listInspections,
    readInspection: api.readInspection,
  },
  DrawingsService: { listDrawings: api.listDrawings },
  EmailsService: {
    listProjectEmails: api.listProjectEmails,
    resendMemberInvite: api.resendMemberInvite,
  },
  FindingsService: { listFindings: api.listFindings },
  PhotosService: { listPhotos: api.listPhotos },
  ReportsService: {
    listReports: api.listReports,
    generateReport: api.generateReport,
  },
  AiService: {
    readStatus: api.readStatus,
    reportDraft: api.reportDraft,
    dismissSuggestion: api.dismissSuggestion,
  },
  // Weather (increment 10.5) is a silent badge; no reading here.
  WeatherService: { readWeather: async () => ({ data: undefined }) },
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

const inspection = {
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

const member = (
  id: number,
  email: string,
  role: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  public_id: `mem_${id}`,
  project_id: 7,
  email,
  user_email: email,
  user_sub: null as string | null,
  role,
  invited_by: null as string | null,
  created_at: "2026-07-01T12:00:00Z",
  ...extra,
})

const ownerSelf = member(1, "stacey@example.com", "owner", {
  user_sub: "auth0|stacey",
})
const fieldInspector = member(2, "field@example.com", "inspector", {
  invited_by: "stacey@example.com",
})
const viewer = member(3, "viewer@example.com", "viewer")

const report = (version: number, extra: Record<string, unknown> = {}) => ({
  id: 100 + version,
  public_id: `rep_${version}`,
  inspection_id: 21,
  version,
  s3_key: `reports/inspections/21/v${version}-abc.pdf`,
  filename: `Site-Walk-1-Civil-report-v${version}.pdf`,
  file_size: 245_760,
  finding_count: 4,
  photo_count: 12,
  generated_by: "stacey@example.com",
  created_at: `2026-07-0${version + 2}T15:00:00Z`,
  download_url: `https://bucket.s3.test/reports/v${version}.pdf?X-Amz-Signature=fake`,
  ...extra,
})

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
      {/* main.tsx mounts the toaster outside the router; toasts are asserted here. */}
      <Toaster />
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
  api.readProject.mockResolvedValue(ok(project))
  api.listMembers.mockResolvedValue(ok([ownerSelf, fieldInspector, viewer]))
  api.listInspections.mockResolvedValue(ok([inspection]))
  api.readInspection.mockResolvedValue(ok(inspection))
  api.listDrawings.mockResolvedValue(ok([]))
  api.listFindings.mockResolvedValue(ok([]))
  api.listPhotos.mockResolvedValue(ok([]))
  api.listReports.mockResolvedValue(ok([]))
  api.listProjectEmails.mockResolvedValue(ok([]))
  api.readStatus.mockResolvedValue(
    ok({ enabled: false, model: null, daily_limit: 200, used_today: 0 }),
  )
  api.dismissSuggestion.mockResolvedValue(ok({}))
})

const inviteLog = (
  id: number,
  memberId: number,
  status: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  public_id: `eml_${id}`,
  project_id: 7,
  email_type: "member_invite",
  related_id: memberId,
  recipient: "someone@example.com",
  subject: "You've been added to Landfill Gas Project on VR Inspector",
  status,
  error: null as string | null,
  triggered_by: "stacey@example.com",
  created_at: "2026-11-09T12:00:00Z",
  sent_at: status === "sent" ? "2026-11-09T12:00:02Z" : null,
  ...extra,
})

describe("members panel", () => {
  it("lists members with role badges, marks the caller and offers remove on non-owners", async () => {
    renderApp("/projects/7")

    const list = within(await screen.findByTestId("member-list"))
    const rows = list.getAllByTestId("member-row")
    expect(rows).toHaveLength(3)
    expect(screen.getByTestId("members-count")).toHaveTextContent("(3)")

    expect(rows[0]).toHaveTextContent("Owner")
    expect(rows[0]).toHaveTextContent("stacey@example.com (you)")
    expect(rows[0]).toHaveTextContent("Signed in")
    expect(
      within(rows[0]).queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument()

    expect(rows[1]).toHaveTextContent("Inspector")
    expect(rows[1]).toHaveTextContent("has not signed in yet")
    expect(rows[1]).toHaveTextContent("by stacey@example.com")
    expect(
      within(rows[1]).getByRole("button", { name: "Remove field@example.com" }),
    ).toBeInTheDocument()
    expect(rows[2]).toHaveTextContent("Viewer")
  })

  it("invites by email with the legacy body and refreshes the list", async () => {
    api.inviteMember.mockImplementation(async () => {
      api.listMembers.mockResolvedValue(
        ok([
          ownerSelf,
          fieldInspector,
          viewer,
          member(4, "new@example.com", "viewer"),
        ]),
      )
      return ok(member(4, "new@example.com", "viewer"))
    })
    renderApp("/projects/7")
    await screen.findByTestId("member-list")

    const form = within(screen.getByTestId("invite-form"))
    await userEvent.type(form.getByTestId("invite-email"), "New@Example.com")
    await userEvent.selectOptions(form.getByTestId("invite-role"), "viewer")
    await userEvent.click(form.getByTestId("send-invite"))

    await waitFor(() => expect(api.inviteMember).toHaveBeenCalledTimes(1))
    expect(api.inviteMember).toHaveBeenCalledWith({
      path: { project_id: 7 },
      body: { email: "New@Example.com", role: "viewer" },
    })
    await waitFor(() =>
      expect(screen.getAllByTestId("member-row")).toHaveLength(4),
    )
    expect(screen.getByTestId("invite-email")).toHaveValue("")
    expect(screen.getByTestId("invite-role")).toHaveValue("viewer")
  })

  it("validates the email before sending and explains a 409 from the API", async () => {
    api.inviteMember.mockRejectedValue(
      apiError(409, "Member already exists for this project"),
    )
    renderApp("/projects/7")
    await screen.findByTestId("member-list")

    await userEvent.type(screen.getByTestId("invite-email"), "not-an-email")
    await userEvent.click(screen.getByTestId("send-invite"))
    expect(
      await screen.findByText("Enter a valid email address"),
    ).toBeInTheDocument()
    expect(api.inviteMember).not.toHaveBeenCalled()

    await userEvent.clear(screen.getByTestId("invite-email"))
    await userEvent.type(
      screen.getByTestId("invite-email"),
      "field@example.com",
    )
    await userEvent.click(screen.getByTestId("send-invite"))
    await waitFor(() => expect(api.inviteMember).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText("Member already exists for this project"),
    ).toBeInTheDocument()
  })

  it("removes a member after confirmation", async () => {
    api.removeMember.mockImplementation(async () => {
      api.listMembers.mockResolvedValue(ok([ownerSelf, viewer]))
      return ok(undefined)
    })
    renderApp("/projects/7")
    await screen.findByTestId("member-list")

    await userEvent.click(
      screen.getByRole("button", { name: "Remove field@example.com" }),
    )
    const dialog = await screen.findByTestId("confirm-dialog")
    expect(dialog).toHaveTextContent("field@example.com")
    await userEvent.click(within(dialog).getByTestId("confirm-button"))

    await waitFor(() => expect(api.removeMember).toHaveBeenCalledTimes(1))
    expect(api.removeMember).toHaveBeenCalledWith({
      path: { project_id: 7, member_id: 2 },
    })
    await waitFor(() =>
      expect(screen.getAllByTestId("member-row")).toHaveLength(2),
    )
  })

  it("hides invite and remove from inspectors, who still see the list", async () => {
    api.listMembers.mockResolvedValue(
      ok([
        member(1, "owner@example.com", "owner"),
        member(2, "stacey@example.com", "inspector", {
          user_sub: "auth0|stacey",
        }),
        viewer,
      ]),
    )
    renderApp("/projects/7")

    await screen.findByTestId("member-list")
    expect(screen.getAllByTestId("member-row")).toHaveLength(3)
    expect(screen.queryByTestId("invite-form")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Remove / }),
    ).not.toBeInTheDocument()
  })

  it("shows the empty state when the list is empty", async () => {
    api.listMembers.mockResolvedValue(ok([]))
    renderApp("/projects/7")

    await screen.findByTestId("project-details")
    const section = await screen.findByText("No members yet")
    expect(section).toBeInTheDocument()
    // The role is unknown with an empty list, so the invite form stays.
    expect(screen.getByTestId("invite-form")).toBeInTheDocument()
  })
})

describe("invite emails (increment 13.5)", () => {
  it("shows each member's latest invite outcome to the owner", async () => {
    api.listProjectEmails.mockResolvedValue(
      ok([
        // newest first: the inspector's latest invite failed after an earlier send
        inviteLog(3, 2, "failed", { error: "SMTPServerDisconnected: gone" }),
        inviteLog(2, 3, "skipped"),
        inviteLog(1, 2, "sent"),
      ]),
    )
    renderApp("/projects/7")
    await screen.findByTestId("member-list")

    await waitFor(() =>
      expect(screen.getAllByTestId("invite-email-status")).toHaveLength(2),
    )
    expect(api.listProjectEmails).toHaveBeenCalledWith({
      path: { project_id: 7 },
      query: { email_type: "member_invite" },
    })
    const rows = screen.getAllByTestId("member-row")
    expect(within(rows[0]).queryByTestId("invite-email-status")).toBeNull()
    expect(within(rows[0]).queryByTestId("resend-invite")).toBeNull()
    const inspectorStatus = within(rows[1]).getByTestId("invite-email-status")
    expect(inspectorStatus).toHaveTextContent("Invite email failed")
    expect(inspectorStatus).toHaveAttribute(
      "title",
      "SMTPServerDisconnected: gone",
    )
    expect(
      within(rows[2]).getByTestId("invite-email-status"),
    ).toHaveTextContent("email is off on this server")
  })

  it("resends an invite and refreshes the log; explains the cooldown", async () => {
    api.listProjectEmails.mockResolvedValue(ok([inviteLog(1, 2, "failed")]))
    api.resendMemberInvite.mockImplementation(async () => {
      api.listProjectEmails.mockResolvedValue(
        ok([inviteLog(2, 2, "sent"), inviteLog(1, 2, "failed")]),
      )
      return ok(inviteLog(2, 2, "queued"))
    })
    renderApp("/projects/7")
    await screen.findByTestId("member-list")

    await userEvent.click(
      await screen.findByRole("button", {
        name: "Resend invite to field@example.com",
      }),
    )
    await waitFor(() =>
      expect(api.resendMemberInvite).toHaveBeenCalledWith({
        path: { project_id: 7, member_id: 2 },
      }),
    )
    expect(
      await screen.findByText("Invite sent again to field@example.com"),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(screen.getAllByTestId("member-row")[1]).getByTestId(
          "invite-email-status",
        ),
      ).toHaveAttribute("data-status", "sent"),
    )

    api.resendMemberInvite.mockRejectedValue(
      apiError(
        429,
        "An invite was just sent to this member. Try again in a minute.",
      ),
    )
    await userEvent.click(
      screen.getByRole("button", {
        name: "Resend invite to field@example.com",
      }),
    )
    expect(
      await screen.findByText(
        "An invite was just sent to this member. Try again in a minute.",
      ),
    ).toBeInTheDocument()
  })

  it("does not offer resend once the member has signed in", async () => {
    api.listMembers.mockResolvedValue(
      ok([ownerSelf, { ...fieldInspector, user_sub: "auth0|field" }, viewer]),
    )
    renderApp("/projects/7")
    await screen.findByTestId("member-list")
    const rows = screen.getAllByTestId("member-row")
    expect(within(rows[1]).queryByTestId("resend-invite")).toBeNull()
    expect(within(rows[2]).getByTestId("resend-invite")).toBeInTheDocument()
  })

  it("never asks inspectors' sessions for the owner-only email log", async () => {
    api.listMembers.mockResolvedValue(
      ok([
        member(1, "boss@example.com", "owner", { user_sub: "auth0|boss" }),
        member(2, "stacey@example.com", "inspector", {
          user_sub: "auth0|stacey",
        }),
      ]),
    )
    renderApp("/projects/7")
    await screen.findByTestId("member-list")
    expect(screen.queryByTestId("resend-invite")).toBeNull()
    expect(api.listProjectEmails).not.toHaveBeenCalled()
  })
})

describe("reports section", () => {
  it("lists report versions newest first with their details and download links", async () => {
    api.listReports.mockResolvedValue(ok([report(2), report(1)]))
    renderApp("/projects/7/inspections/21")

    const rows = await screen.findAllByTestId("report-row")
    expect(rows).toHaveLength(2)
    expect(screen.getByTestId("reports-count")).toHaveTextContent("(2)")
    expect(rows[0]).toHaveTextContent("Version 2")
    expect(rows[0]).toHaveTextContent("Latest")
    expect(rows[0]).toHaveTextContent("4 findings, 12 photos")
    expect(rows[0]).toHaveTextContent("240 KB")
    expect(rows[0]).toHaveTextContent("stacey@example.com")
    expect(rows[1]).toHaveTextContent("Version 1")
    expect(rows[1]).not.toHaveTextContent("Latest")

    const link = within(rows[0]).getByTestId("download-report")
    expect(link).toHaveAttribute(
      "href",
      "https://bucket.s3.test/reports/v2.pdf?X-Amz-Signature=fake",
    )
    expect(link).toHaveAttribute("download", "Site-Walk-1-Civil-report-v2.pdf")
    expect(link).toHaveAttribute("target", "_blank")
    expect(api.listReports).toHaveBeenCalledWith({
      query: { inspection_id: 21 },
    })
  })

  it("generates a report with the legacy body and shows the new version at the top", async () => {
    api.listReports.mockResolvedValue(ok([report(1)]))
    api.generateReport.mockImplementation(async () => {
      api.listReports.mockResolvedValue(ok([report(2), report(1)]))
      return ok(report(2))
    })
    renderApp("/projects/7/inspections/21")
    await screen.findAllByTestId("report-row")

    await userEvent.click(screen.getByTestId("generate-report"))
    await waitFor(() => expect(api.generateReport).toHaveBeenCalledTimes(1))
    expect(api.generateReport).toHaveBeenCalledWith({
      body: { inspection_id: 21 },
    })

    await waitFor(() =>
      expect(screen.getAllByTestId("report-row")).toHaveLength(2),
    )
    const rows = screen.getAllByTestId("report-row")
    expect(rows[0]).toHaveTextContent("Version 2")
    expect(rows[0]).toHaveTextContent("Latest")
    expect(
      await screen.findByText("Report version 2 is ready to download"),
    ).toBeInTheDocument()
  })

  it("starts from the empty state and explains a failure", async () => {
    api.generateReport.mockRejectedValueOnce(
      apiError(500, "Report rendering failed"),
    )
    renderApp("/projects/7/inspections/21")

    const empty = await screen.findByText("No report yet")
    expect(empty).toBeInTheDocument()
    expect(screen.getByTestId("generate-report")).toBeInTheDocument()

    await userEvent.click(screen.getByTestId("generate-report"))
    expect(
      await screen.findByText("Report rendering failed"),
    ).toBeInTheDocument()
    expect(screen.getByText("No report yet")).toBeInTheDocument()
  })

  it("lets a viewer generate and download reports too", async () => {
    api.listMembers.mockResolvedValue(
      ok([
        member(1, "owner@example.com", "owner"),
        member(3, "stacey@example.com", "viewer", { user_sub: "auth0|stacey" }),
      ]),
    )
    api.listReports.mockResolvedValue(ok([report(1)]))
    renderApp("/projects/7/inspections/21")

    await screen.findAllByTestId("report-row")
    expect(screen.getByTestId("generate-report")).toBeInTheDocument()
    expect(screen.getByTestId("download-report")).toBeInTheDocument()
    // While the write actions for findings stay hidden from a viewer.
    expect(screen.queryByTestId("log-finding")).not.toBeInTheDocument()
  })
})

describe("report summary (increment 16, Block 10C)", () => {
  it("prints a summary the inspector writes, without AI", async () => {
    api.generateReport.mockResolvedValue(
      ok(report(1, { summary: "Walkdown done.", ai_suggestion_id: null })),
    )
    renderApp("/projects/7/inspections/21")
    await screen.findByText("No report yet")
    // AI is off: no draft button.
    expect(screen.queryByTestId("report-ai-draft")).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId("report-add-summary"))
    await userEvent.type(screen.getByTestId("report-summary"), "Walkdown done.")
    await userEvent.click(screen.getByTestId("generate-report"))
    await waitFor(() =>
      expect(api.generateReport).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          summary: "Walkdown done.",
          ai_suggestion_id: null,
        },
      }),
    )
  })

  it("drafts the summary with AI, lets it be edited and sends the draft id", async () => {
    api.readStatus.mockResolvedValue(
      ok({ enabled: true, model: "m", daily_limit: 200, used_today: 0 }),
    )
    api.reportDraft.mockResolvedValue(
      ok({
        id: 55,
        kind: "report",
        status: "draft",
        draft: { summary: "Two findings were recorded." },
      }),
    )
    api.listReports.mockResolvedValue(
      ok([report(1, { summary: "Earlier words.", ai_suggestion_id: 9 })]),
    )
    api.generateReport.mockResolvedValue(ok(report(2)))
    renderApp("/projects/7/inspections/21")

    const preview = await screen.findByTestId("report-summary-preview")
    expect(preview).toHaveTextContent("AI-assisted summary")
    expect(preview).toHaveTextContent("Earlier words.")

    await userEvent.click(await screen.findByTestId("report-ai-draft"))
    await waitFor(() =>
      expect(api.reportDraft).toHaveBeenCalledWith({
        body: { inspection_id: 21 },
      }),
    )
    const box = await screen.findByTestId("report-summary")
    expect(box).toHaveValue("Two findings were recorded.")
    expect(screen.getByTestId("ai-draft-notice")).toHaveTextContent(
      "Generate report",
    )
    await userEvent.type(box, " One is open.")
    await userEvent.click(screen.getByTestId("generate-report"))
    await waitFor(() =>
      expect(api.generateReport).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          summary: "Two findings were recorded. One is open.",
          ai_suggestion_id: 55,
        },
      }),
    )
  })

  it("undo puts the inspector's words back and sets the draft aside", async () => {
    api.readStatus.mockResolvedValue(
      ok({ enabled: true, model: "m", daily_limit: 200, used_today: 0 }),
    )
    api.reportDraft.mockResolvedValue(
      ok({ id: 56, kind: "report", status: "draft", draft: { summary: "AI" } }),
    )
    renderApp("/projects/7/inspections/21")
    await screen.findByText("No report yet")
    await userEvent.click(screen.getByTestId("report-add-summary"))
    await userEvent.type(screen.getByTestId("report-summary"), "Mine")
    await userEvent.click(screen.getByTestId("report-ai-draft"))
    await waitFor(() =>
      expect(screen.getByTestId("report-summary")).toHaveValue("AI"),
    )
    await userEvent.click(screen.getByTestId("ai-draft-undo"))
    expect(screen.getByTestId("report-summary")).toHaveValue("Mine")
    expect(api.dismissSuggestion).toHaveBeenCalledWith({
      path: { suggestion_id: 56 },
    })
  })
})
