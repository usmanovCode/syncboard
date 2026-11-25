/**
 * The board drawing document, stored by the backend as opaque JSON (board_canvases.content).
 * Bump SCHEMA_VERSION and add a migration in parseCanvasContent when the shape format changes.
 */
export const SCHEMA_VERSION = 1

export type CanvasContent = { schemaVersion: typeof SCHEMA_VERSION; shapes: Shape[] }

export type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'line' | 'text' | 'eraser'
/** Tools that create a shape by dragging. */
export type DrawTool = 'pen' | 'rect' | 'ellipse' | 'line'

export type Point = { x: number; y: number }

/** Every shape has a position, so moving any shape just changes x/y. */
type Base = { id: string; x: number; y: number; stroke: string; strokeWidth: number }

/** Freehand stroke; points are flat [x1, y1, x2, y2, …] relative to x/y. */
export type PenShape = Base & { type: 'pen'; points: number[] }
export type RectShape = Base & { type: 'rect'; width: number; height: number }
/** x/y is the center. */
export type EllipseShape = Base & { type: 'ellipse'; radiusX: number; radiusY: number }
export type LineShape = Base & { type: 'line'; points: [number, number, number, number] }
/** Drawn in the stroke color; fontSize follows the chosen thickness. */
export type TextShape = Base & { type: 'text'; text: string; fontSize: number }

export type Shape = PenShape | RectShape | EllipseShape | LineShape | TextShape

export type ShapeStyle = { stroke: string; strokeWidth: number }

export const COLORS = [
  { key: 'black', value: '#1e293b' },
  { key: 'red', value: '#ef4444' },
  { key: 'orange', value: '#f97316' },
  { key: 'yellow', value: '#eab308' },
  { key: 'green', value: '#22c55e' },
  { key: 'blue', value: '#3b82f6' },
  { key: 'purple', value: '#8b5cf6' },
  { key: 'pink', value: '#ec4899' },
] as const

export const WIDTHS = [
  { key: 'thin', value: 2 },
  { key: 'medium', value: 4 },
  { key: 'thick', value: 8 },
] as const

export const DEFAULT_STYLE: ShapeStyle = { stroke: COLORS[0].value, strokeWidth: WIDTHS[1].value }
