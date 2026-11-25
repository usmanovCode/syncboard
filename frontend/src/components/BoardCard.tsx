import { useState } from 'react'
import type { Board } from '../api/boards'
import { ApiError } from '../api/client'
import { BoardNameForm } from './BoardNameForm'

type Props = {
  board: Board
  /** Only owners may rename/delete; shared boards (board_members, later) are read-only here. */
  canManage: boolean
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}

type Mode = 'view' | 'rename' | 'confirmDelete'

const dateFormat = new Intl.DateTimeFormat('uz-UZ', { day: 'numeric', month: 'short', year: 'numeric' })

export function BoardCard({ board, canManage, onRename, onDelete }: Props) {
  const [mode, setMode] = useState<Mode>('view')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete()
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Kutilmagan xatolik yuz berdi')
      setDeleting(false)
    }
  }

  return (
    <li
      aria-label={board.name}
      className="flex min-h-40 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
    >
      {mode === 'rename' ? (
        <BoardNameForm
          label="Yangi nom"
          initialName={board.name}
          submitLabel="Saqlash"
          onSubmit={async (name) => {
            await onRename(name)
            setMode('view')
          }}
          onCancel={() => setMode('view')}
        />
      ) : (
        <>
          <h2 className="truncate text-base font-semibold text-slate-900" title={board.name}>
            {board.name}
          </h2>
          <p className="mt-1 text-xs text-slate-500">Yangilangan: {dateFormat.format(new Date(board.updatedAt))}</p>
        </>
      )}

      {canManage && mode === 'view' && (
        <div className="mt-auto flex gap-2 pt-4">
          <button
            onClick={() => setMode('rename')}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          >
            Nomini o'zgartirish
          </button>
          <button
            onClick={() => {
              setDeleteError(null)
              setMode('confirmDelete')
            }}
            className="rounded-lg px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            O'chirish
          </button>
        </div>
      )}

      {mode === 'confirmDelete' && (
        <div className="mt-auto pt-4" role="group" aria-label="O'chirishni tasdiqlash">
          <p className="text-sm text-slate-700">Doska butunlay o'chiriladi. Davom etasizmi?</p>
          {deleteError && <p className="mt-1 text-xs text-red-600">{deleteError}</p>}
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
            >
              {deleting ? "O'chirilmoqda…" : "Ha, o'chirish"}
            </button>
            <button
              onClick={() => setMode('view')}
              disabled={deleting}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              Bekor qilish
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
