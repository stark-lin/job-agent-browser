import { useState } from 'react'
import { ExplorerRow } from '../../shared/ui'
import type { KnowledgeNode } from '../../domain/knowledge'
export function KnowledgeTree({
  tree,
  selected,
  memory = false,
  label,
  onSelect,
  onAction
}: {
  tree: KnowledgeNode
  memory?: boolean
  label: string
  selected: string
  onSelect: (node: KnowledgeNode) => Promise<boolean>
  onAction: (kind: 'rename' | 'delete' | 'menu', node: KnowledgeNode) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(memory ? [] : ['']))
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
          name={node.path ? node.name : label}
          specialRoot={memory && !node.path}
          depth={depth}
          selected={selected === node.path}
          directory={node.type === 'directory'}
          expanded={isOpen}
          onToggle={() => { void onSelect(node).then(okay => { if (okay) expand(!isOpen) }) }}
          onClick={() => {
            void onSelect(node).then(okay => { if (okay && node.type === 'directory') expand(memory && !node.path ? !isOpen : true) })
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
              void onSelect(node).then(okay => { if (okay) expand(!isOpen) })
            }
          }}
        />
        {isOpen && node.children && <div role="group">{node.children.map((child) => render(child, depth + 1))}</div>}
      </div>
    )
  }
  return (
    <div role="tree" aria-label={label}>
      {render(tree, 0)}
    </div>
  )
}
