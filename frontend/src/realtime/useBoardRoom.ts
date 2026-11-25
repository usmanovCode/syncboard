import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { Shape } from '../canvas/types'
import { openBoardSocket, type BoardSocket } from './connection'
import type { ConnectionStatus, OnlineUser } from './types'

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
  const { logout } = useAuth()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [online, setOnline] = useState<OnlineUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState>(() => initSync(initialShapes, initialSeq))
  const sync = useRef(syncState)
  const socket = useRef<BoardSocket | null>(null)
  const inFlight = useRef<string | null>(null)
  const update = useCallback((next: SyncState) => {
    sync.current = next
    setSyncState(next)
  }, [])

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
          update(disconnected(sync.current))
        }
        setStatus(next)
      },
      onJoined: (payload) => {
        setOnline(payload.online)
        const result = receiveSnapshot(sync.current, parseCanvasContent({ shapes: payload.shapes }), payload.seq)
        update(result.state)
        if (result.gap) return s.rejoin()
        // Ops made while offline (or unconfirmed when the connection dropped) go out again, in order.
        inFlight.current = null
        pump()
      },
      onPresence: setOnline,
      onOp: (remote) => {
        const result = receiveOp(sync.current, remote)
        update(result.state)
        if (result.gap) return s.rejoin()
        settle(remote.clientOpId)
      },
      onError: (err) => {
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
  }, [boardId, logout, update, pump, settle])

  const sendOp = useCallback(
    (op: BoardOp) => {
      update(addPending(sync.current, { clientOpId: newShapeId(), op }))
      pump()
    },
    [update, pump],
  )

  const shapes = useMemo(() => viewOf(syncState), [syncState])

  return {
    status,
    online,
    shapes,
    /** Local changes the server hasn't confirmed yet. */
    pendingCount: syncState.pending.length,
    sendOp,
    /** The last op the server rejected (its change was reverted). */
    error,
    clearError: () => setError(null),
  }
}
