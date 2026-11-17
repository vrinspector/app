import { describe, expect, it } from "vitest"

import { shouldKeepCopy } from "@/hooks/useDrawingFile"

import {
  evictionsFor,
  KEPT_DRAWING_MAX_BYTES,
  type KeptIndex,
  keptDrawingKey,
  mayKeep,
} from "./offlineDrawings"

/*
 * Increment 21: drawings opened with signal are kept for viewing offline
 * only when the device storage check (increment 20) leaves room.
 */

const MB = 1024 * 1024

describe("keptDrawingKey", () => {
  it("uses the drawing id and S3 key, never a presigned URL", () => {
    const key = keptDrawingKey({
      id: 40,
      s3_key: "projects/7/drawings/a b.pdf",
    })
    expect(key).toContain("/40?")
    expect(key).toContain(encodeURIComponent("projects/7/drawings/a b.pdf"))
    expect(key).not.toMatch(/X-Amz|Signature/i)
  })
})

describe("mayKeep", () => {
  const roomy = { quota: 4000 * MB, usage: 100 * MB }
  it("keeps a drawing when the device has plenty of room", () => {
    expect(mayKeep(20 * MB, roomy)).toBe(true)
  })
  it("never keeps one when the device is getting full (photos come first)", () => {
    // 300 MB free − 100 MB file leaves less than the 250 MB "low" mark.
    expect(mayKeep(100 * MB, { quota: 1000 * MB, usage: 700 * MB })).toBe(false)
    expect(mayKeep(10 * MB, { quota: 1000 * MB, usage: 990 * MB })).toBe(false)
  })
  it("never keeps a file over the size limit or of no size", () => {
    expect(mayKeep(KEPT_DRAWING_MAX_BYTES + 1, roomy)).toBe(false)
    expect(mayKeep(0, roomy)).toBe(false)
  })
  it("keeps within its own limit when the browser will not say", () => {
    expect(mayKeep(5 * MB, null)).toBe(true)
  })
})

describe("evictionsFor", () => {
  const index: KeptIndex = {
    "1": { key: "k1", size: 100 * MB, openedAt: 1 },
    "2": { key: "k2", size: 100 * MB, openedAt: 3 },
    "3": { key: "k3", size: 80 * MB, openedAt: 2 },
  }
  it("removes nothing while everything fits", () => {
    expect(evictionsFor(index, 10 * MB)).toEqual([])
  })
  it("removes the least recently opened first", () => {
    expect(evictionsFor(index, 50 * MB)).toEqual(["1"])
    expect(evictionsFor(index, 150 * MB)).toEqual(["1", "3"])
  })
  it("does not count the drawing being replaced", () => {
    expect(evictionsFor(index, 120 * MB, undefined, "1")).toEqual([])
  })
})

describe("shouldKeepCopy", () => {
  it("downloads to keep only with offline sync on and a known, allowed size", () => {
    expect(shouldKeepCopy({ file_size: 5 * MB }, true)).toBe(true)
    expect(shouldKeepCopy({ file_size: 5 * MB }, false)).toBe(false)
    expect(shouldKeepCopy({ file_size: null }, true)).toBe(false)
    expect(
      shouldKeepCopy({ file_size: KEPT_DRAWING_MAX_BYTES + 1 }, true),
    ).toBe(false)
  })
})
