import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FindingPublic } from "@/client"
import { SyncIndicator } from "@/components/Common/SyncIndicator"
import { FindingCard } from "@/components/Findings/FindingCard"
import { Toaster } from "@/components/ui/sonner"
import { photoQueue } from "@/lib/photoQueue"
import { memoryPhotoStore } from "@/lib/photoQueue/store"
import {
  DEFAULT_SYNC_CONTEXT,
  SyncContext,
  type SyncContextValue,
} from "@/lib/sync/context"

/*
 * Increment 20 (PRD v2.63 Block 11, issue #39): photos taken with no signal
 * are kept on the device, shown on their parent marked "Not uploaded yet",
 * counted in the sync chip and panel, and a refused photo stays with its
 * reason, a Retry and an explicit Delete — never dropped silently.
 */

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    isLoading: false,
    user: { sub: "auth0|stacey", name: "Stacey", email: "s@example.com" },
    error: undefined,
    getAccessTokenSilently: async () => "token",
    loginWithRedirect: async () => undefined,
    logout: async () => undefined,
  }),
}))

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => value,
  })
}

function withSync(children: ReactNode, value: Partial<SyncContextValue> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
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

const handlers = {
  onResolve: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
}

function photo(name = "crack.jpg") {
  return new File(["jpeg"], name, {
    type: "image/jpeg",
    lastModified: Date.parse("2026-11-16T08:15:00Z"),
  })
}

let store = memoryPhotoStore()

beforeEach(() => {
  store = memoryPhotoStore()
  photoQueue.useStore(store)
})

afterEach(() => {
  setOnline(true)
})

describe("Add photo on a finding without signal", () => {
  it("keeps the photo on the device and shows it on the finding", async () => {
    setOnline(false)
    render(
      withSync(
        <FindingCard
          finding={finding}
          readOnly={false}
          canAddPhoto
          {...handlers}
        />,
      ),
    )
    await userEvent.upload(screen.getByTestId("finding-photo-input"), photo())

    const tile = await screen.findByTestId("queued-photo")
    expect(tile).toHaveAttribute("data-status", "waiting")
    expect(within(tile).getByRole("img")).toHaveAccessibleName(
      "crack.jpg: Not uploaded yet",
    )
    expect(await screen.findByText(/photo kept on this device/i)).toBeVisible()

    const [item] = photoQueue.getSnapshot().items
    expect(item).toMatchObject({
      target: { kind: "finding", inspectionId: "7", findingId: "42" },
      description: "Photo for finding “Crack at C4”",
      uploadedBy: "Stacey",
      capturedAt: "2026-11-16T08:15:00.000Z",
      status: "waiting",
    })
    // The original file, byte for byte.
    expect(await (await photoQueue.file(item.id))?.text()).toBe("jpeg")
  })

  it("lets a finding saved offline take a photo under its local id", async () => {
    setOnline(false)
    const local: FindingPublic = {
      ...finding,
      id: -12345,
      public_id: "local-0b7e",
    }
    render(
      withSync(
        <FindingCard
          finding={local}
          readOnly
          unsynced
          canAddPhoto
          {...handlers}
        />,
      ),
    )
    // Its other actions stay hidden until it has uploaded.
    expect(screen.queryByTestId("finding-actions")).not.toBeInTheDocument()
    await userEvent.upload(screen.getByTestId("finding-photo-input"), photo())
    await screen.findByTestId("queued-photo")
    expect(photoQueue.getSnapshot().items[0].target).toEqual({
      kind: "finding",
      inspectionId: "7",
      findingId: "local-0b7e",
    })
  })

  it("offers no Add photo to viewers", () => {
    render(withSync(<FindingCard finding={finding} readOnly {...handlers} />))
    expect(screen.queryByTestId("finding-add-photo")).not.toBeInTheDocument()
  })
})

describe("photos in the sync chip and panel", () => {
  async function queue(
    name: string,
    target = { kind: "inspection" as const, inspectionId: "7" },
  ) {
    const file = photo(name)
    return photoQueue.enqueue({
      file,
      target,
      description: `Site photo for “Level 3 pour” (${name})`,
      uploadedBy: "Stacey",
      filename: file.name,
      contentType: file.type,
      capturedAt: null,
    })
  }

  it("counts waiting photos in the chip even when offline saving is off", async () => {
    await queue("a.jpg")
    await queue("b.jpg")
    render(
      withSync(<SyncIndicator />, {
        snapshot: { ...DEFAULT_SYNC_CONTEXT.snapshot, online: false },
      }),
    )
    expect(await screen.findByTestId("sync-indicator-label")).toHaveTextContent(
      "Offline · 2 waiting",
    )
  })

  it("lists a refused photo with its reason, Retry and Delete from device", async () => {
    const refused = await queue("late.jpg")
    await store.patch(refused, {
      status: "failed",
      error: "Inspection is signed off",
    })
    await photoQueue.refresh()
    await queue("ok.jpg")

    render(withSync(<SyncIndicator />))
    // One photo needs a look: the red count on the chip.
    expect(await screen.findByTestId("sync-attention-count")).toHaveTextContent(
      "1",
    )
    await userEvent.click(screen.getByTestId("sync-indicator"))
    const rows = await screen.findAllByTestId("sync-photo")
    expect(rows).toHaveLength(2)
    const failed = rows.find((row) => row.dataset.status === "failed")
    if (!failed) throw new Error("no failed row")
    expect(within(failed).getByTestId("sync-photo-state")).toHaveTextContent(
      "Not accepted by the server: Inspection is signed off",
    )

    // Retry puts it back in line.
    await userEvent.click(within(failed).getByTestId("sync-photo-retry"))
    await waitFor(() => expect(photoQueue.getSnapshot().failed).toBe(0))

    // Deleting is explicit and confirmed.
    await store.patch(refused, { status: "failed", error: "No" })
    await photoQueue.refresh()
    const again = (await screen.findAllByTestId("sync-photo")).find(
      (row) => row.dataset.status === "failed",
    )
    if (!again) throw new Error("no failed row")
    await userEvent.click(within(again).getByTestId("sync-photo-delete"))
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete photo" }),
    )
    await waitFor(() => expect(photoQueue.getSnapshot().items).toHaveLength(1))
  })

  it("warns when the device is getting full", async () => {
    const estimate = vi.fn(async () => ({
      quota: 1000 * 1024 * 1024,
      usage: 900 * 1024 * 1024,
    }))
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: { estimate },
    })
    await queue("a.jpg")
    render(withSync(<SyncIndicator />))
    await userEvent.click(await screen.findByTestId("sync-indicator"))
    const warning = await screen.findByTestId("sync-storage-warning")
    expect(warning).toHaveAttribute("data-level", "low")
    expect(warning).toHaveTextContent(/getting full: about 100 MB left/)
    Object.defineProperty(window.navigator, "storage", {
      configurable: true,
      value: undefined,
    })
  })
})
