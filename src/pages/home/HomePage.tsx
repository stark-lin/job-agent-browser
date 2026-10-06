import { useTranslation } from 'react-i18next'
import type { InternalPage } from '../../shared/navigation'
import { HomeGrid } from './HomeGrid'
import './home.css'

export function HomePage({ onNavigate }: { onNavigate: (page: InternalPage) => void }) {
  const { t } = useTranslation()
  return (
    <main className="home-page">
      <section className="home" aria-labelledby="home-heading">
        <div className="home-heading">
          <div className="home-eyebrow">{t($ => $.home.brand)}</div>
          <h1 id="home-heading">{t($ => $.home.heading)}</h1>
          <div className="home-sub">{t($ => $.home.subtitle)}</div>
        </div>
        <HomeGrid onNavigate={onNavigate} />
        <div className="home-footer-note">{t($ => $.home.footer)}</div>
      </section>
    </main>
  )
}
