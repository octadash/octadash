import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'
import { Logo } from '@/components/logo'
import type { Lang } from './i18n'
import { gitConfig } from './shared'

export function baseOptions(lang: Lang): BaseLayoutProps {
  const site = lang === 'pt' ? 'https://octadash.com/pt' : 'https://octadash.com'
  return {
    i18n: true,
    nav: {
      title: <Logo />,
      url: lang === 'pt' ? '/pt' : '/',
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      { text: 'Changelog', url: `${site}/changelog`, external: true },
      { text: 'octadash.com', url: site, external: true },
    ],
  }
}
