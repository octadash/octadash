import type { Finding } from '@octadash/diagnosis'

type Translate = (key: string, values?: Record<string, string | number>) => string

/** Findings whose sentence depends on the status (ok, missing...) live in a nested key. */
const BY_STATUS: Record<string, (status: Finding['status']) => string> = {
  https: (s) => (s === 'ok' ? 'ok' : 'missing'),
  certificate: (s) => (s === 'ok' ? 'ok' : 'unknown'),
  https_redirect: (s) => (s === 'ok' ? 'ok' : 'missing'),
  speed: (s) => (s === 'ok' ? 'ok' : 'other'),
  health: (s) => (s === 'ok' ? 'ok' : 'missing'),
}

/** Turns a finding into a sentence. `t` is scoped to `diagnosis.findings`. */
export function findingText(t: Translate, finding: Finding): string {
  const variant = BY_STATUS[finding.id]
  const key = variant ? `${finding.id}.${variant(finding.status)}` : finding.id
  return t(key, finding.params)
}
