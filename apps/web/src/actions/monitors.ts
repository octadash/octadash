'use server'

import { normalizeUrl } from '@octadash/core'
import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  getProjectBySlug,
  type MonitorKind,
  setProjectArea,
  updateMonitor,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const monitorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['site', 'health', 'heartbeat']),
  url: z.string().trim().max(2000).optional().default(''),
  interval: z.coerce.number().int().min(30).max(86_400),
  grace: z.coerce.number().int().min(0).max(86_400).optional().default(0),
})

async function parse(formData: FormData) {
  const t = await getTranslations('errors')
  const parsed = monitorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.some((issue) => issue.path[0] === 'name')
    return { error: nameIssue ? t('monitorName') : t('checkFields') } as const
  }
  const { name, kind, interval, grace } = parsed.data
  let url: string | null = null
  if (kind !== 'heartbeat') {
    url = normalizeUrl(parsed.data.url)
    if (!url || !/^https?:\/\//.test(url)) return { error: t('invalidUrl') } as const
  }
  return {
    value: {
      name,
      kind: kind as MonitorKind,
      url,
      intervalSeconds: interval,
      graceSeconds: kind === 'heartbeat' ? grace : 0,
    },
  } as const
}

export async function createMonitorAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const input = await parse(formData)
  if ('error' in input) return { error: input.error }
  const { db } = services()
  const project = await getProjectBySlug(db, org.id, String(formData.get('slug') ?? ''))
  if (!project) return { error: t('notFound') }
  const monitor = await createMonitor(db, org.id, project.id, input.value)
  if (!monitor) return { error: t('notFound') }
  await setProjectArea(db, org.id, project.id, 'uptime', 'set_up')
  revalidatePath('/', 'layout')
  return { done: true }
}

export async function updateMonitorAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const { db } = services()
  const current = await getMonitor(db, org.id, String(formData.get('monitorId') ?? ''))
  if (!current) return { error: t('notFound') }
  // The kind is fixed at creation; the form sends it only to pick the fields.
  formData.set('kind', current.kind)
  const input = await parse(formData)
  if ('error' in input) return { error: input.error }
  await updateMonitor(db, org.id, current.id, input.value)
  revalidatePath('/', 'layout')
  return { done: true }
}

export async function pauseMonitorAction(formData: FormData) {
  const { org } = await requireManager()
  const { db } = services()
  const current = await getMonitor(db, org.id, String(formData.get('monitorId') ?? ''))
  if (!current) return
  await updateMonitor(db, org.id, current.id, {
    name: current.name,
    url: current.url,
    intervalSeconds: current.interval_seconds,
    graceSeconds: current.grace_seconds,
    paused: formData.get('paused') === 'true',
  })
  revalidatePath('/', 'layout')
}

export async function deleteMonitorAction(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireManager()
  await deleteMonitor(services().db, org.id, String(formData.get('monitorId') ?? ''))
  revalidatePath('/', 'layout')
  return { done: true }
}
