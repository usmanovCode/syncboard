import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { membersApi, type Board, type Member, type MemberRole } from '../api/boards'
import { ApiError } from '../api/client'
import { FormAlert } from './AuthLayout'
import { TextField } from './TextField'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MEMBER_ROLES: MemberRole[] = ['EDITOR', 'VIEWER']

type Props = {
  board: Pick<Board, 'id' | 'name' | 'role'>
  currentUserId: number
  onClose: () => void
  /** Called after the current user removed themselves from the board. */
  onLeft: () => void
}

/**
 * Who has access to a board. The owner invites by email, changes roles and removes people; other
 * members see the list and can leave.
 */
export function ShareDialog({ board, currentUserId, onClose, onLeft }: Props) {
  const { t } = useTranslation()
  const titleId = useId()
  const isOwner = board.role === 'OWNER'
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('EDITOR')
  const [emailError, setEmailError] = useState<string>()
  const [inviting, setInviting] = useState(false)

  const message = (err: unknown) => (err instanceof ApiError ? err.message : t('errors.unexpected'))

  useEffect(() => {
    let cancelled = false
    membersApi.list(board.id).then(
      (list) => !cancelled && setMembers(list),
      (err: unknown) => !cancelled && setError(err instanceof ApiError ? err.message : null),
    )
    return () => {
      cancelled = true
    }
  }, [board.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const trimmed = email.trim()
    const found = !trimmed
      ? t('validation.emailRequired')
      : !EMAIL_RE.test(trimmed)
        ? t('validation.emailInvalid')
        : undefined
    setEmailError(found)
    if (found) return

    setInviting(true)
    try {
      const member = await membersApi.add(board.id, trimmed, role)
      setMembers((list) => [...(list ?? []), member])
      setEmail('')
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.email) setEmailError(err.fieldErrors.email)
      else setError(message(err))
    } finally {
      setInviting(false)
    }
  }

  async function changeRole(member: Member, next: MemberRole) {
    setError(null)
    try {
      const updated = await membersApi.changeRole(board.id, member.userId, next)
      setMembers((list) => list?.map((m) => (m.userId === member.userId ? updated : m)) ?? null)
    } catch (err) {
      setError(message(err))
    }
  }

  async function remove(member: Member) {
    setError(null)
    try {
      await membersApi.remove(board.id, member.userId)
      if (member.userId === currentUserId) return onLeft()
      setMembers((list) => list?.filter((m) => m.userId !== member.userId) ?? null)
    } catch (err) {
      setError(message(err))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 py-16" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
            {t('share.title', { name: board.name })}
          </h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            {t('share.close')}
          </button>
        </div>

        <FormAlert message={error} />

        {isOwner && (
          <form onSubmit={invite} noValidate className="mb-2 flex items-start gap-2">
            <div className="flex-1">
              <TextField
                label={t('share.email')}
                type="email"
                placeholder={t('share.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={emailError}
                autoFocus
              />
            </div>
            <label className="mt-6.5">
              <span className="sr-only">{t('share.role')}</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as MemberRole)}
                className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
              >
                {MEMBER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`roles.${r}`)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={inviting}
              className="mt-6.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {inviting ? t('share.inviting') : t('share.invite')}
            </button>
          </form>
        )}
        {isOwner && <p className="mb-4 text-xs text-slate-500">{t('share.roleHint')}</p>}

        <h3 className="mb-2 text-sm font-medium text-slate-700">{t('share.people')}</h3>
        {members === null ? (
          !error && <p className="text-sm text-slate-500">{t('common.loading')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {members.map((member) => {
              const isMe = member.userId === currentUserId
              return (
                <li key={member.userId} aria-label={member.fullName} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {member.fullName} {isMe && <span className="font-normal text-slate-500">{t('share.you')}</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">{member.email}</p>
                  </div>
                  {isOwner && member.role !== 'OWNER' ? (
                    <>
                      <select
                        aria-label={t('share.roleFor', { name: member.fullName })}
                        value={member.role}
                        onChange={(e) => void changeRole(member, e.target.value as MemberRole)}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      >
                        {MEMBER_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`roles.${r}`)}
                          </option>
                        ))}
                      </select>
                      <button
                        aria-label={t('share.remove', { name: member.fullName })}
                        title={t('share.remove', { name: member.fullName })}
                        onClick={() => void remove(member)}
                        className="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <span className="text-sm text-slate-500">{t(`roles.${member.role}`)}</span>
                  )}
                  {!isOwner && isMe && (
                    <button
                      onClick={() => void remove(member)}
                      className="rounded-lg px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                    >
                      {t('share.leave')}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
