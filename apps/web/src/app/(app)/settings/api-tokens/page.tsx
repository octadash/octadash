import { listApiTokens } from '@octadash/db'
import type { Metadata } from 'next'
import { getFormatter, getTranslations } from 'next-intl/server'
import { NewApiToken, RevokeApiToken } from '@/components/api-tokens'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('apiTokens')
  return { title: t('title') }
}

/**
 * Read-only tokens of the organization: an AI assistant (Claude, Cursor) reads
 * uptime, emergencies, traffic and logs through the MCP server with one.
 */
export default async function ApiTokensPage() {
  const { org } = await requireManager()
  const { db, env } = services()
  const [tokens, t, tc, format] = await Promise.all([
    listApiTokens(db, org.id),
    getTranslations('apiTokens'),
    getTranslations('common'),
    getFormatter(),
  ])
  const mcpUrl = `${env.OCTADASH_URL.replace(/\/+$/, '')}/api/mcp`

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-display text-lg font-semibold">{t('newTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('newIntro', { url: mcpUrl })}</CardDescription>
        </CardHeader>
        <CardContent>
          <NewApiToken
            mcpUrl={mcpUrl}
            labels={{
              name: t('name'),
              nameHint: t('nameHint'),
              namePlaceholder: t('namePlaceholder'),
              create: t('create'),
              token: t('token'),
              once: t('once'),
              command: t('command'),
              copy: tc('copy'),
              copied: tc('copied'),
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-display text-lg font-semibold">{t('listTitle')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {token.name}
                      <code className="text-xs text-muted-foreground">{token.prefix}…</code>
                      {token.revoked_at && <Badge variant="outline">{t('revoked')}</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('meta', {
                        created: format.dateTime(token.created_at, { dateStyle: 'medium' }),
                        by: token.created_by_name ?? '–',
                      })}
                      {' · '}
                      {token.last_used_at
                        ? t('used', { when: format.relativeTime(token.last_used_at) })
                        : t('neverUsed')}
                    </span>
                  </div>
                  {!token.revoked_at && (
                    <RevokeApiToken
                      id={token.id}
                      labels={{
                        trigger: t('revoke'),
                        title: t('revokeTitle', { name: token.name }),
                        body: t('revokeBody'),
                        cancel: tc('cancel'),
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
