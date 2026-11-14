/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  /** Auth0 tenant domain, e.g. "example.us.auth0.com" (no scheme). */
  readonly VITE_AUTH0_DOMAIN?: string
  /** Auth0 Single Page Application client id (public). */
  readonly VITE_AUTH0_CLIENT_ID?: string
  /** Auth0 API identifier the access token is requested for. */
  readonly VITE_AUTH0_AUDIENCE?: string
  /**
   * PowerSync service URL (increment 18), e.g. "http://localhost:8095" with
   * the Compose `offline` profile. Empty or unset = offline sync off.
   */
  readonly VITE_POWERSYNC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
