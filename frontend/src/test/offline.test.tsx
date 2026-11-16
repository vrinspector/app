import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

import type { FindingPublic, PinPublic } from "@/client"
import { SyncIndicator } from "@/components/Common/SyncIndicator"
import { PinMarker } from "@/components/Drawings/PinOverlay"
import { PinStatusDialog } from "@/components/Drawings/PinStatusDialog"
import { FindingCard } from "@/components/Findings/FindingCard"
import { FindingFormDialog } from "@/components/Findings/FindingFormDialog"
import { Toaster } from "@/components/ui/sonner"
import type { AuditEntry } from "@/lib/sync/audit"
import {
  DEFAULT_SYNC_CONTEXT,
  SyncContext,
  type SyncContextValue,
} from "@/lib/sync/context"
import { IDLE_SNAPSHOT, type SyncSnapshot } from "@/lib/sync/status"

/*
 * Increment 19 (PRD v2.63 Block 11 UX): the header's sync chip and panel
 * (manual sync, sync history), the "not uploaded yet" markers on findings and
 * pins, and saving a finding / a pin on the device when there is no
 * connection. The sync state is injected through SyncContext, so no PowerSync
 * code runs here (its own pieces are unit-tested in lib/sync).
 */

const api = vi.hoisted(() => ({
  createFinding: vi.fn(),
  updateFinding: vi.fn(),
  createPin: vi.fn(),
}))

vi.mock("@/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client")>()
  return {
    ...actual,
    FindingsService: {
      ...actual.FindingsService,
      createFinding: api.createFinding,
      updateFinding: api.updateFinding,
    },
    DrawingsService: { ...actual.DrawingsService, createPin: api.createPin },
  }
})

function snapshot(overrides: Partial<SyncSnapshot>): SyncSnapshot {
  return { ...IDLE_SNAPSHOT, enabled: true, ready: true, ...overrides }
}

function withSync(value: Partial<SyncContextValue>, children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <SyncContext.Provider value={{ ...DEFAULT_SYNC_CONTEXT, ...value }}>
        {children}
        <Toaster />
      </SyncContext.Provider>
    </QueryClientProvider>
  )
}

const history: AuditEntry[] = [
  {
    id: "1",
    outcome: "overwrote",
    what: "Edited finding “Crack at C4”",
    madeAt: "2026-11-14T09:30:00Z",
    uploadedAt: "2026-11-14T10:05:00Z",
    result: "Uploaded. … (last change wins).",
    replaced: [{ field: "Title", value: "Crack (sealed)" }],
  },
  {
    id: "2",
    outcome: "refused",
    what: "Logged finding “Late note”",
    madeAt: "2026-11-14T09:40:00Z",
    uploadedAt: "2026-11-14T10:05:00Z",
    result: "Not accepted by the server: Inspection is signed off.",
    replaced: [],
  },
]

describe("sync chip", () => {
  it("stays out of the way online when offline saving is off", () => {
    render(withSync({}, <SyncIndicator />))
    expect(screen.queryByTestId("sync-indicator")).toBeNull()
  })

  it("says offline even when offline saving is off", async () => {
    render(
      withSync(
        { snapshot: { ...IDLE_SNAPSHOT, online: false } },
        <SyncIndicator />,
      ),
    )
    const chip = screen.getByTestId("sync-indicator")
    expect(chip).toHaveAttribute("data-tone", "offline")
    await userEvent.click(chip)
    expect(screen.getByTestId("sync-panel")).toHaveTextContent(
      "not switched on for this app yet",
    )
    expect(screen.queryByTestId("sync-now")).toBeNull()
  })

  it("counts waiting changes and flags history that needs a look", () => {
    render(
      withSync(
        { snapshot: snapshot({ pending: 3, refused: 1, overwritten: 1 }) },
        <SyncIndicator />,
      ),
    )
    expect(screen.getByTestId("sync-indicator-label")).toHaveTextContent(
      "3 waiting",
    )
    expect(screen.getByTestId("sync-attention-count")).toHaveTextContent("2")
  })

  it("opens the panel with Sync now and the sync history", async () => {
    const syncNow = vi.fn(async () => {})
    const loadHistory = vi.fn(async () => history)
    const clearHistory = vi.fn(async () => {})
    render(
      withSync(
        {
          snapshot: snapshot({
            pending: 1,
            lastSyncedAt: "2026-11-14T10:05:00Z",
            connected: true,
          }),
          syncNow,
          loadHistory,
          clearHistory,
        },
        <SyncIndicator />,
      ),
    )
    await userEvent.click(screen.getByTestId("sync-indicator"))
    const panel = screen.getByTestId("sync-panel")
    expect(within(panel).getByTestId("sync-pending")).toHaveTextContent(
      "1 change",
    )
    const entries = await within(panel).findAllByTestId("sync-history-entry")
    expect(entries.map((e) => e.getAttribute("data-outcome"))).toEqual([
      "overwrote",
      "refused",
    ])
    expect(
      within(entries[0]).getByTestId("sync-history-replaced"),
    ).toHaveTextContent("Title: Crack (sealed)")

    await userEvent.click(within(panel).getByTestId("sync-now"))
    expect(syncNow).toHaveBeenCalledTimes(1)

    await userEvent.click(within(panel).getByTestId("sync-history-clear"))
    expect(clearHistory).toHaveBeenCalledTimes(1)
  })

  it("disables Sync now without a connection", async () => {
    render(
      withSync(
        { snapshot: snapshot({ online: false, pending: 2 }) },
        <SyncIndicator />,
      ),
    )
    expect(screen.getByTestId("sync-indicator-label")).toHaveTextContent(
      "Offline · 2 waiting",
    )
    await userEvent.click(screen.getByTestId("sync-indicator"))
    expect(screen.getByTestId("sync-now")).toBeDisabled()
  })
})

const finding: FindingPublic = {
  id: 42,
  public_id: "f-42",
  inspection_id: 7,
  title: "Crack at C4",
  description: null,
  priority: "high",
  location_ref: null,
  status: "open",
  resolved_by: null,
  resolved_at: null,
  resolution_notes: null,
  created_at: "2026-11-14T09:00:00Z",
  updated_at: "2026-11-14T09:00:00Z",
}

describe("unsynced markers", () => {
  it("marks a finding that has not uploaded and hides its actions", () => {
    render(
      withSync(
        {},
        <FindingCard
          finding={finding}
          readOnly
          unsynced
          onResolve={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
      ),
    )
    const card = screen.getByTestId("finding-card")
    expect(card).toHaveAttribute("data-unsynced", "true")
    expect(screen.getByTestId("finding-unsynced")).toHaveTextContent(
      "Not uploaded yet",
    )
    expect(screen.queryByTestId("finding-actions")).toBeNull()
  })

  it("marks a pin that has not uploaded", () => {
    const pin: PinPublic = {
      id: -5,
      public_id: "local-p",
      drawing_id: 3,
      finding_id: null,
      tag_number: null,
      label: null,
      x_pct: 10,
      y_pct: 20,
      status: "issue",
      notes: null,
      discipline_data: null,
      page_number: 1,
      created_by: null,
      created_at: "2026-11-14T09:00:00Z",
    }
    render(
      <PinMarker
        pin={pin}
        label="4"
        selected={false}
        unsynced
        onSelect={vi.fn()}
      />,
    )
    const marker = screen.getByTestId("pin-marker")
    expect(marker).toHaveAttribute("data-unsynced", "true")
    expect(marker.getAttribute("aria-label")).toMatch(/not uploaded yet$/)
    expect(screen.getByTestId("pin-unsynced-badge")).toBeInTheDocument()
  })
})

function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = []
  return {
    calls,
    db: {
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params })
        return { rowsAffected: 1 }
      }),
    } as unknown as SyncContextValue["db"],
  }
}

describe("saving without a connection", () => {
  it("logs a finding on the device instead of calling the API", async () => {
    const { db, calls } = fakeDb()
    const onOpenChange = vi.fn()
    render(
      withSync(
        { db, saveLocally: true, snapshot: snapshot({ online: false }) },
        <FindingFormDialog open onOpenChange={onOpenChange} inspectionId={7} />,
      ),
    )
    await userEvent.type(screen.getByLabelText("Title"), "Loose handrail")
    await userEvent.click(screen.getByTestId("finding-form-submit"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.createFinding).not.toHaveBeenCalled()
    expect(calls[0].sql).toMatch(/^INSERT INTO findings/)
    expect(calls[0].params[1]).toBe("7")
    expect(calls[0].params[2]).toBe("Loose handrail")
    expect(await screen.findByText(/Saved on this device/)).toBeInTheDocument()
  })

  it("edits a finding on the device", async () => {
    const { db, calls } = fakeDb()
    const onOpenChange = vi.fn()
    render(
      withSync(
        { db, saveLocally: true },
        <FindingFormDialog
          open
          onOpenChange={onOpenChange}
          inspectionId={7}
          finding={finding}
        />,
      ),
    )
    const title = screen.getByLabelText("Title")
    await userEvent.clear(title)
    await userEvent.type(title, "Crack at C4 (wider)")
    await userEvent.click(screen.getByTestId("finding-form-submit"))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(api.updateFinding).not.toHaveBeenCalled()
    expect(calls[0].sql).toMatch(/^UPDATE findings SET title = \?/)
    expect(calls[0].params[calls[0].params.length - 1]).toBe("42")
  })

  it("still uses the API when there is a connection", async () => {
    const { db, calls } = fakeDb()
    api.createFinding.mockResolvedValueOnce({ data: { ...finding, id: 50 } })
    const onOpenChange = vi.fn()
    render(
      withSync(
        { db, saveLocally: false },
        <FindingFormDialog open onOpenChange={onOpenChange} inspectionId={7} />,
      ),
    )
    await userEvent.type(screen.getByLabelText("Title"), "Online finding")
    await userEvent.click(screen.getByTestId("finding-form-submit"))
    await waitFor(() => expect(api.createFinding).toHaveBeenCalledTimes(1))
    expect(calls).toEqual([])
  })

  it("places a pin on the device and does not open the finding form", async () => {
    const { db, calls } = fakeDb()
    const onPlaced = vi.fn()
    const onClose = vi.fn()
    render(
      withSync(
        { db, saveLocally: true },
        <PinStatusDialog
          drawingId={3}
          point={{ x_pct: 25, y_pct: 50 }}
          pageNumber={2}
          isPdf
          onClose={onClose}
          onPlaced={onPlaced}
        />,
      ),
    )
    await userEvent.click(screen.getByTestId("pin-status-punch_item"))
    await waitFor(() => expect(onPlaced).toHaveBeenCalledTimes(1))
    expect(api.createPin).not.toHaveBeenCalled()
    expect(calls[0].sql).toMatch(/^INSERT INTO inspection_pins/)
    expect(onPlaced.mock.calls[0][1]).toEqual({ logFinding: false })
    expect(onPlaced.mock.calls[0][0]).toMatchObject({
      drawing_id: 3,
      x_pct: 25,
      y_pct: 50,
      page_number: 2,
    })
  })
})
