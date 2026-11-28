/**
 * What an API token may touch, resource by resource, as PostHog's API keys do:
 * the owner picks no access, read or write for each, and delete is a separate
 * permission, off unless chosen. The MCP server only lists the tools a token's
 * scopes allow. A resource added later starts as no access on old tokens.
 */

export const TOKEN_RESOURCES = [
  'products',
  'sources',
  'keys',
  'monitors',
  'alerts',
  'traffic',
  'usage',
  'key_events',
  'errors',
  'logs',
  'money',
  'costs',
  'settings',
] as const
export type TokenResource = (typeof TOKEN_RESOURCES)[number]

export const TOKEN_LEVELS = ['none', 'read', 'write'] as const
export type TokenLevel = (typeof TOKEN_LEVELS)[number]

export interface TokenScopes {
  levels: Partial<Record<TokenResource, TokenLevel>>
  /** Resources it may delete from; each also needs write. */
  delete: TokenResource[]
}

const every = (level: TokenLevel) =>
  Object.fromEntries(TOKEN_RESOURCES.map((r) => [r, level])) as Record<TokenResource, TokenLevel>

/** Ready-made choices on the new-token form; each item can still be changed. */
export const TOKEN_PRESETS = {
  /** Asks about everything, changes nothing. */
  read: { levels: every('read'), delete: [] },
  /** What the octadash-setup skill needs: adds products and sources, reads their keys. */
  setup: {
    levels: { ...every('read'), products: 'write', sources: 'write' },
    delete: [],
  },
} as const satisfies Record<string, TokenScopes>
export type TokenPreset = keyof typeof TOKEN_PRESETS

const isResource = (value: unknown): value is TokenResource =>
  (TOKEN_RESOURCES as readonly unknown[]).includes(value)
const order = (r: TokenResource) => TOKEN_RESOURCES.indexOf(r)
const isLevel = (value: unknown): value is TokenLevel =>
  (TOKEN_LEVELS as readonly unknown[]).includes(value)

/** Scopes from anything (a form, the database), keeping only what is valid. */
export function cleanScopes(value: unknown): TokenScopes {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as {
    levels?: unknown
    delete?: unknown
  }
  // Always in TOKEN_RESOURCES order, so two equal scopes compare equal as JSON.
  const levels: TokenScopes['levels'] = {}
  const given = (typeof raw.levels === 'object' && raw.levels !== null ? raw.levels : {}) as Record<
    string,
    unknown
  >
  for (const resource of TOKEN_RESOURCES) {
    const level = given[resource]
    if (isLevel(level) && level !== 'none') levels[resource] = level
  }
  const deletes = Array.isArray(raw.delete)
    ? [...new Set(raw.delete.filter(isResource))].filter((r) => levels[r] === 'write')
    : []
  return { levels, delete: deletes.sort((a, b) => order(a) - order(b)) }
}

/** Whether the scopes allow reading, writing or deleting a resource. Write implies read. */
export function allows(
  scopes: TokenScopes,
  resource: TokenResource,
  need: 'read' | 'write' | 'delete',
): boolean {
  const level = scopes.levels[resource] ?? 'none'
  if (need === 'read') return level === 'read' || level === 'write'
  if (need === 'write') return level === 'write'
  return level === 'write' && scopes.delete.includes(resource)
}

/** True when nothing is allowed: such a token is refused. */
export function isEmptyScopes(scopes: TokenScopes): boolean {
  return Object.keys(scopes.levels).length === 0
}

/** The preset these scopes are, or null when they were changed item by item. */
export function presetOf(scopes: TokenScopes): TokenPreset | null {
  const mine = JSON.stringify(cleanScopes(scopes))
  for (const name of Object.keys(TOKEN_PRESETS) as TokenPreset[]) {
    if (JSON.stringify(cleanScopes(TOKEN_PRESETS[name])) === mine) return name
  }
  return null
}
