/**
 * Increment 19: the sync history the upload queue writes, and the
 * last-write-wins check before an edit is sent.
 */
import { describe, expect, it, vi } from "vitest"

import {
  type ApiRequest,
  type ApiResponse,
  type AuditRecord,
  type QueuedChange,
  RetryUpload,
  timestampMs,
  type UploadStore,
  uploadChange,
} from "./upload"

function auditStore(initial: Record<string, string> = {}) {
  const ids = new Map(Object.entries(initial))
  const records: AuditRecord[] = []
  const rejections: number[] = []
  const store: UploadStore = {
    serverIdFor: async (table, localId) => ids.get(`${table}:${localId}`),
    remember: async (table, localId, serverId) => {
      ids.set(`${table}:${localId}`, serverId)
    },
    reject: async (_change, status) => {
      rejections.push(status)
    },
    record: async (entry) => {
      records.push(entry)
    },
  }
  return { store, records, rejections }
}

function fakeApi(answer: (request: ApiRequest) => ApiResponse) {
  const sent: ApiRequest[] = []
  const transport = vi.fn(async (request: ApiRequest) => {
    sent.push(request)
    return answer(request)
  })
  return { sent, transport }
}

const edit: QueuedChange = {
  table: "findings",
  op: "PATCH",
  id: "42",
  opData: { title: "Crack at C4 (widened)", priority: "high" },
  previousValues: { updated_at: "2026-11-14 09:00:00.123456Z" },
  metadata: JSON.stringify({
    queued_at: "2026-11-14T09:30:00.000Z",
    action: "Edited finding “Crack at C4 (widened)”",
  }),
}

describe("timestampMs", () => {
  it("reads the API's and the sync service's formats alike", () => {
    const api = timestampMs("2026-11-14T09:00:00.123456")
    const sync = timestampMs("2026-11-14 09:00:00.123456Z")
    expect(api).toBe(Date.parse("2026-11-14T09:00:00.123Z"))
    expect(sync).toBe(api)
    expect(timestampMs("2026-11-14T09:00:00+00:00")).toBe(
      Date.parse("2026-11-14T09:00:00Z"),
    )
    expect(Number.isNaN(timestampMs(null))).toBe(true)
    expect(Number.isNaN(timestampMs("not a date"))).toBe(true)
  })
})

describe("sync history", () => {
  it("records an applied create", async () => {
    const { store, records } = auditStore()
    const { transport } = fakeApi(() => ({ status: 201, body: { id: 9 } }))
    const change: QueuedChange = {
      table: "findings",
      op: "PUT",
      id: "local-a",
      opData: { inspection_id: "7", title: "Loose rail" },
    }
    await expect(uploadChange(change, transport, store)).resolves.toBe("done")
    expect(records).toEqual([
      { change, outcome: "applied", httpStatus: 201, detail: "" },
    ])
  })

  it("records a refusal with the API's reason as well as rejecting it", async () => {
    const { store, records, rejections } = auditStore()
    const { transport } = fakeApi(() => ({
      status: 409,
      body: { detail: "Inspection is signed off" },
    }))
    const change: QueuedChange = {
      table: "findings",
      op: "PUT",
      id: "local-b",
      opData: { inspection_id: "7", title: "Late note" },
    }
    await expect(uploadChange(change, transport, store)).resolves.toBe(
      "rejected",
    )
    expect(rejections).toEqual([409])
    expect(records).toEqual([
      {
        change,
        outcome: "refused",
        httpStatus: 409,
        detail: "Inspection is signed off",
      },
    ])
  })

  it("records changes the queue refuses before sending", async () => {
    const { store, records } = auditStore()
    const { transport } = fakeApi(() => ({ status: 200 }))
    const change: QueuedChange = {
      table: "photos",
      op: "PUT",
      id: "local-p",
      opData: {},
    }
    await uploadChange(change, transport, store)
    expect(transport).not.toHaveBeenCalled()
    expect(records[0]).toMatchObject({ outcome: "refused", httpStatus: 0 })
  })
})

describe("last write wins", () => {
  it("applies an edit over a newer server change and keeps what it replaced", async () => {
    const { store, records } = auditStore()
    const { sent, transport } = fakeApi((request) =>
      request.method === "GET"
        ? {
            status: 200,
            body: {
              id: 42,
              title: "Crack at C4 (sealed)",
              priority: "high",
              updated_at: "2026-11-14T09:15:00.000000",
            },
          }
        : { status: 200, body: { id: 42 } },
    )
    await expect(uploadChange(edit, transport, store)).resolves.toBe("done")
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /findings/42",
      "PUT /findings/42",
    ])
    expect(records).toHaveLength(1)
    expect(records[0].outcome).toBe("overwrote")
    // Only the fields that really differed are kept.
    expect(records[0].replaced).toEqual({ title: "Crack at C4 (sealed)" })
  })

  it("is a plain apply when the server has not changed since", async () => {
    const { store, records } = auditStore()
    const { transport } = fakeApi((request) =>
      request.method === "GET"
        ? {
            status: 200,
            body: {
              title: "Crack at C4",
              updated_at: "2026-11-14T09:00:00.123456",
            },
          }
        : { status: 200 },
    )
    await uploadChange(edit, transport, store)
    expect(records[0].outcome).toBe("applied")
    expect(records[0].replaced).toBeUndefined()
  })

  it("does not call a retry of its own change a conflict", async () => {
    const { store, records } = auditStore()
    const { transport } = fakeApi((request) =>
      request.method === "GET"
        ? {
            status: 200,
            body: {
              title: "Crack at C4 (widened)",
              priority: "high",
              updated_at: "2026-11-14T09:31:00",
            },
          }
        : { status: 200 },
    )
    await uploadChange(edit, transport, store)
    expect(records[0].outcome).toBe("applied")
  })

  it("skips the check without a base version, and for pins", async () => {
    const { store } = auditStore()
    const { sent, transport } = fakeApi(() => ({ status: 200 }))
    await uploadChange({ ...edit, previousValues: undefined }, transport, store)
    await uploadChange(
      {
        table: "inspection_pins",
        op: "PATCH",
        id: "5",
        opData: { x_pct: 10, y_pct: 20, page_number: 1 },
      },
      transport,
      store,
    )
    expect(sent.some((r) => r.method === "GET")).toBe(false)
  })

  it("waits and retries when the server cannot be reached for the check", async () => {
    const { store, records } = auditStore()
    const transport = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    await expect(uploadChange(edit, transport, store)).rejects.toBeInstanceOf(
      RetryUpload,
    )
    expect(records).toEqual([])
  })

  it("lets the edit be refused normally when the row is gone", async () => {
    const { store, records } = auditStore()
    const { transport } = fakeApi(() => ({
      status: 404,
      body: { detail: "Finding not found" },
    }))
    await expect(uploadChange(edit, transport, store)).resolves.toBe("rejected")
    expect(records[0]).toMatchObject({ outcome: "refused", httpStatus: 404 })
  })
})
