import type { TFunction } from 'i18next'
import { apiFetch } from './client'

/** The caller's role on a board. Owners manage it, editors draw, viewers only watch. */
export type BoardRole = 'OWNER' | 'EDITOR' | 'VIEWER'
/** Roles that can be given when sharing. */
export type MemberRole = Exclude<BoardRole, 'OWNER'>

export const canEdit = (role: BoardRole) => role !== 'VIEWER'

/** A drawing canvas, as seen by the current user (`role`). */
export type Board = {
  id: number
  name: string
  ownerId: number
  ownerName: string
  role: BoardRole
  createdAt: string
  updatedAt: string
}

/** Someone with access to a board; the owner is listed first with role OWNER. */
export type Member = { userId: number; email: string; fullName: string; role: BoardRole }

export const BOARD_NAME_MAX = 100

/** Same rules as BoardDtos.BoardRequest on the backend. */
export function validateBoardName(name: string, t: TFunction): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return t('validation.boardNameRequired')
  if (trimmed.length > BOARD_NAME_MAX) return t('validation.boardNameTooLong', { max: BOARD_NAME_MAX })
  return undefined
}

/**
 * `content` is the stored drawing (parse it with canvas/shapes.ts parseCanvasContent). It may lag the
 * live board by a couple of seconds; the real-time room is authoritative. There is no REST write.
 */
export type BoardDetail = {
  board: Board
  canvas: { content: unknown; version: number; updatedAt: string }
}

export const boardsApi = {
  list: () => apiFetch<Board[]>('/api/boards'),
  get: (id: number) => apiFetch<BoardDetail>(`/api/boards/${id}`),
  create: (name: string) => apiFetch<Board>('/api/boards', { method: 'POST', body: { name } }),
  rename: (id: number, name: string) => apiFetch<Board>(`/api/boards/${id}`, { method: 'PATCH', body: { name } }),
  remove: (id: number) => apiFetch<void>(`/api/boards/${id}`, { method: 'DELETE' }),
}

export const membersApi = {
  list: (boardId: number) => apiFetch<Member[]>(`/api/boards/${boardId}/members`),
  /** Fails with 404 MEMBER_USER_NOT_FOUND if no account has this email. */
  add: (boardId: number, email: string, role: MemberRole) =>
    apiFetch<Member>(`/api/boards/${boardId}/members`, { method: 'POST', body: { email, role } }),
  changeRole: (boardId: number, userId: number, role: MemberRole) =>
    apiFetch<Member>(`/api/boards/${boardId}/members/${userId}`, { method: 'PATCH', body: { role } }),
  /** The owner removes anyone; a member removing themselves leaves the board. */
  remove: (boardId: number, userId: number) =>
    apiFetch<void>(`/api/boards/${boardId}/members/${userId}`, { method: 'DELETE' }),
}
