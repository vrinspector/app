import { useMutation, useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  BookOpen,
  Camera,
  CheckCircle2,
  ClipboardList,
  ImagePlus,
  Loader2,
  RotateCcw,
  Ruler,
  Target,
} from "lucide-react"
import { useEffect, useId, useState } from "react"

import { type ItpItemPublic, ItpsService, PhotosService } from "@/client"
import { usePhotoPicker } from "@/components/Photos/PhotoCapture"
import { PhotoViewerDialog } from "@/components/Photos/PhotoViewerDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import useCustomToast from "@/hooks/useCustomToast"
import { useItpPhotoUpload } from "@/hooks/useItpPhotoUpload"
import { formatMeasured, toleranceLabel } from "@/lib/itp"
import { itpKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

/*
 * Increment 13.6 — what a line asks for and the evidence that answers it.
 *
 * `LineCriteria` prints the template's acceptance criteria, reference
 * document and record required under the line title. `MeasuredValue` is the
 * number / text entry for lines that record a value (unit label, tolerance,
 * out-of-tolerance flag), entered alongside Pass / Fail. `LinePhotos` is
 * Take photo / Upload on any line, using the same presign → S3 → register
 * flow as site photos; a line whose template sets `photoRequired` shows
 * "Photo required" until one is on file, and the API refuses Pass and
 * sign-off until then.
 */

export function LineCriteria({ item }: { item: ItpItemPublic }) {
  const rows = [
    {
      key: "criteria",
      icon: Target,
      label: "Acceptance criteria",
      value: item.acceptance_criteria,
    },
    {
      key: "reference",
      icon: BookOpen,
      label: "Reference",
      value: item.reference_doc,
    },
    {
      key: "record",
      icon: ClipboardList,
      label: "Record required",
      value: item.record_required,
    },
  ].filter((row) => row.value)
  if (!rows.length) return null
  return (
    <dl
      className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3"
      data-testid="itp-line-criteria"
    >
      {rows.map(({ key, icon: Icon, label, value }) => (
        <div key={key} className="contents" data-testid={`itp-criteria-${key}`}>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {label}
          </dt>
          <dd className="mb-1 whitespace-pre-wrap sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function MeasuredValue({
  item,
  canRecord,
  onSaved,
}: {
  item: ItpItemPublic
  canRecord: boolean
  onSaved: () => void
}) {
  const id = useId()
  const { showErrorToast } = useCustomToast()
  const [draft, setDraft] = useState(item.measured_value ?? "")
  useEffect(() => setDraft(item.measured_value ?? ""), [item.measured_value])

  const save = useMutation({
    mutationFn: (value: string | null) =>
      ItpsService.updateItpItem({
        path: { item_id: item.id },
        body: { measured_value: value },
      }),
    onSuccess: onSaved,
    onError: (error: Error) => {
      showErrorToast(extractErrorMessage(error))
      setDraft(item.measured_value ?? "")
    },
  })

  if (!item.value_type) return null
  const isNumber = item.value_type === "number"
  const tolerance = toleranceLabel(
    item.value_min,
    item.value_max,
    item.value_unit,
  )
  const commit = () => {
    const value = draft.trim()
    if (value === (item.measured_value ?? "")) return
    save.mutate(value || null)
  }

  return (
    <div className="flex flex-col gap-1" data-testid="itp-measured">
      <label
        htmlFor={id}
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Ruler className="size-3.5" aria-hidden="true" />
        {isNumber ? "Measured value" : "Recorded value"}
        {tolerance ? (
          <span data-testid="itp-tolerance">· required {tolerance}</span>
        ) : null}
      </label>
      {canRecord ? (
        <div className="flex items-center gap-2 sm:max-w-md">
          <Input
            id={id}
            value={draft}
            inputMode={isNumber ? "decimal" : "text"}
            placeholder={isNumber ? "0.0" : "Enter what was recorded"}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                commit()
              }
            }}
            className={cn(
              "h-11 text-base",
              item.out_of_tolerance && "border-destructive",
            )}
            aria-invalid={item.out_of_tolerance === true}
            data-testid="itp-measured-input"
          />
          {item.value_unit ? (
            <span
              className="min-w-8 text-sm font-medium"
              data-testid="itp-measured-unit"
            >
              {item.value_unit}
            </span>
          ) : null}
          {save.isPending ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Saving"
            />
          ) : null}
        </div>
      ) : (
        <p className="font-medium" data-testid="itp-measured-readonly">
          {formatMeasured(item.measured_value, item.value_unit) || "—"}
        </p>
      )}
      {item.out_of_tolerance ? (
        <p
          className="flex items-center gap-1.5 text-sm font-medium text-status-critical-fg"
          data-testid="itp-out-of-tolerance"
        >
          <AlertTriangle className="size-4" aria-hidden="true" />
          Out of tolerance{tolerance ? ` (required ${tolerance})` : ""}
        </p>
      ) : null}
    </div>
  )
}

export function LinePhotos({
  item,
  canAdd,
  onChanged,
}: {
  item: ItpItemPublic
  canAdd: boolean
  onChanged: () => void
}) {
  const [viewing, setViewing] = useState<number | null>(null)
  const count = item.photo_count ?? 0
  const photos = useQuery({
    queryKey: itpKeys.photos(item.id),
    queryFn: async () =>
      (await PhotosService.listPhotos({ query: { itp_item_id: item.id } }))
        .data ?? [],
    enabled: count > 0,
  })
  const upload = useItpPhotoUpload(item.id, onChanged)
  const picker = usePhotoPicker(upload.addFiles)
  const list = count > 0 ? (photos.data ?? []) : []
  const onFile = count > 0

  if (!onFile && !canAdd && !item.photo_required) return null

  return (
    <div className="flex flex-col gap-2" data-testid="itp-line-photos">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {onFile ? (
          <span
            className="inline-flex items-center gap-1 font-medium text-status-positive-fg"
            data-testid="itp-photo-on-file"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Photo on file
            {count > 1 ? ` (${count})` : ""}
          </span>
        ) : item.photo_required ? (
          <span
            className="inline-flex items-center gap-1 font-medium text-status-critical-fg"
            data-testid="itp-photo-required"
          >
            <Camera className="size-4" aria-hidden="true" />
            Photo required before Pass
          </span>
        ) : null}
        {canAdd ? (
          <>
            {picker.inputs}
            <Button
              size="sm"
              variant="outline"
              onClick={picker.openCamera}
              data-testid="itp-take-photo"
            >
              <Camera />
              Take photo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={picker.openLibrary}
              data-testid="itp-upload-photo"
            >
              <ImagePlus />
              Upload
            </Button>
          </>
        ) : null}
      </div>

      {list.length || upload.uploads.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Line photos">
          {upload.uploads.map((u) => (
            <li
              key={u.id}
              className="relative size-16 overflow-hidden rounded-md border"
              data-testid="itp-photo-upload"
            >
              <img
                src={u.previewUrl}
                alt="Uploading"
                className="size-full object-cover opacity-60"
              />
              {u.status === "error" ? (
                <button
                  type="button"
                  className="absolute inset-0 flex items-center justify-center bg-destructive/70 text-white"
                  onClick={() => upload.retry(u.id)}
                  title={u.error}
                  aria-label={`Retry upload: ${u.error ?? "failed"}`}
                >
                  <RotateCcw className="size-4" />
                </button>
              ) : (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-muted">
                  <span
                    className="block h-full bg-vri-green"
                    style={{ width: `${u.progress}%` }}
                  />
                </span>
              )}
            </li>
          ))}
          {list.map((photo, index) => (
            <li key={photo.id}>
              <button
                type="button"
                className="size-16 overflow-hidden rounded-md border hover:border-vri-gold"
                onClick={() => setViewing(index)}
                data-testid="itp-photo"
              >
                {photo.view_url ? (
                  <img
                    src={photo.view_url}
                    alt={photo.filename ?? "Line photo"}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <Camera className="m-auto size-5 text-muted-foreground" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <PhotoViewerDialog
        photos={list}
        index={viewing}
        onIndexChange={setViewing}
        canWrite={canAdd}
        onDeleted={onChanged}
      />
    </div>
  )
}
