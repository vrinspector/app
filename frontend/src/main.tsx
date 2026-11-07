import { Auth0Provider, useAuth0 } from "@auth0/auth0-react"
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { AxiosError } from "axios"
import { StrictMode, useEffect } from "react"
import ReactDOM from "react-dom/client"
import { client } from "./client/client.gen"
import { FullPageLoader } from "./components/Common/FullPageLoader"
import {
  InsecureContext,
  isSecureContextForAuth,
} from "./components/Common/InsecureContext"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "./components/ui/sonner"
import "./index.css"
import { AUTH0_SCOPE, auth0Config, redirectUri } from "./lib/auth0"
import type { RouterContext } from "./lib/router-context"
import { routeTree } from "./routeTree.gen"

client.setConfig({
  baseURL: import.meta.env.VITE_API_URL ?? "",
})

const handleApiError = (error: Error) => {
  // 401 = the access token was missing/expired/rejected by the API. Send the
  // person back through sign-in. 403/404 are authorization outcomes handled by
  // the screens themselves (legacy routers hide objects with 404).
  if (error instanceof AxiosError && error.response?.status === 401) {
    window.location.href = "/login"
  }
}
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: handleApiError,
  }),
  mutationCache: new MutationCache({
    onError: handleApiError,
  }),
})

const router = createRouter({
  routeTree,
  context: { auth: { isAuthenticated: false } } satisfies RouterContext,
})
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

/**
 * Waits for the Auth0 SDK to restore (or fail to restore) the session, hands
 * the session to the generated API client, then mounts the router with the
 * auth state in its context so route guards can be synchronous.
 */
function App() {
  const { isLoading, isAuthenticated, getAccessTokenSilently } = useAuth0()

  useEffect(() => {
    // Every request to a secured endpoint asks the SDK for a (silently
    // refreshed) access token for the API audience: `Authorization: Bearer`.
    client.setConfig({
      auth: async () => {
        try {
          return await getAccessTokenSilently()
        } catch {
          // No session (or consent/refresh required): send the request without
          // a token and let the API answer 401, which routes back to /login.
          return undefined
        }
      },
    })
  }, [getAccessTokenSilently])

  if (isLoading) {
    return <FullPageLoader />
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ auth: { isAuthenticated } }} />
      <Toaster richColors closeButton />
    </QueryClientProvider>
  )
}

function Root() {
  // The Auth0 SDK throws on non-secure origins (no Web Crypto); explain
  // instead of crashing (see InsecureContext).
  if (!isSecureContextForAuth()) {
    return <InsecureContext />
  }

  return (
    <Auth0Provider
      domain={auth0Config.domain || "unconfigured.invalid"}
      clientId={auth0Config.clientId || "unconfigured"}
      authorizationParams={{
        redirect_uri: redirectUri(),
        audience: auth0Config.audience || undefined,
        scope: AUTH0_SCOPE,
      }}
      // Refresh tokens + persistent cache so a field session survives page
      // reloads and iPad tab suspension (Safari blocks third-party-cookie
      // silent auth in iframes). The SDK's default redirect callback strips
      // ?code/state and restores appState.returnTo before the router mounts.
      useRefreshTokens
      useRefreshTokensFallback
      cacheLocation="localstorage"
    >
      <App />
    </Auth0Provider>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="light" storageKey="vri-ui-theme">
      <Root />
    </ThemeProvider>
  </StrictMode>,
)
