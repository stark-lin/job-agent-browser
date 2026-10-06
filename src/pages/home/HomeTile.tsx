import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

interface HomeTileProps {
  label: string
  description: string
  icon: ReactNode
  onClick?: () => void
}

export function HomeTile({ label, description, icon, onClick }: HomeTileProps) {
  const { t } = useTranslation()
  return (
    <button
      className="home-card"
      type="button"
      disabled={!onClick}
      title={onClick ? undefined : t($ => $.home.comingSoon, { label })}
      onClick={onClick}
    >
      <span className="home-icon" aria-hidden="true">{icon}</span>
      <span>
        <span className="home-label">{label}</span>
        <span className="home-desc">{description}</span>
      </span>
    </button>
  )
}
