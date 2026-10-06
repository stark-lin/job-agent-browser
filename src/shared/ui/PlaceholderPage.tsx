import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

export function PlaceholderPage({ title, description, actions, children }: {
  title: string; description: string; actions?: ReactNode; children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <main className="feature-page">
      {actions ? <nav className="page-actions" aria-label={t($ => $.navigation.pageNavigation)}>{actions}</nav> : null}
      <section className="feature-content" aria-labelledby="feature-heading">
        <p className="feature-status">{t($ => $.features.comingSoon)}</p>
        <h1 id="feature-heading">{title}</h1>
        <p>{description}</p>
        <p>{t($ => $.features.notImplemented)}</p>
        {children}
      </section>
    </main>
  )
}
