/*
 * Demo build only (vite.demo.config.ts aliases "@auth0/auth0-react" here).
 *
 * The clickable demo runs with no Auth0 tenant and no server, so this stand-in
 * reports a signed-in demo user and turns sign-in/sign-out into no-ops with an
 * explanatory toast. The production build never includes this file.
 */
import type { ReactNode } from "react"
import { toast } from "sonner"

export const DEMO_USER = {
  sub: "demo|inspector",
  name: "Demo Inspector",
  email: "demo.inspector@example.com",
  picture: undefined as string | undefined,
}

const state = {
  isAuthenticated: true,
  isLoading: false,
  error: undefined as Error | undefined,
  user: DEMO_USER,
  loginWithRedirect: async () => {
    toast.info("This demo is already signed in as a sample user.")
  },
  logout: () => {
    toast.info(
      "Sign-out is turned off in the demo. The real app signs you out through Auth0.",
    )
  },
  getAccessTokenSilently: async () => "demo-token",
}

export function useAuth0() {
  return state
}

export function Auth0Provider({ children }: { children: ReactNode }) {
  return <>{children}</>
}
