import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Encrypts integration credentials (bot tokens, SMTP passwords, API keys) with
 * a key derived from OCTADASH_SECRET. AES-256-GCM: a changed or truncated value
 * fails to decrypt instead of returning garbage. Format: v1.<iv>.<tag>.<data>,
 * base64url, so a future key or cipher can be told apart.
 */
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(`octadash:integrations:${secret}`).digest()
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv, tag, data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

export function decryptSecret(value: string, secret: string): string {
  const [version, iv, tag, data] = value.split('.')
  if (version !== 'v1' || !iv || !tag || data === undefined)
    throw new Error('unknown secret format')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
