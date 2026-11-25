import type { TFunction } from 'i18next'
import { apiFetch } from './client'

/** A drawing canvas. `ownerId` tells own boards apart from shared ones (once board_members exists). */
export type Board = {
  id: number
  name: string
  ownerId: number
  createdAt: string
  updatedAt: string
}

export const BOARD_NAME_MAX = 100

/** Same rules as BoardDtos.BoardRequest on the backend. */
export function validateBoardName(name: string, t: TFunction): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return t('validation.boardNameRequired')
  if (trimmed.length > BOARD_NAME_MAX) return t('validation.boardNameTooLong', { max: BOARD_NAME_MAX })
  return undefined
}

export const boardsApi = {
  list: () => apiFetch<Board[]>('/api/boards'),
  create: (name: string) => apiFetch<Board>('/api/boards', { method: 'POST', body: { name } }),
  rename: (id: number, name: string) => apiFetch<Board>(`/api/boards/${id}`, { method: 'PATCH', body: { name } }),
  remove: (id: number) => apiFetch<void>(`/api/boards/${id}`, { method: 'DELETE' }),
}
