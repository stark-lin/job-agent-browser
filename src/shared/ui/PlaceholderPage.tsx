import type { ReactNode } from 'react'

export function PlaceholderPage({ title, description, canGoBack, onBack, onHome, children }: {
  title: string; description: string; canGoBack: boolean
  onBack: () => void; onHome: () => void; children?: ReactNode
}) {
  return (
    <main className="feature-page">
      <nav className="page-actions" aria-label="Page navigation">
        <button type="button" disabled={!canGoBack} onClick={onBack}>Back</button>
        <button type="button" onClick={onHome}>Home</button>
      </nav>
      <section className="feature-content" aria-labelledby="feature-heading">
        <p className="feature-status">Coming soon</p>
        <h1 id="feature-heading">{title}</h1>
        <p>{description}</p>
        <p>This feature is not implemented yet.</p>
        {children}
      </section>
    </main>
  )
}
