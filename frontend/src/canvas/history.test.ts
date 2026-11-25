import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, historyReducer, initHistory, type History, type HistoryAction } from './history'
import { createText } from './shapes'

const style = { stroke: '#000', strokeWidth: 2 }
const text = (id: string) => createText({ x: 0, y: 0 }, id, style, id)

const run = (history: History, ...actions: HistoryAction[]) => actions.reduce(historyReducer, history)
const ids = (history: History) => history.present.map((s) => s.id)

describe('historyReducer', () => {
  it('undoes and redoes added shapes', () => {
    let h = run(initHistory([]), { type: 'add', shape: text('a') }, { type: 'add', shape: text('b') })
    expect(ids(h)).toEqual(['a', 'b'])

    h = run(h, { type: 'undo' })
    expect(ids(h)).toEqual(['a'])
    h = run(h, { type: 'undo' }, { type: 'undo' }) // extra undo is a no-op
    expect(ids(h)).toEqual([])

    h = run(h, { type: 'redo' }, { type: 'redo' }, { type: 'redo' })
    expect(ids(h)).toEqual(['a', 'b'])
  })

  it('drops the redo stack on a new change', () => {
    const h = run(initHistory([]), { type: 'add', shape: text('a') }, { type: 'undo' }, { type: 'add', shape: text('b') })
    expect(ids(h)).toEqual(['b'])
    expect(h.future).toEqual([])
  })

  it('records updates and removals, but not no-ops', () => {
    const start = initHistory([text('a'), text('b')])
    const moved = run(start, { type: 'update', id: 'a', update: (s) => ({ ...s, x: 50 }) })
    expect(moved.present[0].x).toBe(50)
    expect(moved.present[1]).toBe(start.present[1]) // untouched shapes are shared
    expect(run(moved, { type: 'undo' }).present[0].x).toBe(0)

    expect(ids(run(start, { type: 'remove', id: 'a' }))).toEqual(['b'])
    expect(run(start, { type: 'remove', id: 'missing' })).toBe(start)
    expect(run(start, { type: 'update', id: 'a', update: (s) => s })).toBe(start)
  })

  it('keeps a bounded number of undo steps', () => {
    let h = initHistory([])
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = run(h, { type: 'add', shape: text(`s${i}`) })
    expect(h.past).toHaveLength(HISTORY_LIMIT)
  })
})
