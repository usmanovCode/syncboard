import { describe, expect, it } from 'vitest'
import {
  addPendingMessage,
  discardPendingMessage,
  initChat,
  markRead,
  nextToSend,
  prependOlder,
  receiveChatMessage,
  receiveChatSnapshot,
  rejectPendingMessage,
  retryPendingMessage,
  unreadCount,
} from './chatState'
import type { ChatMessage } from './types'

const ME = 1
const msg = (id: number, userId = 2, clientMessageId = `c${id}`): ChatMessage => ({
  id,
  userId,
  userName: userId === ME ? 'Ali' : 'Vali',
  color: '#2563eb',
  text: `xabar ${id}`,
  createdAt: '2026-11-25T10:00:00Z',
  clientMessageId,
})
const ids = (messages: ChatMessage[]) => messages.map((m) => m.id)

describe('chat state', () => {
  it('starts from the first join reply, with history counted as read', () => {
    const state = receiveChatSnapshot(initChat(), { messages: [msg(4), msg(5)], hasMore: true }, ME)

    expect(ids(state.messages)).toEqual([4, 5])
    expect(state.hasMore).toBe(true)
    expect(unreadCount(state, ME)).toBe(0)
  })

  it('merges new messages by id, ignoring duplicates and arrival order', () => {
    let state = receiveChatSnapshot(initChat(), { messages: [msg(1)], hasMore: false }, ME)
    state = receiveChatMessage(state, msg(3), ME)
    state = receiveChatMessage(state, msg(2), ME)
    state = receiveChatMessage(state, msg(3), ME)

    expect(ids(state.messages)).toEqual([1, 2, 3])
  })

  it('confirms my pending message when it comes back stored', () => {
    let state = receiveChatSnapshot(initChat(), { messages: [], hasMore: false }, ME)
    state = addPendingMessage(state, 'a', 'Salom')
    state = addPendingMessage(state, 'b', 'Qalaysan')
    expect(nextToSend(state)?.clientMessageId).toBe('a')

    state = receiveChatMessage(state, msg(1, 2, 'a'), ME) // someone else's message with the same client id
    expect(state.pending).toHaveLength(2)

    state = receiveChatMessage(state, msg(2, ME, 'a'), ME)
    expect(state.pending.map((p) => p.clientMessageId)).toEqual(['b'])
  })

  it('keeps what it has after a rejoin and confirms messages stored before the drop', () => {
    let state = receiveChatSnapshot(initChat(), { messages: [msg(1), msg(2)], hasMore: false }, ME)
    state = addPendingMessage(state, 'mine', 'Salom')

    state = receiveChatSnapshot(state, { messages: [msg(2), msg(3, ME, 'mine'), msg(4)], hasMore: true }, ME)

    expect(ids(state.messages)).toEqual([1, 2, 3, 4])
    expect(state.hasMore).toBe(false) // we already reach back to the first message
    expect(state.pending).toEqual([])
  })

  it('starts over when more messages were missed than the join reply holds', () => {
    let state = receiveChatSnapshot(initChat(), { messages: [msg(1), msg(2)], hasMore: false }, ME)

    state = receiveChatSnapshot(state, { messages: [msg(60), msg(61)], hasMore: true }, ME)

    expect(ids(state.messages)).toEqual([60, 61])
    expect(state.hasMore).toBe(true)
    expect(unreadCount(state, ME)).toBe(2) // arrived while we were away
  })

  it('puts older pages in front', () => {
    let state = receiveChatSnapshot(initChat(), { messages: [msg(5), msg(6)], hasMore: true }, ME)

    state = prependOlder(state, { messages: [msg(3), msg(4)], hasMore: false })

    expect(ids(state.messages)).toEqual([3, 4, 5, 6])
    expect(state.hasMore).toBe(false)
  })

  it('holds rejected messages back until retried, then sends them after the rest', () => {
    let state = addPendingMessage(addPendingMessage(initChat(), 'a', 'bir'), 'b', 'ikki')
    state = rejectPendingMessage(state, 'a', 'Too long')

    expect(state.pending[0]).toMatchObject({ clientMessageId: 'a', error: 'Too long' })
    expect(nextToSend(state)?.clientMessageId).toBe('b')

    state = retryPendingMessage(state, 'a')
    expect(state.pending.map((p) => [p.clientMessageId, p.error])).toEqual([
      ['b', undefined],
      ['a', undefined],
    ])

    state = discardPendingMessage(state, 'a')
    expect(state.pending.map((p) => p.clientMessageId)).toEqual(['b'])
  })

  it("counts other people's new messages as unread until marked read", () => {
    let state = receiveChatSnapshot(initChat(), { messages: [msg(1)], hasMore: false }, ME)
    state = receiveChatMessage(state, msg(2), ME)
    state = receiveChatMessage(state, msg(3, ME), ME)
    state = receiveChatMessage(state, msg(4), ME)

    expect(unreadCount(state, ME)).toBe(2)
    state = markRead(state)
    expect(unreadCount(state, ME)).toBe(0)
    expect(markRead(state)).toBe(state)
  })
})
