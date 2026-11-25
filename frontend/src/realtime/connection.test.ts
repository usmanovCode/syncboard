import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setLanguage } from '../i18n'
import { openBoardSocket, type BoardSocketHandlers } from './connection'

// A fake @stomp/stompjs Client: records its config, subscriptions and publishes.
const stomp = vi.hoisted(() => ({
  instance: null as null | {
    config: Record<string, (...args: never[]) => unknown> & { connectHeaders?: Record<string, string> }
    subscriptions: Map<string, (message: { body: string }) => void>
    unsubscribed: string[]
    published: { destination: string; body: string }[]
    connected: boolean
    activated: boolean
    deactivated: boolean
  },
}))

vi.mock('@stomp/stompjs', () => ({
  Client: class {
    connectHeaders: Record<string, string> = {}
    constructor(config: never) {
      stomp.instance = {
        config,
        subscriptions: new Map(),
        unsubscribed: [],
        published: [],
        connected: false,
        activated: false,
        deactivated: false,
      }
      Object.defineProperty(this, 'connected', { get: () => stomp.instance!.connected })
    }
    activate() {
      stomp.instance!.activated = true
    }
    deactivate() {
      stomp.instance!.deactivated = true
      return Promise.resolve()
    }
    subscribe(destination: string, callback: (message: { body: string }) => void) {
      stomp.instance!.subscriptions.set(destination, callback)
      return { unsubscribe: () => stomp.instance!.unsubscribed.push(destination) }
    }
    publish(params: { destination: string; body: string }) {
      stomp.instance!.published.push(params)
    }
  },
}))

function handlers(): BoardSocketHandlers {
  return {
    onStatus: vi.fn(),
    onJoined: vi.fn(),
    onPresence: vi.fn(),
    onOp: vi.fn(),
    onCursor: vi.fn(),
    onError: vi.fn(),
    onUnauthorized: vi.fn(),
  }
}

/** Runs the client's beforeConnect + onConnect, like a successful STOMP connect. */
function connect() {
  const s = stomp.instance!
  const client = { connectHeaders: {} as Record<string, string> }
  s.config.beforeConnect(client as never)
  s.connected = true
  s.config.onConnect({} as never)
  return client.connectHeaders
}

const deliver = (destination: string, body: unknown) =>
  stomp.instance!.subscriptions.get(destination)!({ body: JSON.stringify(body) })

describe('openBoardSocket', () => {
  beforeEach(() => {
    localStorage.setItem('syncboard.accessToken', 'jwt-token')
  })

  it('authenticates with the current token and language on every connect', async () => {
    openBoardSocket(7, handlers())
    expect(connect()).toEqual({ Authorization: 'Bearer jwt-token', 'accept-language': 'en' })

    localStorage.setItem('syncboard.accessToken', 'new-token')
    await setLanguage('ko')
    expect(connect()).toEqual({ Authorization: 'Bearer new-token', 'accept-language': 'ko' })
  })

  it('subscribes to the room, joins once and reports presence', () => {
    const h = handlers()
    openBoardSocket(7, h)
    expect(h.onStatus).toHaveBeenLastCalledWith('connecting')
    expect(stomp.instance!.activated).toBe(true)

    connect()
    expect([...stomp.instance!.subscriptions.keys()]).toEqual([
      '/topic/boards/7/presence',
      '/topic/boards/7/ops',
      '/topic/boards/7/cursors',
      '/user/queue/errors',
      '/app/boards/7/join',
    ])

    const online = [{ userId: 1, name: 'Ali', color: '#e11d48', role: 'OWNER' }]
    const joined = { boardId: 7, userId: 1, online, shapes: [], seq: 4 }
    deliver('/app/boards/7/join', joined)
    expect(h.onJoined).toHaveBeenCalledWith(joined)
    expect(h.onStatus).toHaveBeenLastCalledWith('connected')
    expect(stomp.instance!.unsubscribed).toEqual(['/app/boards/7/join'])

    deliver('/topic/boards/7/presence', [])
    expect(h.onPresence).toHaveBeenCalledWith([])

    const op = { seq: 5, userId: 2, clientOpId: 'x', op: { type: 'remove', id: 's1' } }
    deliver('/topic/boards/7/ops', op)
    expect(h.onOp).toHaveBeenCalledWith(op)

    const cursor = { cursorId: 'c1', userId: 2, x: 1, y: 2 }
    deliver('/topic/boards/7/cursors', cursor)
    expect(h.onCursor).toHaveBeenCalledWith(cursor)
  })

  it('re-joins on request to get a fresh snapshot', () => {
    const h = handlers()
    const socket = openBoardSocket(7, h)
    connect()
    deliver('/app/boards/7/join', { boardId: 7, userId: 1, online: [], shapes: [], seq: 1 })

    socket.rejoin()
    deliver('/app/boards/7/join', { boardId: 7, userId: 1, online: [], shapes: [], seq: 9 })

    expect(h.onJoined).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 9 }))
  })

  it('reports lost connections but not its own close', () => {
    const h = handlers()
    const socket = openBoardSocket(7, h)
    stomp.instance!.config.onWebSocketClose({} as never)
    expect(h.onStatus).toHaveBeenLastCalledWith('reconnecting')

    socket.close()
    expect(stomp.instance!.deactivated).toBe(true)
    vi.mocked(h.onStatus).mockClear()
    stomp.instance!.config.onWebSocketClose({} as never)
    expect(h.onStatus).not.toHaveBeenCalled()
  })

  it('gives up and reports when the token is rejected', () => {
    const h = handlers()
    openBoardSocket(7, h)

    stomp.instance!.config.onStompError({ headers: { message: 'Failed to send message: UNAUTHORIZED' } } as never)

    expect(h.onUnauthorized).toHaveBeenCalled()
    expect(stomp.instance!.deactivated).toBe(true)
  })

  it('publishes to the board only while connected', () => {
    const socket = openBoardSocket(7, handlers())
    socket.send('ops', { a: 1 })
    expect(stomp.instance!.published).toEqual([])

    connect()
    socket.send('ops', { a: 1 })
    expect(stomp.instance!.published).toEqual([{ destination: '/app/boards/7/ops', body: '{"a":1}' }])
  })
})
