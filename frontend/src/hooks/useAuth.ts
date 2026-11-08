import { useAuth0 } from "@auth0/auth0-react"
import { useQuery } from "@tanstack/react-query"
import { useCallback } from "react"

import { type UserPublic, UsersService } from "@/client"
import { isAuth0Configured, redirectUri } from "@/lib/auth0"

/**
 * The signed-in person, as the UI needs it.
 *
 * `sub` (the Auth0 subject) is the identity anchor; `email` and `name` are
 * for display. Profile fields come from the ID token immediately after login
 * and are confirmed against the API (`GET /users/me`) once a token is in hand.
 */
export interface SessionUser {
  sub: string
  email?: string
  name?: string
  picture?: string
}

const useAuth = () => {
  const {
    isAuthenticated,
    isLoading,
    error,
    user: idTokenUser,
    loginWithRedirect,
    logout: auth0Logout,
  } = useAuth0()

  // Round-trip to the API: proves the access token is accepted by the backend
  // and picks up the backend's view of the identity (email from the token or
  // /userinfo fallback, permissions).
  const apiUserQuery = useQuery<UserPublic | null, Error>({
    queryKey: ["currentUser", idTokenUser?.sub],
    queryFn: async () => (await UsersService.readUserMe()).data,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  })
  const apiUser = apiUserQuery.data

  const user: SessionUser | null = isAuthenticated
    ? {
        sub: apiUser?.sub ?? idTokenUser?.sub ?? "",
        email: apiUser?.email ?? idTokenUser?.email ?? undefined,
        name: apiUser?.name ?? idTokenUser?.name ?? undefined,
        picture: apiUser?.picture ?? idTokenUser?.picture ?? undefined,
      }
    : null

  const login = useCallback(
    (returnTo?: string) =>
      loginWithRedirect({
        appState: { returnTo: returnTo ?? "/" },
      }),
    [loginWithRedirect],
  )

  const logout = useCallback(
    () =>
      auth0Logout({
        logoutParams: { returnTo: redirectUri() },
      }),
    [auth0Logout],
  )

  return {
    isAuthenticated,
    isLoading,
    isConfigured: isAuth0Configured(),
    error,
    user,
    permissions: apiUser?.permissions ?? [],
    /**
     * State of the `/users/me` round-trip, for the shell to show whether the
     * API is reachable: `pending` until it answers, `error` when the server
     * cannot be reached or rejects the token (a 401 also redirects to
     * /login), `ok` once the backend has confirmed the identity.
     */
    apiSession: {
      status: apiUserQuery.isPending
        ? ("pending" as const)
        : apiUserQuery.isError
          ? ("error" as const)
          : ("ok" as const),
      error: apiUserQuery.error,
      refetch: apiUserQuery.refetch,
    },
    login,
    logout,
  }
}

export default useAuth
