import { useMutation } from "@tanstack/react-query"
import { Sparkles, Undo2 } from "lucide-react"
import { useCallback, useRef, useState } from "react"

import { AiService, type AiSuggestionPublic } from "@/client"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { useAiEnabled, type VoiceDraft } from "@/lib/ai"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

/*
 * Block 10B — voice-to-finding. The inspector dictates (or types) what they
 * see; "Draft with AI" sends that note to the server, which asks the model to
 * structure it into title, status, priority, discipline, description and
 * location. The answer fills the form *as a draft*: a gold notice says so,
 * Undo puts the inspector's own words back (and tells the server the draft
 * was set aside), and nothing is saved until the form's own Save button —
 * which sends the draft's id so the confirmation is logged with it.
 */

export interface VoiceDraftTarget<Snapshot> {
  /** The dictated / typed observation. */
  transcript: () => string
  /** Location already filled in, passed to the model as context. */
  location: () => string
  snapshot: () => Snapshot
  apply: (draft: VoiceDraft) => void
  restore: (snapshot: Snapshot) => void
}

export function useVoiceDraft<Snapshot>(
  inspectionId: number | null,
  target: VoiceDraftTarget<Snapshot>,
) {
  const enabled = useAiEnabled()
  const { showErrorToast } = useCustomToast()
  const [suggestion, setSuggestion] = useState<AiSuggestionPublic | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const targetRef = useRef(target)
  targetRef.current = target

  const mutation = useMutation({
    mutationFn: async () => {
      if (inspectionId === null) throw new Error("Choose an inspection first.")
      const response = await AiService.voiceFinding({
        body: {
          inspection_id: inspectionId,
          transcript: targetRef.current.transcript(),
          location_ref: targetRef.current.location() || null,
        },
      })
      return response.data as AiSuggestionPublic
    },
    onSuccess: (result) => {
      snapshotRef.current = targetRef.current.snapshot()
      targetRef.current.apply(result.draft as unknown as VoiceDraft)
      setSuggestion(result)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const undo = useCallback(() => {
    if (snapshotRef.current !== null) {
      targetRef.current.restore(snapshotRef.current)
    }
    if (suggestion) {
      // Best effort: the log records the draft was set aside.
      AiService.dismissSuggestion({
        path: { suggestion_id: suggestion.id },
      }).catch(() => undefined)
    }
    snapshotRef.current = null
    setSuggestion(null)
  }, [suggestion])

  const reset = useCallback(() => {
    snapshotRef.current = null
    setSuggestion(null)
    mutation.reset()
  }, [mutation.reset])

  return {
    enabled,
    suggestion,
    pending: mutation.isPending,
    request: () => mutation.mutate(),
    undo,
    reset,
  }
}

export function DraftWithAiButton({
  onClick,
  pending,
  disabled,
  className,
  testId = "ai-draft-button",
}: {
  onClick: () => void
  pending: boolean
  disabled?: boolean
  className?: string
  testId?: string
}) {
  return (
    <LoadingButton
      type="button"
      variant="outline"
      size="sm"
      loading={pending}
      onClick={onClick}
      disabled={disabled}
      className={cn("h-8 border-vri-gold/60 text-vri-copper", className)}
      data-testid={testId}
    >
      {pending ? null : <Sparkles />}
      {pending ? "Drafting…" : "Draft with AI"}
    </LoadingButton>
  )
}

/** The "this is a draft" notice shown while AI-filled fields are unsaved. */
export function AiDraftNotice({
  onUndo,
  saveLabel,
  testId = "ai-draft-notice",
}: {
  onUndo?: () => void
  saveLabel: string
  testId?: string
}) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-vri-gold/60 bg-vri-gold/10 p-2.5 text-xs"
      role="status"
      data-testid={testId}
    >
      <Sparkles
        className="mt-0.5 size-4 shrink-0 text-vri-copper"
        aria-hidden="true"
      />
      <p className="flex-1">
        <strong>AI draft — check every field.</strong> Nothing is saved until
        you tap <strong>{saveLabel}</strong>.
      </p>
      {onUndo ? (
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-vri-copper underline-offset-2 hover:underline"
          data-testid="ai-draft-undo"
        >
          <Undo2 className="size-3.5" aria-hidden="true" />
          Undo
        </button>
      ) : null}
    </div>
  )
}
