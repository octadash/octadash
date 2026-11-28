import {
  INCIDENT_KINDS,
  type IncidentKind,
  listChannels,
  listRuleOverrides,
  listRules,
  RULE_DEFAULTS,
} from '@octadash/db'
import { ActivityIcon, BugIcon, type LucideIcon, UserIcon } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { services } from '@/server/context'
import { LEVEL_ICON, type Level } from './level-icon'
import { RuleForm, type RuleFormLabels } from './rule-form'
import { Card } from './ui/card'

/** Which area each rule belongs to, so the list reads area by area. */
const RULE_AREA: Record<IncidentKind, 'uptime'> = {
  monitor_down: 'uptime',
  heartbeat_missed: 'uptime',
  cert_expiring: 'uptime',
}

/**
 * Rules of areas not built yet, shown dimmed so people see what is coming and
 * that it arrives already set. Each area replaces its preview when it ships.
 */
const FUTURE: { area: 'errors' | 'usage'; icon: LucideIcon; rule: string; level: Level }[] = [
  { area: 'errors', icon: BugIcon, rule: 'errorSpike', level: 'emergency' },
  { area: 'usage', icon: UserIcon, rule: 'signupsDropped', level: 'signal' },
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
        parts.push(unit(value, key === 'days' ? 'day' : 'minute'))
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
            {uptime.map((kind) => {
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
                  Object.keys(RULE_DEFAULTS[kind].params).length === 0
                    ? t(`kinds.${kind}.note`)
                    : undefined,
                changedOn: changed.length > 0 ? t('changedOn', { count: changed.length }) : '',
              }
              return (
                <RuleForm
                  key={kind}
                  kind={kind}
                  slug={project?.slug}
                  rule={rule}
                  channels={enabled}
                  overrides={changed}
                  canEdit={canEdit}
                  labels={labels}
                />
              )
            })}
          </div>
        </section>

        {FUTURE.map(({ area, icon, rule, level }) => (
          <section key={area} aria-labelledby={`rules-${area}`} className="border-t">
            <AreaHeader
              id={`rules-${area}`}
              as={heading}
              icon={icon}
              title={t(`areas.${area}`)}
              note={t(`future.${area}.starts`)}
            />
            <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
              <div className="flex max-w-md flex-col gap-1">
                <p className="font-medium text-muted-foreground">
                  {t(`future.${area}.${rule}.title`)}
                </p>
                <p className="text-sm text-muted-foreground">{t(`future.${area}.${rule}.body`)}</p>
                <p className="text-xs text-muted-foreground">{t(`future.${area}.${rule}.wait`)}</p>
                <p className="text-sm text-muted-foreground">
                  {t(`future.${area}.${rule}.params`)}
                </p>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="sr-only">{t('level')}:</span>
                {LEVEL_ICON[level]}
                {levels[level]}
              </p>
            </div>
          </section>
        ))}
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
