import type { BoardRole } from '../api/boards'
import type { RemoteOp } from '../canvas/sync'

/** Mirrors the backend's RealtimeDtos. */
export type OnlineUser = { userId: number; name: string; color: string; role: BoardRole }

/**
 * One-off reply to joining a board room (sent after every (re)connect): the drawing as of `seq`.
 * `shapes` is unvalidated server JSON; parse it with parseCanvasContent.
 */
export type JoinPayload = { boardId: number; userId: number; online: OnlineUser[]; shapes: unknown[]; seq: number }

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting'

/**
 * Another tab's pointer, in canvas coordinates. `cursorId` is per tab (one user may have several).
 * `gone`: the pointer left the canvas or the tab closed.
 */
export type CursorMessage = { cursorId: string; userId: number; x?: number; y?: number; gone?: boolean }

/** `clientOpId` is set when the rejected message was one of our ops. */
export type SocketError = { code: string; message: string; clientOpId?: string }

export type { RemoteOp }
