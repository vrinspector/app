import { createFileRoute } from "@tanstack/react-router"
import { BookOpen, ExternalLink } from "lucide-react"

import { PageHeader } from "@/components/Common/PageHeader"
import { EmptyState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"

/** The published user guide (served from the public site, not this app). */
const PUBLIC_HELP_URL = "https://vrinspector.com/help/"

export const Route = createFileRoute("/_layout/help")({
  component: Help,
  head: () => ({
    meta: [
      {
        title: "Help - VR Inspector",
      },
    ],
  }),
})

/**
 * Section stub. The in-app guide (the legacy Help overlay: device split,
 * core workflows, field-to-office hand-off, access, troubleshooting) is
 * ported in increment 10; the public guide covers the same ground now.
 */
function Help() {
  return (
    <>
      <PageHeader
        title="Help"
        description="How to use VR Inspector: phone in the field, desktop for drawings."
      />
      <EmptyState
        icon={<BookOpen />}
        title="The in-app guide is on its way"
        description="Until it is ported, the public user guide has the same getting-started steps, workflows and troubleshooting tips."
        action={
          <Button asChild>
            <a
              href={PUBLIC_HELP_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="public-help-link"
            >
              <ExternalLink />
              Open the user guide
            </a>
          </Button>
        }
      />
    </>
  )
}
