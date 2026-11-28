import { useTranslation } from 'react-i18next'

/** The app mark (a gradient tile with a pen stroke) and the gradient app name. */
export function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const { t } = useTranslation()
  const large = size === 'lg'
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`bg-brand flex items-center justify-center text-white shadow-md shadow-indigo-500/30 ${
          large ? 'h-10 w-10 rounded-xl' : 'h-8 w-8 rounded-[10px]'
        }`}
      >
        <svg viewBox="0 0 24 24" className={large ? 'h-6 w-6' : 'h-5 w-5'} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M4 16c2.5-5 5-7 7-5s1 6 3.5 5S18 9 20 7" />
        </svg>
      </span>
      <span className={`text-brand font-bold tracking-tight ${large ? 'text-2xl' : 'text-lg'}`}>{t('common.appName')}</span>
    </span>
  )
}
