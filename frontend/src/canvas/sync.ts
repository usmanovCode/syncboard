import { applyOp, type BoardOp } from './ops'
import type { Shape } from './types'

/** An accepted op as broadcast by the server, in seq order. */
export type RemoteOp = { seq: number; userId: number; clientOpId: string; op: BoardOp }
/** An op of ours the server hasn't confirmed yet. */
export type PendingOp = { clientOpId: string; op: BoardOp }

/**
 * Client side of the op sync. What the user sees is `confirmed` (the server's drawing as of `seq`)
 * with our unconfirmed `pending` ops on top. Our own ops come back in the broadcast like anyone's;
 * that echo confirms them. Ops that arrive before the join reply are buffered, because the
 * snapshot in that reply may already contain them.
 */
export type SyncState = {
  confirmed: Shape[]
  seq: number
  pending: PendingOp[]
  joined: boolean
  buffer: RemoteOp[]
}

export function initSync(shapes: Shape[], seq: number): SyncState {
  return { confirmed: shapes, seq, pending: [], joined: false, buffer: [] }
}

export function viewOf(state: SyncState): Shape[] {
  return state.pending.reduce((shapes, p) => applyOp(shapes, p.op), state.confirmed)
}

export function addPending(state: SyncState, pending: PendingOp): SyncState {
  return { ...state, pending: [...state.pending, pending] }
}

/**
 * Applies a broadcast op. `gap` means an op was missed (seq jumped): the caller must re-join to get a
 * fresh snapshot. With ordered delivery this should not happen, but it keeps clients from diverging.
 */
export function receiveOp(state: SyncState, remote: RemoteOp): { state: SyncState; gap: boolean } {
  if (!state.joined) return { state: { ...state, buffer: [...state.buffer, remote] }, gap: false }
  const pending = state.pending.filter((p) => p.clientOpId !== remote.clientOpId)
  if (remote.seq <= state.seq) return { state: { ...state, pending }, gap: false } // already in our snapshot
  // Missed an op: buffer from now on, until the re-join snapshot arrives.
  if (remote.seq > state.seq + 1) return { state: { ...state, joined: false, buffer: [] }, gap: true }
  return { state: { ...state, confirmed: applyOp(state.confirmed, remote.op), seq: remote.seq, pending }, gap: false }
}

/**
 * The join reply: start from the server's snapshot, then replay buffered ops it doesn't include.
 * Pending ops are kept; the caller re-sends them (ops are idempotent, so a duplicate is harmless).
 */
export function receiveSnapshot(state: SyncState, shapes: Shape[], seq: number): { state: SyncState; gap: boolean } {
  let next: SyncState = { ...state, confirmed: shapes, seq, joined: true, buffer: [] }
  for (const remote of state.buffer) {
    const result = receiveOp(next, remote)
    if (result.gap) return result
    next = result.state
  }
  return { state: next, gap: false }
}

/** Connection lost: incoming ops are buffered until the next join. */
export function disconnected(state: SyncState): SyncState {
  return { ...state, joined: false, buffer: [] }
}

/** The server refused one of our ops: drop it, which reverts it on screen. */
export function rejectPending(state: SyncState, clientOpId: string): SyncState {
  return { ...state, pending: state.pending.filter((p) => p.clientOpId !== clientOpId) }
}
