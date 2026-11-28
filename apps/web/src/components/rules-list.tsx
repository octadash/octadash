import { INCIDENT_KINDS, listChannels, listRules } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import { services } from '@/server/context'
import { RuleForm, type RuleFormLabels } from './rule-form'
import { Card } from './ui/card'

/**
 * Every alert rule with its form. Without `project` it edits the
 * organization's defaults; with one, that product's own settings.
 */
export async function RulesList({
  orgId,
  project,
  canEdit,
}: {
  orgId: string
  project?: { id: string; slug: string }
  canEdit: boolean
}) {
  const { db } = services()
  const [rules, channels, t] = await Promise.all([
    listRules(db, orgId, project?.id ?? null),
    listChannels(db, orgId),
    getTranslations('alerts'),
  ])
  const base = {
    level: t('level'),
    levels: { emergency: t('levels.emergency'), signal: t('levels.signal'), off: t('levels.off') },
    levelHint: {
      emergency: t('levelHint.emergency'),
      signal: t('levelHint.signal'),
      off: t('levelHint.off'),
    },
    params: {
      minutes: { label: t('params.minutes'), unit: t('params.minutesUnit') },
      days: { label: t('params.days'), unit: t('params.daysUnit') },
    },
    channels: t('channels'),
    allChannels: t('allChannels'),
    noChannels: t('noChannels'),
    save: t('save'),
    saved: t('saved'),
    reset: t('reset'),
    custom: t('custom'),
  }
  return (
    <Card className="gap-0 divide-y py-0">
      {INCIDENT_KINDS.map((kind) => {
        const rule = rules.find((r) => r.kind === kind)
        if (!rule) return null
        const labels: RuleFormLabels = {
          ...base,
          title: t(`kinds.${kind}.title`),
          body: t(`kinds.${kind}.body`),
        }
        return (
          <RuleForm
            key={kind}
            kind={kind}
            slug={project?.slug}
            rule={rule}
            channels={channels
              .filter((channel) => channel.enabled)
              .map((channel) => ({ id: channel.id, name: channel.name }))}
            canEdit={canEdit}
            labels={labels}
          />
        )
      })}
    </Card>
  )
}
