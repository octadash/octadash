import { isArea } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireGroup } from '@/server/group'

/** One area across the group's products. Each area fills this page in its own step. */
export default async function GroupAreaPage({
  params,
}: {
  params: Promise<{ group: string; area: string }>
}) {
  const { group: slug, area } = await params
  if (!isArea(area)) notFound()
  const { group } = await requireGroup(slug)
  const t = await getTranslations()
  const name = t(`areas.${area}.name`)
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-3xl font-semibold">{`${name} · ${group.name}`}</h1>
      <p className="text-muted-foreground">{t('areaPage.soonGroup', { area: name })}</p>
    </div>
  )
}
