import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../auth/AuthProvider'
import type { Board, BoardRole, Member } from '../api/boards'
import type { Shape } from '../canvas/types'
import { SAVE_DEBOUNCE_MS } from '../canvas/useCanvasSaver'
import { setLanguage } from '../i18n'
import { konvaState } from '../test/konvaMock'
import { socketState } from '../test/socketMock'
import type { OnlineUser } from '../realtime/types'

vi.mock('react-konva', () => import('../test/konvaMock'))
vi.mock('../realtime/connection', () => import('../test/socketMock'))

const ME = { id: 1, email: 'ali@example.com', fullName: 'Ali Valiyev', createdAt: '2026-01-01T00:00:00Z' }
const BOARD: Board = {
  id: 7,
  name: 'Dizayn eskizlari',
  ownerId: 1,
  ownerName: ME.fullName,
  role: 'OWNER',
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
}
const OWNER_MEMBER: Member = { userId: 1, email: ME.email, fullName: ME.fullName, role: 'OWNER' }
const EXISTING: Shape = { id: 'r1', type: 'rect', x: 10, y: 10, width: 40, height: 30, stroke: '#1e293b', strokeWidth: 4 }

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type SavedBody = { content: { schemaVersion: number; shapes: Shape[] }; version: number }

/** Fake backend for one board; records canvas saves. */
function fakeBackend({
  shapes = [EXISTING],
  getStatus = 200,
  saveStatus = 200,
  role = 'OWNER' as BoardRole,
  members = [OWNER_MEMBER],
} = {}) {
  const saves: SavedBody[] = []
  let version = 3
  let people = [...members]
  const board = { ...BOARD, role }
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url === '/api/auth/me') return jsonResponse(200, ME)
    if (url === '/api/boards') return jsonResponse(200, [board])
    if (url === '/api/boards/7/members' && method === 'GET') return jsonResponse(200, people)
    if (url === '/api/boards/7/members' && method === 'POST') {
      const { email, role: memberRole } = JSON.parse(init.body as string)
      if (email !== 'vali@example.com') {
        return jsonResponse(404, { code: 'MEMBER_USER_NOT_FOUND', detail: 'No SyncBoard account uses this email' })
      }
      const member = { userId: 2, email, fullName: 'Vali', role: memberRole }
      people = [...people, member]
      return jsonResponse(201, member)
    }
    const memberMatch = /^\/api\/boards\/7\/members\/(\d+)$/.exec(url)
    if (memberMatch && method === 'PATCH') {
      const { role: memberRole } = JSON.parse(init.body as string)
      people = people.map((m) => (m.userId === Number(memberMatch[1]) ? { ...m, role: memberRole } : m))
      return jsonResponse(200, people.find((m) => m.userId === Number(memberMatch[1])))
    }
    if (memberMatch && method === 'DELETE') {
      people = people.filter((m) => m.userId !== Number(memberMatch[1]))
      return jsonResponse(204)
    }
    if (url === '/api/boards/7' && method === 'GET') {
      if (getStatus !== 200) return jsonResponse(getStatus, { code: 'BOARD_NOT_FOUND', detail: 'Board not found' })
      return jsonResponse(200, {
        board,
        canvas: { content: { schemaVersion: 1, shapes }, version, updatedAt: BOARD.updatedAt },
      })
    }
    if (url === '/api/boards/7/canvas' && method === 'PUT') {
      saves.push(JSON.parse(init.body as string))
      if (saveStatus !== 200) return jsonResponse(saveStatus, { code: 'CANVAS_CONFLICT', detail: 'conflict' })
      version += 1
      return jsonResponse(200, { version, updatedAt: '2026-11-25T10:00:00Z' })
    }
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, saves }
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

async function openBoard() {
  renderAt('/boards/7')
  await screen.findByRole('heading', { name: BOARD.name })
  // The board loads outside act(); flush effects so the keyboard listener is attached.
  await act(async () => {})
}

const tool = (name: RegExp) => screen.getByRole('button', { name })
const stage = () => screen.getByTestId('stage')
const shapes = () => screen.queryAllByTestId('shape')

/** Drags on the stage from one point to another. */
function dragOnStage(from: [number, number], to: [number, number]) {
  konvaState.pointer = { x: from[0], y: from[1] }
  fireEvent.pointerDown(stage())
  konvaState.pointer = { x: to[0], y: to[1] }
  fireEvent.pointerMove(stage())
  fireEvent.pointerUp(stage())
}

/** Lets the autosave debounce elapse (fake timers) and the save request settle. */
const waitForAutosave = () => act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50))

describe('BoardPage', () => {
  beforeEach(() => {
    localStorage.setItem('syncboard.accessToken', 'jwt-token')
    konvaState.reset()
    socketState.reset()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens from the dashboard and shows the saved drawing', async () => {
    fakeBackend()
    renderAt('/')

    await userEvent.click(await screen.findByRole('link', { name: BOARD.name }))

    expect(await screen.findByRole('heading', { name: BOARD.name })).toBeInTheDocument()
    expect(shapes()).toHaveLength(1)
    expect(shapes()[0]).toHaveAttribute('data-kind', 'Rect')
    expect(tool(/^Pen/)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
    expect(tool(/^Undo/)).toBeDisabled()
  })

  it('draws a rectangle and autosaves it', async () => {
    const { saves } = fakeBackend()
    await openBoard()

    await userEvent.click(tool(/^Rectangle/))
    dragOnStage([100, 100], [160, 130])

    expect(shapes()).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')

    await waitForAutosave()
    expect(saves).toHaveLength(1)
    expect(saves[0].version).toBe(3)
    expect(saves[0].content.shapes[1]).toMatchObject({ type: 'rect', x: 100, y: 100, width: 60, height: 30 })
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  })

  it('ignores clicks that do not draw anything', async () => {
    fakeBackend()
    await openBoard()

    await userEvent.click(tool(/^Line/))
    dragOnStage([50, 50], [50, 50])

    expect(shapes()).toHaveLength(1)
  })

  it('undoes and redoes with the buttons and the keyboard', async () => {
    const { saves } = fakeBackend()
    await openBoard()
    dragOnStage([0, 0], [20, 20]) // pen

    expect(shapes()).toHaveLength(2)
    await userEvent.click(tool(/^Undo/))
    expect(shapes()).toHaveLength(1)
    await userEvent.click(tool(/^Redo/))
    expect(shapes()).toHaveLength(2)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(shapes()).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(shapes()).toHaveLength(2)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(shapes()).toHaveLength(1)

    // Back at the loaded state: nothing to save.
    await waitForAutosave()
    expect(saves).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  })

  it('switches tools with keyboard shortcuts', async () => {
    fakeBackend()
    await openBoard()

    fireEvent.keyDown(window, { key: 'r' })
    expect(tool(/^Rectangle/)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'E' })
    expect(tool(/^Eraser/)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'v' })
    expect(tool(/^Select/)).toHaveAttribute('aria-pressed', 'true')
  })

  it('erases the whole shape under the pointer', async () => {
    const { saves } = fakeBackend()
    await openBoard()

    await userEvent.click(tool(/^Eraser/))
    konvaState.hit = 'r1'
    fireEvent.pointerDown(stage())
    fireEvent.pointerUp(stage())

    expect(shapes()).toHaveLength(0)
    await waitForAutosave()
    expect(saves[0].content.shapes).toEqual([])
  })

  it('selects, moves, recolors and deletes a shape', async () => {
    const { saves } = fakeBackend()
    await openBoard()
    await userEvent.click(tool(/^Select/))

    fireEvent.pointerDown(shapes()[0])
    const onDragEnd = konvaState.props.get('r1')?.onDragEnd as (e: unknown) => void
    act(() => onDragEnd({ target: { x: () => 200, y: () => 150 } }))
    await userEvent.click(screen.getByRole('button', { name: 'Red' }))

    expect(shapes()[0]).toHaveAttribute('data-stroke', '#ef4444')
    await waitForAutosave()
    expect(saves.at(-1)?.content.shapes[0]).toMatchObject({ id: 'r1', x: 200, y: 150, stroke: '#ef4444' })

    fireEvent.keyDown(window, { key: 'Delete' })
    expect(shapes()).toHaveLength(0)
  })

  it('applies the chosen color and thickness to new shapes', async () => {
    const { saves } = fakeBackend({ shapes: [] })
    await openBoard()

    await userEvent.click(screen.getByRole('button', { name: 'Blue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Thick' }))
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true')
    dragOnStage([0, 0], [10, 10])

    await waitForAutosave()
    expect(saves[0].content.shapes[0]).toMatchObject({ type: 'pen', stroke: '#3b82f6', strokeWidth: 8 })
  })

  it('adds text with the text tool', async () => {
    const { saves } = fakeBackend({ shapes: [] })
    await openBoard()

    await userEvent.click(tool(/^Text/))
    konvaState.pointer = { x: 30, y: 40 }
    fireEvent.pointerDown(stage())
    const input = screen.getByRole('textbox', { name: 'Text' })
    // Typing a shortcut letter in the text box must not switch tools.
    await userEvent.type(input, 'Salom Rr{Enter}')

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(shapes()).toHaveLength(1)
    expect(shapes()[0]).toHaveTextContent('Salom Rr')
    expect(tool(/^Text/)).toHaveAttribute('aria-pressed', 'true')

    await waitForAutosave()
    expect(saves[0].content.shapes).toEqual([expect.objectContaining({ type: 'text', x: 30, y: 40, text: 'Salom Rr' })])
  })

  it('cancels text with Escape', async () => {
    fakeBackend({ shapes: [] })
    await openBoard()

    await userEvent.click(tool(/^Text/))
    fireEvent.pointerDown(stage())
    await userEvent.type(screen.getByRole('textbox', { name: 'Text' }), 'Salom{Escape}')

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(shapes()).toHaveLength(0)
  })

  it('reports a conflict and reloads the latest version', async () => {
    const { fetchMock } = fakeBackend({ saveStatus: 409 })
    await openBoard()

    dragOnStage([0, 0], [20, 20])
    await waitForAutosave()

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('This board was changed somewhere else')
    await userEvent.click(within(status).getByRole('button', { name: 'Load latest version' }))

    expect(await screen.findByText('All changes saved')).toBeInTheDocument()
    expect(shapes()).toHaveLength(1)
    const gets = fetchMock.mock.calls.filter(([url, init]) => url === '/api/boards/7' && init?.method === 'GET')
    expect(gets).toHaveLength(2)
  })

  it('shows a not-found page for unknown or foreign boards', async () => {
    fakeBackend({ getStatus: 404 })
    renderAt('/boards/7')

    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to boards/ })).toHaveAttribute('href', '/')
  })

  it('treats a malformed id as not found without calling the API', async () => {
    const { fetchMock } = fakeBackend()
    renderAt('/boards/abc')

    expect(await screen.findByRole('heading', { name: 'Board not found' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/boards/abc', expect.anything())
  })

  it('is translated to Korean', async () => {
    await setLanguage('ko')
    fakeBackend()
    await openBoard()

    expect(screen.getByRole('button', { name: '펜 (P)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '지우개 (E)' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('모든 변경 사항이 저장됨')
  })

  it('gives viewers a read-only canvas', async () => {
    const { saves } = fakeBackend({ role: 'VIEWER' })
    await openBoard()

    expect(screen.getByText('View only')).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Drawing tools' })).toBeNull()

    dragOnStage([100, 100], [160, 130])
    fireEvent.keyDown(window, { key: 'e' })
    konvaState.hit = 'r1'
    dragOnStage([10, 10], [20, 20])
    fireEvent.pointerDown(shapes()[0])
    fireEvent.keyDown(window, { key: 'Delete' })

    expect(shapes()).toHaveLength(1)
    await waitForAutosave()
    expect(saves).toHaveLength(0)
  })

  it('lets the owner invite, change roles and remove people', async () => {
    fakeBackend()
    await openBoard()

    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog', { name: `Share “${BOARD.name}”` })
    expect(await within(dialog).findByRole('listitem', { name: ME.fullName })).toHaveTextContent('(you)')

    // Unknown account: the server's message is shown.
    await userEvent.type(within(dialog).getByLabelText('Email'), 'nobody@example.com')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invite' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No SyncBoard account uses this email')

    await userEvent.clear(within(dialog).getByLabelText('Email'))
    await userEvent.type(within(dialog).getByLabelText('Email'), 'vali@example.com')
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'VIEWER')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invite' }))

    const vali = await within(dialog).findByRole('listitem', { name: 'Vali' })
    const roleSelect = within(vali).getByLabelText('Role for Vali')
    expect(roleSelect).toHaveValue('VIEWER')
    await userEvent.selectOptions(roleSelect, 'EDITOR')
    await vi.waitFor(() => expect(within(vali).getByLabelText('Role for Vali')).toHaveValue('EDITOR'))

    await userEvent.click(within(vali).getByRole('button', { name: 'Remove Vali' }))
    await vi.waitFor(() => expect(within(dialog).queryByRole('listitem', { name: 'Vali' })).toBeNull())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('validates the invite email before calling the API', async () => {
    const { fetchMock } = fakeBackend()
    await openBoard()

    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))

    expect(screen.getByText('Invalid email format')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/boards/7/members', expect.objectContaining({ method: 'POST' }))
  })

  it('lets a member see who has access and leave the board', async () => {
    const vali: Member = { userId: 1, email: ME.email, fullName: ME.fullName, role: 'EDITOR' }
    const owner: Member = { userId: 9, email: 'sobir@example.com', fullName: 'Sobir', role: 'OWNER' }
    fakeBackend({ role: 'EDITOR', members: [owner, vali] })
    await openBoard()

    await userEvent.click(screen.getByRole('button', { name: 'Share' }))
    const dialog = screen.getByRole('dialog')
    expect(await within(dialog).findByRole('listitem', { name: 'Sobir' })).toHaveTextContent('Owner')
    expect(within(dialog).queryByLabelText('Email')).toBeNull()
    expect(within(dialog).queryByRole('combobox')).toBeNull()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave board' }))

    expect(await screen.findByRole('heading', { name: 'My boards' })).toBeInTheDocument()
  })

  describe('presence', () => {
    const ali: OnlineUser = { userId: 1, name: 'Ali Valiyev', color: '#e11d48', role: 'OWNER' }
    const vali: OnlineUser = { userId: 2, name: 'Vali', color: '#2563eb', role: 'VIEWER' }
    const onlineList = () => screen.getByRole('list', { name: 'Online now' })

    it('joins the board room and lists who is online, me first', async () => {
      fakeBackend()
      await openBoard()
      expect(socketState.boardId).toBe(7)
      expect(screen.getByText('Connecting…')).toBeInTheDocument()

      act(() => socketState.join({ online: [vali, ali] }))

      const items = within(onlineList()).getAllByRole('listitem')
      expect(items.map((i) => i.getAttribute('aria-label'))).toEqual(['Ali Valiyev (you) · Owner', 'Vali · Viewer'])
      expect(items[0]).toHaveTextContent('AV')
      expect(items[1]).toHaveStyle({ backgroundColor: '#2563eb' })

      act(() => socketState.require().onPresence([ali]))
      expect(within(onlineList()).getAllByRole('listitem')).toHaveLength(1)
    })

    it('collapses long lists', async () => {
      fakeBackend()
      await openBoard()
      const many = Array.from({ length: 8 }, (_, i): OnlineUser => ({ ...vali, userId: 10 + i, name: `User ${i}` }))

      act(() => socketState.join({ online: [ali, ...many] }))

      const items = within(onlineList()).getAllByRole('listitem')
      expect(items).toHaveLength(6)
      expect(items[5]).toHaveTextContent('+4')
    })

    it('shows when the connection drops and recovers', async () => {
      fakeBackend()
      await openBoard()
      act(() => socketState.join({ online: [ali] }))

      act(() => socketState.require().onStatus('reconnecting'))
      expect(screen.getByText('Connection lost. Reconnecting…')).toBeInTheDocument()

      act(() => socketState.join({ online: [ali, vali] }))
      expect(within(onlineList()).getAllByRole('listitem')).toHaveLength(2)
    })

    it('leaves the room when the page closes', async () => {
      fakeBackend()
      await openBoard()

      await userEvent.click(screen.getByRole('link', { name: /Back to boards/ }))

      expect(await screen.findByRole('heading', { name: 'My boards' })).toBeInTheDocument()
      expect(socketState.closed).toBe(true)
    })

    it('logs out when the socket rejects the token', async () => {
      fakeBackend()
      await openBoard()

      act(() => socketState.require().onUnauthorized())

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    })
  })
})
