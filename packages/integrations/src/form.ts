import { z } from 'zod'
import type { Integration } from './types'

/**
 * One input of an integration's settings form, read from its zod schema so a
 * new integration gets its form for free. Labels come from the panel's message
 * files (`channels.fields.<integration>.<key>`); this says only what to draw.
 */
export interface FormField {
  key: string
  type: 'text' | 'number' | 'boolean'
  required: boolean
  /** Stored encrypted and never sent back to the browser. */
  secret: boolean
  default?: string | number | boolean
}

interface JsonProperty {
  type?: string | string[]
  default?: unknown
}

export function formFields(integration: Integration): FormField[] {
  const schema = z.toJSONSchema(integration.config, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, JsonProperty>
    required?: string[]
  }
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).map(([key, property]) => {
    const types = Array.isArray(property.type) ? property.type : [property.type]
    const type = types.includes('boolean')
      ? 'boolean'
      : types.includes('number') || types.includes('integer')
        ? 'number'
        : 'text'
    const field: FormField = {
      key,
      type,
      required: required.has(key) && property.default === undefined,
      secret: integration.secretKeys.includes(key),
    }
    if (
      typeof property.default === 'string' ||
      typeof property.default === 'number' ||
      typeof property.default === 'boolean'
    ) {
      field.default = property.default
    }
    return field
  })
}

/**
 * Splits validated settings into what is stored in the clear and what is
 * stored encrypted. Empty optional values are dropped.
 */
export function splitSecrets(integration: Integration, config: Record<string, unknown>) {
  const plain: Record<string, unknown> = {}
  const secrets: Record<string, string> = {}
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === '') continue
    if (integration.secretKeys.includes(key)) secrets[key] = String(value)
    else plain[key] = value
  }
  return { plain, secrets }
}
