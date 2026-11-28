import {
  ActivityIcon,
  BellRingIcon,
  CalendarClockIcon,
  ChartPieIcon,
  CircleDollarSignIcon,
  LockKeyholeIcon,
  RepeatIcon,
  ShieldCheckIcon,
  TargetIcon,
} from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { CostConnectForm } from '@/components/cost-connect-form'
import { MoneyConnectForm } from '@/components/money-connect-form'
import { Button } from '@/components/ui/button'
import { UptimeStartForm } from '@/components/uptime-start-form'
import {
  costConnectProps,
  moneyConnectProps,
  type ProductConnectionSetup,
} from '@/server/connection-setup'
import { canManage, requireOrg } from '@/server/session'
import {
  AreaStartShell,
  DismissedLink,
  type ProductRow,
  ProductsTable,
  SetUpLink,
  SourceAreaExample,
} from './area-start'

/**
 * The empty pages of the areas fed by accounts (Money, Costs) and monitors
 * (Uptime), on the same shell as the source areas: the first step on the
 * page itself, an example, and the table of products when there are several.
 */

type AccountArea = 'money' | 'costs' | 'uptime'

interface StartProps {
  orgId: string
  product: { name: string; slug: string }
  setup: ProductConnectionSetup
}

/** "The Stripe account of Pagebird can serve Lumen too", and the way to it. */
async function SharedAccounts({
  area,
  slug,
  product,
  setup,
}: {
  area: 'money' | 'costs'
  slug: string
  product: string
  setup: ProductConnectionSetup
}) {
  const [ta, format] = await Promise.all([
    getTranslations(`areaStart.areas.${area}`),
    getFormatter(),
  ])
  const [first] = setup.shared
  if (!first) return null
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand/40 bg-brand/5 p-4">
      <p className="text-sm">
        {ta('canUse', {
          account: first.name,
          products: format.list(first.products, { type: 'conjunction' }),
          product,
        })}
        {setup.shared.length > 1 && ` ${ta('canUseMore', { count: setup.shared.length - 1 })}`}
      </p>
      <Button asChild size="sm" className="self-start">
        <Link href={`/p/${slug}/${area}/setup`}>{ta('canUseAction')}</Link>
      </Button>
    </div>
  )
}

/** What the gateway or provider key can do, said before it is pasted. */
async function ReadOnlyNote({ area }: { area: 'money' | 'costs' }) {
  const ta = await getTranslations(`areaStart.areas.${area}`)
  return (
    <p className="flex gap-2 text-sm text-muted-foreground">
      <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
      {ta('readOnly')}
    </p>
  )
}

async function step(
  area: AccountArea,
  manager: boolean,
  manage: () => Promise<ReactNode>,
): Promise<ReactNode> {
  if (manager) return manage()
  const [t, ta] = await Promise.all([
    getTranslations('areaStart'),
    getTranslations(`areaStart.areas.${area}`),
  ])
  return <p className="text-sm text-muted-foreground">{t('viewer', { area: ta('name') })}</p>
}

/** Money of one product before any gateway. */
export async function MoneyStartView({ product, setup }: Omit<StartProps, 'orgId'>) {
  const { org } = await requireOrg()
  const manager = canManage(org.role)
  const ta = await getTranslations('areaStart')
  const body = await step('money', manager, async () => (
    <div className="flex flex-col gap-5">
      {setup.state === 'canUse' && (
        <>
          <SharedAccounts area="money" slug={product.slug} product={product.name} setup={setup} />
          <p className="text-sm font-medium">{ta('orNewAccount')}</p>
        </>
      )}
      <ReadOnlyNote area="money" />
      <MoneyConnectForm {...(await moneyConnectProps(product.slug, product.name))} />
    </div>
  ))
  return (
    <AreaStartShell
      area="money"
      slug={product.slug}
      setup={setup}
      manager={manager}
      icons={[RepeatIcon, CircleDollarSignIcon, LockKeyholeIcon]}
      step={body}
      example={<SourceAreaExample area="money" />}
    />
  )
}

/** Costs of one product before any account or bill. */
export async function CostsStartView({ orgId, product, setup }: StartProps) {
  const { org } = await requireOrg()
  const manager = canManage(org.role)
  const ta = await getTranslations('areaStart')
  const body = await step('costs', manager, async () => (
    <div className="flex flex-col gap-5">
      {setup.state === 'canUse' && (
        <>
          <SharedAccounts area="costs" slug={product.slug} product={product.name} setup={setup} />
          <p className="text-sm font-medium">{ta('orNewAccount')}</p>
        </>
      )}
      <ReadOnlyNote area="costs" />
      <CostConnectForm {...(await costConnectProps(orgId, product.slug, product.name))} />
    </div>
  ))
  return (
    <AreaStartShell
      area="costs"
      slug={product.slug}
      setup={setup}
      manager={manager}
      icons={[ChartPieIcon, TargetIcon, CircleDollarSignIcon]}
      step={body}
      example={<SourceAreaExample area="costs" />}
    />
  )
}

/** Uptime of one product before the first monitor. */
export async function UptimeStartView({ product, setup }: Omit<StartProps, 'orgId'>) {
  const { org } = await requireOrg()
  const manager = canManage(org.role)
  const [ta, tf] = await Promise.all([
    getTranslations('areaStart.areas.uptime'),
    getTranslations('monitorForm'),
  ])
  const body = await step('uptime', manager, async () => (
    <div className="flex flex-col gap-4">
      <UptimeStartForm
        slug={product.slug}
        name={tf('kinds.site.label')}
        label={ta('urlLabel')}
        hint={ta('urlHint')}
        submit={ta('start')}
      />
      <p className="text-sm text-muted-foreground">
        {ta('others')}{' '}
        <Link
          href={`/p/${product.slug}/uptime/new`}
          className="text-brand underline underline-offset-4"
        >
          {ta('othersLink')}
        </Link>
      </p>
    </div>
  ))
  return (
    <AreaStartShell
      area="uptime"
      slug={product.slug}
      setup={setup}
      manager={manager}
      icons={[ActivityIcon, BellRingIcon, CalendarClockIcon]}
      step={body}
      example={<SourceAreaExample area="uptime" />}
      optionsHref={`/p/${product.slug}/uptime/new`}
    />
  )
}

/**
 * The products of Money, Costs or Uptime that still need a step: another
 * product's account they could share, nothing yet, or marked as not used.
 */
export async function AccountProducts({
  area,
  setup,
  folded,
}: {
  area: AccountArea
  setup: ProductConnectionSetup[]
  folded: boolean
}) {
  const [{ org }, t, ta, format] = await Promise.all([
    requireOrg(),
    getTranslations('areaStart'),
    getTranslations(`areaStart.areas.${area}`),
    getFormatter(),
  ])
  const manager = canManage(org.role)
  const name = ta('name')
  const rows: ProductRow[] = setup
    .filter((s) => s.state !== 'sending')
    .map((s) => {
      const href = `/p/${s.product.slug}/${area}`
      let status: ReactNode
      let action: ReactNode = null
      const [first] = s.shared
      if (s.state === 'canUse' && first) {
        status = ta('canUseRow', {
          account: first.name,
          products: format.list(first.products, { type: 'conjunction' }),
        })
        if (manager) action = <SetUpLink href={href} label={ta('canUseAction')} />
      } else if (s.state === 'dismissed') {
        status = t('products.dismissed', { area: name })
        if (manager) action = <DismissedLink href={href} label={t('products.actions.dismissed')} />
      } else {
        status = ta('noneRow')
        if (manager) action = <SetUpLink href={href} label={ta('noneAction')} />
      }
      return {
        id: s.product.id,
        name: s.product.name,
        href,
        status,
        action,
        muted: s.state === 'dismissed',
      }
    })
  return <ProductsTable area={area} rows={rows} folded={folded} />
}
