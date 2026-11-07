import { ShieldAlert } from "lucide-react"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/**
 * The Auth0 SDK needs the Web Crypto API (PKCE), which browsers only expose on
 * secure contexts: HTTPS, or http://localhost. Opening the app over plain
 * HTTP on a LAN address (for example from an iPad pointed at a laptop) would
 * otherwise crash before anything renders.
 */
export function isSecureContextForAuth(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.crypto?.subtle !== "undefined"
  )
}

export function InsecureContext() {
  const here = typeof window !== "undefined" ? window.location.origin : ""
  return (
    <AuthLayout>
      <div className="flex flex-col gap-6" data-testid="insecure-context">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-bold">Open VR Inspector over HTTPS</h1>
        </div>
        <Alert>
          <ShieldAlert />
          <AlertTitle>Secure connection required for sign-in</AlertTitle>
          <AlertDescription>
            This page was opened at {here}. Sign-in only works over HTTPS (or
            http://localhost on the same machine). Use the HTTPS address of the
            app, or a tunnel such as ngrok when testing from another device.
          </AlertDescription>
        </Alert>
      </div>
    </AuthLayout>
  )
}
