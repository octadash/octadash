import { openTvLink } from '@octadash/db'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { parseTvSettings, TV_DEFAULTS } from '@/lib/tv'
import { services } from '@/server/context'
import { loadTv } from '@/server/tv'
import { TvScreen } from '@/views/tv-screen'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tv')
  // A private link is never indexed, even if it leaks.
  return { title: `${t('title')} · Octadash`, robots: { index: false, follow: false } }
}

/**
 * TV mode from a private link, for a TV that is not signed in: this screen
 * only, read only. A stopped or unknown link shows a blank screen that says so.
 */
export default async function TvLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const link = await openTvLink(services().db, token)
  if (!link) {
    return <TvScreen data={null} settings={TV_DEFAULTS} liveUrl="" stopped />
  }
  const settings = parseTvSettings(link.settings as unknown as Record<string, unknown>)
  const data = await loadTv(link.orgId, settings)
  return (
    <TvScreen
      data={data}
      settings={settings}
      liveUrl={`/api/live?tv=${encodeURIComponent(token)}`}
    />
  )
}
