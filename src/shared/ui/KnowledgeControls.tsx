import { useRef, type ReactNode, type KeyboardEventHandler, type MouseEventHandler } from 'react'
import { Button } from './Button'
export function ExplorerRow({
  name,
  depth,
  selected,
  expanded,
  directory,
  onClick,
  onToggle,
  onContextMenu,
  onKeyDown
}: {
  name: string
  depth: number
  selected: boolean
  expanded?: boolean
  directory: boolean
  onClick: () => void
  onToggle: () => void
  onContextMenu: MouseEventHandler
  onKeyDown: KeyboardEventHandler
}) {
  return (
    <div
      className="ui-explorer-row"
      role="treeitem"
      tabIndex={0}
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={directory ? expanded : undefined}
      style={{ paddingLeft: `calc(var(--space-1) * ${depth + 1})` }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      {directory ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label={name}
          aria-expanded={expanded}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          {expanded ? '▾' : '▸'}
        </Button>
      ) : (
        <span aria-hidden="true">·</span>
      )}
      <span>{name}</span>
    </div>
  )
}
export function ResizableExplorer({
  width,
  onWidth,
  label,
  children
}: {
  width: number
  onWidth: (value: number) => void
  label: string
  children: ReactNode
}) {
  const start = useRef<{ x: number; width: number } | null>(null)
  return (
    <>
      <aside className="ui-explorer" style={{ width }}>
        {children}
      </aside>
      <div
        className="ui-resizer"
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={192}
        aria-valuemax={480}
        tabIndex={0}
        onPointerDown={(e) => {
          start.current = { x: e.clientX, width }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (start.current)
            onWidth(
              Math.max(192, Math.min(480, Math.round((start.current.width + e.clientX - start.current.x) / 8) * 8))
            )
        }}
        onPointerUp={() => {
          start.current = null
        }}
        onPointerCancel={() => {
          start.current = null
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            onWidth(Math.max(192, Math.min(480, width + (e.key === 'ArrowLeft' ? -8 : 8))))
          }
        }}
      />
    </>
  )
}
