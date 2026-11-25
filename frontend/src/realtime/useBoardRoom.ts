import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chatApi } from '../api/boards'
import { useAuth } from '../auth/authContext'
import type { BoardOp } from '../canvas/ops'
import { newShapeId, parseCanvasContent } from '../canvas/shapes'
import {
  addPending,
  disconnected,
  initSync,
  receiveOp,
  receiveSnapshot,
  rejectPending,
  viewOf,
  type SyncState,
} from '../canvas/sync'
import type { Point, Shape } from '../canvas/types'
import {
  addPendingMessage,
  discardPendingMessage,
  initChat,
  markRead,
  nextToSend,
  prependOlder,
  receiveChatMessage,
  receiveChatSnapshot,
  rejectPendingMessage,
  retryPendingMessage,
  unreadCount,
  type ChatState,
} from '../chat/chatState'
import { openBoardSocket, type BoardSocket } from './connection'
import type { ConnectionStatus, OnlineUser } from './types'

/** Send our pointer at most this often (the server drops anything faster than 30 ms). */
export const CURSOR_SEND_INTERVAL_MS = 50
/** Hide a cursor that hasn't moved for this long. */
export const CURSOR_STALE_MS = 5000
/** While typing, repeat "typing" this often (the server drops repeats closer than 1 s). */
export const TYPING_REPEAT_MS = 3000
/** Hide someone's "typing…" when it hasn't been repeated for this long. */
export const TYPING_STALE_MS = 5000

/** Another tab's pointer, with the owner's name and color from the online list. */
export type LiveCursor = { cursorId: string; userId: number; x: number; y: number; name: string; color: string }

type CursorEntry = { userId: number; x: number; y: number; at: number }

const roundPoint = (p: Point) => ({ x: Math.round(p.x), y: Math.round(p.y) })

/**
 * A board's real-time room for as long as the component is mounted: the live drawing (`shapes`),
 * who is online, and `sendOp` for local changes. Local ops show immediately; while offline they
 * queue up and are re-sent after reconnecting.
 *
 * At most one op is in flight: the next is sent when the previous one is confirmed (its echo) or
 * rejected. The server handles a client's messages on a thread pool, so this is what keeps one
 * client's ops in order (see WebSocketConfig).
 *
 * Sync state is kept twice: a ref that socket callbacks read and update synchronously (e.g. to
 * re-send pending ops right after a join), and React state, set from the ref, for rendering.
 */
export function useBoardRoom(boardId: number, initialShapes: Shape[], initialSeq: number) {
  const { logout, user } = useAuth()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [online, setOnline] = useState<OnlineUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState>(() => initSync(initialShapes, initialSeq))
  const sync = useRef(syncState)
  const socket = useRef<BoardSocket | null>(null)
  const inFlight = useRef<string | null>(null)
  const selfId = useRef<number | null>(null)
  const [cursors, setCursors] = useState<Record<string, CursorEntry>>({})
  const [chatState, setChatState] = useState<ChatState>(initChat)
  const chat = useRef(chatState)
  const chatInFlight = useRef<string | null>(null)
  /** Joined and still connected: messages written meanwhile wait for the next join. */
  const chatLive = useRef(false)
  /** userId -> when their last "typing" arrived. */
  const [typing, setTyping] = useState<Record<number, number>>({})
  const typingSentAt = useRef<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const update = useCallback((next: SyncState) => {
    sync.current = next
    setSyncState(next)
  }, [])

  const updateChat = useCallback((next: ChatState) => {
    chat.current = next
    setChatState(next)
  }, [])

  // Chat messages also go one at a time, so a tab's messages are stored in the order they were written.
  const pumpChat = useCallback(() => {
    const next = nextToSend(chat.current)
    if (!chatLive.current || chatInFlight.current || !next || !socket.current) return
    chatInFlight.current = next.clientMessageId
    socket.current.send('chat', { clientMessageId: next.clientMessageId, text: next.text })
  }, [])

  const settleChat = useCallback(
    (clientMessageId: string) => {
      if (chatInFlight.current !== clientMessageId) return
      chatInFlight.current = null
      pumpChat()
    },
    [pumpChat],
  )

  const pump = useCallback(() => {
    const { joined, pending } = sync.current
    if (!joined || inFlight.current || pending.length === 0 || !socket.current) return
    inFlight.current = pending[0].clientOpId
    socket.current.send('ops', pending[0])
  }, [])

  const settle = useCallback(
    (clientOpId: string) => {
      if (inFlight.current !== clientOpId) return
      inFlight.current = null
      pump()
    },
    [pump],
  )

  useEffect(() => {
    const s = openBoardSocket(boardId, {
      onStatus: (next) => {
        if (next !== 'connected') {
          inFlight.current = null // re-sent after the next join
          chatInFlight.current = null
          chatLive.current = false
          typingSentAt.current = null // the server ends our "typing" when we disconnect
          update(disconnected(sync.current))
        }
        setStatus(next)
      },
      onJoined: (payload) => {
        selfId.current = payload.userId
        setOnline(payload.online)
        const result = receiveSnapshot(sync.current, parseCanvasContent({ shapes: payload.shapes }), payload.seq)
        update(result.state)
        if (result.gap) return s.rejoin()
        // Ops made while offline (or unconfirmed when the connection dropped) go out again, in order.
        inFlight.current = null
        pump()
        updateChat(receiveChatSnapshot(chat.current, payload.chat, payload.userId))
        chatInFlight.current = null
        chatLive.current = true
        pumpChat()
      },
      onPresence: setOnline,
      onOp: (remote) => {
        const result = receiveOp(sync.current, remote)
        update(result.state)
        if (result.gap) return s.rejoin()
        settle(remote.clientOpId)
      },
      onCursor: (cursor) => {
        if (cursor.userId === selfId.current) return // my other tabs
        setCursors((current) => {
          const next = { ...current }
          if (cursor.gone || cursor.x === undefined || cursor.y === undefined) delete next[cursor.cursorId]
          else next[cursor.cursorId] = { userId: cursor.userId, x: cursor.x, y: cursor.y, at: Date.now() }
          return next
        })
      },
      onChat: (message) => {
        updateChat(receiveChatMessage(chat.current, message, selfId.current ?? 0))
        setTyping((current) => {
          if (!(message.userId in current)) return current
          const next = { ...current }
          delete next[message.userId]
          return next
        })
        if (message.userId === selfId.current) settleChat(message.clientMessageId)
      },
      onTyping: ({ userId, typing: active }) => {
        if (userId === selfId.current) return // my other tabs
        setTyping((current) => {
          const next = { ...current }
          if (active) next[userId] = Date.now()
          else delete next[userId]
          return next
        })
      },
      onError: (err) => {
        if (err.clientMessageId) {
          if (!chat.current.pending.some((p) => p.clientMessageId === err.clientMessageId)) return
          updateChat(rejectPendingMessage(chat.current, err.clientMessageId, err.message))
          settleChat(err.clientMessageId)
          return
        }
        if (!err.clientOpId || !sync.current.pending.some((p) => p.clientOpId === err.clientOpId)) return
        update(rejectPending(sync.current, err.clientOpId))
        setError(err.message)
        settle(err.clientOpId)
      },
      onUnauthorized: logout,
    })
    socket.current = s
    return () => {
      socket.current = null
      s.close()
    }
  }, [boardId, logout, update, pump, settle, updateChat, pumpChat, settleChat])

  const sendOp = useCallback(
    (op: BoardOp) => {
      update(addPending(sync.current, { clientOpId: newShapeId(), op }))
      pump()
    },
    [update, pump],
  )

  const shapes = useMemo(() => viewOf(syncState), [syncState])

  // Re-evaluate staleness once a second.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const liveCursors = useMemo(() => {
    const byUser = new Map(online.map((u) => [u.userId, u]))
    return Object.entries(cursors).flatMap(([cursorId, c]): LiveCursor[] => {
      const user = byUser.get(c.userId)
      // Gone from the online list (disconnected) or idle: don't show a frozen cursor.
      if (!user || now - c.at > CURSOR_STALE_MS) return []
      return [{ cursorId, userId: c.userId, x: c.x, y: c.y, name: user.name, color: user.color }]
    })
  }, [cursors, online, now])

  // Pointer updates are throttled: the first goes out at once, then at most one per interval
  // (always the latest position). "Left the canvas" is sent immediately.
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedCursor = useRef<Point | null>(null)
  const lastCursorAt = useRef(0)

  const sendCursor = useCallback((p: Point | null) => {
    const send = (point: Point | null) => {
      lastCursorAt.current = Date.now()
      socket.current?.send('cursor', point ? roundPoint(point) : { gone: true })
    }
    if (p === null) {
      if (cursorTimer.current) clearTimeout(cursorTimer.current)
      cursorTimer.current = null
      queuedCursor.current = null
      send(null)
      return
    }
    const wait = CURSOR_SEND_INTERVAL_MS - (Date.now() - lastCursorAt.current)
    if (wait <= 0 && !cursorTimer.current) return send(p)
    queuedCursor.current = p
    cursorTimer.current ??= setTimeout(() => {
      cursorTimer.current = null
      if (queuedCursor.current) send(queuedCursor.current)
      queuedCursor.current = null
    }, Math.max(wait, 0))
  }, [])

  useEffect(
    () => () => {
      if (cursorTimer.current) clearTimeout(cursorTimer.current)
    },
    [],
  )

  /** Queues a message (shown at once as pending); it goes out when connected. */
  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      updateChat(addPendingMessage(chat.current, newShapeId(), trimmed))
      typingSentAt.current = null // the server ends "typing" when the message arrives
      pumpChat()
    },
    [updateChat, pumpChat],
  )

  const retryMessage = useCallback(
    (clientMessageId: string) => {
      updateChat(retryPendingMessage(chat.current, clientMessageId))
      pumpChat()
    },
    [updateChat, pumpChat],
  )

  const discardMessage = useCallback(
    (clientMessageId: string) => updateChat(discardPendingMessage(chat.current, clientMessageId)),
    [updateChat],
  )

  /** Loads the page before the oldest message we have. Rejects on failure (the caller shows it). */
  const loadOlderMessages = useCallback(async () => {
    const oldest = chat.current.messages[0]
    if (!oldest) return
    const page = await chatApi.history(boardId, oldest.id)
    updateChat(prependOlder(chat.current, page))
  }, [boardId, updateChat])

  const markChatRead = useCallback(() => updateChat(markRead(chat.current)), [updateChat])

  /** Whether the user is typing a message right now; repeated while true, sent once when it stops. */
  const reportTyping = useCallback((active: boolean) => {
    const now = Date.now()
    if (active) {
      if (typingSentAt.current !== null && now - typingSentAt.current < TYPING_REPEAT_MS) return
      typingSentAt.current = now
      socket.current?.send('typing', { typing: true })
    } else if (typingSentAt.current !== null) {
      typingSentAt.current = null
      socket.current?.send('typing', { typing: false })
    }
  }, [])

  const typingUsers = useMemo(
    () => online.filter((u) => u.userId in typing && now - typing[u.userId] <= TYPING_STALE_MS),
    [online, typing, now],
  )

  return {
    status,
    online,
    shapes,
    /** Local changes the server hasn't confirmed yet. */
    pendingCount: syncState.pending.length,
    sendOp,
    /** Other people's pointers on this board. */
    cursors: liveCursors,
    /** Report our pointer (null when it leaves the canvas). */
    sendCursor,
    /** The last op the server rejected (its change was reverted). */
    error,
    clearError: () => setError(null),
    chat: {
      messages: chatState.messages,
      pending: chatState.pending,
      hasMore: chatState.hasMore,
      unread: unreadCount(chatState, user?.id ?? null),
      /** Online users currently typing (never me). */
      typingUsers,
      send: sendMessage,
      retry: retryMessage,
      discard: discardMessage,
      loadOlder: loadOlderMessages,
      markRead: markChatRead,
      reportTyping,
    },
  }
}
