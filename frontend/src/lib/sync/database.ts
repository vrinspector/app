/**
 * The device's local SQLite copy (rebuild increment 18).
 *
 * Loaded on demand: this module (and with it PowerSync and its SQLite build)
 * is only imported when offline sync is switched on (config.ts), so builds
 * without `VITE_POWERSYNC_URL` never download it.
 */
import type { PowerSyncDatabase } from "@powersync/web"

import { OFFLINE_DB_FILENAME } from "./config"
import { fetchTransport, type TokenSource, VriConnector } from "./connector"
import { buildSchema } from "./schema"

let opening: Promise<PowerSyncDatabase> | null = null
let activeConnector: VriConnector | null = null

export function offlineDatabase(): Promise<PowerSyncDatabase> {
  if (!opening) {
    opening = import("@powersync/web").then(
      ({ PowerSyncDatabase }) =>
        new PowerSyncDatabase({
          schema: buildSchema(),
          database: { dbFilename: OFFLINE_DB_FILENAME },
        }),
    )
  }
  return opening
}

/** Starts (or restarts) syncing the signed-in person's projects. */
export async function startOfflineSync(options: {
  endpoint: string
  apiBase: string
  getToken: TokenSource
}): Promise<PowerSyncDatabase> {
  const db = await offlineDatabase()
  const connector = new VriConnector(
    options.endpoint,
    options.getToken,
    fetchTransport(options.apiBase, options.getToken),
  )
  activeConnector = connector
  await db.connect(connector)
  return db
}

/**
 * "Sync now" (increment 19): reconnects, which uploads anything waiting and
 * fetches the latest from the server straight away.
 */
export async function restartSync(): Promise<void> {
  if (!opening || !activeConnector) return
  const db = await opening
  await db.disconnect()
  await db.connect(activeConnector)
}

/**
 * Signing out removes the local copy, including anything not yet uploaded:
 * a shared tablet must not hand the next person someone else's projects.
 * The sign-out menu warns first when changes are still waiting (increment 19).
 */
export async function clearOfflineCopy(): Promise<void> {
  if (!opening) return
  const db = await opening
  activeConnector = null
  await db.disconnectAndClear()
}
