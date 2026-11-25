import { useTranslation } from 'react-i18next'
import { currentLanguage, setLanguage, type Language } from '../i18n'

const LABELS: Record<Language, string> = { en: 'EN', ko: '한국어' }

export function LanguageSwitcher() {
  const { t } = useTranslation()
  const active = currentLanguage()
  return (
    <div role="group" aria-label={t('common.language')} className="inline-flex rounded-lg border border-slate-300 p-0.5">
      {(Object.keys(LABELS) as Language[]).map((language) => (
        <button
          key={language}
          lang={language}
          aria-pressed={active === language}
          onClick={() => void setLanguage(language)}
          className={`rounded-md px-2 py-1 text-xs font-medium transition ${
            active === language ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {LABELS[language]}
        </button>
      ))}
    </div>
  )
}
