import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import {
  Check,
  FileText,
  Lock,
  MapPin,
  MessageSquare,
  PenLine,
} from "lucide-react"
import { useEffect, useState } from "react"

import {
  type ItpItemPublic,
  type ItpRoleRef,
  ItpsService,
  type ProjectItpPublic,
} from "@/client"
import { StatusBadge } from "@/components/Common/StatusBadge"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { formatDateTime } from "@/lib/format"
import {
  evidenceGap,
  ITEM_RESULTS,
  itemStatusLabel,
  type ReleaseChoice,
  releaseChoice,
  releaseResults,
} from "@/lib/itp"
import { drawingsQuery, itpKeys } from "@/lib/queries"
import { weatherText } from "@/lib/signoff"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

import { ClassificationChip } from "./ItpBadges"
import { LineCriteria, LinePhotos, MeasuredValue } from "./ItpLineEvidence"
import { WitnessNoticeButton } from "./SignoffPanel"

/*
 * One ITP line, built for the field: three large Pass / Fail / N/A buttons,
 * the line's classification, a note, who has to sign it and who has, and the
 * pins that mark it on the drawings.
 *
 * Hold points (PRD v2.63 §5): a line after an unreleased hold point shows a
 * lock and cannot be recorded; the hold line is released when every
 * required role has signed it. The API enforces all of this — the buttons
 * are disabled only so nobody taps into a refusal.
 *
 * Increment 13.6: the line's acceptance criteria / reference / record
 * required under the title, a measured value next to the result for number
 * and text lines, and evidence photos (a `photoRequired` line cannot pass
 * until one is on file).
 *
 * Increment 13.8 (look and feel): line number and H / W / R / I chip sit in
 * a fixed left gutter; a locked line shows no result buttons (the section
 * shows one lock notice instead of a banner per line); a failed line is
 * tinted brick with its note directly beneath, and tapping Fail opens the
 * note at once; a three-shot line asks for Context / Intermediate /
 * Close-up with scale.
 *
 * Increment 13.9: a release line (template `resultScale: "release"`, the
 * field guide's written pre-pour release) shows Approved (in the line's own
 * words, e.g. "Approved to pour") / Approved with conditions / Rejected
 * instead of Pass / Fail / N/A. Approved with conditions asks for the
 * conditions in writing; they print under the line.
 */

export interface SignerContext {
  email: string | null | undefined
  isOwner: boolean
  canWrite: boolean
}

export function canSignAs(role: ItpRoleRef, who: SignerContext): boolean {
  if (role.signer_email) {
    return (who.email ?? "").toLowerCase() === role.signer_email.toLowerCase()
  }
  return who.isOwner
}

interface ItpItemRowProps {
  projectId: number
  itp: ProjectItpPublic
  item: ItpItemPublic
  index: number
  who: SignerContext
  editable: boolean
  blockedBy?: ItpItemPublic
}

export function ItpItemRow({
  projectId,
  itp,
  item,
  index,
  who,
  editable,
  blockedBy,
}: ItpItemRowProps) {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState(item.notes ?? "")
  const [signing, setSigning] = useState<ItpRoleRef | null>(null)
  const [conditionsOpen, setConditionsOpen] = useState(false)
  const [conditions, setConditions] = useState(item.conditions ?? "")
  useEffect(() => setNote(item.notes ?? ""), [item.notes])
  useEffect(() => setConditions(item.conditions ?? ""), [item.conditions])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: itpKeys.detail(itp.id) })
    queryClient.invalidateQueries({ queryKey: ["projects", projectId] })
    if (itp.area_id) {
      queryClient.invalidateQueries({ queryKey: itpKeys.area(itp.area_id) })
    }
  }

  const update = useMutation({
    mutationFn: (body: {
      status?: ItpItemPublic["status"]
      notes?: string | null
      conditions?: string | null
    }) =>
      ItpsService.updateItpItem({
        path: { item_id: item.id },
        body: body as never,
      }),
    onSuccess: (_, body) => {
      if (body.notes !== undefined) {
        showSuccessToast("Note saved")
        setNoteOpen(false)
      }
      if (body.conditions) {
        showSuccessToast("Approved with conditions")
        setConditionsOpen(false)
      }
      // A failed line asks at once for what was wrong (13.8).
      if (body.status === "fail" && !item.notes) setNoteOpen(true)
      refresh()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const blocked = blockedBy !== undefined
  const signed = item.signatures.length > 0
  const canRecord = editable && who.canWrite && !blocked && !signed
  const isHold = item.classification === "hold"
  const failed = item.status === "fail"
  const gap = evidenceGap(item)
  const needsPhoto = gap !== null
  const signedRoleIds = new Set(item.signatures.map((s) => s.signoff_role_id))
  const isRelease = item.result_scale === "release"
  const release = isRelease ? releaseChoice(item) : null

  const chooseRelease = (choice: ReleaseChoice) => {
    const active = release === choice
    if (choice === "conditional") {
      setConditions(item.conditions ?? "")
      setConditionsOpen(true)
      return
    }
    setConditionsOpen(false)
    if (active) update.mutate({ status: "pending" })
    else if (choice === "approved")
      update.mutate({ status: "pass", conditions: null })
    else update.mutate({ status: "fail" })
  }

  return (
    <li
      className={cn(
        "grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 py-3 pr-3 pl-2 sm:pr-4 sm:pl-3",
        isHold && "border-l-4 border-l-status-critical-fg",
        isHold && item.released && "border-l-status-positive-fg",
        failed && "bg-status-critical-bg/70",
        blocked && "bg-muted/40",
      )}
      data-testid="itp-item"
      data-item-id={item.id}
      data-status={item.status}
      data-blocked={blocked ? "true" : "false"}
    >
      <div
        className="flex flex-col items-center gap-1.5"
        data-testid="itp-item-gutter"
      >
        <span
          className="text-sm font-semibold tabular-nums text-muted-foreground"
          data-testid="itp-line-number"
        >
          {index + 1}
        </span>
        <ClassificationChip
          value={item.classification}
          released={item.released}
        />
        {blocked ? (
          <Lock
            className="size-4 text-muted-foreground"
            aria-label="Locked until the hold point above is signed"
            data-testid="itp-item-lock"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <p
            className={cn(
              "min-w-0 flex-1 font-medium leading-snug",
              blocked && "text-muted-foreground",
            )}
          >
            {item.requirement}
          </p>
          <StatusBadge
            value={item.status}
            tone={
              release === "conditional"
                ? "attention"
                : item.status === "pass"
                  ? "positive"
                  : failed
                    ? "critical"
                    : "neutral"
            }
            label={item.result_label ?? itemStatusLabel(item.status)}
            data-testid="itp-item-status"
          />
        </div>

        <LineCriteria item={item} />

        {/* Locked lines show no result buttons (13.8); the section says why. */}
        {blocked ? null : isRelease ? (
          <fieldset
            className="grid grid-cols-1 gap-2 sm:max-w-2xl sm:grid-cols-3"
            aria-label={`Release result for line ${index + 1}`}
            data-testid="itp-release"
          >
            {releaseResults(item.approved_label).map((result) => {
              const active = release === result.value
              const approval = result.value !== "rejected"
              return (
                <Button
                  key={result.value}
                  type="button"
                  variant={active ? "default" : "outline"}
                  className={cn(
                    "h-11 text-base",
                    active &&
                      result.value === "approved" &&
                      "bg-vri-green text-vri-offwhite hover:bg-vri-green/90",
                    active &&
                      result.value === "conditional" &&
                      "bg-vri-copper text-vri-offwhite hover:bg-vri-copper/90",
                    active &&
                      result.value === "rejected" &&
                      "bg-destructive text-white hover:bg-destructive/90",
                  )}
                  aria-pressed={active}
                  disabled={
                    !canRecord ||
                    update.isPending ||
                    (approval && !active && needsPhoto)
                  }
                  title={
                    approval && !active && gap
                      ? `${gap} before this line can be approved`
                      : undefined
                  }
                  onClick={() => chooseRelease(result.value)}
                  data-testid={`itp-release-${result.value}`}
                >
                  {active ? <Check /> : null}
                  {result.label}
                </Button>
              )
            })}
          </fieldset>
        ) : (
          <fieldset
            className="grid grid-cols-3 gap-2 sm:max-w-md"
            aria-label={`Result for line ${index + 1}`}
          >
            {ITEM_RESULTS.map((result) => {
              const active = item.status === result.value
              return (
                <Button
                  key={result.value}
                  type="button"
                  variant={active ? "default" : "outline"}
                  className={cn(
                    "h-11 text-base",
                    active &&
                      result.value === "pass" &&
                      "bg-vri-green text-vri-offwhite hover:bg-vri-green/90",
                    active &&
                      result.value === "fail" &&
                      "bg-destructive text-white hover:bg-destructive/90",
                  )}
                  aria-pressed={active}
                  disabled={
                    !canRecord ||
                    update.isPending ||
                    (result.value === "pass" && !active && needsPhoto)
                  }
                  title={
                    result.value === "pass" && !active && gap
                      ? `${gap} before this line can pass`
                      : undefined
                  }
                  onClick={() =>
                    update.mutate({ status: active ? "pending" : result.value })
                  }
                  data-testid={`itp-result-${result.value}`}
                >
                  {active ? <Check /> : null}
                  {result.label}
                </Button>
              )
            })}
          </fieldset>
        )}

        {item.conditions && !conditionsOpen ? (
          <div
            className="rounded-md border border-vri-copper/50 bg-card px-3 py-2 text-sm"
            data-testid="itp-item-conditions"
          >
            <p className="font-semibold text-vri-copper">Conditions</p>
            <p className="whitespace-pre-wrap">{item.conditions}</p>
            {canRecord ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1 -ml-2"
                onClick={() => setConditionsOpen(true)}
              >
                <PenLine />
                Edit conditions
              </Button>
            ) : null}
          </div>
        ) : null}
        {conditionsOpen ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const text = conditions.trim()
              if (text) update.mutate({ status: "pass", conditions: text })
            }}
          >
            <Label htmlFor={`conditions-${item.id}`}>
              Conditions of the approval — list each one
            </Label>
            <Textarea
              id={`conditions-${item.id}`}
              rows={3}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder={
                "1. Re-tie loose bars at grid C7\n2. Clean the joint at the north wall"
              }
              data-testid="itp-conditions"
            />
            <div className="flex gap-2">
              <LoadingButton
                size="sm"
                type="submit"
                loading={update.isPending}
                disabled={!conditions.trim()}
                data-testid="itp-conditions-save"
              >
                Approve with these conditions
              </LoadingButton>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setConditionsOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {item.notes && !noteOpen ? (
          <p
            className={cn(
              "whitespace-pre-wrap rounded-md px-3 py-2 text-sm",
              failed
                ? "border border-status-critical-fg/40 bg-card text-status-critical-fg"
                : "bg-muted",
            )}
            data-testid="itp-item-note"
          >
            {failed ? <strong className="mr-1">Failed:</strong> : null}
            {item.notes}
          </p>
        ) : null}
        {noteOpen ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              update.mutate({ notes: note.trim() || null })
            }}
          >
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                failed
                  ? "What failed, where, and what has to be fixed…"
                  : "What was checked, measured or seen…"
              }
              aria-label="Note"
              data-testid="itp-note"
            />
            <div className="flex gap-2">
              <LoadingButton size="sm" type="submit" loading={update.isPending}>
                Save note
              </LoadingButton>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setNoteOpen(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {blocked && !item.measured_value ? null : (
          <MeasuredValue item={item} canRecord={canRecord} onSaved={refresh} />
        )}

        <LinePhotos item={item} canAdd={canRecord} onChanged={refresh} />

        {item.required_roles.length ? (
          <ul
            className="flex flex-col gap-1.5 text-sm"
            data-testid="itp-item-roles"
          >
            {item.required_roles.map((role) => {
              const sig = item.signatures.find(
                (s) => s.signoff_role_id === role.id,
              )
              if (sig) {
                return (
                  <li
                    key={role.id}
                    className="flex items-start gap-2 text-status-positive-fg"
                    data-testid="itp-signature"
                  >
                    <Check
                      className="mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{role.role_name}</strong> signed by{" "}
                      {sig.signer_name || sig.signer_email},{" "}
                      {formatDateTime(sig.signed_at)}
                      {sig.method === "external_link" ? " · by email link" : ""}
                      {sig.gps_lat !== null && sig.gps_lng !== null
                        ? ` · ${sig.gps_lat.toFixed(4)}, ${sig.gps_lng.toFixed(4)}`
                        : ""}
                      {weatherText(sig.weather) ? (
                        <span className="text-muted-foreground">
                          {` · ${weatherText(sig.weather)}`}
                        </span>
                      ) : null}
                      {sig.signature_url ? (
                        <img
                          src={sig.signature_url}
                          alt={`Signature of ${sig.signer_name || sig.signer_email}`}
                          className="mt-1 block h-10 max-w-48 rounded border bg-white object-contain"
                          data-testid="itp-signature-image"
                        />
                      ) : null}
                    </span>
                  </li>
                )
              }
              const mine = canSignAs(role, who)
              const ready =
                itp.status !== "voided" &&
                !blocked &&
                (item.status === "na" ||
                  (item.status === "pass" && !needsPhoto))
              return (
                <li key={role.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">
                    {isHold ? "Waiting for" : "To sign:"}{" "}
                    <strong className="text-foreground">
                      {role.role_name}
                    </strong>
                    {role.signer_email ? ` (${role.signer_email})` : ""}
                  </span>
                  {mine && !blocked ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!ready || signedRoleIds.has(role.id)}
                      title={
                        ready
                          ? undefined
                          : isRelease
                            ? "Record the release first"
                            : "Record this line as Pass or N/A first"
                      }
                      onClick={() => setSigning(role)}
                      data-testid="itp-sign"
                    >
                      <PenLine />
                      Sign as {role.role_name}
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}

        {item.pins.length ||
        (who.canWrite && itp.status !== "voided") ||
        (editable && who.canWrite) ? (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {item.pins.map((pin) => (
              <Link
                key={pin.id}
                to="/projects/$projectId/drawings/$drawingId"
                params={{
                  projectId: String(projectId),
                  drawingId: String(pin.drawing_id),
                }}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs hover:border-vri-gold"
                data-testid="itp-item-pin"
              >
                <MapPin className="size-3 text-vri-copper" aria-hidden="true" />
                {pin.label || `Pin #${pin.tag_number || pin.id}`} ·{" "}
                {pin.drawing_title ?? "Drawing"}
                {pin.page_number > 1 ? ` p.${pin.page_number}` : ""}
              </Link>
            ))}
            {who.canWrite && itp.status !== "voided" ? (
              <MarkOnDrawingMenu projectId={projectId} itemId={item.id} />
            ) : null}
            {editable &&
            who.canWrite &&
            (isHold || item.classification === "witness") &&
            item.required_roles.length &&
            item.signatures.length < item.required_roles.length ? (
              <WitnessNoticeButton
                itemId={item.id}
                isHold={isHold}
                requirement={item.requirement}
              />
            ) : null}
            {editable && who.canWrite && !blocked ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setNoteOpen((v) => !v)}
                data-testid="itp-note-toggle"
              >
                <MessageSquare />
                {item.notes ? "Edit note" : "Add note"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <SignDialog
        item={item}
        role={signing}
        onClose={() => setSigning(null)}
        onSigned={() => {
          setSigning(null)
          refresh()
        }}
      />
    </li>
  )
}

/** Pick a drawing; the viewer opens ready to place a pin for this line. */
function MarkOnDrawingMenu({
  projectId,
  itemId,
}: {
  projectId: number
  itemId: number
}) {
  const navigate = useNavigate()
  const drawings = useQuery(drawingsQuery(projectId))
  if (!drawings.data?.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-testid="itp-mark-on-drawing">
          <MapPin />
          Mark on drawing
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        <DropdownMenuLabel>Open a drawing to place the pin</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {drawings.data.map((drawing) => (
          <DropdownMenuItem
            key={drawing.id}
            onSelect={() =>
              navigate({
                to: "/projects/$projectId/drawings/$drawingId",
                params: {
                  projectId: String(projectId),
                  drawingId: String(drawing.id),
                },
                search: { itpItem: itemId },
              })
            }
          >
            <FileText />
            <span className="truncate">
              {drawing.title || drawing.filename}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** In-app sign-off of one line for one role, with the device's GPS if allowed. */
function SignDialog({
  item,
  role,
  onClose,
  onSigned,
}: {
  item: ItpItemPublic
  role: ItpRoleRef | null
  onClose: () => void
  onSigned: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [name, setName] = useState("")
  useEffect(() => {
    if (role) setName("")
  }, [role])

  const sign = useMutation({
    mutationFn: async () => {
      if (!role) throw new Error("No role selected.")
      const position = await currentPosition()
      return ItpsService.signItpItem({
        path: { item_id: item.id },
        body: {
          signoff_role_id: role.id,
          signer_name: name.trim() || null,
          gps_lat: position?.lat ?? null,
          gps_lng: position?.lng ?? null,
        },
      })
    },
    onSuccess: () => {
      showSuccessToast(`Signed as ${role?.role_name}`)
      onSigned()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  return (
    <Dialog
      open={role !== null}
      onOpenChange={(open) => !open && !sign.isPending && onClose()}
    >
      <DialogContent data-testid="itp-sign-dialog">
        <DialogHeader>
          <DialogTitle>Sign as {role?.role_name}</DialogTitle>
          <DialogDescription>
            “{item.requirement}” — your signature is recorded with the time and,
            if this device allows it, its location.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            sign.mutate()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="signer-name">Your name as it should appear</Label>
            <Input
              id="signer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to your account name"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={sign.isPending}
            >
              Cancel
            </Button>
            <LoadingButton
              type="submit"
              loading={sign.isPending}
              data-testid="itp-sign-confirm"
            >
              <PenLine />
              Sign
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The device position within five seconds, or null (denied, unavailable). */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 5000)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer)
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    )
  })
}
