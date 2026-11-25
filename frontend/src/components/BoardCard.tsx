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
  /** Only owners may rename/delete; shared boards (board_members, later) are read-only here. */
  canManage: boolean
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}

type Mode = 'view' | 'rename' | 'confirmDelete'

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
      className="relative flex min-h-40 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
    >
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
          <h2 className="truncate text-base font-semibold text-slate-900" title={board.name}>
            {/* Stretched link: the whole card opens the board; the buttons below sit above it (z-10). */}
            <Link
              to={`/boards/${board.id}`}
              className="after:absolute after:inset-0 after:rounded-2xl hover:text-indigo-600 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-500"
            >
              {board.name}
            </Link>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {t('dashboard.updated', { date: formatDate(board.updatedAt, currentLanguage()) })}
          </p>
        </>
      )}

      {canManage && mode === 'view' && (
        <div className="relative z-10 mt-auto flex gap-2 pt-4">
          <button
            onClick={() => setMode('rename')}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            {t('dashboard.rename')}
          </button>
          <button
            onClick={() => {
              setDeleteError(null)
              setMode('confirmDelete')
            }}
            className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
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
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              {deleting ? t('dashboard.deleting') : t('dashboard.deleteYes')}
            </button>
            <button
              onClick={() => setMode('view')}
              disabled={deleting}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
