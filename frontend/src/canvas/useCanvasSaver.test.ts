import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardsApi } from '../api/boards'
import { ApiError } from '../api/client'
import { createText } from './shapes'
import type { Shape } from './types'
import { SAVE_DEBOUNCE_MS, SAVE_RETRY_MS, useCanvasSaver } from './useCanvasSaver'

const style = { stroke: '#000', strokeWidth: 2 }
const shapesWith = (...texts: string[]): Shape[] => texts.map((t) => createText({ x: 0, y: 0 }, t, style, t))

function setup(initial: Shape[] = []) {
  return renderHook(({ shapes }) => useCanvasSaver(7, shapes, 3), { initialProps: { shapes: initial } })
}

/** Advances fake time and lets the resulting save promises settle. */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('useCanvasSaver', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('saves once the user pauses, with the current version', async () => {
    let version = 3
    const save = vi
      .spyOn(boardsApi, 'saveCanvas')
      .mockImplementation(async () => ({ version: ++version, updatedAt: '2026-11-25T00:00:00Z' }))
    const hook = setup()
    expect(hook.result.current.status).toBe('saved')

    hook.rerender({ shapes: shapesWith('a') })
    expect(hook.result.current.status).toBe('unsaved')
    await advance(SAVE_DEBOUNCE_MS - 100)
    hook.rerender({ shapes: shapesWith('a', 'b') }) // still drawing: restart the wait
    await advance(SAVE_DEBOUNCE_MS - 100)
    expect(save).not.toHaveBeenCalled()

    await advance(200)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(7, { schemaVersion: 1, shapes: shapesWith('a', 'b') }, 3)
    expect(hook.result.current.status).toBe('saved')

    hook.rerender({ shapes: shapesWith('a') })
    await advance(SAVE_DEBOUNCE_MS)
    expect(save).toHaveBeenLastCalledWith(7, expect.anything(), 4)
  })

  it('saves edits made during a save afterwards', async () => {
    let finish!: () => void
    const save = vi.spyOn(boardsApi, 'saveCanvas').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ version: 4, updatedAt: '' })
        }),
    )
    save.mockResolvedValue({ version: 5, updatedAt: '' })
    const hook = setup()

    hook.rerender({ shapes: shapesWith('a') })
    await advance(SAVE_DEBOUNCE_MS)
    expect(hook.result.current.status).toBe('saving')
    hook.rerender({ shapes: shapesWith('a', 'b') })
    await advance(SAVE_DEBOUNCE_MS * 2)
    expect(save).toHaveBeenCalledTimes(1) // never two saves at once

    await act(async () => finish())
    await advance(SAVE_DEBOUNCE_MS)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith(7, { schemaVersion: 1, shapes: shapesWith('a', 'b') }, 4)
    expect(hook.result.current.status).toBe('saved')
  })

  it('stops saving after a conflict', async () => {
    const save = vi.spyOn(boardsApi, 'saveCanvas').mockRejectedValue(new ApiError(409, 'conflict', 'CANVAS_CONFLICT'))
    const hook = setup()

    hook.rerender({ shapes: shapesWith('a') })
    await advance(SAVE_DEBOUNCE_MS)
    expect(hook.result.current.status).toBe('conflict')

    hook.rerender({ shapes: shapesWith('a', 'b') })
    await advance(SAVE_RETRY_MS * 2)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying after other failures', async () => {
    const save = vi
      .spyOn(boardsApi, 'saveCanvas')
      .mockRejectedValueOnce(new ApiError(0, 'offline'))
      .mockResolvedValue({ version: 4, updatedAt: '' })
    const hook = setup()

    hook.rerender({ shapes: shapesWith('a') })
    await advance(SAVE_DEBOUNCE_MS)
    expect(hook.result.current.status).toBe('error')

    await advance(SAVE_RETRY_MS)
    expect(save).toHaveBeenCalledTimes(2)
    expect(hook.result.current.status).toBe('saved')
  })

  it('saves pending changes immediately when the editor closes', async () => {
    const save = vi.spyOn(boardsApi, 'saveCanvas').mockResolvedValue({ version: 4, updatedAt: '' })
    const hook = setup()

    hook.rerender({ shapes: shapesWith('a') })
    hook.unmount()
    await act(() => Promise.resolve())

    expect(save).toHaveBeenCalledWith(7, { schemaVersion: 1, shapes: shapesWith('a') }, 3)
  })

  it('does not save on close when nothing changed', async () => {
    const save = vi.spyOn(boardsApi, 'saveCanvas')
    const hook = setup(shapesWith('a'))
    hook.unmount()
    await act(() => Promise.resolve())
    expect(save).not.toHaveBeenCalled()
  })
})
