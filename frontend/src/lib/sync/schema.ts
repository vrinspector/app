/**
 * Local SQLite schema for offline sync (rebuild increment 18).
 *
 * One table per stream query in `powersync/sync-config.yaml`, with the same
 * columns (a test keeps the two in step). Ids and foreign keys are text: the
 * server's INTEGER ids arrive as text, and rows written offline carry a
 * temporary `local-…` id until the API assigns the real one.
 *
 * Two local-only tables (never synced) support the upload queue:
 * `local_id_map` remembers which server id each `local-…` id became, and
 * `upload_rejections` keeps every change the API refused, so increment 19 can
 * show it in the conflict audit trail instead of losing it silently.
 */
import { column, Schema, Table } from "@powersync/common"

type ColumnKind = "text" | "integer" | "real"

/** Synced tables → column → local type (the `id` column is implicit). */
export const SYNCED_COLUMNS: Record<string, Record<string, ColumnKind>> = {
  projects: {
    public_id: "text",
    name: "text",
    client: "text",
    location: "text",
    status: "text",
    code: "text",
    created_by: "text",
    created_at: "text",
    updated_at: "text",
  },
  project_members: {
    project_id: "text",
    user_email: "text",
    role: "text",
    created_at: "text",
  },
  inspections: {
    public_id: "text",
    project_id: "text",
    title: "text",
    inspection_type: "text",
    inspector: "text",
    notes: "text",
    status: "text",
    inspection_status: "text",
    signed_off_by: "text",
    signed_off_at: "text",
    created_at: "text",
    updated_at: "text",
  },
  findings: {
    public_id: "text",
    inspection_id: "text",
    title: "text",
    description: "text",
    priority: "text",
    location_ref: "text",
    status: "text",
    resolved_by: "text",
    resolved_at: "text",
    resolution_notes: "text",
    discipline: "text",
    created_at: "text",
    updated_at: "text",
  },
  photos: {
    public_id: "text",
    inspection_id: "text",
    itp_item_id: "text",
    finding_id: "text",
    s3_key: "text",
    filename: "text",
    content_type: "text",
    uploaded_by: "text",
    shot_slot: "text",
    captured_at: "text",
    category: "text",
    defect_tags: "text",
    severity: "text",
    created_at: "text",
  },
  drawings: {
    public_id: "text",
    project_id: "text",
    title: "text",
    drawing_number: "text",
    discipline: "text",
    filename: "text",
    s3_key: "text",
    file_type: "text",
    file_size: "integer",
    page_width_pts: "real",
    page_height_pts: "real",
    series_id: "text",
    revision: "text",
    superseded_at: "text",
    uploaded_by: "text",
    created_at: "text",
    updated_at: "text",
  },
  inspection_pins: {
    public_id: "text",
    drawing_id: "text",
    finding_id: "text",
    itp_item_id: "text",
    tag_number: "text",
    label: "text",
    x_pct: "real",
    y_pct: "real",
    status: "text",
    notes: "text",
    page_number: "integer",
    position_check: "integer",
    carried_from_pin_id: "text",
    created_by: "text",
    created_at: "text",
  },
  project_areas: {
    public_id: "text",
    project_id: "text",
    parent_area_id: "text",
    name: "text",
    area_type: "text",
    sort_order: "integer",
    created_at: "text",
    updated_at: "text",
  },
  project_itps: {
    public_id: "text",
    project_id: "text",
    area_id: "text",
    template_version: "integer",
    seq: "integer",
    title: "text",
    status: "text",
    body: "text",
    created_at: "text",
    updated_at: "text",
  },
  itp_items: {
    public_id: "text",
    project_itp_id: "text",
    section: "text",
    element_name: "text",
    requirement: "text",
    classification: "text",
    status: "text",
    notes: "text",
    sort_order: "integer",
    acceptance_criteria: "text",
    reference_doc: "text",
    record_required: "text",
    photo_required: "integer",
    photo_set: "text",
    result_scale: "text",
    approved_label: "text",
    conditions: "text",
    value_type: "text",
    value_unit: "text",
    value_min: "real",
    value_max: "real",
    measured_value: "text",
    created_at: "text",
    updated_at: "text",
  },
  signoff_roles: {
    project_id: "text",
    role_name: "text",
    party: "text",
    signer_email: "text",
    created_at: "text",
  },
}

/** Local-only bookkeeping for the upload queue (see upload.ts). */
export const LOCAL_ONLY_COLUMNS: Record<string, Record<string, ColumnKind>> = {
  local_id_map: {
    table_name: "text",
    local_id: "text",
    server_id: "text",
    created_at: "text",
  },
  upload_rejections: {
    table_name: "text",
    op: "text",
    row_id: "text",
    http_status: "integer",
    detail: "text",
    payload: "text",
    created_at: "text",
  },
}

/** Indexes on the foreign keys the screens filter by. */
const INDEXES: Record<string, Record<string, string[]>> = {
  project_members: { project: ["project_id"] },
  inspections: { project: ["project_id"] },
  findings: { inspection: ["inspection_id"] },
  photos: {
    inspection: ["inspection_id"],
    finding: ["finding_id"],
    itp_item: ["itp_item_id"],
  },
  drawings: { project: ["project_id"] },
  inspection_pins: { drawing: ["drawing_id"] },
  project_areas: { project: ["project_id"] },
  project_itps: { project: ["project_id"] },
  itp_items: { itp: ["project_itp_id"] },
  signoff_roles: { project: ["project_id"] },
  local_id_map: { local: ["table_name", "local_id"] },
}

function columnsOf(spec: Record<string, ColumnKind>) {
  return Object.fromEntries(
    Object.entries(spec).map(([name, kind]) => [name, column[kind]]),
  )
}

export function buildSchema(): Schema {
  const tables: Record<string, Table> = {}
  for (const [name, spec] of Object.entries(SYNCED_COLUMNS)) {
    tables[name] = new Table(columnsOf(spec), { indexes: INDEXES[name] })
  }
  for (const [name, spec] of Object.entries(LOCAL_ONLY_COLUMNS)) {
    tables[name] = new Table(columnsOf(spec), {
      localOnly: true,
      indexes: INDEXES[name],
    })
  }
  return new Schema(tables)
}
