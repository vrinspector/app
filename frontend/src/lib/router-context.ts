/**
 * What routes can see in `beforeLoad` / loaders. The Auth0 SDK initialises
 * asynchronously, so the router is only mounted once `isLoading` is false
 * (see main.tsx); route guards can then be plain synchronous checks.
 */
export interface AuthContext {
  isAuthenticated: boolean
}

export interface RouterContext {
  auth: AuthContext
}
