/**
 * React context for offline sync (rebuild increment 19).
 *
 * No PowerSync code is imported here (types only), so screens can read the
 * sync state in every build; without VITE_POWERSYNC_URL, or outside the
 * provider (tests, the demo), the default says "sync off" and the screens
 * behave exactly as before.
 */
import type { CommonPowerSyncDatabase } from "@powersync/common"
import { createContext, useContext, useEffect, useState } from "react"

import type { AuditEntry } from "./audit"
import type { LocalRow } from "./merge"
import { IDLE_SNAPSHOT, type SyncSnapshot } from "./status"

export interface SyncContextValue {
  snapshot: SyncSnapshot
  /** The open local copy, once syncing has started (null otherwise). */
  db: CommonPowerSyncDatabase | null
  /**
   * Save findings and pins on the device instead of calling the API: offline
   * sync is on and ready, and the device has no connection.
   */
  saveLocally: boolean
  /** Upload what is waiting and fetch the latest now. */
  syncNow: () => Promise<void>
  /** The sync history, newest first. */
  loadHistory: () => Promise<AuditEntry[]>
  clearHistory: () => Promise<void>
}

const noop = async () => {}

export const DEFAULT_SYNC_CONTEXT: SyncContextValue = {
  snapshot: IDLE_SNAPSHOT,
  db: null,
  saveLocally: false,
  syncNow: noop,
  loadHistory: async () => [],
  clearHistory: noop,
}

export const SyncContext = createContext<SyncContextValue>(DEFAULT_SYNC_CONTEXT)

export function useSync(): SyncContextValue {
  return useContext(SyncContext)
}

const PARENT_COLUMNS: Record<string, string> = {
  findings: "inspection_id",
  inspection_pins: "drawing_id",
}

/**
 * The device's copy of `table` rows under one parent (an inspection's
 * findings, a drawing's pins), kept current while any of them has a change
 * waiting. Returns [] when nothing is waiting, so the screens pay nothing
 * when the device is up to date.
 */
export function useLocalRows(
  table: "findings" | "inspection_pins",
  parentId: number,
): LocalRow[] {
  const { db, snapshot } = useSync()
  const waiting = [...snapshot.pendingKeys].some((key) =>
    key.startsWith(`${table}:`),
  )
  const [rows, setRows] = useState<LocalRow[]>([])

  useEffect(() => {
    if (!db || !waiting) {
      setRows([])
      return
    }
    const controller = new AbortController()
    db.watch(
      `SELECT * FROM ${table} WHERE ${PARENT_COLUMNS[table]} = ?`,
      [String(parentId)],
      {
        onResult: (result) => {
          setRows((result.rows?._array ?? []) as LocalRow[])
        },
        onError: (error) => console.warn("Offline rows unavailable", error),
      },
      { signal: controller.signal },
    )
    return () => controller.abort()
  }, [db, waiting, table, parentId])

  return rows
}
