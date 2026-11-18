import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { UpdateNotice } from "@/components/Common/UpdateNotice"

import { ONLINE_ONLY_NAVIGATIONS, pwaOptions } from "./config"
import {
  getPwaState,
  isPublicOnlinePage,
  reportOfflineReady,
  reportUpdateAvailable,
  resetPwaStateForTests,
} from "./state"

/*
 * Increment 21: installable app — what the service worker may keep, where
 * it is installed, and the "Update available — reload" notice.
 */

afterEach(() => {
  resetPwaStateForTests()
})

describe("service worker configuration", () => {
  const workbox = pwaOptions.workbox ?? {}

  it("never caches API answers, presigned URLs or tokens", () => {
    expect(workbox.runtimeCaching ?? []).toEqual([])
    // Only the app's own build files are precached.
    for (const pattern of workbox.globPatterns ?? []) {
      expect(pattern).not.toMatch(/json/)
    }
  })

  it("leaves the API and the public pages to the network", () => {
    const leftAlone = (path: string) =>
      ONLINE_ONLY_NAVIGATIONS.some((re) => re.test(path))
    for (const path of [
      "/api/v1/projects/",
      "/docs",
      "/sign/abc123",
      "/itp-generator",
      "/itp-generator/drafts/x",
    ]) {
      expect(leftAlone(path)).toBe(true)
    }
    for (const path of ["/", "/projects", "/projects/7/drawings/40", "/help"]) {
      expect(leftAlone(path)).toBe(false)
    }
    expect(workbox.navigateFallbackDenylist).toBe(ONLINE_ONLY_NAVIGATIONS)
  })

  it("asks before switching to a new version", () => {
    expect(pwaOptions.registerType).toBe("prompt")
    expect(workbox.skipWaiting).toBe(false)
  })

  it("installs with the brand name, colours and icons", () => {
    const manifest = pwaOptions.manifest
    expect(manifest && typeof manifest === "object").toBe(true)
    if (!manifest) return
    expect(manifest.name).toBe("VR Inspector")
    expect(manifest.display).toBe("standalone")
    expect(manifest.theme_color).toBe("#2E3D2E")
    expect(manifest.background_color).toBe("#F7F5F0")
    expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBe(
      true,
    )
  })
})

describe("isPublicOnlinePage", () => {
  it("is true for the signing page and the public generator only", () => {
    expect(isPublicOnlinePage("/sign/abc")).toBe(true)
    expect(isPublicOnlinePage("/itp-generator")).toBe(true)
    expect(isPublicOnlinePage("/login")).toBe(false)
    expect(isPublicOnlinePage("/projects/1")).toBe(false)
  })
})

describe("UpdateNotice", () => {
  it("stays hidden until a new version is waiting", () => {
    render(<UpdateNotice />)
    expect(screen.queryByTestId("update-notice")).toBeNull()
    act(() => reportOfflineReady())
    expect(screen.queryByTestId("update-notice")).toBeNull()
    expect(getPwaState().offlineReady).toBe(true)
  })

  it("reloads into the new version only when asked", async () => {
    const apply = vi.fn(async () => {})
    render(<UpdateNotice />)
    act(() => reportUpdateAvailable(apply))
    expect(screen.getByTestId("update-notice")).toHaveTextContent(
      "Update available",
    )
    expect(apply).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId("update-reload"))
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it("can be put off until later", async () => {
    render(<UpdateNotice />)
    act(() => reportUpdateAvailable(async () => {}))
    await userEvent.click(screen.getByTestId("update-later"))
    expect(screen.queryByTestId("update-notice")).toBeNull()
  })
})
