/**
 * Session helpers shared by the API client (main.tsx) and the sign-in page.
 *
 * The Auth0 SDK owns the tokens. What the app adds is the hand-off when the
 * API rejects a request with 401: send the person to /login, remember where
 * they were so sign-in brings them straight back, and tell them why.
 */

export type LoginReason = "expired"

export interface LocationLike {
  pathname: string
  search: string
  hash: string
}

/** Only ever send people back to a path inside this app. */
export function safeReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (!value.startsWith("/") || value.startsWith("//")) return undefined
  return value
}

/**
 * `/login?returnTo=<where they were>&reason=expired`. The return target is
 * omitted for the home page (nothing to restore) and when already on /login
 * (never loop back into the gate).
 */
export function loginUrlFor(
  location: LocationLike,
  reason?: LoginReason,
): string {
  const params = new URLSearchParams()
  const here = `${location.pathname}${location.search}${location.hash}`
  if (
    location.pathname !== "/" &&
    location.pathname !== "/login" &&
    safeReturnTo(here)
  ) {
    params.set("returnTo", here)
  }
  if (reason) params.set("reason", reason)
  const query = params.toString()
  return query ? `/login?${query}` : "/login"
}

/** Full-page navigation to the sign-in gate (clears in-memory state too). */
export function redirectToLogin(reason?: LoginReason): void {
  const target = loginUrlFor(window.location, reason)
  if (window.location.pathname === "/login") return
  window.location.assign(target)
}
