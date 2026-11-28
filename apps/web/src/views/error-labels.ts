import { getTranslations } from 'next-intl/server'
import type { IgnoreLabels } from '@/components/issue-actions'

/** The words of the Ignore dialog, for the list and the issue page. */
export async function ignoreLabels(): Promise<IgnoreLabels> {
  const t = await getTranslations('errorsArea.ignore')
  const tc = await getTranslations('common')
  return {
    trigger: t('trigger'),
    title: t('title'),
    body: t('body'),
    info: t('info'),
    infoLabel: t('infoLabel'),
    legend: t('legend'),
    choices: {
      events: t('choices.events'),
      people: t('choices.people'),
      day: t('choices.day'),
      never: t('choices.never'),
    },
    cancel: tc('cancel'),
    confirm: t('confirm'),
  }
}
