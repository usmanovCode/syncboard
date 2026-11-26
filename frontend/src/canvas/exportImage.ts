import type { Bounds } from './viewport'

/**
 * Exporting the drawing as a PNG: the whole drawing (not just what is on screen), on a white
 * background, independent of the current pan and zoom. Konva renders the pixels (CanvasStage); the
 * sizes and names are worked out here.
 */

/** Board units left around the drawing in the exported image. */
export const EXPORT_PADDING = 32
/** Device pixels per board unit, for a sharp image on high-DPI screens. */
export const EXPORT_PIXEL_RATIO = 2
/** Longest image side browsers reliably allow for a canvas. */
export const MAX_EXPORT_SIDE = 8192
/** Largest canvas area Safari allows (16.7 megapixels). */
export const MAX_EXPORT_AREA = 16_777_216
export const EXPORT_BACKGROUND = '#ffffff'

/** A rectangle on the board (board coordinates). */
export type Region = { x: number; y: number; width: number; height: number }

/** The part of the board to export: the drawing plus padding, on whole board units. */
export function exportRegion(bounds: Bounds, padding = EXPORT_PADDING): Region {
  const x = Math.floor(bounds.minX - padding)
  const y = Math.floor(bounds.minY - padding)
  return {
    x,
    y,
    width: Math.ceil(bounds.maxX + padding) - x,
    height: Math.ceil(bounds.maxY + padding) - y,
  }
}

/** Device pixels per board unit: EXPORT_PIXEL_RATIO, scaled down so a huge drawing still fits a canvas. */
export function exportPixelRatio({ width, height }: Pick<Region, 'width' | 'height'>): number {
  return Math.min(
    EXPORT_PIXEL_RATIO,
    MAX_EXPORT_SIDE / width,
    MAX_EXPORT_SIDE / height,
    Math.sqrt(MAX_EXPORT_AREA / (width * height)),
  )
}

/** Characters not allowed in file names on Windows/macOS/Linux, plus control characters. */
// oxlint-disable-next-line no-control-regex
const UNSAFE_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f]+/g

/** `<board name>-YYYY-MM-DD.png` (local date), safe as a file name on every OS. */
export function exportFileName(boardName: string, date: Date): string {
  const name =
    boardName
      .replace(UNSAFE_FILE_CHARS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 100)
      .trim() || 'board'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${name}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.png`
}

/** `source` drawn over a solid background, as a PNG. Konva's export is transparent where nothing is drawn. */
export function toPngBlob(source: HTMLCanvasElement, background = EXPORT_BACKGROUND): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('Canvas 2D context unavailable'))
  context.fillStyle = background
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
  )
}

/** Hands `blob` to the browser as a download named `fileName`. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked later: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
