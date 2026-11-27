import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { boardsApi, type Board } from '../api/boards'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { AppHeader } from '../components/AppHeader'
import { BoardCard } from '../components/BoardCard'
import { BoardNameForm } from '../components/BoardNameForm'
import { BoardsIcon, CalendarIcon, PlusIcon, UserIcon, UsersIcon } from '../components/icons'
import { currentLanguage, i18n } from '../i18n'
import { formatToday } from '../i18n/format'

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; boards: Board[] }

export function DashboardPage() {
  const { user, logout } = useAuth()
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

  const boards = state.status === 'ready' ? state.boards : []
  const owned = boards.filter((b) => b.role === 'OWNER').length
  const stats = [
    { key: 'total', value: boards.length, icon: <BoardsIcon />, tint: 'bg-blue-50 text-blue-600' },
    { key: 'owned', value: owned, icon: <UserIcon />, tint: 'bg-violet-50 text-violet-600' },
    { key: 'shared', value: boards.length - owned, icon: <UsersIcon />, tint: 'bg-emerald-50 text-emerald-600' },
  ] as const

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <section className="card relative mb-6 overflow-hidden p-6 sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-linear-to-r from-blue-50/80 via-white to-violet-100/70"
          />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-blue-600">
                <CalendarIcon />
                {t('dashboard.today', { date: formatToday(currentLanguage()) })}
              </p>
              {user && (
                <p className="mt-2 truncate text-2xl font-bold text-slate-900 sm:text-3xl">
                  {t('dashboard.greeting', { name: user.fullName })}
                </p>
              )}
              <p className="mt-1 text-sm text-slate-500">{t('dashboard.subtitle')}</p>
            </div>
            {state.status === 'ready' && !creating && (
              <button onClick={() => setCreating(true)} className="btn-primary rounded-xl px-5 py-3 text-sm">
                {t('dashboard.newBoard')}
              </button>
            )}
          </div>
        </section>

        {state.status === 'ready' && (
          <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <button
              onClick={() => setCreating(true)}
              disabled={creating}
              className="card group flex flex-col items-center justify-center gap-2 p-5 text-center transition hover:-translate-y-0.5 hover:shadow-lift disabled:cursor-default disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              <span className="bg-brand flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-md shadow-indigo-500/30">
                <PlusIcon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-slate-800">{t('dashboard.quick.newBoard')}</span>
              <span className="text-xs text-slate-500">{t('dashboard.quick.newBoardHint')}</span>
            </button>
            {stats.map(({ key, value, icon, tint }) => (
              <div key={key} className="card flex flex-col items-center justify-center gap-1.5 p-5 text-center">
                <span aria-hidden="true" className={`flex h-10 w-10 items-center justify-center rounded-xl ${tint}`}>
                  {icon}
                </span>
                <span className="text-2xl font-bold text-slate-900 tabular-nums">{value}</span>
                <span className="text-xs text-slate-500">{t(`dashboard.stats.${key}`)}</span>
              </div>
            ))}
          </div>
        )}

        <h1 className="mb-4 text-xl font-bold text-slate-900">{t('dashboard.title')}</h1>

        {state.status === 'loading' && (
          <p role="status" className="text-slate-500">
            {t('common.loading')}
          </p>
        )}

        {state.status === 'error' && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.message}{' '}
            <button onClick={retry} className="font-medium underline">
              {t('common.tryAgain')}
            </button>
          </div>
        )}

        {state.status === 'ready' && (
          <>
            {creating && (
              <section className="card mb-6 max-w-md p-5">
                <h2 className="mb-3 text-sm font-semibold text-slate-800">{t('dashboard.newBoardTitle')}</h2>
                <BoardNameForm
                  label={t('dashboard.newBoardName')}
                  submitLabel={t('dashboard.create')}
                  onSubmit={createBoard}
                  onCancel={() => setCreating(false)}
                />
              </section>
            )}

            {state.boards.length === 0 && !creating ? (
              <div className="card flex flex-col items-center border-dashed px-6 py-14 text-center">
                <span aria-hidden="true" className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600">
                  <BoardsIcon className="h-6 w-6" />
                </span>
                <p className="font-semibold text-slate-800">{t('dashboard.emptyTitle')}</p>
                <p className="mt-1 text-sm text-slate-500">{t('dashboard.emptyHint')}</p>
              </div>
            ) : (
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
