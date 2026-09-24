import { session, shell, WebContentsView, type BrowserWindow } from 'electron'
import {
  BROWSER_STATE_CHANGED,
  TOOLBAR_HEIGHT,
  type BrowserState
} from '../../shared/browser'
import { NavigationController } from './NavigationController'

const SESSION_PARTITION = 'persist:job-agent-browser'

export class BrowserManager {
  readonly view: WebContentsView
  private readonly navigation: NavigationController
  private isLoading = false

  constructor(private readonly window: BrowserWindow) {
    const persistentSession = session.fromPartition(SESSION_PARTITION)
    persistentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))

    this.view = new WebContentsView({
      webPreferences: {
        session: persistentSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true
      }
    })
    this.navigation = new NavigationController(this.view.webContents)
    this.window.contentView.addChildView(this.view)

    this.view.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebURL(url)) {
        void shell.openExternal(url)
      }
      return { action: 'deny' }
    })

    this.view.webContents.on('will-navigate', (event, url) => {
      if (!isWebURL(url)) event.preventDefault()
    })
    this.view.webContents.on('did-start-loading', () => {
      this.isLoading = true
      this.publishState()
    })
    this.view.webContents.on('did-stop-loading', () => {
      this.isLoading = false
      this.publishState()
    })
    this.view.webContents.on('did-navigate', () => this.publishState())
    this.view.webContents.on('did-navigate-in-page', () => this.publishState())
    this.view.webContents.on('did-fail-load', (_event, code) => {
      if (code !== -3) {
        this.isLoading = false
        this.publishState()
      }
    })

    this.layout()
    this.window.on('resize', () => this.layout())
    this.window.on('closed', () => this.view.webContents.close())
  }

  layout(): void {
    const { width, height } = this.window.getContentBounds()
    this.view.setBounds({
      x: 0,
      y: TOOLBAR_HEIGHT,
      width,
      height: Math.max(0, height - TOOLBAR_HEIGHT)
    })
  }

  async navigate(input: string): Promise<void> {
    await this.navigation.navigate(input)
  }

  back(): void {
    this.navigation.back()
  }

  forward(): void {
    this.navigation.forward()
  }

  getState(): BrowserState {
    const contents = this.view.webContents
    const history = contents.navigationHistory
    return {
      url: contents.getURL(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      isLoading: this.isLoading
    }
  }

  private publishState(): void {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(BROWSER_STATE_CHANGED, this.getState())
    }
  }
}

function isWebURL(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
