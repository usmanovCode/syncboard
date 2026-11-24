import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './authContext'

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500" role="status">
      Yuklanmoqda…
    </div>
  )
}

/** Only for logged-in users; others go to /login and come back to the page they wanted afterwards. */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/** Only for logged-out users (login/register pages). */
export function RequireGuest() {
  const { status } = useAuth()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
