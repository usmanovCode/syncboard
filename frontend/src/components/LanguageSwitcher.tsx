import { useTranslation } from 'react-i18next'
import { currentLanguage, setLanguage, type Language } from '../i18n'

const LABELS: Record<Language, string> = { en: 'EN', ko: '한국어' }

export function LanguageSwitcher() {
  const { t } = useTranslation()
  const active = currentLanguage()
  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className="inline-flex rounded-full border border-slate-200 bg-white/80 p-0.5 shadow-sm"
    >
      {(Object.keys(LABELS) as Language[]).map((language) => (
        <button
          key={language}
          lang={language}
          aria-pressed={active === language}
          onClick={() => void setLanguage(language)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition sm:px-3.5 sm:py-2 ${
            active === language ? 'bg-brand text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
          }`}
        >
          {LABELS[language]}
        </button>
      ))}
    </div>
  )
}
