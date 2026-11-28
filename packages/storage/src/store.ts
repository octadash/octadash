import { createHash } from 'node:crypto'
import { AwsClient } from 'aws4fetch'

/**
 * File storage: what is too heavy for a ClickHouse row (Sentry attachments,
 * replays, profiles, anything over 1 MB) is kept as a file in an S3-compatible
 * bucket. The bundled one is Garage, started by the compose with a generated
 * key and the bucket already made; an external S3, R2 or any S3-compatible
 * store works the same by changing the STORAGE_* settings.
 *
 * Keys start with the day the file arrived (`files/2026-11-28/<org>/...`), so
 * retention removes whole days and the per-organization prefix sits right
 * after it.
 */
export interface FileStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<Uint8Array | null>
  /** One page of the keys under `prefix`, with their sizes in bytes. */
  list(prefix: string, after?: string): Promise<{ files: StoredFile[]; next?: string }>
  /** The "folders" right under `prefix` (keys cut at the next `/`). */
  folders(prefix: string): Promise<string[]>
  delete(keys: string[]): Promise<void>
  /** Throws when the bucket cannot be reached with these credentials. */
  check(): Promise<void>
}

export interface StoredFile {
  key: string
  size: number
}

export interface S3Config {
  /** http://garage:3900, https://<account>.r2.cloudflarestorage.com, https://s3.us-east-1.amazonaws.com */
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

export class StorageError extends Error {
  override name = 'StorageError'
}

/** The first folder of every key. */
export const FILES_PREFIX = 'files/'

const day = (date: Date) => date.toISOString().slice(0, 10)
const part = (value: string) => value.replace(/[^\w.$-]/g, '_').slice(0, 200) || '_'

/** files/<day>/<org>/<project>/<kind>/<id> */
export function fileKey(received: Date, org: string, project: string, kind: string, id: string) {
  return `${FILES_PREFIX}${day(received)}/${part(org)}/${part(project)}/${part(kind)}/${part(id)}`
}

/** The day a key's folder names, as `YYYY-MM-DD`, or undefined. */
export function dayOfFolder(folder: string): string | undefined {
  const match = /^files\/(\d{4}-\d{2}-\d{2})\/$/.exec(folder)
  return match?.[1]
}

const xmlText = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tags = (xml: string, name: string) =>
  [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1] ?? '')
const tag = (xml: string, name: string) => tags(xml, name)[0]

/** At most this many keys per DeleteObjects call (the S3 limit). */
const DELETE_BATCH = 1000

/** Any S3-compatible store, path-style addresses, signed with SigV4. */
export class S3FileStore implements FileStore {
  private readonly client: AwsClient
  private readonly base: string

  constructor(config: S3Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: 's3',
      retries: 2,
    })
    this.base = `${config.endpoint.replace(/\/+$/, '')}/${encodeURIComponent(config.bucket)}`
  }

  private url(key = '', query?: Record<string, string>) {
    const path = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const url = new URL(key ? `${this.base}/${path}` : this.base)
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value)
    return url.toString()
  }

  private async send(url: string, init: RequestInit, what: string) {
    const res = await this.client.fetch(url, init)
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '')
      throw new StorageError(
        `${what}: ${res.status} ${tag(text, 'Code') ?? ''} ${tag(text, 'Message') ?? ''}`.trim(),
      )
    }
    return res
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    const res = await this.send(
      this.url(key),
      {
        method: 'PUT',
        body: body as unknown as ArrayBuffer,
        headers: { 'content-type': contentType },
      },
      `put ${key}`,
    )
    if (res.status === 404) throw new StorageError(`put ${key}: bucket not found`)
  }

  async get(key: string) {
    const res = await this.send(this.url(key), { method: 'GET' }, `get ${key}`)
    if (res.status === 404) return null
    return new Uint8Array(await res.arrayBuffer())
  }

  async list(prefix: string, after?: string) {
    const query: Record<string, string> = { 'list-type': '2', prefix }
    if (after) query['continuation-token'] = after
    const res = await this.send(this.url('', query), { method: 'GET' }, `list ${prefix}`)
    if (res.status === 404) throw new StorageError(`list ${prefix}: bucket not found`)
    const xml = await res.text()
    const files = tags(xml, 'Contents').map((entry) => ({
      key: xmlText(tag(entry, 'Key') ?? ''),
      size: Number(tag(entry, 'Size') ?? 0),
    }))
    const next = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined
    return next ? { files, next: xmlText(next) } : { files }
  }

  async folders(prefix: string) {
    const out: string[] = []
    let after: string | undefined
    do {
      const query: Record<string, string> = { 'list-type': '2', prefix, delimiter: '/' }
      if (after) query['continuation-token'] = after
      const res = await this.send(this.url('', query), { method: 'GET' }, `list ${prefix}`)
      if (res.status === 404) throw new StorageError(`list ${prefix}: bucket not found`)
      const xml = await res.text()
      for (const entry of tags(xml, 'CommonPrefixes')) out.push(xmlText(tag(entry, 'Prefix') ?? ''))
      after = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined
    } while (after)
    return out
  }

  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += DELETE_BATCH) {
      const batch = keys.slice(i, i + DELETE_BATCH)
      const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${batch
        .map((key) => `<Object><Key>${xmlEscape(key)}</Key></Object>`)
        .join('')}</Delete>`
      // S3 asks for the body's MD5 on DeleteObjects.
      const md5 = createHash('md5').update(body).digest('base64')
      const res = await this.send(
        this.url('', { delete: '' }),
        {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/xml', 'content-md5': md5 },
        },
        'delete',
      )
      const xml = await res.text()
      const failed = tags(xml, 'Error')
      if (failed.length > 0) {
        throw new StorageError(
          `delete: ${failed.length} not removed (${tag(failed[0] ?? '', 'Code') ?? 'error'})`,
        )
      }
    }
  }

  async check() {
    const res = await this.send(this.url(), { method: 'HEAD' }, 'check')
    if (res.status === 404) throw new StorageError('check: bucket not found')
  }
}

/** Files in memory, for tests and for development without a bucket. */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, { body: Uint8Array; contentType: string }>()
  failing = false

  private guard() {
    if (this.failing) throw new StorageError('storage unavailable')
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    this.guard()
    this.files.set(key, { body, contentType })
  }

  async get(key: string) {
    this.guard()
    return this.files.get(key)?.body ?? null
  }

  async list(prefix: string) {
    this.guard()
    const files = [...this.files.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, file]) => ({ key, size: file.body.length }))
    return { files }
  }

  async folders(prefix: string) {
    this.guard()
    const out = new Set<string>()
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue
      const rest = key.slice(prefix.length)
      const cut = rest.indexOf('/')
      if (cut >= 0) out.add(`${prefix}${rest.slice(0, cut + 1)}`)
    }
    return [...out].sort()
  }

  async delete(keys: string[]) {
    this.guard()
    for (const key of keys) this.files.delete(key)
  }

  async check() {
    this.guard()
  }
}

/** Every key under `prefix` removed, page by page. Returns how many and their bytes. */
export async function deletePrefix(store: FileStore, prefix: string) {
  let count = 0
  let bytes = 0
  // Each page is deleted before the next listing, so the listing always starts at the top.
  for (;;) {
    const page = await store.list(prefix)
    if (page.files.length === 0) break
    await store.delete(page.files.map((file) => file.key))
    count += page.files.length
    bytes += page.files.reduce((sum, file) => sum + file.size, 0)
    if (!page.next) break
  }
  return { count, bytes }
}

export interface StorageEnv {
  STORAGE_ENDPOINT?: string | undefined
  STORAGE_BUCKET: string
  STORAGE_REGION: string
  STORAGE_ACCESS_KEY_ID?: string | undefined
  STORAGE_SECRET_ACCESS_KEY?: string | undefined
}

/** The store the settings name, or undefined when none is set. */
export function storageFromEnv(env: StorageEnv): S3FileStore | undefined {
  if (!env.STORAGE_ENDPOINT || !env.STORAGE_ACCESS_KEY_ID || !env.STORAGE_SECRET_ACCESS_KEY) {
    return undefined
  }
  return new S3FileStore({
    endpoint: env.STORAGE_ENDPOINT,
    bucket: env.STORAGE_BUCKET,
    region: env.STORAGE_REGION,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
  })
}
