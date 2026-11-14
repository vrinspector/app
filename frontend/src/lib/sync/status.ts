/**
 * Offline sync status, in words a site inspector can act on (rebuild
 * increment 19, PRD v2.63 Block 11 "visible unsynced indicators … manual
 * sync trigger").
 *
 * Pure functions only: the provider (components/Common/SyncProvider.tsx)
 * feeds them PowerSync's status and the device's upload queue, and the
 * header indicator, the sync panel and the sign-out warning read the result.
 */

/** Everything the screens need to know about this device's sync. */
export interface SyncSnapshot {
  /** The build names a PowerSync service (VITE_POWERSYNC_URL). */
  enabled: boolean
  /** The local copy is open and syncing has been started. */
  ready: boolean
  /** The browser believes it has a network connection. */
  online: boolean
  /** Connected to the PowerSync service right now. */
  connected: boolean
  /** Sending queued changes to the API right now. */
  uploading: boolean
  /** Receiving changes from the server right now. */
  downloading: boolean
  /** When this device last finished a full download (ISO string). */
  lastSyncedAt: string | null
  /** Changes made on this device that the server has not accepted yet. */
  pending: number
  /** `table:id` of every row with a change waiting to upload. */
  pendingKeys: ReadonlySet<string>
  /** Changes the server refused (kept in the sync history). */
  refused: number
  /** Changes that replaced a newer server version (last write wins). */
  overwritten: number
  /** The last upload or download error, in plain words. */
  error: string | null
}

export const IDLE_SNAPSHOT: SyncSnapshot = {
  enabled: false,
  ready: false,
  online: true,
  connected: false,
  uploading: false,
  downloading: false,
  lastSyncedAt: null,
  pending: 0,
  pendingKeys: new Set(),
  refused: 0,
  overwritten: 0,
  error: null,
}

export function rowKey(table: string, id: string | number): string {
  return `${table}:${id}`
}

/**
 * The rows with a change waiting, from PowerSync's internal upload queue
 * (`SELECT data FROM ps_crud`). Each `data` is the JSON PowerSync stores
 * for one local write: `{"op":"PATCH","type":"findings","id":"42",…}`.
 */
export function pendingKeysFromCrud(
  rows: ReadonlyArray<{ data: string | null }>,
): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    if (!row.data) continue
    try {
      const entry = JSON.parse(row.data) as { type?: unknown; id?: unknown }
      if (typeof entry.type === "string" && entry.id !== undefined) {
        keys.add(rowKey(entry.type, String(entry.id)))
      }
    } catch {
      // A malformed entry is PowerSync's business, not a reason to fail.
    }
  }
  return keys
}

export type SyncTone = "hidden" | "synced" | "syncing" | "waiting" | "offline"

export interface SyncSummary {
  tone: SyncTone
  /** Short label for the header chip. */
  label: string
  /** One sentence for the panel and the chip's accessible name. */
  detail: string
}

function changes(count: number): string {
  return `${count} change${count === 1 ? "" : "s"}`
}

/** What the header chip says. */
export function summarizeSync(snapshot: SyncSnapshot): SyncSummary {
  if (!snapshot.online) {
    if (!snapshot.enabled || !snapshot.ready) {
      return {
        tone: "offline",
        label: "Offline",
        detail:
          "No connection. What is already on screen stays visible; saving needs a connection.",
      }
    }
    return {
      tone: "offline",
      label: snapshot.pending
        ? `Offline · ${snapshot.pending} waiting`
        : "Offline",
      detail: snapshot.pending
        ? `No connection. ${changes(snapshot.pending)} saved on this device will upload when you are back online.`
        : "No connection. Findings and pins you save are kept on this device and upload when you are back online.",
    }
  }
  if (!snapshot.enabled || !snapshot.ready) {
    return { tone: "hidden", label: "", detail: "" }
  }
  if (snapshot.uploading || (snapshot.downloading && !snapshot.lastSyncedAt)) {
    return {
      tone: "syncing",
      label: "Syncing…",
      detail: snapshot.pending
        ? `Uploading ${changes(snapshot.pending)} from this device.`
        : "Bringing this device up to date.",
    }
  }
  if (snapshot.pending > 0) {
    return {
      tone: "waiting",
      label: `${snapshot.pending} waiting`,
      detail: snapshot.error
        ? `${changes(snapshot.pending)} not uploaded yet: ${snapshot.error}`
        : `${changes(snapshot.pending)} not uploaded yet.`,
    }
  }
  return {
    tone: "synced",
    label: "Synced",
    detail: "Everything on this device is uploaded.",
  }
}

/** Plain-words version of an upload or download error. */
export function describeSyncError(error: unknown): string | null {
  if (!error) return null
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  if (/fetch|network|reach|offline|socket/i.test(message)) {
    return "the server could not be reached"
  }
  if (/401|token|credential|auth/i.test(message)) {
    return "your sign-in needs refreshing"
  }
  return message ? message.slice(0, 160) : "something went wrong"
}
