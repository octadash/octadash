/**
 * Masking for log lines, before they are queued: what looks like a secret, a
 * card number, an e-mail or a document number is replaced with a marker, and
 * the count is kept on the line so the screen can say how many were masked.
 * Logs are for investigating, so the rest of the line stays as sent (unlike
 * Product usage, which drops personal properties whole).
 */

/** Attribute names whose value is always a secret. */
const SECRET_NAME =
  /(^|[_.\-\s])(password|passwd|pwd|senha|secret|token|access_token|refresh_token|api_key|apikey|api-key|authorization|cookie|set-cookie|private_key|client_secret|credential|credentials)([_.\-\s]|$)/i

/** Each pattern and what replaces it. Order matters: keys before e-mails, cards before documents. */
const PATTERNS: [RegExp, string][] = [
  // PEM private keys, whole block.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[key]'],
  // "Bearer <token>" and "Basic <token>" in headers that ended up in a message.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]{8,}=*/g, '$1 [secret]'],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[key]'],
  // Well-known API key shapes: Stripe, GitHub, Slack, AWS, Google, OpenAI, Anthropic, Octadash secrets.
  [
    /\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b|\bsk-(proj-|ant-)?[A-Za-z0-9_-]{20,}|\boct_sk_[A-Za-z0-9]{10,}/g,
    '[key]',
  ],
  // key=value pairs in query strings and connection strings.
  [
    /\b(password|passwd|pwd|secret|token|api_key|apikey|access_token|client_secret)=([^\s&;,"']+)/gi,
    '$1=[secret]',
  ],
  // user:password@ in URLs.
  [/(\/\/[^/\s:@]+):([^/\s@]+)@/g, '$1:[secret]@'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
]

/** 13 to 19 digits, optionally in groups split by spaces or dashes. */
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g
/** CPF and CNPJ with their punctuation, US SSN. Bare digits are left alone: they are usually ids. */
const DOCUMENT =
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{3}-\d{2}-\d{4}\b/g

function luhn(digits: string) {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** The text with secrets and personal data masked, and how many were. */
export function redact(text: string): { text: string; masked: number } {
  let masked = 0
  let out = text
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, (...args) => {
      masked++
      return replacement.replace(/\$(\d)/g, (_, n) => String(args[Number(n)] ?? ''))
    })
  }
  out = out.replace(CARD, (match) => {
    const digits = match.replace(/\D/g, '')
    if (digits.length < 13 || !luhn(digits)) return match
    masked++
    return '[card]'
  })
  out = out.replace(DOCUMENT, () => {
    masked++
    return '[document]'
  })
  return { text: out, masked }
}

const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')

/** Attributes with secret-named values masked whole and the rest passed through `redact`. */
export function redactAttributes(attributes: Record<string, string>): {
  attributes: Record<string, string>
  masked: number
} {
  let masked = 0
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(attributes)) {
    if (value && SECRET_NAME.test(words(name))) {
      out[name] = '[secret]'
      masked++
      continue
    }
    const cleaned = redact(value)
    out[name] = cleaned.text
    masked += cleaned.masked
  }
  return { attributes: out, masked }
}
