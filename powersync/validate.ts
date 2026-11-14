/**
 * Checks the PowerSync configuration without a running service
 * (rebuild increment 18). Run from the frontend directory:
 *
 *   bun run validate:sync
 *
 * 1. powersync/sync-config.yaml compiles with the sync-rules engine the
 *    pinned service image ships (@powersync/service-sync-rules 0.44.0 in
 *    journeyapps/powersync-service:1.27.2) — no errors and no warnings.
 * 2. powersync/service.yaml validates against the service's JSON schema
 *    (@powersync/service-types 0.20.0, the version that image ships) once
 *    every `!env` value is filled with a placeholder.
 *
 * Bun runs this (the engine uses `using` declarations Node 22 lacks).
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { SqlSyncRules } from "@powersync/service-sync-rules"
import { configFile } from "@powersync/service-types"
import Ajv from "ajv"
import YAML from "yaml"

const here = import.meta.dir
let failed = false

const syncYaml = readFileSync(path.join(here, "sync-config.yaml"), "utf8")
const parsed = SqlSyncRules.fromYaml(syncYaml, {
  defaultSchema: "public",
  throwOnError: false,
})
for (const error of parsed.errors) {
  failed = true
  console.error(`sync-config.yaml: ${error.type}: ${error.message}`)
}
if (parsed.errors.length === 0) {
  console.log("sync-config.yaml: compiles, no errors or warnings")
}

const placeholders: Record<string, string> = {
  PS_DATA_SOURCE_URI: "postgresql://replicator:placeholder@db:5432/app",
  PS_DATA_SOURCE_SSLMODE: "disable",
  PS_STORAGE_URI: "postgresql://powersync:placeholder@db:5432/powersync_storage",
  PS_STORAGE_SSLMODE: "disable",
  PS_PORT: "8080",
  PS_AUTH0_JWKS_URI: "https://example.us.auth0.com/.well-known/jwks.json",
  PS_AUTH0_AUDIENCE: "https://api.example.com",
}
const envTag = {
  tag: "!env",
  resolve: (name: string) => {
    if (!(name in placeholders)) {
      failed = true
      console.error(`service.yaml: !env ${name} has no placeholder here`)
      return ""
    }
    return placeholders[name]
  },
}
const serviceYaml = readFileSync(path.join(here, "service.yaml"), "utf8")
const service = YAML.parse(serviceYaml, { customTags: [envTag] })
const ajv = new Ajv({ allErrors: true, strict: false })
const validate = ajv.compile(configFile.PowerSyncConfigJSONSchema)
if (validate(service)) {
  console.log("service.yaml: matches the service config schema")
} else {
  failed = true
  for (const error of validate.errors ?? []) {
    console.error(`service.yaml: ${error.instancePath || "/"} ${error.message}`)
  }
}

if (failed) process.exit(1)
