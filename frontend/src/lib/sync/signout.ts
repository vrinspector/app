import { isOfflineSyncEnabled } from "./config"

/** Removes the offline copy before sign-out (no-op when sync is off). */
export async function clearOfflineCopyBeforeSignOut(): Promise<void> {
  // The literal env check lets builds without a sync URL drop the import
  // (and PowerSync's SQLite) entirely.
  if (!import.meta.env.VITE_POWERSYNC_URL || !isOfflineSyncEnabled()) return
  try {
    const { clearOfflineCopy } = await import("./database")
    await clearOfflineCopy()
  } catch (error) {
    console.warn("Could not clear the offline copy", error)
  }
}
