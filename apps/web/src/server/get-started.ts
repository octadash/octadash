import {
  GET_STARTED_STEPS,
  type GetStartedStep,
  getStartedProgress,
  isGetStartedHidden,
} from '@octadash/db'
import { services } from './context'
import { canManage, type OrgSummary } from './session'

export interface GetStarted {
  steps: { id: GetStartedStep; done: boolean }[]
  done: number
  /** The organization's first product: the first step's line and where areas are set up. */
  first: { name: string; slug: string } | null
}

/**
 * The "Get started" list for owners and admins: null for members, once every
 * step is done, or after someone hid it.
 */
export async function loadGetStarted(org: OrgSummary): Promise<GetStarted | null> {
  if (!canManage(org.role)) return null
  const { db } = services()
  const [hidden, progress, first] = await Promise.all([
    isGetStartedHidden(db, org.id),
    getStartedProgress(db, org.id),
    db
      .selectFrom('project')
      .select(['name', 'slug'])
      .where('org_id', '=', org.id)
      .orderBy('created_at')
      .limit(1)
      .executeTakeFirst(),
  ])
  if (hidden) return null
  const steps = GET_STARTED_STEPS.map((id) => ({ id, done: progress[id] }))
  const done = steps.filter((s) => s.done).length
  return done === steps.length ? null : { steps, done, first: first ?? null }
}
