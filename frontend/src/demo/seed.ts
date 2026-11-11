/*
 * Demo build only: the sample data the clickable demo starts with.
 *
 * Every project, person, tag and finding here is fictional. Dates are set
 * relative to the moment the demo opens so "recent activity" looks recent.
 */
import type {
  DrawingPublic,
  EmailLogPublic,
  FindingPublic,
  InspectionPublic,
  MemberPublic,
  PhotoPublic,
  PinPublic,
  ProjectPublic,
  ReportPublic,
} from "@/client"
import { derivedProjectCode } from "@/lib/itp"

import cableTray from "./assets/cable-tray.jpg?url"
import compressorSkid from "./assets/compressor-skid.jpg?url"
import condensateDrain from "./assets/condensate-drain.jpg?url"
import flange from "./assets/flange-ft104.jpg?url"
import padPonding from "./assets/pad-ponding.jpg?url"
import pidPdf from "./assets/sample-pid.pdf?url"
import sampleReport from "./assets/sample-report.pdf?url"
import sitePlan from "./assets/sample-site-plan.png?url"
import valveTag from "./assets/valve-xv205.jpg?url"
import { DEMO_USER } from "./auth0-stub"

export const SAMPLE_REPORT_URL = sampleReport

/** Static files that stand in for S3 objects, keyed by s3_key. */
export const ASSET_URLS: Record<string, string> = {
  "photos/demo/flange-ft104.jpg": flange,
  "photos/demo/pad-ponding.jpg": padPonding,
  "photos/demo/valve-xv205.jpg": valveTag,
  "photos/demo/compressor-skid.jpg": compressorSkid,
  "photos/demo/cable-tray.jpg": cableTray,
  "photos/demo/condensate-drain.jpg": condensateDrain,
  "drawings/projects/1/sample-pid.pdf": pidPdf,
  "drawings/projects/1/sample-site-plan.png": sitePlan,
}

const now = Date.now()
const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(now - ms).toISOString()
let uid = 1000
const publicId = () => `demo-${(uid++).toString(36)}`

export interface DemoDb {
  projects: ProjectPublic[]
  members: MemberPublic[]
  inspections: InspectionPublic[]
  findings: FindingPublic[]
  photos: PhotoPublic[]
  drawings: DrawingPublic[]
  pins: PinPublic[]
  reports: ReportPublic[]
  /** Email send log (increment 13.5): what the demo "emailed". */
  emails: EmailLogPublic[]
}

const me = DEMO_USER.email

function project(
  id: number,
  name: string,
  client: string,
  location: string,
  status: string,
  created: number,
): ProjectPublic {
  return {
    id,
    public_id: publicId(),
    name,
    client,
    location,
    status,
    created_by: me,
    created_at: ago(created),
    updated_at: ago(created),
    // Increment 13.8: no own ITP code; numbers use one derived from the name.
    code: null,
    itp_code: derivedProjectCode(name, id),
  }
}

function member(
  id: number,
  projectId: number,
  email: string,
  role: string,
  sub: string | null,
): MemberPublic {
  return {
    id,
    public_id: publicId(),
    project_id: projectId,
    email,
    user_email: email,
    user_sub: sub,
    role,
    invited_by: role === "owner" ? null : me,
    created_at: ago(20 * DAY),
  }
}

function inspection(
  id: number,
  projectId: number,
  title: string,
  type: string,
  created: number,
  notes: string,
  signedOff: number | null = null,
): InspectionPublic {
  return {
    id,
    public_id: publicId(),
    project_id: projectId,
    title,
    inspection_type: type,
    type,
    inspector: DEMO_USER.name,
    notes,
    status: "open",
    inspection_status: signedOff === null ? "open" : "closed",
    signed_off_by: signedOff === null ? null : me,
    signed_off_at: signedOff === null ? null : ago(signedOff),
    created_at: ago(created),
    updated_at: ago(signedOff ?? created),
  }
}

function finding(
  id: number,
  inspectionId: number,
  title: string,
  priority: "high" | "medium" | "low",
  status: "open" | "in-progress" | "resolved",
  location: string,
  description: string,
  created: number,
  resolution: string | null = null,
): FindingPublic {
  const resolved = status === "resolved"
  return {
    id,
    public_id: publicId(),
    inspection_id: inspectionId,
    title,
    description,
    priority,
    location_ref: location,
    status,
    resolved_by: resolved ? me : null,
    resolved_at: resolved ? ago(created - 2 * HOUR) : null,
    resolution_notes: resolved ? resolution : null,
    created_at: ago(created),
    updated_at: ago(created),
  }
}

function photo(
  id: number,
  inspectionId: number,
  file: string,
  created: number,
  findingId: number | null = null,
): PhotoPublic {
  const s3Key = `photos/demo/${file}`
  return {
    id,
    public_id: publicId(),
    inspection_id: inspectionId,
    finding_id: findingId,
    s3_key: s3Key,
    filename: file,
    content_type: "image/jpeg",
    uploaded_by: me,
    created_at: ago(created),
    view_url: ASSET_URLS[s3Key],
  }
}

function pin(
  id: number,
  drawingId: number,
  page: number,
  x: number,
  y: number,
  status: string,
  tag: string,
  label: string,
  findingId: number | null = null,
): PinPublic {
  return {
    id,
    public_id: publicId(),
    drawing_id: drawingId,
    finding_id: findingId,
    tag_number: tag,
    label,
    x_pct: x,
    y_pct: y,
    status,
    notes: null,
    discipline_data: null,
    page_number: page,
    created_by: me,
    created_at: ago(3 * DAY),
  }
}

export function createSeed(): DemoDb {
  const projects = [
    // The owner set the sample project's ITP code (13.8): ITP-CH-RNG-001 …
    {
      ...project(
        1,
        "Cedar Hollow Landfill RNG",
        "Sample Energy Partners",
        "Sample County, NC",
        "active",
        40 * DAY,
      ),
      code: "CH-RNG",
      itp_code: "CH-RNG",
    },
    project(
      2,
      "Brookside Dairy Digester",
      "Sample Dairy Co-op",
      "Sample County, WI",
      "active",
      25 * DAY,
    ),
    project(
      3,
      "North Basin Compressor Upgrade",
      "Sample Midstream LLC",
      "Sample County, TX",
      "on_hold",
      60 * DAY,
    ),
  ]

  const members = [
    member(1, 1, me, "owner", DEMO_USER.sub),
    member(2, 1, "j.alvarez@example.com", "inspector", "demo|alvarez"),
    member(3, 1, "qa.lead@example.com", "viewer", null),
    member(4, 2, me, "owner", DEMO_USER.sub),
    member(5, 2, "j.alvarez@example.com", "inspector", "demo|alvarez"),
    member(6, 3, me, "owner", DEMO_USER.sub),
  ]

  const inspections = [
    inspection(
      1,
      1,
      "Gas upgrading skid: mechanical walkdown",
      "piping",
      2 * HOUR,
      "Pre-commissioning walkdown of skids V-101 through M-303 against P&ID-100 rev B.",
    ),
    inspection(
      2,
      1,
      "Flare and condensate system",
      "mechanical",
      6 * DAY,
      "Walkdown of FL-401, V-401 and T-450.",
      5 * DAY,
    ),
    inspection(
      3,
      1,
      "Process pad: civil and drainage",
      "civil",
      2 * DAY,
      "Pad grading, swale and detention pond after last week's rain.",
    ),
    inspection(
      4,
      2,
      "Digester cover and gas header",
      "mechanical",
      1 * DAY,
      "Membrane cover anchors and header supports.",
    ),
    inspection(
      5,
      3,
      "Pre-construction site visit",
      "general",
      45 * DAY,
      "Laydown area and tie-in locations.",
      44 * DAY,
    ),
  ]

  const findings = [
    finding(
      1,
      1,
      "Bolt corrosion on flange at FT-104",
      "high",
      "open",
      'Sheet 1, line 8"-LFG-102 at FT-101',
      "One stud and nut heavily corroded; replace full bolt set before leak test.",
      90 * 60 * 1000,
    ),
    finding(
      2,
      1,
      "XV-205 tag does not match P&ID",
      "medium",
      "in-progress",
      "Sheet 2, aftercooler outlet",
      "Field tag reads XV-250. Confirm with vendor and re-tag.",
      80 * 60 * 1000,
    ),
    finding(
      3,
      1,
      "Compressor skid grout not placed",
      "medium",
      "open",
      "C-201 skid, north end",
      "Shims in place; grout outstanding. Hold mechanical completion.",
      70 * 60 * 1000,
    ),
    finding(
      4,
      1,
      "Cable tray cover missing at MCC entry",
      "low",
      "resolved",
      "MCC building, east wall",
      "Cover plate missing for 4 ft section.",
      60 * 60 * 1000,
      "Cover installed by electrical sub.",
    ),
    finding(
      5,
      2,
      "LT-452 not calibrated",
      "high",
      "resolved",
      "T-450 condensate tank",
      "No calibration record for the level transmitter.",
      6 * DAY,
      "Calibration certificate received and filed.",
    ),
    finding(
      6,
      2,
      "Condensate drain valve at V-101 missing tag",
      "medium",
      "resolved",
      "V-101 bottom drain",
      "Valve has no tag.",
      6 * DAY,
      "Tag installed.",
    ),
    finding(
      7,
      3,
      "Ponding at pad southeast corner",
      "medium",
      "open",
      "Site plan C-001, SE corner",
      "Standing water about 2 in deep 48 hours after rain. Check swale grade.",
      2 * DAY,
    ),
    finding(
      8,
      4,
      "Cover anchor bolt loose",
      "high",
      "open",
      "Digester 1, anchor 14",
      "Anchor bolt turns by hand.",
      1 * DAY,
    ),
  ]

  const photos = [
    // Two photos filed under their findings (increment 11a capture loop).
    photo(1, 1, "flange-ft104.jpg", 85 * 60 * 1000, 1),
    photo(2, 1, "valve-xv205.jpg", 75 * 60 * 1000, 2),
    photo(3, 1, "compressor-skid.jpg", 65 * 60 * 1000),
    photo(4, 1, "cable-tray.jpg", 55 * 60 * 1000),
    photo(5, 2, "condensate-drain.jpg", 6 * DAY),
    photo(6, 3, "pad-ponding.jpg", 2 * DAY),
  ]

  const drawings: DrawingPublic[] = [
    {
      id: 1,
      public_id: publicId(),
      project_id: 1,
      title: "Upgrading Plant P&ID",
      drawing_number: "P&ID-100",
      discipline: "pid",
      filename: "sample-pid.pdf",
      s3_key: "drawings/projects/1/sample-pid.pdf",
      file_type: "pdf",
      file_size: 7473,
      view_url: null,
      thumbnail_url: null,
      page_width_pts: 1224,
      page_height_pts: 792,
      uploaded_by: me,
      created_at: ago(30 * DAY),
      updated_at: ago(30 * DAY),
    },
    {
      id: 2,
      public_id: publicId(),
      project_id: 1,
      title: "Site Plan",
      drawing_number: "C-001",
      discipline: "civil_structural",
      filename: "sample-site-plan.png",
      s3_key: "drawings/projects/1/sample-site-plan.png",
      file_type: "png",
      file_size: 46081,
      view_url: null,
      thumbnail_url: null,
      page_width_pts: null,
      page_height_pts: null,
      uploaded_by: me,
      created_at: ago(30 * DAY),
      updated_at: ago(30 * DAY),
    },
  ]

  const pins = [
    pin(
      1,
      1,
      1,
      28.2,
      25.5,
      "punch_item",
      "FT-101",
      "Flange bolt corrosion",
      1,
    ),
    pin(2, 1, 1, 9.4, 27.3, "verified", "PT-102", "Verified against datasheet"),
    pin(3, 1, 1, 61.2, 36.4, "in_progress", "V-102", "Internals inspection"),
    pin(4, 1, 1, 74.1, 25.5, "not_installed", "AT-104", "Analyzer not yet set"),
    pin(5, 1, 2, 26.5, 36.4, "punch_item", "C-201", "Grout outstanding", 3),
    pin(6, 1, 2, 56.5, 36.4, "in_progress", "XV-205", "Tag mismatch", 2),
    pin(7, 1, 2, 68.8, 41.4, "not_started", "M-302", "Membrane module 2"),
    pin(8, 2, 1, 65.9, 70.7, "punch_item", "SE", "Ponding", 7),
  ]

  const reports: ReportPublic[] = [
    {
      id: 1,
      public_id: publicId(),
      inspection_id: 2,
      version: 1,
      s3_key: "reports/demo/inspection-2-v1.pdf",
      filename: "Flare-and-condensate-system-v1.pdf",
      file_size: 171843,
      finding_count: 2,
      photo_count: 1,
      generated_by: me,
      created_at: ago(5 * DAY),
      download_url: SAMPLE_REPORT_URL,
    },
  ]

  // The viewer on project 1 was invited three days ago and hasn't signed in.
  const emails: EmailLogPublic[] = [
    {
      id: 1,
      public_id: publicId(),
      project_id: 1,
      email_type: "member_invite",
      related_id: 3,
      recipient: "qa.lead@example.com",
      subject: "You've been added to Cedar Hollow Landfill RNG on VR Inspector",
      status: "sent",
      error: null,
      triggered_by: me,
      created_at: ago(3 * DAY),
      sent_at: ago(3 * DAY),
    },
  ]

  return {
    projects,
    members,
    inspections,
    findings,
    photos,
    drawings,
    pins,
    reports,
    emails,
  }
}

export { publicId as nextPublicId }
