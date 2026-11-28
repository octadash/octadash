import { KeyRoundIcon, PlugIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

/**
 * Which source a block of code belongs to: its name, where it runs and the
 * start of its key, so nobody pastes one source's code into another.
 */
export async function SourceTag({
  name,
  platform,
  publicKey,
}: {
  name: string
  /** "Next.js"; left out when unknown. */
  platform?: string
  publicKey?: string | null
}) {
  const t = await getTranslations('areaStart')
  const labels = { source: t('tagSource'), key: t('tagKey') }
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5">
        <PlugIcon aria-hidden className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">{labels.source}:</span>
        <span className="font-medium">{name}</span>
        {platform && <span className="text-muted-foreground">({platform})</span>}
      </span>
      {publicKey && (
        <span className="flex items-center gap-1.5">
          <KeyRoundIcon aria-hidden className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{labels.key}:</span>
          <code className="font-mono text-xs" title={publicKey}>
            {publicKey.slice(0, 8)}…{publicKey.slice(-4)}
          </code>
        </span>
      )}
    </p>
  )
}
