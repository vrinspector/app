/**
 * Drawings kept on the device for viewing with no signal (rebuild
 * increment 21).
 *
 * When offline sync is on, a drawing file opened with signal is also kept in
 * the browser's own storage (the Cache API, under this app's origin), keyed
 * by the drawing's id and its S3 object key — never by the presigned URL,
 * which expires. Next time, with or without signal, the viewer opens that
 * copy instead of downloading the file again.
 *
 * Keeping a drawing never competes with photos waiting to upload
 * (increment 20): a file is kept only while the device storage check says
 * "ok" with the file included — never when the device is getting full — and
 * all kept drawings together stay under KEPT_DRAWINGS_LIMIT_BYTES, the least
 * recently opened going first. Signing out removes them.
 */
import type { DrawingPublic } from "@/client"
import { assessStorage, estimateStorage } from "@/lib/photoQueue/storage"

const MB = 1024 * 1024

export const DRAWINGS_CACHE = "vri-offline-drawings-v1"
const INDEX_KEY = "vri-offline-drawings-index-v1"
/** All kept drawings together. */
export const KEPT_DRAWINGS_LIMIT_BYTES = 300 * MB
/** One file larger than this is never kept (the upload limit is 50 MB). */
export const KEPT_DRAWING_MAX_BYTES = 60 * MB

export interface KeptEntry {
  /** The request key in the cache (drawing id + S3 key). */
  key: string
  size: number
  /** Last time it was opened (ms since epoch). */
  openedAt: number
}

export type KeptIndex = Record<string, KeptEntry>

type DrawingRef = Pick<DrawingPublic, "id" | "s3_key">

export function keptDrawingKey(drawing: DrawingRef): string {
  return `/__vri-offline-drawings/${drawing.id}?k=${encodeURIComponent(drawing.s3_key)}`
}

// ------------------------------------------------------------ the index

export function loadIndex(): KeptIndex {
  try {
    const raw = window.localStorage.getItem(INDEX_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === "object" ? (parsed as KeptIndex) : {}
  } catch {
    return {}
  }
}

function saveIndex(index: KeptIndex): void {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  } catch {
    // Storage unavailable: the cache entries still work, eviction is skipped.
  }
}

/**
 * Which kept drawings to remove so `incoming` more bytes fit under `limit`:
 * the least recently opened first. Pure, for the tests.
 */
export function evictionsFor(
  index: KeptIndex,
  incoming: number,
  limit = KEPT_DRAWINGS_LIMIT_BYTES,
  keep?: string,
): string[] {
  const entries = Object.entries(index).filter(([id]) => id !== keep)
  let total = entries.reduce((sum, [, entry]) => sum + (entry.size || 0), 0)
  const out: string[] = []
  for (const [id, entry] of entries.sort(
    (a, b) => a[1].openedAt - b[1].openedAt,
  )) {
    if (total + incoming <= limit) break
    out.push(id)
    total -= entry.size || 0
  }
  return out
}

/** Whether a file of `size` may be kept, given the device's estimate. */
export function mayKeep(
  size: number,
  estimate: { quota?: number; usage?: number } | null,
): boolean {
  if (!Number.isFinite(size) || size <= 0) return false
  if (size > KEPT_DRAWING_MAX_BYTES) return false
  // Unknown space (the browser will not say): keep, within our own limit.
  const level = assessStorage(estimate, size).level
  return level === "ok" || level === "unknown"
}

// ------------------------------------------------------------ the cache

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null
    return await caches.open(DRAWINGS_CACHE)
  } catch {
    return null
  }
}

/** The kept copy of this drawing, or null. Marks it as just opened. */
export async function getKeptDrawing(
  drawing: DrawingRef,
): Promise<Blob | null> {
  const cache = await openCache()
  if (!cache) return null
  try {
    const response = await cache.match(keptDrawingKey(drawing))
    if (!response) return null
    const blob = await response.blob()
    const index = loadIndex()
    const id = String(drawing.id)
    index[id] = {
      key: keptDrawingKey(drawing),
      size: blob.size,
      openedAt: Date.now(),
    }
    saveIndex(index)
    return blob
  } catch {
    return null
  }
}

export type KeepResult = "kept" | "no-room" | "unsupported"

/** Keep this file for viewing with no signal, if there is room. */
export async function keepDrawing(
  drawing: DrawingRef,
  blob: Blob,
): Promise<KeepResult> {
  const cache = await openCache()
  if (!cache) return "unsupported"
  if (!mayKeep(blob.size, await estimateStorage())) return "no-room"
  const id = String(drawing.id)
  const index = loadIndex()
  try {
    // An older file of the same drawing id is replaced.
    const previous = index[id]
    if (previous && previous.key !== keptDrawingKey(drawing)) {
      await cache.delete(previous.key)
    }
    for (const evict of evictionsFor(index, blob.size, undefined, id)) {
      await cache.delete(index[evict].key)
      delete index[evict]
    }
    await cache.put(
      keptDrawingKey(drawing),
      new Response(blob, {
        headers: { "Content-Type": blob.type || "application/octet-stream" },
      }),
    )
    index[id] = {
      key: keptDrawingKey(drawing),
      size: blob.size,
      openedAt: Date.now(),
    }
    saveIndex(index)
    return "kept"
  } catch {
    // Quota exceeded or storage blocked: viewing still works from the server.
    return "no-room"
  }
}

/** Sign-out: remove every kept drawing. */
export async function clearKeptDrawings(): Promise<void> {
  try {
    window.localStorage.removeItem(INDEX_KEY)
  } catch {
    // ignore
  }
  try {
    if (typeof caches !== "undefined") await caches.delete(DRAWINGS_CACHE)
  } catch {
    // ignore
  }
}
