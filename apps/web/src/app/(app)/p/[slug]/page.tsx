import {
  getProjectBySlug,
  listMonitors,
  listProjectAreas,
  type ProjectAreaState,
} from '@octadash/db'
import { ArrowRightIcon, KeyRoundIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { dismissAreaAction, restoreAreaAction } from '@/actions/areas'
import { StatusDot } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { AREA_ITEMS } from '@/lib/areas'
import { cn } from '@/lib/utils'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'
import {
  formatUptime,
  type ProductUptime,
  productUptime,
  safeMonitorStats,
} from '@/server/uptime-view'

type AreaItem = (typeof AREA_ITEMS)[number]

/**
 * The product's overview: one card per area. An area not set up says what it
 * is for and how it connects; once set up it shows a blurred example until
 * data arrives. Areas the owner won't use wait in a folded list.
 */
export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db, clickhouse } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const [areaStates, monitors, t] = await Promise.all([
    listProjectAreas(db, org.id, project.id),
    listMonitors(db, org.id, project.id),
    getTranslations(),
  ])
  const stats = await safeMonitorStats(
    clickhouse,
    org.id,
    monitors.map((m) => m.id),
  )
  const uptime = monitors.length > 0 ? productUptime(monitors, stats) : null
  // Uptime is set up when it has monitors, whatever was stored before.
  const states = new Map(areaStates)
  if (uptime) states.set('uptime', 'set_up')
  else if (states.get('uptime') === 'set_up') states.delete('uptime')
  const manager = canManage(org.role)
  const inUse = AREA_ITEMS.filter((area) => states.get(area.id) !== 'dismissed')
  const dismissed = AREA_ITEMS.filter((area) => states.get(area.id) === 'dismissed')
  const toSetUp = inUse.filter((area) => !states.has(area.id)).length

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{project.name}</h1>
          <p className="text-sm text-muted-foreground">{t('productPage.summary', { toSetUp })}</p>
        </div>
        <Button asChild variant="outline" size="lg">
          <Link href={`/p/${project.slug}/settings`}>
            <KeyRoundIcon data-icon="inline-start" />
            {t('productPage.keysAndSettings')}
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
        {inUse.map((area) => (
          <AreaCard
            key={area.id}
            area={area}
            state={states.get(area.id)}
            slug={project.slug}
            manager={manager}
            uptime={area.id === 'uptime' ? uptime : null}
            t={t}
          />
        ))}
      </div>

      {dismissed.length > 0 && (
        <details className="group rounded-xl border border-border">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-muted-foreground hover:text-foreground">
            {t('productPage.alsoAvailable')} ({dismissed.length})
          </summary>
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {dismissed.map((area) => (
              <li key={area.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <area.icon className="size-4 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{t(`areas.${area.id}.name`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`areas.${area.id}.body`)}
                  </span>
                </div>
                {manager && (
                  <form action={restoreAreaAction}>
                    <input type="hidden" name="slug" value={project.slug} />
                    <input type="hidden" name="area" value={area.id} />
                    <Button type="submit" variant="outline">
                      {t('productPage.useAgain')}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function AreaCard({
  area,
  state,
  slug,
  manager,
  uptime,
  t,
}: {
  area: AreaItem
  state: ProjectAreaState | undefined
  slug: string
  manager: boolean
  uptime: ProductUptime | null
  t: Awaited<ReturnType<typeof getTranslations>>
}) {
  const setUp = state === 'set_up'
  if (uptime) {
    const statusText = {
      up: t('uptime.statusUp'),
      down: t('uptime.statusDown'),
      unknown: t('uptime.statusUnknown'),
      none: t('uptime.statusPaused'),
    }[uptime.status]
    return (
      <section
        className={cn(
          'flex flex-col gap-4 rounded-xl border bg-card p-5 md:min-h-72',
          uptime.status === 'down' ? 'border-error/60' : 'border-border',
        )}
      >
        <header className="flex items-center gap-2.5">
          <area.icon className="size-4 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold">{t(`areas.${area.id}.name`)}</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {t('uptime.monitors', { count: uptime.monitors })}
          </span>
        </header>
        <div className="flex flex-col gap-1">
          <span className="font-display text-4xl font-semibold tabular-nums">
            {formatUptime(uptime.uptime)}
          </span>
          <span className="text-xs text-muted-foreground">{t('uptime.uptime30')}</span>
        </div>
        <p className="flex items-center gap-2 text-sm">
          <StatusDot status={uptime.status} />
          {statusText}
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t('uptime.response')}</dt>
            <dd className="font-medium tabular-nums">
              {uptime.medianMs === null ? '–' : `${uptime.medianMs} ms`}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('uptime.certificate')}</dt>
            <dd
              className={cn(
                'font-medium tabular-nums',
                uptime.certDays !== null && uptime.certDays <= 14 && 'text-warn',
              )}
            >
              {uptime.certDays === null ? '–' : t('uptime.certDays', { count: uptime.certDays })}
            </dd>
          </div>
        </dl>
        <Button asChild variant="outline" className="mt-auto self-start">
          <Link href={`/p/${slug}/uptime`}>
            {t('uptime.openArea')}
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </section>
    )
  }
  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-xl p-5 md:min-h-72',
        setUp ? 'border border-border bg-card' : 'border border-dashed border-input bg-card/50',
      )}
    >
      <header className="flex items-center gap-2.5">
        <area.icon className="size-4 text-muted-foreground" />
        <h2 className="font-display text-lg font-semibold">{t(`areas.${area.id}.name`)}</h2>
      </header>
      {setUp ? (
        <div className="relative flex flex-1 flex-col justify-end">
          <div aria-hidden className="flex flex-1 items-end gap-1.5 blur-[3px]">
            {[40, 62, 48, 75, 55, 82, 68, 90, 72, 60].map((h) => (
              <span key={h} className="flex-1 rounded-sm bg-brand/30" style={{ height: `${h}%` }} />
            ))}
          </div>
          <span className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
            {t('productPage.example')}
          </span>
        </div>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-foreground/85">{t(`areas.${area.id}.body`)}</p>
          <p className="text-sm text-muted-foreground">{t(`areas.${area.id}.how`)}</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button asChild size="lg" className="px-4">
              <Link href={`/p/${slug}/${area.id}`}>{t('productPage.setUp')}</Link>
            </Button>
            {manager && (
              <form action={dismissAreaAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="area" value={area.id} />
                <Button type="submit" variant="ghost" size="lg" className="text-muted-foreground">
                  {t('productPage.wontUse')}
                </Button>
              </form>
            )}
          </div>
        </>
      )}
    </section>
  )
}
