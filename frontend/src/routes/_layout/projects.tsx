import { createFileRoute } from "@tanstack/react-router"
import { FolderKanban } from "lucide-react"

import { PageHeader } from "@/components/Common/PageHeader"
import { EmptyState } from "@/components/Common/States"

export const Route = createFileRoute("/_layout/projects")({
  component: Projects,
  head: () => ({
    meta: [
      {
        title: "Projects - VR Inspector",
      },
    ],
  }),
})

/**
 * Section stub: gives the navigation a real destination and shows the
 * empty-state pattern. The project list, project detail and inspections
 * screens are ported in increment 07.
 */
function Projects() {
  return (
    <>
      <PageHeader
        title="Projects"
        description="Every project you are a member of, with its inspections."
      />
      <EmptyState
        icon={<FolderKanban />}
        title="Projects are being rebuilt"
        description="The project list and inspections screens from the current app are ported next. Until then, keep using the current app for field work."
      />
    </>
  )
}
