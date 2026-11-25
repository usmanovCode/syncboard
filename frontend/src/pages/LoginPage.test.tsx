import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  it('validates fields without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/login')

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByText('Email is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the server error for wrong credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(401, { status: 401, detail: 'Incorrect email or password', code: 'INVALID_CREDENTIALS' }),
      ),
    )
    renderAt('/login')

    await userEvent.type(screen.getByLabelText('Email'), 'ali@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
    expect(localStorage.getItem('syncboard.accessToken')).toBeNull()
  })

  it('stores the token and opens the dashboard on success', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/auth/login'
          ? jsonResponse(200, { accessToken: 'jwt-token', tokenType: 'Bearer', expiresIn: 3600 })
          : url === '/api/boards'
            ? jsonResponse(200, [])
            : jsonResponse(200, { id: 1, email: 'ali@example.com', fullName: 'Ali Valiyev', createdAt: '' }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/login')

    await userEvent.type(screen.getByLabelText('Email'), 'ali@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('heading', { name: 'My boards' })).toBeInTheDocument()
    expect(screen.getByText('Ali Valiyev')).toBeInTheDocument()
    expect(localStorage.getItem('syncboard.accessToken')).toBe('jwt-token')
    const meCall = fetchMock.mock.calls.find(([url]) => url === '/api/auth/me') as unknown as [string, RequestInit]
    expect((meCall[1].headers as Record<string, string>).Authorization).toBe('Bearer jwt-token')
  })

  it('redirects anonymous users from / to /login', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
