import {
  INCIDENT_KINDS,
  type IncidentKind,
  listChannels,
  listRuleOverrides,
  listRules,
  NOTICE_KINDS,
  RULE_DEFAULTS,
} from '@octadash/db'
import {
  ActivityIcon,
  BugIcon,
  GlobeIcon,
  type LucideIcon,
  ReceiptIcon,
  TerminalIcon,
  UserIcon,
  WalletIcon,
} from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { services } from '@/server/context'
import { LEVEL_ICON, type Level } from './level-icon'
import { RuleForm, type RuleFormLabels } from './rule-form'
import { Card } from './ui/card'

/** Which area each rule belongs to, so the list reads area by area. */
const RULE_AREA: Record<IncidentKind, 'uptime' | 'errors' | 'usage' | 'logs' | 'money' | 'costs'> =
  {
    monitor_down: 'uptime',
    heartbeat_missed: 'uptime',
    cert_expiring: 'uptime',
    error_spike: 'errors',
    key_event_stopped: 'usage',
    log_alert: 'logs',
    payments_failing: 'money',
    cost_runaway: 'costs',
    new_issue: 'errors',
  }

/**
 * Rules of areas not built yet, shown dimmed so people see what is coming and
 * that it arrives already set: the kinds of emergency closed in the
 * Emergencies canvas, plus the signals each area brings. Each area replaces
 * its preview when it ships.
 */
const FUTURE: {
  area: 'uptime' | 'errors' | 'usage' | 'traffic' | 'money' | 'costs' | 'logs'
  icon: LucideIcon
  rules: { rule: string; level: Level }[]
}[] = [
  { area: 'uptime', icon: ActivityIcon, rules: [{ rule: 'domainExpiring', level: 'emergency' }] },
  { area: 'usage', icon: UserIcon, rules: [{ rule: 'signupsDropped', level: 'signal' }] },
  { area: 'traffic', icon: GlobeIcon, rules: [{ rule: 'trafficStopped', level: 'emergency' }] },
]

const LEVELS: Level[] = ['emergency', 'signal', 'off']

/**
 * Every alert rule with its form, grouped by area. Without `project` it edits
 * the organization's rules and says which products changed each one; with
 * one, that product's own settings.
 */
export async function RulesList({
  orgId,
  project,
  canEdit,
  heading = 'h2',
}: {
  orgId: string
  project?: { id: string; slug: string }
  canEdit: boolean
  /** The level of the area titles: h3 when the list sits under its own h2. */
  heading?: 'h2' | 'h3'
}) {
  const { db } = services()
  const [rules, channels, overrides, t, locale] = await Promise.all([
    listRules(db, orgId, project?.id ?? null),
    listChannels(db, orgId),
    project ? Promise.resolve([]) : listRuleOverrides(db, orgId),
    getTranslations('alerts'),
    getLocale(),
  ])
  const levels = {
    emergency: t('levels.emergency'),
    signal: t('levels.signal'),
    off: t('levels.off'),
  }
  const unit = (value: number, u: 'minute' | 'day') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value)

  /** "0 min", "Signal", "Off": what a product changed, against the organization's rule. */
  const summary = (
    kind: IncidentKind,
    override: { level: string; params: Record<string, number> },
  ) => {
    const base = rules.find((r) => r.kind === kind)
    const parts: string[] = []
    if (override.level !== base?.level) parts.push(levels[override.level as Level] ?? '')
    if (override.level !== 'off') {
      for (const [key, value] of Object.entries(override.params)) {
        if (base && base.params[key] === value) continue
        parts.push(
          key === 'days' || key === 'minutes' || key === 'silence'
            ? unit(value, key === 'days' ? 'day' : 'minute')
            : key === 'times'
              ? `${value}×`
              : key === 'percent'
                ? `${value}%`
                : key === 'dollars'
                  ? `US$ ${value}`
                  : String(value),
        )
      }
    }
    return parts.join(', ')
  }

  const base = {
    level: t('level'),
    levels,
    params: {
      minutes: { label: t('params.minutes'), unit: t('params.minutesUnit') },
      days: { label: t('params.days'), unit: t('params.daysUnit') },
      times: { label: t('params.times'), unit: t('params.timesUnit') },
      events: { label: t('params.events'), unit: t('params.eventsUnit') },
      expected: { label: t('params.expected'), unit: t('params.expectedUnit') },
      silence: { label: t('params.silence'), unit: t('params.silenceUnit') },
      percent: { label: t('params.percent'), unit: t('params.percentUnit') },
      charges: { label: t('params.charges'), unit: t('params.chargesUnit') },
      dollars: { label: t('params.dollars'), unit: t('params.dollarsUnit') },
    },
    sendTo: t('sendTo'),
    allChannels: t('allChannels'),
    channelsCount: t('channelsCount'),
    noChannels: t('noChannels'),
    saved: t('saved'),
    reset: t('reset'),
    custom: t('custom'),
  }
  const enabled = channels
    .filter((channel) => channel.enabled)
    .map((channel) => ({ id: channel.id, name: channel.name }))
  const uptime = INCIDENT_KINDS.filter((kind) => RULE_AREA[kind] === 'uptime')
  const errors = INCIDENT_KINDS.filter((kind) => RULE_AREA[kind] === 'errors')
  const usage = INCIDENT_KINDS.filter((kind) => RULE_AREA[kind] === 'usage')
  const logs = INCIDENT_KINDS.filter((kind) => RULE_AREA[kind] === 'logs')
  const money = INCIDENT_KINDS.filter((kind) => RULE_AREA[kind] === 'money')
  const costs = INCIDENT_KINDS.filter((kind) => RULE_AREA[kind] === 'costs')

  /** One rule of a built area, with its form. */
  const form = (kind: IncidentKind) => {
    const rule = rules.find((r) => r.kind === kind)
    if (!rule) return null
    const changed = overrides
      .filter((o) => o.kind === kind)
      .map((o) => ({
        name: o.product.name,
        slug: o.product.slug,
        summary: summary(kind, o),
      }))
    const labels: RuleFormLabels = {
      ...base,
      title: t(`kinds.${kind}.title`),
      body: t(`kinds.${kind}.body`),
      info: {
        label: t('about', { name: t(`kinds.${kind}.title`) }),
        title: t(`kinds.${kind}.title`),
        body: t(`kinds.${kind}.info`),
      },
      note:
        Object.keys(RULE_DEFAULTS[kind].params).length === 0 ? t(`kinds.${kind}.note`) : undefined,
      changedOn: changed.length > 0 ? t('changedOn', { count: changed.length }) : '',
    }
    // A notice only sends a message or not: no signal, and its words say so.
    const notice = NOTICE_KINDS.includes(kind)
    if (notice) labels.levels = { ...levels, emergency: t('levels.message'), off: t('levels.off') }
    return (
      <RuleForm
        key={kind}
        kind={kind}
        notice={notice}
        slug={project?.slug}
        rule={rule}
        channels={enabled}
        overrides={changed}
        canEdit={canEdit}
        labels={labels}
      />
    )
  }

  /** A rule of an area not built yet, dimmed, with what it waits for. */
  const future = (area: string, { rule, level }: { rule: string; level: Level }) => (
    <div
      key={`${area}-${rule}`}
      className="flex flex-wrap items-start justify-between gap-3 px-4 py-4"
    >
      <div className="flex max-w-md flex-col gap-1">
        <p className="font-medium text-muted-foreground">{t(`future.${area}.${rule}.title`)}</p>
        <p className="text-sm text-muted-foreground">{t(`future.${area}.${rule}.body`)}</p>
        <p className="text-xs text-muted-foreground">{t(`future.${area}.${rule}.wait`)}</p>
        <p className="text-sm text-muted-foreground">{t(`future.${area}.${rule}.params`)}</p>
      </div>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="sr-only">{t('level')}:</span>
        {LEVEL_ICON[level]}
        {levels[level]}
      </p>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <ul aria-label={t('legend')} className="grid gap-3 sm:grid-cols-3">
        {LEVELS.map((level) => (
          <li key={level} className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {LEVEL_ICON[level]}
              {levels[level]}
            </span>
            <span className="text-xs text-muted-foreground">{t(`levelHint.${level}`)}</span>
          </li>
        ))}
      </ul>

      <Card className="gap-0 overflow-hidden py-0">
        <section aria-labelledby="rules-uptime">
          <AreaHeader
            id="rules-uptime"
            as={heading}
            icon={ActivityIcon}
            title={t('areas.uptime')}
            note={t('rulesCount', { count: uptime.length })}
          />
          <div className="divide-y">
            {uptime.map(form)}
            {FUTURE.filter((f) => f.area === 'uptime').flatMap(({ rules: coming }) =>
              coming.map((r) => future('uptime', r)),
            )}
          </div>
        </section>

        <section aria-labelledby="rules-errors" className="border-t">
          <AreaHeader
            id="rules-errors"
            as={heading}
            icon={BugIcon}
            title={t('areas.errors')}
            note={t('rulesCount', { count: errors.length })}
          />
          <div className="divide-y">{errors.map(form)}</div>
        </section>

        <section aria-labelledby="rules-usage" className="border-t">
          <AreaHeader
            id="rules-usage"
            as={heading}
            icon={UserIcon}
            title={t('areas.usage')}
            note={t('rulesCount', { count: usage.length })}
          />
          <div className="divide-y">
            {usage.map(form)}
            {FUTURE.filter((f) => f.area === 'usage').flatMap(({ rules: coming }) =>
              coming.map((r) => future('usage', r)),
            )}
          </div>
        </section>

        <section aria-labelledby="rules-logs" className="border-t">
          <AreaHeader
            id="rules-logs"
            as={heading}
            icon={TerminalIcon}
            title={t('areas.logs')}
            note={t('rulesCount', { count: logs.length })}
          />
          <div className="divide-y">{logs.map(form)}</div>
        </section>

        <section aria-labelledby="rules-money" className="border-t">
          <AreaHeader
            id="rules-money"
            as={heading}
            icon={WalletIcon}
            title={t('areas.money')}
            note={t('rulesCount', { count: money.length })}
          />
          <div className="divide-y">{money.map(form)}</div>
        </section>

        <section aria-labelledby="rules-costs" className="border-t">
          <AreaHeader
            id="rules-costs"
            as={heading}
            icon={ReceiptIcon}
            title={t('areas.costs')}
            note={t('rulesCount', { count: costs.length })}
          />
          <div className="divide-y">{costs.map(form)}</div>
        </section>

        {FUTURE.filter((f) => f.area !== 'uptime' && f.area !== 'usage').map(
          ({ area, icon, rules: coming }) => (
            <section key={area} aria-labelledby={`rules-future-${area}`} className="border-t">
              <AreaHeader
                id={`rules-future-${area}`}
                as={heading}
                icon={icon}
                title={t(`areas.${area}`)}
                note={t(`future.${area}.starts`)}
              />
              <div className="divide-y">{coming.map((r) => future(area, r))}</div>
            </section>
          ),
        )}
      </Card>
      <p className="text-sm text-muted-foreground">{t('moreAreas')}</p>
    </div>
  )
}

function AreaHeader({
  id,
  as: Heading,
  icon: Icon,
  title,
  note,
}: {
  id: string
  as: 'h2' | 'h3'
  icon: LucideIcon
  title: string
  note: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-4 py-2.5">
      <Heading id={id} className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {title}
      </Heading>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  )
}
