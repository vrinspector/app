import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { AxiosError } from "axios"
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileDown,
  LinkIcon,
  Lock,
  MapPin,
  PenLine,
} from "lucide-react"
import { useState } from "react"

import {
  type SignDocument,
  type SignLine,
  SignoffService,
  type SignResult,
  type SignSessionPublic,
} from "@/client"
import { Logo } from "@/components/Common/Logo"
import { ClassificationChip } from "@/components/Itps/ItpBadges"
import { SignaturePad } from "@/components/Signing/SignaturePad"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { formatDate, formatDateTime } from "@/lib/format"
import { signSessionQuery } from "@/lib/queries"
import { goneTitle, weatherText } from "@/lib/signoff"
import { cn } from "@/lib/utils"
import { extractErrorMessage } from "@/utils"

/*
 * Increment 14 — the no-account signing page (PRD v2.63 §5). Reached from
 * the link in a signing email: /sign/<token>. Outside the signed-in shell;
 * the link itself is the credential, so nothing here needs an account.
 */
export const Route = createFileRoute("/sign/$token")({
  component: SignPage,
  head: () => ({ meta: [{ title: "Sign - VR Inspector" }] }),
})

const RESULT_TEXT: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
  pending: "Not recorded",
}

function SignPage() {
  const { token } = Route.useParams()
  // Someone on the project who opened the link from the sign-off panel gets
  // a way back; an external signer (not signed in) does not need one.
  const { auth } = Route.useRouteContext()
  const router = useRouter()
  const session = useQuery(signSessionQuery(token))
  const [done, setDone] = useState<SignResult | null>(null)

  return (
    <div className="min-h-svh bg-vri-offwhite text-vri-charcoal">
      <header className="border-b-4 border-vri-gold bg-vri-green px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Logo variant="full" className="text-lg" asLink={false} />
          {auth.isAuthenticated ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-vri-offwhite hover:bg-white/10 hover:text-vri-offwhite"
              onClick={() => router.history.back()}
              data-testid="sign-back"
            >
              <ArrowLeft />
              Back to the app
            </Button>
          ) : (
            <span className="text-xs uppercase tracking-widest text-vri-gold">
              Sign-off request
            </span>
          )}
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {done ? (
          <Signed result={done} />
        ) : session.isPending ? (
          <p className="py-16 text-center text-muted-foreground">
            Opening your signing link…
          </p>
        ) : session.isError ? (
          <Gone error={session.error} />
        ) : (
          <SignBody token={token} session={session.data} onSigned={setDone} />
        )}
      </main>
    </div>
  )
}

function Gone({ error }: { error: Error }) {
  const status =
    error instanceof AxiosError ? error.response?.status : undefined
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center"
      data-testid="sign-gone"
    >
      <LinkIcon className="size-10 text-vri-copper" aria-hidden />
      <h1 className="font-heading text-2xl text-vri-green">
        {goneTitle(status)}
      </h1>
      <p className="text-muted-foreground">{extractErrorMessage(error)}</p>
    </div>
  )
}

function Signed({ result }: { result: SignResult }) {
  const weather = weatherText(result.weather)
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-3 py-12 text-center"
      data-testid="sign-done"
    >
      <CheckCircle2 className="size-12 text-status-positive-fg" aria-hidden />
      <h1 className="font-heading text-2xl text-vri-green">
        Thank you — signed
      </h1>
      <p>
        You signed {result.signed_lines} line
        {result.signed_lines === 1 ? "" : "s"}
        {result.documents > 1 ? ` across ${result.documents} ITPs` : ""} at{" "}
        {formatDateTime(result.signed_at)}
        {weather ? ` (${weather})` : ""}.
      </p>
      {result.still_waiting ? (
        <p className="text-sm text-muted-foreground">
          {result.still_waiting} more line
          {result.still_waiting === 1 ? " needs" : "s need"} your signature once
          the work is ready. The project team will send you a new link.
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        This link has now been used and no longer works. You can close this
        page.
      </p>
    </div>
  )
}

function SignBody({
  token,
  session,
  onSigned,
}: {
  token: string
  session: SignSessionPublic
  onSigned: (result: SignResult) => void
}) {
  const [name, setName] = useState("")
  const [signature, setSignature] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [shareLocation, setShareLocation] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const sign = useMutation({
    mutationFn: async () => {
      const position = shareLocation ? await currentPosition() : null
      return (
        await SignoffService.submitSignature({
          path: { token },
          body: {
            signer_name: name.trim(),
            signature_png: signature ?? "",
            confirm: confirmed,
            gps_lat: position?.lat ?? null,
            gps_lng: position?.lng ?? null,
          },
        })
      ).data as SignResult
    },
    onSuccess: onSigned,
    onError: (e: Error) => setError(extractErrorMessage(e)),
  })

  const ready = session.ready_count
  const canSubmit = ready > 0 && name.trim() && signature && confirmed

  return (
    <>
      <section className="flex flex-col gap-1" data-testid="sign-summary">
        <p className="text-xs font-semibold uppercase tracking-widest text-vri-copper">
          {session.project_name}
          {session.project_client ? ` · ${session.project_client}` : ""}
        </p>
        <h1 className="font-heading text-2xl text-vri-green">
          {session.kind === "area"
            ? `${session.area_name} — ${session.documents.length} ITP${
                session.documents.length === 1 ? "" : "s"
              }`
            : session.documents[0]?.title}
        </h1>
        <p>
          You are signing as <strong>{session.role_name}</strong> (
          {session.signer_email}).
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="size-4" aria-hidden />
            Link works until {formatDate(session.expires_at)}
          </span>
          <span>
            {ready} ready · {session.waiting_count} waiting ·{" "}
            {session.signed_count} already signed
          </span>
        </p>
        {session.pack_url ? (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="mt-1 self-start"
          >
            <a href={session.pack_url} target="_blank" rel="noreferrer">
              <FileDown />
              Download the full pack (PDF)
            </a>
          </Button>
        ) : null}
      </section>

      {session.documents.map((doc) => (
        <DocumentCard key={doc.itp_id} doc={doc} />
      ))}

      {ready > 0 ? (
        <form
          className="flex flex-col gap-4 rounded-lg border-2 border-vri-gold/60 bg-white p-4"
          onSubmit={(event) => {
            event.preventDefault()
            setError(null)
            if (canSubmit) sign.mutate()
          }}
          data-testid="sign-form"
        >
          <h2 className="font-heading text-lg text-vri-green">
            Sign {ready} line{ready === 1 ? "" : "s"}
          </h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signer-name">Your full name</Label>
            <Input
              id="signer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={255}
              required
              data-testid="signer-name"
            />
          </div>
          <SignaturePad onChange={setSignature} />
          <div className="flex items-start gap-2">
            <Checkbox
              id="sign-confirm"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              data-testid="sign-confirm"
            />
            <Label htmlFor="sign-confirm" className="font-normal leading-snug">
              I have reviewed the {ready} line{ready === 1 ? "" : "s"} marked
              “Ready for you” and sign them as {session.role_name}.
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="sign-location"
              checked={shareLocation}
              onCheckedChange={(v) => setShareLocation(v === true)}
            />
            <Label htmlFor="sign-location" className="font-normal leading-snug">
              <MapPin className="inline size-4" aria-hidden /> Add my location
              to the signature (your browser will ask)
            </Label>
          </div>
          {error ? (
            <p
              className="rounded-md bg-status-critical-bg p-2 text-sm text-status-critical-fg"
              role="alert"
              data-testid="sign-error"
            >
              {error}
            </p>
          ) : null}
          <LoadingButton
            type="submit"
            size="lg"
            loading={sign.isPending}
            disabled={!canSubmit}
            data-testid="sign-submit"
          >
            <PenLine />
            Sign {ready} line{ready === 1 ? "" : "s"}
          </LoadingButton>
          <p className="text-xs text-muted-foreground">
            Your signature is recorded with the time and the weather at the
            site. The link works once.
          </p>
        </form>
      ) : (
        <p
          className="rounded-lg border bg-white p-4 text-sm"
          data-testid="sign-nothing-ready"
        >
          <Lock className="mr-1 inline size-4" aria-hidden />
          Nothing is ready for your signature yet. This link still works — come
          back when the project team tells you the work is ready.
        </p>
      )}
    </>
  )
}

function DocumentCard({ doc }: { doc: SignDocument }) {
  const [showAll, setShowAll] = useState(false)
  const mine = doc.lines.filter((l) => l.needs_you)
  const shown = showAll ? doc.lines : mine
  return (
    <section
      className="overflow-hidden rounded-lg border bg-white"
      data-testid="sign-document"
    >
      <div className="border-b bg-vri-green px-4 py-2 text-vri-offwhite">
        {doc.doc_number ? (
          <p className="font-mono text-xs text-vri-gold">{doc.doc_number}</p>
        ) : null}
        <h2 className="font-heading text-base">{doc.title}</h2>
      </div>
      <ul className="divide-y">
        {shown.map((line) => (
          <LineRow key={line.id} line={line} />
        ))}
        {shown.length === 0 ? (
          <li className="px-4 py-3 text-sm text-muted-foreground">
            No line here needs your signature.
          </li>
        ) : null}
      </ul>
      {doc.lines.length > mine.length ? (
        <button
          type="button"
          className="w-full border-t px-4 py-2 text-left text-sm text-vri-copper hover:underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? "Show only the lines for you"
            : `Show all ${doc.lines.length} lines of this ITP`}
        </button>
      ) : null}
    </section>
  )
}

function LineRow({ line }: { line: SignLine }) {
  const result = line.result_label ?? RESULT_TEXT[line.status] ?? line.status
  return (
    <li
      className={cn(
        "flex gap-3 px-4 py-3",
        line.status === "fail" && "bg-status-critical-bg/40",
        !line.needs_you && "opacity-75",
      )}
      data-testid="sign-line"
      data-state={line.sign_state ?? "info"}
    >
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 pt-0.5">
        <span className="font-mono text-xs text-muted-foreground">
          {line.number}
        </span>
        <ClassificationChip value={line.classification} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{line.requirement}</p>
        {line.acceptance_criteria ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-vri-green">Acceptance:</span>{" "}
            {line.acceptance_criteria}
          </p>
        ) : null}
        {line.reference_doc ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-vri-green">Reference:</span>{" "}
            {line.reference_doc}
          </p>
        ) : null}
        <p className="text-sm">
          <strong
            className={cn(line.status === "fail" && "text-status-critical-fg")}
          >
            {result}
          </strong>
          {line.measured_value
            ? ` · ${line.measured_value}${line.value_unit ? ` ${line.value_unit}` : ""}`
            : ""}
          {line.out_of_tolerance ? (
            <span className="text-status-critical-fg"> · out of tolerance</span>
          ) : null}
          {line.photo_count
            ? ` · ${line.photo_count} photo${line.photo_count === 1 ? "" : "s"}`
            : ""}
        </p>
        {line.conditions ? (
          <p className="whitespace-pre-wrap border-l-2 border-vri-gold pl-2 text-sm">
            Conditions: {line.conditions}
          </p>
        ) : null}
        {line.notes ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {line.notes}
          </p>
        ) : null}
        {line.needs_you ? <SignState line={line} /> : null}
      </div>
    </li>
  )
}

function SignState({ line }: { line: SignLine }) {
  if (line.sign_state === "ready") {
    return (
      <span className="inline-flex items-center gap-1 self-start rounded-full bg-status-attention-bg px-2.5 py-0.5 text-xs font-semibold text-status-attention-fg">
        <PenLine className="size-3" aria-hidden />
        Ready for you
      </span>
    )
  }
  if (line.sign_state === "signed") {
    return (
      <span className="inline-flex items-center gap-1 self-start rounded-full bg-status-positive-bg px-2.5 py-0.5 text-xs font-semibold text-status-positive-fg">
        <CheckCircle2 className="size-3" aria-hidden />
        Signed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 self-start rounded-full bg-status-neutral-bg px-2.5 py-0.5 text-xs text-status-neutral-fg">
      <Lock className="size-3" aria-hidden />
      Not ready: {line.waiting_reason}
    </span>
  )
}

/** The phone's position, or null if refused / unavailable within 8 s. */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  })
}
