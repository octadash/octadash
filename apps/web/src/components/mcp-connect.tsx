'use client'

import { CheckIcon, CopyIcon, ExternalLinkIcon, KeyRoundIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { CopyField } from './copy-field'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

const APPS = ['claude', 'chatgpt', 'cursor', 'vscode', 'terminal'] as const
type App = (typeof APPS)[number]

/** Steps each app's tab shows, in order; keys under apiTokens.connect.<app>. */
const STEPS: Record<App, number> = { claude: 5, chatgpt: 5, cursor: 2, vscode: 2, terminal: 2 }

/**
 * After a token is made: how to plug it into the app the person uses. Most
 * people never open a terminal, so the first thing is a message to paste in
 * any AI chat, which explains itself and asks the assistant to guide them;
 * then a tab per app with plain steps. Claude and ChatGPT take only an
 * address, so theirs carries the token.
 */
export function McpConnect({ mcpUrl, token }: { mcpUrl: string; token: string }) {
  const t = useTranslations('apiTokens.connect')
  const [copied, setCopied] = useState(false)
  const urlWithToken = `${mcpUrl}/${token}`
  const header = `Bearer ${token}`
  const terminal = `claude mcp add --transport http octadash ${mcpUrl} --header "Authorization: ${header}"`
  const cursorConfig = { url: mcpUrl, headers: { Authorization: header } }
  const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=octadash&config=${encodeURIComponent(
    btoa(JSON.stringify(cursorConfig)),
  )}`
  const vscodeLink = `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: 'octadash', type: 'http', ...cursorConfig }),
  )}`
  const message = t('message', { url: mcpUrl, token, urlWithToken, command: terminal })
  const copy = { copyLabel: t('copy'), copiedLabel: t('copied') }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{t('what')}</p>

      <section className="flex flex-col gap-3 rounded-lg border border-brand/40 bg-brand/5 p-4">
        <h3 className="text-sm font-semibold">{t('easyTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('easyBody')}</p>
        <Button
          type="button"
          className="self-start"
          onClick={async () => {
            await navigator.clipboard.writeText(message)
            setCopied(true)
            setTimeout(() => setCopied(false), 2500)
          }}
        >
          {copied ? (
            <CheckIcon data-icon="inline-start" aria-hidden />
          ) : (
            <CopyIcon data-icon="inline-start" aria-hidden />
          )}
          <span aria-live="polite">{copied ? t('messageCopied') : t('copyMessage')}</span>
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t('byAppTitle')}</h3>
        <Tabs defaultValue="claude" className="gap-3">
          <TabsList
            aria-label={t('byAppTitle')}
            className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
          >
            {APPS.map((app) => (
              <TabsTrigger key={app} value={app} className="h-8 flex-none px-2.5">
                {t(`${app}.tab`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {APPS.map((app) => (
            <TabsContent key={app} value={app} className="flex flex-col gap-3">
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
                {Array.from({ length: STEPS[app] }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed steps in a fixed order
                  <li key={i}>{t(`${app}.step${i + 1}`)}</li>
                ))}
              </ol>
              {(app === 'claude' || app === 'chatgpt') && (
                <CopyField value={urlWithToken} label={t('urlWithToken')} {...copy} />
              )}
              {app === 'cursor' && (
                <Button asChild variant="outline" className="self-start">
                  <a href={cursorLink}>
                    <ExternalLinkIcon data-icon="inline-start" aria-hidden />
                    {t('cursor.button')}
                  </a>
                </Button>
              )}
              {app === 'vscode' && (
                <Button asChild variant="outline" className="self-start">
                  <a href={vscodeLink}>
                    <ExternalLinkIcon data-icon="inline-start" aria-hidden />
                    {t('vscode.button')}
                  </a>
                </Button>
              )}
              {app === 'terminal' && <CopyField value={terminal} multiline {...copy} />}
              <p className="text-xs text-muted-foreground">{t(`${app}.note`)}</p>
            </TabsContent>
          ))}
        </Tabs>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRoundIcon aria-hidden className="size-4 text-brand" />
          {t('tokenTitle')}
        </h3>
        <CopyField value={token} label={t('tokenTitle')} {...copy} />
        <p className="text-xs text-muted-foreground">{t('tokenNote')}</p>
      </section>
    </div>
  )
}
