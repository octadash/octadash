import type { Metadata } from 'next'
import { Inter, Outfit } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale } from 'next-intl/server'
import type { ReactNode } from 'react'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })

export const metadata: Metadata = {
  title: 'Octadash',
  description: 'Open source monitoring for people who run many products.',
  icons: { icon: '/logo-magenta.svg' },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${inter.variable} ${outfit.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
