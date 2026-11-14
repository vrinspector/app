import {
  createFileRoute,
  type ErrorComponentProps,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from "@tanstack/react-router"
import { CircleHelp, SearchX } from "lucide-react"
import { Footer } from "@/components/Common/Footer"
import { EmptyState, ErrorState } from "@/components/Common/States"
import { SyncIndicator } from "@/components/Common/SyncIndicator"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import { Button } from "@/components/ui/button"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { activeNavItem } from "@/lib/navigation"
import { safeReturnTo } from "@/lib/session"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  // The router mounts only after Auth0 has restored (or failed to restore)
  // the session, so this guard can be synchronous. Remember where the person
  // was heading so sign-in brings them straight back.
  beforeLoad: ({ context, location }) => {
    if (!context.auth.isAuthenticated) {
      const returnTo = safeReturnTo(location.href)
      throw redirect({
        to: "/login",
        search: returnTo && returnTo !== "/" ? { returnTo } : {},
        replace: true,
      })
    }
  },
  // Failures and `throw notFound()` from screens render inside the shell so
  // the navigation stays usable.
  errorComponent: LayoutError,
  notFoundComponent: LayoutNotFound,
})

/**
 * The signed-in application shell: brand sidebar (collapses to an icon rail
 * on desktop, a sheet on phones), a sticky header carrying the current
 * section and a Help shortcut (the legacy top bar), the screen, and the
 * footer. Screens render their own <PageHeader> inside <Outlet>.
 */
function Layout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = activeNavItem(pathname)

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header
          className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4"
          data-testid="app-header"
        >
          <SidebarTrigger
            className="-ml-1 size-9 text-muted-foreground"
            aria-label="Toggle navigation"
          />
          <span
            className="truncate font-heading text-base font-semibold"
            data-testid="header-section"
          >
            {section?.title ?? "VR Inspector"}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <SyncIndicator />
            {section?.path !== "/help" ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
              >
                <Link to="/help" data-testid="header-help">
                  <CircleHelp />
                  <span className="hidden sm:inline">Help</span>
                </Link>
              </Button>
            ) : null}
          </div>
        </header>
        <main className="flex-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 md:p-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-6">
            <Outlet />
          </div>
        </main>
        <Footer />
      </SidebarInset>
    </SidebarProvider>
  )
}

function LayoutError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <ErrorState
      title="This screen hit a problem"
      error={error}
      onRetry={() => {
        reset()
        router.invalidate()
      }}
    />
  )
}

function LayoutNotFound() {
  return (
    <EmptyState
      icon={<SearchX />}
      title="Not found"
      description="This item does not exist or you no longer have access to it."
      action={
        <Button asChild variant="outline">
          <Link to="/">Back to dashboard</Link>
        </Button>
      }
    />
  )
}
