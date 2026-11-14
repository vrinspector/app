/**
 * Increment 19: status wording, overlaying waiting rows, local writes and the
 * sync history entries.
 */
import { describe, expect, it } from "vitest"

import type { FindingPublic } from "@/client"

import { toAuditEntry } from "./audit"
import {
  movePinOffline,
  OfflineWriteError,
  parseWriteMetadata,
  placePinOffline,
  saveFindingOffline,
  updateFindingOffline,
} from "./localWrites"
import {
  localFinding,
  localNumericId,
  localPin,
  numericId,
  overlayPending,
} from "./merge"
import {
  describeSyncError,
  IDLE_SNAPSHOT,
  pendingKeysFromCrud,
  rowKey,
  type SyncSnapshot,
  summarizeSync,
} from "./status"
import { isLocalId } from "./upload"

function snap(overrides: Partial<SyncSnapshot>): SyncSnapshot {
  return { ...IDLE_SNAPSHOT, enabled: true, ready: true, ...overrides }
}

describe("pendingKeysFromCrud", () => {
  it("reads table and id from PowerSync's queue entries", () => {
    const keys = pendingKeysFromCrud([
      { data: JSON.stringify({ op: "PATCH", type: "findings", id: "42" }) },
      {
        data: JSON.stringify({
          op: "PUT",
          type: "inspection_pins",
          id: "local-1",
        }),
      },
      { data: "not json" },
      { data: null },
    ])
    expect([...keys].sort()).toEqual(["findings:42", "inspection_pins:local-1"])
  })
})

describe("summarizeSync", () => {
  it("shows nothing online when offline saving is off", () => {
    expect(summarizeSync(IDLE_SNAPSHOT).tone).toBe("hidden")
  })

  it("says offline even when offline saving is off", () => {
    const summary = summarizeSync({ ...IDLE_SNAPSHOT, online: false })
    expect(summary.tone).toBe("offline")
    expect(summary.detail).toMatch(/saving needs a connection/)
  })

  it("counts what is waiting while offline", () => {
    const summary = summarizeSync(snap({ online: false, pending: 3 }))
    expect(summary).toMatchObject({
      tone: "offline",
      label: "Offline · 3 waiting",
    })
    expect(summary.detail).toMatch(/3 changes saved on this device/)
  })

  it("distinguishes waiting, syncing and synced", () => {
    expect(summarizeSync(snap({ pending: 1 })).label).toBe("1 waiting")
    expect(summarizeSync(snap({ pending: 2, uploading: true })).tone).toBe(
      "syncing",
    )
    expect(
      summarizeSync(snap({ downloading: true, lastSyncedAt: null })).tone,
    ).toBe("syncing")
    expect(
      summarizeSync(
        snap({ downloading: true, lastSyncedAt: "2026-11-14T08:00:00Z" }),
      ).tone,
    ).toBe("synced")
  })

  it("explains why changes are stuck", () => {
    const summary = summarizeSync(
      snap({ pending: 2, error: "the server could not be reached" }),
    )
    expect(summary.detail).toBe(
      "2 changes not uploaded yet: the server could not be reached",
    )
  })
})

describe("describeSyncError", () => {
  it("puts errors in plain words", () => {
    expect(describeSyncError(new TypeError("Failed to fetch"))).toBe(
      "the server could not be reached",
    )
    expect(describeSyncError(new Error("401 invalid token"))).toBe(
      "your sign-in needs refreshing",
    )
    expect(describeSyncError(undefined)).toBeNull()
  })
})

describe("overlayPending", () => {
  const api: FindingPublic[] = [
    localFinding({ id: "1", inspection_id: "7", title: "Server one" }),
    localFinding({ id: "2", inspection_id: "7", title: "Server two" }),
  ].map((f) => ({ ...f, public_id: `pub-${f.id}`, ai_suggestion_id: 5 }))

  it("returns the API's rows untouched when nothing is waiting", () => {
    const merged = overlayPending(api, [], new Set(), "findings", localFinding)
    expect(merged.rows).toEqual(api)
    expect(merged.unsynced.size).toBe(0)
  })

  it("lays waiting edits over the API's row and adds offline creations", () => {
    const local = [
      { id: "2", inspection_id: "7", title: "Edited offline" },
      { id: "1", inspection_id: "7", title: "Not waiting" },
      { id: "local-x", inspection_id: "7", title: "Logged offline" },
    ]
    const pending = new Set([
      rowKey("findings", "2"),
      rowKey("findings", "local-x"),
    ])
    const merged = overlayPending(api, local, pending, "findings", localFinding)
    expect(merged.rows.map((f) => f.title)).toEqual([
      "Server one",
      "Edited offline",
      "Logged offline",
    ])
    // The API's extra fields survive the overlay.
    expect(merged.rows[1]).toMatchObject({
      public_id: "pub-2",
      ai_suggestion_id: 5,
    })
    const offlineId = localNumericId("local-x")
    expect(offlineId).toBeLessThan(0)
    expect([...merged.unsynced].sort()).toEqual([offlineId, 2].sort())
  })
})

describe("local row conversion", () => {
  it("gives offline rows stable negative ids", () => {
    expect(localNumericId("local-abc")).toBe(localNumericId("local-abc"))
    expect(localNumericId("local-abc")).not.toBe(localNumericId("local-xyz"))
    expect(numericId("17")).toBe(17)
    expect(numericId(17)).toBe(17)
  })

  it("turns a local pin into what the viewer draws", () => {
    const pin = localPin({
      id: "local-p",
      drawing_id: "3",
      x_pct: 12.5,
      y_pct: 40,
      status: "issue",
      page_number: 2,
      itp_item_id: null,
      position_check: 0,
    })
    expect(pin).toMatchObject({
      drawing_id: 3,
      x_pct: 12.5,
      y_pct: 40,
      page_number: 2,
      itp_item_id: null,
      position_check: false,
    })
    expect(pin.id).toBeLessThan(0)
  })
})

function recordingDb(rowsAffected = 1) {
  const calls: { sql: string; params: unknown[] }[] = []
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params })
        return { rowsAffected }
      },
    },
  }
}

describe("local writes", () => {
  const now = new Date("2026-11-14T09:30:00.000Z")

  it("saves a new finding with a local id and a description of the write", async () => {
    const { db, calls } = recordingDb()
    const id = await saveFindingOffline(
      db,
      7,
      {
        title: "Crack at C4",
        description: null,
        priority: "high",
        location_ref: "Grid C4",
      },
      now,
    )
    expect(isLocalId(id)).toBe(true)
    expect(calls[0].sql).toMatch(/^INSERT INTO findings/)
    expect(calls[0].params.slice(0, 7)).toEqual([
      id,
      "7",
      "Crack at C4",
      null,
      "high",
      "Grid C4",
      "open",
    ])
    expect(
      parseWriteMetadata(calls[0].params[calls[0].params.length - 1] as string),
    ).toEqual({
      queued_at: "2026-11-14T09:30:00.000Z",
      action: "Logged finding “Crack at C4”",
    })
  })

  it("edits a finding that is on the device", async () => {
    const { db, calls } = recordingDb()
    await updateFindingOffline(
      db,
      42,
      {
        title: "Crack",
        description: "Wider",
        priority: "low",
        location_ref: null,
        discipline: "structural",
      },
      now,
    )
    expect(calls[0].sql).toBe(
      "UPDATE findings SET title = ?, description = ?, priority = ?, location_ref = ?, discipline = ?, _metadata = ? WHERE id = ?",
    )
    expect(calls[0].params[calls[0].params.length - 1]).toBe("42")
  })

  it("refuses to edit what the device does not have", async () => {
    const { db } = recordingDb(0)
    await expect(
      updateFindingOffline(db, 99, {
        title: "x",
        description: null,
        priority: "low",
        location_ref: null,
      }),
    ).rejects.toBeInstanceOf(OfflineWriteError)
    await expect(
      movePinOffline(db, 5, { x_pct: 1, y_pct: 2, page_number: 1 }, "3"),
    ).rejects.toBeInstanceOf(OfflineWriteError)
  })

  it("places a pin with the drawing and ITP line as text ids", async () => {
    const { db, calls } = recordingDb()
    await placePinOffline(
      db,
      3,
      { x_pct: 10, y_pct: 20, status: "issue", page_number: 2, itp_item_id: 8 },
      now,
    )
    expect(calls[0].sql).toMatch(/^INSERT INTO inspection_pins/)
    expect(calls[0].params.slice(1, 7)).toEqual(["3", "8", 10, 20, "issue", 2])
  })
})

describe("sync history entries", () => {
  const base = {
    id: "a1",
    table_name: "findings",
    op: "PATCH",
    row_id: "42",
    http_status: 200,
    detail: "",
    action: "Edited finding “Crack”",
    payload: "{}",
    replaced: null,
    queued_at: "2026-11-14T09:30:00Z",
    created_at: "2026-11-14T10:05:00Z",
  }

  it("describes an applied change", () => {
    expect(toAuditEntry({ ...base, outcome: "applied" })).toMatchObject({
      outcome: "applied",
      what: "Edited finding “Crack”",
      madeAt: "2026-11-14T09:30:00Z",
      uploadedAt: "2026-11-14T10:05:00Z",
      result: "Uploaded.",
      replaced: [],
    })
  })

  it("lists the server values an overwrite replaced", () => {
    const entry = toAuditEntry({
      ...base,
      outcome: "overwrote",
      replaced: JSON.stringify({ title: "Crack (sealed)", description: null }),
    })
    expect(entry.result).toMatch(/last change wins/)
    expect(entry.replaced).toEqual([
      { field: "Title", value: "Crack (sealed)" },
      { field: "Description", value: "(blank)" },
    ])
  })

  it("explains a refusal and falls back to a generic description", () => {
    const entry = toAuditEntry({
      ...base,
      op: "PUT",
      action: null,
      table_name: "inspection_pins",
      outcome: "refused",
      http_status: 403,
      detail: "Viewers cannot add pins",
    })
    expect(entry.what).toBe("Added a pin")
    expect(entry.result).toBe(
      "Not accepted by the server: Viewers cannot add pins. The server's version is shown instead.",
    )
  })
})
