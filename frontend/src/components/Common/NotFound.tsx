import { Link } from "@tanstack/react-router"

import { LogoMark } from "@/components/Common/Logo"
import { Button } from "@/components/ui/button"

/** Full-page 404 (no matching route). In-shell "not found" lives in routes/_layout.tsx. */
const NotFound = () => {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="not-found"
    >
      <LogoMark className="size-12" />
      <p className="font-heading text-6xl font-bold leading-none text-vri-gold md:text-8xl">
        404
      </p>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="max-w-md text-muted-foreground">
        The page you are looking for was not found. It may have moved, or the
        link may be out of date.
      </p>
      <Button asChild className="mt-2">
        <Link to="/">Go Back</Link>
      </Button>
    </div>
  )
}

export default NotFound
