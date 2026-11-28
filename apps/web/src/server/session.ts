import { needsSetup } from '@octadash/auth'
import { markSeen } from '@octadash/db'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { services } from './context'

export const getViewer = cache(async () => {
  const { auth } = services()
  return auth.api.getSession({ headers: await headers() })
})

export interface OrgSummary {
  id: string
  name: string
  slug: string
  role: string
}

export async function listMemberships(userId: string): Promise<OrgSummary[]> {
  const { db } = services()
  return db
    .selectFrom('auth_member')
    .innerJoin('auth_organization', 'auth_organization.id', 'auth_member.organizationId')
    .select([
      'auth_organization.id',
      'auth_organization.name',
      'auth_organization.slug',
      'auth_member.role',
    ])
    .where('auth_member.userId', '=', userId)
    .orderBy('auth_organization.name')
    .execute()
}

/** Sends the visitor to setup (no account yet) or sign-in (not signed in). */
export async function requireViewer() {
  const viewer = await getViewer()
  if (viewer) return viewer
  redirect((await needsSetup(services().pool)) ? '/setup' : '/sign-in')
}

/** The signed-in user and the organization they are working in. */
export const requireOrg = cache(async () => {
  const viewer = await requireViewer()
  const orgs = await listMemberships(viewer.user.id)
  const active = viewer.session.activeOrganizationId
  const org = orgs.find((o) => o.id === active) ?? orgs[0]
  if (!org) redirect('/no-organization')
  noteSeen(org.id, viewer.user.id)
  return { ...viewer, org, orgs }
})

/** How often "Last seen" is written for the same person: at most every 5 minutes. */
const SEEN_EVERY = 5 * 60_000
const seen = new Map<string, number>()

/** Records "Last seen" without slowing the page; a failed write only costs precision. */
function noteSeen(orgId: string, userId: string) {
  const key = `${orgId}:${userId}`
  const now = Date.now()
  if (now - (seen.get(key) ?? 0) < SEEN_EVERY) return
  seen.set(key, now)
  if (seen.size > 10_000) seen.clear()
  markSeen(services().db, orgId, userId).catch(() => seen.delete(key))
}

/** Owners and admins manage products and members; members only read. */
export function canManage(role: string): boolean {
  return role.split(',').some((r) => r.trim() === 'owner' || r.trim() === 'admin')
}

/** Like requireOrg, but sends plain members back to the overview. */
export async function requireManager() {
  const context = await requireOrg()
  if (!canManage(context.org.role)) redirect('/all')
  return context
}

/** Owners only: deleting the organization and the install's settings. */
export function isOwner(role: string): boolean {
  return role.split(',').some((r) => r.trim() === 'owner')
}
