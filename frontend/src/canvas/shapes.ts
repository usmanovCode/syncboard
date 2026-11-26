import type { Bounds } from './viewport'
import {
  SCHEMA_VERSION,
  type CanvasContent,
  type DrawTool,
  type Point,
  type Shape,
  type ShapeStyle,
  type TextShape,
} from './types'

/** One decimal is plenty for screen pixels and keeps pen strokes small in the saved JSON. */
const round = (n: number) => Math.round(n * 10) / 10

/** Shapes smaller than this (a click without a real drag) are discarded. */
const MIN_SIZE = 2

export function newShapeId(): string {
  return crypto.randomUUID()
}

export function textFontSize(strokeWidth: number): number {
  return 12 + strokeWidth * 3
}

/** The shape that starts when the pointer goes down with a drawing tool. */
export function startShape(tool: DrawTool, p: Point, style: ShapeStyle, id: string): Shape {
  const x = round(p.x)
  const y = round(p.y)
  const base = { id, stroke: style.stroke, strokeWidth: style.strokeWidth }
  switch (tool) {
    case 'pen':
      // Two equal points so a single click still renders as a dot (round line caps).
      return { ...base, type: 'pen', x: 0, y: 0, points: [x, y, x, y] }
    case 'rect':
      return { ...base, type: 'rect', x, y, width: 0, height: 0 }
    case 'ellipse':
      return { ...base, type: 'ellipse', x, y, radiusX: 0, radiusY: 0 }
    case 'line':
      return { ...base, type: 'line', x: 0, y: 0, points: [x, y, x, y] }
  }
}

/**
 * The shape while dragging from `start` to `p`. With `constrain` (Shift held) rectangles become
 * squares and ellipses circles.
 */
export function dragShape(shape: Shape, start: Point, p: Point, constrain: boolean): Shape {
  let dx = p.x - start.x
  let dy = p.y - start.y
  if (constrain && (shape.type === 'rect' || shape.type === 'ellipse')) {
    const size = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * size
    dy = Math.sign(dy || 1) * size
  }
  switch (shape.type) {
    case 'pen':
      return { ...shape, points: [...shape.points, round(p.x), round(p.y)] }
    case 'rect':
      // Normalized so width/height are never negative, whichever way the user drags.
      return {
        ...shape,
        x: round(Math.min(start.x, start.x + dx)),
        y: round(Math.min(start.y, start.y + dy)),
        width: round(Math.abs(dx)),
        height: round(Math.abs(dy)),
      }
    case 'ellipse':
      // The drag is the bounding box; x/y is its center.
      return {
        ...shape,
        x: round(start.x + dx / 2),
        y: round(start.y + dy / 2),
        radiusX: round(Math.abs(dx) / 2),
        radiusY: round(Math.abs(dy) / 2),
      }
    case 'line':
      return { ...shape, points: [shape.points[0], shape.points[1], round(p.x), round(p.y)] }
    case 'text':
      return shape
  }
}

/** True for shapes not worth keeping, e.g. a rectangle from a click without a drag. */
export function isDegenerate(shape: Shape): boolean {
  switch (shape.type) {
    case 'pen':
      return false
    case 'rect':
      return shape.width < MIN_SIZE && shape.height < MIN_SIZE
    case 'ellipse':
      return shape.radiusX * 2 < MIN_SIZE && shape.radiusY * 2 < MIN_SIZE
    case 'line': {
      const [x1, y1, x2, y2] = shape.points
      return Math.hypot(x2 - x1, y2 - y1) < MIN_SIZE
    }
    case 'text':
      return shape.text.trim() === ''
  }
}

export function createText(p: Point, text: string, style: ShapeStyle, id: string): TextShape {
  return {
    id,
    type: 'text',
    x: round(p.x),
    y: round(p.y),
    text,
    fontSize: textFontSize(style.strokeWidth),
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
  }
}

export function moveShapeTo(shape: Shape, x: number, y: number): Shape {
  return { ...shape, x: round(x), y: round(y) }
}

/** Recolors / re-thickens a shape; text also resizes with the thickness. */
export function restyleShape(shape: Shape, style: Partial<ShapeStyle>): Shape {
  const next = { ...shape, ...style }
  if (next.type === 'text' && style.strokeWidth !== undefined) next.fontSize = textFontSize(style.strokeWidth)
  return next
}

export function toContent(shapes: Shape[]): CanvasContent {
  return { schemaVersion: SCHEMA_VERSION, shapes }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function isShape(v: unknown): v is Shape {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  if (!isStr(s.id) || !isNum(s.x) || !isNum(s.y) || !isStr(s.stroke) || !isNum(s.strokeWidth)) return false
  switch (s.type) {
    case 'pen':
      return Array.isArray(s.points) && s.points.length >= 2 && s.points.every(isNum)
    case 'line':
      return Array.isArray(s.points) && s.points.length === 4 && s.points.every(isNum)
    case 'rect':
      return isNum(s.width) && isNum(s.height)
    case 'ellipse':
      return isNum(s.radiusX) && isNum(s.radiusY)
    case 'text':
      return isStr(s.text) && isNum(s.fontSize)
    default:
      return false
  }
}

/** Reads stored content defensively: anything that isn't a valid shape is dropped. */
export function parseCanvasContent(raw: unknown): Shape[] {
  if (typeof raw !== 'object' || raw === null) return []
  const shapes = (raw as { shapes?: unknown }).shapes
  return Array.isArray(shapes) ? shapes.filter(isShape) : []
}

/**
 * The box a shape covers in board coordinates, including half its stroke. Text is estimated from
 * the font size (no measuring in plain code); good enough for "fit to content".
 */
export function shapeBounds(shape: Shape): Bounds {
  const pad = shape.strokeWidth / 2
  let minX: number, minY: number, maxX: number, maxY: number
  switch (shape.type) {
    case 'pen':
    case 'line': {
      const xs = shape.points.filter((_, i) => i % 2 === 0)
      const ys = shape.points.filter((_, i) => i % 2 === 1)
      minX = shape.x + Math.min(...xs)
      maxX = shape.x + Math.max(...xs)
      minY = shape.y + Math.min(...ys)
      maxY = shape.y + Math.max(...ys)
      break
    }
    case 'rect':
      minX = Math.min(shape.x, shape.x + shape.width)
      maxX = Math.max(shape.x, shape.x + shape.width)
      minY = Math.min(shape.y, shape.y + shape.height)
      maxY = Math.max(shape.y, shape.y + shape.height)
      break
    case 'ellipse':
      minX = shape.x - shape.radiusX
      maxX = shape.x + shape.radiusX
      minY = shape.y - shape.radiusY
      maxY = shape.y + shape.radiusY
      break
    case 'text': {
      const lines = shape.text.split('\n')
      const longest = Math.max(...lines.map((line) => line.length))
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + longest * shape.fontSize * 0.6,
        maxY: shape.y + lines.length * shape.fontSize,
      }
    }
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

/** The box around all shapes, or null for an empty board. */
export function contentBounds(shapes: Shape[]): Bounds | null {
  if (shapes.length === 0) return null
  return shapes.map(shapeBounds).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }))
}
