import { createHash } from 'node:crypto'

/**
 * What Octadash keeps about a person: never who they are. Ids the app sends
 * are kept as hashes, and properties that look like an e-mail or a document
 * number are dropped at the door, before anything is queued.
 */

/**
 * The person behind an id the app sent (a user id, an e-mail, PostHog's
 * distinct_id), hashed with the product: the same id counts as the same person
 * on phone and laptop, but the stored value says nothing about who it is and
 * differs between products.
 */
export function personId(projectId: string, id: string): string {
  if (!id) return ''
  return createHash('sha256').update(`${projectId}|person|${id}`).digest('hex').slice(0, 32)
}

/** Property names that hold who someone is: a word of the name (user_email, userEmail, phone). */
const PERSONAL_NAME =
  /(^|[_.\-\s])(e-?mail|cpf|cnpj|ssn|passport|passaporte|phone|telefone|celular|whatsapp|password|senha|card_number|credit_card|iban|ip|ip_address|address|endereco)([_.\-\s]|$)/i
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/
/** CPF, CNPJ and US SSN, with or without punctuation; bare 11 or 14 digits. */
const DOCUMENT =
  /^\s*(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}-\d{2}-\d{4})\s*$/
/** PostHog person properties: they exist to hold names and e-mails, and Octadash keeps no profiles. */
const PERSON_PROPERTIES = new Set(['$set', '$set_once', '$unset', '$ip'])

/** camelCase as snake_case, so userEmail reads as user_email. */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2')

/** True for an e-mail or a document number, or a list holding one. */
export function personal(value: unknown): boolean {
  if (typeof value === 'string') return EMAIL.test(value) || DOCUMENT.test(value)
  if (Array.isArray(value)) return value.some(personal)
  return false
}

export interface Cleaned {
  properties: Record<string, unknown>
  /** Names of the properties left out, for the caller to count. */
  dropped: string[]
}

/**
 * Properties without anything that looks personal. Objects are cleaned one
 * level down; values that look like an e-mail or a document number are dropped
 * whatever their name. URLs and other `$` properties of the SDKs are kept,
 * except PostHog's person properties.
 */
export function withoutPersonalData(properties: Record<string, unknown>): Cleaned {
  const dropped: string[] = []
  const clean = (input: Record<string, unknown>, prefix: string, depth: number) => {
    const out: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(input)) {
      const path = prefix + name
      if (PERSON_PROPERTIES.has(name) && depth === 0) {
        dropped.push(path)
        continue
      }
      const sdkProperty = name.startsWith('$')
      if (!sdkProperty && (PERSONAL_NAME.test(words(name)) || personal(value))) {
        dropped.push(path)
        continue
      }
      if (value && typeof value === 'object' && !Array.isArray(value) && depth < 2) {
        out[name] = clean(value as Record<string, unknown>, `${path}.`, depth + 1)
      } else {
        out[name] = value
      }
    }
    return out
  }
  return { properties: clean(properties, '', 0), dropped }
}
