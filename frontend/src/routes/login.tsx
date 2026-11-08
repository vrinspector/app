import { createFileRoute, redirect } from "@tanstack/react-router"
import { Clock, LogIn, ShieldCheck } from "lucide-react"
import { useState } from "react"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth from "@/hooks/useAuth"
import { type LoginReason, safeReturnTo } from "@/lib/session"

type LoginSearch = {
  returnTo?: string
  reason?: LoginReason
}

export const Route = createFileRoute("/login")({
  component: Login,
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    returnTo: safeReturnTo(search.returnTo),
    reason: search.reason === "expired" ? "expired" : undefined,
  }),
  // Already signed in (including the moment we come back from Auth0): go to
  // where the person was heading.
  beforeLoad: ({ context, search }) => {
    if (context.auth.isAuthenticated) {
      throw redirect({ to: search.returnTo ?? "/", replace: true })
    }
  },
  head: () => ({
    meta: [
      {
        title: "Sign In - VR Inspector",
      },
    ],
  }),
})

function Login() {
  const { isConfigured, error, login } = useAuth()
  const { returnTo, reason } = Route.useSearch()
  const [redirecting, setRedirecting] = useState(false)

  const onSignIn = async () => {
    if (redirecting) return
    setRedirecting(true)
    try {
      await login(returnTo)
    } finally {
      setRedirecting(false)
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6" data-testid="login-gate">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Sign in to VR Inspector</h1>
          <p className="text-sm text-muted-foreground">
            You will be taken to our secure sign-in page and brought straight
            back.
          </p>
        </div>

        {reason === "expired" ? (
          <Alert data-testid="session-expired">
            <Clock />
            <AlertTitle>Your session ended</AlertTitle>
            <AlertDescription>
              Sign in again to pick up where you left off.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive" data-testid="login-error">
            <AlertTitle>Sign-in didn't complete</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : null}

        {!isConfigured ? (
          <Alert data-testid="auth-unconfigured">
            <ShieldCheck />
            <AlertTitle>Sign-in is not set up for this build</AlertTitle>
            <AlertDescription>
              This copy of the app was built without its Auth0 settings
              (VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, VITE_AUTH0_AUDIENCE).
              Add them and rebuild to enable sign-in.
            </AlertDescription>
          </Alert>
        ) : null}

        <LoadingButton
          type="button"
          size="lg"
          onClick={onSignIn}
          loading={redirecting}
          disabled={!isConfigured}
          data-testid="sign-in-button"
        >
          <LogIn />
          Sign in
        </LoadingButton>

        <p className="text-center text-xs text-muted-foreground">
          Accounts are managed by your organization's administrator.
        </p>
      </div>
    </AuthLayout>
  )
}
