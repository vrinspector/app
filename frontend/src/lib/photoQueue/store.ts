/**
 * Where queued photos live on the device (rebuild increment 20).
 *
 * The browser's own database (IndexedDB), one record per photo. The bytes
 * are stored as an ArrayBuffer together with the file's name, type and date,
 * and handed back as the same `File` — the original, byte for byte (EXIF and
 * all); nothing is resized or re-encoded. ArrayBuffer rather than Blob
 * because some Safari versions lose Blobs kept in IndexedDB.
 *
 * `memoryPhotoStore()` is the same contract in memory, for tests.
 */
import type { PhotoHistoryEntry, QueuedPhoto, QueuedPhotoMeta } from "./types"

export interface PhotoStore {
  /** Every queued photo without its bytes, oldest first. */
  list(): Promise<QueuedPhotoMeta[]>
  /** One photo with its bytes. */
  get(id: string): Promise<QueuedPhoto | undefined>
  put(photo: QueuedPhoto): Promise<void>
  /** Update the record's details (not the bytes). */
  patch(id: string, changes: Partial<QueuedPhotoMeta>): Promise<void>
  remove(id: string): Promise<void>
  /** Remove everything (sign-out). */
  clear(): Promise<void>
  history(): Promise<PhotoHistoryEntry[]>
  addHistory(entry: PhotoHistoryEntry): Promise<void>
  clearHistory(): Promise<void>
}

/** Newest history lines kept on the device. */
export const HISTORY_LIMIT = 200

function byQueuedAt(a: QueuedPhotoMeta, b: QueuedPhotoMeta): number {
  return a.queuedAt.localeCompare(b.queuedAt)
}

function withoutFile(photo: QueuedPhoto): QueuedPhotoMeta {
  const { file: _file, ...meta } = photo
  return meta
}

export function memoryPhotoStore(): PhotoStore {
  const photos = new Map<string, QueuedPhoto>()
  let history: PhotoHistoryEntry[] = []
  return {
    async list() {
      return [...photos.values()].map(withoutFile).sort(byQueuedAt)
    },
    async get(id) {
      return photos.get(id)
    },
    async put(photo) {
      photos.set(photo.id, photo)
    },
    async patch(id, changes) {
      const current = photos.get(id)
      if (current) photos.set(id, { ...current, ...changes, id })
    },
    async remove(id) {
      photos.delete(id)
    },
    async clear() {
      photos.clear()
      history = []
    },
    async history() {
      return [...history].sort((a, b) => b.at.localeCompare(a.at))
    },
    async addHistory(entry) {
      history = [entry, ...history].slice(0, HISTORY_LIMIT)
    },
    async clearHistory() {
      history = []
    },
  }
}

// ---------------------------------------------------------------------------
// IndexedDB

export const PHOTO_DB_NAME = "vri-photo-queue"
const PHOTO_DB_VERSION = 1
const PHOTOS = "photos"
const BYTES = "bytes"
const HISTORY = "history"

interface StoredBytes {
  id: string
  buffer: ArrayBuffer
  name: string
  type: string
  lastModified: number
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error("Storage write aborted."))
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(PHOTO_DB_NAME, PHOTO_DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(BYTES)) {
        db.createObjectStore(BYTES, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(HISTORY)) {
        db.createObjectStore(HISTORY, { keyPath: "id" })
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
    open.onblocked = () =>
      reject(new Error("The photo store is open in another tab."))
  })
}

export function indexedDbPhotoStore(
  factory: IDBFactory = indexedDB,
): PhotoStore {
  let opening: Promise<IDBDatabase> | null = null
  const db = () => {
    if (!opening) {
      opening = openDatabase(factory).catch((error) => {
        opening = null
        throw error
      })
    }
    return opening
  }

  return {
    async list() {
      const tx = (await db()).transaction(PHOTOS, "readonly")
      const rows = (await request(
        tx.objectStore(PHOTOS).getAll(),
      )) as QueuedPhotoMeta[]
      return rows.sort(byQueuedAt)
    },
    async get(id) {
      const tx = (await db()).transaction([PHOTOS, BYTES], "readonly")
      const meta = (await request(tx.objectStore(PHOTOS).get(id))) as
        | QueuedPhotoMeta
        | undefined
      const bytes = (await request(tx.objectStore(BYTES).get(id))) as
        | StoredBytes
        | undefined
      if (!meta || !bytes) return undefined
      const file = new File([bytes.buffer], bytes.name, {
        type: bytes.type,
        lastModified: bytes.lastModified,
      })
      return { ...meta, file }
    },
    async put(photo) {
      // Read the bytes before the transaction: an await inside it would end it.
      const buffer = await photo.file.arrayBuffer()
      const tx = (await db()).transaction([PHOTOS, BYTES], "readwrite")
      tx.objectStore(PHOTOS).put(withoutFile(photo))
      tx.objectStore(BYTES).put({
        id: photo.id,
        buffer,
        name: photo.file.name,
        type: photo.file.type,
        lastModified: photo.file.lastModified,
      } satisfies StoredBytes)
      await done(tx)
    },
    async patch(id, changes) {
      const tx = (await db()).transaction(PHOTOS, "readwrite")
      const store = tx.objectStore(PHOTOS)
      const current = (await request(store.get(id))) as
        | QueuedPhotoMeta
        | undefined
      if (current) store.put({ ...current, ...changes, id })
      await done(tx)
    },
    async remove(id) {
      const tx = (await db()).transaction([PHOTOS, BYTES], "readwrite")
      tx.objectStore(PHOTOS).delete(id)
      tx.objectStore(BYTES).delete(id)
      await done(tx)
    },
    async clear() {
      const tx = (await db()).transaction([PHOTOS, BYTES, HISTORY], "readwrite")
      tx.objectStore(PHOTOS).clear()
      tx.objectStore(BYTES).clear()
      tx.objectStore(HISTORY).clear()
      await done(tx)
    },
    async history() {
      const tx = (await db()).transaction(HISTORY, "readonly")
      const rows = (await request(
        tx.objectStore(HISTORY).getAll(),
      )) as PhotoHistoryEntry[]
      return rows.sort((a, b) => b.at.localeCompare(a.at))
    },
    async addHistory(entry) {
      const tx = (await db()).transaction(HISTORY, "readwrite")
      const store = tx.objectStore(HISTORY)
      store.put(entry)
      const rows = (await request(store.getAll())) as PhotoHistoryEntry[]
      if (rows.length > HISTORY_LIMIT) {
        rows.sort((a, b) => a.at.localeCompare(b.at))
        for (const old of rows.slice(0, rows.length - HISTORY_LIMIT)) {
          store.delete(old.id)
        }
      }
      await done(tx)
    },
    async clearHistory() {
      const tx = (await db()).transaction(HISTORY, "readwrite")
      tx.objectStore(HISTORY).clear()
      await done(tx)
    },
  }
}
