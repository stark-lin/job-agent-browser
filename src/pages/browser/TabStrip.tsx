import { Plus } from 'lucide-react'
import { Button, Icon, IconButton } from '@astryxdesign/core'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { BrowserTabState } from '../../shared/browser'

interface TabStripProps {
  tabs: BrowserTabState[]
  activeTabId: string
  onCreate: () => void
  onActivate: (id: string) => void
  onClose: (id: string) => void
}

export function TabStrip({ tabs, activeTabId, onCreate, onActivate, onClose }: TabStripProps) {
  const { t } = useTranslation()
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
      <div className="tab-list" role="tablist" aria-label={t($ => $.browser.tabs)} ref={list}>
        {tabs.map((tab, index) => (
          <div className={`browser-tab${tab.id === activeTabId ? ' is-active' : ''}`} key={tab.id} role="presentation">
            <Button
              variant="ghost"
              className="tab-select"
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              tabIndex={tab.id === activeTabId ? 0 : -1}
              label={tab.browserTitle} size="sm"
              onClick={() => onActivate(tab.id)}
              onKeyDown={(event) => moveFocus(event, index)}
            >
              <span className={`tab-indicator${tab.isLoading ? ' is-loading' : ''}`} aria-hidden="true">{tab.isLoading ? '' : '○'}</span>
              <span className="tab-title">{tab.browserTitle}</span>
            </Button>
            <IconButton variant="ghost" size="sm" className="tab-close" label={t($ => $.browser.closeNamedTab, { title: tab.browserTitle })} tooltip={t($ => $.browser.closeTab)} icon={<Icon icon="close" />} onClick={() => onClose(tab.id)} />
          </div>
        ))}
      </div>
      <IconButton className="icon-button new-tab-button" size="sm" variant="ghost" label={t($ => $.browser.newTab)} tooltip={t($ => $.browser.newTab)} icon={<Icon icon={Plus} />} onClick={onCreate} />
    </div>
  )
}
