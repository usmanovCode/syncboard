import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from './LanguageSwitcher'
import { Logo } from './Logo'

/** A decorative mini canvas on a pastel gradient, shown at the top of the auth card. */
function AuthPreview() {
  return (
    <div
      aria-hidden="true"
      className="relative h-28 overflow-hidden bg-linear-to-br from-blue-100 via-indigo-50 to-violet-200"
    >
      <div className="absolute inset-x-8 top-6 h-28 rounded-t-xl border border-white bg-white/85 shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-rose-300" />
          <span className="h-2 w-2 rounded-full bg-amber-300" />
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          <span className="ml-3 h-1.5 w-16 rounded-full bg-slate-200" />
        </div>
        <svg viewBox="0 0 300 60" className="h-14 w-full" fill="none" strokeLinecap="round" strokeWidth={3}>
          <path d="M20 40c25-25 45-25 60 0s40 10 55-12" className="stroke-blue-400" />
          <rect x="160" y="14" width="46" height="30" rx="6" className="stroke-violet-400" />
          <circle cx="250" cy="30" r="15" className="stroke-pink-400" />
        </svg>
      </div>
    </div>
  )
}

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-blue-200/50 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -bottom-32 h-96 w-96 rounded-full bg-violet-200/60 blur-3xl" />
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <div className="card overflow-hidden">
          <AuthPreview />
          <div className="p-8">
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            <p className="mt-1 mb-6 text-sm text-slate-500">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
      {message}
    </div>
  )
}

export function SubmitButton({ loading, children }: { loading: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <button type="submit" disabled={loading} className="btn-primary mt-2 w-full rounded-xl px-4 py-3 text-sm">
      {loading ? t('common.pleaseWait') : children}
    </button>
  )
}
