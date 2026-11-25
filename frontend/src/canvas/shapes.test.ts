import { describe, expect, it } from 'vitest'
import {
  createText,
  dragShape,
  isDegenerate,
  moveShapeTo,
  parseCanvasContent,
  restyleShape,
  startShape,
  toContent,
} from './shapes'
import type { Shape } from './types'

const style = { stroke: '#ef4444', strokeWidth: 4 }

function drag(tool: 'pen' | 'rect' | 'ellipse' | 'line', from: [number, number], to: [number, number], shift = false) {
  const start = { x: from[0], y: from[1] }
  return dragShape(startShape(tool, start, style, 'id'), start, { x: to[0], y: to[1] }, shift)
}

describe('drawing shapes', () => {
  it('normalizes rectangles dragged in any direction', () => {
    expect(drag('rect', [50, 60], [10, 20])).toMatchObject({ x: 10, y: 20, width: 40, height: 40 })
    expect(drag('rect', [10, 20], [70, 30])).toMatchObject({ x: 10, y: 20, width: 60, height: 10 })
  })

  it('makes squares and circles with Shift', () => {
    expect(drag('rect', [10, 10], [70, 30], true)).toMatchObject({ x: 10, y: 10, width: 60, height: 60 })
    expect(drag('rect', [70, 70], [10, 50], true)).toMatchObject({ x: 10, y: 10, width: 60, height: 60 })
    expect(drag('ellipse', [0, 0], [40, 10], true)).toMatchObject({ x: 20, y: 20, radiusX: 20, radiusY: 20 })
  })

  it('uses the drag as the ellipse bounding box', () => {
    expect(drag('ellipse', [10, 10], [50, 30])).toMatchObject({ x: 30, y: 20, radiusX: 20, radiusY: 10 })
  })

  it('appends rounded points to pen strokes', () => {
    const start = { x: 1.234, y: 2 }
    let pen = startShape('pen', start, style, 'id')
    pen = dragShape(pen, start, { x: 5.67, y: 8.91 }, false)
    expect(pen).toMatchObject({ type: 'pen', x: 0, y: 0, points: [1.2, 2, 1.2, 2, 5.7, 8.9] })
  })

  it('keeps a line from the start point to the pointer', () => {
    expect(drag('line', [0, 0], [30, 40])).toMatchObject({ points: [0, 0, 30, 40] })
  })

  it('discards clicks without a real drag', () => {
    expect(isDegenerate(drag('rect', [5, 5], [5.5, 6]))).toBe(true)
    expect(isDegenerate(drag('ellipse', [5, 5], [6, 5]))).toBe(true)
    expect(isDegenerate(drag('line', [5, 5], [6, 5]))).toBe(true)
    expect(isDegenerate(drag('rect', [5, 5], [5, 40]))).toBe(false)
    // A pen click is a dot, which is kept.
    expect(isDegenerate(startShape('pen', { x: 1, y: 1 }, style, 'id'))).toBe(false)
    expect(isDegenerate(createText({ x: 0, y: 0 }, '   ', style, 'id'))).toBe(true)
  })
})

describe('editing shapes', () => {
  it('moves any shape by its position', () => {
    const pen = drag('pen', [0, 0], [10, 10])
    expect(moveShapeTo(pen, 25.04, -3)).toMatchObject({ x: 25, y: -3, points: pen.type === 'pen' ? pen.points : [] })
  })

  it('restyles shapes and resizes text with the thickness', () => {
    const text = createText({ x: 0, y: 0 }, 'Salom', style, 'id')
    expect(text.fontSize).toBe(24)
    expect(restyleShape(text, { strokeWidth: 8 })).toMatchObject({ strokeWidth: 8, fontSize: 36 })
    expect(restyleShape(text, { stroke: '#000000' })).toMatchObject({ stroke: '#000000', fontSize: 24 })
  })
})

describe('parseCanvasContent', () => {
  it('round-trips valid content', () => {
    const shapes: Shape[] = [drag('rect', [0, 0], [10, 10]), createText({ x: 1, y: 2 }, 'Hi', style, 't')]
    expect(parseCanvasContent(JSON.parse(JSON.stringify(toContent(shapes))))).toEqual(shapes)
  })

  it('drops invalid or unknown shapes instead of failing', () => {
    const valid = drag('line', [0, 0], [10, 10])
    const raw = {
      schemaVersion: 1,
      shapes: [valid, { ...valid, id: 'bad', points: [1, 2] }, { type: 'star', id: 'x' }, null, 'nope'],
    }
    expect(parseCanvasContent(raw)).toEqual([valid])
    expect(parseCanvasContent(null)).toEqual([])
    expect(parseCanvasContent({ shapes: 'nope' })).toEqual([])
  })
})
