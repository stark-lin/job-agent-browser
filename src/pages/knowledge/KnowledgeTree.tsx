import { useState } from 'react'
import { ExplorerRow } from '../../shared/ui'
import type { KnowledgeNode } from '../../domain/knowledge'
export function KnowledgeTree({
  tree,
  selected,
  onSelect,
  onAction
}: {
  tree: KnowledgeNode
  selected: string
  onSelect: (node: KnowledgeNode) => void
  onAction: (kind: 'rename' | 'delete' | 'menu', node: KnowledgeNode) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const render = (node: KnowledgeNode, depth: number) => {
    const isOpen = expanded.has(node.path)
    const expand = (open: boolean) =>
      setExpanded((old) => {
        const next = new Set(old)
        if (open) next.add(node.path)
        else next.delete(node.path)
        return next
      })
    return (
      <div key={node.path}>
        <ExplorerRow
          name={node.name}
          depth={depth}
          selected={selected === node.path}
          directory={node.type === 'directory'}
          expanded={isOpen}
          onToggle={() => expand(!isOpen)}
          onClick={() => {
            if (node.type === 'directory') expand(true)
            onSelect(node)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onAction('menu', node)
          }}
          onKeyDown={(e) => {
            if (e.key === 'F2' || e.key === 'Delete') {
              e.preventDefault()
              if (node.path) onAction(e.key === 'F2' ? 'rename' : 'delete', node)
            }
            if (e.key === 'ArrowRight' && node.type === 'directory') {
              e.preventDefault()
              expand(true)
            }
            if (e.key === 'ArrowLeft' && node.type === 'directory') {
              e.preventDefault()
              expand(false)
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const rows = Array.from(
                  e.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []
                ),
                i = rows.indexOf(e.currentTarget as HTMLElement)
              rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
            }
            if (e.key === ' ' && node.type === 'directory') {
              e.preventDefault()
              expand(!isOpen)
            }
          }}
        />
        {isOpen && node.children && <div role="group">{node.children.map((child) => render(child, depth + 1))}</div>}
      </div>
    )
  }
  return (
    <div role="tree" aria-label="Knowledge">
      {render(tree, 0)}
    </div>
  )
}
