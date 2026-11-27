import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { boardsApi, canEdit, type Board } from '../api/boards'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { CanvasStage, type CanvasHandle } from '../canvas/CanvasStage'
import { CursorLayer } from '../canvas/CursorLayer'
import { downloadBlob, exportFileName } from '../canvas/exportImage'
import { isTypingTarget } from '../canvas/keyboard'
import { emptyHistory, record, takeRedo, takeUndo, type LocalHistory } from '../canvas/localHistory'
import { inverseOf, type BoardOp } from '../canvas/ops'
import { parseCanvasContent, restyleShape } from '../canvas/shapes'
import { Toolbar } from '../canvas/Toolbar'
import { TOOLS } from '../canvas/tools'
import { DEFAULT_STYLE, type Shape, type ShapeStyle, type Tool } from '../canvas/types'
import { ChatPanel } from '../components/ChatPanel'
import { ArrowLeftIcon, ChatIcon, DownloadIcon, ShareIcon } from '../components/icons'
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
    <div className="flex min-h-screen items-center justify-center px-4 text-center">
      {state.status === 'loading' ? (
        <p role="status" className="text-slate-500">
          {t('common.loading')}
        </p>
      ) : (
        <div className="card flex w-full max-w-md flex-col items-center gap-3 p-8">
          {state.status === 'notFound' && (
            <>
              <h1 className="text-xl font-bold text-slate-900">{t('board.notFoundTitle')}</h1>
              <p className="text-sm text-slate-500">{t('board.notFoundHint')}</p>
            </>
          )}
          {state.status === 'error' && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {state.message}{' '}
              <button onClick={reload} className="font-medium underline">
                {t('common.tryAgain')}
              </button>
            </div>
          )}
          <Link to="/" className="btn-primary mt-2 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm">
            <ArrowLeftIcon />
            {t('board.back')}
          </Link>
        </div>
      )}
    </div>
  )
}

/** Whether the chat panel is open (it is by default), remembered across boards and visits. */
const CHAT_OPEN_KEY = 'syncboard.chatOpen'

const TOOL_BY_KEY = new Map(TOOLS.map(({ tool, key }) => [key.toLowerCase(), tool]))

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
  const canvasRef = useRef<CanvasHandle>(null)
  const [exporting, setExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)
  const [chatOpen, setChatOpenState] = useState(() => localStorage.getItem(CHAT_OPEN_KEY) !== 'false')
  const setChatOpen = (open: boolean) => {
    setChatOpenState(open)
    localStorage.setItem(CHAT_OPEN_KEY, String(open))
  }
  const { markRead } = room.chat
  const latestMessageId = room.chat.messages.at(-1)?.id
  // Messages count as read while the panel is open.
  useEffect(() => {
    if (chatOpen) markRead()
  }, [chatOpen, latestMessageId, markRead])

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

  async function exportPng() {
    setExporting(true)
    setExportFailed(false)
    try {
      const blob = await canvasRef.current?.exportPng()
      if (blob) downloadBlob(blob, exportFileName(board.name, new Date()))
    } catch {
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }

  const syncStatus: SyncStatus = !unsynced ? 'saved' : room.status === 'connected' ? 'saving' : 'offline'

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-white/70 bg-white/70 px-4 py-2.5 backdrop-blur-md">
        <Link
          to="/"
          className="btn-secondary inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
        >
          <ArrowLeftIcon className="h-4 w-4 text-slate-400" />
          {t('board.back')}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-bold text-slate-900" title={board.name}>
          {board.name}
        </h1>
        <PresenceBar online={room.online} selfId={user?.id} status={room.status} />
        {readOnly ? (
          <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 ring-1 ring-violet-200">
            {t('board.viewOnly')}
          </span>
        ) : (
          <SyncIndicator status={syncStatus} />
        )}
        <button
          onClick={() => setChatOpen(!chatOpen)}
          aria-expanded={chatOpen}
          className="btn-secondary relative inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm"
        >
          <ChatIcon className="h-4 w-4 text-blue-500" />
          {t('chat.toggle')}
          {!chatOpen && room.chat.unread > 0 && (
            <span
              aria-label={t('chat.unread', { count: room.chat.unread })}
              className="absolute -top-2 -right-2 min-w-5 rounded-full bg-red-500 px-1.5 text-center text-xs font-semibold leading-5 text-white"
            >
              {room.chat.unread > 99 ? '99+' : room.chat.unread}
            </span>
          )}
        </button>
        <button
          onClick={exportPng}
          disabled={shapes.length === 0 || exporting}
          title={shapes.length === 0 ? t('board.export.empty') : undefined}
          className="btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm"
        >
          <DownloadIcon className="h-4 w-4 text-emerald-500" />
          {t('board.export.button')}
        </button>
        <button
          onClick={() => setSharing(true)}
          className="btn-primary inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-sm"
        >
          <ShareIcon />
          {t('share.open')}
        </button>
        <LanguageSwitcher />
      </header>
      {room.error && (
        <div role="alert" className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{room.error}</span>
          <button onClick={room.clearError} className="font-medium underline">
            {t('common.dismiss')}
          </button>
        </div>
      )}
      {exportFailed && (
        <div role="alert" className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <span className="flex-1">{t('board.export.failed')}</span>
          <button onClick={() => setExportFailed(false)} className="font-medium underline">
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
      <div className="flex min-h-0 flex-1 gap-3 p-3">
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
        {/* The frame (radius, border, shadow) is on a wrapper, so the stage's own box keeps no border offset. */}
        <div className="card flex min-w-0 flex-1 overflow-hidden">
          <CanvasStage
            ref={canvasRef}
            shapes={shapes}
            readOnly={readOnly}
            tool={tool}
            style={style}
            selectedId={selected}
            onSelect={setSelectedId}
            onAdd={(shape) => perform({ type: 'add', shape })}
            onUpdate={update}
            onRemove={remove}
            onPointerPosition={room.sendCursor}
            overlay={(view) => <CursorLayer cursors={room.cursors} viewport={view} />}
          />
        </div>
        {chatOpen && (
          <ChatPanel
            messages={room.chat.messages}
            pending={room.chat.pending}
            hasMore={room.chat.hasMore}
            typingUsers={room.chat.typingUsers}
            selfId={user?.id}
            onSend={room.chat.send}
            onTyping={room.chat.reportTyping}
            onRetry={room.chat.retry}
            onDiscard={room.chat.discard}
            onLoadOlder={room.chat.loadOlder}
            onClose={() => setChatOpen(false)}
          />
        )}
      </div>
    </div>
  )
}

/** saved: the server has everything; saving: changes on their way; offline: queued until reconnect. */
type SyncStatus = 'saved' | 'saving' | 'offline'

const STATUS_CLASS: Record<SyncStatus, { text: string; dot: string }> = {
  saved: { text: 'text-slate-500', dot: 'bg-emerald-400' },
  saving: { text: 'text-slate-500', dot: 'bg-blue-400 animate-pulse' },
  offline: { text: 'text-amber-700', dot: 'bg-amber-400' },
}

function SyncIndicator({ status }: { status: SyncStatus }) {
  const { t } = useTranslation()
  const look = STATUS_CLASS[status]
  return (
    <div role="status" className={`flex items-center gap-1.5 text-xs font-medium ${look.text}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${look.dot}`} />
      {t(`board.status.${status}`)}
    </div>
  )
}
