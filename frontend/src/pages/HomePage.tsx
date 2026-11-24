import { useAuth } from '../auth/authContext'

export function HomePage() {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="text-lg font-bold text-indigo-600">SyncBoard</span>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Chiqish
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl font-semibold text-slate-900">Xush kelibsiz, {user?.fullName}!</h1>
        <p className="mt-2 text-slate-500">{user?.email}</p>
      </main>
    </div>
  )
}
