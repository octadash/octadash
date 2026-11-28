import { listOrgMonitors } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import { DeleteGroupDialog } from '@/components/delete-group-dialog'
import { GroupForm } from '@/components/group-form'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { worstStatus } from '@/lib/monitors'
import { services } from '@/server/context'
import { requireGroup } from '@/server/group'
import { requireManager } from '@/server/session'

export default async function GroupSettingsPage({
  params,
}: {
  params: Promise<{ group: string }>
}) {
  const { group: slug } = await params
  await requireManager()
  const { org, group, allProjects } = await requireGroup(slug)
  const [monitors, t] = await Promise.all([
    listOrgMonitors(services().db, org.id),
    getTranslations(),
  ])
  const statusOf = (projectId: string) =>
    worstStatus(
      monitors.filter((m) => m.project_id === projectId && !m.paused).map((m) => m.status),
    )

  return (
    <>
      <h1 className="font-display text-3xl font-semibold">{group.name}</h1>
      <div className="flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-lg font-semibold">{t('groups.settingsTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('groups.settingsIntro')}</CardDescription>
          </CardHeader>
          <CardContent>
            <GroupForm
              group={{ id: group.id, name: group.name, projectIds: group.project_ids }}
              products={allProjects.map((p) => ({
                id: p.id,
                name: p.name,
                status: statusOf(p.id),
              }))}
              labels={{
                name: t('groups.name'),
                placeholder: t('groups.placeholder'),
                products: t('groups.products'),
                search: t('picker.search'),
                none: t('picker.none'),
                selected: t('groups.selected', { count: '#' }),
              }}
              actions={<SubmitButton className="self-start">{t('common.save')}</SubmitButton>}
            />
          </CardContent>
        </Card>
        <Card className="ring-destructive/40">
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-lg font-semibold">{t('groups.deleteTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('groups.deleteBody')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            <DeleteGroupDialog
              groupId={group.id}
              labels={{
                trigger: t('groups.delete'),
                title: t('groups.deleteDialog', { name: group.name }),
                body: t('groups.deleteBody'),
                cancel: t('common.cancel'),
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
