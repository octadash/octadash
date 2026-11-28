import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createApiToken,
  findApiToken,
  isApiToken,
  listApiTokens,
  revokeApiToken,
} from './api-tokens'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { TOKEN_PRESETS } from './token-scopes'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000003a1'
const other = '00000000-0000-4000-8000-0000000003a2'

describe.skipIf(!url)('API tokens (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('api_token').where('org_id', 'in', [org, other]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('api_token').where('org_id', 'in', [org, other]).execute()
    await pool.end()
  })

  it('finds the organization of a working token, keeps only a hash, and stops a revoked one', async () => {
    const token = await createApiToken(db, org, null, 'Claude', TOKEN_PRESETS.read)
    expect(isApiToken(token)).toBe(true)
    expect(await findApiToken(db, token)).toMatchObject({
      orgId: org,
      scopes: { levels: { logs: 'read' } },
    })
    expect(await findApiToken(db, `${token.slice(0, -1)}x`)).toBeNull()
    expect(await findApiToken(db, 'not a token')).toBeNull()

    const [row] = await listApiTokens(db, org)
    expect(row?.name).toBe('Claude')
    expect(row?.prefix).toBe(token.slice(0, 8))
    expect(row?.last_used_at).toBeInstanceOf(Date)
    const stored = await db.selectFrom('api_token').select('token_hash').execute()
    expect(stored.map((r) => r.token_hash)).not.toContain(token)

    // Another organization cannot revoke it.
    await revokeApiToken(db, other, row?.id ?? '')
    expect(await findApiToken(db, token)).toMatchObject({ orgId: org })
    await revokeApiToken(db, org, row?.id ?? '')
    expect(await findApiToken(db, token)).toBeNull()
    expect((await listApiTokens(db, org))[0]?.revoked_at).toBeInstanceOf(Date)
  })

  it('keeps what each token may touch', async () => {
    const token = await createApiToken(db, org, null, 'Claude Code', {
      levels: { products: 'write', logs: 'read' },
      delete: ['products'],
    })
    expect((await findApiToken(db, token))?.scopes).toEqual({
      levels: { products: 'write', logs: 'read' },
      delete: ['products'],
    })
  })
})
