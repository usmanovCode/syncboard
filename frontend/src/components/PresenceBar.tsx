import { useTranslation } from 'react-i18next'
import type { ConnectionStatus, OnlineUser } from '../realtime/types'

const MAX_AVATARS = 5

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

/** Who else has the board open, plus the connection state. The current user is listed first. */
export function PresenceBar({ online, selfId, status }: { online: OnlineUser[]; selfId?: number; status: ConnectionStatus }) {
  const { t } = useTranslation()
  if (status !== 'connected') {
    return (
      <span aria-live="polite" className="text-xs text-amber-600">
        {t(status === 'connecting' ? 'presence.connecting' : 'presence.reconnecting')}
      </span>
    )
  }

  const sorted = [...online].sort((a, b) => Number(b.userId === selfId) - Number(a.userId === selfId))
  const shown = sorted.slice(0, MAX_AVATARS)
  const hidden = sorted.slice(MAX_AVATARS)

  return (
    <ul aria-label={t('presence.label')} className="flex items-center -space-x-2">
      {shown.map((user) => {
        const label = t('presence.item', {
          name: user.userId === selfId ? `${user.name} (${t('presence.you')})` : user.name,
          role: t(`roles.${user.role}`),
        })
        return (
          <li
            key={user.userId}
            aria-label={label}
            title={label}
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white"
            style={{ backgroundColor: user.color }}
          >
            {initials(user.name)}
          </li>
        )
      })}
      {hidden.length > 0 && (
        <li
          aria-label={hidden.map((u) => u.name).join(', ')}
          title={hidden.map((u) => u.name).join(', ')}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 ring-2 ring-white"
        >
          {t('presence.more', { count: hidden.length })}
        </li>
      )}
    </ul>
  )
}
