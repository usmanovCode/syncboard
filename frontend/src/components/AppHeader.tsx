import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/authContext'
import { LanguageSwitcher } from './LanguageSwitcher'

export function AppHeader() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <span className="text-lg font-bold text-indigo-600">{t('common.appName')}</span>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-slate-600 sm:inline">{user?.fullName}</span>
          <LanguageSwitcher />
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            {t('common.logout')}
          </button>
        </div>
      </div>
    </header>
  )
}
