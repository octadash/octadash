import { OCTADASH_VERSION } from '@octadash/core'
import { getTranslations } from 'next-intl/server'

export default async function Home() {
  const t = await getTranslations('home')
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex items-center gap-4">
        {/* biome-ignore lint/performance/noImgElement: static SVG logo, no optimization needed */}
        <img src="/logo-magenta.svg" alt="" width={48} height={54} />
        <h1 className="font-display text-4xl font-semibold tracking-tight">Octadash</h1>
      </div>
      <p className="text-lg text-muted">{t('tagline')}</p>
      <section className="rounded-xl border border-line bg-surface p-5">
        <p className="flex items-center gap-2 font-medium">
          <span className="size-2.5 rounded-full bg-ok" aria-hidden />
          {t('status')}
        </p>
        <p className="mt-2 text-sm text-muted">{t('next')}</p>
      </section>
      <footer className="flex gap-6 text-sm text-muted">
        <a className="hover:text-accent" href="https://github.com/octadash/octadash#readme">
          {t('docs')}
        </a>
        <a className="hover:text-accent" href="https://github.com/octadash/octadash">
          {t('source')}
        </a>
        <span className="ml-auto">v{OCTADASH_VERSION}</span>
      </footer>
    </main>
  )
}
