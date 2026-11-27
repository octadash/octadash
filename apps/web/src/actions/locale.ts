'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { LOCALE_COOKIE, locales } from '@/i18n/config'

export async function setLocaleAction(formData: FormData) {
  const locale = String(formData.get('locale') ?? '')
  if (!(locales as readonly string[]).includes(locale)) return
  ;(await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })
  revalidatePath('/', 'layout')
}
