'use server'

import { type IgnoreUntil, type IssueAction, updateIssue } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { tellLive } from '@/server/live'
import { requireOrg } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The conditions "Ignore" offers; each brings the issue back as Regressed. */
export type IgnoreChoice = 'events' | 'people' | 'day' | 'never'

function ignoreUntil(choice: IgnoreChoice, now: Date): IgnoreUntil | null {
  switch (choice) {
    case 'events':
      return { count: 100 }
    case 'people':
      return { people: 50 }
    case 'day':
      return { until: now.getTime() + 86_400_000 }
    case 'never':
      return null
  }
}

/**
 * Resolve, Resolve in next release, Ignore, Reopen, "I'm on it" and "Leave"
 * on an issue. Any member can: whoever sees it can deal with it, as with
 * emergencies.
 */
export async function issueAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org, user } = await requireOrg()
  const id = String(formData.get('issue') ?? '')
  const kind = String(formData.get('kind') ?? '')
  if (!UUID.test(id)) return { error: t('notFound') }
  const now = new Date()
  let action: IssueAction
  switch (kind) {
    case 'resolve':
    case 'resolveInNextRelease':
    case 'reopen':
    case 'take':
    case 'leave':
      action = { kind }
      break
    case 'ignore': {
      const choice = String(formData.get('until') ?? 'never') as IgnoreChoice
      if (!['events', 'people', 'day', 'never'].includes(choice)) return { error: t('generic') }
      action = { kind: 'ignore', until: ignoreUntil(choice, now) }
      break
    }
    default:
      return { error: t('generic') }
  }
  await updateIssue(services().db, org.id, id, user.id, action, now)
  await tellLive(org.id, 'errors').catch(() => {})
  revalidatePath('/', 'layout')
  return { done: true }
}
