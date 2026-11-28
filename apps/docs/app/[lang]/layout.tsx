import { i18nProvider } from 'fumadocs-ui/i18n'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Provider } from '@/components/provider'
import { i18n, isLang } from '@/lib/i18n'
import { baseOptions } from '@/lib/layout.shared'
import { siteUrl } from '@/lib/shared'
import { source } from '@/lib/source'
import { translations } from '@/lib/translations'
import '../global.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { template: '%s · Octadash Docs', default: 'Octadash Docs' },
  icons: { icon: '/favicon.svg' },
}

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }))
}

export default async function Layout({ params, children }: LayoutProps<'/[lang]'>) {
  const { lang } = await params
  if (!isLang(lang)) notFound()
  return (
    <html lang={lang === 'pt' ? 'pt-BR' : 'en'} suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
        <link
          rel="preload"
          href="/fonts/outfit-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin=""
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <Provider i18n={i18nProvider(translations, lang)}>
          <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
            {children}
          </DocsLayout>
        </Provider>
      </body>
    </html>
  )
}
