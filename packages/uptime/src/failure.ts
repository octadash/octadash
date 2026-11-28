/**
 * What a check records when it fails ("ECONNREFUSED", "HTTP 503", "no ping for
 * 65 min") mapped to a message key, so the panel and the alerts say the same
 * sentence in every language. No Node imports: the panel loads it too.
 */
export type FailureKey =
  | 'timeout'
  | 'refused'
  | 'notFound'
  | 'reset'
  | 'tls'
  | 'notHealth'
  | 'http'
  | 'noPingYet'
  | 'noPingFor'
  | 'private'
  | 'tooManyRedirects'
  | 'other'

export interface Failure {
  key: FailureKey
  values?: Record<string, string>
}

export function failureOf(code: string): Failure {
  if (code === 'timeout') return { key: 'timeout' }
  if (code === 'ECONNREFUSED') return { key: 'refused' }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { key: 'notFound' }
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return { key: 'reset' }
  if (/SSL|CERT|TLS|UNABLE_TO_VERIFY|DEPTH_ZERO/.test(code)) return { key: 'tls', values: { code } }
  if (code === 'not a health answer') return { key: 'notHealth' }
  if (code === 'no ping yet') return { key: 'noPingYet' }
  if (code === 'too many redirects') return { key: 'tooManyRedirects' }
  if (code.includes('private address')) return { key: 'private' }
  const http = /^HTTP (\d{3})$/.exec(code)
  if (http) return { key: 'http', values: { status: http[1] ?? '' } }
  const silence = /^no ping for (\d+) min$/.exec(code)
  if (silence) return { key: 'noPingFor', values: { minutes: silence[1] ?? '' } }
  return { key: 'other', values: { code } }
}
