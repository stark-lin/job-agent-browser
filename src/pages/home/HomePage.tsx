import { HomeGrid } from './HomeGrid'
import './home.css'

export function HomePage({ onOpenBrowser }: { onOpenBrowser: () => void }) {
  return (
    <main className="home-page">
      <section className="home" aria-labelledby="home-heading">
        <div className="home-heading">
          <div className="home-eyebrow">Job Browser</div>
          <h1 id="home-heading">What do you want to do?</h1>
          <div className="home-sub">Everything you need for your job search, in one place.</div>
        </div>
        <HomeGrid onOpenBrowser={onOpenBrowser} />
        <div className="home-footer-note">A focused workspace for the whole job search.</div>
      </section>
    </main>
  )
}
