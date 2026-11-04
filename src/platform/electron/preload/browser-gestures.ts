import { ipcRenderer } from 'electron'

// Isolated, sandboxed preload: expose no browser, Node or IPC API to websites.
let enabled = false, epoch = 0, mode: 'idle' | 'page' | 'history' = 'idle'
let timer: ReturnType<typeof setTimeout> | undefined
const reset = () => { if (timer) clearTimeout(timer); timer = undefined; mode = 'idle' }
ipcRenderer.on('browser:gesture-state', (_event, state: { enabled: boolean; epoch: number }) => {
  if (!state.enabled || state.epoch !== epoch) reset()
  enabled = state.enabled; epoch = state.epoch
})

function pageOwnsScroll(event: WheelEvent): boolean {
  for (const node of event.composedPath()) {
    if (!(node instanceof Element)) continue
    const style = getComputedStyle(node)
    if (style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none') return true
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLElement && node.isContentEditable) return true
    if ((node === document.scrollingElement || /(auto|scroll|overlay)/.test(style.overflowX)) && node.scrollWidth > node.clientWidth + 1) {
      // Permit navigation only when the scroller is already at its outward edge.
      const left = style.direction === 'rtl' ? -node.scrollLeft : node.scrollLeft
      const delta = style.direction === 'rtl' ? -event.deltaX : event.deltaX
      if (delta < 0 ? left > 1 : left < node.scrollWidth - node.clientWidth - 1) return true
    }
  }
  return false
}

window.addEventListener('wheel', event => {
  if (!enabled || !event.isTrusted || !event.cancelable || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return
  if (!event.deltaX && !event.deltaY) return
  if (mode === 'idle') mode = Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.5 && !pageOwnsScroll(event) ? 'history' : 'page'
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    if (mode === 'history') ipcRenderer.send('browser:gesture-wheel', { epoch, end: true })
    reset()
  }, 120)
  if (mode !== 'history') return
  event.preventDefault()
  ipcRenderer.send('browser:gesture-wheel', { epoch, delta: -event.deltaX })
}, { passive: false, capture: true })
window.addEventListener('pagehide', reset)
