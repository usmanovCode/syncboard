import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import { detectLanguage, setLanguage } from '.'
import { formatDate, formatMessageTime } from './format'

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

describe('i18n', () => {
  it('switches the login page to Korean and remembers the choice', async () => {
    renderAt('/login')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('en')

    await userEvent.click(screen.getByRole('button', { name: '한국어' }))

    expect(screen.getByRole('heading', { name: '로그인' })).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '한국어' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('syncboard.lang')).toBe('ko')
    expect(document.documentElement.lang).toBe('ko')
  })

  it('shows Korean client-side validation messages', async () => {
    await setLanguage('ko')
    renderAt('/login')

    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(screen.getByText('이메일을 입력하세요')).toBeInTheDocument()
    expect(screen.getByText('비밀번호를 입력하세요')).toBeInTheDocument()
  })

  it('sends the UI language to the backend', async () => {
    await setLanguage('ko')
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, { detail: '이메일 또는 비밀번호가 올바르지 않습니다', code: 'INVALID_CREDENTIALS' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/login')

    await userEvent.type(screen.getByLabelText('이메일'), 'ali@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('이메일 또는 비밀번호가 올바르지 않습니다')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['Accept-Language']).toBe('ko')
  })

  it('formats dates per language', () => {
    expect(formatDate('2026-11-25T10:00:00Z', 'en')).toBe('Nov 25, 2026')
    expect(formatDate('2026-11-25T10:00:00Z', 'ko')).toBe('2026년 11월 25일')
  })

  it('formats chat times, with the date only for other days', () => {
    const now = new Date(2026, 10, 25, 18, 0)
    const today = new Date(2026, 10, 25, 14, 5).toISOString()
    const yesterday = new Date(2026, 10, 24, 9, 30).toISOString()
    const plain = (text: string) => text.replace(/\s/g, ' ')

    expect(plain(formatMessageTime(today, 'en', now))).toBe('2:05 PM')
    expect(plain(formatMessageTime(today, 'ko', now))).toBe('오후 2:05')
    expect(plain(formatMessageTime(yesterday, 'en', now))).toBe('Nov 24, 9:30 AM')
    expect(plain(formatMessageTime(yesterday, 'ko', now))).toBe('11월 24일 오전 9:30')
  })

  it('detects the language from storage first, then the browser', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ko-KR', 'en'])
    expect(detectLanguage()).toBe('ko')

    localStorage.setItem('syncboard.lang', 'en')
    expect(detectLanguage()).toBe('en')

    localStorage.setItem('syncboard.lang', 'uz')
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['uz-UZ'])
    expect(detectLanguage()).toBe('en')
  })
})
