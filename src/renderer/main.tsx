import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '../app/App'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import { BROWSER_CHROME_HEIGHT, TAB_STRIP_HEIGHT, TOOLBAR_HEIGHT, SIDEBAR_WIDTH } from '../shared/geometry'
import './styles/global.css'

const geometry = document.documentElement.style
geometry.setProperty('--sidebar-width', `${SIDEBAR_WIDTH}px`)
geometry.setProperty('--tab-strip-height', `${TAB_STRIP_HEIGHT}px`)
geometry.setProperty('--toolbar-height', `${TOOLBAR_HEIGHT}px`)
geometry.setProperty('--browser-chrome-height', `${BROWSER_CHROME_HEIGHT}px`)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
