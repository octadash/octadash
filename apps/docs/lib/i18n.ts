import { defineI18n } from 'fumadocs-core/i18n'

/**
 * English is the base and has no prefix (docs.octadash.com/install);
 * Portuguese lives under /pt, like octadash.com. A page is translated by a
 * file next to it: install.mdx and install.pt.mdx. A page without its .pt
 * file shows the English text under /pt, with a notice.
 */
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'pt'],
  hideLocale: 'default-locale',
  parser: 'dot',
})

export type Lang = (typeof i18n.languages)[number]

export function isLang(value: string): value is Lang {
  return (i18n.languages as readonly string[]).includes(value)
}
