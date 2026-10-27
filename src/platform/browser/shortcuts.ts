import type { WebContents } from 'electron'

interface Shortcuts {
  back(): void
  forward(): void
  createTab(): void
  closeActive(): void
  cycle(direction: -1 | 1): void
  focusAddress(): void
}

export function installShortcuts(contents: WebContents, actions: Shortcuts, platform: NodeJS.Platform = process.platform): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    const command = platform === 'darwin' ? input.meta : input.control
    let action: (() => void) | undefined
    if (input.control && !input.alt && key === 'tab') {
      action = () => actions.cycle(input.shift ? -1 : 1)
    } else if (input.alt && !command && !input.shift) {
      if (key === 'arrowleft') action = () => actions.back()
      if (key === 'arrowright') action = () => actions.forward()
    } else if (command && !input.alt && !input.shift) {
      if (key === 't') action = () => actions.createTab()
      if (key === 'w') action = () => actions.closeActive()
      if (key === 'l') action = () => actions.focusAddress()
    }
    if (action) { event.preventDefault(); action() }
  })
}
