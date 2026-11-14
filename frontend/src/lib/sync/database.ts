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
  await db.connect(connector)
  return db
}

/**
 * Signing out removes the local copy, including anything not yet uploaded:
 * a shared tablet must not hand the next person someone else's projects.
 * (Increment 19 adds the warning before sign-out when changes are waiting.)
 */
export async function clearOfflineCopy(): Promise<void> {
  if (!opening) return
  const db = await opening
  await db.disconnectAndClear()
}
