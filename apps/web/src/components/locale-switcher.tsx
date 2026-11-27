import { getLocale, getTranslations } from 'next-intl/server'
import { setLocaleAction } from '@/actions/locale'
import { cn } from '@/lib/utils'

const options = [
  { value: 'pt-BR', label: 'PT', name: 'Português' },
  { value: 'en', label: 'EN', name: 'English' },
] as const

/** Two small buttons instead of a select: one click, and the active one is always right. */
export async function LocaleSwitcher() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('common')])
  return (
    <form action={setLocaleAction}>
      <fieldset className="flex rounded-lg border border-border p-0.5 text-xs">
        <legend className="sr-only">{t('language')}</legend>
        {options.map((option) => {
          const active = option.value === locale
          return (
            <button
              key={option.value}
              type="submit"
              name="locale"
              value={option.value}
              title={option.name}
              aria-pressed={active}
              className={cn(
                'rounded-md px-2 py-1 font-medium transition-colors',
                active ? 'bg-primary/15 text-brand' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </fieldset>
    </form>
  )
}
