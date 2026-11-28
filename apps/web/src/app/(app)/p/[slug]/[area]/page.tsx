import { getProjectBySlug, isArea } from '@octadash/db'
import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

/** One area of one product. Each area fills this page in its own step of the roadmap. */
export default async function ProductAreaPage({
  params,
}: {
  params: Promise<{ slug: string; area: string }>
}) {
  const { slug, area } = await params
  if (!isArea(area)) notFound()
  const { org } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  const t = await getTranslations()
  const name = t(`areas.${area}.name`)

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="font-display text-3xl font-semibold">{name}</h1>
      <p className="text-muted-foreground">{t('areaPage.soon', { area: name })}</p>
      <Button asChild variant="outline" className="self-start">
        <Link href={`/p/${project.slug}`}>
          <ArrowLeftIcon data-icon="inline-start" />
          {t('areaPage.back', { name: project.name })}
        </Link>
      </Button>
    </div>
  )
}
