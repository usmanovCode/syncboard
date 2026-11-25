import type { BoardRole } from '../api/boards'

/** Mirrors the backend's RealtimeDtos. */
export type OnlineUser = { userId: number; name: string; color: string; role: BoardRole }

/** One-off reply to joining a board room (sent after every (re)connect). */
export type JoinPayload = { boardId: number; userId: number; online: OnlineUser[] }

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting'

export type SocketError = { code: string; message: string }
