import { getTvLink, listGroups, listProjects } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import { parseTvSettings } from '@/lib/tv'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'
import { TvDialog } from './tv-dialog'

/** "TV mode" on the Overview, a group and a product: opens the TV settings. */
export async function TvButton({ scope }: { scope: string }) {
  const { org } = await requireOrg()
  const { db } = services()
  const [groups, projects, link, t] = await Promise.all([
    listGroups(db, org.id),
    listProjects(db, org.id),
    getTvLink(db, org.id),
    getTranslations('tvDialog'),
  ])
  return (
    <TvDialog
      initial={parseTvSettings({ scope })}
      scopes={[
        { value: 'all', label: t('allProducts') },
        ...groups.map((g) => ({ value: `g:${g.slug}`, label: g.name })),
        ...projects.map((p) => ({ value: `p:${p.slug}`, label: p.name })),
      ]}
      link={
        link
          ? {
              by: link.created_by_name,
              createdAt: link.created_at.getTime(),
              lastOpenedAt: link.last_opened_at?.getTime() ?? null,
              settings: parseTvSettings(link.settings as unknown as Record<string, unknown>),
            }
          : null
      }
      manager={canManage(org.role)}
    />
  )
}
