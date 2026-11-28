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
      <div className="mx-auto flex min-h-[72px] max-w-[1840px] items-center justify-between gap-3 px-4 py-2.5 sm:gap-4 sm:px-6 lg:px-10">
        <Logo size="lg" />
        <div className="flex items-center gap-2 sm:gap-4">
          {user && (
            <span className="hidden items-center gap-2.5 md:inline-flex">
              <span
                aria-hidden="true"
                className="bg-brand flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm"
              >
                {initials(user.fullName)}
              </span>
              <span className="text-base font-semibold text-slate-700">{user.fullName}</span>
            </span>
          )}
          <LanguageSwitcher />
          <button
            onClick={logout}
            className="btn-secondary inline-flex items-center gap-2 rounded-full p-2.5 text-base whitespace-nowrap sm:px-4.5 sm:py-2.5"
          >
            <LogoutIcon className="h-5 w-5 text-slate-400" />
            {/* Phones show only the icon; the label stays for screen readers. */}
            <span className="sr-only sm:not-sr-only">{t('common.logout')}</span>
          </button>
        </div>
      </div>
    </header>
  )
}
