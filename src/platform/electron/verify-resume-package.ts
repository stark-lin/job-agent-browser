import { createResumeTasks } from './resume-tasks'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { createBackend } from '../database/backend'
import type { FirstPartyRuntime } from '../mcp/first-party-client'
import { extractPdf } from '../import/pdf'

export async function verifyResumePackage(backend: ReturnType<typeof createBackend>, mcp: FirstPartyRuntime, bundleDirectory: string, directory: string) {
  // These are disposable test fixtures. All workflow operations use the real MCP session.
  const job = backend.jobs.saveJob({ details: { title: 'TypeScript Engineer', companyNameRaw: 'Offline Fixture', description: 'Build reliable services.' } })
  const profile = backend.profiles.createProfile({ name: 'Package Fixture' })
  const item = backend.profiles.addItem({ profileId: profile.id, details: { type: 'EXPERIENCE', title: 'Engineer', organization: 'Fixture' } })
  const fact = backend.profiles.addFact({ profileId: profile.id, profileItemId: item.id, details: { kind: 'ACHIEVEMENT', content: 'Built TypeScript services with automated tests.' } })
  const signal = AbortSignal.timeout(120000)
  const choice = { providerId: 'package-fixture', modelId: 'package-model' }
  const tasks = createResumeTasks({ backend, mcp, directory: join(directory, 'artifacts'), fonts: join(bundleDirectory, 'fonts'), key: () => null,
    settings: () => ({ default: choice, providers: [{ id: choice.providerId, name: 'Package Fixture',
      baseURL: 'https://example.invalid/v1', models: [choice.modelId], defaultModel: choice.modelId, requiresKey: false,
      capabilities: { [choice.modelId]: { contextWindow: 65536, maxOutputTokens: 8192, source: 'manual', verified: true } } }] }),
    model: () => ({
      complete: async () => { throw new Error('Unexpected compaction') },
      async *stream() {
        yield { type: 'content.delta', text: 'The source bullet is ready.' }
        yield { type: 'completed', response: { content: 'The source bullet is ready.', toolCalls: [] } }
      }
    }) })
  let built
  try {
    const { runId } = await tasks.start(1, { jobId: job.id, profileId: profile.id }, () => {})
    let task = tasks.getTask(1, { runId })
    while (task?.active) {
      signal.throwIfAborted()
      await new Promise(resolve => setTimeout(resolve, 20))
      task = tasks.getTask(1, { runId })
    }
    if (task?.run.state !== 'PUBLISHED' || !task.artifact) throw new Error('PACKAGED_RESUME_RUN_FAILED')
    const artifact = task.artifact
    const root = join(directory, 'artifacts')
    built = { output: artifact.output, files: artifact.outputFiles.map(file => ({ format: file.format, path: join(root, file.relativePath) })) }
  } finally { await tasks.dispose() }
  if (built.output.status !== 'READY') throw new Error('PACKAGED_PDF_BUILD_FAILED')
  const pdfFile = built.files.find(f => f.format === 'PDF'), htmlFile = built.files.find(f => f.format === 'HTML')
  if (!pdfFile || !htmlFile) throw new Error('PACKAGED_OUTPUT_MISSING')
  const pdf = await readFile(pdfFile.path), html = await readFile(htmlFile.path, 'utf8')
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || !html.includes(fact.content)) throw new Error('PACKAGED_OUTPUT_INVALID')
  const pages = await extractPdf(new Uint8Array(pdf), signal, () => {}, join(bundleDirectory, 'pdf-worker.mjs'))
  if (pages.length !== built.output.pages || !pages.map(p => p.text).join(' ').includes('TypeScript services')) throw new Error('PACKAGED_PDF_TEXT_INVALID')
}
