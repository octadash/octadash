/** A source of a product in scope, as the source filter lists it. */
export interface ScopeSource {
  id: string
  name: string
  product: string
}

/**
 * The sources of the products in scope, and the one an address chose when it
 * belongs to them: a source of another product never filters anything.
 */
export function scopeSources(
  sources: { id: string; name: string; project_id: string }[],
  projects: { id: string; name: string }[],
  chosen: string | null,
): { sources: ScopeSource[]; source: ScopeSource | null } {
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const list = sources
    .filter((s) => names.has(s.project_id))
    .map((s) => ({ id: s.id, name: s.name, product: names.get(s.project_id) ?? '' }))
  return { sources: list, source: list.find((s) => s.id === chosen) ?? null }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The `source` of an address, when it is an id. */
export function sourceParam(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value
  return v && UUID.test(v) ? v : null
}
