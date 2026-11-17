/**
 * Installable app — shared state (rebuild increment 21).
 *
 * No service-worker code is imported here, so screens (and the clickable
 * demo, which has no service worker) can read the state in every build. The
 * real app's entry point registers the service worker (register.ts) and
 * reports into this store; outside that, nothing is ever reported and the
 * "Update available" notice simply never shows.
 */
import { useSyncExternalStore } from "react"

export interface PwaState {
  /** A new version has been downloaded and is waiting for a reload. */
  updateAvailable: boolean
  /** The app's own files are kept on this device (it can open offline). */
  offlineReady: boolean
}

type Listener = () => void

let state: PwaState = { updateAvailable: false, offlineReady: false }
let applyUpdate: (() => Promise<void>) | null = null
const listeners = new Set<Listener>()

function emit(next: Partial<PwaState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

export function reportUpdateAvailable(apply: () => Promise<void>): void {
  applyUpdate = apply
  emit({ updateAvailable: true })
}

export function reportOfflineReady(): void {
  emit({ offlineReady: true })
}

/** "Later": hide the notice until the next version (or the next start). */
export function dismissUpdate(): void {
  emit({ updateAvailable: false })
}

/** Switch to the waiting version and reload the page. */
export async function reloadForUpdate(): Promise<void> {
  if (applyUpdate) {
    await applyUpdate()
    return
  }
  window.location.reload()
}

export function getPwaState(): PwaState {
  return state
}

export function subscribePwa(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(subscribePwa, getPwaState, getPwaState)
}

/** Test helper: back to the start state. */
export function resetPwaStateForTests(): void {
  state = { updateAvailable: false, offlineReady: false }
  applyUpdate = null
  listeners.clear()
}

/**
 * Pages that stay online-only and must not install the service worker on a
 * visitor's device: the public signing page (external signers) and the
 * public ITP generator (anonymous visitors). Mirrors ONLINE_ONLY_NAVIGATIONS
 * in src/lib/pwa/config.ts.
 */
export function isPublicOnlinePage(pathname: string): boolean {
  return pathname.startsWith("/sign/") || pathname.startsWith("/itp-generator")
}

/** True when the app was opened from the home-screen icon. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  try {
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true
  } catch {
    // matchMedia unsupported: fall through
  }
  return Boolean(
    (window.navigator as Navigator & { standalone?: boolean }).standalone,
  )
}
