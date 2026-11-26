import type { Point } from './types'

/**
 * What part of the board is on screen: screen = world × scale + (x, y). Shapes, ops and cursors are
 * always in world (board) coordinates, so they mean the same to everyone whatever their zoom; only
 * drawing converts. Kept in component state only, never saved.
 */
export type Viewport = { x: number; y: number; scale: number }
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
export type Size = { width: number; height: number }

export const MIN_SCALE = 0.1
export const MAX_SCALE = 4
/** "Fit to content" never zooms in past 100%, so a small sketch doesn't fill the screen. */
export const FIT_MAX_SCALE = 1
/** Screen pixels left around the content by "fit to content". */
export const FIT_PADDING = 48

export const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 }

const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export function toWorld(view: Viewport, p: Point): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale }
}

export function toScreen(view: Viewport, p: Point): Point {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y }
}

/** Zooms by `factor`, keeping the board point under `screenPoint` where it is. */
export function zoomAt(view: Viewport, screenPoint: Point, factor: number): Viewport {
  const scale = clampScale(view.scale * factor)
  if (scale === view.scale) return view
  const anchor = toWorld(view, screenPoint)
  return { scale, x: screenPoint.x - anchor.x * scale, y: screenPoint.y - anchor.y * scale }
}

/** Sets the zoom to `scale`, around the middle of the screen. */
export function zoomTo(view: Viewport, size: Size, scale: number): Viewport {
  return zoomAt(view, { x: size.width / 2, y: size.height / 2 }, scale / view.scale)
}

export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy }
}

/** The whole drawing centered on screen; the initial view for an empty board. */
export function fitToContent(bounds: Bounds | null, size: Size): Viewport {
  if (!bounds || size.width <= 0 || size.height <= 0) return INITIAL_VIEWPORT
  const width = Math.max(bounds.maxX - bounds.minX, 1)
  const height = Math.max(bounds.maxY - bounds.minY, 1)
  const fit = Math.min((size.width - 2 * FIT_PADDING) / width, (size.height - 2 * FIT_PADDING) / height)
  const scale = clampScale(Math.min(fit, FIT_MAX_SCALE))
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return { scale, x: size.width / 2 - centerX * scale, y: size.height / 2 - centerY * scale }
}

/** Wheel deltas in pixels, whatever unit the browser reports. */
export function wheelPixels(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey'>): Point {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1
  let dx = event.deltaX * unit
  let dy = event.deltaY * unit
  // Shift + mouse wheel scrolls sideways on Windows/Linux, which report it as deltaY.
  if (event.shiftKey && dx === 0) [dx, dy] = [dy, 0]
  return { x: dx, y: dy }
}

/**
 * Zoom factor for a Ctrl+wheel / trackpad pinch delta. A mouse wheel notch (~100 px) is ~1.1×;
 * pinches send many small deltas and zoom smoothly.
 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-Math.max(-10, Math.min(10, deltaY)) * 0.01)
}
