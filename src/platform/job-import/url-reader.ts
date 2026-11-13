import * as v from '../../domain/common/validation'
import type { JobPageReader } from '../../domain/job/job.extractor'
import { snapshotFromHTML } from './html'
import { JobImportFailure } from './errors'
import { abortable } from '../../shared/agent'
import { requestTimeout } from '../ai/transport'
import { AI_DEFAULTS } from '../../shared/ai'

/** Fetch only the supplied public document. No Cookie jar, page scripts or site adapters. */
export function createURLReader(transport: typeof fetch = fetch, timeoutMs: number | (() => number) = AI_DEFAULTS.pageTimeoutMs): JobPageReader {
  return { async read(input, signal) {
    const requestedUrl = v.url(input), duration = typeof timeoutMs === 'function' ? timeoutMs() : timeoutMs
    const timeout = requestTimeout(signal, duration)
    try {
      let url = requestedUrl
      for (let redirects = 0; redirects <= 5; redirects++) {
        timeout.signal.throwIfAborted()
        const response = await abortable(transport(url, { redirect: 'manual', signal: timeout.signal, credentials: 'omit',
          headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'JobAgentBrowser/0.1' } }), timeout.signal)
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel()
          const location = response.headers.get('location')
          if (!location || redirects === 5) throw new JobImportFailure('JOB_FETCH_FAILED')
          url = v.url(new URL(location, url).href)
          continue
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new JobImportFailure([401, 403, 407, 429, 451].includes(response.status) ? 'JOB_ACCESS_RESTRICTED' : 'JOB_FETCH_FAILED')
        }
        if (!/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
          await response.body?.cancel(); throw new JobImportFailure('JOB_NO_CONTENT')
        }
        const reader = response.body.getReader(), chunks: Uint8Array[] = []
        let bytes = 0
        try {
          for (;;) {
            const chunk = await abortable(reader.read(), timeout.signal)
            if (chunk.done) break
            bytes += chunk.value.length
            if (bytes > 2 * 1024 * 1024) throw new JobImportFailure('JOB_CONTENT_TOO_LARGE')
            chunks.push(chunk.value)
          }
        } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
        const data = Buffer.concat(chunks)
        const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1] ?? 'utf-8'
        let html: string
        try { html = new TextDecoder(charset).decode(data) } catch { html = new TextDecoder().decode(data) }
        timeout.signal.throwIfAborted()
        return snapshotFromHTML(html, requestedUrl, url)
      }
      throw new JobImportFailure('JOB_FETCH_FAILED')
    } catch (error) {
      if (signal.aborted) throw new JobImportFailure('AI_CANCELLED')
      if (timeout.timedOut()) throw new JobImportFailure('JOB_FETCH_TIMEOUT')
      if (error instanceof JobImportFailure) throw error
      throw new JobImportFailure('JOB_FETCH_FAILED')
    } finally { timeout.dispose() }
  } }
}
