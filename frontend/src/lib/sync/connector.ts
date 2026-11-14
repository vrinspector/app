/**
 * PowerSync backend connector (rebuild increment 18).
 *
 * - `fetchCredentials`: the Auth0 access token the API already accepts. The
 *   PowerSync service checks it against the tenant's JWKS and the API
 *   audience, and its `sub` decides which projects sync (sync-config.yaml).
 * - `uploadData`: replays the local upload queue, one transaction at a time,
 *   against the existing `/api/v1/` endpoints (upload.ts).
 */
import type {
  CommonPowerSyncDatabase,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
} from "@powersync/common"

import {
  type ApiRequest,
  type QueuedChange,
  type Transport,
  type UploadStore,
  uploadChange,
} from "./upload"

/** The slice of the database the store needs (kept small for tests). */
export interface SqlRunner {
  execute(sql: string, params?: unknown[]): Promise<unknown>
  getOptional<T>(sql: string, params?: unknown[]): Promise<T | null>
}

export function sqlUploadStore(db: SqlRunner): UploadStore {
  return {
    async serverIdFor(table, localId) {
      const row = await db.getOptional<{ server_id: string }>(
        "SELECT server_id FROM local_id_map WHERE table_name = ? AND local_id = ?",
        [table, localId],
      )
      return row?.server_id ?? undefined
    },
    async remember(table, localId, serverId) {
      await db.execute(
        "INSERT INTO local_id_map (id, table_name, local_id, server_id, created_at) " +
          "VALUES (uuid(), ?, ?, ?, ?)",
        [table, localId, serverId, new Date().toISOString()],
      )
    },
    async reject(change, status, detail) {
      const payload = JSON.stringify(change.opData ?? {})
      await db.execute(
        // Once per change: a retried queue meets the same refusal again.
        "INSERT INTO upload_rejections " +
          "(id, table_name, op, row_id, http_status, detail, payload, created_at) " +
          "SELECT uuid(), ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (" +
          "SELECT 1 FROM upload_rejections WHERE table_name = ? AND op = ? " +
          "AND row_id = ? AND payload = ?)",
        [
          change.table,
          change.op,
          change.id,
          status,
          detail,
          payload,
          new Date().toISOString(),
          change.table,
          change.op,
          change.id,
          payload,
        ],
      )
    },
  }
}

export type TokenSource = () => Promise<string | undefined>

export function fetchTransport(
  apiBase: string,
  getToken: TokenSource,
  fetchImpl: typeof fetch = fetch,
): Transport {
  const base = `${apiBase.replace(/\/+$/, "")}/api/v1`
  return async (request: ApiRequest) => {
    const token = await getToken()
    const headers: Record<string, string> = { Accept: "application/json" }
    if (token) headers.Authorization = `Bearer ${token}`
    if (request.body !== undefined) headers["Content-Type"] = "application/json"
    const response = await fetchImpl(`${base}${request.path}`, {
      method: request.method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
    })
    let body: unknown
    const text = await response.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = { detail: text.slice(0, 500) }
      }
    }
    return { status: response.status, body }
  }
}

export class VriConnector implements PowerSyncBackendConnector {
  constructor(
    private readonly endpoint: string,
    private readonly getToken: TokenSource,
    private readonly transport: Transport,
  ) {}

  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const token = await this.getToken()
    if (!token) return null
    return { endpoint: this.endpoint, token }
  }

  async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
    const store = sqlUploadStore(database)
    for (;;) {
      const transaction = await database.getNextCrudTransaction()
      if (!transaction) return
      for (const entry of transaction.crud) {
        const change: QueuedChange = {
          table: entry.table,
          op: entry.op as QueuedChange["op"],
          id: entry.id,
          opData: entry.opData,
        }
        await uploadChange(change, this.transport, store)
      }
      await transaction.complete()
    }
  }
}
