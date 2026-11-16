import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  History,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { formatDateTime } from "@/lib/format"
import type { AuditEntry } from "@/lib/sync/audit"
import { useSync } from "@/lib/sync/context"
import { type SyncTone, summarizeSync } from "@/lib/sync/status"
import { cn } from "@/lib/utils"

/*
 * Header chip for offline sync (rebuild increment 19, PRD v2.63 Block 11):
 *
 *   Offline · 3 waiting   no connection; 3 changes kept on this device
 *   3 waiting             connected, changes not uploaded yet
 *   Syncing…              uploading / first download
 *   Synced                everything is up (chip only shows when sync is on)
 *
 * Tapping it opens the sync panel: what is waiting, when the device last
 * synced, a "Sync now" button (the manual trigger), and the sync history —
 * every change this device uploaded, with the ones the server refused or that
 * replaced someone else's newer change (last write wins) called out.
 */

const TONE_CLASSES: Record<Exclude<SyncTone, "hidden">, string> = {
  synced: "text-status-positive-fg",
  syncing: "text-muted-foreground",
  waiting: "bg-status-attention-bg text-status-attention-fg",
  offline: "bg-status-neutral-bg text-status-neutral-fg",
}

function ToneIcon({ tone }: { tone: SyncTone }) {
  if (tone === "offline") return <CloudOff aria-hidden="true" />
  if (tone === "syncing") {
    return <Loader2 className="animate-spin" aria-hidden="true" />
  }
  if (tone === "waiting") return <CloudUpload aria-hidden="true" />
  return <CheckCircle2 aria-hidden="true" />
}

export function SyncIndicator() {
  const { snapshot } = useSync()
  const [open, setOpen] = useState(false)
  const summary = summarizeSync(snapshot)
  if (summary.tone === "hidden") return null
  const attention = snapshot.refused + snapshot.overwritten

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn("gap-1.5", TONE_CLASSES[summary.tone])}
        onClick={() => setOpen(true)}
        aria-label={`Sync: ${summary.detail}${attention ? ` ${attention} item${attention === 1 ? "" : "s"} in the sync history need a look.` : ""}`}
        data-testid="sync-indicator"
        data-tone={summary.tone}
      >
        <ToneIcon tone={summary.tone} />
        <span
          className={cn(summary.tone === "synced" && "hidden sm:inline")}
          data-testid="sync-indicator-label"
        >
          {summary.label}
        </span>
        {attention ? (
          <span
            className="flex size-4 items-center justify-center rounded-full bg-status-critical-fg text-[10px] font-bold text-white"
            data-testid="sync-attention-count"
          >
            {attention}
          </span>
        ) : null}
      </Button>
      <SyncPanel open={open} onOpenChange={setOpen} />
    </>
  )
}

interface SyncPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SyncPanel({ open, onOpenChange }: SyncPanelProps) {
  const { snapshot, syncNow, loadHistory, clearHistory } = useSync()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [syncing, setSyncing] = useState(false)
  const [history, setHistory] = useState<AuditEntry[] | null>(null)
  const summary = summarizeSync(snapshot)
  const syncOn = snapshot.enabled && snapshot.ready

  const reload = useCallback(async () => {
    try {
      setHistory(await loadHistory())
    } catch {
      setHistory([])
    }
  }, [loadHistory])

  // Re-read the history whenever the panel opens or the counts move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: counts trigger a re-read
  useEffect(() => {
    if (open && syncOn) void reload()
  }, [
    open,
    syncOn,
    reload,
    snapshot.pending,
    snapshot.refused,
    snapshot.overwritten,
  ])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await syncNow()
      showSuccessToast("Sync started")
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "Could not sync right now.",
      )
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="sync-panel">
        <DialogHeader>
          <DialogTitle>Sync</DialogTitle>
          <DialogDescription data-testid="sync-panel-summary">
            {summary.detail || "Everything on this device is uploaded."}
          </DialogDescription>
        </DialogHeader>

        {syncOn ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Waiting to upload</dt>
              <dd data-testid="sync-pending">
                {snapshot.pending === 0
                  ? "Nothing"
                  : `${snapshot.pending} change${snapshot.pending === 1 ? "" : "s"}`}
              </dd>
              <dt className="text-muted-foreground">Last synced</dt>
              <dd data-testid="sync-last">
                {snapshot.lastSyncedAt
                  ? formatDateTime(snapshot.lastSyncedAt)
                  : "Not yet"}
              </dd>
              <dt className="text-muted-foreground">Connection</dt>
              <dd>
                {snapshot.online
                  ? snapshot.connected
                    ? "Connected"
                    : "Online, connecting…"
                  : "Offline"}
              </dd>
            </dl>

            <LoadingButton
              onClick={handleSync}
              loading={syncing}
              disabled={!snapshot.online}
              data-testid="sync-now"
            >
              <RefreshCw />
              Sync now
            </LoadingButton>

            <section aria-labelledby="sync-history-heading">
              <div className="flex items-center justify-between gap-2">
                <h3
                  id="sync-history-heading"
                  className="flex items-center gap-1.5 text-sm font-semibold"
                >
                  <History className="size-4" aria-hidden="true" />
                  Sync history
                </h3>
                {history && history.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await clearHistory()
                      await reload()
                    }}
                    data-testid="sync-history-clear"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <SyncHistory entries={history} />
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Saving on the device without a connection is not switched on for
            this app yet, so changes need a connection. Anything already on
            screen stays visible.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function SyncHistory({ entries }: { entries: AuditEntry[] | null }) {
  if (entries === null) {
    return <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
  }
  if (entries.length === 0) {
    return (
      <p
        className="mt-2 text-sm text-muted-foreground"
        data-testid="sync-history-empty"
      >
        Nothing uploaded from this device yet.
      </p>
    )
  }
  return (
    <ul
      className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto"
      data-testid="sync-history"
    >
      {entries.map((entry) => (
        <li
          key={entry.id}
          className={cn(
            "list-none rounded-md border p-2 text-sm",
            entry.outcome === "refused" &&
              "border-l-4 border-l-status-critical-fg",
            entry.outcome === "overwrote" && "border-l-4 border-l-vri-copper",
          )}
          data-testid="sync-history-entry"
          data-outcome={entry.outcome}
        >
          <p className="flex items-start gap-1.5 font-medium">
            {entry.outcome === "applied" ? (
              <CheckCircle2
                className="mt-0.5 size-4 shrink-0 text-status-positive-fg"
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  entry.outcome === "refused"
                    ? "text-status-critical-fg"
                    : "text-vri-copper",
                )}
                aria-hidden="true"
              />
            )}
            {entry.what}
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.madeAt ? `Made ${formatDateTime(entry.madeAt)}` : null}
            {entry.uploadedAt && entry.outcome !== "refused"
              ? ` · uploaded ${formatDateTime(entry.uploadedAt)}`
              : null}
          </p>
          <p className="mt-1">{entry.result}</p>
          {entry.replaced.length > 0 ? (
            <div className="mt-1 text-xs" data-testid="sync-history-replaced">
              <p className="text-muted-foreground">Their values it replaced:</p>
              <ul className="pl-4">
                {entry.replaced.map((item) => (
                  <li key={item.field} className="list-disc">
                    {item.field}: {item.value}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
