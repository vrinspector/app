import { photoQueue } from "@/lib/photoQueue"

import { isOfflineSyncEnabled } from "./config"

/**
 * Removes the offline copy before sign-out: photos kept on the device
 * (increment 20, in every build) and the PowerSync copy (when sync is on).
 * A shared tablet must not hand the next person someone else's photos.
 */
export async function clearOfflineCopyBeforeSignOut(): Promise<void> {
  try {
    await photoQueue.clear()
  } catch (error) {
    console.warn("Could not clear the photos kept on this device", error)
  }
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
