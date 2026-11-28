import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { Board } from '../api/boards'
import { ApiError } from '../api/client'
import { currentLanguage } from '../i18n'
import { formatDate } from '../i18n/format'
import { BoardNameForm } from './BoardNameForm'
import { PencilIcon, TrashIcon } from './icons'

type Props = {
  board: Board
  /** Only the owner may rename/delete; boards shared with the user show who shared them instead. */
  canManage: boolean
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}

type Mode = 'view' | 'rename' | 'confirmDelete'

/** Card action buttons: icon + label, tinted fill, matching border, darker on hover. */
const ACTION =
  'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500'
const RENAME = 'border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100'
const DANGER = 'border-red-200 bg-red-50 text-red-600 hover:border-red-300 hover:bg-red-100 hover:text-red-700'

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
    <div aria-hidden="true" className={`relative h-44 overflow-hidden bg-linear-to-br sm:h-48 ${look.bg}`}>
      <div className="absolute inset-x-8 top-7 h-48 rounded-t-2xl border border-white/90 bg-white/80 shadow-sm">
        <div className="flex items-center gap-1.5 px-4 py-2.5">
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          <span className="ml-auto h-2 w-14 rounded-full bg-slate-200" />
        </div>
        <svg viewBox="0 0 240 80" className="h-28 w-full" fill="none" strokeLinecap="round" strokeWidth={3}>
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
      <div className="flex flex-1 flex-col p-6">
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
            <h2 className="truncate text-xl font-bold text-slate-900" title={board.name}>
              {/* Stretched link: the whole card opens the board; the buttons below sit above it (z-10). */}
              <Link
                to={`/boards/${board.id}`}
                className="after:absolute after:inset-0 after:rounded-[20px] group-hover:text-violet-700 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-violet-500"
              >
                {board.name}
              </Link>
            </h2>
            <p className="mt-2 text-base text-slate-500">
              {t('dashboard.updated', { date: formatDate(board.updatedAt, currentLanguage()) })}
            </p>
            {board.role !== 'OWNER' && (
              <p className="mt-2.5 w-fit max-w-full truncate rounded-full bg-violet-50 px-3 py-1 text-sm font-medium text-violet-700">
                {t('dashboard.sharedBy', { name: board.ownerName, role: t(`roles.${board.role}`) })}
              </p>
            )}
          </>
        )}

        {canManage && mode === 'view' && (
          <div className="relative z-10 mt-auto flex flex-wrap gap-2.5 pt-5">
            <button onClick={() => setMode('rename')} className={`${ACTION} ${RENAME}`}>
              <PencilIcon />
              {t('dashboard.rename')}
            </button>
            <button
              onClick={() => {
                setDeleteError(null)
                setMode('confirmDelete')
              }}
              className={`${ACTION} ${DANGER}`}
            >
              <TrashIcon />
              {t('dashboard.delete')}
            </button>
          </div>
        )}

        {mode === 'confirmDelete' && (
          <div className="relative z-10 mt-auto pt-5" role="group" aria-label={t('dashboard.deleteConfirmLabel')}>
            <p className="text-base text-slate-700">{t('dashboard.deleteConfirm')}</p>
            {deleteError && <p className="mt-1 text-sm text-red-600">{deleteError}</p>}
            <div className="mt-3 flex flex-wrap gap-2.5">
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className={`${ACTION} border-red-600 bg-red-600 text-white hover:border-red-500 hover:bg-red-500 disabled:opacity-60`}
              >
                {deleting ? t('dashboard.deleting') : t('dashboard.deleteYes')}
              </button>
              <button
                onClick={() => setMode('view')}
                disabled={deleting}
                className={`${ACTION} border-slate-200 bg-white text-slate-600 hover:bg-slate-50`}
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
