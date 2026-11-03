/** Model context only; effect confirmation and transcript storage retain full results. */
export function modelToolResult(name: string, result: unknown): unknown {
  if (name !== 'job.set_archived' || !result || typeof result !== 'object' || Array.isArray(result)) return result
  const job = result as Record<string, unknown>
  if (typeof job.id !== 'string' || !(job.archivedAt === null || typeof job.archivedAt === 'string')) return result
  return { id: job.id, archived: job.archivedAt !== null, success: true }
}
