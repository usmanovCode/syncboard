import { describe, expect, it } from 'vitest'
import { applyOp, inverseOf, type BoardOp } from './ops'
import { createText } from './shapes'
import {
  addPending,
  disconnected,
  initSync,
  receiveOp,
  receiveSnapshot,
  rejectPending,
  viewOf,
  type RemoteOp,
  type SyncState,
} from './sync'
import type { Shape } from './types'

const style = { stroke: '#000000', strokeWidth: 2 }
const shape = (id: string, text = id): Shape => createText({ x: 0, y: 0 }, text, style, id)
const add = (s: Shape): BoardOp => ({ type: 'add', shape: s })
const ids = (shapes: Shape[]) => shapes.map((s) => (s.type === 'text' ? `${s.id}:${s.text}` : s.id))
const remote = (seq: number, op: BoardOp, clientOpId = `other-${seq}`): RemoteOp => ({ seq, userId: 2, clientOpId, op })

function joined(shapes: Shape[] = [], seq = 0): SyncState {
  return receiveSnapshot(initSync([], 0), shapes, seq).state
}

describe('applyOp (same rules as the server)', () => {
  it('adds on top, replaces existing ids in place, and lets delete win', () => {
    let shapes = applyOp([], add(shape('a')))
    shapes = applyOp(shapes, add(shape('b')))
    shapes = applyOp(shapes, add(shape('a', 'a2')))
    expect(ids(shapes)).toEqual(['a:a2', 'b:b'])

    shapes = applyOp(shapes, { type: 'remove', id: 'a' })
    const afterUpdate = applyOp(shapes, { type: 'update', shape: shape('a', 'ghost') })
    expect(afterUpdate).toBe(shapes)
    expect(applyOp(shapes, { type: 'remove', id: 'a' })).toBe(shapes)
  })

  it('computes inverses against the drawing before the op', () => {
    const before = [shape('a')]
    expect(inverseOf(add(shape('b')), before)).toEqual({ type: 'remove', id: 'b' })
    expect(inverseOf({ type: 'update', shape: shape('a', 'new') }, before)).toEqual({ type: 'update', shape: before[0] })
    expect(inverseOf({ type: 'remove', id: 'a' }, before)).toEqual({ type: 'add', shape: before[0] })
    // Nothing to undo for ops that change nothing.
    expect(inverseOf({ type: 'remove', id: 'gone' }, before)).toBeNull()
    expect(inverseOf({ type: 'update', shape: shape('gone') }, before)).toBeNull()
    expect(inverseOf({ type: 'update', shape: before[0] }, before)).toBeNull()
  })
})

describe('sync', () => {
  it('shows pending ops on top of the confirmed drawing until their echo arrives', () => {
    let s = addPending(joined([shape('a')], 5), { clientOpId: 'mine', op: add(shape('b')) })
    expect(ids(viewOf(s))).toEqual(['a:a', 'b:b'])
    expect(ids(s.confirmed)).toEqual(['a:a'])

    s = receiveOp(s, remote(6, add(shape('b')), 'mine')).state
    expect(s.pending).toEqual([])
    expect(s.seq).toBe(6)
    expect(ids(viewOf(s))).toEqual(['a:a', 'b:b'])
  })

  it('rebases pending ops over remote ones', () => {
    let s = addPending(joined([shape('a')], 1), { clientOpId: 'mine', op: { type: 'update', shape: shape('a', 'mine') } })

    // Someone else's change lands first; ours stays on top until confirmed.
    s = receiveOp(s, remote(2, { type: 'update', shape: shape('a', 'theirs') })).state
    expect(ids(viewOf(s))).toEqual(['a:mine'])
    s = receiveOp(s, remote(3, { type: 'update', shape: shape('a', 'mine') }, 'mine')).state
    expect(ids(viewOf(s))).toEqual(['a:mine'])

    // ...and a remote delete wins over an unconfirmed update.
    s = addPending(s, { clientOpId: 'mine2', op: { type: 'update', shape: shape('a', 'again') } })
    s = receiveOp(s, remote(4, { type: 'remove', id: 'a' })).state
    expect(viewOf(s)).toEqual([])
  })

  it('ignores ops already contained in the snapshot', () => {
    const s = joined([shape('a')], 10)
    const result = receiveOp(s, remote(9, add(shape('old'))))
    expect(result.gap).toBe(false)
    expect(result.state.confirmed).toBe(s.confirmed)
  })

  it('detects a missed op and buffers until the next snapshot', () => {
    const s = joined([], 1)
    const result = receiveOp(s, remote(3, add(shape('x'))))
    expect(result.gap).toBe(true)
    expect(result.state.joined).toBe(false)

    const buffered = receiveOp(result.state, remote(4, add(shape('y')))).state
    expect(buffered.buffer).toHaveLength(1)
    const rejoined = receiveSnapshot(buffered, [shape('x')], 3).state
    expect(ids(rejoined.confirmed)).toEqual(['x:x', 'y:y'])
    expect(rejoined.seq).toBe(4)
  })

  it('replays only the buffered ops that are newer than the snapshot', () => {
    let s = initSync([shape('stale')], 0)
    s = receiveOp(s, remote(5, add(shape('in-snapshot')))).state
    s = receiveOp(s, remote(6, add(shape('newer')))).state

    const result = receiveSnapshot(s, [shape('in-snapshot')], 5)

    expect(result.gap).toBe(false)
    expect(ids(result.state.confirmed)).toEqual(['in-snapshot:in-snapshot', 'newer:newer'])
    expect(result.state.seq).toBe(6)
  })

  it('keeps pending ops across a reconnect and drops rejected ones', () => {
    let s = addPending(joined([], 0), { clientOpId: 'p1', op: add(shape('a')) })
    s = disconnected(s)
    expect(s.joined).toBe(false)
    s = receiveSnapshot(s, [], 0).state
    expect(s.pending.map((p) => p.clientOpId)).toEqual(['p1'])

    s = rejectPending(s, 'p1')
    expect(viewOf(s)).toEqual([])
  })
})
