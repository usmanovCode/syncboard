import type { Shape } from './types'

/**
 * Undo/redo over whole snapshots of the shape list. Snapshots share unchanged shape objects, so
 * this stays cheap. Only finished edits are recorded; in-progress drags live outside history.
 */
export type History = { past: Shape[][]; present: Shape[]; future: Shape[][] }

export type HistoryAction =
  | { type: 'add'; shape: Shape }
  | { type: 'update'; id: string; update: (shape: Shape) => Shape }
  | { type: 'remove'; id: string }
  | { type: 'undo' }
  | { type: 'redo' }

export const HISTORY_LIMIT = 100

export function initHistory(shapes: Shape[]): History {
  return { past: [], present: shapes, future: [] }
}

function commit(history: History, next: Shape[]): History {
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] }
}

export function historyReducer(history: History, action: HistoryAction): History {
  switch (action.type) {
    case 'add':
      return commit(history, [...history.present, action.shape])
    case 'update': {
      let changed = false
      const next = history.present.map((shape) => {
        if (shape.id !== action.id) return shape
        const updated = action.update(shape)
        changed ||= updated !== shape
        return updated
      })
      return changed ? commit(history, next) : history
    }
    case 'remove': {
      const next = history.present.filter((shape) => shape.id !== action.id)
      return next.length === history.present.length ? history : commit(history, next)
    }
    case 'undo': {
      if (history.past.length === 0) return history
      return {
        past: history.past.slice(0, -1),
        present: history.past[history.past.length - 1],
        future: [history.present, ...history.future],
      }
    }
    case 'redo': {
      if (history.future.length === 0) return history
      return {
        past: [...history.past, history.present],
        present: history.future[0],
        future: history.future.slice(1),
      }
    }
  }
}
