import { useTranslation } from 'react-i18next'

/** Bottom-right corner of the canvas: the zoom level (click: back to 100%) and "fit to content". */
export function ZoomControls({ scale, onReset, onFit }: { scale: number; onReset: () => void; onFit: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="group"
      aria-label={t('board.zoom.controls')}
      className="shadow-soft absolute right-4 bottom-4 flex items-center gap-0.5 rounded-full border border-slate-200/70 bg-white/90 p-1.5 text-sm text-slate-700 backdrop-blur"
    >
      <button
        onClick={onReset}
        title={t('board.zoom.reset')}
        aria-label={`${t('board.zoom.percent', { value: Math.round(scale * 100) })} · ${t('board.zoom.reset')}`}
        className="min-w-16 rounded-full px-3 py-2 font-semibold tabular-nums hover:bg-violet-50 hover:text-violet-700"
      >
        {t('board.zoom.percent', { value: Math.round(scale * 100) })}
      </button>
      <button onClick={onFit} className="rounded-full px-4 py-2 font-medium hover:bg-violet-50 hover:text-violet-700">
        {t('board.zoom.fit')}
      </button>
    </div>
  )
}
