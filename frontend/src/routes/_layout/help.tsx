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
            The person signs in with the invited email address.
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
