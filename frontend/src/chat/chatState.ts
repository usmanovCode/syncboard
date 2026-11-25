import type { ChatMessage, ChatPage } from './types'

/** A message of mine the server hasn't confirmed yet. `error`: it was rejected (retry or discard). */
export type PendingMessage = { clientMessageId: string; text: string; error?: string }

/**
 * A board's chat as this tab sees it. `messages` are stored ones, sorted by id (the server's order);
 * `pending` are mine on their way. `readUpTo`: the newest message id the user has seen.
 *
 * Pure functions only, like canvas/sync.ts; useBoardRoom wires them to the socket.
 */
export type ChatState = {
  messages: ChatMessage[]
  hasMore: boolean
  pending: PendingMessage[]
  readUpTo: number
  joined: boolean
}

export const initChat = (): ChatState => ({ messages: [], hasMore: false, pending: [], readUpTo: 0, joined: false })

const lastId = (messages: ChatMessage[]) => messages.at(-1)?.id ?? 0

/** Union by id, sorted. A message can arrive twice (join reply and topic, or a re-send). */
function merge(a: ChatMessage[], b: ChatMessage[]): ChatMessage[] {
  const byId = new Map(a.map((m) => [m.id, m]))
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.id - y.id)
}

/** Drops pending messages that are now stored. */
function confirm(pending: PendingMessage[], messages: ChatMessage[], selfId: number): PendingMessage[] {
  const mine = new Set(messages.filter((m) => m.userId === selfId).map((m) => m.clientMessageId))
  return pending.some((p) => mine.has(p.clientMessageId)) ? pending.filter((p) => !mine.has(p.clientMessageId)) : pending
}

/**
 * The newest page from a (re)join. If it doesn't reach back to what we already have, messages were
 * missed while disconnected: start over from the page (older ones can be loaded again).
 */
export function receiveChatSnapshot(state: ChatState, page: ChatPage, selfId: number): ChatState {
  const pending = confirm(state.pending, page.messages, selfId)
  if (!state.joined) {
    return { ...state, messages: page.messages, hasMore: page.hasMore, pending, readUpTo: lastId(page.messages), joined: true }
  }
  const gap = page.hasMore && page.messages.length > 0 && page.messages[0].id > lastId(state.messages)
  if (gap || state.messages.length === 0) return { ...state, messages: page.messages, hasMore: page.hasMore, pending }
  const keepOlder = page.messages.length === 0 || state.messages[0].id <= page.messages[0].id
  return {
    ...state,
    messages: merge(state.messages, page.messages),
    hasMore: keepOlder ? state.hasMore : page.hasMore,
    pending,
  }
}

/** A new message from the topic (mine included, which confirms it). */
export function receiveChatMessage(state: ChatState, message: ChatMessage, selfId: number): ChatState {
  return { ...state, messages: merge(state.messages, [message]), pending: confirm(state.pending, [message], selfId) }
}

/** Older messages loaded over REST, put in front. */
export function prependOlder(state: ChatState, page: ChatPage): ChatState {
  return { ...state, messages: merge(page.messages, state.messages), hasMore: page.hasMore }
}

export function addPendingMessage(state: ChatState, clientMessageId: string, text: string): ChatState {
  return { ...state, pending: [...state.pending, { clientMessageId, text }] }
}

export function rejectPendingMessage(state: ChatState, clientMessageId: string, error: string): ChatState {
  return {
    ...state,
    pending: state.pending.map((p) => (p.clientMessageId === clientMessageId ? { ...p, error } : p)),
  }
}

/** Queues a rejected message again, behind the others. */
export function retryPendingMessage(state: ChatState, clientMessageId: string): ChatState {
  const message = state.pending.find((p) => p.clientMessageId === clientMessageId)
  if (!message) return state
  return {
    ...state,
    pending: [...state.pending.filter((p) => p !== message), { clientMessageId, text: message.text }],
  }
}

export function discardPendingMessage(state: ChatState, clientMessageId: string): ChatState {
  return { ...state, pending: state.pending.filter((p) => p.clientMessageId !== clientMessageId) }
}

/** The next message to send: the first one not rejected. */
export function nextToSend(state: ChatState): PendingMessage | undefined {
  return state.pending.find((p) => !p.error)
}

export function markRead(state: ChatState): ChatState {
  const latest = lastId(state.messages)
  return latest > state.readUpTo ? { ...state, readUpTo: latest } : state
}

/** Other people's messages newer than what the user has seen. */
export function unreadCount(state: ChatState, selfId: number | null): number {
  return state.messages.filter((m) => m.id > state.readUpTo && m.userId !== selfId).length
}
