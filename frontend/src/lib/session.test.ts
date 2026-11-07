import { afterEach, describe, expect, it, vi } from "vitest"

import { loginUrlFor, redirectToLogin, safeReturnTo } from "./session"

describe("safeReturnTo", () => {
  it("accepts in-app paths", () => {
    expect(safeReturnTo("/projects/4")).toBe("/projects/4")
    expect(safeReturnTo("/settings?tab=profile")).toBe("/settings?tab=profile")
  })

  it("rejects anything that could leave the app", () => {
    expect(safeReturnTo("https://evil.example/")).toBeUndefined()
    expect(safeReturnTo("//evil.example/")).toBeUndefined()
    expect(safeReturnTo("projects")).toBeUndefined()
    expect(safeReturnTo(42)).toBeUndefined()
    expect(safeReturnTo(undefined)).toBeUndefined()
  })
})

describe("loginUrlFor", () => {
  const at = (pathname: string, search = "", hash = "") => ({
    pathname,
    search,
    hash,
  })

  it("remembers where the person was, including query and hash", () => {
    expect(loginUrlFor(at("/projects/4", "?tab=drawings", "#pin-9"))).toBe(
      `/login?returnTo=${encodeURIComponent("/projects/4?tab=drawings#pin-9")}`,
    )
  })

  it("carries the reason so the gate can explain itself", () => {
    expect(loginUrlFor(at("/projects"), "expired")).toBe(
      "/login?returnTo=%2Fprojects&reason=expired",
    )
  })

  it("does not record the home page or the gate itself as a return target", () => {
    expect(loginUrlFor(at("/"))).toBe("/login")
    expect(loginUrlFor(at("/"), "expired")).toBe("/login?reason=expired")
    expect(loginUrlFor(at("/login", "?returnTo=%2Fx"))).toBe("/login")
  })
})

describe("redirectToLogin", () => {
  const originalLocation = window.location

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    })
  })

  const stubLocation = (pathname: string, search = "") => {
    const assign = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { pathname, search, hash: "", assign },
    })
    return assign
  }

  it("navigates to the gate with the return path on 401", () => {
    const assign = stubLocation("/projects/4")
    redirectToLogin("expired")
    expect(assign).toHaveBeenCalledWith(
      "/login?returnTo=%2Fprojects%2F4&reason=expired",
    )
  })

  it("never loops when already on the gate", () => {
    const assign = stubLocation("/login")
    redirectToLogin("expired")
    expect(assign).not.toHaveBeenCalled()
  })
})
