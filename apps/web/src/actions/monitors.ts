'use server'

import { normalizeUrl } from '@octadash/core'
import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  getOrganizationSettings,
  getProjectBySlug,
  type MonitorKind,
  setProjectArea,
  updateMonitor,
} from '@octadash/db'
import { checkUrl, isValidSchedule } from '@octadash/uptime'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { describeFailure } from '@/lib/monitors'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const monitorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['site', 'health', 'heartbeat']),
  url: z.string().trim().max(2000).optional().default(''),
  interval: z.coerce.number().int().min(30).max(86_400),
  timeout: z.coerce.number().int().min(1).max(30).optional().default(10),
  grace: z.coerce.number().int().min(0).max(86_400).optional().default(0),
  /** Heartbeats: every interval, every day at a time, or a cron expression. */
  expect: z.enum(['interval', 'daily', 'cron']).optional().default('interval'),
  at: z
    .string()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/)
    .optional(),
  cron: z.string().trim().max(120).optional(),
  token: z.string().optional(),
})

async function parse(formData: FormData, timeZone: string) {
  const t = await getTranslations('errors')
  const parsed = monitorSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.some((issue) => issue.path[0] === 'name')
    return { error: nameIssue ? t('monitorName') : t('checkFields') } as const
  }
  const { name, kind, interval, grace, timeout, expect } = parsed.data
  let url: string | null = null
  if (kind !== 'heartbeat') {
    url = normalizeUrl(parsed.data.url)
    if (!url || !/^https?:\/\//.test(url)) return { error: t('invalidUrl') } as const
  }
  let schedule: string | null = null
  if (kind === 'heartbeat' && expect === 'daily') {
    if (!parsed.data.at) return { error: t('checkFields') } as const
    const [hour, minute] = parsed.data.at.split(':').map(Number)
    schedule = `${minute} ${hour} * * *`
  } else if (kind === 'heartbeat' && expect === 'cron') {
    const cron = parsed.data.cron ?? ''
    if (!isValidSchedule(cron, timeZone)) return { error: t('invalidCron') } as const
    schedule = cron.replace(/\s+/g, ' ')
  }
  return {
    value: {
      name,
      kind: kind as MonitorKind,
      url,
      intervalSeconds: schedule ? 86_400 : interval,
      graceSeconds: kind === 'heartbeat' ? grace : 0,
      timeoutSeconds: timeout,
      schedule,
      heartbeatToken: parsed.data.token,
    },
  } as const
}

export async function createMonitorAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const { db } = services()
  const settings = await getOrganizationSettings(db, org.id)
  const input = await parse(formData, settings.timeZone)
  if ('error' in input) return { error: input.error }
  const project = await getProjectBySlug(db, org.id, String(formData.get('slug') ?? ''))
  if (!project) return { error: t('notFound') }
  const monitor = await createMonitor(db, org.id, project.id, input.value)
  if (!monitor) return { error: t('notFound') }
  await setProjectArea(db, org.id, project.id, 'uptime', 'set_up')
  revalidatePath('/', 'layout')
  // A heartbeat stays in view until its first call arrives.
  redirect(
    monitor.kind === 'heartbeat'
      ? `/p/${project.slug}/uptime/${monitor.id}/edit?added=1`
      : `/p/${project.slug}/uptime`,
  )
}

export async function updateMonitorAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const { db } = services()
  const current = await getMonitor(db, org.id, String(formData.get('monitorId') ?? ''))
  if (!current) return { error: t('notFound') }
  // The kind is fixed at creation; the form sends it only to pick the fields.
  formData.set('kind', current.kind)
  const settings = await getOrganizationSettings(db, org.id)
  const input = await parse(formData, settings.timeZone)
  if ('error' in input) return { error: input.error }
  const { heartbeatToken: _token, kind: _kind, ...changes } = input.value
  await updateMonitor(db, org.id, current.id, changes)
  revalidatePath('/', 'layout')
  const project = await services()
    .db.selectFrom('project')
    .select('slug')
    .where('id', '=', current.project_id)
    .executeTakeFirst()
  redirect(`/p/${project?.slug ?? ''}/uptime`)
}

export type CheckNowState = { ok: boolean; text: string } | undefined

/**
 * "Check now": one real check of the address before saving, with what the
 * worker will see (status, time, certificate, http to https).
 */
export async function checkNowAction(_: CheckNowState, formData: FormData): Promise<CheckNowState> {
  await requireManager()
  const t = await getTranslations('monitorForm')
  const tu = await getTranslations('uptime')
  const { env } = services()
  const url = normalizeUrl(String(formData.get('url') ?? ''))
  if (!url || !/^https?:\/\//.test(url)) {
    return { ok: false, text: (await getTranslations('errors'))('invalidUrl') }
  }
  const timeout = Math.min(30, Math.max(1, Number(formData.get('timeout')) || 10))
  const result = await checkUrl(url, {
    kind: formData.get('kind') === 'health' ? 'health' : 'site',
    timeoutMs: timeout * 1000,
    deep: true,
    allowPrivate: env.OCTADASH_UPTIME_ALLOW_PRIVATE,
  })
  const parts: string[] = []
  if (result.up && result.status !== null) {
    parts.push(t('checkOk', { status: statusText(result.status), ms: result.durationMs ?? 0 }))
  } else {
    parts.push(
      t('checkFailed', {
        reason: describeFailure(result.error ?? 'unknown', (key, values) =>
          tu(`failure.${key}`, values),
        ),
      }),
    )
  }
  if (result.tls) {
    parts.push(
      result.tls.trusted ? t('certValid', { days: result.tls.daysLeft }) : t('certUntrusted'),
    )
  }
  if (result.httpsRedirect !== null) {
    parts.push(result.httpsRedirect ? t('httpsRedirect') : t('noHttpsRedirect'))
  }
  return { ok: result.up, text: parts.join(' · ') }
}

/** "200 OK", "301 Moved Permanently": the code with its usual name when known. */
function statusText(status: number) {
  const names: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
  }
  return names[status] ? `${status} ${names[status]}` : String(status)
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
