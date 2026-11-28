import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { parseTvSettings } from '@/lib/tv'
import { requireOrg } from '@/server/session'
import { loadTv } from '@/server/tv'
import { TvScreen } from '@/views/tv-screen'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tv')
  return { title: `${t('title')} · Octadash` }
}

type Search = Promise<Record<string, string | string[] | undefined>>

/** TV mode on a signed-in screen: the settings come in the address. */
export default async function TvPage({ searchParams }: { searchParams: Search }) {
  const { org } = await requireOrg()
  const settings = parseTvSettings(await searchParams)
  const data = await loadTv(org.id, settings)
  return <TvScreen data={data} settings={settings} liveUrl="/api/live" />
}
