/**
 * Offline upload queue → existing API (rebuild increment 18).
 *
 * PowerSync records every local write (insert = PUT, update = PATCH, delete =
 * DELETE) in its upload queue. This module replays each one against the same
 * `/api/v1/` endpoints the screens call online, so the API stays the single
 * write authority: membership, roles, hold-point locks and sign-off locks are
 * checked exactly as they are for an online request.
 *
 * What can be written offline (everything else is read-only on the phone):
 *
 * | table           | create                          | change                                   | delete |
 * |-----------------|---------------------------------|------------------------------------------|--------|
 * | inspections     | POST /inspections               | PUT /inspections/{id}                    | yes    |
 * | findings        | POST /findings                  | PUT /findings/{id}, PATCH …/status, …/resolve | yes |
 * | inspection_pins | POST /drawings/{drawing_id}/pins | PUT /pins/{id}                          | yes    |
 * | itp_items       | —                               | PUT /itp-items/{id} (result, notes, value, conditions) | — |
 *
 * Sign-offs (inspection sign-off / reopen, ITP signatures) need a connection
 * on purpose: they are the legal record, so they are made against the live
 * state, never replayed later.
 *
 * Ids: a row created offline has a `local-…` id. When its POST succeeds, the
 * server id is remembered (`local_id_map`) and every later queued change that
 * names the local id — the row itself or a child's foreign key, e.g. a finding
 * logged under an inspection created offline — is sent with the server id.
 *
 * Outcomes per change:
 *  - 2xx (or 404 on a delete: already gone) → done.
 *  - Network failure, 401, 408, 425, 429, 5xx → thrown: PowerSync keeps the
 *    queue and retries later (after refreshing the token on 401).
 *  - Any other 4xx (validation, 403 role, 404 object-hiding, 409 locked) →
 *    recorded in `upload_rejections` with the API's reason and skipped, so
 *    one refused change cannot block everything queued behind it. The next
 *    sync brings the server's version back onto the phone.
 */

export const LOCAL_ID_PREFIX = "local-"

export type UpdateKind = "PUT" | "PATCH" | "DELETE"

/** The parts of a PowerSync CrudEntry the queue needs. */
export interface QueuedChange {
  table: string
  op: UpdateKind
  id: string
  opData?: Record<string, unknown>
}

export interface ApiRequest {
  method: "POST" | "PUT" | "PATCH" | "DELETE"
  /** Path under /api/v1 */
  path: string
  body?: Record<string, unknown>
  /** POST that creates the row: remember the server id it returns. */
  creates?: { table: string; localId: string }
}

export interface ApiResponse {
  status: number
  body?: unknown
}

/** Sends one request; throws only when the request could not be made. */
export type Transport = (request: ApiRequest) => Promise<ApiResponse>

export interface UploadStore {
  /** Server id a `local-…` id became, if its create has gone through. */
  serverIdFor(table: string, localId: string): Promise<string | undefined>
  remember(table: string, localId: string, serverId: string): Promise<void>
  reject(change: QueuedChange, status: number, detail: string): Promise<void>
}

/** Thrown to make PowerSync keep the queue and try again later. */
export class RetryUpload extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = "RetryUpload"
  }
}

/** A change the queue refuses before sending (recorded, like a 4xx). */
class Refused extends Error {}

interface TableRules {
  /** Foreign keys → the table their ids belong to. */
  references: Record<string, string>
  create?: {
    path: (row: Record<string, unknown>) => string
    fields: readonly string[]
  }
  /** Fields a change sends with PUT {path}. */
  update?: { path: (id: string) => string; fields: readonly string[] }
  remove?: (id: string) => string
}

const NUMERIC = new Set(["x_pct", "y_pct", "page_number"])

export const WRITABLE: Record<string, TableRules> = {
  inspections: {
    references: { project_id: "projects" },
    create: {
      path: () => "/inspections",
      fields: [
        "project_id",
        "title",
        "inspection_type",
        "inspector",
        "notes",
        "status",
      ],
    },
    update: {
      path: (id) => `/inspections/${id}`,
      fields: ["title", "inspection_type", "inspector", "notes"],
    },
    remove: (id) => `/inspections/${id}`,
  },
  findings: {
    references: { inspection_id: "inspections" },
    create: {
      path: () => "/findings",
      fields: [
        "inspection_id",
        "title",
        "description",
        "priority",
        "location_ref",
        "status",
        "discipline",
      ],
    },
    update: {
      path: (id) => `/findings/${id}`,
      fields: [
        "title",
        "description",
        "priority",
        "location_ref",
        "discipline",
      ],
    },
    remove: (id) => `/findings/${id}`,
  },
  inspection_pins: {
    references: {
      drawing_id: "drawings",
      finding_id: "findings",
      itp_item_id: "itp_items",
    },
    create: {
      path: (row) => `/drawings/${row.drawing_id}/pins`,
      fields: [
        "finding_id",
        "itp_item_id",
        "tag_number",
        "label",
        "x_pct",
        "y_pct",
        "status",
        "notes",
        "page_number",
      ],
    },
    update: {
      path: (id) => `/pins/${id}`,
      fields: [
        "finding_id",
        "itp_item_id",
        "tag_number",
        "label",
        "status",
        "notes",
        "x_pct",
        "y_pct",
        "page_number",
      ],
    },
    remove: (id) => `/pins/${id}`,
  },
  itp_items: {
    references: {},
    update: {
      path: (id) => `/itp-items/${id}`,
      fields: ["status", "notes", "measured_value", "conditions"],
    },
  },
}

export function isLocalId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(LOCAL_ID_PREFIX)
}

export function newLocalId(): string {
  return `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`
}

async function serverId(
  store: UploadStore,
  table: string,
  id: string,
): Promise<string> {
  if (!isLocalId(id)) return id
  const mapped = await store.serverIdFor(table, id)
  if (mapped === undefined) {
    throw new Refused(
      `Depends on a ${table} row created offline that the server did not accept`,
    )
  }
  return mapped
}

function toApiValue(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (field.endsWith("_id") || NUMERIC.has(field)) {
    const number = Number(value)
    if (!Number.isFinite(number)) {
      throw new Refused(`${field} is not a number: ${String(value)}`)
    }
    return number
  }
  return value
}

async function body(
  rules: TableRules,
  fields: readonly string[],
  data: Record<string, unknown>,
  store: UploadStore,
  { dropNulls }: { dropNulls: boolean },
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    if (!(field in data)) continue
    let value = data[field]
    if (value === null || value === undefined) {
      if (dropNulls) continue
      out[field] = null
      continue
    }
    const target = rules.references[field]
    if (target && typeof value === "string") {
      value = await serverId(store, target, value)
    }
    out[field] = toApiValue(field, value)
  }
  return out
}

/**
 * The API requests one queued change becomes, in order. Throws `Refused`
 * (recorded, not retried) when the change cannot be expressed offline.
 */
export async function planRequests(
  change: QueuedChange,
  store: UploadStore,
): Promise<ApiRequest[]> {
  const rules = WRITABLE[change.table]
  if (!rules) {
    throw new Refused(`${change.table} is read-only offline`)
  }
  const data = change.opData ?? {}

  if (change.op === "PUT") {
    if (!rules.create || !isLocalId(change.id)) {
      throw new Refused(`New ${change.table} rows cannot be created offline`)
    }
    const fields = await body(rules, rules.create.fields, data, store, {
      dropNulls: true,
    })
    let pathRow = data
    if (change.table === "inspection_pins") {
      const drawing = data.drawing_id
      if (typeof drawing !== "string" || !drawing) {
        throw new Refused("A pin needs its drawing")
      }
      pathRow = { drawing_id: await serverId(store, "drawings", drawing) }
    }
    return [
      {
        method: "POST",
        path: rules.create.path(pathRow),
        body: fields,
        creates: { table: change.table, localId: change.id },
      },
    ]
  }

  const id = await serverId(store, change.table, change.id)

  if (change.op === "DELETE") {
    if (!rules.remove) {
      throw new Refused(`${change.table} rows cannot be deleted offline`)
    }
    return [{ method: "DELETE", path: rules.remove(id) }]
  }

  // PATCH: route each changed column to the endpoint that owns it.
  const requests: ApiRequest[] = []
  const handled = new Set<string>(["updated_at"])
  if (rules.update) {
    const fields = await body(rules, rules.update.fields, data, store, {
      dropNulls: false,
    })
    for (const field of rules.update.fields) handled.add(field)
    if (Object.keys(fields).length > 0) {
      requests.push({
        method: "PUT",
        path: rules.update.path(id),
        body: fields,
      })
    }
  }
  if (change.table === "findings" && "status" in data) {
    handled.add("status")
    handled.add("resolution_notes")
    if (data.status === "resolved") {
      requests.push({
        method: "PATCH",
        path: `/findings/${id}/resolve`,
        body: { resolution_notes: data.resolution_notes ?? null },
      })
    } else {
      requests.push({
        method: "PATCH",
        path: `/findings/${id}/status`,
        body: { status: data.status },
      })
    }
  }
  const unsupported = Object.keys(data).filter((field) => !handled.has(field))
  if (unsupported.length > 0) {
    throw new Refused(
      `Cannot change ${unsupported.join(", ")} on ${change.table} offline`,
    )
  }
  return requests
}

const RETRY_STATUSES = new Set([401, 408, 425, 429])

function detailOf(response: ApiResponse): string {
  const payload = response.body as { detail?: unknown } | undefined
  const detail = payload?.detail
  if (typeof detail === "string") return detail
  if (detail !== undefined) return JSON.stringify(detail)
  return `HTTP ${response.status}`
}

/**
 * Sends one queued change. Resolves "done" or "rejected"; throws
 * `RetryUpload` when the whole queue should wait and try again.
 */
export async function uploadChange(
  change: QueuedChange,
  transport: Transport,
  store: UploadStore,
): Promise<"done" | "rejected"> {
  let requests: ApiRequest[]
  try {
    requests = await planRequests(change, store)
  } catch (error) {
    if (error instanceof Refused) {
      await store.reject(change, 0, error.message)
      return "rejected"
    }
    throw error
  }
  for (const request of requests) {
    // A create that went through before a retry is not sent twice.
    if (
      request.creates &&
      (await store.serverIdFor(
        request.creates.table,
        request.creates.localId,
      )) !== undefined
    ) {
      continue
    }
    let response: ApiResponse
    try {
      response = await transport(request)
    } catch (error) {
      throw new RetryUpload(`Could not reach the server: ${String(error)}`)
    }
    const { status } = response
    if (status >= 200 && status < 300) {
      if (request.creates) {
        const created = (response.body as { id?: unknown } | undefined)?.id
        if (created === undefined || created === null) {
          throw new RetryUpload("The server did not return the new id", status)
        }
        await store.remember(
          request.creates.table,
          request.creates.localId,
          String(created),
        )
      }
      continue
    }
    if (status === 404 && request.method === "DELETE") continue
    if (RETRY_STATUSES.has(status) || status >= 500) {
      throw new RetryUpload(detailOf(response), status)
    }
    await store.reject(change, status, detailOf(response))
    return "rejected"
  }
  return "done"
}
