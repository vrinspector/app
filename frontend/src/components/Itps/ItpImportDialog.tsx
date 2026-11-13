import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  FileUp,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"

import {
  AiService,
  type AiSuggestionPublic,
  type ImportLine,
  type ImportRole,
  type ImportSection,
  type ItpImportDraft,
  type ItpTemplatePublic,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { PARTY_OPTIONS, type Party } from "@/lib/itp"
import {
  checkDraft,
  type DraftValueType,
  emptyLine,
  emptySection,
  IMPORT_ACCEPT,
  LETTER_OPTIONS,
  type Letter,
  VALUE_OPTIONS,
} from "@/lib/itpImport"
import { itpKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

/*
 * Import an ITP with AI (increment 16; PRD v2.63 Block 10E; owner decision
 * 2026-11-10: import is how custom templates are made — no paid builder).
 *
 * 1. Choose the existing ITP: a PDF, an Excel / CSV sheet, or photos of the
 *    paper form (Take photo opens the camera). An optional note helps the
 *    reading ("only the slab section").
 * 2. "Read with AI" — the server reads it into a draft of sections and lines.
 * 3. Review the draft in a plain form: every line's wording, H / W / R / I,
 *    criteria, reference, record, who signs, photo and measured value. Add,
 *    remove, fix. What the AI couldn't read is listed at the top.
 * 4. "Save as master template" saves it as a **draft** master; nothing is
 *    saved before that. Discard tells the server the draft was set aside.
 */

const MAX_FILES = 8

interface ItpImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (template: ItpTemplatePublic) => void
}

export function ItpImportDialog({
  open,
  onOpenChange,
  onSaved,
}: ItpImportDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [files, setFiles] = useState<File[]>([])
  const [hint, setHint] = useState("")
  const [suggestion, setSuggestion] = useState<AiSuggestionPublic | null>(null)
  const [draft, setDraft] = useState<ItpImportDraft | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setFiles([])
    setHint("")
    setSuggestion(null)
    setDraft(null)
    setName("")
    setDescription("")
  }, [open])

  const readMutation = useMutation({
    mutationFn: async () =>
      (
        await AiService.itpImport({
          body: { files, hint: hint.trim() || null },
        })
      ).data as AiSuggestionPublic,
    onSuccess: (result) => {
      const read = (result.draft ?? {}) as ItpImportDraft
      setSuggestion(result)
      setDraft(read)
      setName(read.name ?? "")
      setDescription(read.description ?? "")
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const check = useMemo(
    () => (draft ? checkDraft(draft, name) : null),
    [draft, name],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!suggestion || !draft) throw new Error("Read a file first.")
      return (
        await AiService.saveItpImport({
          path: { suggestion_id: suggestion.id },
          body: {
            name: name.trim(),
            description: description.trim() || null,
            draft,
          },
        })
      ).data as ItpTemplatePublic
    },
    onSuccess: (saved) => {
      showSuccessToast("Saved as a draft master template")
      queryClient.invalidateQueries({ queryKey: itpKeys.templates })
      onOpenChange(false)
      onSaved?.(saved)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const busy = readMutation.isPending || saveMutation.isPending

  const discard = () => {
    if (suggestion && !saveMutation.isSuccess) {
      AiService.dismissSuggestion({
        path: { suggestion_id: suggestion.id },
      }).catch(() => undefined)
    }
    onOpenChange(false)
  }

  const addFiles = (list: FileList | null) => {
    if (!list) return
    setFiles((current) => [...current, ...Array.from(list)].slice(0, MAX_FILES))
  }

  // --- draft editing helpers ---------------------------------------------------
  const update = (next: Partial<ItpImportDraft>) =>
    setDraft((current) => (current ? { ...current, ...next } : current))
  const sections = draft?.sections ?? []
  const roles = draft?.roles ?? []
  const setSections = (next: ImportSection[]) => update({ sections: next })
  const setSection = (index: number, next: Partial<ImportSection>) =>
    setSections(sections.map((s, i) => (i === index ? { ...s, ...next } : s)))
  const setLine = (si: number, li: number, next: Partial<ImportLine>) =>
    setSection(si, {
      lines: (sections[si].lines ?? []).map((l, i) =>
        i === li ? { ...l, ...next } : l,
      ),
    })
  const setRole = (index: number, next: Partial<ImportRole>) => {
    const before = roles[index]?.name ?? ""
    const renamed = next.name !== undefined && next.name !== before
    update({
      roles: roles.map((r, i) => (i === index ? { ...r, ...next } : r)),
      // Renaming a role renames it on every line that it signs.
      sections: renamed
        ? sections.map((s) => ({
            ...s,
            lines: (s.lines ?? []).map((l) => ({
              ...l,
              roles: (l.roles ?? []).map((r) =>
                r === before ? (next.name ?? r) : r,
              ),
            })),
          }))
        : sections,
    })
  }
  const removeRole = (index: number) => {
    const gone = roles[index]?.name
    update({
      roles: roles.filter((_, i) => i !== index),
      sections: sections.map((s) => ({
        ...s,
        lines: (s.lines ?? []).map((l) => ({
          ...l,
          roles: (l.roles ?? []).filter((r) => r !== gone),
        })),
      })),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        if (!next) discard()
        else onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-h-[94dvh] overflow-y-auto sm:max-w-3xl"
        data-testid="itp-import-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-vri-copper" aria-hidden="true" />
            Import an ITP
          </DialogTitle>
          <DialogDescription>
            {draft
              ? "Check every line against your document, fix anything the AI misread, then save it as a draft master template."
              : "Upload the ITP you already use — a PDF, an Excel or CSV sheet, or photos of the paper form — and the AI turns it into a template for you to check."}
          </DialogDescription>
        </DialogHeader>

        {draft === null ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={busy || files.length >= MAX_FILES}
                data-testid="import-choose-files"
              >
                <FileUp />
                Choose files
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => cameraInput.current?.click()}
                disabled={busy || files.length >= MAX_FILES}
              >
                <Camera />
                Take photo
              </Button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={IMPORT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                aria-label="ITP files"
                data-testid="import-file-input"
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ""
                }}
              />
              <input
                ref={cameraInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                tabIndex={-1}
                aria-label="Photo of the ITP"
                onChange={(event) => {
                  addFiles(event.target.files)
                  event.target.value = ""
                }}
              />
            </div>
            {files.length ? (
              <ul
                className="divide-y rounded-md border text-sm"
                data-testid="import-file-list"
              >
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {Math.max(1, Math.round(file.size / 1024))} KB
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setFiles(files.filter((_, i) => i !== index))
                      }
                      disabled={busy}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                One ITP at a time: a PDF (scanned is fine), an .xlsx or .csv
                sheet, or up to {MAX_FILES} photos of its pages.
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="import-hint">Note for the AI (optional)</Label>
              <Input
                id="import-hint"
                value={hint}
                maxLength={500}
                onChange={(event) => setHint(event.target.value)}
                placeholder="e.g. Only the slab-on-grade section; column D is the inspection code"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              The file is kept with your account and sent only to the AI service
              to be read. Nothing becomes a template until you save it.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={discard}
                disabled={busy}
              >
                Cancel
              </Button>
              <LoadingButton
                type="button"
                loading={readMutation.isPending}
                disabled={files.length === 0 || busy}
                onClick={() => readMutation.mutate()}
                data-testid="import-read"
              >
                {readMutation.isPending ? null : <Sparkles />}
                {readMutation.isPending ? "Reading…" : "Read with AI"}
              </LoadingButton>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (check?.ok && !busy) saveMutation.mutate()
            }}
            noValidate
            data-testid="import-review"
          >
            <div
              className="flex items-start gap-2 rounded-md border border-vri-gold/60 bg-vri-gold/10 p-2.5 text-xs"
              role="status"
              data-testid="import-ai-notice"
            >
              <Sparkles
                className="mt-0.5 size-4 shrink-0 text-vri-copper"
                aria-hidden="true"
              />
              <div className="flex-1">
                <p>
                  <strong>
                    AI draft — check every line against your file.
                  </strong>{" "}
                  Nothing is saved until you tap{" "}
                  <strong>Save as master template</strong>.
                </p>
                {draft.notes?.length ? (
                  <ul
                    className="mt-1 list-disc pl-4"
                    data-testid="import-notes"
                  >
                    {draft.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="import-name">Template name</Label>
                <Input
                  id="import-name"
                  value={name}
                  maxLength={255}
                  onChange={(event) => setName(event.target.value)}
                  data-testid="import-name"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="import-description">Description</Label>
                <Input
                  id="import-description"
                  value={description}
                  maxLength={2000}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </div>

            <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
              <legend className="px-1 text-sm font-semibold">
                Who signs ({roles.length})
              </legend>
              {roles.map((role, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_14rem_auto]"
                  data-testid="import-role"
                >
                  <Input
                    aria-label={`Role ${index + 1} name`}
                    value={role.name}
                    maxLength={255}
                    onChange={(event) =>
                      setRole(index, { name: event.target.value })
                    }
                  />
                  <div className="col-span-2 max-sm:order-3 sm:col-span-1">
                    <NativeSelect
                      aria-label={`Role ${index + 1} party`}
                      value={role.party ?? "contractor"}
                      onChange={(event) =>
                        setRole(index, { party: event.target.value as Party })
                      }
                    >
                      {PARTY_OPTIONS.map((p) => (
                        <option key={p.value} value={p.value}>
                          Signs for: {p.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove role ${role.name}`}
                    onClick={() => removeRole(index)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update({
                      roles: [...roles, { name: "", party: "contractor" }],
                    })
                  }
                >
                  <Plus />
                  Add role
                </Button>
              </div>
            </fieldset>

            {sections.map((section, si) => (
              <fieldset
                key={si}
                className="flex flex-col gap-3 rounded-lg border"
                data-testid="import-section"
              >
                <div className="flex items-center gap-2 rounded-t-lg bg-vri-green px-3 py-2">
                  <Input
                    aria-label={`Section ${si + 1} title`}
                    value={section.title ?? ""}
                    onChange={(event) =>
                      setSection(si, { title: event.target.value })
                    }
                    placeholder={`Section ${si + 1}`}
                    className="h-8 border-vri-offwhite/30 bg-transparent font-serif text-vri-offwhite placeholder:text-vri-offwhite/60"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-vri-offwhite hover:bg-vri-offwhite/10 hover:text-vri-offwhite"
                    aria-label={`Remove section ${section.title || si + 1}`}
                    onClick={() =>
                      setSections(sections.filter((_, i) => i !== si))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                <ol className="flex flex-col gap-3 px-3">
                  {(section.lines ?? []).map((line, li) => (
                    <LineEditor
                      key={li}
                      number={`${si + 1}.${li + 1}`}
                      line={line}
                      roles={roles}
                      onChange={(next) => setLine(si, li, next)}
                      onRemove={() =>
                        setSection(si, {
                          lines: (section.lines ?? []).filter(
                            (_, i) => i !== li,
                          ),
                        })
                      }
                    />
                  ))}
                </ol>
                <div className="px-3 pb-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSection(si, {
                        lines: [...(section.lines ?? []), emptyLine()],
                      })
                    }
                    data-testid="import-add-line"
                  >
                    <Plus />
                    Add line
                  </Button>
                </div>
              </fieldset>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSections([...sections, emptySection()])}
              >
                <Plus />
                Add section
              </Button>
            </div>

            {check?.ok ? (
              <p
                className="flex items-center gap-1.5 text-sm text-status-positive-fg"
                data-testid="import-check"
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {check.lines} line{check.lines === 1 ? "" : "s"} · {check.holds}{" "}
                hold point{check.holds === 1 ? "" : "s"} · {check.roles}{" "}
                sign-off role{check.roles === 1 ? "" : "s"}
              </p>
            ) : check ? (
              <p
                className="flex items-start gap-1.5 text-sm text-destructive"
                role="alert"
                data-testid="import-check"
              >
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                {check.error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={discard}
                disabled={busy}
                data-testid="import-discard"
              >
                Discard
              </Button>
              <LoadingButton
                type="submit"
                loading={saveMutation.isPending}
                disabled={!check?.ok || busy}
                data-testid="import-save"
              >
                Save as master template
              </LoadingButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LineEditor({
  number,
  line,
  roles,
  onChange,
  onRemove,
}: {
  number: string
  line: ImportLine
  roles: ImportRole[]
  onChange: (next: Partial<ImportLine>) => void
  onRemove: () => void
}) {
  const letter = (line.classification ?? "I") as Letter
  const valueType = (line.value_type ?? "none") as DraftValueType
  const signers = line.roles ?? []
  const uid = useId()
  const toggleSigner = (name: string, on: boolean) =>
    onChange({
      roles: on ? [...signers, name] : signers.filter((r) => r !== name),
    })
  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-md border p-2.5",
        letter === "H" && "border-l-4 border-l-vri-brick",
      )}
      data-testid="import-line"
    >
      <div className="flex items-start gap-2">
        <span className="mt-2 w-8 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">
          {number}
        </span>
        <Textarea
          aria-label={`Line ${number}`}
          value={line.title}
          rows={2}
          maxLength={500}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="What is checked"
          className="min-h-0 flex-1"
          data-testid="import-line-title"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remove line ${number}`}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <NativeSelect
          aria-label={`Line ${number} classification`}
          value={letter}
          onChange={(event) =>
            onChange({ classification: event.target.value as Letter })
          }
          data-testid="import-line-classification"
        >
          {LETTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <NativeSelect
            aria-label={`Line ${number} result`}
            value={valueType}
            onChange={(event) =>
              onChange({ value_type: event.target.value as DraftValueType })
            }
          >
            {VALUE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
          <Input
            aria-label={`Line ${number} unit`}
            value={line.unit ?? ""}
            maxLength={40}
            disabled={valueType === "none"}
            onChange={(event) => onChange({ unit: event.target.value || null })}
            placeholder="unit"
          />
        </div>
      </div>
      <Input
        aria-label={`Line ${number} acceptance criteria`}
        value={line.acceptance_criteria ?? ""}
        maxLength={2000}
        onChange={(event) =>
          onChange({ acceptance_criteria: event.target.value || null })
        }
        placeholder="Acceptance criteria"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          aria-label={`Line ${number} reference`}
          value={line.reference ?? ""}
          maxLength={500}
          onChange={(event) =>
            onChange({ reference: event.target.value || null })
          }
          placeholder="Reference (spec, standard, drawing)"
        />
        <Input
          aria-label={`Line ${number} record`}
          value={line.record_required ?? ""}
          maxLength={500}
          onChange={(event) =>
            onChange({ record_required: event.target.value || null })
          }
          placeholder="Record to keep"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="text-xs text-muted-foreground">Signed by:</span>
        {roles.map((role, index) =>
          role.name ? (
            <span key={role.name} className="flex items-center gap-1.5">
              <Checkbox
                id={`${uid}-role-${index}`}
                checked={signers.includes(role.name)}
                onCheckedChange={(checked) =>
                  toggleSigner(role.name, checked === true)
                }
              />
              <Label htmlFor={`${uid}-role-${index}`} className="font-normal">
                {role.name}
              </Label>
            </span>
          ) : null,
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <Checkbox
            id={`${uid}-photo`}
            checked={Boolean(line.photo_required)}
            onCheckedChange={(checked) =>
              onChange({ photo_required: checked === true })
            }
          />
          <Label htmlFor={`${uid}-photo`} className="font-normal">
            Photo required
          </Label>
        </span>
      </div>
    </li>
  )
}
