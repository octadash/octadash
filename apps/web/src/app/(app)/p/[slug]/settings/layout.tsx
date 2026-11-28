import { getProjectBySlug } from '@octadash/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { SettingsNav } from '@/components/settings-nav'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

/** Settings of one product: General, Sources and Alert rules on the left, the page on the right. */
export default async function ProductSettingsLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { org } = await requireOrg()
  const [project, t] = await Promise.all([
    getProjectBySlug(services().db, org.id, slug),
    getTranslations('productSettings'),
  ])
  if (!project) notFound()
  const base = `/p/${project.slug}/settings`
  const link = (href: string) => (chunks: ReactNode) => (
    <Link href={href} className="text-brand underline underline-offset-2">
      {chunks}
    </Link>
  )
  return (
    <div className="flex flex-col gap-8 md:flex-row">
      <SettingsNav
        search={false}
        labels={{ nav: t('nav') }}
        sections={[
          {
            title: project.name,
            items: [
              { href: base, label: t('general'), exact: true },
              { href: `${base}/sources`, label: t('sources') },
              { href: `${base}/rules`, label: t('rules') },
            ],
          },
        ]}
        footer={t.rich('footer', {
          uptime: link(`/p/${project.slug}/uptime`),
          settings: link('/settings'),
        })}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  )
}
