import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { LOCALE_COOKIE, resolveLocale } from './config'

export default getRequestConfig(async ({ locale: chosen }) => {
  // A message written for someone else (an invitation in the channel's
  // language) passes its own locale; screens follow the reader.
  const locale = resolveLocale(
    chosen ?? (await cookies()).get(LOCALE_COOKIE)?.value,
    chosen ? null : (await headers()).get('accept-language'),
  )
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
