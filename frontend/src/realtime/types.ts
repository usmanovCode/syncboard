import type { BoardRole } from '../api/boards'
import type { RemoteOp } from '../canvas/sync'
import type { ChatPage } from '../chat/types'

/** Mirrors the backend's RealtimeDtos. */
export type OnlineUser = { userId: number; name: string; color: string; role: BoardRole }

/**
 * One-off reply to joining a board room (sent after every (re)connect): the drawing as of `seq`, and
 * the newest chat messages. `shapes` is unvalidated server JSON; parse it with parseCanvasContent.
 */
export type JoinPayload = {
  boardId: number
  userId: number
  online: OnlineUser[]
  shapes: unknown[]
  seq: number
  chat: ChatPage
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting'

/**
 * Another tab's pointer, in canvas coordinates. `cursorId` is per tab (one user may have several).
 * `gone`: the pointer left the canvas or the tab closed.
 */
export type CursorMessage = { cursorId: string; userId: number; x?: number; y?: number; gone?: boolean }

/** `clientOpId` / `clientMessageId` say which of our ops or chat messages was rejected. */
export type SocketError = { code: string; message: string; clientOpId?: string; clientMessageId?: string }

export type { RemoteOp }
