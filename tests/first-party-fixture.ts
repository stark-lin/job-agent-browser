import { createHumanRequests } from '../src/platform/mcp/human-requests'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { TestContext } from 'node:test'
import { seed } from './helpers'
import { SmartNoteWorkspace } from '../src/platform/knowledge/workspace'
import { defaultKnowledgePreferences } from '../src/shared/knowledge-settings'
import { createFirstPartyRuntime } from '../src/platform/mcp/first-party-client'
// Include the real standalone runtime in the compiled test graph used by the child entry.
import '../src/platform/mcp-server/runtime'

/** Real stdio runtime and shared SQLite. Only the costly renderer is deterministic here. */
export async function firstPartyFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'first-party-'))
  const cleanups: (() => void | Promise<void>)[] = [], runCleanups: (() => Promise<void>)[] = []
  const f = await seed({ after: (cleanup: () => void) => { cleanups.push(cleanup) } }, join(directory, 'database.sqlite'))
  const workspace = new SmartNoteWorkspace(directory, { preferences: () => defaultKnowledgePreferences })
  await workspace.ready
  cleanups.push(() => workspace.close())
  const authorityPath = resolve(__dirname, '../src/platform/mcp/memory-authority.js')
  const runtimePath = resolve(__dirname, '../src/platform/mcp-server/runtime.js')
  const compilerPath = resolve(__dirname, '../src/platform/resume-output/compiler.js')
  writeFileSync(join(directory, 'job-agent-mcp.js'), `
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { consola } = require(${JSON.stringify(require.resolve('consola'))});
consola.options.throttle = 0;
consola.options.stdout = process.stderr;
consola.options.stderr = process.stderr;
const { StdioServerTransport } = require(${JSON.stringify(require.resolve('@modelcontextprotocol/server/stdio'))});
const { createServerRuntime } = require(${JSON.stringify(runtimePath)});
const { compileHTML } = require(${JSON.stringify(compilerPath)});
const directory = process.env.JOB_BROWSER_USER_DATA;
const marker = name => join(directory, name);
const renderer = async document => {
  const count = existsSync(marker('output-count')) ? Number(readFileSync(marker('output-count'), 'utf8')) : 0;
  writeFileSync(marker('output-count'), String(count + 1));
  writeFileSync(marker('rendering'), '1');
  if (existsSync(marker('fail-output'))) throw new Error('fixture');
  while (existsSync(marker('hang-output')) && !existsSync(marker('release-output'))) await new Promise(resolve => setTimeout(resolve, 10));
  return { html: compileHTML(document, { id: 'default-v1', fontVersion: 'noto-sc-v1', fontBase64: 'AAAA' }), pdf: Buffer.from('fixture PDF'), pages: 1 };
};
const { redeemMemoryLaunch } = require(${JSON.stringify(authorityPath)});
void (async () => {
const authorized = await redeemMemoryLaunch(process.env.JOB_BROWSER_MEMORY_LAUNCH, directory);
const runtime = createServerRuntime(directory, __dirname, renderer, process.env.JOB_BROWSER_MCP_CALLER, authorized, process.env.JOB_BROWSER_ASK_READ_ONLY === '1');
await runtime.ready;
let closing;
const close = () => closing ??= runtime.dispose();
runtime.server.onclose = () => { void close() };
authorized?.signal.addEventListener('abort', () => { void close() }, { once: true });
process.once('SIGTERM', () => { void close() });
await runtime.server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 2097152 }));
})().catch(() => { process.exitCode = 1 });
`)
  const human = createHumanRequests()
  cleanups.push(() => human.dispose())
  const mcp = createFirstPartyRuntime(directory, directory, human)
  await mcp.ready
  let lastRun: Awaited<ReturnType<typeof mcp.openAgentRun>> | undefined
  t.after(async () => { for (const close of runCleanups) await close(); await mcp.dispose(); for (const cleanup of cleanups.reverse()) await cleanup(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
  return { ...f, directory, mcp, workspace, human,
    async askRun(signal: AbortSignal, sessionId = 'default', sourceMessageIds: string[] = []) {
      const run = await mcp.openAgentRun({ agent: 'ask', agentRunId: randomUUID(), sessionId, sourceMessageIds, signal })
      lastRun = run; runCleanups.push(() => run.close().catch(() => {})); return run.tools
    }, endAskRun: async () => { await lastRun?.close(); lastRun = undefined }, cleanup: (fn: () => void | Promise<void>) => cleanups.push(fn), outputDirectory: join(directory, 'artifacts'),
    flag(name: string, on = true) { if (on) writeFileSync(join(directory, name), '1'); else rmSync(join(directory, name), { force: true }) },
    has: (name: string) => existsSync(join(directory, name)),
    outputs: () => existsSync(join(directory, 'output-count')) ? Number(readFileSync(join(directory, 'output-count'), 'utf8')) : 0 }
}
