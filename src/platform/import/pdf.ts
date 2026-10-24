import { Worker } from 'node:worker_threads'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportError } from '../electron/profile-import-contract'

export interface PdfPage { page: number; text: string }
export class ImportFailure extends Error { constructor(readonly code: ImportError) { super(code) } }
export async function readPdf(path: string): Promise<Uint8Array> {
  try {
    const file = await open(path, 'r')
    try {
      const info = await file.stat(), limit = 10 * 1024 * 1024
      if (!info.isFile()) throw new ImportFailure('PDF_INVALID')
      if (info.size > limit) throw new ImportFailure('PDF_TOO_LARGE')
      const buffer = Buffer.alloc(limit + 1); let length = 0
      for (;;) {
        const result = await file.read(buffer, length, buffer.length - length)
        length += result.bytesRead
        if (length > limit) throw new ImportFailure('PDF_TOO_LARGE')
        if (!result.bytesRead) break
      }
      const bytes = buffer.subarray(0, length)
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new ImportFailure('PDF_INVALID')
      return new Uint8Array(bytes)
    } finally { await file.close() }
  } catch (error) { throw error instanceof ImportFailure ? error : new ImportFailure('PDF_INVALID') }
}
export function extractPdf(bytes: Uint8Array, signal: AbortSignal, progress: (page: number, pages: number) => void,
  workerPath = join(__dirname, 'pdf-worker.mjs')): Promise<PdfPage[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ImportFailure('AI_CANCELLED')); return }
    const worker = new Worker(workerPath, { workerData: bytes })
    let settled = false
    const finish = (error?: ImportError, pages?: PdfPage[]) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal.removeEventListener('abort', cancel); void worker.terminate()
      if (error) reject(new ImportFailure(error)); else resolve(pages!)
    }
    const cancel = () => finish('AI_CANCELLED')
    const timer = setTimeout(() => finish('AI_TIMEOUT'), 120000)
    signal.addEventListener('abort', cancel, { once: true })
    worker.on('message', (message: { type: string; error?: ImportError; pages?: PdfPage[] | number; page?: number }) => {
      if (message.type === 'progress') progress(message.page!, message.pages as number)
      else if (message.type === 'done') finish(undefined, message.pages as PdfPage[])
      else finish(message.error ?? 'PDF_INVALID')
    })
    worker.on('error', () => finish('PDF_INVALID'))
    worker.on('exit', () => { if (!settled) finish('PDF_INVALID') })
  })
}
