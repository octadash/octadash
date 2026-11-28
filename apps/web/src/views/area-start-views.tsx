import { DEFAULT_LOG_RETENTION_DAYS, listKeyEvents, logRetention } from '@octadash/db'
import {
  BotIcon,
  FilterIcon,
  GaugeIcon,
  LinkIcon,
  RouteIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldIcon,
  UserRoundCheckIcon,
} from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { KeyEventsForm } from '@/components/key-events-form'
import { LogsInstall } from '@/components/logs-install'
import { TrafficInstall } from '@/components/traffic-install'
import { UsageInstall } from '@/components/usage-install'
import { logTabOf } from '@/lib/logs-setup'
import { isTrafficPlatform } from '@/lib/traffic-setup'
import { tabOf } from '@/lib/usage-setup'
import { services } from '@/server/context'
import {
  AreaStartShell,
  type ProductAreaSetup,
  SourceAreaExample,
  sourceAreaStep,
} from './area-start'

interface StartProps {
  orgId: string
  product: { name: string; slug: string }
  setup: ProductAreaSetup
}

/** Traffic of one product before the first page view. */
export async function TrafficStartView({ orgId, product, setup }: StartProps) {
  const ingest = services().env.OCTADASH_INGEST_URL
  const { step, manager } = await sourceAreaStep({
    area: 'traffic',
    orgId,
    slug: product.slug,
    setup,
    waiting: (source, _project, canEdit) => {
      return (
        <TrafficInstall
          key={source.id}
          slug={product.slug}
          sourceId={source.id}
          ingestUrl={ingest}
          publicKey={source.public_key}
          platform={isTrafficPlatform(source.platform) ? source.platform : 'html'}
          persistent={source.visitor_mode === 'persistent'}
          manager={canEdit}
          trafficHref={`/p/${product.slug}/traffic`}
        />
      )
    },
  })
  return (
    <AreaStartShell
      area="traffic"
      slug={product.slug}
      setup={setup}
      manager={manager}
      icons={[ShieldCheckIcon, RouteIcon, BotIcon]}
      step={step}
      example={<SourceAreaExample area="traffic" />}
    />
  )
}

/** Product usage of one product before the first event. */
export async function UsageStartView({ orgId, product, setup }: StartProps) {
  const { db, env } = services()
  const { step, manager } = await sourceAreaStep({
    area: 'usage',
    orgId,
    slug: product.slug,
    setup,
    waiting: async (source, project, canEdit) => {
      const [keys, t] = await Promise.all([
        listKeyEvents(db, orgId, [project.id]),
        getTranslations('usageSetup'),
      ])
      return (
        <UsageInstall
          key={source.id}
          sourceId={source.id}
          ingestUrl={env.OCTADASH_INGEST_URL}
          publicKey={source.public_key}
          hasScript={source.areas.includes('traffic')}
          tab={tabOf(source.platform)}
          usageHref={`/p/${product.slug}/usage`}
          keyEvents={
            <KeyEventsForm
              slug={product.slug}
              events={keys.map((k) => ({
                event: k.event,
                count: 0,
                normal: t('inWeek', { count: 0 }),
              }))}
              keys={keys.map((k) => k.event)}
              canEdit={canEdit}
            />
          }
        />
      )
    },
  })
  return (
    <AreaStartShell
      area="usage"
      slug={product.slug}
      setup={setup}
      manager={manager}
      icons={[GaugeIcon, FilterIcon, UserRoundCheckIcon]}
      step={step}
      example={<SourceAreaExample area="usage" />}
    />
  )
}

/** Logs of one product before the first line. */
export async function LogsStartView({ orgId, product, setup }: StartProps) {
  const { db, env } = services()
  const { step, manager } = await sourceAreaStep({
    area: 'logs',
    orgId,
    slug: product.slug,
    setup,
    waiting: async (source, project, canEdit) => {
      const retention = await logRetention(db, [project.id])
      return (
        <LogsInstall
          key={source.id}
          slug={product.slug}
          sourceId={source.id}
          ingestUrl={env.OCTADASH_INGEST_URL}
          publicKey={source.public_key}
          tab={logTabOf(source.platform)}
          service={product.slug}
          retention={retention.get(project.id) ?? DEFAULT_LOG_RETENTION_DAYS}
          bytesPerDay={0}
          canEdit={canEdit}
          logsHref={`/p/${product.slug}/logs`}
        />
      )
    },
  })
  return (
    <AreaStartShell
      area="logs"
      slug={product.slug}
      setup={setup}
      manager={manager}
      icons={[SearchIcon, LinkIcon, ShieldIcon]}
      step={step}
      example={<SourceAreaExample area="logs" />}
    />
  )
}
