export const locales = ['en', 'pt-BR'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'
export const LOCALE_COOKIE = 'octadash_locale'

/** Picks the UI language from the cookie, then from Accept-Language, then English. */
export function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (cookieValue && (locales as readonly string[]).includes(cookieValue))
    return cookieValue as Locale
  const preferred = (acceptLanguage ?? '')
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase())
  for (const tag of preferred) {
    if (tag?.startsWith('pt')) return 'pt-BR'
    if (tag?.startsWith('en')) return 'en'
  }
  return defaultLocale
}
