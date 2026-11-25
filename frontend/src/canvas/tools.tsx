import type { ReactNode } from 'react'
import type { Tool } from './types'

/** Tool order in the panel, with the keyboard shortcut for each. */
export const TOOLS: { tool: Tool; key: string; icon: ReactNode }[] = [
  { tool: 'select', key: 'V', icon: <path d="M5 3l14 8-6 1.5L10 19z" /> },
  { tool: 'pen', key: 'P', icon: <path d="M4 20c4-1 5-6 8-9s5-5 8-7M4 20l3-.5" /> },
  { tool: 'rect', key: 'R', icon: <rect x="4" y="6" width="16" height="12" rx="1" /> },
  { tool: 'ellipse', key: 'O', icon: <circle cx="12" cy="12" r="8" /> },
  { tool: 'line', key: 'L', icon: <path d="M5 19L19 5" /> },
  { tool: 'text', key: 'T', icon: <path d="M5 6V4h14v2M12 4v16M9 20h6" /> },
  {
    tool: 'eraser',
    key: 'E',
    icon: <path d="M8 20h12M4.5 15.5l9-9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 18H7z" />,
  },
]
