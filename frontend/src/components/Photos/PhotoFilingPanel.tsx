import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ClipboardPlus, Sparkles, Tag, X } from "lucide-react"
import { useEffect, useState } from "react"

import {
  AiService,
  type AiSuggestionPublic,
  type PhotoPublic,
  PhotosService,
} from "@/client"
import { FindingFormDialog } from "@/components/Findings/FindingFormDialog"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import {
  confidenceText,
  DEFECT_TYPE_OPTIONS,
  type DefectType,
  type FindingDraftSeed,
  findingSeedFromPhotoDraft,
  labelOf,
  PHOTO_CATEGORY_OPTIONS,
  type PhotoCategory,
  type PhotoDraft,
  SEVERITY_OPTIONS,
  type Severity,
  useAiEnabled,
} from "@/lib/ai"
import { inspectionKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

/*
 * Block 10A — how a site photo is filed: a category, the defects it shows
 * and a severity. Under the photo in the viewer:
 *
 *   Analyse with AI — the photo goes (server side, straight from S3) to the
 *                     model, which proposes category, candidate defects with
 *                     a note and confidence each, a severity and a finding
 *                     title. Shown as an AI draft; nothing is saved yet.
 *   File photo      — saves the (possibly edited) choices; with a draft this
 *                     is the inspector's confirmation and is logged with it.
 *   Log as finding  — opens Log a finding pre-filled from the draft.
 *   Dismiss         — sets the draft aside (logged as dismissed).
 *
 * Filing works by hand too, without AI. Inspection photos only (ITP line
 * evidence is filed by its line). Viewers see the filing, read only.
 */

interface Choices {
  category: PhotoCategory | ""
  defects: DefectType[]
  severity: Severity | ""
}

function choicesFromPhoto(photo: PhotoPublic): Choices {
  return {
    category: (photo.category as PhotoCategory | null) ?? "",
    defects: (photo.defect_tags as DefectType[] | null) ?? [],
    severity: (photo.severity as Severity | null) ?? "",
  }
}

function choicesFromDraft(draft: PhotoDraft): Choices {
  return {
    category: draft.category,
    defects: [...new Set(draft.defects.map((d) => d.type))],
    severity: draft.severity ?? "",
  }
}

const chip =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"

export function PhotoFilingPanel({
  photo,
  canWrite,
}: {
  photo: PhotoPublic
  canWrite: boolean
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const aiEnabled = useAiEnabled()
  const [editing, setEditing] = useState(false)
  const [choices, setChoices] = useState<Choices>(() => choicesFromPhoto(photo))
  const [suggestion, setSuggestion] = useState<AiSuggestionPublic | null>(null)
  const [findingSeed, setFindingSeed] = useState<FindingDraftSeed | null>(null)

  // A different photo: start over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: per photo only
  useEffect(() => {
    setEditing(false)
    setSuggestion(null)
    setChoices(choicesFromPhoto(photo))
  }, [photo.id])

  const draft = suggestion?.draft as PhotoDraft | undefined
  const inspectionId = photo.inspection_id ?? 0

  const refresh = (saved: PhotoPublic) => {
    queryClient.setQueryData<PhotoPublic[]>(
      inspectionKeys.photos(inspectionId),
      (current) => current?.map((p) => (p.id === saved.id ? saved : p)),
    )
    queryClient.invalidateQueries({
      queryKey: inspectionKeys.photos(inspectionId),
    })
  }

  const analyse = useMutation({
    mutationFn: async () =>
      (await AiService.analyzePhoto({ body: { photo_id: photo.id } }))
        .data as AiSuggestionPublic,
    onSuccess: (result) => {
      setSuggestion(result)
      setChoices(choicesFromDraft(result.draft as unknown as PhotoDraft))
      setEditing(true)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const save = useMutation({
    mutationFn: async () =>
      (
        await PhotosService.filePhoto({
          path: { photo_id: photo.id },
          body: {
            category: choices.category || null,
            defect_tags: choices.defects,
            severity: choices.severity || null,
            ai_suggestion_id: suggestion?.id ?? null,
          },
        })
      ).data as PhotoPublic,
    onSuccess: (saved) => {
      showSuccessToast(saved.category ? "Photo filed" : "Filing cleared")
      refresh(saved)
      setSuggestion(null)
      setEditing(false)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const dismiss = () => {
    if (suggestion) {
      AiService.dismissSuggestion({
        path: { suggestion_id: suggestion.id },
      }).catch(() => undefined)
    }
    setSuggestion(null)
    setEditing(false)
    setChoices(choicesFromPhoto(photo))
  }

  if (photo.inspection_id === null) return null

  const filed = photo.category || (photo.defect_tags?.length ?? 0) > 0
  const busy = analyse.isPending || save.isPending

  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="photo-filing">
      {!editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {filed ? (
            <>
              {photo.category ? (
                <span className={cn(chip, "border-white/30")}>
                  <Tag className="size-3" aria-hidden="true" />
                  {labelOf(PHOTO_CATEGORY_OPTIONS, photo.category)}
                </span>
              ) : null}
              {(photo.defect_tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className={cn(chip, "border-vri-gold/70 text-vri-gold")}
                >
                  {labelOf(DEFECT_TYPE_OPTIONS, tag)}
                </span>
              ))}
              {photo.severity ? (
                <span className={cn(chip, "border-white/30")}>
                  Severity {labelOf(SEVERITY_OPTIONS, photo.severity)}
                </span>
              ) : null}
              {photo.ai_suggestion_id ? (
                <span
                  className="text-xs text-white/60"
                  title="Filed from an AI draft the inspector confirmed"
                >
                  AI-assisted
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-white/60">Not filed yet.</span>
          )}
          {canWrite ? (
            <span className="ml-auto flex gap-1.5">
              {aiEnabled ? (
                <LoadingButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={analyse.isPending}
                  onClick={() => analyse.mutate()}
                  data-testid="photo-analyse"
                >
                  {analyse.isPending ? null : <Sparkles />}
                  {analyse.isPending ? "Analysing…" : "Analyse with AI"}
                </LoadingButton>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setChoices(choicesFromPhoto(photo))
                  setEditing(true)
                }}
                data-testid="photo-file"
              >
                <Tag />
                {filed ? "Change filing" : "File photo"}
              </Button>
            </span>
          ) : null}
        </div>
      ) : (
        <div
          className="flex flex-col gap-2 rounded-md border border-white/20 bg-white/5 p-2.5"
          data-testid="photo-filing-editor"
        >
          {draft ? (
            <p
              className="flex items-start gap-2 rounded border border-vri-gold/60 bg-vri-gold/15 p-2 text-xs"
              role="status"
              data-testid="photo-ai-draft"
            >
              <Sparkles
                className="mt-0.5 size-4 shrink-0 text-vri-gold"
                aria-hidden="true"
              />
              <span>
                <strong>AI draft — check it against the photo.</strong> Nothing
                is saved until you tap <strong>File photo</strong> or{" "}
                <strong>Log as finding</strong>.
              </span>
            </p>
          ) : null}

          <label className="flex flex-col gap-1 text-xs">
            Category
            <select
              className="h-9 rounded-md border border-white/30 bg-vri-charcoal px-2 text-sm"
              value={choices.category}
              onChange={(e) =>
                setChoices((c) => ({
                  ...c,
                  category: e.target.value as Choices["category"],
                }))
              }
              data-testid="photo-category"
            >
              <option value="">Not set</option>
              {PHOTO_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1 text-xs">
            <legend className="mb-1">Defects seen</legend>
            <div className="flex flex-wrap gap-1.5">
              {DEFECT_TYPE_OPTIONS.map((o) => {
                const on = choices.defects.includes(o.value)
                const proposed = draft?.defects.find((d) => d.type === o.value)
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setChoices((c) => ({
                        ...c,
                        defects: on
                          ? c.defects.filter((d) => d !== o.value)
                          : [...c.defects, o.value],
                      }))
                    }
                    className={cn(
                      chip,
                      "min-h-8 px-3",
                      on
                        ? "border-vri-gold bg-vri-gold text-vri-charcoal"
                        : "border-white/30",
                    )}
                    title={proposed?.note || undefined}
                    data-testid={`photo-defect-${o.value}`}
                  >
                    {o.label}
                    {proposed?.confidence !== undefined &&
                    proposed?.confidence !== null ? (
                      <span className="opacity-70">
                        {confidenceText(proposed.confidence)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {draft && draft.defects.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-white/70">
                {draft.defects.map((d) => (
                  <li key={`${d.type}-${d.note}`}>
                    {labelOf(DEFECT_TYPE_OPTIONS, d.type)}
                    {d.note ? ` — ${d.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>

          <label className="flex flex-col gap-1 text-xs">
            Severity
            <select
              className="h-9 rounded-md border border-white/30 bg-vri-charcoal px-2 text-sm"
              value={choices.severity}
              onChange={(e) =>
                setChoices((c) => ({
                  ...c,
                  severity: e.target.value as Choices["severity"],
                }))
              }
              data-testid="photo-severity"
            >
              <option value="">None</option>
              {SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap justify-end gap-1.5 pt-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={dismiss}
              disabled={busy}
              data-testid="photo-filing-cancel"
            >
              <X />
              {draft ? "Dismiss" : "Cancel"}
            </Button>
            {draft ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  suggestion &&
                  setFindingSeed(
                    findingSeedFromPhotoDraft(suggestion.id, {
                      ...draft,
                      severity: choices.severity || null,
                    }),
                  )
                }
                disabled={busy}
                data-testid="photo-log-finding"
              >
                <ClipboardPlus />
                Log as finding
              </Button>
            ) : null}
            <LoadingButton
              type="button"
              size="sm"
              loading={save.isPending}
              onClick={() => save.mutate()}
              disabled={analyse.isPending}
              data-testid="photo-filing-save"
            >
              File photo
            </LoadingButton>
          </div>
        </div>
      )}
      <FindingFormDialog
        open={findingSeed !== null}
        onOpenChange={(next) => {
          if (!next) setFindingSeed(null)
        }}
        inspectionId={inspectionId}
        draft={findingSeed ?? undefined}
      />
    </div>
  )
}
