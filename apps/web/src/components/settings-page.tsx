import type { ReactNode } from 'react'

/** The title, the line under it and, on the right, the page's main action. */
export function SettingsHeader({
  title,
  intro,
  action,
}: {
  title: string
  intro: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>
      {action}
    </div>
  )
}

/** A titled block of one form. */
export function SettingsCard({
  title,
  info,
  tone,
  children,
}: {
  title: string
  info?: ReactNode
  tone?: 'danger'
  children: ReactNode
}) {
  return (
    <section
      aria-label={title}
      className={
        tone === 'danger'
          ? 'flex flex-col gap-4 rounded-xl border border-error/50 p-5'
          : 'flex flex-col gap-4 rounded-xl border border-border bg-card p-5'
      }
    >
      <h2
        className={
          tone === 'danger'
            ? 'flex items-center gap-1 font-semibold text-error'
            : 'flex items-center gap-1 font-semibold'
        }
      >
        {title}
        {info}
      </h2>
      {children}
    </section>
  )
}
