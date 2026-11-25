import { useCallback, useEffect, useRef, useState } from 'react'
import { boardsApi } from '../api/boards'
import { ApiError } from '../api/client'
import { toContent } from './shapes'
import type { Shape } from './types'

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict'

/** Wait this long after the last change before saving. */
export const SAVE_DEBOUNCE_MS = 1500
/** After a failed save (e.g. offline), keep retrying at this pace. */
export const SAVE_RETRY_MS = 5000

/**
 * Autosaves `shapes` (whole document, optimistic locking by version). Changes are detected by
 * reference, which the immutable history reducer guarantees. At most one save is in flight; edits
 * made during a save are picked up by the next one. A 409 stops saving until the page reloads.
 */
export function useCanvasSaver(boardId: number, shapes: Shape[], initialVersion: number) {
  const [saved, setSaved] = useState(shapes)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [conflict, setConflict] = useState(false)

  // Mirrors for code that runs outside render: async saves and the unmount flush.
  const version = useRef(initialVersion)
  const savedRef = useRef(shapes)
  const conflictRef = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const latest = useRef(shapes)
  useEffect(() => {
    latest.current = shapes
  })

  const dirty = shapes !== saved

  const save = useCallback(() => {
    if (inFlight.current || conflictRef.current) return inFlight.current ?? Promise.resolve()
    const toSave = latest.current
    setSaving(true)
    const run = boardsApi
      .saveCanvas(boardId, toContent(toSave), version.current)
      .then(
        (result) => {
          version.current = result.version
          savedRef.current = toSave
          setSaved(toSave)
          setFailed(false)
        },
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 409) {
            conflictRef.current = true
            setConflict(true)
          } else {
            setFailed(true)
          }
        },
      )
      .finally(() => {
        inFlight.current = null
        setSaving(false)
      })
    inFlight.current = run
    return run
  }, [boardId])

  useEffect(() => {
    if (!dirty || saving || conflict) return
    const timer = setTimeout(save, failed ? SAVE_RETRY_MS : SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [shapes, dirty, saving, conflict, failed, save])

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    if (!dirty && !saving) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saving])

  // Leaving the page inside the app (e.g. back to the dashboard): save what is pending right away,
  // after any save that is still running so the version is current.
  useEffect(
    () => () => {
      const pending = latest.current
      void (inFlight.current ?? Promise.resolve()).then(() => {
        if (pending === savedRef.current || conflictRef.current) return
        return boardsApi.saveCanvas(boardId, toContent(pending), version.current).then(
          () => undefined,
          () => undefined,
        )
      })
    },
    [boardId],
  )

  const status: SaveStatus = conflict
    ? 'conflict'
    : saving
      ? 'saving'
      : failed
        ? 'error'
        : dirty
          ? 'unsaved'
          : 'saved'

  return { status, retry: save }
}
