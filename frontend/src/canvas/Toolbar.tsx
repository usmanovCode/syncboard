import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TOOLS } from './tools'
import { COLORS, WIDTHS, type ShapeStyle, type Tool } from './types'

type Props = {
  tool: Tool
  style: ShapeStyle
  canUndo: boolean
  canRedo: boolean
  onTool: (tool: Tool) => void
  onStyle: (style: Partial<ShapeStyle>) => void
  onUndo: () => void
  onRedo: () => void
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const buttonClass = (active: boolean) =>
  `flex h-10 w-10 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${
    active ? 'bg-indigo-600 text-white' : 'text-slate-700 hover:bg-slate-100'
  }`

export function Toolbar({ tool, style, canUndo, canRedo, onTool, onStyle, onUndo, onRedo }: Props) {
  const { t } = useTranslation()
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'

  return (
    <aside
      aria-label={t('board.toolbar')}
      className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-slate-200 bg-white py-3"
    >
      {TOOLS.map(({ tool: item, key, icon }) => {
        const label = t('board.withShortcut', { label: t(`board.tools.${item}`), key })
        return (
          <button
            key={item}
            aria-label={label}
            title={label}
            aria-pressed={tool === item}
            onClick={() => onTool(item)}
            className={buttonClass(tool === item)}
          >
            <Icon>{icon}</Icon>
          </button>
        )
      })}

      <hr className="my-2 w-8 border-slate-200" />

      <div role="group" aria-label={t('board.color')} className="grid grid-cols-2 gap-1">
        {COLORS.map(({ key, value }) => (
          <button
            key={key}
            aria-label={t(`board.colors.${key}`)}
            title={t(`board.colors.${key}`)}
            aria-pressed={style.stroke === value}
            onClick={() => onStyle({ stroke: value })}
            className={`h-5 w-5 rounded-full ring-offset-1 transition ${
              style.stroke === value ? 'ring-2 ring-indigo-500' : 'hover:scale-110'
            }`}
            style={{ backgroundColor: value }}
          />
        ))}
      </div>

      <hr className="my-2 w-8 border-slate-200" />

      <div role="group" aria-label={t('board.width')} className="flex flex-col gap-1">
        {WIDTHS.map(({ key, value }) => (
          <button
            key={key}
            aria-label={t(`board.widths.${key}`)}
            title={t(`board.widths.${key}`)}
            aria-pressed={style.strokeWidth === value}
            onClick={() => onStyle({ strokeWidth: value })}
            className={buttonClass(style.strokeWidth === value)}
          >
            <span className="w-6 rounded-full bg-current" style={{ height: value }} />
          </button>
        ))}
      </div>

      <hr className="my-2 w-8 border-slate-200" />

      <button
        aria-label={t('board.withShortcut', { label: t('board.undo'), key: `${mod}Z` })}
        title={t('board.withShortcut', { label: t('board.undo'), key: `${mod}Z` })}
        disabled={!canUndo}
        onClick={onUndo}
        className={buttonClass(false)}
      >
        <Icon>
          <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
        </Icon>
      </button>
      <button
        aria-label={t('board.withShortcut', { label: t('board.redo'), key: `${mod}Shift+Z` })}
        title={t('board.withShortcut', { label: t('board.redo'), key: `${mod}Shift+Z` })}
        disabled={!canRedo}
        onClick={onRedo}
        className={buttonClass(false)}
      >
        <Icon>
          <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />
        </Icon>
      </button>
    </aside>
  )
}
