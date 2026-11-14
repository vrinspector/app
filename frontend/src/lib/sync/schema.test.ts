import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import YAML from "yaml"

import { isOfflineSyncEnabled, powerSyncUrl } from "./config"
import { buildSchema, LOCAL_ONLY_COLUMNS, SYNCED_COLUMNS } from "./schema"
import { WRITABLE } from "./upload"

const SYNC_CONFIG = path.resolve(
  import.meta.dirname,
  "../../../../powersync/sync-config.yaml",
)

/** Table → output columns of every stream query in sync-config.yaml. */
function syncedColumns(): Record<string, string[]> {
  const config = YAML.parse(readFileSync(SYNC_CONFIG, "utf8"))
  const out: Record<string, string[]> = {}
  for (const stream of Object.values<{ queries: string[] }>(config.streams)) {
    for (const raw of stream.queries) {
      const query = raw.replace(/\s+/g, " ")
      const match = /^SELECT (.+?) FROM (\w+) WHERE/.exec(query)
      if (!match) throw new Error(`Unexpected query: ${query}`)
      const [, select, table] = match
      const columns = select.split(",").map((part) => {
        const alias = / AS (\w+)\)?$/i.exec(part.trim())
        return alias ? alias[1] : part.trim()
      })
      const previous = out[table]
      if (previous) {
        // The same table may come from two queries; they must agree.
        expect(columns).toEqual(previous)
      }
      out[table] = columns
    }
  }
  return out
}

describe("offline schema", () => {
  it("has exactly the columns the sync config sends", () => {
    const fromConfig = syncedColumns()
    expect(Object.keys(SYNCED_COLUMNS).sort()).toEqual(
      Object.keys(fromConfig).sort(),
    )
    for (const [table, columns] of Object.entries(fromConfig)) {
      expect(columns[0]).toBe("id")
      expect(Object.keys(SYNCED_COLUMNS[table])).toEqual(columns.slice(1))
    }
  })

  it("keeps ids and foreign keys as text", () => {
    for (const [table, columns] of Object.entries(SYNCED_COLUMNS)) {
      for (const [name, kind] of Object.entries(columns)) {
        if (name.endsWith("_id"))
          expect([table, name, kind]).toEqual([table, name, "text"])
      }
    }
  })

  it("only queues writes for synced tables", () => {
    for (const table of Object.keys(WRITABLE)) {
      expect(SYNCED_COLUMNS).toHaveProperty(table)
    }
  })

  it("builds a PowerSync schema with the local-only bookkeeping tables", () => {
    const schema = buildSchema()
    const tables = Object.fromEntries(schema.tables.map((t) => [t.name, t]))
    expect(Object.keys(tables).sort()).toEqual(
      [
        ...Object.keys(SYNCED_COLUMNS),
        ...Object.keys(LOCAL_ONLY_COLUMNS),
      ].sort(),
    )
    expect(tables.findings.localOnly).toBe(false)
    expect(tables.local_id_map.localOnly).toBe(true)
    expect(tables.upload_rejections.localOnly).toBe(true)
  })
})

describe("offline sync switch", () => {
  it("is off unless a PowerSync URL is configured", () => {
    expect(isOfflineSyncEnabled({})).toBe(false)
    expect(isOfflineSyncEnabled({ VITE_POWERSYNC_URL: "  " })).toBe(false)
    expect(powerSyncUrl({ VITE_POWERSYNC_URL: "http://localhost:8095/" })).toBe(
      "http://localhost:8095",
    )
    expect(isOfflineSyncEnabled({ VITE_POWERSYNC_URL: "https://sync.x" })).toBe(
      true,
    )
  })

  it("is off in this build (no VITE_POWERSYNC_URL in tests)", () => {
    expect(isOfflineSyncEnabled()).toBe(false)
  })
})
