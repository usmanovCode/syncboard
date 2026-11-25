import { describe, expect, it } from 'vitest'
import { emptyHistory, LOCAL_HISTORY_LIMIT, record, takeRedo, takeUndo, type LocalHistory } from './localHistory'
import { applyOp, inverseOf, type BoardOp } from './ops'
import { createText } from './shapes'
import type { Shape } from './types'

const style = { stroke: '#000000', strokeWidth: 2 }
const shape = (id: string, text = id): Shape => createText({ x: 0, y: 0 }, text, style, id)
const texts = (shapes: Shape[]) => shapes.map((s) => (s.type === 'text' ? s.text : s.id))

/** A tiny editor: my ops are recorded, others' are just applied. */
function editor(initial: Shape[] = []) {
  let shapes = initial
  let history: LocalHistory = emptyHistory
  return {
    mine(op: BoardOp) {
      const inverse = inverseOf(op, shapes)
      if (inverse) history = record(history, inverse)
      shapes = applyOp(shapes, op)
    },
    theirs(op: BoardOp) {
      shapes = applyOp(shapes, op)
    },
    undo() {
      const step = takeUndo(history, shapes)
      if (step) {
        shapes = applyOp(shapes, step.op)
        history = step.history
      }
      return step !== null
    },
    redo() {
      const step = takeRedo(history, shapes)
      if (step) {
        shapes = applyOp(shapes, step.op)
        history = step.history
      }
      return step !== null
    },
    get shapes() {
      return shapes
    },
    get history() {
      return history
    },
  }
}

describe('local history', () => {
  it('undoes and redoes my own changes', () => {
    const e = editor()
    e.mine({ type: 'add', shape: shape('a') })
    e.mine({ type: 'update', shape: shape('a', 'edited') })

    e.undo()
    expect(texts(e.shapes)).toEqual(['a'])
    e.undo()
    expect(e.shapes).toEqual([])
    expect(e.undo()).toBe(false)

    e.redo()
    e.redo()
    expect(texts(e.shapes)).toEqual(['edited'])
    expect(e.redo()).toBe(false)
  })

  it("never reverts other people's changes", () => {
    const e = editor()
    e.mine({ type: 'add', shape: shape('mine') })
    e.theirs({ type: 'add', shape: shape('theirs') })

    e.undo()

    expect(texts(e.shapes)).toEqual(['theirs'])
  })

  it('skips steps that no longer apply because someone else deleted the shape', () => {
    const e = editor()
    e.mine({ type: 'add', shape: shape('a') })
    e.mine({ type: 'add', shape: shape('b') })
    e.mine({ type: 'update', shape: shape('b', 'b2') })
    e.theirs({ type: 'remove', id: 'b' })

    // "Revert b2 to b" has nothing to act on and is skipped, the step before it ("remove b") too.
    expect(e.undo()).toBe(true)
    expect(texts(e.shapes)).toEqual([])
  })

  it('a new change clears redo', () => {
    const e = editor()
    e.mine({ type: 'add', shape: shape('a') })
    e.undo()
    e.mine({ type: 'add', shape: shape('b') })
    expect(e.history.redo).toEqual([])
  })

  it('keeps a bounded number of steps', () => {
    const e = editor()
    for (let i = 0; i < LOCAL_HISTORY_LIMIT + 10; i++) e.mine({ type: 'add', shape: shape(`s${i}`) })
    expect(e.history.undo).toHaveLength(LOCAL_HISTORY_LIMIT)
  })
})
