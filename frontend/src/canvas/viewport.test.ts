import { describe, expect, it } from 'vitest'
import {
  FIT_PADDING,
  INITIAL_VIEWPORT,
  MAX_SCALE,
  MIN_SCALE,
  fitToContent,
  panBy,
  toScreen,
  toWorld,
  wheelPixels,
  wheelZoomFactor,
  zoomAt,
  zoomTo,
} from './viewport'

const view = { x: 40, y: -20, scale: 2 }

describe('viewport', () => {
  it('converts between screen and board coordinates', () => {
    expect(toWorld(view, { x: 140, y: 80 })).toEqual({ x: 50, y: 50 })
    expect(toScreen(view, { x: 50, y: 50 })).toEqual({ x: 140, y: 80 })
    expect(toWorld(INITIAL_VIEWPORT, { x: 7, y: 9 })).toEqual({ x: 7, y: 9 })
  })

  it('zooms around the pointer, keeping the board point under it in place', () => {
    const pointer = { x: 300, y: 200 }
    const before = toWorld(view, pointer)

    const zoomed = zoomAt(view, pointer, 1.5)

    expect(zoomed.scale).toBe(3)
    expect(toWorld(zoomed, pointer).x).toBeCloseTo(before.x)
    expect(toWorld(zoomed, pointer).y).toBeCloseTo(before.y)
  })

  it('stays between 10% and 400%', () => {
    expect(zoomAt(view, { x: 0, y: 0 }, 100).scale).toBe(MAX_SCALE)
    expect(zoomAt(view, { x: 0, y: 0 }, 0.001).scale).toBe(MIN_SCALE)
    const max = { x: 0, y: 0, scale: MAX_SCALE }
    expect(zoomAt(max, { x: 5, y: 5 }, 2)).toBe(max) // nothing to do
  })

  it('zooms to an exact level around the middle of the screen', () => {
    const size = { width: 800, height: 600 }
    const middle = toWorld(view, { x: 400, y: 300 })

    const reset = zoomTo(view, size, 1)

    expect(reset.scale).toBe(1)
    expect(toWorld(reset, { x: 400, y: 300 })).toEqual(middle)
  })

  it('pans', () => {
    expect(panBy(view, 10, -5)).toEqual({ x: 50, y: -25, scale: 2 })
    expect(panBy(view, 0, 0)).toBe(view)
  })

  it('fits the content in the middle of the screen, never past 100%', () => {
    const size = { width: 800, height: 600 }

    const big = fitToContent({ minX: 0, minY: 0, maxX: 2000, maxY: 1000 }, size)
    expect(big.scale).toBeCloseTo((800 - 2 * FIT_PADDING) / 2000)
    expect(toScreen(big, { x: 1000, y: 500 })).toEqual({ x: 400, y: 300 }) // centered

    const small = fitToContent({ minX: 100, minY: 100, maxX: 150, maxY: 120 }, size)
    expect(small.scale).toBe(1)
    expect(toScreen(small, { x: 125, y: 110 })).toEqual({ x: 400, y: 300 })

    const huge = fitToContent({ minX: 0, minY: 0, maxX: 1e6, maxY: 10 }, size)
    expect(huge.scale).toBe(MIN_SCALE)
  })

  it('goes back to the start for an empty board or an unmeasured screen', () => {
    expect(fitToContent(null, { width: 800, height: 600 })).toEqual(INITIAL_VIEWPORT)
    expect(fitToContent({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 0 })).toEqual(INITIAL_VIEWPORT)
  })

  it('reads wheel deltas in pixels, sideways with Shift', () => {
    expect(wheelPixels({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false })).toEqual({ x: 0, y: 48 })
    expect(wheelPixels({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true })).toEqual({ x: 100, y: 0 })
    expect(wheelPixels({ deltaX: 5, deltaY: 7, deltaMode: 0, shiftKey: false })).toEqual({ x: 5, y: 7 })
  })

  it('zooms about 1.1× per wheel notch, in, out and smoothly for pinches', () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.105, 2)
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / 1.105, 2)
    expect(wheelZoomFactor(-2)).toBeCloseTo(1.02, 2)
  })
})
