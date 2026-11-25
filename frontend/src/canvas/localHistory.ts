import { inverseOf, type BoardOp } from './ops'
import type { Shape } from './types'

/**
 * Per-user undo/redo on a shared board. Each entry is the op that reverts one of *my* changes, so
 * undo never touches what others did. An entry that no longer changes anything (e.g. it would update
 * a shape someone else deleted) is skipped.
 */
export type LocalHistory = { undo: BoardOp[]; redo: BoardOp[] }

export const LOCAL_HISTORY_LIMIT = 100
export const emptyHistory: LocalHistory = { undo: [], redo: [] }

/** After a new change of mine: remember how to revert it; redo is no longer possible. */
export function record(history: LocalHistory, inverse: BoardOp): LocalHistory {
  return { undo: [...history.undo, inverse].slice(-LOCAL_HISTORY_LIMIT), redo: [] }
}

type Step = { history: LocalHistory; op: BoardOp }

function take(from: BoardOp[], to: BoardOp[], shapes: Shape[]): { from: BoardOp[]; to: BoardOp[]; op: BoardOp } | null {
  const stack = [...from]
  while (stack.length > 0) {
    const op = stack.pop()!
    const back = inverseOf(op, shapes)
    if (back) return { from: stack, to: [...to, back], op }
  }
  return null
}

/** The op to send for undo, and the history after it; null if there is nothing left to undo. */
export function takeUndo(history: LocalHistory, shapes: Shape[]): Step | null {
  const step = take(history.undo, history.redo, shapes)
  return step && { op: step.op, history: { undo: step.from, redo: step.to } }
}

export function takeRedo(history: LocalHistory, shapes: Shape[]): Step | null {
  const step = take(history.redo, history.undo, shapes)
  return step && { op: step.op, history: { undo: step.to, redo: step.from } }
}
