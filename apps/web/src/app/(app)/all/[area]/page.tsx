import { isArea } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireOrg } from '@/server/session'

/** One area across every product. Each area fills this page in its own step of the roadmap. */
export default async function AllAreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area } = await params
  if (!isArea(area)) notFound()
  await requireOrg()
  const t = await getTranslations()
  const name = t(`areas.${area}.name`)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-3xl font-semibold">{name}</h1>
      <p className="text-muted-foreground">{t('areaPage.soonAll', { area: name })}</p>
    </div>
  )
}
