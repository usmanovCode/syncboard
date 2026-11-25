import type { LiveCursor } from '../realtime/useBoardRoom'

/**
 * Other people's pointers, drawn over the canvas in plain HTML (cheaper than redrawing the Konva
 * layer on every move). Purely visual: no pointer events, hidden from assistive technology (the
 * online list in the header says who is here).
 */
export function CursorLayer({ cursors }: { cursors: LiveCursor[] }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {cursors.map((cursor) => (
        <div
          key={cursor.cursorId}
          data-testid="cursor"
          className="absolute top-0 left-0 transition-transform duration-75 ease-linear"
          style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-sm">
            <path d="M1 1l6.5 15 2-6.5 6.5-2z" fill={cursor.color} stroke="white" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          <span
            className="absolute top-4 left-3 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-white shadow-sm"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.name}
          </span>
        </div>
      ))}
    </div>
  )
}
