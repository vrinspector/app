import { createFileRoute } from "@tanstack/react-router"

import Profile from "@/components/UserSettings/Profile"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"

const tabsConfig = [
  { value: "my-profile", title: "My profile", component: Profile },
]

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [
      {
        title: "Settings - VR Inspector",
      },
    ],
  }),
})

function UserSettings() {
  const { user } = useAuth()

  if (!user) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Settings</h1>
        <p className="text-muted-foreground">
          Your account details and preferences
        </p>
      </div>

      <Tabs defaultValue="my-profile">
        <TabsList>
          {tabsConfig.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.title}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabsConfig.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            <tab.component />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
