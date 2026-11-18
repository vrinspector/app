import { AxiosError, AxiosHeaders } from "axios"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  isNetworkFailure,
  type LocalReader,
  localDrawing,
  localInspection,
  localMember,
  localProject,
  OfflineError,
  readLocalDrawing,
  readLocalFindings,
  readLocalProjects,
  setOfflineReader,
  withLocalFallback,
  withOfflineMessage,
} from "./offlineRead"

/*
 * Increment 21: with no signal the field screens read the device's synced
 * copy; answers from the server are never replaced by it.
 */

const networkError = () => new AxiosError("Network Error", "ERR_NETWORK")
const httpError = (status: number) =>
  new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { detail: "Not found" },
  })

/** A fake SQLite reader: answers by the table named in the query. */
function fakeDb(
  tables: Record<string, Record<string, unknown>[]>,
): LocalReader {
  return {
    getAll: vi.fn(async (sql: string, params?: unknown[]) => {
      const table = /FROM (\w+)/.exec(sql)?.[1] ?? ""
      let rows = tables[table] ?? []
      const where = /WHERE (?:d\.)?(\w+) = \?/.exec(sql)?.[1]
      if (where && params?.length) {
        rows = rows.filter((row) => String(row[where]) === String(params[0]))
      }
      if (/superseded_at IS NULL/.test(sql)) {
        rows = rows.filter((row) => !row.superseded_at)
      }
      return rows as never
    }),
  } as LocalReader
}

afterEach(() => {
  setOfflineReader(null)
})

describe("isNetworkFailure", () => {
  it("is true only when the request never reached the server", () => {
    expect(isNetworkFailure(networkError())).toBe(true)
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true)
    expect(isNetworkFailure(httpError(404))).toBe(false)
    expect(isNetworkFailure(httpError(401))).toBe(false)
    expect(isNetworkFailure(httpError(500))).toBe(false)
  })
})

describe("withLocalFallback", () => {
  it("returns the API answer when there is signal", async () => {
    setOfflineReader(fakeDb({}))
    const local = vi.fn()
    await expect(withLocalFallback(async () => [1], local)).resolves.toEqual([
      1,
    ])
    expect(local).not.toHaveBeenCalled()
  })

  it("reads the device's copy when the server cannot be reached", async () => {
    setOfflineReader(fakeDb({}))
    await expect(
      withLocalFallback(
        async () => {
          throw networkError()
        },
        async () => ["local"],
      ),
    ).resolves.toEqual(["local"])
  })

  it("never replaces a server answer (404, 403, 401) with local rows", async () => {
    setOfflineReader(fakeDb({}))
    const local = vi.fn(async () => ["local"])
    for (const status of [401, 403, 404]) {
      await expect(
        withLocalFallback(async () => {
          throw httpError(status)
        }, local),
      ).rejects.toBeInstanceOf(AxiosError)
    }
    expect(local).not.toHaveBeenCalled()
  })

  it("says plainly that signal is needed when there is no copy", async () => {
    await expect(
      withLocalFallback(
        async () => {
          throw networkError()
        },
        async () => ["never"],
      ),
    ).rejects.toBeInstanceOf(OfflineError)

    setOfflineReader(fakeDb({}))
    await expect(
      withLocalFallback(
        async () => {
          throw networkError()
        },
        async () => undefined,
        "Not on this device",
      ),
    ).rejects.toThrow("Not on this device")
  })

  it("withOfflineMessage turns a network failure into plain words", async () => {
    await expect(
      withOfflineMessage(async () => {
        throw networkError()
      }, "Needs signal"),
    ).rejects.toThrow("Needs signal")
    await expect(
      withOfflineMessage(async () => {
        throw httpError(500)
      }, "Needs signal"),
    ).rejects.toBeInstanceOf(AxiosError)
  })
})

describe("mapping the synced rows to the API's shapes", () => {
  it("projects keep their code or get the derived one", () => {
    const withCode = localProject({
      id: "7",
      public_id: "p-7",
      name: "Cedar Hollow Landfill RNG",
      code: "CH-RNG",
      status: "active",
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-02T00:00:00Z",
    })
    expect(withCode).toMatchObject({
      id: 7,
      itp_code: "CH-RNG",
      code: "CH-RNG",
    })
    const derived = localProject({ id: "1", name: "Landfill Cell 4" })
    expect(derived.itp_code).toBe("LC4")
  })

  it("inspections, drawings and members carry numeric ids", () => {
    expect(
      localInspection({ id: "12", project_id: "7", title: "Pour 3" }),
    ).toMatchObject({ id: 12, project_id: 7, title: "Pour 3" })

    const current = localDrawing({
      id: "40",
      project_id: "7",
      file_size: "1024",
      series_id: "40",
      revision_count: 2,
      superseded_at: null,
    })
    expect(current).toMatchObject({
      id: 40,
      file_size: 1024,
      series_id: 40,
      revision_count: 2,
      is_current: true,
      // Presigned links are never stored on the device.
      view_url: null,
    })
    expect(
      localDrawing({ id: "39", superseded_at: "2026-11-03T00:00:00Z" })
        .is_current,
    ).toBe(false)

    expect(
      localMember({
        id: "5",
        project_id: "7",
        user_email: "Stacey@Example.com",
        role: "owner",
      }),
    ).toMatchObject({ role: "owner", user_email: "Stacey@Example.com" })
  })
})

describe("reading the device's copy", () => {
  const db = fakeDb({
    projects: [
      { id: "7", name: "Cedar Hollow", created_at: "2026-11-01" },
      { id: "8", name: "Landfill Cell 4", created_at: "2026-11-05" },
    ],
    inspections: [{ id: "12", project_id: "7", title: "Pour 3" }],
    findings: [
      { id: "100", inspection_id: "12", title: "Honeycombing" },
      { id: "local-abc", inspection_id: "12", title: "Logged offline" },
      { id: "101", inspection_id: "99", title: "Other inspection" },
    ],
    drawings: [{ id: "40", project_id: "7", title: "P&ID" }],
  })

  it("lists projects", async () => {
    const projects = await readLocalProjects(db)
    expect(projects.map((p) => p.name)).toEqual([
      "Cedar Hollow",
      "Landfill Cell 4",
    ])
  })

  it("lists an inspection's findings, including ones logged offline", async () => {
    const findings = await readLocalFindings(db, 12)
    expect(findings?.map((f) => f.title)).toEqual([
      "Honeycombing",
      "Logged offline",
    ])
    expect(findings?.[1].id).toBeLessThan(0)
  })

  it("answers undefined for something not on the device", async () => {
    expect(await readLocalFindings(db, 999)).toBeUndefined()
    expect(await readLocalDrawing(db, 41)).toBeUndefined()
    expect(await readLocalDrawing(db, 40)).toMatchObject({ title: "P&ID" })
  })
})
