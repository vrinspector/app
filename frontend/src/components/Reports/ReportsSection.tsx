import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, FileText, PenLine, Sparkles } from "lucide-react"
import { useState } from "react"

import {
  AiService,
  type AiSuggestionPublic,
  type ReportPublic,
  ReportsService,
} from "@/client"
import { AiDraftNotice, DraftWithAiButton } from "@/components/Ai/VoiceDraft"
import { EmptyState, QueryState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { useAiEnabled } from "@/lib/ai"
import { formatDateTime } from "@/lib/format"
import { inspectionKeys, reportsQuery } from "@/lib/queries"
import { extractErrorMessage } from "@/utils"

/*
 * Reports (N) on the inspection screen — the legacy "📄 Report" button next
 * to the findings, now with the version history the API keeps:
 *
 *   POST /reports/generate {inspection_id} → 201 report (with download_url)
 *   GET  /reports?inspection_id=N          → versions, newest first
 *
 * The legacy SPA opened the PDF in a new tab the moment it was ready. Popup
 * blockers stop a `window.open` that follows a network round-trip on iOS
 * Safari and Android Chrome, so the rebuilt screen shows the new version at
 * the top of the list with a Download button and a toast instead; one more
 * tap, never a silently blocked tab.
 *
 * Increment 16 (Block 10C): an optional **summary** printed at the top of the
 * report. "Add a summary" opens a box; inspectors and owners can also tap
 * **Draft with AI**, which writes a draft from the recorded findings into the
 * box under a gold "AI draft" notice. Nothing is printed until Generate
 * report, which sends the edited words and the draft's id so the server logs
 * the confirmation (and whether the words were changed); the PDF then says
 * the summary was AI-assisted and reviewed by whoever generated it.
 */

interface ReportsSectionProps {
  inspectionId: number
  /** Any member may generate a report (it is a read-out of the record). */
  canGenerate?: boolean
  /** Owners and inspectors may ask for an AI draft of the summary. */
  canWrite?: boolean
}

export function ReportsSection({
  inspectionId,
  canGenerate = true,
  canWrite = false,
}: ReportsSectionProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const query = useQuery(reportsQuery(inspectionId))
  const aiEnabled = useAiEnabled()
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summary, setSummary] = useState("")
  const [draft, setDraft] = useState<AiSuggestionPublic | null>(null)
  const [beforeDraft, setBeforeDraft] = useState("")

  const draftMutation = useMutation({
    mutationFn: async () =>
      (
        await AiService.reportDraft({
          body: { inspection_id: inspectionId },
        })
      ).data as AiSuggestionPublic,
    onSuccess: (result) => {
      setBeforeDraft(summary)
      setSummary(String(result.draft?.summary ?? ""))
      setDraft(result)
      setSummaryOpen(true)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const undoDraft = () => {
    if (draft) {
      AiService.dismissSuggestion({
        path: { suggestion_id: draft.id },
      }).catch(() => undefined)
    }
    setSummary(beforeDraft)
    setDraft(null)
  }

  const generateMutation = useMutation({
    mutationFn: async () => {
      const text = summaryOpen ? summary.trim() : ""
      // Without a summary the body stays the legacy `{inspection_id}`.
      const body = text
        ? {
            inspection_id: inspectionId,
            summary: text,
            ai_suggestion_id: draft ? draft.id : null,
          }
        : { inspection_id: inspectionId }
      return (await ReportsService.generateReport({ body }))
        .data as ReportPublic
    },
    onSuccess: (report) => {
      setSummary("")
      setDraft(null)
      setSummaryOpen(false)
      queryClient.setQueryData<ReportPublic[]>(
        inspectionKeys.reports(inspectionId),
        (current) => [report, ...(current ?? [])],
      )
      queryClient.invalidateQueries({
        queryKey: inspectionKeys.reports(inspectionId),
      })
      showSuccessToast(`Report version ${report.version} is ready to download`)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const generateButton = canGenerate ? (
    <LoadingButton
      loading={generateMutation.isPending}
      onClick={() => generateMutation.mutate()}
      data-testid="generate-report"
    >
      <FileText />
      {generateMutation.isPending ? "Generating…" : "Generate report"}
    </LoadingButton>
  ) : null

  const summaryEditor = canGenerate ? (
    summaryOpen ? (
      <div
        className="flex flex-col gap-2 rounded-lg border bg-card p-3"
        data-testid="report-summary-editor"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="report-summary">Summary for the next report</Label>
          {aiEnabled && canWrite && !draft ? (
            <DraftWithAiButton
              onClick={() => draftMutation.mutate()}
              pending={draftMutation.isPending}
              testId="report-ai-draft"
            />
          ) : null}
        </div>
        {draft ? (
          <AiDraftNotice onUndo={undoDraft} saveLabel="Generate report" />
        ) : null}
        <Textarea
          id="report-summary"
          rows={6}
          maxLength={6000}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="A few sentences at the top of the report: what was inspected, what was found, what is still open."
          data-testid="report-summary"
        />
        <p className="text-xs text-muted-foreground">
          Printed at the top of the report. Leave empty for no summary.
        </p>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (draft) undoDraft()
              setSummary("")
              setSummaryOpen(false)
            }}
          >
            Remove summary
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setSummaryOpen(true)}
          data-testid="report-add-summary"
        >
          <PenLine />
          Add a summary
        </Button>
        {aiEnabled && canWrite ? (
          <DraftWithAiButton
            onClick={() => draftMutation.mutate()}
            pending={draftMutation.isPending}
            className="h-9"
            testId="report-ai-draft"
          />
        ) : null}
      </div>
    )
  ) : null

  return (
    <section aria-labelledby="reports-heading" className="flex flex-col gap-3">
      <QueryState
        query={query}
        errorTitle="Couldn't load the reports"
        empty={
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 id="reports-heading" className="text-lg font-semibold">
                Reports <span className="text-muted-foreground">(0)</span>
              </h2>
              {generateButton}
            </div>
            {summaryEditor}
            <EmptyState
              icon={<FileText />}
              title="No report yet"
              description="Generate a PDF of this inspection — details, findings with their resolution, and the site photos. Each report is kept as a version."
              className="py-8"
            />
          </>
        }
      >
        {(reports) => (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 id="reports-heading" className="text-lg font-semibold">
                Reports{" "}
                <span
                  className="text-muted-foreground"
                  data-testid="reports-count"
                >
                  ({reports.length})
                </span>
              </h2>
              {generateButton}
            </div>
            {summaryEditor}
            <ul
              className="divide-y rounded-lg border bg-card"
              data-testid="report-list"
            >
              {reports.map((report, index) => (
                <li
                  key={report.id}
                  data-testid="report-row"
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <FileText
                    className="size-5 shrink-0 text-vri-copper"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      Version {report.version}
                      {index === 0 ? (
                        <span className="ml-2 rounded-full bg-vri-gold/20 px-2 py-0.5 text-xs font-medium text-vri-charcoal dark:text-vri-gold">
                          Latest
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(report.created_at)}
                      {report.generated_by ? ` · ${report.generated_by}` : ""}
                      {` · ${report.finding_count} finding${
                        report.finding_count === 1 ? "" : "s"
                      }, ${report.photo_count} photo${
                        report.photo_count === 1 ? "" : "s"
                      }`}
                      {report.file_size
                        ? ` · ${formatBytes(report.file_size)}`
                        : ""}
                    </p>
                    {report.summary ? (
                      <p
                        className="mt-1 line-clamp-2 text-xs"
                        data-testid="report-summary-preview"
                      >
                        {report.ai_suggestion_id ? (
                          <span className="mr-1 inline-flex items-center gap-0.5 rounded-full bg-vri-gold/20 px-1.5 py-0.5 text-[10px] font-medium text-vri-copper">
                            <Sparkles className="size-3" aria-hidden="true" />
                            AI-assisted summary
                          </span>
                        ) : null}
                        {report.summary}
                      </p>
                    ) : null}
                  </div>
                  {report.download_url ? (
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={report.download_url}
                        target="_blank"
                        rel="noreferrer"
                        download={report.filename}
                        data-testid="download-report"
                      >
                        <Download />
                        Download PDF
                      </a>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </QueryState>
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
