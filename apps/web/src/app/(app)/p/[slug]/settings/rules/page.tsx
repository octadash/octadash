import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { RulesList } from '@/components/rules-list'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/** Product settings › Alert rules: the organization's rules, each changeable for this product. */
export default async function ProductRulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { org } = await requireOrg()
  const [project, t] = await Promise.all([
    getProjectBySlug(services().db, org.id, slug),
    getTranslations('productSettings.rulesPage'),
  ])
  if (!project) notFound()
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro', { name: project.name })}</p>
      </div>
      <RulesList
        orgId={org.id}
        project={{ id: project.id, slug: project.slug }}
        canEdit={canManage(org.role)}
        heading="h2"
      />
    </>
  )
}
