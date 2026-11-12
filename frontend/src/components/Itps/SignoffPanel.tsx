import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Bell,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Mail,
  MailPlus,
  Megaphone,
  Undo2,
} from "lucide-react"
import { useState } from "react"

import {
  type SignLinkBatch,
  type SignLinkPublic,
  SignoffService,
  type SignPackPublic,
  type WitnessNoticeResult,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { formatDate, formatDateTime } from "@/lib/format"
import {
  type SignoffKind,
  signLinksQuery,
  signoffKeys,
  signoffRolesQuery,
  signPacksQuery,
} from "@/lib/queries"
import {
  batchSummary,
  EMAIL_STATUS,
  fileSize,
  LINK_STATUS,
  linkActions,
} from "@/lib/signoff"
import { extractErrorMessage } from "@/utils"

/*
 * Increment 14 (PRD v2.63 §5): the sign-off pack and the no-account signing
 * links of one ITP, or of one area (one combined pack, one email per signer,
 * one visit). Everyone on the project sees the pack and the links; owners
 * and inspectors send, remind and withdraw.
 */
export function SignoffPanel({
  kind,
  id,
  projectId,
  canWrite,
  disabled,
}: {
  kind: SignoffKind
  id: number
  projectId: number
  canWrite: boolean
  /** Why links cannot be sent right now (voided ITP, empty area). */
  disabled?: string
}) {
  return (
    <section
      aria-labelledby={`signoff-${kind}-${id}`}
      className="flex flex-col gap-3"
      data-testid="signoff-panel"
    >
      <h2 id={`signoff-${kind}-${id}`} className="text-lg font-semibold">
        Sign-off
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <PackCard kind={kind} id={id} />
        <LinksCard
          kind={kind}
          id={id}
          projectId={projectId}
          canWrite={canWrite}
          disabled={disabled}
        />
      </div>
    </section>
  )
}

function PackCard({ kind, id }: { kind: SignoffKind; id: number }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const packs = useQuery(signPacksQuery(kind, id))
  const current = useMutation({
    mutationFn: async () =>
      (kind === "itp"
        ? (await SignoffService.currentItpPack({ path: { itp_id: id } })).data
        : (await SignoffService.currentAreaPack({ path: { area_id: id } }))
            .data) as SignPackPublic,
    onSuccess: (pack) => {
      queryClient.invalidateQueries({ queryKey: signoffKeys.packs(kind, id) })
      showSuccessToast(
        pack.regenerated
          ? `Pack version ${pack.version} is ready`
          : `Version ${pack.version} is still current — nothing has changed`,
      )
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })
  const list = packs.data ?? []
  const latest = current.data ?? list[0]

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      data-testid="pack-card"
    >
      <div className="flex items-start gap-2">
        <FileText
          className="mt-0.5 size-5 shrink-0 text-vri-copper"
          aria-hidden
        />
        <div>
          <h3 className="font-semibold">
            {kind === "area" ? "Area sign-off pack" : "Sign-off pack"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {kind === "area"
              ? "One PDF of every ITP in this area — lines, results, photos and signatures — so a signer can review the whole area at once."
              : "One PDF of every line, result, photo and signature."}{" "}
            A new version is made whenever something on it changes; earlier
            versions are kept.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LoadingButton
          onClick={() => current.mutate()}
          loading={current.isPending}
          variant="outline"
          data-testid="pack-current"
        >
          <FileText />
          {list.length ? "Get the current pack" : "Make the pack"}
        </LoadingButton>
        {latest ? (
          <Button asChild data-testid="pack-download">
            <a href={latest.download_url} target="_blank" rel="noreferrer">
              <Download />
              Download v{latest.version}
            </a>
          </Button>
        ) : null}
      </div>
      {list.length ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid="pack-versions">
          {list.slice(0, 5).map((pack) => (
            <li key={pack.id} className="flex flex-wrap items-center gap-x-2">
              <a
                href={pack.download_url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-vri-copper underline-offset-2 hover:underline"
              >
                Version {pack.version}
              </a>
              <span className="text-muted-foreground">
                {formatDateTime(pack.created_at)} · {fileSize(pack.file_size)} ·{" "}
                {pack.signature_count} signature
                {pack.signature_count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
          {list.length > 5 ? (
            <li className="text-muted-foreground">
              and {list.length - 5} earlier version
              {list.length - 5 === 1 ? "" : "s"}
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No pack made yet.</p>
      )}
    </div>
  )
}

function LinksCard({
  kind,
  id,
  projectId,
  canWrite,
  disabled,
}: {
  kind: SignoffKind
  id: number
  projectId: number
  canWrite: boolean
  disabled?: string
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const links = useQuery({
    ...signLinksQuery(kind, id),
    // Re-read while an email is still on its way.
    refetchInterval: (q) =>
      q.state.data?.some((l) => l.email_status === "queued") ? 2000 : false,
  })
  // Links exist only in the response that created them; keep them for "Copy".
  const [fresh, setFresh] = useState<Record<number, string>>({})
  const [skipped, setSkipped] = useState<string[]>([])
  const [choosing, setChoosing] = useState(false)

  const remember = (created: SignLinkPublic[]) => {
    setFresh((prev) => ({
      ...prev,
      ...Object.fromEntries(
        created.filter((l) => l.link).map((l) => [l.id, l.link as string]),
      ),
    }))
  }
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: signoffKeys.links(kind, id) })
  }

  const request = useMutation({
    mutationFn: async (body: {
      signoff_role_id?: number
      signer_email?: string
    }) =>
      (kind === "itp"
        ? (
            await SignoffService.createItpSignLinks({
              path: { itp_id: id },
              body,
            })
          ).data
        : (
            await SignoffService.createAreaSignLinks({
              path: { area_id: id },
              body,
            })
          ).data) as SignLinkBatch,
    onSuccess: (batch) => {
      remember(batch.links)
      setSkipped(batch.skipped)
      setChoosing(false)
      refresh()
      if (batch.links.length) showSuccessToast(batchSummary(batch))
      else showErrorToast(batch.skipped.join("; ") || "No signing links sent")
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })
  const remind = useMutation({
    mutationFn: async (link: SignLinkPublic) =>
      (await SignoffService.remindSignLink({ path: { link_id: link.id } }))
        .data as SignLinkPublic,
    onSuccess: (link) => {
      remember([link])
      refresh()
      showSuccessToast(`Reminder sent to ${link.signer_email} with a new link`)
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })
  const withdraw = useMutation({
    mutationFn: async (link: SignLinkPublic) =>
      (await SignoffService.revokeSignLink({ path: { link_id: link.id } }))
        .data as SignLinkPublic,
    onSuccess: () => {
      refresh()
      showSuccessToast("Link withdrawn — it no longer works")
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      showSuccessToast("Link copied")
    } catch {
      showErrorToast("Couldn't copy — select the link and copy it instead")
    }
  }

  const list = links.data ?? []

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      data-testid="links-card"
    >
      <div className="flex items-start gap-2">
        <Mail className="mt-0.5 size-5 shrink-0 text-vri-copper" aria-hidden />
        <div>
          <h3 className="font-semibold">Signatures by email</h3>
          <p className="text-sm text-muted-foreground">
            Each signer gets a link that works once, for 14 days, with no
            account. They review the lines that are ready, draw their signature
            and sign — stamped with the time, the weather and, if they allow it,
            their location.
          </p>
        </div>
      </div>
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <LoadingButton
            onClick={() => request.mutate({})}
            loading={request.isPending && !choosing}
            disabled={Boolean(disabled)}
            title={disabled}
            data-testid="links-send-all"
          >
            <MailPlus />
            Email signing links
          </LoadingButton>
          <Button
            variant="outline"
            onClick={() => setChoosing(true)}
            disabled={Boolean(disabled)}
            data-testid="links-send-one"
          >
            Send to one person…
          </Button>
        </div>
      ) : null}
      {disabled && canWrite ? (
        <p className="text-sm text-muted-foreground">{disabled}</p>
      ) : null}
      {skipped.length ? (
        <ul
          className="rounded-md bg-muted p-2 text-sm"
          data-testid="links-skipped"
        >
          {skipped.map((s) => (
            <li key={s}>Not sent — {s}</li>
          ))}
        </ul>
      ) : null}
      {list.length ? (
        <ul className="flex flex-col divide-y" data-testid="links-list">
          {list.map((link) => {
            const status = LINK_STATUS[link.status] ?? {
              label: link.status,
              tone: "neutral" as const,
            }
            const actions = linkActions(link)
            // Fresh links (and every link in the demo build) can be copied or
            // opened here; the API never lists a link again after creating it.
            const raw = fresh[link.id] ?? link.link ?? undefined
            const token = raw?.split("/sign/")[1]
            return (
              <li
                key={link.id}
                className="flex flex-col gap-1.5 py-2"
                data-testid="sign-link"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{link.role_name}</strong>
                  <span className="text-sm text-muted-foreground">
                    {link.signer_email}
                  </span>
                  <StatusBadge
                    value={link.status}
                    tone={status.tone}
                    label={status.label}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {link.reminder_count ? "Reminder sent" : "Sent"}{" "}
                  {formatDateTime(link.created_at)}
                  {link.email_status
                    ? ` · ${EMAIL_STATUS[link.email_status] ?? link.email_status}`
                    : ""}
                  {link.status === "used" && link.used_at
                    ? ` · signed ${formatDateTime(link.used_at)}`
                    : link.status === "active"
                      ? ` · works until ${formatDate(link.expires_at)}`
                      : ""}
                </p>
                {canWrite && (raw || actions.remind || actions.withdraw) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {raw && link.status === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copy(raw)}
                        data-testid="link-copy"
                      >
                        <Copy />
                        Copy link
                      </Button>
                    ) : null}
                    {token && link.status === "active" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          navigate({ to: "/sign/$token", params: { token } })
                        }
                        data-testid="link-open"
                      >
                        <ExternalLink />
                        Open signing page
                      </Button>
                    ) : null}
                    {actions.remind ? (
                      <LoadingButton
                        size="sm"
                        variant="outline"
                        loading={
                          remind.isPending && remind.variables?.id === link.id
                        }
                        onClick={() => remind.mutate(link)}
                        data-testid="link-remind"
                      >
                        <Bell />
                        Remind
                      </LoadingButton>
                    ) : null}
                    {actions.withdraw ? (
                      <LoadingButton
                        size="sm"
                        variant="ghost"
                        loading={
                          withdraw.isPending &&
                          withdraw.variables?.id === link.id
                        }
                        onClick={() => withdraw.mutate(link)}
                        data-testid="link-withdraw"
                      >
                        <Undo2 />
                        Withdraw
                      </LoadingButton>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No signing links sent yet.
        </p>
      )}
      <SendOneDialog
        open={choosing}
        onOpenChange={setChoosing}
        projectId={projectId}
        sending={request.isPending}
        onSend={(body) => request.mutate(body)}
      />
    </div>
  )
}

function SendOneDialog({
  open,
  onOpenChange,
  projectId,
  sending,
  onSend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  sending: boolean
  onSend: (body: { signoff_role_id: number; signer_email?: string }) => void
}) {
  const roles = useQuery({ ...signoffRolesQuery(projectId), enabled: open })
  const [roleId, setRoleId] = useState("")
  const [email, setEmail] = useState("")
  const role = roles.data?.find((r) => String(r.id) === roleId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!role) return
            onSend({
              signoff_role_id: role.id,
              signer_email: email.trim() || undefined,
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>Send a signing link</DialogTitle>
            <DialogDescription>
              Choose who signs. The email goes to the role's signer unless you
              enter a different address (a deputy, say).
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="send-one-role">Signs as</Label>
              <NativeSelect
                id="send-one-role"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                required
                data-testid="send-one-role"
              >
                <option value="">Choose a role…</option>
                {(roles.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.role_name}
                    {r.signer_email ? ` — ${r.signer_email}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="send-one-email">
                Email{" "}
                <span className="font-normal text-muted-foreground">
                  (optional if the role has one)
                </span>
              </Label>
              <Input
                id="send-one-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={role?.signer_email ?? "name@company.com"}
                data-testid="send-one-email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <LoadingButton
              type="submit"
              loading={sending}
              disabled={!role || (!role.signer_email && !email.trim())}
              data-testid="send-one-submit"
            >
              <MailPlus />
              Send link
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Send notice" on a witness or hold point line: tells the line's signers
 * the work is coming up so they can attend (the "notified party").
 */
export function WitnessNoticeButton({
  itemId,
  isHold,
  requirement,
}: {
  itemId: number
  isHold: boolean
  requirement: string
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [plannedFor, setPlannedFor] = useState("")
  const [message, setMessage] = useState("")
  const send = useMutation({
    mutationFn: async () =>
      (
        await SignoffService.sendWitnessNotice({
          path: { item_id: itemId },
          body: {
            planned_for: plannedFor.trim() || null,
            message: message.trim() || null,
          },
        })
      ).data as WitnessNoticeResult,
    onSuccess: (result) => {
      setOpen(false)
      setPlannedFor("")
      setMessage("")
      showSuccessToast(
        `Notice sent to ${result.sent_to.join(", ")}${
          result.skipped.length
            ? ` (not sent: ${result.skipped.join("; ")})`
            : ""
        }`,
      )
    },
    onError: (error: Error) => showErrorToast(extractErrorMessage(error)),
  })
  const kind = isHold ? "hold point" : "witness point"

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 rounded-full px-2.5 text-xs"
        onClick={() => setOpen(true)}
        data-testid="witness-notice"
      >
        <Megaphone />
        Send notice
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              send.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>Give notice of this {kind}</DialogTitle>
              <DialogDescription>
                “{requirement}” — everyone who signs this line gets an email so
                they can attend.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`notice-when-${itemId}`}>Expected</Label>
                <Input
                  id={`notice-when-${itemId}`}
                  value={plannedFor}
                  onChange={(e) => setPlannedFor(e.target.value)}
                  placeholder="Thu 14 Nov, 7:30 am"
                  maxLength={120}
                  data-testid="notice-when"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`notice-message-${itemId}`}>Message</Label>
                <Textarea
                  id={`notice-message-${itemId}`}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Pump truck booked; meet at the east gate."
                  maxLength={2000}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <LoadingButton
                type="submit"
                loading={send.isPending}
                data-testid="notice-send"
              >
                <Megaphone />
                Send notice
              </LoadingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
