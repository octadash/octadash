/**
 * The Logs search box, Seq-style: words and "quoted phrases" search the
 * message; `field:value` filters a field or any attribute; numbers compare
 * with > >= < <=; `level>=warn` takes warn and worse; `-` in front of a term
 * negates it; `key:*` asks that an attribute exists and `*` inside a value is
 * a wildcard. Everything is compiled to a WHERE fragment whose values travel
 * as query parameters, never in the SQL text.
 *
 *   level:error "timeout" product:acme-pay
 *   service:payments level>=warn
 *   duration_ms>2000 -http.route:/health
 */

export type LogOp = ':' | '!=' | '>' | '>=' | '<' | '<='

export type LogTerm =
  | { kind: 'text'; value: string; not: boolean }
  | { kind: 'field'; field: string; op: LogOp; value: string; not: boolean }

/** Severity from least to most serious; OpenTelemetry's numbers 1-24 fall in groups of 4. */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

const LEVEL_ALIASES: Record<string, LogLevel> = {
  trace: 'trace',
  verbose: 'trace',
  vrb: 'trace',
  debug: 'debug',
  dbg: 'debug',
  info: 'info',
  inf: 'info',
  information: 'info',
  notice: 'info',
  warn: 'warn',
  wrn: 'warn',
  warning: 'warn',
  error: 'error',
  err: 'error',
  fatal: 'fatal',
  ftl: 'fatal',
  critical: 'fatal',
  crit: 'fatal',
  panic: 'fatal',
}

/** A level word from a query or an SDK (Serilog's "Information", Python's "WARNING"), or null. */
export function levelOf(word: string): LogLevel | null {
  return LEVEL_ALIASES[word.trim().toLowerCase()] ?? null
}

/** The level for OpenTelemetry's severity number, or null for 0 (unset). */
export function levelOfSeverity(n: number): LogLevel | null {
  if (!Number.isFinite(n) || n < 1) return null
  return LOG_LEVELS[Math.min(5, Math.floor((n - 1) / 4))] ?? null
}

const MAX_TERMS = 20
const FIELD = /^([A-Za-z_@][\w.@-]*)(>=|<=|!=|:|>|<|=)(.*)$/s

/** Splits the box into terms, keeping "quoted phrases" whole. */
function tokens(query: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const char of query) {
    if (char === '"') {
      quoted = !quoted
      current += char
    } else if (/\s/.test(char) && !quoted) {
      if (current) out.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) out.push(current)
  return out
}

const unquote = (value: string) =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value.replaceAll('"', '')

export function parseLogQuery(query: string): LogTerm[] {
  const terms: LogTerm[] = []
  for (let token of tokens(query.slice(0, 2000))) {
    let not = false
    if (token.startsWith('-') && token.length > 1) {
      not = true
      token = token.slice(1)
    }
    const field = token.startsWith('"') ? null : token.match(FIELD)
    // "https://..." is a word, not the field "https".
    if (field && !field[3]?.startsWith('//') && field[3] !== '') {
      const op = (field[2] === '=' ? ':' : field[2]) as LogOp
      terms.push({
        kind: 'field',
        field: (field[1] ?? '').toLowerCase() === 'message' ? 'body' : (field[1] ?? ''),
        op,
        value: unquote(field[3] ?? ''),
        not,
      })
    } else {
      const value = unquote(token)
      if (value) terms.push({ kind: 'text', value, not })
    }
    if (terms.length >= MAX_TERMS) break
  }
  return terms
}

export interface CompiledLogQuery {
  /** SQL for the WHERE clause, "1" when the box is empty. Uses parameters q0, q1... */
  where: string
  params: Record<string, unknown>
}

const ATTRIBUTE = (p: string) =>
  `if(mapContains(attributes, {${p}:String}), attributes[{${p}:String}], resource[{${p}:String}])`
const HAS_ATTRIBUTE = (p: string) =>
  `(mapContains(attributes, {${p}:String}) OR mapContains(resource, {${p}:String}))`

const likeOf = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`).replaceAll('*', '%')

/**
 * Compiles the terms against the `logs` table. `products` maps a product's
 * slug to its id for `product:`; an unknown slug matches nothing.
 */
export function compileLogQuery(
  terms: LogTerm[],
  products: Map<string, string> = new Map(),
): CompiledLogQuery {
  const params: Record<string, unknown> = {}
  const parts: string[] = []
  let n = 0
  const param = (value: unknown) => {
    const name = `q${n++}`
    params[name] = value
    return name
  }

  for (const term of terms) {
    let sql: string
    if (term.kind === 'text') {
      sql = `positionCaseInsensitiveUTF8(body, {${param(term.value)}:String}) > 0`
    } else {
      sql = fieldSql(term, param, products)
    }
    parts.push(term.not ? `NOT (${sql})` : `(${sql})`)
  }
  return { where: parts.length > 0 ? parts.join(' AND ') : '1', params }
}

function compare(column: string, op: LogOp, p: string, type: string) {
  const sqlOp = op === ':' ? '=' : op
  return `${column} ${sqlOp} {${p}:${type}}`
}

function fieldSql(
  term: Extract<LogTerm, { kind: 'field' }>,
  param: (value: unknown) => string,
  products: Map<string, string>,
): string {
  const name = term.field.toLowerCase()
  const { op, value } = term

  if (name === 'level' || name === 'severity') {
    const level = levelOf(value)
    if (!level) return '0'
    const rank = LOG_LEVELS.indexOf(level)
    const p = param(rank)
    return compare(
      `indexOf(['trace','debug','info','warn','error','fatal'], level) - 1`,
      op,
      p,
      'Int8',
    )
  }
  if (name === 'product') {
    const id = products.get(value.toLowerCase())
    if (!id) return op === '!=' ? '1' : '0'
    return `project_id ${op === '!=' ? '!=' : '='} {${param(id)}:UUID}`
  }
  if (name === 'trace' || name === 'trace_id' || name === 'traceid') {
    return `trace_id ${op === '!=' ? '!=' : '='} {${param(value.toLowerCase())}:String}`
  }
  if (name === 'span' || name === 'span_id' || name === 'spanid') {
    return `span_id ${op === '!=' ? '!=' : '='} {${param(value.toLowerCase())}:String}`
  }
  if (name === 'body') {
    const sql = `positionCaseInsensitiveUTF8(body, {${param(value)}:String}) > 0`
    return op === '!=' ? `NOT (${sql})` : sql
  }
  const column = name === 'service' || name === 'service.name' ? 'service' : null

  if (op === '>' || op === '>=' || op === '<' || op === '<=') {
    const number = Number(value)
    if (!Number.isFinite(number)) return '0'
    const target = column ?? ATTRIBUTE(param(term.field))
    return compare(`toFloat64OrNull(${target})`, op, param(number), 'Float64')
  }

  const keyParam = column ? null : param(term.field)
  const target = column ?? ATTRIBUTE(keyParam as string)
  if (value === '*') {
    const exists = column ? `${column} != ''` : HAS_ATTRIBUTE(keyParam as string)
    return op === '!=' ? `NOT ${exists}` : exists
  }
  const sql = value.includes('*')
    ? `${target} ILIKE {${param(likeOf(value))}:String}`
    : `${target} = {${param(value)}:String}`
  return op === '!=' ? `NOT (${sql})` : sql
}

/** Product slugs named by `product:` in a query, for checking them before searching. */
export function productsIn(terms: LogTerm[]): string[] {
  return terms.flatMap((t) =>
    t.kind === 'field' && t.field.toLowerCase() === 'product' ? [t.value.toLowerCase()] : [],
  )
}
