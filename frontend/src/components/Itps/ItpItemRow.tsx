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
import { ITEM_RESULTS, itemStatusLabel } from "@/lib/itp"
import { drawingsQuery, itpKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

import { ClassificationBadge } from "./ItpBadges"
import { LineCriteria, LinePhotos, MeasuredValue } from "./ItpLineEvidence"

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
  useEffect(() => setNote(item.notes ?? ""), [item.notes])

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
      refresh()
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const blocked = blockedBy !== undefined
  const signed = item.signatures.length > 0
  const canRecord = editable && who.canWrite && !blocked && !signed
  const isHold = item.classification === "hold"
  const needsPhoto = Boolean(item.photo_required) && !item.photo_count
  const signedRoleIds = new Set(item.signatures.map((s) => s.signoff_role_id))

  return (
    <li
      className={cn(
        "flex flex-col gap-3 px-4 py-4",
        isHold && "border-l-4 border-l-status-critical-fg",
        isHold && item.released && "border-l-status-positive-fg",
      )}
      data-testid="itp-item"
      data-item-id={item.id}
      data-status={item.status}
      data-blocked={blocked ? "true" : "false"}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span className="w-6 pt-0.5 text-sm text-muted-foreground">
          {index + 1}
        </span>
        <p className="min-w-0 flex-1 font-medium">{item.requirement}</p>
        <div className="flex flex-wrap items-center gap-2">
          <ClassificationBadge value={item.classification} />
          <StatusBadge
            value={item.status}
            tone={
              item.status === "pass"
                ? "positive"
                : item.status === "fail"
                  ? "critical"
                  : "neutral"
            }
            label={itemStatusLabel(item.status)}
            data-testid="itp-item-status"
          />
        </div>
      </div>

      <LineCriteria item={item} />

      {blocked ? (
        <p
          className="flex items-center gap-2 rounded-md bg-status-critical-bg px-3 py-2 text-sm text-status-critical-fg"
          data-testid="itp-item-blocked"
        >
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          Waiting for hold point “{blockedBy.requirement}” to be signed off.
        </p>
      ) : null}

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
                result.value === "pass" && !active && needsPhoto
                  ? "Add a photo before this line can pass"
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

      <MeasuredValue item={item} canRecord={canRecord} onSaved={refresh} />

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
                    {sig.gps_lat !== null && sig.gps_lng !== null
                      ? ` · ${sig.gps_lat.toFixed(4)}, ${sig.gps_lng.toFixed(4)}`
                      : ""}
                  </span>
                </li>
              )
            }
            const mine = canSignAs(role, who)
            const ready =
              itp.status !== "voided" &&
              !blocked &&
              (item.status === "na" || (item.status === "pass" && !needsPhoto))
            return (
              <li key={role.id} className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">
                  {isHold ? "Waiting for" : "To sign:"}{" "}
                  <strong className="text-foreground">{role.role_name}</strong>
                  {role.signer_email ? ` (${role.signer_email})` : ""}
                </span>
                {mine ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!ready || signedRoleIds.has(role.id)}
                    title={
                      ready
                        ? undefined
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

      <div className="flex flex-wrap items-center gap-2 text-sm">
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
        {editable && who.canWrite ? (
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

      {item.notes && !noteOpen ? (
        <p className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm">
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
            placeholder="What was checked, measured or seen…"
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
