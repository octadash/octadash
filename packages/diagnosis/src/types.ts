/** What a tool helps answer. One tool can cover several (PostHog does web and product). */
export type ToolCategory = 'web' | 'product' | 'errors' | 'payments' | 'stores' | 'ads'

/** Where on the page a tool was found. */
export type Evidence = 'script' | 'html' | 'bundle' | 'link'

export interface DetectedTool {
  id: string
  name: string
  categories: ToolCategory[]
  evidence: Evidence[]
}

/**
 * Observability levels, in the order a product usually climbs them. Each one
 * answers a question about the product, and each later module of Octadash
 * fills one of them.
 */
export const LEVELS = ['alive', 'used', 'breaking', 'growing', 'earning', 'understood'] as const
export type LevelId = (typeof LEVELS)[number]

/**
 * ok: answered. partial: a tool is there, but the URL alone can't confirm the
 * data. missing: nothing found. unknown: not visible from outside the site.
 */
export type Status = 'ok' | 'partial' | 'missing' | 'unknown'

/** One line of the diagnosis. The UI turns `id` and `params` into a sentence. */
export interface Finding {
  id: string
  status: Status
  params?: Record<string, string | number>
}

export interface LevelResult {
  id: LevelId
  status: Status
  findings: Finding[]
}

export interface TlsInfo {
  validTo: string
  daysLeft: number
  issuer: string | null
  /** The certificate chain is valid for the host name. */
  trusted: boolean
}

export interface HealthInfo {
  path: string
  status: number
  durationMs: number
}

/** Everything the diagnosis learned from outside the site. Stored as JSON. */
export interface DiagnosisReport {
  version: 1
  url: string
  finalUrl: string | null
  reachable: boolean
  httpStatus: number | null
  durationMs: number | null
  error: string | null
  redirects: string[]
  httpsRedirect: boolean | null
  tls: TlsInfo | null
  health: HealthInfo | null
  tools: DetectedTool[]
  levels: LevelResult[]
  /** Levels answered fully or partly, out of LEVELS.length. */
  score: number
}
