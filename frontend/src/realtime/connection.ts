import { Client, type IMessage } from '@stomp/stompjs'
import { tokenStorage } from '../api/client'
import { currentLanguage } from '../i18n'
import type { ConnectionStatus, JoinPayload, OnlineUser, SocketError } from './types'

export type BoardSocketHandlers = {
  onStatus: (status: ConnectionStatus) => void
  /** After every (re)connect, with the room's current state. */
  onJoined: (payload: JoinPayload) => void
  onPresence: (online: OnlineUser[]) => void
  onError: (error: SocketError) => void
  /** The server refused the token (e.g. expired): reconnecting won't help. */
  onUnauthorized: () => void
}

export type BoardSocket = {
  /** Sends to /app/boards/{id}/{path}; dropped while disconnected. */
  send: (path: string, body: unknown) => void
  close: () => void
}

/** Same host as the page, so it goes through the Vite dev proxy like /api does. */
function socketUrl() {
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
}

const parse = <T,>(message: IMessage) => JSON.parse(message.body) as T

/**
 * One STOMP connection per open board page. Reconnects automatically; each connect re-subscribes
 * and re-joins, so the caller always gets a fresh onJoined. This is the only module that talks to
 * @stomp/stompjs (tests replace it, see src/test/socketMock.ts).
 */
export function openBoardSocket(boardId: number, handlers: BoardSocketHandlers): BoardSocket {
  const topic = (name: string) => `/topic/boards/${boardId}/${name}`
  let closed = false

  const client = new Client({
    brokerURL: socketUrl(),
    reconnectDelay: 2000,
    heartbeatIncoming: 10_000,
    heartbeatOutgoing: 10_000,
    // Read the token and language at every attempt, not once.
    beforeConnect: (c) => {
      c.connectHeaders = {
        Authorization: `Bearer ${tokenStorage.get() ?? ''}`,
        'accept-language': currentLanguage(),
      }
    },
    onConnect: () => {
      client.subscribe(topic('presence'), (m) => handlers.onPresence(parse<OnlineUser[]>(m)))
      client.subscribe('/user/queue/errors', (m) => handlers.onError(parse<SocketError>(m)))
      // Subscribing here gets a single reply (server @SubscribeMapping), not a stream.
      const join = client.subscribe(`/app/boards/${boardId}/join`, (m) => {
        join.unsubscribe()
        handlers.onJoined(parse<JoinPayload>(m))
        handlers.onStatus('connected')
      })
    },
    onWebSocketClose: () => {
      if (!closed) handlers.onStatus('reconnecting')
    },
    onStompError: (frame) => {
      if (frame.headers.message?.includes('UNAUTHORIZED')) {
        closed = true
        void client.deactivate()
        handlers.onUnauthorized()
      }
    },
  })

  handlers.onStatus('connecting')
  client.activate()

  return {
    send: (path, body) => {
      if (client.connected) client.publish({ destination: `/app/boards/${boardId}/${path}`, body: JSON.stringify(body) })
    },
    close: () => {
      closed = true
      void client.deactivate()
    },
  }
}
