import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { boardsApi, type Board } from '../api/boards'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { AppHeader } from '../components/AppHeader'
import { BoardCard } from '../components/BoardCard'
import { BoardNameForm } from '../components/BoardNameForm'
import { i18n } from '../i18n'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; boards: Board[] }

export function DashboardPage() {
  const { logout } = useAuth()
  const { t } = useTranslation()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [creating, setCreating] = useState(false)

  // An expired token surfaces here as 401; send the user back to login instead of showing an error.
  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) logout()
      throw error
    },
    [logout],
  )

  // Fetches only; callers decide whether to show the loading state (initial state already is).
  const fetchBoards = useCallback(() => {
    let cancelled = false
    boardsApi.list().then(
      (boards) => {
        if (!cancelled) setState({ status: 'ready', boards })
      },
      (error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) return logout()
        setState({
          status: 'error',
          message: error instanceof ApiError ? error.message : i18n.t('errors.unexpected'),
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [logout])

  useEffect(() => fetchBoards(), [fetchBoards])

  function retry() {
    setState({ status: 'loading' })
    fetchBoards()
  }

  const updateBoards = (fn: (boards: Board[]) => Board[]) =>
    setState((s) => (s.status === 'ready' ? { status: 'ready', boards: fn(s.boards) } : s))

  async function createBoard(name: string) {
    const board = await boardsApi.create(name).catch(handleError)
    updateBoards((boards) => [board, ...boards])
    setCreating(false)
  }

  async function renameBoard(id: number, name: string) {
    const updated = await boardsApi.rename(id, name).catch(handleError)
    // Renaming bumps updatedAt, so the board moves to the front like on the next load.
    updateBoards((boards) => [updated, ...boards.filter((b) => b.id !== id)])
  }

  async function deleteBoard(id: number) {
    await boardsApi.remove(id).catch(handleError)
    updateBoards((boards) => boards.filter((b) => b.id !== id))
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-900">{t('dashboard.title')}</h1>
          {state.status === 'ready' && !creating && (
            <button
              onClick={() => setCreating(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {t('dashboard.newBoard')}
            </button>
          )}
        </div>

        {state.status === 'loading' && (
          <p role="status" className="text-slate-500">
            {t('common.loading')}
          </p>
        )}

        {state.status === 'error' && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.message}{' '}
            <button onClick={retry}className="font-medium underline">
              {t('common.tryAgain')}
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            {creating && (
              <section className="mb-6 max-w-md rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-medium text-slate-700">{t('dashboard.newBoardTitle')}</h2>
                <BoardNameForm
                  label={t('dashboard.newBoardName')}
                  submitLabel={t('dashboard.create')}
                  onSubmit={createBoard}
                  onCancel={() => setCreating(false)}
                />
              </section>
            )}

            {state.boards.length === 0 && !creating ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <p className="font-medium text-slate-700">{t('dashboard.emptyTitle')}</p>
                <p className="mt-1 text-sm text-slate-500">{t('dashboard.emptyHint')}</p>
              </div>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.boards.map((board) => (
                  <BoardCard
                    key={board.id}
                    board={board}
                    canManage={board.role === 'OWNER'}
                    onRename={(name) => renameBoard(board.id, name)}
                    onDelete={() => deleteBoard(board.id)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  )
}
