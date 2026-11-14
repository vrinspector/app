/**
 * Offline sync switch (rebuild increment 18).
 *
 * Offline sync is on only when the build names a PowerSync service
 * (`VITE_POWERSYNC_URL`). Without it nothing PowerSync-related is loaded and
 * the app behaves exactly as before — the same pattern as the AI features,
 * which stay hidden until their key is set at RG-3.
 */
export function powerSyncUrl(
  env: { VITE_POWERSYNC_URL?: string } = import.meta.env,
): string | null {
  const url = env.VITE_POWERSYNC_URL?.trim()
  if (!url) return null
  return url.replace(/\/+$/, "")
}

export function isOfflineSyncEnabled(
  env: { VITE_POWERSYNC_URL?: string } = import.meta.env,
): boolean {
  return powerSyncUrl(env) !== null
}

/** Name of the local SQLite file in the browser (one per device profile). */
export const OFFLINE_DB_FILENAME = "vri-offline.sqlite"
