import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Board } from '../api/boards'
import { AuthProvider } from '../auth/AuthProvider'

const ME = { id: 1, email: 'ali@example.com', fullName: 'Ali Valiyev', createdAt: '2026-01-01T00:00:00Z' }

function board(id: number, name: string, ownerId = ME.id): Board {
  return { id, name, ownerId, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' }
}

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Minimal in-memory stand-in for the boards API. */
function fakeBackend(initial: Board[]) {
  let boards = [...initial]
  let nextId = 100
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body as string) : undefined
    if (url === '/api/auth/me') return jsonResponse(200, ME)
    if (url === '/api/boards' && method === 'GET') return jsonResponse(200, boards)
    if (url === '/api/boards' && method === 'POST') {
      const created = board(nextId++, body.name)
      boards = [created, ...boards]
      return jsonResponse(201, created)
    }
    const id = Number(url.split('/').pop())
    if (method === 'PATCH') {
      const updated = { ...boards.find((b) => b.id === id)!, name: body.name }
      boards = [updated, ...boards.filter((b) => b.id !== id)]
      return jsonResponse(200, updated)
    }
    if (method === 'DELETE') {
      boards = boards.filter((b) => b.id !== id)
      return jsonResponse(204)
    }
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  )
}

function boardTitles() {
  return within(screen.getByRole('list'))
    .getAllByRole('heading')
    .map((h) => h.textContent)
}

describe('DashboardPage', () => {
  beforeEach(() => {
    localStorage.setItem('syncboard.accessToken', 'jwt-token')
  })

  it('shows the user boards as cards', async () => {
    fakeBackend([board(1, 'Dizayn eskizlari'), board(2, 'Dars rejasi')])
    renderDashboard()

    expect(await screen.findByRole('heading', { name: 'Dizayn eskizlari' })).toBeInTheDocument()
    expect(boardTitles()).toEqual(['Dizayn eskizlari', 'Dars rejasi'])
    expect(within(screen.getByRole('listitem', { name: 'Dars rejasi' })).getByText(/Nov 1, 2026/)).toBeInTheDocument()
  })

  it('shows an empty state when there are no boards', async () => {
    fakeBackend([])
    renderDashboard()

    expect(await screen.findByText("Hali doskalar yo'q")).toBeInTheDocument()
  })

  it('creates a board and validates the name first', async () => {
    const fetchMock = fakeBackend([board(1, 'Eski doska')])
    renderDashboard()

    await userEvent.click(await screen.findByRole('button', { name: '+ Yangi doska' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yaratish' }))
    expect(screen.getByText('Doska nomi kiritilishi shart')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/boards', expect.objectContaining({ method: 'POST' }))

    await userEvent.type(screen.getByLabelText('Yangi doska nomi'), '  Yangi g‘oyalar  ')
    await userEvent.click(screen.getByRole('button', { name: 'Yaratish' }))

    expect(await screen.findByRole('heading', { name: 'Yangi g‘oyalar' })).toBeInTheDocument()
    expect(boardTitles()).toEqual(['Yangi g‘oyalar', 'Eski doska'])
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toEqual({ name: 'Yangi g‘oyalar' })
  })

  it('shows server field errors when creating fails', async () => {
    const fetchMock = fakeBackend([])
    renderDashboard()
    await userEvent.click(await screen.findByRole('button', { name: '+ Yangi doska' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        detail: "Ma'lumotlar noto'g'ri",
        code: 'VALIDATION_FAILED',
        errors: { name: 'Serverdagi xato' },
      }),
    )

    await userEvent.type(screen.getByLabelText('Yangi doska nomi'), 'Doska')
    await userEvent.click(screen.getByRole('button', { name: 'Yaratish' }))

    expect(await screen.findByText('Serverdagi xato')).toBeInTheDocument()
  })

  it('renames a board inline', async () => {
    fakeBackend([board(1, 'Birinchi'), board(2, 'Ikkinchi')])
    renderDashboard()

    const card = await screen.findByRole('listitem', { name: 'Ikkinchi' })
    await userEvent.click(within(card).getByRole('button', { name: "Nomini o'zgartirish" }))
    const input = within(card).getByLabelText('Yangi nom')
    await userEvent.clear(input)
    await userEvent.type(input, 'Qayta nomlangan{Enter}')

    expect(await screen.findByRole('heading', { name: 'Qayta nomlangan' })).toBeInTheDocument()
    expect(boardTitles()).toEqual(['Qayta nomlangan', 'Birinchi'])
  })

  it('cancels renaming with Escape', async () => {
    const fetchMock = fakeBackend([board(1, 'Birinchi')])
    renderDashboard()

    const card = await screen.findByRole('listitem', { name: 'Birinchi' })
    await userEvent.click(within(card).getByRole('button', { name: "Nomini o'zgartirish" }))
    await userEvent.type(within(card).getByLabelText('Yangi nom'), ' xxx{Escape}')

    expect(screen.getByRole('heading', { name: 'Birinchi' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'PATCH' }))
  })

  it('deletes a board only after confirmation', async () => {
    const fetchMock = fakeBackend([board(1, 'Birinchi'), board(2, 'Ikkinchi')])
    renderDashboard()

    const card = await screen.findByRole('listitem', { name: 'Birinchi' })
    await userEvent.click(within(card).getByRole('button', { name: "O'chirish" }))
    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))

    await userEvent.click(within(card).getByRole('button', { name: "Ha, o'chirish" }))

    await vi.waitFor(() => expect(boardTitles()).toEqual(['Ikkinchi']))
    expect(fetchMock).toHaveBeenCalledWith('/api/boards/1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('hides rename and delete on boards the user does not own', async () => {
    fakeBackend([board(1, 'Ulashilgan doska', 99)])
    renderDashboard()

    const card = await screen.findByRole('listitem', { name: 'Ulashilgan doska' })
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('shows an error with retry when loading fails', async () => {
    const fetchMock = fakeBackend([board(1, 'Birinchi')])
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, ME))
    fetchMock.mockImplementationOnce(async () => jsonResponse(500, { detail: 'Server xatosi' }))
    renderDashboard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Server xatosi')
    await userEvent.click(screen.getByRole('button', { name: 'Qayta urinish' }))
    expect(await screen.findByRole('heading', { name: 'Birinchi' })).toBeInTheDocument()
  })

  it('logs out when the boards request is unauthorized', async () => {
    const fetchMock = fakeBackend([])
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, ME))
    fetchMock.mockImplementationOnce(async () => jsonResponse(401, { code: 'UNAUTHORIZED' }))
    renderDashboard()

    expect(await screen.findByRole('heading', { name: 'Tizimga kirish' })).toBeInTheDocument()
    expect(localStorage.getItem('syncboard.accessToken')).toBeNull()
  })
})
