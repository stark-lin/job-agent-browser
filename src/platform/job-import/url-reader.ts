import * as v from '../../domain/common/validation'
import type { JobPageReader } from '../../domain/job/job.extractor'
import { snapshotFromHTML } from './html'
import { JobImportFailure } from './errors'

/** Fetch only the supplied public document. No Cookie jar, page scripts or site adapters. */
export function createURLReader(transport: typeof fetch = fetch, timeoutMs = 20000): JobPageReader {
  return { async read(input, signal) {
    const requestedUrl = v.url(input), controller = new AbortController()
    let timedOut = false
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try {
      signal.throwIfAborted()
      let url = requestedUrl
      for (let redirects = 0; redirects <= 5; redirects++) {
        const response = await transport(url, { redirect: 'manual', signal: controller.signal, credentials: 'omit',
          headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'JobAgentBrowser/0.1' } })
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
            const chunk = await reader.read()
            if (chunk.done) break
            bytes += chunk.value.length
            if (bytes > 2 * 1024 * 1024) throw new JobImportFailure('JOB_CONTENT_TOO_LARGE')
            chunks.push(chunk.value)
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        const data = Buffer.concat(chunks)
        const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1] ?? 'utf-8'
        let html: string
        try { html = new TextDecoder(charset).decode(data) } catch { html = new TextDecoder().decode(data) }
        return snapshotFromHTML(html, requestedUrl, url)
      }
      throw new JobImportFailure('JOB_FETCH_FAILED')
    } catch (error) {
      if (signal.aborted) throw new JobImportFailure('AI_CANCELLED')
      if (timedOut) throw new JobImportFailure('JOB_FETCH_TIMEOUT')
      if (error instanceof JobImportFailure) throw error
      throw new JobImportFailure('JOB_FETCH_FAILED')
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  } }
}
