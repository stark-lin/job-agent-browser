import { useState } from 'react'
import { HomePage } from '../pages/home/HomePage'
import { BrowserWorkspace } from './browser/BrowserWorkspace'

export function App() {
  const [page, setPage] = useState<'home' | 'browser'>('home')
  const [error, setError] = useState('')

  async function showPage(next: 'home' | 'browser'): Promise<void> {
    try {
      await window.browser.setVisible(next === 'browser')
      setError('')
      setPage(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to switch pages.')
    }
  }

  return (
    <>
      {page === 'home'
        ? <HomePage onOpenBrowser={() => void showPage('browser')} />
        : <BrowserWorkspace onHome={() => void showPage('home')} />}
      {error ? <div className="app-error" role="alert">{error}</div> : null}
    </>
  )
}
