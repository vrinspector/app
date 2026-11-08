/*
 * Display formatting shared by the screens. The legacy SPA used
 * `toLocaleDateString()` for card dates; these keep that (device locale) and
 * never throw on a missing or malformed value.
 */

export function formatDate(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString()
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

/**
 * Case-insensitive "contains" over the text of a card, as the legacy
 * `filterCards` did with its `data-filter` attribute. Empty query matches.
 */
export function matchesFilter(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((field) => (field ?? "").toLowerCase().includes(q))
}

/** `"a"`, `"b"` → `"a — b"`; blanks are dropped. */
export function joinMeta(
  ...parts: Array<string | null | undefined | false>
): string {
  return parts.filter((part): part is string => !!part).join(" — ")
}
