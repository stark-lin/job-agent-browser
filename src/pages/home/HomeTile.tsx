import { FeatureCard } from '../../shared/ui'
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
    <FeatureCard
      className="home-card"
      label={label}
      description={description}
      icon={icon}
      disabled={!onClick}
      title={onClick ? undefined : t($ => $.home.comingSoon, { label })}
      onClick={onClick}
    />
  )
}
