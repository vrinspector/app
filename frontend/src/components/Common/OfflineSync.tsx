import { useAuth0 } from "@auth0/auth0-react"
import { useEffect } from "react"

import { isOfflineSyncEnabled, powerSyncUrl } from "@/lib/sync/config"

/**
 * Keeps the device's offline copy in sync while someone is signed in
 * (rebuild increment 18). Renders nothing; does nothing at all unless the
 * build names a PowerSync service (VITE_POWERSYNC_URL). The screens still
 * read and write through the API; increment 19 adds the offline indicators
 * and moves the capture screens onto the local copy.
 */
export function OfflineSync() {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0()

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
      .then(({ startOfflineSync }) => {
        if (cancelled) return
        return startOfflineSync({
          endpoint,
          apiBase: import.meta.env.VITE_API_URL ?? "",
          getToken,
        })
      })
      .catch((error: unknown) => {
        // Offline sync is an extra: the app keeps working online without it.
        console.warn("Offline sync could not start", error)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, getAccessTokenSilently])

  return null
}
