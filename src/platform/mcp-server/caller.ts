/** Caller labels describe audit provenance; they never grant capabilities. */
export function mcpCaller(value: string | undefined): string {
  return value && /^[a-z][a-z0-9_.-]{0,63}$/.test(value) ? value : 'mcp-client'
}
