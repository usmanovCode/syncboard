import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, type RegisterInput, type User } from '../api/auth'
import { tokenStorage } from '../api/client'
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext'

/**
 * Source of truth for "who is logged in". The JWT lives in localStorage; on startup we validate it
 * by calling /api/auth/me, and any failure (expired, invalid, user deleted) drops back to anonymous.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>(() => (tokenStorage.get() ? 'loading' : 'anonymous'))

  const logout = useCallback(() => {
    tokenStorage.clear()
    setUser(null)
    setStatus('anonymous')
  }, [])

  const loadCurrentUser = useCallback(async () => {
    try {
      const me = await authApi.me()
      setUser(me)
      setStatus('authenticated')
    } catch (error) {
      logout()
      throw error
    }
  }, [logout])

  useEffect(() => {
    if (!tokenStorage.get()) return
    let cancelled = false
    authApi.me().then(
      (me) => {
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
      },
      () => {
        if (!cancelled) logout()
      },
    )
    return () => {
      cancelled = true
    }
  }, [logout])

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await authApi.login(email, password)
      tokenStorage.set(accessToken)
      await loadCurrentUser()
    },
    [loadCurrentUser],
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      await authApi.register(input)
      await login(input.email, input.password)
    },
    [login],
  )

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
