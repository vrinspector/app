import { createFileRoute, Link } from "@tanstack/react-router"
import {
  ArrowRight,
  ExternalLink,
  Laptop,
  LayoutDashboard,
  Smartphone,
} from "lucide-react"
import type { ReactNode } from "react"

import { PageHeader } from "@/components/Common/PageHeader"
import { Button } from "@/components/ui/button"
import { PIN_STATUS_OPTIONS } from "@/lib/vocab"

/** The published user guide (served from the public site, not this app). */
const PUBLIC_HELP_URL = "https://vrinspector.com/help/"

export const Route = createFileRoute("/_layout/help")({
  component: Help,
  head: () => ({
    meta: [
      {
        title: "Help - VR Inspector",
      },
    ],
  }),
})

/*
 * The in-app user guide: the legacy Help overlay (`renderHelpGuide`) with
 * the same six sections — getting started, device split, core workflows,
 * field-to-office hand-off, access, troubleshooting — and its copy brought
 * up to date with the rebuilt screens: button names (Take photo, Log
 * finding, Upload drawing), the viewer that opens fit-to-width and zooms
 * 25–300 % with pinch and buttons on PDFs *and* raster drawings
 * (decisions 20–21), editable pins, the members panel and report versions.
 * The public guide at vrinspector.com/help keeps covering the same ground
 * for people who are not signed in.
 */

const TOPICS = [
  { id: "getting-started", label: "Getting started" },
  { id: "device-split", label: "Device split" },
  { id: "workflows", label: "Core workflows" },
  { id: "handoff", label: "Field-to-office handoff" },
  { id: "access", label: "Access" },
  { id: "troubleshooting", label: "Troubleshooting" },
] as const

function Help() {
  return (
    <>
      <PageHeader
        title="Help"
        description="How to use VR Inspector: phone in the field, desktop for drawings."
        actions={
          <Button asChild variant="outline">
            <a
              href={PUBLIC_HELP_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="public-help-link"
            >
              <ExternalLink />
              Public user guide
            </a>
          </Button>
        }
      />

      <article
        className="flex max-w-5xl flex-col gap-6"
        data-testid="help-guide"
      >
        <section className="rounded-lg border-b-4 border-vri-gold bg-vri-green p-6 text-vri-offwhite">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-vri-gold">
            VR Inspector user guide
          </p>
          <h2 className="mt-1 font-heading text-2xl leading-tight sm:text-3xl">
            Use the right device for the work: phone in the field, desktop for
            drawings.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-vri-offwhite/85">
            VR Inspector helps project teams document inspections, photos,
            findings, drawing pins, reports and member access in one project
            workspace. This guide describes the rebuilt app, including the
            drawing viewer with page navigation, pinch-zoom and page-aware pins.
          </p>
          <nav aria-label="Help topics" className="mt-4 flex flex-wrap gap-2">
            {TOPICS.map((topic) => (
              <a
                key={topic.id}
                href={`#help-${topic.id}`}
                className="rounded-full border border-vri-gold/60 px-3 py-1 text-sm text-vri-offwhite transition-colors hover:bg-vri-gold hover:text-vri-charcoal focus-visible:outline-2 focus-visible:outline-vri-gold"
              >
                {topic.label}
              </a>
            ))}
          </nav>
        </section>

        <HelpSection id="getting-started" title="Getting started">
          <ol className="grid gap-3" data-testid="getting-started-steps">
            <Step n={1} title="Sign in.">
              Use <strong>Sign in</strong> with your approved VR Inspector
              account. Project data loads only after you are signed in.
            </Step>
            <Step n={2} title="Open or create a project.">
              Projects group inspections, drawings, members, findings, photos
              and reports for one job or facility. Open{" "}
              <Link to="/projects" className="underline">
                Projects
              </Link>{" "}
              and tap <strong>New project</strong>.
            </Step>
            <Step n={3} title="Create an inspection.">
              Give it a title, an inspection type, the inspector's name and
              notes so field observations stay organised by site walk or
              discipline. New inspections pre-fill your name as the inspector.
            </Step>
            <Step
              n={4}
              title="Capture photos and log findings on your phone; place drawing pins on a desktop when precision matters."
            >
              This split keeps field capture fast while preserving drawing
              accuracy for PDFs, zoom and multi-page review.
            </Step>
          </ol>
        </HelpSection>

        <HelpSection id="device-split" title="Recommended device split">
          <div className="grid gap-3 md:grid-cols-2">
            <HelpCard
              icon={<Smartphone />}
              title="Mobile phone: field inspections, photos, findings"
            >
              <ul className="list-disc space-y-1 pl-5">
                <li>Start or open an inspection while walking the site.</li>
                <li>
                  Tap <strong>Take photo</strong> to use the phone camera for
                  site evidence, or <strong>Upload</strong> to pick several
                  photos from the library. Each upload shows its progress and
                  can be retried if the connection drops.
                </li>
                <li>
                  Tap <strong>Log finding</strong> and enter the title,
                  description, priority and location reference. On phones the
                  two buttons stay in a bar at the bottom of the screen.
                </li>
                <li>
                  Use <strong>Dictate</strong> on the description where the
                  browser supports speech recognition; type instead if voice
                  input is not available.
                </li>
                <li>
                  <strong>Draft with AI</strong> (when switched on for your
                  account) turns the note into a title, priority, discipline and
                  tidy description. The fields are marked{" "}
                  <strong>AI draft</strong> until you save: check each one,
                  change what is wrong, or tap <strong>Undo</strong> to get your
                  own words back. Nothing is saved until you tap{" "}
                  <strong>Log finding</strong>.
                </li>
                <li>
                  Open a photo and tap <strong>Analyse with AI</strong> to have
                  it filed: a category, the defects it seems to show (crack,
                  corrosion, water ingress, damage, safety hazard) and a
                  severity. Correct anything, then <strong>File photo</strong>{" "}
                  or <strong>Log as finding</strong>.{" "}
                  <strong>File photo</strong> also works by hand without AI.
                </li>
              </ul>
            </HelpCard>
            <HelpCard
              icon={<Laptop />}
              title="Desktop or laptop: drawings, PDFs, zoom, pins"
            >
              <ul className="list-disc space-y-1 pl-5">
                <li>Upload drawings from organised project files.</li>
                <li>
                  Review multi-page PDFs with <strong>Prev / Next</strong> and
                  the page indicator.
                </li>
                <li>
                  Use the zoom buttons, <strong>Fit to width</strong> or a pinch
                  gesture for detail review and accurate pin placement.
                </li>
                <li>
                  Place colour-coded pins on the current PDF page or on a raster
                  drawing.
                </li>
              </ul>
            </HelpCard>
          </div>
          <Note>
            <strong>Why this matters:</strong> phone screens are ideal for field
            evidence capture, but a desktop or laptop screen is better for
            drawing upload, multi-page PDF review, high-zoom checks and precise
            pin placement.
          </Note>
        </HelpSection>

        <HelpSection id="workflows" title="Core workflows">
          <h4 className="font-semibold">Project and inspection workflow</h4>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open <strong>Projects</strong>, select a project or create a new
              one.
            </li>
            <li>Create an inspection for the site walk or discipline.</li>
            <li>
              Use the inspection screen for weather context, photos, findings,
              sign-off and reports.
            </li>
            <li>
              <strong>Sign off</strong> only when the inspection record is ready
              to close; findings are locked after sign-off.{" "}
              <strong>Reopen</strong> if follow-up is required.
            </li>
          </ol>

          <h4 className="mt-4 font-semibold">
            Photo and finding workflow on mobile
          </h4>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open the inspection on your phone.</li>
            <li>
              Tap <strong>Take photo</strong>; the picture is uploaded to secure
              storage and recorded on the inspection. Tap a thumbnail to view it
              full size.
            </li>
            <li>
              Tap <strong>Log finding</strong>, enter the issue, priority and
              location reference.
            </li>
            <li>
              Use <strong>In progress</strong>, <strong>Resolve</strong> and{" "}
              <strong>Reopen</strong> on a finding to move it from open to in
              progress or resolved; resolution notes are kept with it.
            </li>
          </ol>

          <h4 className="mt-4 font-semibold">
            Drawing upload and pin workflow on desktop
          </h4>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open a project, then use <strong>Upload drawing</strong> in the
              Drawings section. Several files can be uploaded at once.
            </li>
            <li>
              Accepted drawing types are PDF, PNG, JPG/JPEG and SVG, up to 50 MB
              each.
            </li>
            <li>
              Open a drawing card. The viewer opens the sheet scaled to fit the
              screen; PDFs render page by page, raster images open as one page.
              Both zoom from 25 % to 300 % with the − / + buttons, a pinch
              gesture or Ctrl + scroll.
            </li>
            <li>
              For PDFs, choose the page before pinning. Pins are saved to the
              current page and only that page's pins are shown.
            </li>
            <li>
              Tap <strong>Add pin</strong>, tap the drawing location and choose
              the status. Tap a pin to change its status, add a label or notes,
              link it to a finding, or delete it.
            </li>
            <li>
              <strong>Pin to finding in one go:</strong> with "Then log a
              finding with a photo" ticked (the default), choosing the status
              opens the finding form straight away — <strong>Take photo</strong>
              ,<strong>Dictate</strong> a sentence,{" "}
              <strong>Save finding</strong>. With AI switched on, stopping the
              dictation fills the fields as an <strong>AI draft</strong> for you
              to check before saving. The finding is filed in the inspection
              shown (change it if needed), its photo stays with it, and the pin
              links to it. From an inspection, <strong>Pin on drawing</strong>{" "}
              opens a sheet with that inspection pre-selected. Untick the box to
              place pins on their own.
            </li>
            <li>
              <strong>Moving a pin:</strong> open it, tap <strong>Move</strong>,
              then tap the spot where it belongs.
            </li>
            <li>
              <strong>New revision of a sheet:</strong> on the drawing, open the{" "}
              <strong>⋯</strong> menu and choose{" "}
              <strong>Upload new revision</strong> (Rev A → Rev B). The new file
              becomes the one everybody sees and every pin is copied to the same
              spot with a gold <strong>?</strong> — “carried from Rev A, check
              position”. Use <strong>Next pin to check</strong>, then{" "}
              <strong>Position is right</strong> or <strong>Move pin</strong>.
              Older revisions stay under <strong>Revisions</strong>, read-only,
              with their pins as they were.
            </li>
            <li>
              <strong>Crowded sheets:</strong> pins too close to tell apart at
              the current zoom show as one numbered circle — tap it to zoom in
              on them. <strong>Filter</strong> on the viewer toolbar hides pins
              by status, or shows only those linked to an ITP line (or one ITP),
              to a finding, to nothing, or still to check. The phone remembers
              your filter for that project.
            </li>
          </ol>
          <ul
            className="mt-3 flex flex-wrap gap-2"
            aria-label="Pin status colours"
            data-testid="pin-legend"
          >
            {PIN_STATUS_OPTIONS.map((status) => (
              <li
                key={status.value}
                className="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-sm"
              >
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: status.color }}
                  aria-hidden="true"
                />
                {status.label}
              </li>
            ))}
          </ul>

          <h4 className="mt-4 font-semibold">Reports</h4>
          <p>
            On the inspection screen, <strong>Generate report</strong> builds a
            PDF of the inspection: its details and sign-off state, the findings
            with their resolution, and the site photos. Every report is kept as
            a numbered version with a <strong>Download PDF</strong> button, so
            an earlier report can always be opened again.
          </p>
          <p>
            <strong>Add a summary</strong> puts a few sentences of your own at
            the top of the next report. Owners and inspectors can tap{" "}
            <strong>Draft with AI</strong> to have the summary written from the
            findings already recorded — what was inspected, what was found and
            what is still open. It is an <strong>AI draft</strong> until you
            generate the report: edit it freely or tap <strong>Undo</strong>.
            The PDF notes that the summary was drafted with AI and reviewed by
            you.
          </p>
          <h3 className="mt-2 font-semibold">ITPs, hold points and areas</h3>
          <p>
            Build a master inspection and test plan once under{" "}
            <strong>ITP templates</strong>: its sections, lines, whether each
            line is a <strong>Hold</strong> (H), <strong>Witness</strong> (W),{" "}
            <strong>Review</strong> (R) or <strong>Information</strong> (I)
            point, its acceptance criteria, reference document and the record
            required, and which roles sign it — by default the Contractor, the
            Owner's representative and a Third-party inspector. On a project,{" "}
            <strong>Apply template</strong> makes the project's own copy — for
            the whole project or, in one action, one copy per area (a level,
            lot, stage or chainage; add a numbered series such as Level 1–12
            with <strong>Add a series</strong>). Editing the master later never
            changes a copy already in use.
          </p>
          <p>
            Already have an ITP? Under <strong>ITP templates</strong>, tap{" "}
            <strong>Import with AI</strong> and choose the PDF, the Excel or CSV
            sheet, or take photos of the paper form. The AI reads it into
            sections and lines; you check each line's wording, its H / W / R / I
            code, criteria, reference, record, who signs it, and whether it
            needs a photo or a measured value, add or remove lines, then tap{" "}
            <strong>Save as master template</strong>. It is saved as a draft
            master, marked as imported with AI, ready to publish and apply like
            any other.
          </p>
          <p>
            A new account starts with eleven <strong>starter templates</strong>{" "}
            that follow the checklists in Stacey Roberts' field guide and
            commissioning guide: cast-in-place concrete (all 25 pre-pour items
            of Checklist A-1 — formwork and shoring, reinforcement, embedded
            items, mix and delivery readiness, documentation — then the written
            pre-pour release, the during-pour test set and post-pour curing in
            hot and cold weather), earthwork and compaction, underground conduit
            / duct bank before backfill, structural steel connections, piping
            pressure test, electrical pre-energization, instrument calibration,
            and the four commissioning gates (pre-commissioning readiness, cold
            commissioning, hot commissioning, ready for startup). Every line
            states a measurable acceptance criterion and its reference — the
            checklist and item number in the book. Where the number depends on
            your project — a specified cover, slump or test pressure — or a book
            figure is on the known-errors list, the line says{" "}
            <em>Project-specific value required — verify before issue</em>: edit
            the master and put your project's value in before you apply it.{" "}
            <strong>New template</strong> can start from any starter again, or
            from a blank outline.
          </p>
          <p>
            Record each line with <strong>Pass</strong>, <strong>Fail</strong>{" "}
            or <strong>N/A</strong>. A hold point stops the lines after it until
            every required role has signed it; owners sign for roles without a
            signer email, and a role with an email is signed by that person from
            their own login. An ITP can be marked complete once every line is
            recorded, nothing has failed and every hold point is released.{" "}
            <strong>Mark on drawing</strong> places a pin for a line, and the
            pin shows the line's hold-point state on the sheet.
          </p>
          <p>
            A <strong>release line</strong> — such as the concrete pre-pour
            release — is recorded in writing as{" "}
            <strong>Approved to pour</strong>,{" "}
            <strong>Approved with conditions</strong> or{" "}
            <strong>Rejected</strong> instead of Pass / Fail / N/A. Approved
            with conditions asks you to list each condition; the list shows
            under the line and stays with the signed record. Rejected opens the
            note for the deficiencies. Nothing after the release can be recorded
            until its signers have signed.
          </p>
          <p>
            Every line can carry evidence. <strong>Take photo</strong> or{" "}
            <strong>Upload</strong> adds photos to the line; a line marked{" "}
            <em>Photo required</em> cannot pass or be signed until one is on
            file, and then shows <strong>Photo on file</strong>. Lines that
            record a measurement — clear cover, slump, air, concrete temperature
            — have a box for the value with its unit (US customary by default),
            entered alongside Pass or Fail; a value outside the line's limits is
            flagged <strong>Out of tolerance</strong>.
          </p>
          <p>
            Some lines ask for the <strong>three-shot set</strong>: a{" "}
            <strong>Context</strong> photo that shows where you are, an{" "}
            <strong>Intermediate</strong> photo of the element and its
            surroundings, and a <strong>Close-up with scale</strong> with a tape
            or scale card in the frame. Each has its own Take and Upload button;
            the line can pass only when all three are on file.
          </p>
          <p>
            Each ITP has a document number such as <strong>ITP-LC4-001</strong>:
            the project's ITP code and a running number. Owners set the code
            under <strong>Edit project</strong>; left blank, it comes from the
            project name. On the ITP screen each section has a green header bar
            that shows <em>Sign-off required</em> while a hold point in it is
            waiting, and one notice says which hold point locks the lines below
            it. A failed line turns brick red with its note underneath — tapping{" "}
            <strong>Fail</strong> opens the note box straight away.
          </p>
          <p>
            <strong>Signatures from people without an account.</strong> On an
            ITP's <strong>Sign-off</strong> tab, or at the bottom of an area,{" "}
            <strong>Email signing links</strong> sends each signer whose lines
            are ready a link that works once, for 14 days. They open it on any
            phone, review the lines waiting for them, draw their signature and
            sign every ready line in one go; the signature is stamped with the
            time, the weather at the site and, if they allow it, their location.
            An area's link covers all of that area's ITPs, so a signer can do a
            whole floor or lot in one visit. <strong>Remind</strong> sends a
            fresh link (the old one stops working); <strong>Withdraw</strong>{" "}
            cancels a link. A role needs a signer email under{" "}
            <strong>Sign-off roles</strong>, or use{" "}
            <strong>Send to one person</strong>.
          </p>
          <p>
            <strong>Get the current pack</strong> makes the sign-off pack: one
            PDF of every line, result, photo and signature. A new version is
            made only when something on it changed, and every version is kept.
            On a witness or hold point line, <strong>Send notice</strong> emails
            its signers that the work is coming up, so they can attend.
          </p>
        </HelpSection>

        <HelpSection id="handoff" title="Field-to-office handoff">
          <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
            <HelpCard icon={<Smartphone />} title="Field inspector on phone">
              Capture photos, log findings, add location references and keep the
              inspection record current during the site walk.
            </HelpCard>
            <div
              className="hidden items-center justify-center text-3xl font-bold text-vri-gold md:flex"
              aria-hidden="true"
            >
              →
            </div>
            <HelpCard icon={<Laptop />} title="Office reviewer on desktop">
              Upload or open drawings, review PDFs page by page, zoom for
              detail, place pins, resolve or reopen findings, and generate
              reports.
            </HelpCard>
          </div>
          <p className="text-sm text-muted-foreground">
            Tip: use consistent finding titles and location references so
            desktop reviewers can match photos and findings to drawing locations
            before placing pins.
          </p>
        </HelpSection>

        <HelpSection id="access" title="Permissions and access">
          <p>
            VR Inspector is an authenticated project workspace. Sign-in is
            required, and project membership controls access to project
            information, drawings, pins and collaboration features. Members are
            managed in the <strong>Members</strong> section at the bottom of the
            project screen: owners invite by email as an{" "}
            <strong>Inspector</strong> (logs inspections, findings and photos)
            or a <strong>Viewer</strong> (read-only), and can remove members.
            The person is emailed an invite with a link to the project and signs
            in with the invited email address. Under each member, owners see
            whether the invite email went out, and can press{" "}
            <strong>Resend invite</strong> until the person has signed in.
          </p>
          <Note>
            <strong>Use the correct project:</strong> confirm the project name
            before uploading drawings, capturing inspection evidence or inviting
            another team member.
          </Note>
        </HelpSection>

        <HelpSection id="troubleshooting" title="Troubleshooting">
          <div className="grid gap-3 md:grid-cols-2">
            <HelpCard title="Page controls do not appear">
              Prev / Next and the page indicator are only for PDF drawings. PNG,
              JPG and SVG drawings open as a single page; they still zoom, pan
              and take pins.
            </HelpCard>
            <HelpCard title="Phone browser slows down at high zoom">
              The viewer limits how much it renders on phones (the Samsung
              Chrome memory safeguard). A desktop or laptop is still recommended
              for high-zoom PDF review.
            </HelpCard>
            <HelpCard title="Cannot upload a drawing">
              Confirm you are inside the correct project, signed in, and using a
              PDF, PNG, JPG/JPEG or SVG under 50 MB. A failed upload stays in
              the grid with a <strong>Retry</strong> button.
            </HelpCard>
            <HelpCard title="Voice dictation is unavailable">
              Voice input depends on browser support. Use Chrome or Edge where
              supported, or type the finding description.
            </HelpCard>
            <HelpCard title="No Draft with AI or Analyse with AI button">
              AI help appears only when it is switched on for the app, for
              owners and inspectors, and while the inspection is open. If the AI
              service is busy or a daily limit is reached, the app says so; fill
              the form in yourself. AI never saves anything on its own, and
              every finding it helped with is marked{" "}
              <strong>AI-assisted</strong> with a note of how it was drafted.
              The same applies to report summaries and ITP imports; an import
              that finds no inspection lines says so — try a clearer scan or
              photo.
            </HelpCard>
            <HelpCard title="iPad / Safari">
              The rebuilt viewer is checked on iPad Safari as part of the device
              pass; if a page does not render, use a current Chrome or Edge on a
              desktop and let the project owner know.
            </HelpCard>
            <HelpCard title="A photo does not upload">
              Each photo tile shows its progress and the reason if it failed.
              Tap <strong>Retry</strong> once you have signal again; the
              original is uploaded at full resolution.
            </HelpCard>
          </div>
        </HelpSection>

        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/">
              <LayoutDashboard />
              Back to dashboard
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/projects">
              Open projects
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </article>
    </>
  )
}

function HelpSection({
  id,
  title,
  children,
}: {
  id: (typeof TOPICS)[number]["id"]
  title: string
  children: ReactNode
}) {
  return (
    <section
      id={`help-${id}`}
      aria-labelledby={`help-${id}-title`}
      className="scroll-mt-20 flex flex-col gap-3 rounded-lg border bg-card p-5 text-sm leading-relaxed"
      data-testid={`help-${id}`}
    >
      <h3
        id={`help-${id}-title`}
        className="font-heading text-xl text-vri-green dark:text-vri-gold"
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: ReactNode
}) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-3 rounded-lg border bg-background p-3">
      <span
        className="flex size-8 items-center justify-center rounded-full bg-vri-green font-bold text-vri-gold"
        aria-hidden="true"
      >
        {n}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground">{children}</p>
      </div>
    </li>
  )
}

function HelpCard({
  icon,
  title,
  children,
}: {
  icon?: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <article className="rounded-lg border border-l-4 border-l-vri-gold bg-background p-4">
      <h4 className="flex items-center gap-2 font-semibold">
        {icon ? (
          <span className="text-vri-copper [&>svg]:size-4" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {title}
      </h4>
      <div className="mt-2 text-muted-foreground">{children}</div>
    </article>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-l-4 border-l-vri-gold bg-status-attention-bg/40 p-3 text-sm">
      {children}
    </div>
  )
}
