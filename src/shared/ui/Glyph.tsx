import { Icon } from './Icon'
import type { ReactNode } from 'react'

export type GlyphName = 'home' | 'plus' | 'search' | 'document' | 'presentation' | 'list' | 'mail' | 'person' | 'globe' | 'sparkles' | 'settings'

const glyphs = {
  plus: <path d="M12 5v14M5 12h14" />,
  home: <><path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3z" /></>,
  search: <><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></>,
  document: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></>,
  presentation: <><path d="M4 18v-7a3 3 0 013-3h10a3 3 0 013 3v7"/><circle cx="12" cy="5" r="2"/><path d="M8 18h8"/></>,
  list: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/></>,
  person: <><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0114 0"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/></>,
  sparkles: <><path d="M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21h-4v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 00.3-1.9A1.7 1.7 0 003 14H3v-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 001.9.3A1.7 1.7 0 0010 3V3h4v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1H21v4h-.1a1.7 1.7 0 00-1.5 1z"/></>,
} satisfies Record<GlyphName, ReactNode>

export function Glyph({ name }: { name: GlyphName }) { return <Icon>{glyphs[name]}</Icon> }
