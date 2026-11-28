import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/authContext'
import { LogoutIcon } from './icons'
import { initials } from './initials'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Logo } from './Logo'

export function AppHeader() {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  return (
    <header className="sticky top-0 z-20 border-b border-white/70 bg-white/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Logo />
        <div className="flex items-center gap-3">
          {user && (
            <span className="hidden items-center gap-2 sm:inline-flex">
              <span
                aria-hidden="true"
                className="bg-brand flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
              >
                {initials(user.fullName)}
              </span>
              <span className="text-sm font-medium text-slate-700">{user.fullName}</span>
            </span>
          )}
          <LanguageSwitcher />
          <button
            onClick={logout}
            className="btn-secondary inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm"
          >
            <LogoutIcon className="h-4 w-4 text-slate-400" />
            {t('common.logout')}
          </button>
        </div>
      </div>
    </header>
  )
}
