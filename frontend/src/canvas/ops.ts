import type { Shape } from './types'

/**
 * A change to the drawing; mirrors backend realtime/BoardOp.java. Each op carries the complete new
 * shape, so applying it twice is harmless and everyone applying the same ops in seq order agrees:
 * - add: put the shape; an existing id is replaced in place, a new one goes on top
 * - update: replace the shape if it still exists, otherwise nothing (delete wins)
 * - remove: delete the shape if it exists
 */
export type BoardOp = { type: 'add'; shape: Shape } | { type: 'update'; shape: Shape } | { type: 'remove'; id: string }

export function applyOp(shapes: Shape[], op: BoardOp): Shape[] {
  switch (op.type) {
    case 'add': {
      const index = shapes.findIndex((s) => s.id === op.shape.id)
      if (index === -1) return [...shapes, op.shape]
      const next = [...shapes]
      next[index] = op.shape
      return next
    }
    case 'update': {
      const index = shapes.findIndex((s) => s.id === op.shape.id)
      if (index === -1) return shapes
      const next = [...shapes]
      next[index] = op.shape
      return next
    }
    case 'remove': {
      const next = shapes.filter((s) => s.id !== op.id)
      return next.length === shapes.length ? shapes : next
    }
  }
}

/**
 * The op that undoes `op`, given the drawing just before it. Null when `op` would change nothing
 * (e.g. updating or removing a shape someone else already deleted), so there is nothing to undo.
 */
export function inverseOf(op: BoardOp, before: Shape[]): BoardOp | null {
  const id = op.type === 'remove' ? op.id : op.shape.id
  const previous = before.find((s) => s.id === id)
  switch (op.type) {
    case 'add':
      return previous ? { type: 'update', shape: previous } : { type: 'remove', id }
    case 'update':
      return previous && previous !== op.shape ? { type: 'update', shape: previous } : null
    case 'remove':
      return previous ? { type: 'add', shape: previous } : null
  }
}
