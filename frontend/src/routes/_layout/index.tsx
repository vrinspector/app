import { createFileRoute } from "@tanstack/react-router"

import useAuth from "@/hooks/useAuth"

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

function Dashboard() {
  const { user } = useAuth()
  const greeting = user?.name || user?.email || "Inspector"

  return (
    <div>
      <div>
        <h1 className="text-2xl truncate max-w-sm" data-testid="greeting">
          Hi, {greeting} 👋
        </h1>
        <p className="text-muted-foreground">
          Welcome back, nice to see you again!!!
        </p>
      </div>
    </div>
  )
}
