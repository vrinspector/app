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

import {
  type ItpItemPublic,
  ItpsService,
  type PhotoPublic,
  PhotosService,
} from "@/client"
import { usePhotoPicker } from "@/components/Photos/PhotoCapture"
import { PhotoViewerDialog } from "@/components/Photos/PhotoViewerDialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import useCustomToast from "@/hooks/useCustomToast"
import { useItpPhotoUpload } from "@/hooks/useItpPhotoUpload"
import { formatMeasured, THREE_SHOT_SLOTS, toleranceLabel } from "@/lib/itp"
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
 *
 * Increment 13.8: a line whose template sets `photoSet: "three_shot"` shows
 * three labelled slots — Context, Intermediate, Close-up with scale — each
 * with its own one-line hint and Take / Upload, and counts as evidenced only
 * when every slot has a photo.
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

  if (item.photo_set === "three_shot") {
    return (
      <ThreeShotPhotos
        item={item}
        photos={list}
        canAdd={canAdd}
        upload={upload}
        onChanged={onChanged}
      />
    )
  }
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

type ItpUpload = ReturnType<typeof useItpPhotoUpload>

function ThreeShotPhotos({
  item,
  photos,
  canAdd,
  upload,
  onChanged,
}: {
  item: ItpItemPublic
  photos: PhotoPublic[]
  canAdd: boolean
  upload: ItpUpload
  onChanged: () => void
}) {
  const [viewing, setViewing] = useState<number | null>(null)
  const filled = new Set(item.shot_slots ?? [])
  const complete = THREE_SHOT_SLOTS.every((slot) => filled.has(slot.value))
  const extras = photos.filter((p) => !p.shot_slot)
  const open = (photo: PhotoPublic) => setViewing(photos.indexOf(photo))

  return (
    <div className="flex flex-col gap-2" data-testid="itp-three-shot">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        {complete ? (
          <span
            className="inline-flex items-center gap-1 font-medium text-status-positive-fg"
            data-testid="itp-three-shot-complete"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Three-shot set on file
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 font-medium text-status-critical-fg"
            data-testid="itp-three-shot-needed"
          >
            <Camera className="size-4" aria-hidden="true" />
            Three-shot set: {filled.size} of 3 — needed before Pass
          </span>
        )}
      </p>
      <ol className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
        {THREE_SHOT_SLOTS.map((slot, n) => (
          <ShotSlotTile
            key={slot.value}
            number={n + 1}
            slot={slot}
            photos={photos.filter((p) => p.shot_slot === slot.value)}
            uploads={upload.uploads.filter((u) => u.slot === slot.value)}
            canAdd={canAdd}
            onFiles={(files) => upload.addFiles(files, slot.value)}
            onRetry={upload.retry}
            onOpen={open}
          />
        ))}
      </ol>
      {extras.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Other photos</span>
          {extras.map((photo) => (
            <Thumb key={photo.id} photo={photo} onOpen={open} small />
          ))}
        </div>
      ) : null}
      <PhotoViewerDialog
        photos={photos}
        index={viewing}
        onIndexChange={setViewing}
        canWrite={canAdd}
        onDeleted={onChanged}
      />
    </div>
  )
}

function ShotSlotTile({
  number,
  slot,
  photos,
  uploads,
  canAdd,
  onFiles,
  onRetry,
  onOpen,
}: {
  number: number
  slot: (typeof THREE_SHOT_SLOTS)[number]
  photos: PhotoPublic[]
  uploads: ItpUpload["uploads"]
  canAdd: boolean
  onFiles: (files: FileList | null) => void
  onRetry: (id: string) => void
  onOpen: (photo: PhotoPublic) => void
}) {
  const picker = usePhotoPicker(onFiles)
  const has = photos.length > 0
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-md border p-2",
        has
          ? "border-status-positive-fg/40 bg-status-positive-bg/40"
          : "border-dashed",
      )}
      data-testid="itp-shot-slot"
      data-slot={slot.value}
      data-filled={has ? "true" : "false"}
    >
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-vri-green text-xs text-vri-offwhite">
          {number}
        </span>
        {slot.label}
        {has ? (
          <CheckCircle2
            className="size-4 text-status-positive-fg"
            aria-label="On file"
          />
        ) : null}
      </p>
      <p className="text-xs leading-snug text-muted-foreground">{slot.hint}</p>
      {has || uploads.length ? (
        <div className="flex flex-wrap gap-1.5">
          {uploads.map((u) => (
            <span
              key={u.id}
              className="relative size-14 overflow-hidden rounded-md border"
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
                  onClick={() => onRetry(u.id)}
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
            </span>
          ))}
          {photos.map((photo) => (
            <Thumb key={photo.id} photo={photo} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
      {canAdd ? (
        <div className="mt-auto flex gap-1">
          {picker.inputs}
          <Button
            size="sm"
            variant={has ? "ghost" : "outline"}
            className="flex-1"
            onClick={picker.openCamera}
            aria-label={`Take ${slot.label} photo`}
            data-testid={`itp-shot-take-${slot.value}`}
          >
            <Camera />
            {has ? "Another" : "Take"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={picker.openLibrary}
            aria-label={`Upload ${slot.label} photo`}
            data-testid={`itp-shot-upload-${slot.value}`}
          >
            <ImagePlus />
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function Thumb({
  photo,
  onOpen,
  small = false,
}: {
  photo: PhotoPublic
  onOpen: (photo: PhotoPublic) => void
  small?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        "overflow-hidden rounded-md border hover:border-vri-gold",
        small ? "size-10" : "size-14",
      )}
      onClick={() => onOpen(photo)}
      data-testid="itp-photo"
      data-slot={photo.shot_slot ?? ""}
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
  )
}
