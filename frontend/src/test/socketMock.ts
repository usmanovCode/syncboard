/**
 * Stand-in for src/realtime/connection.ts. Tests drive the server side through `socketState`:
 * `socketState.join(...)`, `socketState.handlers.onPresence(...)`, and read `socketState.sent`.
 *
 * Usage in a test file:  vi.mock('../realtime/connection', () => import('../test/socketMock'))
 */
import type { BoardSocket, BoardSocketHandlers } from '../realtime/connection'
import type { JoinPayload } from '../realtime/types'

type Sent = { path: string; body: unknown }

export const socketState = {
  handlers: null as BoardSocketHandlers | null,
  boardId: null as number | null,
  sent: [] as Sent[],
  closed: false,
  reset() {
    this.handlers = null
    this.boardId = null
    this.sent = []
    this.closed = false
  },
  /** Simulates a successful (re)connect: the join reply, then status "connected". */
  join(payload: Partial<JoinPayload> = {}) {
    const h = this.require()
    h.onJoined({ boardId: this.boardId ?? 0, userId: 1, online: [], ...payload })
    h.onStatus('connected')
  },
  require(): BoardSocketHandlers {
    if (!this.handlers) throw new Error('No board socket is open')
    return this.handlers
  },
}

export function openBoardSocket(boardId: number, handlers: BoardSocketHandlers): BoardSocket {
  socketState.handlers = handlers
  socketState.boardId = boardId
  socketState.closed = false
  handlers.onStatus('connecting')
  return {
    send: (path, body) => socketState.sent.push({ path, body }),
    close: () => {
      socketState.closed = true
    },
  }
}
