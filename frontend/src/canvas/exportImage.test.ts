import { describe, expect, it } from 'vitest'
import {
  EXPORT_PIXEL_RATIO,
  MAX_EXPORT_AREA,
  MAX_EXPORT_SIDE,
  exportFileName,
  exportPixelRatio,
  exportRegion,
} from './exportImage'

describe('exportRegion', () => {
  it('adds the padding around the drawing', () => {
    expect(exportRegion({ minX: 10, minY: 20, maxX: 110, maxY: 70 }, 32)).toEqual({
      x: -22,
      y: -12,
      width: 164,
      height: 114,
    })
  })

  it('rounds outwards to whole board units', () => {
    expect(exportRegion({ minX: 0.5, minY: 0.5, maxX: 9.2, maxY: 9.8 }, 0)).toEqual({ x: 0, y: 0, width: 10, height: 10 })
  })
})

describe('exportPixelRatio', () => {
  it('uses the default ratio for normal drawings', () => {
    expect(exportPixelRatio({ width: 1000, height: 800 })).toBe(EXPORT_PIXEL_RATIO)
  })

  it('keeps the longest side within the canvas limit', () => {
    const ratio = exportPixelRatio({ width: 10_000, height: 100 })
    expect(10_000 * ratio).toBeLessThanOrEqual(MAX_EXPORT_SIDE)
  })

  it('keeps the area within the canvas limit', () => {
    const ratio = exportPixelRatio({ width: 4000, height: 4000 })
    expect(4000 * ratio * 4000 * ratio).toBeLessThanOrEqual(MAX_EXPORT_AREA + 1)
    expect(ratio).toBeLessThan(EXPORT_PIXEL_RATIO)
  })
})

describe('exportFileName', () => {
  const date = new Date(2026, 10, 26)

  it('uses the board name and the local date', () => {
    expect(exportFileName('Dizayn eskizlari', date)).toBe('Dizayn eskizlari-2026-11-26.png')
  })

  it('keeps non-Latin names', () => {
    expect(exportFileName('디자인 스케치', date)).toBe('디자인 스케치-2026-11-26.png')
  })

  it('replaces characters that are not allowed in file names', () => {
    expect(exportFileName('Q1/Q2: plan? <draft>', date)).toBe('Q1 Q2 plan draft-2026-11-26.png')
  })

  it('falls back to "board" when nothing usable is left', () => {
    expect(exportFileName(' ... ', date)).toBe('board-2026-11-26.png')
    expect(exportFileName('', date)).toBe('board-2026-11-26.png')
  })
})
