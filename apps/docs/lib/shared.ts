export const appName = 'Octadash'
export const siteUrl = 'https://docs.octadash.com'

/** Where the page sources live, for "Edit on GitHub". */
export const gitConfig = {
  user: 'octadash',
  repo: 'octadash',
  branch: 'main',
  contentDir: 'apps/docs/content/docs',
}

/** The URL of a page in a language: English has no prefix. */
export function localeUrl(url: string, lang: string) {
  if (lang === 'en') return url
  return url === '/' ? `/${lang}` : `/${lang}${url}`
}
