import { Glyph } from '../../shared/ui'
import { useTranslation } from 'react-i18next'
import type { InternalPage } from '../../shared/navigation'
import { features, pageIcons } from '../../app/navigation/features'
import { HomeTile } from './HomeTile'

export function HomeGrid({ onNavigate }: { onNavigate: (page: InternalPage) => void }) {
  const { t } = useTranslation()
  return <div className="home-grid">{features.map(page => <HomeTile key={page} onClick={() => onNavigate(page)}
    label={t($ => $.navigation.pages[page])} description={t($ => $.home.cards[page])} icon={<Glyph name={pageIcons[page]} />} />)}</div>
}
