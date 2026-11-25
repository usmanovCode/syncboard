import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { PendingMessage } from '../chat/chatState'
import { CHAT_MAX_LENGTH, type ChatMessage } from '../chat/types'
import { currentLanguage } from '../i18n'
import { formatMessageTime } from '../i18n/format'
import type { OnlineUser } from '../realtime/types'

/** A new author line when the author changes or after this long. */
const GROUP_GAP_MS = 5 * 60 * 1000
/** Show the length counter from here on. */
const COUNTER_FROM = CHAT_MAX_LENGTH - 200
/** Within this distance of the bottom, new messages keep the list scrolled down. */
const STICK_PX = 48

export type ChatPanelProps = {
  messages: ChatMessage[]
  pending: PendingMessage[]
  hasMore: boolean
  typingUsers: OnlineUser[]
  selfId?: number
  onSend: (text: string) => void
  onTyping: (active: boolean) => void
  onRetry: (clientMessageId: string) => void
  onDiscard: (clientMessageId: string) => void
  onLoadOlder: () => Promise<void>
  onClose: () => void
}

/** The board's chat, in a panel on the right of the canvas. Everyone with access can write, viewers too. */
export function ChatPanel(props: ChatPanelProps) {
  const { messages, pending, hasMore, typingUsers, selfId, onSend, onTyping, onRetry, onDiscard, onClose } = props
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const [older, setOlder] = useState<'idle' | 'loading' | 'failed'>('idle')
  const list = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  // Keep the newest message in view, unless the user scrolled up to read (loading older messages
  // adds to the top and leaves the position alone). My own messages always scroll down.
  const lastKey = `${messages.at(-1)?.id ?? 0}:${pending.length}`
  const lastIsMine = pending.length > 0 || messages.at(-1)?.userId === selfId
  useLayoutEffect(() => {
    const el = list.current
    if (el && (stick.current || lastIsMine)) el.scrollTop = el.scrollHeight
  }, [lastKey, lastIsMine])

  // Stop announcing "typing" when the panel closes.
  useEffect(() => () => onTyping(false), [onTyping])

  function submit() {
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
    stick.current = true
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Not while an IME (e.g. Korean) is composing: that Enter only confirms the syllable.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    submit()
  }

  async function loadOlder() {
    setOlder('loading')
    try {
      await props.onLoadOlder()
      setOlder('idle')
    } catch {
      setOlder('failed')
    }
  }

  const language = currentLanguage()

  return (
    <aside aria-labelledby="chat-title" className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <h2 id="chat-title" className="text-sm font-semibold text-slate-900">
          {t('chat.title')}
        </h2>
        <button
          onClick={onClose}
          aria-label={t('chat.close')}
          title={t('chat.close')}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div
        ref={list}
        role="log"
        aria-label={t('chat.log')}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {hasMore && (
          <div className="mb-3 text-center">
            <button
              onClick={loadOlder}
              disabled={older === 'loading'}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:text-slate-400"
            >
              {older === 'loading' ? t('chat.loadingOlder') : t('chat.loadOlder')}
            </button>
            {older === 'failed' && (
              <p role="alert" className="mt-1 text-xs text-red-600">
                {t('chat.loadOlderFailed')}
              </p>
            )}
          </div>
        )}
        {messages.length === 0 && pending.length === 0 && (
          <p className="mt-6 text-center text-sm text-slate-400">{t('chat.empty')}</p>
        )}
        <ul className="space-y-1">
          {messages.map((m, i) => {
            const previous = messages[i - 1]
            const startsGroup =
              !previous ||
              previous.userId !== m.userId ||
              Date.parse(m.createdAt) - Date.parse(previous.createdAt) > GROUP_GAP_MS
            const mine = m.userId === selfId
            return (
              <li key={m.id} className={startsGroup && i > 0 ? 'pt-2' : undefined}>
                {startsGroup && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold" style={{ color: m.color }}>
                      {mine ? t('chat.you') : m.userName}
                    </span>
                    <time dateTime={m.createdAt} className="text-[11px] text-slate-400">
                      {formatMessageTime(m.createdAt, language)}
                    </time>
                  </div>
                )}
                <p className={`whitespace-pre-wrap break-words text-sm ${mine ? 'text-slate-900' : 'text-slate-700'}`}>
                  {m.text}
                </p>
              </li>
            )
          })}
          {pending.map((p) => (
            <li key={p.clientMessageId} className="pt-1">
              <p className="whitespace-pre-wrap break-words text-sm text-slate-400">{p.text}</p>
              {p.error ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-red-600">
                  <span>{t('chat.failed', { reason: p.error })}</span>
                  <button onClick={() => onRetry(p.clientMessageId)} className="font-medium underline">
                    {t('chat.retry')}
                  </button>
                  <button onClick={() => onDiscard(p.clientMessageId)} className="font-medium underline">
                    {t('chat.discard')}
                  </button>
                </div>
              ) : (
                <span className="text-[11px] text-slate-400">{t('chat.sending')}</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <p aria-live="polite" className="h-5 truncate px-4 text-xs italic text-slate-500">
        {typingText(typingUsers, t)}
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="border-t border-slate-200 p-3"
      >
        <textarea
          aria-label={t('chat.inputLabel')}
          placeholder={t('chat.placeholder')}
          title={t('chat.hint')}
          rows={2}
          maxLength={CHAT_MAX_LENGTH}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            onTyping(e.target.value.trim().length > 0)
          }}
          onBlur={() => onTyping(false)}
          onKeyDown={onKeyDown}
          className="block w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {draft.length >= COUNTER_FROM && t('chat.tooLong', { count: draft.length, max: CHAT_MAX_LENGTH })}
          </span>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:bg-slate-300"
          >
            {t('chat.send')}
          </button>
        </div>
      </form>
    </aside>
  )
}

function typingText(users: OnlineUser[], t: ReturnType<typeof useTranslation>['t']): string {
  if (users.length === 0) return ''
  if (users.length === 1) return t('chat.typing.one', { name: users[0].name })
  if (users.length === 2) return t('chat.typing.two', { first: users[0].name, second: users[1].name })
  return t('chat.typing.many')
}
