import { getLocale, getTranslations } from 'next-intl/server'
import { setLocaleAction } from '@/actions/locale'
import { AutoSubmitSelect } from './auto-submit-select'

const names: Record<string, string> = { en: 'English', 'pt-BR': 'Português' }

export async function LocaleSwitcher() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('common')])
  return (
    <form action={setLocaleAction}>
      <AutoSubmitSelect name="locale" defaultValue={locale} label={t('language')}>
        {Object.entries(names).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </AutoSubmitSelect>
    </form>
  )
}
