import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ClipboardCheck, Plus, Sparkles } from "lucide-react"
import { useId, useState } from "react"

import { ListCard } from "@/components/Common/ListCard"
import { PageHeader } from "@/components/Common/PageHeader"
import { EmptyState, QueryState } from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { ItpImportDialog } from "@/components/Itps/ItpImportDialog"
import { TemplateFormDialog } from "@/components/Itps/TemplateFormDialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { useAiEnabled } from "@/lib/ai"
import { formatDate, joinMeta } from "@/lib/format"
import { templatesQuery } from "@/lib/queries"

export const Route = createFileRoute("/_layout/itp-templates/")({
  component: TemplatesScreen,
  head: () => ({ meta: [{ title: "ITP templates - VR Inspector" }] }),
})

/**
 * Master ITP templates (Block 9.5, increment 13): the caller's masters,
 * latest version of each. A master is applied to a project (or to many of
 * its areas at once) from the project screen; the project gets a frozen copy.
 *
 * Increment 16 (Block 10E): **Import with AI** turns an ITP the inspector
 * already uses (PDF, spreadsheet or photos) into a draft master to review —
 * the way custom templates are made (owner decision 2026-11-10).
 */
function TemplatesScreen() {
  const navigate = Route.useNavigate()
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const aiEnabled = useAiEnabled()
  const query = useQuery(templatesQuery(showArchived))
  const archivedId = useId()

  const newButton = (
    <div className="flex flex-wrap gap-2">
      {aiEnabled ? (
        <Button
          variant="outline"
          className="border-vri-gold/60 text-vri-copper"
          onClick={() => setImporting(true)}
          data-testid="import-template"
        >
          <Sparkles />
          Import with AI
        </Button>
      ) : null}
      <Button onClick={() => setCreating(true)} data-testid="new-template">
        <Plus />
        New template
      </Button>
    </div>
  )

  return (
    <>
      <PageHeader
        title="ITP templates"
        description="Master inspection and test plans. Applying one to a project makes a frozen copy, so editing a master never changes work already under way."
        actions={newButton}
      />
      <label
        htmlFor={archivedId}
        className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground"
      >
        <Checkbox
          id={archivedId}
          checked={showArchived}
          onCheckedChange={(checked) => setShowArchived(checked === true)}
        />
        Show archived
      </label>
      <QueryState
        query={query}
        errorTitle="Couldn't load your templates"
        empty={
          <EmptyState
            icon={<ClipboardCheck />}
            title="No ITP templates yet"
            description="Create a master once — sections, lines, hold and witness points, who signs — then apply it to any project or area. Already have an ITP? Import it with AI."
            action={newButton}
          />
        }
      >
        {(templates) => (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="template-list">
            {templates.map((template) => (
              <ListCard
                key={template.id}
                data-testid="template-card"
                to="/itp-templates/$templateId"
                params={{ templateId: String(template.id) }}
                title={template.name}
                meta={joinMeta(
                  template.description,
                  `v${template.version}`,
                  `updated ${formatDate(template.updated_at)}`,
                )}
                badges={
                  <>
                    <StatusBadge
                      value={template.status}
                      tone={
                        template.status === "published"
                          ? "positive"
                          : template.status === "draft"
                            ? "attention"
                            : "settled"
                      }
                    />
                    <StatusBadge
                      value="lines"
                      tone="neutral"
                      label={`${template.item_count} lines`}
                    />
                    {template.hold_count ? (
                      <StatusBadge
                        value="hold"
                        tone="critical"
                        label={`${template.hold_count} hold point${template.hold_count === 1 ? "" : "s"}`}
                      />
                    ) : null}
                  </>
                }
              />
            ))}
          </ul>
        )}
      </QueryState>
      <ItpImportDialog
        open={importing}
        onOpenChange={setImporting}
        onSaved={(template) =>
          navigate({
            to: "/itp-templates/$templateId",
            params: { templateId: String(template.id) },
          })
        }
      />
      <TemplateFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(template) =>
          navigate({
            to: "/itp-templates/$templateId",
            params: { templateId: String(template.id) },
          })
        }
      />
    </>
  )
}
