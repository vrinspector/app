/**
 * Device storage check for the offline photo queue (rebuild increment 20).
 *
 * Browsers give each site a share of the device's free space and report it
 * through `navigator.storage.estimate()`. Before a photo is kept on the
 * device the queue checks there is room for it plus a safety margin, and the
 * sync panel says plainly when the device is getting full.
 */

const MB = 1024 * 1024

/** Kept free so the app itself, the offline copy and the browser keep working. */
export const STORAGE_RESERVE_BYTES = 50 * MB
/** Below this much free space the sync panel warns. */
export const STORAGE_LOW_BYTES = 250 * MB

export type StorageLevel = "ok" | "low" | "full" | "unknown"

export interface StorageAssessment {
  level: StorageLevel
  /** Free space left for this app, in bytes (null when the browser will not say). */
  freeBytes: number | null
  /** Plain words for the person; empty when all is well. */
  message: string
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / MB
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 10) return `${Math.round(mb)} MB`
  return `${Math.max(0, mb).toFixed(1)} MB`
}

/**
 * How much room is left, given the browser's estimate and the size of what
 * is about to be stored (0 for a plain check).
 */
export function assessStorage(
  estimate: { quota?: number; usage?: number } | null | undefined,
  incomingBytes = 0,
): StorageAssessment {
  const quota = estimate?.quota
  const usage = estimate?.usage
  if (typeof quota !== "number" || typeof usage !== "number" || quota <= 0) {
    return { level: "unknown", freeBytes: null, message: "" }
  }
  const free = Math.max(0, quota - usage)
  if (free - incomingBytes < STORAGE_RESERVE_BYTES) {
    return {
      level: "full",
      freeBytes: free,
      message: `This device is nearly full (about ${formatMegabytes(free)} left for the app), so the photo cannot be kept on it. Upload the photos that are waiting when you have signal, or free up space on the device, then try again.`,
    }
  }
  if (free - incomingBytes < STORAGE_LOW_BYTES) {
    return {
      level: "low",
      freeBytes: free,
      message: `This device is getting full: about ${formatMegabytes(free)} left for the app. Photos taken without signal are kept on the device until they upload, so upload them when you can.`,
    }
  }
  return { level: "ok", freeBytes: free, message: "" }
}

/** The browser's estimate, or null where the browser has none. */
export async function estimateStorage(): Promise<{
  quota?: number
  usage?: number
} | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return null
    }
    return await navigator.storage.estimate()
  } catch {
    return null
  }
}

/**
 * Ask the browser not to clear this site's storage when space runs low, so
 * waiting photos are not evicted. Best effort: some browsers decide alone.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      return false
    }
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
