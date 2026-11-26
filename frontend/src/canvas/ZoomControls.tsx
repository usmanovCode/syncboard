import { useTranslation } from 'react-i18next'

/** Bottom-right corner of the canvas: the zoom level (click: back to 100%) and "fit to content". */
export function ZoomControls({ scale, onReset, onFit }: { scale: number; onReset: () => void; onFit: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('board.zoom.controls')}
      className="absolute right-3 bottom-3 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 text-xs text-slate-700 shadow-sm"
    >
      <button
        onClick={onReset}
        title={t('board.zoom.reset')}
        aria-label={`${t('board.zoom.percent', { value: Math.round(scale * 100) })} · ${t('board.zoom.reset')}`}
        className="min-w-12 rounded px-2 py-1 font-medium tabular-nums hover:bg-slate-100"
      >
        {t('board.zoom.percent', { value: Math.round(scale * 100) })}
      </button>
      <button onClick={onFit} className="rounded px-2 py-1 hover:bg-slate-100">
        {t('board.zoom.fit')}
      </button>
    </div>
  )
}
