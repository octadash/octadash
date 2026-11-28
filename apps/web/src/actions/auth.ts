'use server'

import { needsSetup } from '@octadash/auth'
import { slugify } from '@octadash/core'
import { isCurrency, isTimeZone, saveOrganizationSettings } from '@octadash/db'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { safeNext } from '@/server/safe-next'
import { errorMessage } from './errors'

const setupSchema = z.object({
  name: z.string().trim().min(1),
  email: z.email(),
  password: z.string().min(10),
  orgName: z.string().trim().min(1),
  currency: z.string().refine(isCurrency),
  timeZone: z.string().refine(isTimeZone),
})

/** First run: creates the owner account and the first organization, with its currency and time zone. */
export async function setupAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { auth, pool, db } = services()
  if (!(await needsSetup(pool))) redirect('/sign-in')

  const parsed = setupSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('checkFields') }
  const { name, email, password, orgName, currency, timeZone } = parsed.data

  try {
    const { user } = await auth.api.signUpEmail({
      body: { name, email, password },
      headers: await headers(),
    })
    const org = await auth.api.createOrganization({
      body: { name: orgName, slug: `${slugify(orgName)}-${user.id.slice(0, 6)}`, userId: user.id },
    })
    if (org) await saveOrganizationSettings(db, org.id, { currency, timeZone })
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  redirect('/products/new')
}

const signInSchema = z.object({ email: z.email(), password: z.string().min(1) })

export async function signInAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const parsed = signInSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('checkFields') }
  try {
    await services().auth.api.signInEmail({ body: parsed.data, headers: await headers() })
  } catch {
    return { error: t('invalidCredentials') }
  }
  redirect(safeNext(formData.get('next')))
}

export async function signOutAction() {
  await services().auth.api.signOut({ headers: await headers() })
  redirect('/sign-in')
}

export async function switchOrgAction(formData: FormData) {
  const organizationId = String(formData.get('organizationId') ?? '')
  await services().auth.api.setActiveOrganization({
    body: { organizationId },
    headers: await headers(),
  })
  redirect('/all')
}
