import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { BrowserTabState } from '@shared/browser'

interface TabStripProps {
  tabs: BrowserTabState[]
  activeTabId: string
  onCreate: () => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

export function TabStrip({ tabs, activeTabId, onCreate, onActivate, onClose }: TabStripProps) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onActivate(tabs[next].id)
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div className="tab-strip">
      <div className="tab-list" role="tablist" aria-label="Browser tabs" ref={list}>
        {tabs.map((tab, index) => (
          <div className={`browser-tab${tab.id === activeTabId ? ' is-active' : ''}`} key={tab.id} role="presentation">
            <button
              className="tab-select"
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              tabIndex={tab.id === activeTabId ? 0 : -1}
              title={tab.title}
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              <span className={`tab-indicator${tab.isLoading ? ' is-loading' : ''}`} aria-hidden="true">{tab.isLoading ? '' : '○'}</span>
              <span className="tab-title">{tab.title}</span>
            </button>
            <button className="tab-close" type="button" aria-label={`Close ${tab.title}`} title="Close tab" onClick={() => onClose(tab.id)}>×</button>
          </div>
        ))}
      </div>
      <button className="icon-button new-tab-button" type="button" aria-label="New tab" title="New tab" onClick={onCreate}>+</button>
    </div>
  )
}
