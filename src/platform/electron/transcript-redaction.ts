const secretKey = /^(?:authorization|proxyAuthorization|apiKey|xApiKey|apiToken|token|accessToken|refreshToken|idToken|sessionToken|password|passwd|secret|clientSecret|privateKey|secretAccessKey|awsSecretAccessKey|credential|credentials|cookie|setCookie)$/i
const redactText = (text: string) => text.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
  .replace(/\b(?:sk|rk)-[a-zA-Z0-9_-]{12,}/g, '[REDACTED]')

/** Credential fields are removed before transcript persistence and renderer delivery. */
export function redactTranscript(value: unknown): unknown {
  if (typeof value === 'string') {
    // Tools sometimes wrap JSON in a text content block.
    try {
      const parsed: unknown = JSON.parse(value), clean = redactTranscript(parsed)
      return JSON.stringify(parsed) === JSON.stringify(clean) ? redactText(value) : JSON.stringify(clean)
    } catch { return redactText(value) }
  }
  if (Array.isArray(value)) return value.map(redactTranscript)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    secretKey.test(key.replace(/[_\s-]/g, '')) ? '[REDACTED]' : redactTranscript(child)]))
  return value
}
