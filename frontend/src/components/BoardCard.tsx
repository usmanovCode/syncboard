import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Board } from '../api/boards'
import { ApiError } from '../api/client'
import { currentLanguage } from '../i18n'
import { formatDate } from '../i18n/format'
import { BoardNameForm } from './BoardNameForm'

type Props = {
  board: Board
  /** Only the owner may rename/delete; boards shared with the user show who shared them instead. */
  canManage: boolean
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}

type Mode = 'view' | 'rename' | 'confirmDelete'

/** Pastel backdrops for the card preview, picked by board id so a board keeps its look. */
const PREVIEWS = [
  { bg: 'from-pink-200 via-rose-100 to-violet-200', stroke: 'stroke-pink-400', fill: 'fill-violet-200' },
  { bg: 'from-blue-200 via-indigo-100 to-violet-200', stroke: 'stroke-blue-400', fill: 'fill-indigo-200' },
  { bg: 'from-violet-200 via-fuchsia-100 to-pink-200', stroke: 'stroke-violet-400', fill: 'fill-fuchsia-200' },
  { bg: 'from-emerald-100 via-teal-50 to-sky-200', stroke: 'stroke-emerald-400', fill: 'fill-sky-200' },
  { bg: 'from-amber-100 via-orange-50 to-pink-200', stroke: 'stroke-orange-400', fill: 'fill-amber-200' },
  { bg: 'from-sky-200 via-cyan-100 to-indigo-200', stroke: 'stroke-sky-400', fill: 'fill-cyan-200' },
] as const

/** A decorative mini canvas: a window frame with a few doodles, on the board's pastel gradient. */
function BoardPreview({ id }: { id: number }) {
  const look = PREVIEWS[Math.abs(id) % PREVIEWS.length]
  return (
    <div aria-hidden="true" className={`relative h-32 overflow-hidden bg-linear-to-br ${look.bg}`}>
      <div className="absolute inset-x-8 top-6 h-32 rounded-t-xl border border-white/90 bg-white/80 shadow-sm">
        <div className="flex items-center gap-1 px-3 py-2">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
          <span className="ml-auto h-1.5 w-10 rounded-full bg-slate-200" />
        </div>
        <svg viewBox="0 0 240 70" className="h-[4.5rem] w-full" fill="none" strokeLinecap="round" strokeWidth={3}>
          <rect x="138" y="10" width="54" height="34" rx="8" className={look.fill} />
          <path d={id % 2 ? 'M18 50c20-30 40-30 55-5s35 8 48-15' : 'M18 30c18 22 36 22 52 4s34-18 50 6'} className={look.stroke} />
          <circle cx="212" cy="46" r="10" className={look.stroke} />
        </svg>
      </div>
    </div>
  )
}

export function BoardCard({ board, canManage, onRename, onDelete }: Props) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('view')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete()
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t('errors.unexpected'))
      setDeleting(false)
    }
  }

  return (
    <li
      aria-label={board.name}
      className="card group relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <BoardPreview id={board.id} />
      <div className="flex flex-1 flex-col p-5">
        {mode === 'rename' ? (
          <BoardNameForm
            label={t('dashboard.renameLabel')}
            initialName={board.name}
            submitLabel={t('common.save')}
            onSubmit={async (name) => {
              await onRename(name)
              setMode('view')
            }}
            onCancel={() => setMode('view')}
          />
        ) : (
          <>
            <h2 className="truncate text-base font-bold text-slate-900" title={board.name}>
              {/* Stretched link: the whole card opens the board; the buttons below sit above it (z-10). */}
              <Link
                to={`/boards/${board.id}`}
                className="after:absolute after:inset-0 after:rounded-[20px] group-hover:text-violet-700 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-violet-500"
              >
                {board.name}
              </Link>
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              {t('dashboard.updated', { date: formatDate(board.updatedAt, currentLanguage()) })}
            </p>
            {board.role !== 'OWNER' && (
              <p className="mt-2 w-fit max-w-full truncate rounded-full bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700">
                {t('dashboard.sharedBy', { name: board.ownerName, role: t(`roles.${board.role}`) })}
              </p>
            )}
          </>
        )}

        {canManage && mode === 'view' && (
          <div className="relative z-10 mt-auto flex gap-2 pt-4">
            <button
              onClick={() => setMode('rename')}
              className="btn-secondary rounded-xl px-3 py-1.5 text-sm"
            >
              {t('dashboard.rename')}
            </button>
            <button
              onClick={() => {
                setDeleteError(null)
                setMode('confirmDelete')
              }}
              className="rounded-xl px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              {t('dashboard.delete')}
            </button>
          </div>
        )}

        {mode === 'confirmDelete' && (
          <div className="relative z-10 mt-auto pt-4" role="group" aria-label={t('dashboard.deleteConfirmLabel')}>
            <p className="text-sm text-slate-700">{t('dashboard.deleteConfirm')}</p>
            {deleteError && <p className="mt-1 text-xs text-red-600">{deleteError}</p>}
            <div className="mt-2 flex gap-2">
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="rounded-xl bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {deleting ? t('dashboard.deleting') : t('dashboard.deleteYes')}
              </button>
              <button
                onClick={() => setMode('view')}
                disabled={deleting}
                className="rounded-xl px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  )
}
