import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react"

import { PageHeader } from "@/components/Common/PageHeader"
import { EmptyState, ErrorState } from "@/components/Common/States"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import useAuth from "@/hooks/useAuth"
import { NAV_ITEMS } from "@/lib/navigation"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "Dashboard - VR Inspector",
      },
    ],
  }),
})

/**
 * Landing screen. The Block 6 roll-up (project health table, recent
 * inspections) is ported in increment 10; until then this is the shell's
 * home: a greeting, the connection check, and shortcuts into each section.
 */
function Dashboard() {
  const { user, apiSession } = useAuth()
  const greeting = user?.name || user?.email || "Inspector"
  const shortcuts = NAV_ITEMS.filter((item) => item.path !== "/")

  return (
    <>
      <PageHeader
        title={
          <span data-testid="greeting">
            Hi, {greeting} <span aria-hidden="true">👋</span>
          </span>
        }
        description="Welcome back. Here is where things stand."
      />

      <ConnectionCard
        status={apiSession.status}
        error={apiSession.error}
        onRetry={() => apiSession.refetch()}
      />

      <section
        aria-labelledby="shortcuts-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="shortcuts-heading" className="text-lg font-semibold">
          Where to next
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="group rounded-lg border bg-card p-4 transition-colors hover:border-vri-gold focus-visible:outline-2 focus-visible:outline-ring"
              data-testid={`shortcut-${item.title.toLowerCase()}`}
            >
              <div className="flex items-start gap-3">
                <item.icon
                  className="mt-0.5 size-5 shrink-0 text-vri-copper"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.blurb}</p>
                </div>
                <ArrowRight
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <EmptyState
        title="Project health arrives with the dashboard port"
        description="Totals, the per-project health table and recent activity from the current app are ported in a later increment. Until then, Projects is the place to start."
        className="py-8"
      />
    </>
  )
}

interface ConnectionCardProps {
  status: "pending" | "error" | "ok"
  error: unknown
  onRetry: () => void
}

/**
 * The `/users/me` round-trip doubles as the connection check: a real
 * example of the loading / error / success pattern every screen follows.
 */
function ConnectionCard({ status, error, onRetry }: ConnectionCardProps) {
  if (status === "error") {
    return (
      <ErrorState
        title="Can't reach the VR Inspector server"
        error={error}
        onRetry={onRetry}
        className="py-6"
      />
    )
  }

  return (
    <Card data-testid="connection-card" data-status={status} className="gap-2">
      <CardHeader>
        <CardTitle className="text-base">Connection</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
        {status === "pending" ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>Checking the server…</span>
          </>
        ) : (
          <>
            <CheckCircle2
              className="size-4 text-status-positive-fg"
              aria-hidden="true"
            />
            <span>Signed in and connected to the VR Inspector server.</span>
          </>
        )}
      </CardContent>
    </Card>
  )
}
