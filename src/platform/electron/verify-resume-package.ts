import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { createBackend } from '../database/backend'
import type { FirstPartyRuntime } from '../mcp/first-party-client'
import { extractPdf } from '../import/pdf'

export async function verifyResumePackage(backend: ReturnType<typeof createBackend>, mcp: FirstPartyRuntime, bundleDirectory: string) {
  // These are disposable test fixtures. All workflow operations use the real MCP session.
  const job = backend.jobs.saveJob({ details: { title: 'TypeScript Engineer', companyNameRaw: 'Offline Fixture', description: 'Build reliable services.' } })
  const profile = backend.profiles.createProfile({ name: 'Package Fixture' })
  const item = backend.profiles.addItem({ profileId: profile.id, details: { type: 'EXPERIENCE', title: 'Engineer', organization: 'Fixture' } })
  const fact = backend.profiles.addFact({ profileId: profile.id, profileItemId: item.id, details: { kind: 'ACHIEVEMENT', content: 'Built TypeScript services with automated tests.' } })
  const signal = AbortSignal.timeout(120000), session = await mcp.session('resume', signal)
  const call = (name: string, input: unknown) => session.call(name, input, signal)
  const { runId } = await call('resume.start', { jobId: job.id, profileId: profile.id, requestId: randomUUID() }) as { runId: string }
  await call('resume.submit_scores', { runId, language: 'en', scores: [{ factId: fact.id, score: 95, reason: 'Direct evidence.' }] })
  await call('resume.submit_gate', { runId, gate: { passed: true, reason: 'Supported.', missingRequirements: [] } })
  await call('resume.submit_selection', { runId, selection: { factIds: [fact.id], itemIds: [item.id], wordBudget: 500 } })
  const writing = { summary: { id: randomUUID(), text: fact.content, factIds: [fact.id] },
    experience: [{ profileItemId: item.id, bullets: [{ id: randomUUID(), text: fact.content, factIds: [fact.id] }] }], projects: [], education: [], skills: [] }
  await call('resume.submit_draft', { runId, writing })
  await call('resume.submit_polished', { runId, writing })
  const { artifact } = await call('resume.publish', { runId }) as { artifact: { id: string } }
  const built = await call('artifact.build', { artifactId: artifact.id }) as { output: { status: string; pages: number }; files: { format: string; path: string }[] }
  if (built.output.status !== 'READY') throw new Error('PACKAGED_PDF_BUILD_FAILED')
  const pdfFile = built.files.find(f => f.format === 'PDF'), htmlFile = built.files.find(f => f.format === 'HTML')
  if (!pdfFile || !htmlFile) throw new Error('PACKAGED_OUTPUT_MISSING')
  const pdf = await readFile(pdfFile.path), html = await readFile(htmlFile.path, 'utf8')
  if (pdf.subarray(0, 5).toString() !== '%PDF-' || !html.includes(fact.content)) throw new Error('PACKAGED_OUTPUT_INVALID')
  const pages = await extractPdf(new Uint8Array(pdf), signal, () => {}, join(bundleDirectory, 'pdf-worker.mjs'))
  if (pages.length !== built.output.pages || !pages.map(p => p.text).join(' ').includes('TypeScript services')) throw new Error('PACKAGED_PDF_TEXT_INVALID')
}
