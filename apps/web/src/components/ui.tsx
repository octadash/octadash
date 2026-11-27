import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react'

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-50',
        variant === 'primary' && 'bg-magenta-500 text-white hover:bg-magenta-600',
        variant === 'secondary' && 'border border-line bg-surface hover:border-accent',
        variant === 'danger' && 'bg-error/15 text-error hover:bg-error/25',
        variant === 'ghost' && 'text-muted hover:text-text',
        className,
      )}
      {...props}
    />
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        'h-9 w-full rounded-lg border border-line bg-ink px-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        'h-9 rounded-lg border border-line bg-ink px-3 text-sm outline-none focus:border-accent',
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface p-5', className)}>
      {children}
    </section>
  )
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="text-sm text-error">
      {children}
    </p>
  )
}

export function Badge({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'ok' | 'warn' | 'error' | 'accent'
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'muted' && 'bg-line text-muted',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'error' && 'bg-error/15 text-error',
        tone === 'accent' && 'bg-magenta-500/15 text-accent',
      )}
    >
      {children}
    </span>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  // biome-ignore lint/performance/noImgElement: static SVG, no optimization needed
  return <img src="/logo-magenta.svg" alt="" width={size} height={Math.round(size * 1.13)} />
}
