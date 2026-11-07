import { Link } from "@tanstack/react-router"
import { AlertTriangle } from "lucide-react"

import { LogoMark } from "@/components/Common/Logo"
import { Button } from "@/components/ui/button"

/** Full-page failure (outside the shell). In-shell errors use <ErrorState>. */
const ErrorComponent = () => {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="error-component"
    >
      <LogoMark className="size-12" />
      <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-md text-muted-foreground">
        The app hit a problem it could not recover from. Reloading usually
        clears it; if it keeps happening, tell your administrator what you were
        doing.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button asChild>
          <Link to="/">Go Home</Link>
        </Button>
      </div>
    </div>
  )
}

export default ErrorComponent
