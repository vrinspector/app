import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Archive, MoreHorizontal, Pencil, Send, Undo2 } from "lucide-react"
import { useMemo, useState } from "react"

import { ItpsService, type ItpTemplatePublic } from "@/client"
import { PageHeader } from "@/components/Common/PageHeader"
import { DetailState, NotFoundState } from "@/components/Common/States"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { ClassificationBadge } from "@/components/Itps/ItpBadges"
import { SurveyPreview } from "@/components/Itps/SurveyPreview"
import { TemplateFormDialog } from "@/components/Itps/TemplateFormDialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useCustomToast from "@/hooks/useCustomToast"
import { formatDate, joinMeta } from "@/lib/format"
import { parseTemplateBody, TemplateError } from "@/lib/itp"
import { itpKeys, parseId, templateQuery } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

export const Route = createFileRoute("/_layout/itp-templates/$templateId")({
  component: TemplateScreen,
  head: () => ({ meta: [{ title: "ITP template - VR Inspector" }] }),
})

function TemplateScreen() {
  const { templateId: raw } = Route.useParams()
  const templateId = parseId(raw)
  if (templateId === undefined) {
    return (
      <NotFoundState
        noun="template"
        backTo="/itp-templates"
        backLabel="Back to templates"
      />
    )
  }
  return <TemplateDetail templateId={templateId} />
}

function TemplateDetail({ templateId }: { templateId: number }) {
  const query = useQuery(templateQuery(templateId))
  return (
    <DetailState
      query={query}
      noun="template"
      backTo="/itp-templates"
      backLabel="Back to templates"
      errorTitle="Couldn't load this template"
    >
      {(template) => <TemplateBody template={template} />}
    </DetailState>
  )
}

/**
 * One master version: what it contains (the line list with classifications
 * and signing roles), the SurveyJS render of the form, its versions, and
 * Edit (saves the next version) / Publish / Archive.
 */
function TemplateBody({ template }: { template: ItpTemplatePublic }) {
  const navigate = Route.useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editing, setEditing] = useState(false)
  const latest = template.versions[0]
  const isLatest = latest?.id === template.id
  const parsed = useMemo(() => {
    try {
      return parseTemplateBody(template.body)
    } catch (error) {
      if (error instanceof TemplateError) return null
      throw error
    }
  }, [template.body])

  const statusMutation = useMutation({
    mutationFn: async (status: "draft" | "published" | "archived") =>
      (
        await ItpsService.updateTemplateStatus({
          path: { template_id: template.id },
          body: { status },
        })
      ).data as ItpTemplatePublic,
    onSuccess: (saved) => {
      queryClient.setQueryData(itpKeys.template(saved.id), saved)
      queryClient.invalidateQueries({ queryKey: itpKeys.templates })
      showSuccessToast(
        saved.status === "archived"
          ? "Template archived"
          : saved.status === "published"
            ? "Template published"
            : "Template moved to draft",
      )
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <>
      <PageHeader
        eyebrow="ITP template"
        title={template.name}
        description={joinMeta(
          template.description,
          `Version ${template.version}`,
          formatDate(template.created_at),
        )}
        backTo="/itp-templates"
        backLabel="Back to templates"
        actions={
          <>
            {isLatest ? (
              <Button
                variant="outline"
                onClick={() => setEditing(true)}
                data-testid="edit-template"
              >
                <Pencil />
                Edit
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Template actions"
                  data-testid="template-actions"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {template.status !== "published" ? (
                  <DropdownMenuItem
                    onSelect={() => statusMutation.mutate("published")}
                  >
                    <Send />
                    Publish
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    onSelect={() => statusMutation.mutate("draft")}
                  >
                    <Undo2 />
                    Move to draft
                  </DropdownMenuItem>
                )}
                {template.status !== "archived" ? (
                  <DropdownMenuItem
                    onSelect={() => statusMutation.mutate("archived")}
                  >
                    <Archive />
                    Archive
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="template-meta"
      >
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
        <StatusBadge
          value="hold"
          tone={template.hold_count ? "critical" : "neutral"}
          label={`${template.hold_count} hold point${template.hold_count === 1 ? "" : "s"}`}
        />
        {template.role_names.map((role) => (
          <StatusBadge key={role} value="role" tone="settled" label={role} />
        ))}
      </div>

      {template.versions.length > 1 ? (
        <nav
          aria-label="Versions"
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid="template-versions"
        >
          <span className="text-muted-foreground">Versions:</span>
          {template.versions.map((version) => (
            <Link
              key={version.id}
              to="/itp-templates/$templateId"
              params={{ templateId: String(version.id) }}
              className={
                version.id === template.id
                  ? "rounded-full bg-vri-green px-2.5 py-0.5 text-vri-offwhite"
                  : "rounded-full border px-2.5 py-0.5 hover:border-vri-gold"
              }
              aria-current={version.id === template.id ? "page" : undefined}
            >
              v{version.version}
            </Link>
          ))}
          {!isLatest ? (
            <span className="text-muted-foreground">
              — this is an earlier version; edit the latest one.
            </span>
          ) : null}
        </nav>
      ) : null}

      {parsed ? (
        <section
          aria-labelledby="lines-heading"
          className="flex flex-col gap-2"
        >
          <h2 id="lines-heading" className="text-lg font-semibold">
            Lines
          </h2>
          <ol
            className="divide-y rounded-lg border bg-card text-sm"
            data-testid="template-lines"
          >
            {parsed.items.map((item, index) => (
              <li
                key={item.elementName}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="w-6 text-muted-foreground">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  {item.requirement}
                  {item.section ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {item.section}
                    </span>
                  ) : null}
                </span>
                <ClassificationBadge value={item.classification} />
                {item.roles.length ? (
                  <span className="text-xs text-muted-foreground">
                    Signed by {item.roles.join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="form-heading" className="flex flex-col gap-2">
        <h2 id="form-heading" className="text-lg font-semibold">
          Form preview
        </h2>
        <SurveyPreview body={template.body} />
      </section>

      <TemplateFormDialog
        open={editing}
        onOpenChange={setEditing}
        template={template}
        onSaved={(saved) =>
          navigate({
            to: "/itp-templates/$templateId",
            params: { templateId: String(saved.id) },
          })
        }
      />
    </>
  )
}
