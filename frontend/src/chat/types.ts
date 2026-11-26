/** Mirrors the backend's ChatDtos and the chat payloads of RealtimeDtos. */

/** Same limit as ChatService.MAX_LENGTH on the backend (after trimming). */
export const CHAT_MAX_LENGTH = 2000

/** A stored message. `color` is the author's presence color. */
export type ChatMessage = {
  id: number
  userId: number
  userName: string
  color: string
  text: string
  createdAt: string
  clientMessageId: string
}

/** Oldest first. `hasMore`: older messages exist. */
export type ChatPage = { messages: ChatMessage[]; hasMore: boolean }

/** Someone started (or keeps) typing, or stopped. */
export type TypingMessage = { userId: number; typing: boolean }
