import { describe, expect, it, vi } from "vitest"

import {
  type ApiRequest,
  type ApiResponse,
  isLocalId,
  newLocalId,
  planRequests,
  type QueuedChange,
  RetryUpload,
  type UploadStore,
  uploadChange,
} from "./upload"

function memoryStore(initial: Record<string, string> = {}) {
  const ids = new Map(Object.entries(initial))
  const rejections: { change: QueuedChange; status: number; detail: string }[] =
    []
  const store: UploadStore = {
    serverIdFor: async (table, localId) => ids.get(`${table}:${localId}`),
    remember: async (table, localId, serverId) => {
      ids.set(`${table}:${localId}`, serverId)
    },
    reject: async (change, status, detail) => {
      rejections.push({ change, status, detail })
    },
  }
  return { store, ids, rejections }
}

function fakeApi(
  answer: (request: ApiRequest) => ApiResponse = () => ({ status: 200 }),
) {
  const sent: ApiRequest[] = []
  const transport = vi.fn(async (request: ApiRequest) => {
    sent.push(request)
    return answer(request)
  })
  return { sent, transport }
}

describe("local ids", () => {
  it("are recognisable and unique", () => {
    const a = newLocalId()
    expect(isLocalId(a)).toBe(true)
    expect(a).not.toBe(newLocalId())
    expect(isLocalId("42")).toBe(false)
    expect(isLocalId(42)).toBe(false)
  })
})

describe("planRequests", () => {
  it("creates a finding with the existing endpoint and body", async () => {
    const { store } = memoryStore()
    const requests = await planRequests(
      {
        table: "findings",
        op: "PUT",
        id: "local-f1",
        opData: {
          inspection_id: "7",
          title: "Missing bolt",
          priority: "high",
          description: null,
          created_at: "2026-11-14T10:00:00Z",
        },
      },
      store,
    )
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/findings",
        body: { inspection_id: 7, title: "Missing bolt", priority: "high" },
        creates: { table: "findings", localId: "local-f1" },
      },
    ])
  })

  it("routes a status change to the status and resolve endpoints", async () => {
    const { store } = memoryStore()
    expect(
      await planRequests(
        {
          table: "findings",
          op: "PATCH",
          id: "12",
          opData: { status: "in_progress", title: "Bolt missing (2)" },
        },
        store,
      ),
    ).toEqual([
      {
        method: "PUT",
        path: "/findings/12",
        body: { title: "Bolt missing (2)" },
      },
      {
        method: "PATCH",
        path: "/findings/12/status",
        body: { status: "in_progress" },
      },
    ])
    expect(
      await planRequests(
        {
          table: "findings",
          op: "PATCH",
          id: "12",
          opData: { status: "resolved", resolution_notes: "Bolt fitted" },
        },
        store,
      ),
    ).toEqual([
      {
        method: "PATCH",
        path: "/findings/12/resolve",
        body: { resolution_notes: "Bolt fitted" },
      },
    ])
  })

  it("creates a pin on its drawing with numbers, mapping offline ids", async () => {
    const { store } = memoryStore({ "findings:local-f1": "88" })
    const requests = await planRequests(
      {
        table: "inspection_pins",
        op: "PUT",
        id: "local-p1",
        opData: {
          drawing_id: "5",
          finding_id: "local-f1",
          x_pct: "42.5",
          y_pct: 10,
          page_number: "2",
          status: "punch_item",
        },
      },
      store,
    )
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/drawings/5/pins",
        body: {
          finding_id: 88,
          x_pct: 42.5,
          y_pct: 10,
          page_number: 2,
          status: "punch_item",
        },
        creates: { table: "inspection_pins", localId: "local-p1" },
      },
    ])
  })

  it("keeps an explicit null that unlinks a pin", async () => {
    const { store } = memoryStore()
    expect(
      await planRequests(
        {
          table: "inspection_pins",
          op: "PATCH",
          id: "3",
          opData: { finding_id: null },
        },
        store,
      ),
    ).toEqual([{ method: "PUT", path: "/pins/3", body: { finding_id: null } }])
  })

  it("updates an ITP line through PUT /itp-items/{id}", async () => {
    const { store } = memoryStore()
    expect(
      await planRequests(
        {
          table: "itp_items",
          op: "PATCH",
          id: "40",
          opData: { status: "pass", measured_value: "2.5" },
        },
        store,
      ),
    ).toEqual([
      {
        method: "PUT",
        path: "/itp-items/40",
        body: { status: "pass", measured_value: "2.5" },
      },
    ])
  })

  it("deletes with the existing endpoints", async () => {
    const { store } = memoryStore({ "inspections:local-i1": "9" })
    expect(
      await planRequests(
        { table: "inspections", op: "DELETE", id: "local-i1" },
        store,
      ),
    ).toEqual([{ method: "DELETE", path: "/inspections/9" }])
  })
})

describe("uploadChange", () => {
  it("logs a finding under an inspection created offline", async () => {
    const { store, ids } = memoryStore()
    let next = 100
    const { sent, transport } = fakeApi(() => ({
      status: 201,
      body: { id: next++ },
    }))
    await uploadChange(
      {
        table: "inspections",
        op: "PUT",
        id: "local-i1",
        opData: { project_id: "3", title: "Site walk" },
      },
      transport,
      store,
    )
    await uploadChange(
      {
        table: "findings",
        op: "PUT",
        id: "local-f1",
        opData: { inspection_id: "local-i1", title: "Crack" },
      },
      transport,
      store,
    )
    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/inspections", { project_id: 3, title: "Site walk" }],
      ["POST", "/findings", { inspection_id: 100, title: "Crack" }],
    ])
    expect(ids.get("inspections:local-i1")).toBe("100")
    expect(ids.get("findings:local-f1")).toBe("101")
  })

  it("does not send a create twice when the queue is retried", async () => {
    const { store } = memoryStore({ "findings:local-f1": "55" })
    const { sent, transport } = fakeApi()
    const result = await uploadChange(
      {
        table: "findings",
        op: "PUT",
        id: "local-f1",
        opData: { inspection_id: "7", title: "Crack" },
      },
      transport,
      store,
    )
    expect(result).toBe("done")
    expect(sent).toEqual([])
  })

  it("records a refused change with the API's reason and moves on", async () => {
    const { store, rejections } = memoryStore()
    const { transport } = fakeApi(() => ({
      status: 409,
      body: { detail: "Inspection is signed off" },
    }))
    const change: QueuedChange = {
      table: "findings",
      op: "PATCH",
      id: "12",
      opData: { title: "Late edit" },
    }
    expect(await uploadChange(change, transport, store)).toBe("rejected")
    expect(rejections).toEqual([
      { change, status: 409, detail: "Inspection is signed off" },
    ])
  })

  it("records validation details that are not plain text", async () => {
    const { store, rejections } = memoryStore()
    const { transport } = fakeApi(() => ({
      status: 422,
      body: { detail: [{ loc: ["body", "title"], msg: "too short" }] },
    }))
    await uploadChange(
      { table: "findings", op: "PATCH", id: "12", opData: { title: "" } },
      transport,
      store,
    )
    expect(rejections[0].detail).toContain("too short")
  })

  it("never sends what cannot be written offline", async () => {
    const { store, rejections } = memoryStore()
    const { sent, transport } = fakeApi()
    for (const change of [
      { table: "projects", op: "PATCH", id: "1", opData: { name: "x" } },
      {
        table: "inspections",
        op: "PATCH",
        id: "1",
        opData: { inspection_status: "closed" },
      },
      { table: "itp_items", op: "DELETE", id: "4" },
      { table: "itp_items", op: "PUT", id: "local-x", opData: {} },
      { table: "findings", op: "PUT", id: "17", opData: { title: "x" } },
    ] satisfies QueuedChange[]) {
      expect(await uploadChange(change, transport, store)).toBe("rejected")
    }
    expect(sent).toEqual([])
    expect(rejections.map((r) => r.detail)).toEqual([
      "projects is read-only offline",
      "Cannot change inspection_status on inspections offline",
      "itp_items rows cannot be deleted offline",
      "New itp_items rows cannot be created offline",
      "New findings rows cannot be created offline",
    ])
  })

  it("refuses a child whose offline parent never reached the server", async () => {
    const { store, rejections } = memoryStore()
    const { sent, transport } = fakeApi()
    await uploadChange(
      {
        table: "findings",
        op: "PUT",
        id: "local-f2",
        opData: { inspection_id: "local-gone", title: "x" },
      },
      transport,
      store,
    )
    expect(sent).toEqual([])
    expect(rejections[0].detail).toMatch(/inspections row created offline/)
  })

  it.each([401, 408, 429, 500, 503])(
    "keeps the queue for a later retry on HTTP %i",
    async (status) => {
      const { store, rejections } = memoryStore()
      const { transport } = fakeApi(() => ({ status }))
      await expect(
        uploadChange(
          { table: "findings", op: "DELETE", id: "3" },
          transport,
          store,
        ),
      ).rejects.toBeInstanceOf(RetryUpload)
      expect(rejections).toEqual([])
    },
  )

  it("keeps the queue when the server cannot be reached", async () => {
    const { store } = memoryStore()
    const transport = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    })
    await expect(
      uploadChange(
        { table: "findings", op: "DELETE", id: "3" },
        transport,
        store,
      ),
    ).rejects.toThrow(/Could not reach the server/)
  })

  it("treats deleting something already gone as done", async () => {
    const { store } = memoryStore()
    const { transport } = fakeApi(() => ({ status: 404 }))
    expect(
      await uploadChange(
        { table: "inspection_pins", op: "DELETE", id: "3" },
        transport,
        store,
      ),
    ).toBe("done")
  })

  it("retries a create whose answer carried no id", async () => {
    const { store, ids } = memoryStore()
    const { transport } = fakeApi(() => ({ status: 201, body: {} }))
    await expect(
      uploadChange(
        {
          table: "findings",
          op: "PUT",
          id: "local-f1",
          opData: { inspection_id: "1", title: "x" },
        },
        transport,
        store,
      ),
    ).rejects.toBeInstanceOf(RetryUpload)
    expect(ids.size).toBe(0)
  })
})
