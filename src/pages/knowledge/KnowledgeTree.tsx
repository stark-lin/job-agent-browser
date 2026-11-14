import { useState } from 'react'
import { Icon, IconButton } from '@astryxdesign/core'
import { Brain } from 'lucide-react'
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
        <div className="knowledge-tree-row" role="treeitem" tabIndex={0}
          aria-level={depth + 1} aria-selected={selected === node.path} aria-expanded={node.type === 'directory' ? isOpen : undefined}
          style={{ paddingInlineStart: `${(depth + 1) * 8}px` }}
          onClick={() => {
            void onSelect(node).then(okay => { if (okay && node.type === 'directory') expand(memory && !node.path ? !isOpen : true) })
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onAction('menu', node)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.target === e.currentTarget) {
              e.preventDefault()
              e.currentTarget.click()
            }
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
                i = rows.indexOf(e.currentTarget)
              rows[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
            }
            if (e.key === ' ' && node.type === 'directory') {
              e.preventDefault()
              void onSelect(node).then(okay => { if (okay) expand(!isOpen) })
            }
          }}
        >
          {node.type === 'directory' ? <IconButton size="sm" variant="ghost" label={node.path ? node.name : label} aria-expanded={isOpen}
            icon={<Icon icon={isOpen ? 'chevronDown' : 'chevronRight'} />} onClick={event => {
              event.stopPropagation()
              void onSelect(node).then(okay => { if (okay) expand(!isOpen) })
            }} /> : <span aria-hidden="true">·</span>}
          {memory && !node.path && <Icon icon={Brain} size="sm" />}
          <span>{node.path ? node.name : label}</span>
        </div>
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
