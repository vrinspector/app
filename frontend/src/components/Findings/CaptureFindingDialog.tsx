import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  AlertTriangle,
  Camera,
  ImagePlus,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  X,
} from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"

import {
  type DrawingPublic,
  DrawingsService,
  type FindingPublic,
  FindingsService,
  type PinPublic,
} from "@/client"
import { usePhotoPicker } from "@/components/Photos/PhotoCapture"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { useDictation } from "@/hooks/useDictation"
import {
  type StagedPhoto,
  useStagedPhotoUpload,
} from "@/hooks/useStagedPhotoUpload"
import {
  defaultFindingTitle,
  defaultLocationRef,
  openInspections,
  pickCaptureInspection,
  pinNumber,
  recallCaptureInspection,
  rememberCaptureInspection,
  titleFromTranscript,
} from "@/lib/capture"
import { drawingKeys, inspectionKeys, inspectionsQuery } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { FINDING_PRIORITY_OPTIONS, FINDING_PRIORITY_VALUES } from "@/lib/vocab"
import { extractErrorMessage } from "@/utils"

/*
 * The capture loop (increment 11a; PRD v2.63 §4 "drawing tap → saved
 * finding with photo in under 15 s"). Opens right after a pin is placed:
 *
 *   Take photo  — the rear camera, as on the inspection screen; the upload
 *                 starts at once and runs while the note is dictated
 *   Dictate     — Web Speech into the description; the first sentence
 *                 becomes the title unless one was typed
 *   Save        — POST /findings → POST /photos {finding_id} for each staged
 *                 photo → PUT /pins/{id} {finding_id}; the pin turns into a
 *                 linked pin and the finding appears on the inspection
 *
 * The title and location start filled from the pin and sheet, so a photo
 * plus a spoken sentence (or nothing at all) is enough to save. Findings
 * belong to inspections, so the form picks the open inspection the
 * inspector came from (or last used, or the newest) and lets them change it.
 * "Keep pin only" leaves the pin as placed, exactly as before this increment.
 */

const schema = z.object({
  inspection_id: z.string().min(1, "Choose an inspection"),
  title: z.string().trim().min(1, "Title is required").max(255),
  description: z.string().trim().max(5000),
  priority: z.enum(FINDING_PRIORITY_VALUES),
  location_ref: z.string().trim().max(255),
})

type FormValues = z.infer<typeof schema>

const nullIfBlank = (value: string) => (value.trim() ? value.trim() : null)

interface CaptureFindingDialogProps {
  projectId: number
  drawing: DrawingPublic
  isPdf: boolean
  /** The pin just placed; `null` keeps the dialog closed. */
  pin: PinPublic | null
  /** The inspection the inspector came from (`?inspection=` on the route). */
  preferredInspectionId?: number | null
  onClose: () => void
  /** The pin as saved with its `finding_id`, for the viewer's pin cache. */
  onLinked?: (pin: PinPublic, finding: FindingPublic) => void
}

export function CaptureFindingDialog({
  projectId,
  drawing,
  isPdf,
  pin,
  preferredInspectionId,
  onClose,
  onLinked,
}: CaptureFindingDialogProps) {
  const open = pin !== null
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const inspections = useQuery({
    ...inspectionsQuery(projectId),
    enabled: open,
  })
  const candidates = useMemo(
    () => openInspections(inspections.data),
    [inspections.data],
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      inspection_id: "",
      title: "",
      description: "",
      priority: "medium",
      location_ref: "",
    },
  })
  const titleTouchedRef = useRef(false)

  // Fresh form for each pin; the inspection is chosen once the list is in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on open / new pin only
  useEffect(() => {
    if (!open || !pin) return
    titleTouchedRef.current = false
    form.reset({
      inspection_id: "",
      title: defaultFindingTitle(pin, drawing),
      description: "",
      priority: "medium",
      location_ref: defaultLocationRef(pin, drawing, isPdf),
    })
  }, [open, pin?.id])

  useEffect(() => {
    if (!open || !inspections.data) return
    if (form.getValues("inspection_id")) return
    const chosen = pickCaptureInspection(
      inspections.data,
      preferredInspectionId,
      recallCaptureInspection(projectId),
    )
    if (chosen) {
      form.setValue("inspection_id", String(chosen.id), {
        shouldValidate: true,
      })
    }
  }, [open, inspections.data, preferredInspectionId, projectId, form])

  const inspectionIdValue = form.watch("inspection_id")
  const inspectionId = inspectionIdValue ? Number(inspectionIdValue) : null

  const staged = useStagedPhotoUpload(inspectionId)
  const picker = usePhotoPicker(staged.addFiles)

  const dictation = useDictation({
    onTranscript: (text) => {
      const current = form.getValues("description")
      form.setValue("description", current ? `${current} ${text}` : text, {
        shouldDirty: true,
      })
      if (!titleTouchedRef.current) {
        const title = titleFromTranscript(current ? `${current} ${text}` : text)
        if (title) form.setValue("title", title, { shouldDirty: true })
      }
    },
  })

  // Release the microphone and discard staged photos when the dialog closes.
  useEffect(() => {
    if (!open) {
      dictation.stop()
      staged.clear()
    }
  }, [open, dictation.stop, staged.clear])

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!pin) throw new Error("No pin selected.")
      const targetInspection = Number(values.inspection_id)
      const finding = (
        await FindingsService.createFinding({
          body: {
            inspection_id: targetInspection,
            title: values.title.trim(),
            description: nullIfBlank(values.description),
            priority: values.priority,
            location_ref: nullIfBlank(values.location_ref),
            status: "open",
          },
        })
      ).data as FindingPublic

      const photos = await staged.register(finding.id)

      let linkedPin: PinPublic | null = null
      let linkError: string | null = null
      try {
        linkedPin = (
          await DrawingsService.updatePin({
            path: { pin_id: pin.id },
            body: { finding_id: finding.id },
          })
        ).data as PinPublic
      } catch (error) {
        linkError = extractErrorMessage(error as Error)
      }
      return { finding, photos, linkedPin, linkError, targetInspection }
    },
    onSuccess: ({
      finding,
      photos,
      linkedPin,
      linkError,
      targetInspection,
    }) => {
      rememberCaptureInspection(projectId, targetInspection)
      queryClient.invalidateQueries({
        queryKey: inspectionKeys.findings(targetInspection),
      })
      queryClient.invalidateQueries({
        queryKey: inspectionKeys.photos(targetInspection),
      })
      if (linkedPin) {
        queryClient.setQueryData<PinPublic[]>(
          drawingKeys.pins(drawing.id),
          (c) => c?.map((p) => (p.id === linkedPin.id ? linkedPin : p)),
        )
        queryClient.invalidateQueries({
          queryKey: drawingKeys.pins(drawing.id),
        })
        onLinked?.(linkedPin, finding)
      }
      const photoNote =
        photos.saved.length === 0
          ? ""
          : photos.saved.length === 1
            ? " with 1 photo"
            : ` with ${photos.saved.length} photos`
      if (linkError) {
        showErrorToast(
          `Finding logged${photoNote}, but the pin could not be linked (${linkError}). Open the pin to link it.`,
        )
      } else {
        showSuccessToast(
          `Finding logged${photoNote} and linked to pin #${pin ? pinNumber(pin) : ""}`,
        )
      }
      if (photos.failed > 0) {
        showErrorToast(
          `${photos.failed} photo${photos.failed === 1 ? " did" : "s did"} not upload. Add ${photos.failed === 1 ? "it" : "them"} from the inspection screen.`,
        )
      }
      onClose()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const busy = mutation.isPending
  const chosenInspection = candidates.find((i) => i.id === inspectionId)
  const noOpenInspection =
    inspections.isSuccess && candidates.length === 0 && !inspections.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose()
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-lg"
        data-testid="capture-finding-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            Log a finding at pin #{pin ? pinNumber(pin) : ""}
          </DialogTitle>
          <DialogDescription>
            Photo first, then a sentence. The finding is linked to this pin
            {chosenInspection ? (
              <>
                {" "}
                and saved to <strong>{chosenInspection.title}</strong>
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        {noOpenInspection ? (
          <div
            className="flex flex-col gap-3 rounded-lg border border-dashed p-4 text-sm"
            data-testid="capture-no-inspection"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-vri-copper"
                aria-hidden="true"
              />
              <span>
                This project has no open inspection to log the finding into. The
                pin has been kept. Create an inspection on the project screen,
                then tap the pin to link a finding.
              </span>
            </p>
            <DialogFooter>
              <Button variant="outline" asChild>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: String(projectId) }}
                >
                  Open the project
                </Link>
              </Button>
              <Button onClick={onClose} data-testid="capture-keep-pin">
                Keep pin only
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
              className="flex flex-col gap-4"
              noValidate
            >
              <div
                className="grid grid-cols-2 gap-2"
                data-testid="capture-actions"
              >
                <Button
                  type="button"
                  size="lg"
                  className="h-14 text-base"
                  onClick={picker.openCamera}
                  disabled={busy || inspectionId === null}
                  data-testid="capture-take-photo"
                >
                  <Camera className="size-5" />
                  Take photo
                </Button>
                {dictation.supported ? (
                  <Button
                    type="button"
                    size="lg"
                    variant={dictation.listening ? "destructive" : "outline"}
                    className={cn(
                      "h-14 text-base",
                      dictation.listening && "animate-pulse",
                    )}
                    onClick={dictation.toggle}
                    aria-pressed={dictation.listening}
                    disabled={busy}
                    data-testid="capture-dictate"
                  >
                    {dictation.listening ? (
                      <Square className="size-5" />
                    ) : (
                      <Mic className="size-5" />
                    )}
                    {dictation.listening ? "Stop" : "Dictate"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="h-14 text-base"
                    onClick={picker.openLibrary}
                    disabled={busy || inspectionId === null}
                    data-testid="capture-upload"
                  >
                    <ImagePlus className="size-5" />
                    Upload
                  </Button>
                )}
              </div>
              {dictation.listening ? (
                <p
                  className="-mt-2 text-xs text-destructive"
                  role="status"
                  aria-live="polite"
                >
                  Listening… say what you see, then tap Stop.
                </p>
              ) : dictation.error ? (
                <p
                  className="-mt-2 text-xs text-muted-foreground"
                  role="status"
                >
                  {dictation.error}
                </p>
              ) : null}

              {staged.photos.length > 0 ? (
                <ul
                  className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2"
                  data-testid="capture-photos"
                >
                  {staged.photos.map((photo) => (
                    <StagedTile
                      key={photo.id}
                      photo={photo}
                      disabled={busy}
                      onRetry={() => staged.retry(photo.id)}
                      onRemove={() => staged.remove(photo.id)}
                    />
                  ))}
                </ul>
              ) : null}
              {dictation.supported ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="-mt-2 h-auto self-start px-0 text-vri-copper"
                  onClick={picker.openLibrary}
                  disabled={busy || inspectionId === null}
                  data-testid="capture-upload"
                >
                  <ImagePlus />
                  Add a photo from the device instead
                </Button>
              ) : null}

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>What you see</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Dictate or type the observation…"
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Title</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(event) => {
                          titleTouchedRef.current = true
                          field.onChange(event)
                        }}
                        data-testid="capture-title"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="inspection_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Inspection</FormLabel>
                      <FormControl>
                        <NativeSelect
                          {...field}
                          disabled={inspections.isPending || busy}
                          data-testid="capture-inspection"
                        >
                          {inspections.isPending ? (
                            <option value="">Loading…</option>
                          ) : null}
                          {candidates.map((inspection) => (
                            <option
                              key={inspection.id}
                              value={String(inspection.id)}
                            >
                              {inspection.title}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <FormControl>
                        <NativeSelect {...field} data-testid="capture-priority">
                          {FINDING_PRIORITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="location_ref"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location reference</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="capture-location" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  disabled={busy}
                  data-testid="capture-keep-pin"
                >
                  Keep pin only
                </Button>
                <LoadingButton
                  type="submit"
                  size="lg"
                  className="h-12 text-base"
                  loading={busy}
                  disabled={inspectionId === null}
                  data-testid="capture-save"
                >
                  {busy && staged.uploading
                    ? "Uploading photo…"
                    : "Save finding"}
                </LoadingButton>
              </DialogFooter>
            </form>
          </Form>
        )}
        {picker.inputs}
      </DialogContent>
    </Dialog>
  )
}

const STATUS_TEXT: Record<StagedPhoto["status"], string> = {
  presigning: "Preparing…",
  uploading: "Uploading…",
  ready: "Ready",
  error: "Failed",
}

function StagedTile({
  photo,
  disabled,
  onRetry,
  onRemove,
}: {
  photo: StagedPhoto
  disabled: boolean
  onRetry: () => void
  onRemove: () => void
}) {
  const failed = photo.status === "error"
  const pending = photo.status === "presigning" || photo.status === "uploading"
  return (
    <li
      className="relative list-none overflow-hidden rounded-lg border bg-muted"
      data-testid="capture-photo"
      data-status={photo.status}
    >
      <span className="relative block aspect-square w-full">
        <img
          src={photo.previewUrl}
          alt=""
          className={cn(
            "absolute inset-0 size-full object-cover",
            pending && "opacity-60",
          )}
        />
        {pending ? (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
            <span
              className="block h-full bg-vri-gold transition-[width]"
              style={{ width: `${photo.progress}%` }}
            />
          </span>
        ) : null}
        {pending ? (
          <Loader2
            className="absolute inset-0 m-auto size-5 animate-spin text-white drop-shadow"
            aria-hidden="true"
          />
        ) : null}
        {failed ? (
          <AlertTriangle
            className="absolute inset-0 m-auto size-5 text-destructive drop-shadow"
            aria-hidden="true"
          />
        ) : null}
      </span>
      <span className="sr-only" role="status">
        {STATUS_TEXT[photo.status]}
        {failed && photo.error ? `: ${photo.error}` : ""}
      </span>
      <span className="absolute top-1 right-1 flex gap-1">
        {failed ? (
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="size-7"
            onClick={onRetry}
            disabled={disabled}
            aria-label="Retry upload"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="size-7"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove photo"
          data-testid="capture-photo-remove"
        >
          <X className="size-3.5" />
        </Button>
      </span>
    </li>
  )
}
