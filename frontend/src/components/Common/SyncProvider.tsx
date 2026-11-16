import { useAuth0 } from "@auth0/auth0-react"
import type { CommonPowerSyncDatabase, SyncStatus } from "@powersync/common"
import { useQueryClient } from "@tanstack/react-query"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { type AuditRow, toAuditEntry } from "@/lib/sync/audit"
import { isOfflineSyncEnabled, powerSyncUrl } from "@/lib/sync/config"
import { SyncContext, type SyncContextValue } from "@/lib/sync/context"
import {
  describeSyncError,
  IDLE_SNAPSHOT,
  pendingKeysFromCrud,
  type SyncSnapshot,
} from "@/lib/sync/status"

/*
 * Offline sync for the signed-in session (rebuild increments 18–19).
 *
 * - Starts PowerSync once someone is signed in — only in builds that name a
 *   PowerSync service (VITE_POWERSYNC_URL); otherwise nothing is loaded.
 * - Tracks the connection, PowerSync's status and the device's upload queue,
 *   and hands the screens one `SyncSnapshot` (see lib/sync/status.ts).
 * - When the queue empties, refreshes every screen from the API, so rows that
 *   were saved on the device are replaced by the server's versions.
 *
 * The connection flag is tracked in every build, so the header can say
 * "Offline" even when offline saving is not switched on.
 */

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback)
  window.addEventListener("offline", callback)
  return () => {
    window.removeEventListener("online", callback)
    window.removeEventListener("offline", callback)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

interface QueueState {
  pending: number
  pendingKeys: ReadonlySet<string>
  refused: number
  overwritten: number
}

const EMPTY_QUEUE: QueueState = {
  pending: 0,
  pendingKeys: new Set(),
  refused: 0,
  overwritten: 0,
}

type StatusFields = Pick<
  SyncSnapshot,
  "connected" | "uploading" | "downloading" | "lastSyncedAt" | "error"
>

function statusFields(status: SyncStatus): StatusFields {
  const flow = status.dataFlowStatus
  return {
    connected: status.connected,
    uploading: Boolean(flow?.uploading),
    downloading: Boolean(flow?.downloading),
    lastSyncedAt: status.lastSyncedAt
      ? status.lastSyncedAt.toISOString()
      : null,
    error: describeSyncError(flow?.uploadError ?? flow?.downloadError),
  }
}

async function readQueue(db: CommonPowerSyncDatabase): Promise<QueueState> {
  const crud = await db.getAll<{ data: string }>("SELECT data FROM ps_crud")
  const counts = await db.getAll<{ outcome: string; n: number }>(
    "SELECT outcome, COUNT(*) AS n FROM sync_audit " +
      "WHERE outcome IN ('refused', 'overwrote') GROUP BY outcome",
  )
  const count = (outcome: string) =>
    Number(counts.find((row) => row.outcome === outcome)?.n ?? 0)
  return {
    pending: crud.length,
    pendingKeys: pendingKeysFromCrud(crud),
    refused: count("refused"),
    overwritten: count("overwrote"),
  }
}

const WATCHED_TABLES = [
  "findings",
  "inspection_pins",
  "inspections",
  "itp_items",
  "sync_audit",
]

export function SyncProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0()
  const queryClient = useQueryClient()
  const online = useOnline()
  const enabled =
    Boolean(import.meta.env.VITE_POWERSYNC_URL) && isOfflineSyncEnabled()

  const [db, setDb] = useState<CommonPowerSyncDatabase | null>(null)
  const [status, setStatus] = useState<StatusFields>({
    connected: false,
    uploading: false,
    downloading: false,
    lastSyncedAt: null,
    error: null,
  })
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE)
  const lastPending = useRef(0)

  // Start syncing once someone is signed in (increment 18's OfflineSync).
  useEffect(() => {
    // The literal env check lets builds without a sync URL drop the import
    // below (and PowerSync's SQLite) entirely.
    if (!import.meta.env.VITE_POWERSYNC_URL) return
    const endpoint = powerSyncUrl()
    if (!isAuthenticated || !endpoint || !isOfflineSyncEnabled()) return
    let cancelled = false
    const getToken = async () => {
      try {
        return await getAccessTokenSilently()
      } catch {
        return undefined
      }
    }
    import("@/lib/sync/database")
      .then(async ({ startOfflineSync }) => {
        if (cancelled) return
        const opened = await startOfflineSync({
          endpoint,
          apiBase: import.meta.env.VITE_API_URL ?? "",
          getToken,
        })
        if (!cancelled) setDb(opened)
      })
      .catch((error: unknown) => {
        // Offline sync is an extra: the app keeps working online without it.
        console.warn("Offline sync could not start", error)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getAccessTokenSilently])

  const refreshQueue = useCallback(async () => {
    if (!db) return
    try {
      setQueue(await readQueue(db))
    } catch (error) {
      console.warn("Could not read the upload queue", error)
    }
  }, [db])

  // Follow PowerSync's status and the device's queue.
  useEffect(() => {
    if (!db) return
    setStatus(statusFields(db.currentStatus))
    void refreshQueue()
    const stopStatus = db.registerListener({
      statusChanged: (next) => {
        setStatus(statusFields(next))
        void refreshQueue()
      },
    })
    const stopChanges = db.onChange(
      { onChange: () => void refreshQueue() },
      { tables: WATCHED_TABLES, throttleMs: 250 },
    )
    return () => {
      stopStatus()
      stopChanges()
    }
  }, [db, refreshQueue])

  // When the last waiting change has gone up, show the server's versions.
  useEffect(() => {
    if (lastPending.current > 0 && queue.pending === 0) {
      void queryClient.invalidateQueries()
    }
    lastPending.current = queue.pending
  }, [queue.pending, queryClient])

  const syncNow = useCallback(async () => {
    if (!db) return
    if (!navigator.onLine) {
      throw new Error("There is no connection right now.")
    }
    const { restartSync } = await import("@/lib/sync/database")
    await restartSync()
    await refreshQueue()
    await queryClient.invalidateQueries()
  }, [db, refreshQueue, queryClient])

  const loadHistory = useCallback(async () => {
    if (!db) return []
    const rows = await db.getAll<AuditRow>(
      "SELECT * FROM sync_audit ORDER BY created_at DESC LIMIT 200",
    )
    return rows.map(toAuditEntry)
  }, [db])

  const clearHistory = useCallback(async () => {
    if (!db) return
    await db.execute("DELETE FROM sync_audit")
    await refreshQueue()
  }, [db, refreshQueue])

  const value = useMemo<SyncContextValue>(() => {
    const snapshot: SyncSnapshot = {
      ...IDLE_SNAPSHOT,
      ...status,
      ...queue,
      enabled,
      ready: db !== null,
      online,
    }
    return {
      snapshot,
      db,
      saveLocally: enabled && db !== null && !online,
      syncNow,
      loadHistory,
      clearHistory,
    }
  }, [status, queue, enabled, db, online, syncNow, loadHistory, clearHistory])

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
