import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  HardDrive,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { ConfirmDialog } from "@/components/Common/ConfirmDialog"
import { requestPhotoUpload } from "@/components/Common/PhotoQueueRunner"
import { useOnline } from "@/components/Common/SyncProvider"

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
import {
  assessStorage,
  estimateStorage,
  formatMegabytes,
  type PhotoHistoryEntry,
  photoQueue,
  type QueuedPhotoMeta,
  type StorageAssessment,
  usePhotoQueue,
  useQueuedPreview,
} from "@/lib/photoQueue"
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
 *
 * Increment 20: photos kept on this device count in the chip ("Offline · 3
 * waiting" covers changes and photos) and get their own list in the panel —
 * each with what it is for, its state and, when the server refused it, the
 * reason with Retry and Delete from device. Uploaded and refused photos join
 * the sync history, and the panel warns when the device is getting full.
 */

/** A photo history line in the same shape as the sync history. */
export function photoHistoryToAudit(entry: PhotoHistoryEntry): AuditEntry {
  return {
    id: entry.id,
    outcome: entry.outcome,
    what: entry.description,
    madeAt: entry.madeAt,
    uploadedAt: entry.at,
    result: entry.detail,
    replaced: [],
  }
}

function newestFirst(a: AuditEntry, b: AuditEntry): number {
  return (b.uploadedAt ?? b.madeAt ?? "").localeCompare(
    a.uploadedAt ?? a.madeAt ?? "",
  )
}

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

/**
 * The provider's snapshot, with the browser's own connection flag folded in
 * (the demo and tests run without the provider; photos queue in every build).
 */
function useSyncSnapshot() {
  const { snapshot } = useSync()
  const online = useOnline()
  return online ? snapshot : { ...snapshot, online: false }
}

export function SyncIndicator() {
  const snapshot = useSyncSnapshot()
  const photos = usePhotoQueue()
  const [open, setOpen] = useState(false)
  const summary = summarizeSync(snapshot, photos)
  if (summary.tone === "hidden") return null
  const attention = snapshot.refused + snapshot.overwritten + photos.failed

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
  const { syncNow, loadHistory, clearHistory } = useSync()
  const snapshot = useSyncSnapshot()
  const photos = usePhotoQueue()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [syncing, setSyncing] = useState(false)
  const [history, setHistory] = useState<AuditEntry[] | null>(null)
  const [storage, setStorage] = useState<StorageAssessment | null>(null)
  const summary = summarizeSync(snapshot, photos)
  const syncOn = snapshot.enabled && snapshot.ready
  const hasPhotos = photos.items.length > 0

  const reload = useCallback(async () => {
    let changes: AuditEntry[] = []
    let photoLines: AuditEntry[] = []
    try {
      changes = syncOn ? await loadHistory() : []
    } catch {
      changes = []
    }
    try {
      photoLines = (await photoQueue.history()).map(photoHistoryToAudit)
    } catch {
      photoLines = []
    }
    setHistory([...changes, ...photoLines].sort(newestFirst))
  }, [loadHistory, syncOn])

  // How full the device is, each time the panel opens (increment 20).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    estimateStorage().then((estimate) => {
      if (!cancelled) setStorage(assessStorage(estimate))
    })
    return () => {
      cancelled = true
    }
  }, [open])

  // Re-read the history whenever the panel opens or the counts move.
  // biome-ignore lint/correctness/useExhaustiveDependencies: counts trigger a re-read
  useEffect(() => {
    if (open) void reload()
  }, [
    open,
    syncOn,
    reload,
    snapshot.pending,
    snapshot.refused,
    snapshot.overwritten,
    photos.items.length,
    photos.failed,
  ])

  const handleSync = async () => {
    setSyncing(true)
    try {
      if (syncOn) await syncNow()
      requestPhotoUpload()
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

        {storage && storage.level !== "ok" && storage.level !== "unknown" ? (
          <p
            className={cn(
              "flex items-start gap-2 rounded-md border p-2 text-sm",
              storage.level === "full"
                ? "border-destructive/60 text-destructive"
                : "border-vri-copper/60",
            )}
            role="alert"
            data-testid="sync-storage-warning"
            data-level={storage.level}
          >
            <HardDrive className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {storage.message}
          </p>
        ) : null}

        {hasPhotos ? <QueuedPhotoList items={photos.items} /> : null}

        {syncOn ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Waiting to upload</dt>
              <dd data-testid="sync-pending">
                {snapshot.pending === 0 && photos.waiting === 0
                  ? "Nothing"
                  : [
                      snapshot.pending
                        ? `${snapshot.pending} change${snapshot.pending === 1 ? "" : "s"}`
                        : null,
                      photos.waiting
                        ? `${photos.waiting} photo${photos.waiting === 1 ? "" : "s"}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" and ")}
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
                      await photoQueue.clearHistory()
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
          <>
            <p className="text-sm text-muted-foreground">
              Saving findings and pins on the device without a connection is not
              switched on for this app yet, so those changes need a connection.
              Photos you take without signal are kept on this device and upload
              when the signal is back. Anything already on screen stays visible.
            </p>
            {hasPhotos || (history && history.length > 0) ? (
              <>
                <LoadingButton
                  onClick={handleSync}
                  loading={syncing}
                  disabled={!snapshot.online || photos.waiting === 0}
                  data-testid="sync-now"
                >
                  <RefreshCw />
                  Upload photos now
                </LoadingButton>
                <section aria-labelledby="sync-history-heading">
                  <h3
                    id="sync-history-heading"
                    className="flex items-center gap-1.5 text-sm font-semibold"
                  >
                    <History className="size-4" aria-hidden="true" />
                    Sync history
                  </h3>
                  <SyncHistory entries={history} />
                </section>
              </>
            ) : null}
          </>
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

/** Increment 20: photos kept on this device, each with Retry / Delete. */
function QueuedPhotoList({ items }: { items: readonly QueuedPhotoMeta[] }) {
  const [deleting, setDeleting] = useState<QueuedPhotoMeta | null>(null)
  const total = items.reduce((sum, item) => sum + item.size, 0)
  return (
    <section aria-labelledby="sync-photos-heading">
      <h3
        id="sync-photos-heading"
        className="flex items-center gap-1.5 text-sm font-semibold"
      >
        <Camera className="size-4" aria-hidden="true" />
        Photos on this device ({items.length}, {formatMegabytes(total)})
      </h3>
      <ul
        className="mt-2 flex max-h-60 flex-col gap-2 overflow-y-auto"
        data-testid="sync-photos"
      >
        {items.map((item) => (
          <QueuedPhotoRow
            key={item.id}
            item={item}
            onDelete={() => setDeleting(item)}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Delete this photo from the device?"
        description="It has not reached the server, so it will be gone for good. Take it again if it is still needed."
        confirmLabel="Delete photo"
        variant="destructive"
        onConfirm={async () => {
          if (deleting) await photoQueue.remove(deleting.id)
          setDeleting(null)
        }}
      />
    </section>
  )
}

function QueuedPhotoRow({
  item,
  onDelete,
}: {
  item: QueuedPhotoMeta
  onDelete: () => void
}) {
  const preview = useQueuedPreview(item.id)
  const failed = item.status === "failed"
  return (
    <li
      className={cn(
        "flex list-none gap-2 rounded-md border p-2 text-sm",
        failed && "border-l-4 border-l-status-critical-fg",
      )}
      data-testid="sync-photo"
      data-status={item.status}
    >
      <span className="relative size-12 shrink-0 overflow-hidden rounded bg-muted">
        {preview ? (
          <img src={preview} alt="" className="size-full object-cover" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.description}</p>
        <p className="text-xs text-muted-foreground">
          Taken {formatDateTime(item.capturedAt ?? item.queuedAt)} ·{" "}
          {formatMegabytes(item.size)}
        </p>
        <p
          className={cn("mt-0.5 text-xs", failed && "text-destructive")}
          data-testid="sync-photo-state"
        >
          {failed
            ? `Not accepted by the server: ${item.error ?? "no reason given"}`
            : item.status === "uploading"
              ? "Uploading…"
              : item.error
                ? `Not uploaded yet — ${item.error}`
                : "Not uploaded yet"}
        </p>
        {failed ? (
          <div className="mt-1 flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={async () => {
                await photoQueue.retry(item.id)
                requestPhotoUpload()
              }}
              data-testid="sync-photo-retry"
            >
              <RotateCcw />
              Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-destructive"
              onClick={onDelete}
              data-testid="sync-photo-delete"
            >
              <Trash2 />
              Delete from device
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  )
}
