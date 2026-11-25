import { useCallback, useEffect, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { boardsApi, type Board } from '../api/boards'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { CanvasStage } from '../canvas/CanvasStage'
import { historyReducer, initHistory } from '../canvas/history'
import { parseCanvasContent, restyleShape } from '../canvas/shapes'
import { Toolbar } from '../canvas/Toolbar'
import { TOOLS } from '../canvas/tools'
import { DEFAULT_STYLE, type Shape, type ShapeStyle, type Tool } from '../canvas/types'
import { useCanvasSaver, type SaveStatus } from '../canvas/useCanvasSaver'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { i18n } from '../i18n'

type Loaded = { board: Board; shapes: Shape[]; version: number }
type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error'; message: string }
  | ({ status: 'loaded' } & Loaded)

/** Loads the board, then hands it to the editor. Reloading remounts the editor with fresh state. */
export function BoardPage() {
  const { id } = useParams()
  const boardId = Number(id)
  const { logout } = useAuth()
  const { t } = useTranslation()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [loadCount, setLoadCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    // A malformed id in the URL is treated like a board that doesn't exist.
    const request =
      Number.isInteger(boardId) && boardId > 0 ? boardsApi.get(boardId) : Promise.reject(new ApiError(404, ''))
    request.then(
      (detail) => {
        if (cancelled) return
        setState({
          status: 'loaded',
          board: detail.board,
          shapes: parseCanvasContent(detail.canvas.content),
          version: detail.canvas.version,
        })
      },
      (error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) return logout()
        if (error instanceof ApiError && error.status === 404) return setState({ status: 'notFound' })
        // i18n.t rather than t, so switching language doesn't re-run this effect and reload.
        setState({ status: 'error', message: error instanceof ApiError ? error.message : i18n.t('errors.unexpected') })
      },
    )
    return () => {
      cancelled = true
    }
  }, [boardId, loadCount, logout])

  const reload = useCallback(() => {
    setState({ status: 'loading' })
    setLoadCount((n) => n + 1)
  }, [])

  if (state.status === 'loaded') {
    return (
      <BoardEditor
        key={loadCount}
        board={state.board}
        shapes={state.shapes}
        version={state.version}
        onReload={reload}
      />
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      {state.status === 'loading' && (
        <p role="status" className="text-slate-500">
          {t('common.loading')}
        </p>
      )}
      {state.status === 'notFound' && (
        <>
          <h1 className="text-xl font-semibold text-slate-900">{t('board.notFoundTitle')}</h1>
          <p className="text-sm text-slate-500">{t('board.notFoundHint')}</p>
        </>
      )}
      {state.status === 'error' && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}{' '}
          <button onClick={reload} className="font-medium underline">
            {t('common.tryAgain')}
          </button>
        </div>
      )}
      {state.status !== 'loading' && (
        <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ← {t('board.back')}
        </Link>
      )}
    </div>
  )
}

const TOOL_BY_KEY = new Map(TOOLS.map(({ tool, key }) => [key.toLowerCase(), tool]))

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

function BoardEditor({ board, shapes: initialShapes, version, onReload }: Loaded & { onReload: () => void }) {
  const { t } = useTranslation()
  const [history, dispatch] = useReducer(historyReducer, initialShapes, initHistory)
  const [tool, setToolState] = useState<Tool>('pen')
  const [style, setStyle] = useState<ShapeStyle>(DEFAULT_STYLE)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { status, retry } = useCanvasSaver(board.id, history.present, version)

  const setTool = useCallback((next: Tool) => {
    setToolState(next)
    if (next !== 'select') setSelectedId(null)
  }, [])

  // A style change also applies to the selected shape, so it can be recolored after drawing.
  function changeStyle(change: Partial<ShapeStyle>) {
    setStyle((current) => ({ ...current, ...change }))
    if (selectedId) dispatch({ type: 'update', id: selectedId, update: (shape) => restyleShape(shape, change) })
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z') {
          event.preventDefault()
          dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
        } else if (key === 'y') {
          event.preventDefault()
          dispatch({ type: 'redo' })
        }
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        dispatch({ type: 'remove', id: selectedId })
        setSelectedId(null)
        return
      }
      if (event.altKey) return
      const shortcut = TOOL_BY_KEY.get(key)
      if (shortcut) setTool(shortcut)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, setTool])

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ← {t('board.back')}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900" title={board.name}>
          {board.name}
        </h1>
        <SaveIndicator status={status} onRetry={retry} onReload={onReload} />
        <LanguageSwitcher />
      </header>
      <div className="flex min-h-0 flex-1">
        <Toolbar
          tool={tool}
          style={style}
          canUndo={history.past.length > 0}
          canRedo={history.future.length > 0}
          onTool={setTool}
          onStyle={changeStyle}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
        />
        <CanvasStage
          shapes={history.present}
          tool={tool}
          style={style}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={(shape) => dispatch({ type: 'add', shape })}
          onUpdate={(id, update) => dispatch({ type: 'update', id, update })}
          onRemove={(id) => {
            dispatch({ type: 'remove', id })
            if (id === selectedId) setSelectedId(null)
          }}
        />
      </div>
    </div>
  )
}

const STATUS_CLASS: Record<SaveStatus, string> = {
  saved: 'text-slate-500',
  saving: 'text-slate-500',
  unsaved: 'text-amber-600',
  error: 'text-red-600',
  conflict: 'text-red-600',
}

function SaveIndicator({ status, onRetry, onReload }: { status: SaveStatus; onRetry: () => void; onReload: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="status" className={`flex items-center gap-2 text-sm ${STATUS_CLASS[status]}`}>
      <span>{t(`board.status.${status}`)}</span>
      {status === 'error' && (
        <button onClick={onRetry} className="font-medium underline">
          {t('board.retryNow')}
        </button>
      )}
      {status === 'conflict' && (
        <button onClick={onReload} className="font-medium underline">
          {t('board.reload')}
        </button>
      )}
    </div>
  )
}
