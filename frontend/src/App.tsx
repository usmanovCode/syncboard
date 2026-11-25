import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes } from 'react-router'
import { RequireAuth, RequireGuest } from './auth/routeGuards'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'

// Loaded on demand: it pulls in Konva, which the other pages don't need.
const BoardPage = lazy(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })))

function PageLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500" role="status">
      {t('common.loading')}
    </div>
  )
}

// Routes only — the router itself is provided by main.tsx (BrowserRouter) or tests (MemoryRouter).
export default function App() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/boards/:id"
          element={
            <Suspense fallback={<PageLoading />}>
              <BoardPage />
            </Suspense>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
