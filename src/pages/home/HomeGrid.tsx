import { useTranslation } from 'react-i18next'
import type { InternalPage } from '../../shared/navigation'
import { HomeTile } from './HomeTile'

export function HomeGrid({ onNavigate }: { onNavigate: (page: InternalPage) => void }) {
  const { t } = useTranslation()
  return (
    <div className="home-grid">
      <HomeTile onClick={() => onNavigate('find')} label={t($ => $.navigation.pages.find)} description={t($ => $.home.cards.find)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/></svg>} />
      <HomeTile onClick={() => onNavigate('resume')} label={t($ => $.navigation.pages.resume)} description={t($ => $.home.cards.resume)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5M10 17h5"/></svg>} />
      <HomeTile onClick={() => onNavigate('interview')} label={t($ => $.navigation.pages.interview)} description={t($ => $.home.cards.interview)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 18v-7a3 3 0 013-3h10a3 3 0 013 3v7"/><circle cx="12" cy="5" r="2"/><path d="M8 18h8"/></svg>} />
      <HomeTile onClick={() => onNavigate('applications')} label={t($ => $.navigation.pages.applications)} description={t($ => $.home.cards.applications)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>} />
      <HomeTile onClick={() => onNavigate('inbox')} label={t($ => $.navigation.pages.inbox)} description={t($ => $.home.cards.inbox)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/></svg>} />
      <HomeTile onClick={() => onNavigate('profile')} label={t($ => $.navigation.pages.profile)} description={t($ => $.home.cards.profile)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0114 0"/></svg>} />
      <HomeTile onClick={() => onNavigate('browser')} label={t($ => $.navigation.pages.browser)} description={t($ => $.home.cards.browser)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/></svg>} />
      <HomeTile onClick={() => onNavigate('ai')} label={t($ => $.navigation.pages.ai)} description={t($ => $.home.cards.ai)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3z"/><path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z"/></svg>} />
      <HomeTile onClick={() => onNavigate('settings')} label={t($ => $.navigation.pages.settings)} description={t($ => $.home.cards.settings)} icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V21h-4v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 00.3-1.9A1.7 1.7 0 003 14H3v-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 001.9.3A1.7 1.7 0 0010 3V3h4v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 00-.3 1.9 1.7 1.7 0 001.6 1H21v4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>} />
    </div>
  )
}
