import { listGroups, listProjects } from '@octadash/db'
import { FolderIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SettingsHeader } from '@/components/settings-page'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/** Settings › Groups: the saved sets of products in the picker. */
export default async function GroupsPage() {
  const { org } = await requireOrg()
  const { db } = services()
  const [t, groups, products] = await Promise.all([
    getTranslations('settings.groupsPage'),
    listGroups(db, org.id),
    listProjects(db, org.id),
  ])
  const nameOf = new Map(products.map((p) => [p.id, p.name]))
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader title={t('title')} intro={t('intro')} />
      {groups.length === 0 ? (
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderIcon />
            </EmptyMedia>
            <EmptyTitle>
              <h2>{t('emptyTitle')}</h2>
            </EmptyTitle>
            <EmptyDescription>{t('emptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {groups.map((group) => {
            const names = group.project_ids
              .map((id) => nameOf.get(id))
              .filter((name): name is string => Boolean(name))
              .sort((a, b) => a.localeCompare(b))
            return (
              <li key={group.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <FolderIcon className="size-4 text-muted-foreground" aria-hidden />
                <Link href={`/g/${group.slug}`} className="font-medium hover:text-brand">
                  {group.name}
                </Link>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {names.length > 0 ? names.join(', ') : t('noProducts')}
                </span>
                {canManage(org.role) && (
                  <Link
                    href={`/g/${group.slug}/settings`}
                    className="text-sm text-brand hover:underline"
                    aria-label={t('editLabel', { name: group.name })}
                  >
                    {t('edit')}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{t('howToCreate')}</p>
    </div>
  )
}
