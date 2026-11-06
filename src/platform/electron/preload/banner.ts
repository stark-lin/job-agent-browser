import { ipcRenderer } from 'electron'
import { BANNER_INTERACTION, BANNER_STATE, type BannerEvent } from '../../../shared/banner'
import type { ResolvedTheme } from '../../../shared/settings'

window.addEventListener('DOMContentLoaded', () => {
  const body = document.querySelector<HTMLButtonElement>('.ui-banner-body')!
  const close = document.querySelector<HTMLButtonElement>('.ui-banner-close')!
  let current: BannerEvent | null = null
  ipcRenderer.on(BANNER_STATE, (_event, state: { event: BannerEvent | null; theme: ResolvedTheme; closeLabel: string }) => {
    current = state.event
    document.documentElement.dataset.theme = state.theme
    body.querySelector('.ui-banner-title')!.textContent = current?.title ?? ''
    body.querySelector('.ui-banner-detail')!.textContent = current?.detail ?? ''
    body.setAttribute('aria-disabled', String(!current?.action))
    body.tabIndex = current?.action ? 0 : -1
    close.setAttribute('aria-label', state.closeLabel)
  })
  body.addEventListener('click', event => {
    if (event.isTrusted && current?.action) ipcRenderer.send(BANNER_INTERACTION, 'open', current.timeUs)
  })
  close.addEventListener('click', event => {
    if (event.isTrusted && current) ipcRenderer.send(BANNER_INTERACTION, 'dismiss', current.timeUs)
  })
}, { once: true })
