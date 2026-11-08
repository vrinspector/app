import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, FileText } from "lucide-react"

import { type ReportPublic, ReportsService } from "@/client"
import { EmptyState, QueryState } from "@/components/Common/States"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
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
 */

interface ReportsSectionProps {
  inspectionId: number
  /** Any member may generate a report (it is a read-out of the record). */
  canGenerate?: boolean
}

export function ReportsSection({
  inspectionId,
  canGenerate = true,
}: ReportsSectionProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const query = useQuery(reportsQuery(inspectionId))

  const generateMutation = useMutation({
    mutationFn: async () =>
      (
        await ReportsService.generateReport({
          body: { inspection_id: inspectionId },
        })
      ).data as ReportPublic,
    onSuccess: (report) => {
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
