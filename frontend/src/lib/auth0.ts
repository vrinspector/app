/**
 * Auth0 configuration for the SPA (OIDC authorization-code flow with PKCE).
 *
 * Values come from Vite build-time env (`VITE_AUTH0_*`). They are public
 * identifiers (the legacy SPA shipped them inline); the secrets live only in
 * the Auth0 tenant. Missing values leave the app in an "unconfigured" state
 * that renders a clear message instead of a broken redirect.
 */

export const AUTH0_SCOPE = "openid profile email"

export interface Auth0Config {
  domain: string
  clientId: string
  audience: string
}

function readEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]
  return typeof value === "string" ? value.trim() : ""
}

export const auth0Config: Auth0Config = {
  domain: readEnv("VITE_AUTH0_DOMAIN"),
  clientId: readEnv("VITE_AUTH0_CLIENT_ID"),
  audience: readEnv("VITE_AUTH0_AUDIENCE"),
}

const PLACEHOLDER = /changethis|example\./i

export function isAuth0Configured(config: Auth0Config = auth0Config): boolean {
  return (
    config.domain.length > 0 &&
    config.clientId.length > 0 &&
    config.audience.length > 0 &&
    !PLACEHOLDER.test(config.domain) &&
    !PLACEHOLDER.test(config.clientId)
  )
}

/** Where Auth0 sends the browser back after login/logout. */
export function redirectUri(): string {
  return window.location.origin
}
