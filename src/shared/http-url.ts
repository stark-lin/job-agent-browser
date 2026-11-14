/** Business links allow HTTP(S) URLs without embedded credentials. */
export function parseHttpUrl(href: string): URL | null {
  try {
    const url = new URL(href)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}
