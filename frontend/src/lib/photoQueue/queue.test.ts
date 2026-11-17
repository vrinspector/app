import { describe, expect, it, vi } from "vitest"

import type { PhotoUploadDeps, RegisterBody } from "./process"
import { isTransient, uploadQueuedPhoto } from "./process"
import { PhotoQueue, PhotoQueueError } from "./queue"
import {
  assessStorage,
  STORAGE_LOW_BYTES,
  STORAGE_RESERVE_BYTES,
} from "./storage"
import { memoryPhotoStore } from "./store"
import type { PhotoTarget } from "./types"

/*
 * Increment 20: the offline photo queue — kept on the device, sent later
 * through presign → S3 → register, never dropped silently.
 */

const MB = 1024 * 1024
const ROOMY = async () => ({ quota: 2000 * MB, usage: 100 * MB })

class HttpError extends Error {
  constructor(
    message: string,
    readonly code: number | undefined,
  ) {
    super(message)
  }
}

function photoFile(name = "IMG_0001.jpg", bytes = "jpeg-bytes"): File {
  return new File([bytes], name, {
    type: "image/jpeg",
    lastModified: Date.parse("2026-11-16T08:15:00Z"),
  })
}

function makeDeps(overrides: Partial<PhotoUploadDeps> = {}) {
  const registered: RegisterBody[] = []
  const puts: Array<{ url: string; file: File }> = []
  let presigns = 0
  const deps: PhotoUploadDeps = {
    presign: vi.fn(async () => {
      presigns += 1
      return { upload_url: `https://s3/${presigns}`, s3_key: `key-${presigns}` }
    }),
    put: vi.fn(async (url: string, file: File) => {
      puts.push({ url, file })
    }),
    register: vi.fn(async (body: RegisterBody) => {
      registered.push(body)
      return { id: 500 + registered.length }
    }),
    resolveLocal: vi.fn(async () => ({ state: "waiting" as const })),
    describe: (error) => (error instanceof Error ? error.message : "failed"),
    status: (error) => (error instanceof HttpError ? error.code : undefined),
    ...overrides,
  }
  return { deps, registered, puts }
}

function newQueue() {
  return new PhotoQueue(memoryPhotoStore(), ROOMY, async () => true)
}

async function add(
  queue: PhotoQueue,
  target: PhotoTarget,
  file = photoFile(),
  description = "Site photo",
) {
  return queue.enqueue({
    file,
    target,
    description,
    uploadedBy: "Stacey",
    filename: file.name,
    contentType: file.type,
    capturedAt: new Date(file.lastModified).toISOString(),
  })
}

describe("assessStorage", () => {
  it("is unknown when the browser gives no estimate", () => {
    expect(assessStorage(null).level).toBe("unknown")
    expect(assessStorage({ quota: 0, usage: 0 }).level).toBe("unknown")
  })

  it("is fine with plenty of room", () => {
    expect(assessStorage({ quota: 2000 * MB, usage: 10 * MB }, 5 * MB)).toEqual(
      { level: "ok", freeBytes: 1990 * MB, message: "" },
    )
  })

  it("warns when the device is getting full", () => {
    const result = assessStorage({
      quota: 1000 * MB,
      usage: 1000 * MB - (STORAGE_LOW_BYTES - MB),
    })
    expect(result.level).toBe("low")
    expect(result.message).toMatch(/getting full: about \d+ MB left/)
  })

  it("refuses when the photo would eat the reserve", () => {
    const result = assessStorage(
      { quota: 1000 * MB, usage: 1000 * MB - STORAGE_RESERVE_BYTES - 2 * MB },
      4 * MB,
    )
    expect(result.level).toBe("full")
    expect(result.message).toMatch(/nearly full/)
  })
})

describe("isTransient", () => {
  it("retries no answer, sign-in, rate limits and server errors only", () => {
    for (const status of [undefined, 0, 401, 408, 425, 429, 500, 503]) {
      expect(isTransient(status)).toBe(true)
    }
    for (const status of [400, 403, 404, 409, 413, 422]) {
      expect(isTransient(status)).toBe(false)
    }
  })
})

describe("uploadQueuedPhoto", () => {
  it("sends the original file and links it to an ITP line and slot", async () => {
    const queue = newQueue()
    const file = photoFile("rebar.jpg", "original-bytes")
    await add(queue, { kind: "itp_item", itemId: "42", slot: "closeup" }, file)
    const { deps, registered, puts } = makeDeps()
    const result = await queue.drain(deps)
    expect(result.uploaded).toHaveLength(1)
    expect(deps.presign).toHaveBeenCalledWith({
      itp_item_id: 42,
      filename: "rebar.jpg",
      content_type: "image/jpeg",
    })
    expect(await puts[0].file.text()).toBe("original-bytes")
    expect(puts[0].file.lastModified).toBe(file.lastModified)
    expect(registered[0]).toEqual({
      itp_item_id: 42,
      shot_slot: "closeup",
      filename: "rebar.jpg",
      content_type: "image/jpeg",
      s3_key: "key-1",
      uploaded_by: "Stacey",
      captured_at: "2026-11-16T08:15:00.000Z",
    })
    // Gone from the device once the server has it; the history says so.
    expect(queue.getSnapshot().items).toHaveLength(0)
    const history = await queue.history()
    expect(history[0]).toMatchObject({
      outcome: "applied",
      detail: "Uploaded.",
    })
  })

  it("files a finding photo under a finding made offline once it uploads", async () => {
    const queue = newQueue()
    await add(queue, {
      kind: "finding",
      inspectionId: "7",
      findingId: "local-abc",
    })
    const waiting = makeDeps()
    let result = await queue.drain(waiting.deps)
    expect(result.waiting).toBe(1)
    expect(waiting.deps.presign).not.toHaveBeenCalled()
    expect(queue.getSnapshot().items[0]).toMatchObject({
      status: "waiting",
      error: expect.stringMatching(/Waiting for the finding/),
    })

    const ready = makeDeps({
      resolveLocal: vi.fn(async () => ({
        state: "uploaded" as const,
        serverId: "91",
      })),
    })
    result = await queue.drain(ready.deps)
    expect(result.uploaded).toHaveLength(1)
    expect(ready.registered[0]).toMatchObject({
      inspection_id: 7,
      finding_id: 91,
    })
  })

  it("keeps the photo with a reason when its offline parent was refused", async () => {
    const queue = newQueue()
    await add(queue, {
      kind: "finding",
      inspectionId: "7",
      findingId: "local-abc",
    })
    const { deps } = makeDeps({
      resolveLocal: vi.fn(async () => ({
        state: "refused" as const,
        reason: "The inspection is signed off",
      })),
    })
    const result = await queue.drain(deps)
    expect(result.failed).toBe(1)
    const [item] = queue.getSnapshot().items
    expect(item.status).toBe("failed")
    expect(item.error).toMatch(/was not accepted by the server/)
    expect(queue.getSnapshot().failed).toBe(1)
  })

  it("keeps a refused photo on the device with the API's reason", async () => {
    const queue = newQueue()
    await add(queue, { kind: "inspection", inspectionId: "7" })
    const { deps } = makeDeps({
      register: vi.fn(async () => {
        throw new HttpError("Inspection is signed off", 409)
      }),
    })
    await queue.drain(deps)
    const [item] = queue.getSnapshot().items
    expect(item).toMatchObject({
      status: "failed",
      error: "Inspection is signed off",
      attempts: 1,
    })
    const [line] = await queue.history()
    expect(line.outcome).toBe("refused")
    expect(line.detail).toMatch(/still on this device/)

    // Retry puts it back in line, and it goes once the server accepts.
    await queue.retry(item.id)
    expect(queue.getSnapshot().items[0].status).toBe("waiting")
    const ok = makeDeps()
    expect((await queue.drain(ok.deps)).uploaded).toHaveLength(1)
  })

  it("stops at the first photo that finds no signal and keeps them all", async () => {
    const queue = newQueue()
    await add(queue, { kind: "inspection", inspectionId: "7" })
    await add(queue, { kind: "inspection", inspectionId: "7" })
    const { deps } = makeDeps({
      presign: vi.fn(async () => {
        throw new HttpError("Could not reach the server", undefined)
      }),
    })
    const result = await queue.drain(deps)
    expect(deps.presign).toHaveBeenCalledTimes(1)
    expect(result.waiting).toBe(2)
    expect(queue.getSnapshot()).toMatchObject({ waiting: 2, failed: 0 })
  })

  it("asks for a fresh upload link once when S3 says it expired", async () => {
    const queue = newQueue()
    await add(queue, { kind: "inspection", inspectionId: "7" })
    let calls = 0
    const { deps, registered } = makeDeps({
      put: vi.fn(async () => {
        calls += 1
        if (calls === 1)
          throw new HttpError("Storage upload failed (403).", 403)
      }),
    })
    await queue.drain(deps)
    expect(deps.presign).toHaveBeenCalledTimes(2)
    expect(registered[0].s3_key).toBe("key-2")
  })

  it("never throws, whatever goes wrong", async () => {
    const { deps } = makeDeps({
      presign: vi.fn(async () => {
        throw new Error("boom")
      }),
    })
    const outcome = await uploadQueuedPhoto(
      {
        id: "q1",
        file: photoFile(),
        target: { kind: "inspection", inspectionId: "not-a-number" },
        filename: "a.jpg",
        contentType: "image/jpeg",
        capturedAt: null,
        size: 3,
        uploadedBy: null,
        description: "x",
        queuedAt: "2026-11-16T08:00:00Z",
        status: "waiting",
        error: null,
        attempts: 0,
        lastAttemptAt: null,
      },
      deps,
    )
    expect(outcome.kind).toBe("failed")
  })
})

describe("PhotoQueue", () => {
  it("refuses to keep a photo when the device is nearly full", async () => {
    const queue = new PhotoQueue(
      memoryPhotoStore(),
      async () => ({ quota: 100 * MB, usage: 99 * MB }),
      async () => true,
    )
    await expect(
      add(queue, { kind: "inspection", inspectionId: "7" }),
    ).rejects.toBeInstanceOf(PhotoQueueError)
    expect(queue.getSnapshot().items).toHaveLength(0)
  })

  it("asks the browser to keep the photos when space runs low", async () => {
    const persist = vi.fn(async () => true)
    const queue = new PhotoQueue(memoryPhotoStore(), ROOMY, persist)
    await add(queue, { kind: "inspection", inspectionId: "7" })
    expect(persist).toHaveBeenCalled()
  })

  it("puts a photo left uploading by a closed tab back in line", async () => {
    const store = memoryPhotoStore()
    const queue = new PhotoQueue(store, ROOMY, async () => true)
    const id = await add(queue, { kind: "inspection", inspectionId: "7" })
    await store.patch(id, { status: "uploading" })
    await queue.recover()
    expect(queue.getSnapshot().items[0].status).toBe("waiting")
  })

  it("deletes one photo, or everything at sign-out", async () => {
    const queue = newQueue()
    const first = await add(queue, { kind: "inspection", inspectionId: "7" })
    await add(queue, { kind: "inspection", inspectionId: "8" })
    await queue.remove(first)
    expect(queue.getSnapshot().items).toHaveLength(1)
    await queue.clear()
    expect(queue.getSnapshot()).toMatchObject({ waiting: 0, failed: 0 })
    expect(await queue.history()).toEqual([])
  })

  it("tells subscribers when the list changes", async () => {
    const queue = newQueue()
    const listener = vi.fn()
    queue.subscribe(listener)
    await add(queue, { kind: "inspection", inspectionId: "7" })
    expect(listener).toHaveBeenCalled()
    expect(queue.getSnapshot().waiting).toBe(1)
  })

  it("runs one drain at a time", async () => {
    const queue = newQueue()
    await add(queue, { kind: "inspection", inspectionId: "7" })
    const { deps, registered } = makeDeps()
    await Promise.all([queue.drain(deps), queue.drain(deps)])
    expect(registered).toHaveLength(1)
  })
})
