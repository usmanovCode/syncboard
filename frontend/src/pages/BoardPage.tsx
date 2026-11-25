import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { boardsApi, canEdit, type Board } from '../api/boards'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { CanvasStage } from '../canvas/CanvasStage'
import { emptyHistory, record, takeRedo, takeUndo, type LocalHistory } from '../canvas/localHistory'
import { inverseOf, type BoardOp } from '../canvas/ops'
import { parseCanvasContent, restyleShape } from '../canvas/shapes'
import { Toolbar } from '../canvas/Toolbar'
import { TOOLS } from '../canvas/tools'
import { DEFAULT_STYLE, type Shape, type ShapeStyle, type Tool } from '../canvas/types'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { PresenceBar } from '../components/PresenceBar'
import { ShareDialog } from '../components/ShareDialog'
import { i18n } from '../i18n'
import { useBoardRoom } from '../realtime/useBoardRoom'

type Loaded = { board: Board; shapes: Shape[]; version: number }
type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error'; message: string }
  | ({ status: 'loaded' } & Loaded)

/**
 * Loads the board (REST, for the first paint), then hands it to the editor, whose real-time room
 * replaces the drawing with the live one as soon as it joins.
 */
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
    return <BoardEditor key={loadCount} board={state.board} shapes={state.shapes} version={state.version} />
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

function BoardEditor({ board, shapes: initialShapes, version }: Loaded) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  // Viewers see the drawing but get no tools; the server rejects their writes anyway.
  const readOnly = !canEdit(board.role)
  const [sharing, setSharing] = useState(false)
  const room = useBoardRoom(board.id, initialShapes, version)
  const { shapes, sendOp } = room
  const [history, setHistory] = useState<LocalHistory>(emptyHistory)
  const [tool, setToolState] = useState<Tool>('pen')
  const [style, setStyle] = useState<ShapeStyle>(DEFAULT_STYLE)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const setTool = useCallback((next: Tool) => {
    setToolState(next)
    if (next !== 'select') setSelectedId(null)
  }, [])

  /** A change of mine: shown now, sent to the room, and undoable. */
  const perform = useCallback(
    (op: BoardOp) => {
      const inverse = inverseOf(op, shapes)
      if (!inverse) return // changes nothing (e.g. someone else just deleted the shape)
      sendOp(op)
      setHistory((h) => record(h, inverse))
    },
    [shapes, sendOp],
  )

  const update = useCallback(
    (id: string, change: (shape: Shape) => Shape) => {
      const shape = shapes.find((s) => s.id === id)
      const next = shape && change(shape)
      if (next && next !== shape) perform({ type: 'update', shape: next })
    },
    [shapes, perform],
  )

  const remove = useCallback(
    (id: string) => {
      perform({ type: 'remove', id })
      setSelectedId((current) => (current === id ? null : current))
    },
    [perform],
  )

  const undo = useCallback(() => {
    const step = takeUndo(history, shapes)
    if (!step) return
    sendOp(step.op)
    setHistory(step.history)
  }, [history, shapes, sendOp])

  const redo = useCallback(() => {
    const step = takeRedo(history, shapes)
    if (!step) return
    sendOp(step.op)
    setHistory(step.history)
  }, [history, shapes, sendOp])

  // Someone else may delete the selected shape.
  const selected = selectedId && shapes.some((s) => s.id === selectedId) ? selectedId : null

  // A style change also applies to the selected shape, so it can be recolored after drawing.
  function changeStyle(change: Partial<ShapeStyle>) {
    setStyle((current) => ({ ...current, ...change }))
    if (selected) update(selected, (shape) => restyleShape(shape, change))
  }

  useEffect(() => {
    if (readOnly) return
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) redo()
          else undo()
        } else if (key === 'y') {
          event.preventDefault()
          redo()
        }
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
        event.preventDefault()
        remove(selected)
        return
      }
      if (event.altKey) return
      const shortcut = TOOL_BY_KEY.get(key)
      if (shortcut) setTool(shortcut)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [readOnly, selected, setTool, undo, redo, remove])

  // Warn before closing the tab while changes haven't reached the server.
  const unsynced = room.pendingCount > 0
  useEffect(() => {
    if (!unsynced) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsynced])

  const syncStatus: SyncStatus = !unsynced ? 'saved' : room.status === 'connected' ? 'saving' : 'offline'

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <Link to="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ← {t('board.back')}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900" title={board.name}>
          {board.name}
        </h1>
        <PresenceBar online={room.online} selfId={user?.id} status={room.status} />
        {readOnly ? (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {t('board.viewOnly')}
          </span>
        ) : (
          <SyncIndicator status={syncStatus} />
        )}
        <button
          onClick={() => setSharing(true)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
        >
          {t('share.open')}
        </button>
        <LanguageSwitcher />
      </header>
      {room.error && (
        <div role="alert" className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{room.error}</span>
          <button onClick={room.clearError} className="font-medium underline">
            {t('common.dismiss')}
          </button>
        </div>
      )}
      {sharing && user && (
        <ShareDialog
          board={board}
          currentUserId={user.id}
          onClose={() => setSharing(false)}
          onLeft={() => navigate('/', { replace: true })}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {!readOnly && (
          <Toolbar
            tool={tool}
            style={style}
            canUndo={history.undo.length > 0}
            canRedo={history.redo.length > 0}
            onTool={setTool}
            onStyle={changeStyle}
            onUndo={undo}
            onRedo={redo}
          />
        )}
        <CanvasStage
          shapes={shapes}
          readOnly={readOnly}
          tool={tool}
          style={style}
          selectedId={selected}
          onSelect={setSelectedId}
          onAdd={(shape) => perform({ type: 'add', shape })}
          onUpdate={update}
          onRemove={remove}
        />
      </div>
    </div>
  )
}

/** saved: the server has everything; saving: changes on their way; offline: queued until reconnect. */
type SyncStatus = 'saved' | 'saving' | 'offline'

const STATUS_CLASS: Record<SyncStatus, string> = {
  saved: 'text-slate-500',
  saving: 'text-slate-500',
  offline: 'text-amber-600',
}

function SyncIndicator({ status }: { status: SyncStatus }) {
  const { t } = useTranslation()
  return (
    <div role="status" className={`text-sm ${STATUS_CLASS[status]}`}>
      {t(`board.status.${status}`)}
    </div>
  )
}
