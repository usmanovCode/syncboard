import type { LiveCursor } from '../realtime/useBoardRoom'
import { toScreen, type Viewport } from './viewport'

/**
 * Other people's pointers, drawn over the canvas in plain HTML (cheaper than redrawing the Konva
 * layer on every move). Purely visual: no pointer events, hidden from assistive technology (the
 * online list in the header says who is here). Cursors arrive in board coordinates and are placed
 * through this viewer's viewport; the arrow and name keep their size at any zoom.
 */
export function CursorLayer({ cursors, viewport }: { cursors: LiveCursor[]; viewport: Viewport }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {cursors.map((cursor) => {
        const at = toScreen(viewport, cursor)
        return (
          <div
            key={cursor.cursorId}
            data-testid="cursor"
            className="absolute top-0 left-0 transition-transform duration-75 ease-linear"
            style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-sm">
              <path
                d="M1 1l6.5 15 2-6.5 6.5-2z"
                fill={cursor.color}
                stroke="white"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="absolute top-4 left-3 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow-sm"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.name}
            </span>
          </div>
        )
      })}
    </div>
  )
}
