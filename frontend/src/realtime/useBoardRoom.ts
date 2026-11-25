import { useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext'
import { openBoardSocket } from './connection'
import type { ConnectionStatus, OnlineUser } from './types'

/** Connects to a board's real-time room for as long as the component is mounted. */
export function useBoardRoom(boardId: number) {
  const { logout } = useAuth()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [online, setOnline] = useState<OnlineUser[]>([])

  useEffect(() => {
    const socket = openBoardSocket(boardId, {
      onStatus: setStatus,
      onJoined: (payload) => setOnline(payload.online),
      onPresence: setOnline,
      onError: () => {},
      onUnauthorized: logout,
    })
    return () => socket.close()
  }, [boardId, logout])

  return { status, online }
}
