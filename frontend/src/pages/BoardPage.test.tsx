import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Board, BoardRole, Member } from '../api/boards'
import { AuthProvider } from '../auth/AuthProvider'
import type { BoardOp } from '../canvas/ops'
import type { PendingOp } from '../canvas/sync'
import type { Shape } from '../canvas/types'
import type { ChatMessage, ChatPage } from '../chat/types'
import { setLanguage } from '../i18n'
import type { OnlineUser } from '../realtime/types'
import { CURSOR_SEND_INTERVAL_MS, CURSOR_STALE_MS, TYPING_REPEAT_MS, TYPING_STALE_MS } from '../realtime/useBoardRoom'
import { konvaState } from '../test/konvaMock'
import { socketState } from '../test/socketMock'

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
const SEQ = 3

function jsonResponse(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Fake REST backend for one board (the drawing itself goes over the mocked socket). */
function fakeBackend({
  shapes = [EXISTING],
  getStatus = 200,
  role = 'OWNER' as BoardRole,
  members = [OWNER_MEMBER],
  olderMessages = { messages: [], hasMore: false } as ChatPage | 'error',
} = {}) {
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
    if (url.startsWith('/api/boards/7/messages?before=') && method === 'GET') {
      if (olderMessages === 'error') return jsonResponse(500, { code: 'INTERNAL', detail: 'Server error' })
      return jsonResponse(200, olderMessages)
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
        canvas: { content: { schemaVersion: 1, shapes }, version: SEQ, updatedAt: BOARD.updatedAt },
      })
    }
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock }
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

/** A fake server side of the room: sequence numbers and echoes. */
const server = {
  seq: SEQ,
  echoed: 0,
  reset() {
    this.seq = SEQ
    this.echoed = 0
  },
  /** Ops our client has sent so far. */
  sent(): PendingOp[] {
    return socketState.sent.filter((s) => s.path === 'ops').map((s) => s.body as PendingOp)
  },
  /** Accepts everything sent so far (and whatever the client sends in response), in order. */
  acceptAll() {
    while (this.echoed < this.sent().length) {
      const { clientOpId, op } = this.sent()[this.echoed++]
      act(() => socketState.require().onOp({ seq: ++this.seq, userId: ME.id, clientOpId, op }))
    }
  },
  /** An op by someone else. */
  remote(op: BoardOp) {
    act(() => socketState.require().onOp({ seq: ++this.seq, userId: 2, clientOpId: `other-${this.seq}`, op }))
  },
}

async function openBoard({ join = true, shapes = [EXISTING] } = {}) {
  renderAt('/boards/7')
  await screen.findByRole('heading', { name: BOARD.name })
  // The board loads outside act(); flush effects so the keyboard listener is attached.
  await act(async () => {})
  if (join) act(() => socketState.join({ shapes, seq: SEQ }))
}

const tool = (name: RegExp) => screen.getByRole('button', { name })
const stage = () => screen.getByTestId('stage')
const shapes = () => screen.queryAllByTestId('shape')
const syncStatus = () => screen.getByRole('status')
const sentOps = () => server.sent().map((p) => p.op)

/** Drags on the stage from one point to another. */
function dragOnStage(from: [number, number], to: [number, number]) {
  konvaState.pointer = { x: from[0], y: from[1] }
  fireEvent.pointerDown(stage())
  konvaState.pointer = { x: to[0], y: to[1] }
  fireEvent.pointerMove(stage())
  fireEvent.pointerUp(stage())
}

describe('BoardPage', () => {
  beforeEach(() => {
    localStorage.setItem('syncboard.accessToken', 'jwt-token')
    konvaState.reset()
    socketState.reset()
    server.reset()
  })

  it('opens from the dashboard and shows the drawing', async () => {
    fakeBackend()
    renderAt('/')

    await userEvent.click(await screen.findByRole('link', { name: BOARD.name }))

    expect(await screen.findByRole('heading', { name: BOARD.name })).toBeInTheDocument()
    expect(shapes()).toHaveLength(1)
    expect(shapes()[0]).toHaveAttribute('data-kind', 'Rect')
    expect(tool(/^Pen/)).toHaveAttribute('aria-pressed', 'true')
    expect(syncStatus()).toHaveTextContent('All changes saved')
    expect(tool(/^Undo/)).toBeDisabled()
  })

  it('shows the live drawing from the room once joined', async () => {
    fakeBackend()
    await openBoard({ join: false })
    expect(shapes()).toHaveLength(1) // REST content, for the first paint

    const live: Shape = { ...EXISTING, id: 'r2', x: 300 }
    act(() => socketState.join({ shapes: [EXISTING, live], seq: 10 }))

    expect(shapes()).toHaveLength(2)
  })

  it('sends a drawn rectangle as an op and shows it until confirmed', async () => {
    fakeBackend()
    await openBoard()

    await userEvent.click(tool(/^Rectangle/))
    dragOnStage([100, 100], [160, 130])

    expect(shapes()).toHaveLength(2)
    expect(sentOps()).toEqual([
      { type: 'add', shape: expect.objectContaining({ type: 'rect', x: 100, y: 100, width: 60, height: 30 }) },
    ])
    expect(syncStatus()).toHaveTextContent('Saving…')

    server.acceptAll()
    expect(syncStatus()).toHaveTextContent('All changes saved')
    expect(shapes()).toHaveLength(2)
  })

  it('ignores clicks that do not draw anything', async () => {
    fakeBackend()
    await openBoard()

    await userEvent.click(tool(/^Line/))
    dragOnStage([50, 50], [50, 50])

    expect(shapes()).toHaveLength(1)
    expect(sentOps()).toEqual([])
  })

  it('keeps one op in flight and sends the next after the echo', async () => {
    fakeBackend()
    await openBoard()

    dragOnStage([0, 0], [20, 20])
    dragOnStage([30, 30], [40, 40])

    expect(shapes()).toHaveLength(3) // both visible right away
    expect(sentOps()).toHaveLength(1) // but only one sent
    server.acceptAll()
    expect(sentOps()).toHaveLength(2)
    expect(syncStatus()).toHaveTextContent('All changes saved')
  })

  it('shows changes made by others', async () => {
    fakeBackend()
    await openBoard()

    server.remote({ type: 'add', shape: { ...EXISTING, id: 'theirs', x: 200 } })
    expect(shapes()).toHaveLength(2)
    server.remote({ type: 'remove', id: 'r1' })
    expect(shapes().map((s) => s.getAttribute('data-id'))).toEqual(['theirs'])
  })

  it('undoes and redoes my changes with the buttons and the keyboard', async () => {
    fakeBackend()
    await openBoard()
    dragOnStage([0, 0], [20, 20]) // pen
    server.acceptAll()
    const penId = (sentOps()[0] as { shape: Shape }).shape.id

    await userEvent.click(tool(/^Undo/))
    expect(shapes()).toHaveLength(1)
    server.acceptAll()
    await userEvent.click(tool(/^Redo/))
    expect(shapes()).toHaveLength(2)
    server.acceptAll()

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(shapes()).toHaveLength(1)
    server.acceptAll()
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(shapes()).toHaveLength(2)
    server.acceptAll()

    expect(sentOps().map((op) => op.type)).toEqual(['add', 'remove', 'add', 'remove', 'add'])
    expect(sentOps()[1]).toEqual({ type: 'remove', id: penId })
  })

  it("doesn't undo other people's work", async () => {
    fakeBackend()
    await openBoard()
    dragOnStage([0, 0], [20, 20])
    server.acceptAll()
    server.remote({ type: 'add', shape: { ...EXISTING, id: 'theirs' } })

    await userEvent.click(tool(/^Undo/))
    server.acceptAll()

    expect(shapes().map((s) => s.getAttribute('data-id'))).toEqual(['r1', 'theirs'])
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
    fakeBackend()
    await openBoard()

    await userEvent.click(tool(/^Eraser/))
    konvaState.hit = 'r1'
    fireEvent.pointerDown(stage())
    fireEvent.pointerUp(stage())

    expect(shapes()).toHaveLength(0)
    expect(sentOps()).toEqual([{ type: 'remove', id: 'r1' }])
  })

  it('selects, moves, recolors and deletes a shape', async () => {
    fakeBackend()
    await openBoard()
    await userEvent.click(tool(/^Select/))

    fireEvent.pointerDown(shapes()[0])
    const onDragEnd = konvaState.props.get('r1')?.onDragEnd as (e: unknown) => void
    act(() => onDragEnd({ target: { x: () => 200, y: () => 150 } }))
    server.acceptAll()
    await userEvent.click(screen.getByRole('button', { name: 'Red' }))
    server.acceptAll()

    expect(shapes()[0]).toHaveAttribute('data-stroke', '#ef4444')
    expect(sentOps()).toEqual([
      { type: 'update', shape: expect.objectContaining({ id: 'r1', x: 200, y: 150, stroke: '#1e293b' }) },
      { type: 'update', shape: expect.objectContaining({ id: 'r1', x: 200, y: 150, stroke: '#ef4444' }) },
    ])

    fireEvent.keyDown(window, { key: 'Delete' })
    expect(shapes()).toHaveLength(0)
  })

  it('drops the selection when someone else deletes the shape', async () => {
    fakeBackend()
    await openBoard()
    await userEvent.click(tool(/^Select/))
    fireEvent.pointerDown(shapes()[0])

    server.remote({ type: 'remove', id: 'r1' })
    await userEvent.click(screen.getByRole('button', { name: 'Red' }))

    expect(sentOps()).toEqual([]) // nothing selected any more, so nothing to recolor
  })

  it('applies the chosen color and thickness to new shapes', async () => {
    fakeBackend({ shapes: [] })
    await openBoard({ shapes: [] })

    await userEvent.click(screen.getByRole('button', { name: 'Blue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Thick' }))
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true')
    dragOnStage([0, 0], [10, 10])

    expect(sentOps()[0]).toEqual({
      type: 'add',
      shape: expect.objectContaining({ type: 'pen', stroke: '#3b82f6', strokeWidth: 8 }),
    })
  })

  it('adds text with the text tool', async () => {
    fakeBackend({ shapes: [] })
    await openBoard({ shapes: [] })

    await userEvent.click(tool(/^Text/))
    konvaState.pointer = { x: 30, y: 40 }
    fireEvent.pointerDown(stage())
    // Typing a shortcut letter in the text box must not switch tools.
    await userEvent.type(screen.getByRole('textbox', { name: 'Text' }), 'Salom Rr{Enter}')

    expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull()
    expect(shapes()).toHaveLength(1)
    expect(shapes()[0]).toHaveTextContent('Salom Rr')
    expect(tool(/^Text/)).toHaveAttribute('aria-pressed', 'true')
    expect(sentOps()).toEqual([
      { type: 'add', shape: expect.objectContaining({ type: 'text', x: 30, y: 40, text: 'Salom Rr' }) },
    ])
  })

  it('cancels text with Escape', async () => {
    fakeBackend({ shapes: [] })
    await openBoard({ shapes: [] })

    await userEvent.click(tool(/^Text/))
    fireEvent.pointerDown(stage())
    await userEvent.type(screen.getByRole('textbox', { name: 'Text' }), 'Salom{Escape}')

    expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull()
    expect(shapes()).toHaveLength(0)
    expect(sentOps()).toEqual([])
  })

  it('queues changes while offline and sends them after reconnecting', async () => {
    fakeBackend()
    await openBoard()
    act(() => socketState.require().onStatus('reconnecting'))

    dragOnStage([0, 0], [20, 20])
    expect(shapes()).toHaveLength(2)
    expect(sentOps()).toEqual([])
    expect(syncStatus()).toHaveTextContent('Offline')

    act(() => socketState.join({ shapes: [EXISTING], seq: SEQ }))
    expect(sentOps()).toHaveLength(1)
    server.acceptAll()
    expect(syncStatus()).toHaveTextContent('All changes saved')
    expect(shapes()).toHaveLength(2)
  })

  it('reverts a change the server rejects and says why', async () => {
    fakeBackend()
    await openBoard()
    dragOnStage([0, 0], [20, 20])
    const [{ clientOpId }] = server.sent()

    act(() =>
      socketState.require().onError({ code: 'INVALID_OP', message: 'This change could not be applied', clientOpId }),
    )

    expect(shapes()).toHaveLength(1)
    expect(screen.getByRole('alert')).toHaveTextContent('This change could not be applied')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ignores errors about ops that are not ours', async () => {
    fakeBackend()
    await openBoard()

    act(() => socketState.require().onError({ code: 'INVALID_OP', message: 'x', clientOpId: 'other-tab' }))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('re-joins when an op was missed', async () => {
    fakeBackend()
    await openBoard()

    act(() => socketState.require().onOp({ seq: SEQ + 5, userId: 2, clientOpId: 'x', op: { type: 'remove', id: 'r1' } }))

    expect(socketState.rejoins).toBe(1)
    expect(shapes()).toHaveLength(1) // not applied out of order
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
    expect(syncStatus()).toHaveTextContent('모든 변경 사항이 저장됨')
  })

  it('gives viewers a read-only canvas', async () => {
    fakeBackend({ role: 'VIEWER' })
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
    expect(sentOps()).toEqual([])
  })

  describe('sharing', () => {
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
      const me: Member = { userId: 1, email: ME.email, fullName: ME.fullName, role: 'EDITOR' }
      const owner: Member = { userId: 9, email: 'sobir@example.com', fullName: 'Sobir', role: 'OWNER' }
      fakeBackend({ role: 'EDITOR', members: [owner, me] })
      await openBoard()

      await userEvent.click(screen.getByRole('button', { name: 'Share' }))
      const dialog = screen.getByRole('dialog')
      expect(await within(dialog).findByRole('listitem', { name: 'Sobir' })).toHaveTextContent('Owner')
      expect(within(dialog).queryByLabelText('Email')).toBeNull()
      expect(within(dialog).queryByRole('combobox')).toBeNull()

      await userEvent.click(within(dialog).getByRole('button', { name: 'Leave board' }))

      expect(await screen.findByRole('heading', { name: 'My boards' })).toBeInTheDocument()
    })
  })

  describe('presence', () => {
    const ali: OnlineUser = { userId: 1, name: 'Ali Valiyev', color: '#e11d48', role: 'OWNER' }
    const vali: OnlineUser = { userId: 2, name: 'Vali', color: '#2563eb', role: 'VIEWER' }
    const onlineList = () => screen.getByRole('list', { name: 'Online now' })

    it('joins the board room and lists who is online, me first', async () => {
      fakeBackend()
      await openBoard({ join: false })
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
      await openBoard({ join: false })
      const many = Array.from({ length: 8 }, (_, i): OnlineUser => ({ ...vali, userId: 10 + i, name: `User ${i}` }))

      act(() => socketState.join({ online: [ali, ...many] }))

      const items = within(onlineList()).getAllByRole('listitem')
      expect(items).toHaveLength(6)
      expect(items[5]).toHaveTextContent('+4')
    })

    it('shows when the connection drops and recovers', async () => {
      fakeBackend()
      await openBoard({ join: false })
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

  describe('live cursors', () => {
    const ali: OnlineUser = { userId: 1, name: 'Ali Valiyev', color: '#e11d48', role: 'OWNER' }
    const vali: OnlineUser = { userId: 2, name: 'Vali', color: '#2563eb', role: 'VIEWER' }
    const cursors = () => screen.queryAllByTestId('cursor')
    const sentCursors = () => socketState.sent.filter((s) => s.path === 'cursor').map((s) => s.body)
    const cursorAt = (cursorId: string, userId: number, x: number, y: number) =>
      act(() => socketState.require().onCursor({ cursorId, userId, x, y }))

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    async function openShared() {
      fakeBackend()
      await openBoard({ join: false })
      act(() => socketState.join({ userId: ali.userId, online: [ali, vali], shapes: [EXISTING], seq: SEQ }))
    }

    it("shows other people's cursors with their name and color", async () => {
      await openShared()

      cursorAt('tab-a', vali.userId, 120, 80)

      expect(cursors()).toHaveLength(1)
      expect(cursors()[0]).toHaveTextContent('Vali')
      expect(cursors()[0]).toHaveStyle({ transform: 'translate(120px, 80px)' })
      expect(within(cursors()[0]).getByText('Vali')).toHaveStyle({ backgroundColor: '#2563eb' })

      cursorAt('tab-a', vali.userId, 130, 90)
      expect(cursors()).toHaveLength(1)
      expect(cursors()[0]).toHaveStyle({ transform: 'translate(130px, 90px)' })
    })

    it('shows one cursor per tab, but none for my own other tabs', async () => {
      await openShared()

      cursorAt('tab-a', vali.userId, 1, 1)
      cursorAt('tab-b', vali.userId, 2, 2)
      cursorAt('my-other-tab', ali.userId, 3, 3)

      expect(cursors()).toHaveLength(2)
    })

    it('removes cursors that leave, go idle, or whose user goes offline', async () => {
      await openShared()
      cursorAt('tab-a', vali.userId, 1, 1)

      act(() => socketState.require().onCursor({ cursorId: 'tab-a', userId: vali.userId, gone: true }))
      expect(cursors()).toHaveLength(0)

      cursorAt('tab-a', vali.userId, 1, 1)
      await act(() => vi.advanceTimersByTimeAsync(CURSOR_STALE_MS + 1000))
      expect(cursors()).toHaveLength(0)

      cursorAt('tab-a', vali.userId, 1, 1)
      act(() => socketState.require().onPresence([ali]))
      expect(cursors()).toHaveLength(0)
    })

    it('sends my pointer, throttled, and tells others when it leaves', async () => {
      await openShared()

      konvaState.pointer = { x: 10.4, y: 20.6 }
      fireEvent.pointerMove(stage())
      konvaState.pointer = { x: 11, y: 21 }
      fireEvent.pointerMove(stage())
      konvaState.pointer = { x: 12, y: 22 }
      fireEvent.pointerMove(stage())
      expect(sentCursors()).toEqual([{ x: 10, y: 21 }]) // rounded; the rest waits for the interval

      await act(() => vi.advanceTimersByTimeAsync(CURSOR_SEND_INTERVAL_MS))
      expect(sentCursors()).toEqual([{ x: 10, y: 21 }, { x: 12, y: 22 }]) // only the latest

      fireEvent.pointerLeave(stage())
      expect(sentCursors().at(-1)).toEqual({ gone: true })
    })

    it('viewers share their cursor too', async () => {
      fakeBackend({ role: 'VIEWER' })
      await openBoard()

      konvaState.pointer = { x: 5, y: 6 }
      fireEvent.pointerMove(stage())

      expect(sentCursors()).toEqual([{ x: 5, y: 6 }])
    })
  })

  describe('chat', () => {
    const ali: OnlineUser = { userId: 1, name: 'Ali Valiyev', color: '#e11d48', role: 'OWNER' }
    const vali: OnlineUser = { userId: 2, name: 'Vali', color: '#2563eb', role: 'VIEWER' }
    const gani: OnlineUser = { userId: 3, name: "G'ani", color: '#16a34a', role: 'EDITOR' }
    const sobir: OnlineUser = { userId: 4, name: 'Sobir', color: '#7c3aed', role: 'VIEWER' }
    let nextId = 100
    const message = (userId: number, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => {
      const id = nextId++
      const author = [ali, vali, gani, sobir].find((u) => u.userId === userId)!
      return {
        id,
        userId,
        userName: author.name,
        color: author.color,
        text,
        createdAt: new Date().toISOString(),
        clientMessageId: `c${id}`,
        ...extra,
      }
    }
    const log = () => screen.getByRole('log', { name: 'Chat messages' })
    const input = () => screen.getByRole('textbox', { name: 'Message' })
    const sentChat = () =>
      socketState.sent.filter((s) => s.path === 'chat').map((s) => s.body as { clientMessageId: string; text: string })
    const sentTyping = () => socketState.sent.filter((s) => s.path === 'typing').map((s) => s.body)
    const receive = (m: ChatMessage) => act(() => socketState.require().onChat(m))
    const echo = (sent: { clientMessageId: string; text: string }) =>
      receive(message(ali.userId, sent.text, { clientMessageId: sent.clientMessageId }))

    async function openChat({
      role = 'OWNER' as BoardRole,
      history = [] as ChatMessage[],
      hasMore = false,
      older = { messages: [], hasMore: false } as ChatPage | 'error',
    } = {}) {
      fakeBackend({ role, olderMessages: older })
      await openBoard({ join: false })
      act(() =>
        socketState.join({ userId: ali.userId, online: [ali, vali, gani, sobir], chat: { messages: history, hasMore } }),
      )
    }

    it('shows the history from the join reply, grouped by author', async () => {
      await openChat({ history: [message(2, 'Salom!'), message(2, 'Qalaysiz?'), message(1, 'Yaxshi')] })

      const items = within(log()).getAllByRole('listitem')
      expect(items).toHaveLength(3)
      expect(items[0]).toHaveTextContent('Vali')
      expect(items[0]).toHaveTextContent('Salom!')
      expect(items[1]).not.toHaveTextContent('Vali') // same author: no new name line
      expect(items[2]).toHaveTextContent('You')
      expect(within(items[0]).getByText('Vali')).toHaveStyle({ color: '#2563eb' })
    })

    it('says when there are no messages yet', async () => {
      await openChat()

      expect(within(log()).getByText('No messages yet. Say hello!')).toBeInTheDocument()
    })

    it('sends with Enter and shows the message as pending until the server confirms it', async () => {
      await openChat()

      await userEvent.type(input(), '  Salom hammaga  {Enter}')

      expect(input()).toHaveValue('')
      expect(sentChat()).toEqual([{ clientMessageId: expect.any(String), text: 'Salom hammaga' }])
      expect(within(log()).getByText('Sending…')).toBeInTheDocument()

      echo(sentChat()[0])
      expect(within(log()).queryByText('Sending…')).toBeNull()
      expect(within(log()).getAllByText('Salom hammaga')).toHaveLength(1)
    })

    it('adds a new line with Shift+Enter and ignores empty messages', async () => {
      await openChat()

      await userEvent.type(input(), '   {Enter}')
      expect(sentChat()).toEqual([])
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

      await userEvent.type(input(), 'bir{Shift>}{Enter}{/Shift}ikki')
      expect(input()).toHaveValue('   bir\nikki')
      await userEvent.click(screen.getByRole('button', { name: 'Send' }))
      expect(sentChat().map((m) => m.text)).toEqual(['bir\nikki'])
    })

    it("doesn't send while a Korean IME is composing", async () => {
      await openChat()
      await userEvent.type(input(), '안녕')

      fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
      expect(sentChat()).toEqual([])

      fireEvent.keyDown(input(), { key: 'Enter' })
      expect(sentChat().map((m) => m.text)).toEqual(['안녕'])
    })

    it('keeps one message in flight and sends the next after the echo', async () => {
      await openChat()

      await userEvent.type(input(), 'bir{Enter}ikki{Enter}')
      expect(sentChat().map((m) => m.text)).toEqual(['bir'])

      echo(sentChat()[0])
      expect(sentChat().map((m) => m.text)).toEqual(['bir', 'ikki'])
    })

    it("shows other people's messages as they arrive, in server order", async () => {
      await openChat()
      const first = message(2, 'birinchi')
      const second = message(3, 'ikkinchi')

      receive(second)
      receive(first)
      receive(second) // duplicate

      const items = within(log()).getAllByRole('listitem')
      expect(items).toHaveLength(2)
      expect(items[0]).toHaveTextContent('birinchi')
      expect(items[1]).toHaveTextContent('ikkinchi')
    })

    it('lets viewers write', async () => {
      await openChat({ role: 'VIEWER' })
      expect(screen.queryByRole('toolbar')).toBeNull()

      await userEvent.type(input(), 'Men faqat kuzataman{Enter}')

      expect(sentChat().map((m) => m.text)).toEqual(['Men faqat kuzataman'])
    })

    it('marks a rejected message as not sent and can retry or discard it', async () => {
      await openChat()
      await userEvent.type(input(), 'Salom{Enter}')
      const { clientMessageId } = sentChat()[0]

      act(() => socketState.require().onError({ code: 'BOARD_NOT_FOUND', message: 'Board not found', clientMessageId }))
      expect(within(log()).getByText('Not sent: Board not found')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull() // not the drawing's error banner

      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(sentChat()).toHaveLength(2)
      expect(sentChat()[1].clientMessageId).toBe(clientMessageId) // same id: safe to re-send

      act(() => socketState.require().onError({ code: 'X', message: 'Nope', clientMessageId }))
      await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
      expect(within(log()).queryByText('Salom')).toBeNull()
    })

    it('queues messages while offline and sends them after rejoining', async () => {
      await openChat()
      act(() => socketState.require().onStatus('reconnecting'))

      await userEvent.type(input(), 'Oflayn{Enter}')
      expect(sentChat()).toEqual([])

      act(() => socketState.join({ userId: ali.userId, online: [ali] }))
      expect(sentChat().map((m) => m.text)).toEqual(['Oflayn'])
    })

    it('loads older messages on request', async () => {
      const older = { messages: [message(2, 'eski xabar')], hasMore: false }
      const latest = message(2, 'yangi xabar')
      await openChat({ history: [latest], hasMore: true, older })

      await userEvent.click(screen.getByRole('button', { name: 'Load older messages' }))

      expect(await within(log()).findByText('eski xabar')).toBeInTheDocument()
      const items = within(log()).getAllByRole('listitem')
      expect(items[0]).toHaveTextContent('eski xabar')
      expect(items[1]).toHaveTextContent('yangi xabar')
      expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull()
      expect(fetch).toHaveBeenCalledWith(`/api/boards/7/messages?before=${latest.id}`, expect.anything())
    })

    it('says when older messages could not be loaded', async () => {
      await openChat({ history: [message(2, 'yangi')], hasMore: true, older: 'error' })

      await userEvent.click(screen.getByRole('button', { name: 'Load older messages' }))

      expect(await within(log()).findByRole('alert')).toHaveTextContent("Couldn't load older messages.")
    })

    it('collapses, remembers that, and counts unread messages meanwhile', async () => {
      await openChat({ history: [message(2, 'eski')] })
      const toggle = screen.getByRole('button', { name: 'Chat' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')

      await userEvent.click(screen.getByRole('button', { name: 'Close chat' }))
      expect(screen.queryByRole('log')).toBeNull()
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(localStorage.getItem('syncboard.chatOpen')).toBe('false')
      expect(screen.queryByLabelText(/unread/)).toBeNull() // the history isn't new

      receive(message(2, 'bir'))
      receive(message(3, 'ikki'))
      expect(screen.getByLabelText('2 unread')).toHaveTextContent('2')

      await userEvent.click(toggle)
      expect(log()).toBeInTheDocument()
      expect(screen.queryByLabelText(/unread/)).toBeNull()
      expect(localStorage.getItem('syncboard.chatOpen')).toBe('true')
    })

    it('starts collapsed when it was closed last time', async () => {
      localStorage.setItem('syncboard.chatOpen', 'false')
      await openChat()

      expect(screen.queryByRole('log')).toBeNull()
      expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-expanded', 'false')
    })

    it("doesn't switch drawing tools while typing a message", async () => {
      await openChat()

      await userEvent.type(input(), 'r')

      expect(tool(/Pen/)).toHaveAttribute('aria-pressed', 'true')
    })

    it('is translated to Korean', async () => {
      await setLanguage('ko')
      await openChat()

      expect(screen.getByRole('log', { name: '채팅 메시지' })).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: '메시지' })).toHaveAttribute('placeholder', '메시지를 입력하세요…')
      act(() => socketState.require().onTyping({ userId: vali.userId, typing: true }))
      expect(screen.getByText('Vali 님이 입력 중…')).toBeInTheDocument()
    })

    describe('typing indicator', () => {
      beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true })
      })
      afterEach(() => {
        vi.useRealTimers()
      })
      const typing = (userId: number, active = true) =>
        act(() => socketState.require().onTyping({ userId, typing: active }))
      const typingLine = () => screen.queryByText(/typing…$/)

      it('shows who is typing, and hides it when they stop, send or go quiet', async () => {
        await openChat()

        typing(vali.userId)
        expect(typingLine()).toHaveTextContent('Vali is typing…')
        typing(gani.userId)
        expect(typingLine()).toHaveTextContent("Vali and G'ani are typing…")
        typing(sobir.userId)
        expect(typingLine()).toHaveTextContent('Several people are typing…')

        typing(sobir.userId, false)
        receive(message(gani.userId, 'Tayyor'))
        expect(typingLine()).toHaveTextContent('Vali is typing…')

        await act(() => vi.advanceTimersByTimeAsync(TYPING_STALE_MS + 1000))
        expect(typingLine()).toBeNull()
      })

      it("ignores my own tabs and people who aren't online", async () => {
        await openChat()

        typing(ali.userId)
        typing(99)
        expect(typingLine()).toBeNull()

        typing(vali.userId)
        act(() => socketState.require().onPresence([ali]))
        expect(typingLine()).toBeNull()
      })

      it('announces my typing, repeated while I type, and its end', async () => {
        await openChat()

        await userEvent.type(input(), 'Sa')
        expect(sentTyping()).toEqual([{ typing: true }]) // not once per key

        await act(() => vi.advanceTimersByTimeAsync(TYPING_REPEAT_MS))
        await userEvent.type(input(), 'l')
        expect(sentTyping()).toEqual([{ typing: true }, { typing: true }])

        await userEvent.clear(input())
        expect(sentTyping().at(-1)).toEqual({ typing: false })

        await userEvent.type(input(), 'om')
        await userEvent.tab()
        expect(sentTyping().at(-1)).toEqual({ typing: false })
      })

      it("doesn't send a separate stop after a message (the server ends typing)", async () => {
        await openChat()

        await userEvent.type(input(), 'Salom{Enter}')

        expect(sentTyping()).toEqual([{ typing: true }])
      })
    })
  })
})
