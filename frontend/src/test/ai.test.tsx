import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { FindingCard } from "@/components/Findings/FindingCard"
import { FindingFormDialog } from "@/components/Findings/FindingFormDialog"
import { PhotoFilingPanel } from "@/components/Photos/PhotoFilingPanel"
import { demoVoiceDraft } from "@/demo/fakeAi"
import { findingSeedFromPhotoDraft } from "@/lib/ai"

/*
 * Increment 15 — AI capture assistance (Block 10A photo analysis, 10B
 * voice-to-finding). The guardrail under test throughout: an AI answer only
 * fills the form as a draft, nothing is saved until the inspector's own
 * Save, and that save carries the draft's id.
 */

const api = vi.hoisted(() => ({
  readStatus: vi.fn(),
  voiceFinding: vi.fn(),
  analyzePhoto: vi.fn(),
  dismissSuggestion: vi.fn(),
  listSuggestions: vi.fn(),
  createFinding: vi.fn(),
  updateFinding: vi.fn(),
  filePhoto: vi.fn(),
  setFindingStatus: vi.fn(),
}))

vi.mock("@/client", () => ({
  AiService: {
    readStatus: api.readStatus,
    voiceFinding: api.voiceFinding,
    analyzePhoto: api.analyzePhoto,
    dismissSuggestion: api.dismissSuggestion,
    listSuggestions: api.listSuggestions,
  },
  FindingsService: {
    createFinding: api.createFinding,
    updateFinding: api.updateFinding,
    setFindingStatus: api.setFindingStatus,
  },
  PhotosService: { filePhoto: api.filePhoto },
}))

const ok = <T,>(data: T) => ({ data })

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  )
}

const voiceSuggestion = {
  id: 41,
  kind: "voice",
  status: "draft",
  project_id: 7,
  inspection_id: 21,
  photo_id: null,
  model: "claude-sonnet-4-5-20250929",
  prompt_version: "10B-2026-11-12",
  draft: {
    title: "Missing flange bolts at V-101",
    status: "open",
    priority: "high",
    discipline: "pid",
    description: "Two of eight flange bolts are missing at valve V-101.",
    location_ref: "Gridline C-4",
  },
  edited: null,
  requested_by: "stacey@example.com",
  decided_by: null,
  decided_at: null,
  created_at: "2026-11-12T08:00:00Z",
}

const photo = {
  id: 301,
  public_id: "p_301",
  inspection_id: 21,
  itp_item_id: null,
  finding_id: null,
  s3_key: "photos/inspections/21/a.jpg",
  filename: "base-plate.jpg",
  content_type: "image/jpeg",
  uploaded_by: "stacey@example.com",
  created_at: "2026-11-12T08:00:00Z",
  category: null,
  defect_tags: null,
  severity: null,
  tags_confirmed_by: null,
  tags_confirmed_at: null,
  ai_suggestion_id: null,
  view_url: "https://files.example.com/a.jpg",
}

const photoSuggestion = {
  ...voiceSuggestion,
  id: 52,
  kind: "photo",
  photo_id: 301,
  prompt_version: "10A-2026-11-12",
  draft: {
    category: "defect",
    defects: [
      { type: "corrosion", note: "Rust on base plate", confidence: 0.82 },
    ],
    severity: "medium",
    title: "Corrosion at column base plate",
    description: "Surface rust on the base plate.",
  },
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.readStatus.mockResolvedValue(
    ok({
      enabled: true,
      model: "claude-sonnet-4-5",
      daily_limit: 200,
      used_today: 0,
    }),
  )
  api.dismissSuggestion.mockResolvedValue(ok({}))
})

describe("voice-to-finding (10B)", () => {
  it("drafts from the note, shows it as a draft, and saves with the draft id", async () => {
    const user = userEvent.setup()
    api.voiceFinding.mockResolvedValue(ok(voiceSuggestion))
    api.createFinding.mockImplementation(async ({ body }) =>
      ok({ id: 900, ...body }),
    )
    wrap(<FindingFormDialog open onOpenChange={() => {}} inspectionId={21} />)
    const dialog = await screen.findByTestId("finding-form-dialog")
    const draftButton = await within(dialog).findByTestId("ai-draft-button")
    expect(draftButton).toBeDisabled() // nothing to draft from yet

    await user.type(
      within(dialog).getByPlaceholderText("Describe the issue…"),
      "valve v 101 two of eight flange bolts missing gridline c4",
    )
    await user.click(draftButton)

    await waitFor(() =>
      expect(api.voiceFinding).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          transcript:
            "valve v 101 two of eight flange bolts missing gridline c4",
          location_ref: null,
        },
      }),
    )
    expect(
      await within(dialog).findByTestId("ai-draft-notice"),
    ).toHaveTextContent("AI draft — check every field")
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Missing flange bolts at V-101",
    )
    expect(within(dialog).getByLabelText("Priority")).toHaveValue("high")
    expect(within(dialog).getByTestId("finding-discipline")).toHaveValue("pid")
    // Not saved by itself.
    expect(api.createFinding).not.toHaveBeenCalled()

    await user.click(within(dialog).getByTestId("finding-form-submit"))
    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          title: "Missing flange bolts at V-101",
          description: "Two of eight flange bolts are missing at valve V-101.",
          priority: "high",
          location_ref: "Gridline C-4",
          discipline: "pid",
          status: "open",
          ai_suggestion_id: 41,
        },
      }),
    )
  })

  it("Undo puts the inspector's own words back and sets the draft aside", async () => {
    const user = userEvent.setup()
    api.voiceFinding.mockResolvedValue(ok(voiceSuggestion))
    wrap(<FindingFormDialog open onOpenChange={() => {}} inspectionId={21} />)
    const dialog = await screen.findByTestId("finding-form-dialog")
    await user.type(within(dialog).getByLabelText("Title"), "My title")
    await user.type(
      within(dialog).getByPlaceholderText("Describe the issue…"),
      "bolts missing",
    )
    await user.click(await within(dialog).findByTestId("ai-draft-button"))
    await within(dialog).findByTestId("ai-draft-notice")
    await user.click(within(dialog).getByTestId("ai-draft-undo"))

    expect(within(dialog).getByLabelText("Title")).toHaveValue("My title")
    expect(
      within(dialog).getByPlaceholderText("Describe the issue…"),
    ).toHaveValue("bolts missing")
    expect(within(dialog).queryByTestId("ai-draft-notice")).toBeNull()
    expect(api.dismissSuggestion).toHaveBeenCalledWith({
      path: { suggestion_id: 41 },
    })
  })

  it("hides the AI button when AI is switched off and keeps the legacy body", async () => {
    const user = userEvent.setup()
    api.readStatus.mockResolvedValue(
      ok({ enabled: false, model: null, daily_limit: 200, used_today: 0 }),
    )
    api.createFinding.mockImplementation(async ({ body }) =>
      ok({ id: 901, ...body }),
    )
    wrap(<FindingFormDialog open onOpenChange={() => {}} inspectionId={21} />)
    const dialog = await screen.findByTestId("finding-form-dialog")
    await waitFor(() => expect(api.readStatus).toHaveBeenCalled())
    expect(within(dialog).queryByTestId("ai-draft-button")).toBeNull()
    await user.type(within(dialog).getByLabelText("Title"), "Loose handrail")
    await user.click(within(dialog).getByTestId("finding-form-submit"))
    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          title: "Loose handrail",
          description: null,
          priority: "medium",
          location_ref: null,
          status: "open",
        },
      }),
    )
  })
})

describe("photo analysis (10A)", () => {
  it("analyses, lets the inspector edit, and files the photo with the draft id", async () => {
    const user = userEvent.setup()
    api.analyzePhoto.mockResolvedValue(ok(photoSuggestion))
    api.filePhoto.mockImplementation(async ({ body }) =>
      ok({ ...photo, ...body }),
    )
    wrap(<PhotoFilingPanel photo={photo} canWrite />)

    expect(screen.getByText("Not filed yet.")).toBeInTheDocument()
    await user.click(await screen.findByTestId("photo-analyse"))
    expect(api.analyzePhoto).toHaveBeenCalledWith({ body: { photo_id: 301 } })
    expect(await screen.findByTestId("photo-ai-draft")).toHaveTextContent(
      "AI draft",
    )
    expect(screen.getByTestId("photo-category")).toHaveValue("defect")
    expect(screen.getByTestId("photo-defect-corrosion")).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByText(/Rust on base plate/)).toBeInTheDocument()
    expect(api.filePhoto).not.toHaveBeenCalled()

    // The inspector adds a crack and raises the severity.
    await user.click(screen.getByTestId("photo-defect-crack"))
    await user.selectOptions(screen.getByTestId("photo-severity"), "high")
    await user.click(screen.getByTestId("photo-filing-save"))
    await waitFor(() =>
      expect(api.filePhoto).toHaveBeenCalledWith({
        path: { photo_id: 301 },
        body: {
          category: "defect",
          defect_tags: ["corrosion", "crack"],
          severity: "high",
          ai_suggestion_id: 52,
        },
      }),
    )
  })

  it("files by hand without AI and is read only for viewers", async () => {
    const user = userEvent.setup()
    api.readStatus.mockResolvedValue(
      ok({ enabled: false, model: null, daily_limit: 200, used_today: 0 }),
    )
    api.filePhoto.mockImplementation(async ({ body }) =>
      ok({ ...photo, ...body }),
    )
    const { unmount } = wrap(<PhotoFilingPanel photo={photo} canWrite />)
    await waitFor(() => expect(api.readStatus).toHaveBeenCalled())
    expect(screen.queryByTestId("photo-analyse")).toBeNull()
    await user.click(screen.getByTestId("photo-file"))
    await user.selectOptions(screen.getByTestId("photo-category"), "progress")
    await user.click(screen.getByTestId("photo-filing-save"))
    await waitFor(() =>
      expect(api.filePhoto).toHaveBeenCalledWith({
        path: { photo_id: 301 },
        body: {
          category: "progress",
          defect_tags: [],
          severity: null,
          ai_suggestion_id: null,
        },
      }),
    )
    unmount()

    wrap(
      <PhotoFilingPanel
        photo={{
          ...photo,
          category: "defect",
          defect_tags: ["water_ingress"],
          severity: "medium",
          ai_suggestion_id: 52,
        }}
        canWrite={false}
      />,
    )
    expect(screen.getByText("Defect")).toBeInTheDocument()
    expect(screen.getByText("Water ingress")).toBeInTheDocument()
    expect(screen.getByText("AI-assisted")).toBeInTheDocument()
    expect(screen.queryByTestId("photo-file")).toBeNull()
  })

  it("Log as finding opens the form pre-filled from the photo draft", async () => {
    const user = userEvent.setup()
    api.analyzePhoto.mockResolvedValue(ok(photoSuggestion))
    api.createFinding.mockImplementation(async ({ body }) =>
      ok({ id: 902, ...body }),
    )
    wrap(<PhotoFilingPanel photo={photo} canWrite />)
    await user.click(await screen.findByTestId("photo-analyse"))
    await user.click(await screen.findByTestId("photo-log-finding"))
    const dialog = await screen.findByTestId("finding-form-dialog")
    expect(within(dialog).getByLabelText("Title")).toHaveValue(
      "Corrosion at column base plate",
    )
    expect(within(dialog).getByTestId("ai-draft-notice")).toBeInTheDocument()
    await user.click(within(dialog).getByTestId("finding-form-submit"))
    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith({
        body: {
          inspection_id: 21,
          title: "Corrosion at column base plate",
          description: "Surface rust on the base plate.",
          priority: "medium",
          location_ref: null,
          status: "open",
          ai_suggestion_id: 52,
        },
      }),
    )
  })
})

describe("finding card provenance", () => {
  it("marks an AI-assisted finding and says how it was drafted", async () => {
    const user = userEvent.setup()
    api.listSuggestions.mockResolvedValue(
      ok([
        {
          ...voiceSuggestion,
          status: "confirmed",
          edited: true,
          decided_by: "stacey@example.com",
          system_prompt: "s",
          user_prompt: "u",
          input_text: "valve v 101 bolts missing",
          error: null,
          input_tokens: 10,
          output_tokens: 5,
          finding_id: 900,
        },
      ]),
    )
    wrap(
      <FindingCard
        finding={{
          id: 900,
          public_id: "f_900",
          inspection_id: 21,
          title: "Missing flange bolts at V-101",
          description: "Two of eight bolts missing.",
          priority: "high",
          location_ref: null,
          status: "open",
          resolved_by: null,
          resolved_at: null,
          resolution_notes: null,
          discipline: "pid",
          ai_suggestion_id: 41,
          created_at: "2026-11-12T08:00:00Z",
          updated_at: "2026-11-12T08:00:00Z",
        }}
        readOnly
        onResolve={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
      />,
    )
    expect(screen.getByTestId("finding-ai-assisted")).toBeInTheDocument()
    expect(screen.getByTestId("finding-discipline")).toHaveTextContent("P&ID")
    await user.click(screen.getByTestId("finding-toggle"))
    const provenance = await screen.findByTestId("finding-ai-provenance")
    expect(provenance).toHaveTextContent("edited before saving")
    expect(provenance).toHaveTextContent("claude-sonnet-4-5-20250929")
    expect(provenance).toHaveTextContent("10B-2026-11-12")
    expect(provenance).toHaveTextContent("valve v 101 bolts missing")
    expect(api.listSuggestions).toHaveBeenCalledWith({
      query: { finding_id: 900 },
    })
  })
})

describe("helpers", () => {
  it("maps a photo draft to finding fields", () => {
    expect(
      findingSeedFromPhotoDraft(5, {
        category: "progress",
        defects: [],
        severity: null,
        title: "",
        description: "",
      }),
    ).toEqual({
      suggestionId: 5,
      title: "",
      description: "",
      priority: "medium",
    })
  })

  it("the demo's stand-in reads a dictated note", () => {
    const draft = demoVoiceDraft(
      "two flange bolts missing at valve v101 gridline c4. crew notified",
      null,
    )
    expect(draft).toMatchObject({
      title: "Two flange bolts missing at valve v101 gridline c4",
      priority: "high",
      discipline: "pid",
      status: "open",
      location_ref: "Gridline c4",
    })
    expect(
      demoVoiceDraft("handrail touch-up paint. fixed by crew", "Level 2"),
    ).toMatchObject({
      priority: "low",
      status: "resolved",
      location_ref: "Level 2",
    })
  })
})
