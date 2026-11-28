import { useTranslation } from 'react-i18next'
import type { ConnectionStatus, OnlineUser } from '../realtime/types'

import { initials } from './initials'

const MAX_AVATARS = 5

/** Who else has the board open, plus the connection state. The current user is listed first. */
export function PresenceBar({ online, selfId, status }: { online: OnlineUser[]; selfId?: number; status: ConnectionStatus }) {
  const { t } = useTranslation()
  if (status !== 'connected') {
    return (
      <span aria-live="polite" className="rounded-full bg-amber-50 px-3.5 py-1.5 text-sm font-medium text-amber-700 ring-1 ring-amber-200">
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
            className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm ring-2 ring-white"
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
          className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-sm font-semibold text-violet-700 shadow-sm ring-2 ring-white"
        >
          {t('presence.more', { count: hidden.length })}
        </li>
      )}
    </ul>
  )
}
