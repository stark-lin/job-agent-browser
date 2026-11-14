import type { ReactNode } from 'react'

/** Links from business data are HTTP(S) only and open outside the trusted document. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  try {
    const url = new URL(href)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return <span>{children}</span>
  } catch { return <span>{children}</span> }
  return <a className="ui-external-link" href={href} target="_blank" rel="noopener noreferrer">{children}</a>
}
