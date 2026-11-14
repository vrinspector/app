import type { CommonPowerSyncDatabase } from "@powersync/common"
import { describe, expect, it, vi } from "vitest"

import {
  fetchTransport,
  type SqlRunner,
  sqlUploadStore,
  VriConnector,
} from "./connector"
import type { ApiRequest } from "./upload"

describe("VriConnector.fetchCredentials", () => {
  it("hands PowerSync the Auth0 access token", async () => {
    const connector = new VriConnector(
      "https://sync.example.com",
      async () => "token-123",
      vi.fn(),
    )
    expect(await connector.fetchCredentials()).toEqual({
      endpoint: "https://sync.example.com",
      token: "token-123",
    })
  })

  it("returns nothing when signed out", async () => {
    const connector = new VriConnector(
      "https://s",
      async () => undefined,
      vi.fn(),
    )
    expect(await connector.fetchCredentials()).toBeNull()
  })
})

describe("VriConnector.uploadData", () => {
  it("replays each queued transaction and completes it", async () => {
    const complete = vi.fn(async () => {})
    const transactions = [
      {
        crud: [
          {
            table: "findings",
            op: "PATCH",
            id: "12",
            opData: { title: "Bolt missing" },
          },
          { table: "inspection_pins", op: "DELETE", id: "4" },
        ],
        complete,
      },
    ]
    const sent: ApiRequest[] = []
    const transport = vi.fn(async (request: ApiRequest) => {
      sent.push(request)
      return { status: 200 }
    })
    const database = {
      getNextCrudTransaction: vi.fn(async () => transactions.shift() ?? null),
      execute: vi.fn(),
      getOptional: vi.fn(async () => null),
    } as unknown as CommonPowerSyncDatabase
    const connector = new VriConnector("https://s", async () => "t", transport)
    await connector.uploadData(database)
    expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "PUT /findings/12",
      "DELETE /pins/4",
    ])
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it("leaves the transaction queued when the server is down", async () => {
    const complete = vi.fn(async () => {})
    const database = {
      getNextCrudTransaction: vi.fn(async () => ({
        crud: [{ table: "findings", op: "DELETE", id: "1" }],
        complete,
      })),
      execute: vi.fn(),
      getOptional: vi.fn(async () => null),
    } as unknown as CommonPowerSyncDatabase
    const connector = new VriConnector(
      "https://s",
      async () => "t",
      async () => ({
        status: 502,
      }),
    )
    await expect(connector.uploadData(database)).rejects.toThrow()
    expect(complete).not.toHaveBeenCalled()
  })
})

describe("sqlUploadStore", () => {
  it("reads and writes the local-only bookkeeping tables", async () => {
    const execute = vi.fn(async () => undefined)
    const getOptional = vi.fn(async () => ({ server_id: "77" }))
    const store = sqlUploadStore({
      execute,
      getOptional,
    } as unknown as SqlRunner)
    expect(await store.serverIdFor("findings", "local-1")).toBe("77")
    expect(getOptional).toHaveBeenCalledWith(
      expect.stringContaining("FROM local_id_map"),
      ["findings", "local-1"],
    )
    await store.remember("findings", "local-1", "77")
    expect(execute).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO local_id_map"),
      ["findings", "local-1", "77", expect.any(String)],
    )
    await store.reject(
      { table: "findings", op: "PATCH", id: "3", opData: { title: "" } },
      422,
      "too short",
    )
    const [sql, params] = execute.mock.lastCall as unknown as [
      string,
      unknown[],
    ]
    expect(sql).toContain("INSERT INTO upload_rejections")
    expect(sql).toContain("WHERE NOT EXISTS")
    expect(params.slice(0, 6)).toEqual([
      "findings",
      "PATCH",
      "3",
      422,
      "too short",
      '{"title":""}',
    ])
  })

  it("knows nothing about an id that was never created", async () => {
    const store = sqlUploadStore({
      execute: vi.fn(),
      getOptional: vi.fn(async () => null),
    } as unknown as SqlRunner)
    expect(await store.serverIdFor("findings", "local-x")).toBeUndefined()
  })
})

describe("fetchTransport", () => {
  it("calls the API with the bearer token and JSON body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: 5 }), { status: 201 }),
    )
    const transport = fetchTransport(
      "https://app.example.com/",
      async () => "tok",
      fetchImpl as unknown as typeof fetch,
    )
    const response = await transport({
      method: "POST",
      path: "/findings",
      body: { title: "x" },
    })
    expect(response).toEqual({ status: 201, body: { id: 5 } })
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.example.com/api/v1/findings",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        },
        body: '{"title":"x"}',
      },
    )
  })

  it("keeps a non-JSON error as its detail and sends no body on delete", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("Bad gateway", { status: 502 }),
    )
    const transport = fetchTransport(
      "",
      async () => undefined,
      fetchImpl as unknown as typeof fetch,
    )
    expect(await transport({ method: "DELETE", path: "/pins/1" })).toEqual({
      status: 502,
      body: { detail: "Bad gateway" },
    })
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/pins/1", {
      method: "DELETE",
      headers: { Accept: "application/json" },
      body: undefined,
    })
  })
})
