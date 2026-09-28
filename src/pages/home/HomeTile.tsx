import type { ReactNode } from 'react'

interface HomeTileProps {
  label: string
  description: string
  icon: ReactNode
  onClick?: () => void
}

export function HomeTile({ label, description, icon, onClick }: HomeTileProps) {
  return (
    <button
      className="home-card"
      type="button"
      disabled={!onClick}
      title={onClick ? undefined : `${label} — Coming soon`}
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
