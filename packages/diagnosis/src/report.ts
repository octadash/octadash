import type { Snapshot } from './collect'
import { TOOL_RULES, type ToolRule } from './tools'
import {
  type DetectedTool,
  type DiagnosisReport,
  type Evidence,
  type Finding,
  LEVELS,
  type LevelId,
  type LevelResult,
  type Status,
  type ToolCategory,
} from './types'

/** Below this, a certificate is about to expire and someone should look. */
export const CERT_WARNING_DAYS = 14
/** Home page load time, in ms, considered fast and acceptable. */
export const SPEED_OK_MS = 1500
export const SPEED_SLOW_MS = 4000

/** Finds known tools in the page, its scripts, links and first-party bundles. */
export function detectTools(snapshot: Snapshot, rules: ToolRule[] = TOOL_RULES): DetectedTool[] {
  const sources: [Evidence, string[]][] = [
    ['script', snapshot.scriptUrls],
    ['link', snapshot.linkUrls],
    ['html', [snapshot.html]],
    ['bundle', snapshot.bundles],
  ]
  const found: DetectedTool[] = []
  for (const rule of rules) {
    const evidence = sources
      .filter(([, texts]) => texts.some((text) => rule.pattern.test(text)))
      .map(([kind]) => kind)
    if (evidence.length > 0) {
      found.push({ id: rule.id, name: rule.name, categories: rule.categories, evidence })
    }
  }
  return found
}

function names(tools: DetectedTool[], category: ToolCategory): string {
  return tools
    .filter((tool) => tool.categories.includes(category))
    .map((tool) => tool.name)
    .join(', ')
}

function level(id: LevelId, status: Status, findings: Finding[]): LevelResult {
  return { id, status, findings }
}

function alive(snapshot: Snapshot): LevelResult {
  if (!snapshot.reachable) {
    return level('alive', 'missing', [
      {
        id: 'unreachable',
        status: 'missing',
        params: { error: snapshot.error ?? 'unknown' },
      },
    ])
  }
  const findings: Finding[] = []
  const status = snapshot.httpStatus ?? 0
  findings.push({
    id: 'reachable',
    status: status < 400 ? 'ok' : 'partial',
    params: { status },
  })

  const https = snapshot.finalUrl?.startsWith('https://') ?? false
  findings.push({ id: 'https', status: https ? 'ok' : 'missing' })

  if (https) {
    const tls = snapshot.tls
    findings.push(
      !tls
        ? { id: 'certificate', status: 'unknown' }
        : !tls.trusted || tls.daysLeft < 0
          ? { id: 'certificate_invalid', status: 'missing', params: { days: tls.daysLeft } }
          : tls.daysLeft <= CERT_WARNING_DAYS
            ? { id: 'certificate_expiring', status: 'partial', params: { days: tls.daysLeft } }
            : { id: 'certificate', status: 'ok', params: { days: tls.daysLeft } },
    )
    if (snapshot.httpsRedirect !== null) {
      findings.push({ id: 'https_redirect', status: snapshot.httpsRedirect ? 'ok' : 'missing' })
    }
  }

  const ms = snapshot.durationMs ?? 0
  findings.push({
    id: 'speed',
    status: ms <= SPEED_OK_MS ? 'ok' : ms <= SPEED_SLOW_MS ? 'partial' : 'missing',
    params: { ms },
  })

  findings.push(
    snapshot.health
      ? {
          id: 'health',
          status: 'ok',
          params: { path: snapshot.health.path, ms: snapshot.health.durationMs },
        }
      : { id: 'health', status: 'missing' },
  )

  // The level answers "is it up and safe to open". Speed, the health endpoint and
  // the redirect are advice: they show as findings but do not lower the level.
  const core = findings.filter(
    (f) => ['reachable', 'https'].includes(f.id) || f.id.startsWith('certificate'),
  )
  const levelStatus: Status = core.every((f) => f.status === 'ok' || f.status === 'unknown')
    ? 'ok'
    : 'partial'
  return level('alive', levelStatus, findings)
}

function byCategory(
  id: LevelId,
  tools: DetectedTool[],
  category: ToolCategory,
  foundStatus: Status,
  missingStatus: Status,
): LevelResult {
  const list = names(tools, category)
  const finding: Finding = list
    ? { id: `${id}_found`, status: foundStatus, params: { tools: list } }
    : { id: `${id}_missing`, status: missingStatus }
  return level(id, finding.status, [finding])
}

/** Turns what was read from outside the site into the observability levels. */
export function buildReport(snapshot: Snapshot, tools = detectTools(snapshot)): DiagnosisReport {
  const levels: LevelResult[] = [alive(snapshot)]
  if (!snapshot.reachable) {
    for (const id of LEVELS.slice(1)) {
      levels.push(level(id, 'unknown', [{ id: 'blocked_by_alive', status: 'unknown' }]))
    }
  } else {
    // A web analytics script in the page is proof enough that visits are counted.
    levels.push(byCategory('used', tools, 'web', 'ok', 'missing'))
    // Error tracking often lives only on the server, so "not seen" is not "absent".
    levels.push(byCategory('breaking', tools, 'errors', 'ok', 'missing'))
    // Product analytics is there, but custom events can't be seen from outside.
    levels.push(byCategory('growing', tools, 'product', 'partial', 'missing'))
    // Checkout links or SDKs show the gateway; revenue needs the gateway connected.
    const payments = names(tools, 'payments')
    const stores = names(tools, 'stores')
    const sellers = [payments, stores].filter(Boolean).join(', ')
    levels.push(
      level('earning', sellers ? 'partial' : 'unknown', [
        sellers
          ? { id: 'earning_found', status: 'partial', params: { tools: sellers } }
          : { id: 'earning_unknown', status: 'unknown' },
      ]),
    )
    // Only Octadash itself answers this one, once the other levels have data.
    levels.push(level('understood', 'unknown', [{ id: 'understood_later', status: 'unknown' }]))
  }

  return {
    version: 1,
    url: snapshot.url,
    finalUrl: snapshot.finalUrl,
    reachable: snapshot.reachable,
    httpStatus: snapshot.httpStatus,
    durationMs: snapshot.durationMs,
    error: snapshot.error,
    redirects: snapshot.redirects,
    httpsRedirect: snapshot.httpsRedirect,
    tls: snapshot.tls,
    health: snapshot.health,
    tools,
    levels,
    score: levels.filter((l) => l.status === 'ok' || l.status === 'partial').length,
  }
}
