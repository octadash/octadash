import { allows, listApiTokens, presetOf, TOKEN_RESOURCES, type TokenScopes } from '@octadash/db'
import { KeyRoundIcon } from 'lucide-react'
import type { Metadata } from 'next'
import { getFormatter, getTranslations } from 'next-intl/server'
import { NewApiToken, RevokeApiToken } from '@/components/api-tokens'
import { SettingsHeader } from '@/components/settings-page'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('apiTokens')
  return { title: t('title') }
}

/**
 * Tokens of the organization: an AI assistant (Claude, Cursor) reads uptime,
 * emergencies, traffic and logs through the MCP server with one, and a setup
 * token also lets it put Octadash in a project.
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
  const accessLabel = (scopes: TokenScopes) => {
    const preset = presetOf(scopes)
    return preset ? t(`presets.${preset}`) : t('customBadge')
  }
  const writes = (scopes: TokenScopes) => TOKEN_RESOURCES.filter((r) => allows(scopes, r, 'write'))
  const mcpUrl = `${env.OCTADASH_URL.replace(/\/+$/, '')}/api/mcp`

  const newToken = (
    <NewApiToken
      mcpUrl={mcpUrl}
      labels={{
        title: t('newTitle'),
        intro: t('newIntro', { url: mcpUrl }),
        name: t('name'),
        nameHint: t('nameHint'),
        namePlaceholder: t('namePlaceholder'),
        access: t('access'),
        accessHint: t('accessHint'),
        presets: { read: t('presets.read'), setup: t('presets.setup') },
        custom: t('custom'),
        resource: t('resource'),
        level: t('level'),
        levels: { none: t('levels.none'), read: t('levels.read'), write: t('levels.write') },
        delete: t('delete'),
        deleteHint: t('deleteHint'),
        resources: Object.fromEntries(
          TOKEN_RESOURCES.map((r) => [r, t(`resources.${r}`)]),
        ) as Record<(typeof TOKEN_RESOURCES)[number], string>,
        create: t('create'),
        nothing: t('nothing'),
        once: t('once'),
        cancel: tc('cancel'),
        done: t('done'),
      }}
    />
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader
        title={t('title')}
        intro={t('intro')}
        action={tokens.length > 0 ? newToken : undefined}
      />

      {tokens.length === 0 ? (
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>
              <h2>{t('emptyTitle')}</h2>
            </EmptyTitle>
            <EmptyDescription>{t('emptyBody', { url: mcpUrl })}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{newToken}</EmptyContent>
        </Empty>
      ) : (
        <section
          aria-labelledby="tokens-count"
          className="flex flex-col rounded-xl border border-border bg-card"
        >
          <h2 id="tokens-count" className="border-b border-border px-4 py-3 text-sm font-semibold">
            {t('count', { count: tokens.length })}
          </h2>
          <ul className="divide-y divide-border">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {token.name}
                    <code className="text-xs text-muted-foreground">{token.prefix}…</code>
                    <Badge variant="secondary">{accessLabel(token.scopes)}</Badge>
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
                  {writes(token.scopes).length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t('writes', {
                        items: format.list(
                          writes(token.scopes).map((r) =>
                            token.scopes.delete.includes(r)
                              ? t('withDelete', { item: t(`resources.${r}`) })
                              : t(`resources.${r}`),
                          ),
                          { type: 'conjunction' },
                        ),
                      })}
                    </span>
                  )}
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
        </section>
      )}
    </div>
  )
}
