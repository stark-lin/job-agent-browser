import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { TestContext } from 'node:test'
import { seed } from './helpers'
import { createFirstPartyRuntime } from '../src/platform/mcp/first-party-client'
// Include the real standalone runtime in the compiled test graph used by the child entry.
import '../src/platform/mcp-server/runtime'

/** Real stdio runtime and shared SQLite. Only the costly renderer is deterministic here. */
export async function firstPartyFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'first-party-'))
  const cleanups: (() => void | Promise<void>)[] = []
  const f = await seed({ after: (cleanup: () => void) => { cleanups.push(cleanup) } }, join(directory, 'database.sqlite'))
  const runtimePath = resolve(__dirname, '../src/platform/mcp-server/runtime.js')
  const compilerPath = resolve(__dirname, '../src/platform/resume-output/compiler.js')
  writeFileSync(join(directory, 'job-agent-mcp.js'), `
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
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
const runtime = createServerRuntime(directory, __dirname, renderer, process.env.JOB_BROWSER_MCP_CALLER);
const sink = runtime.backend.toolAudit.sink;
const start = sink.start.bind(sink), finish = sink.finish.bind(sink);
sink.start = context => { if (existsSync(marker('fail-audit-start'))) throw new Error('fixture'); return start(context) };
sink.finish = (...args) => { if (existsSync(marker('fail-audit-finish'))) throw new Error('fixture'); return finish(...args) };
let closing;
const close = () => closing ??= runtime.dispose();
runtime.server.onclose = () => { void close() };
process.once('SIGTERM', () => { void close() });
void runtime.server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 2097152 }));
`)
  const mcp = createFirstPartyRuntime(directory, directory)
  t.after(async () => { await mcp.dispose(); for (const cleanup of cleanups.reverse()) await cleanup(); rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
  return { ...f, directory, mcp, cleanup: (fn: () => void | Promise<void>) => cleanups.push(fn), outputDirectory: join(directory, 'artifacts'),
    flag(name: string, on = true) { if (on) writeFileSync(join(directory, name), '1'); else rmSync(join(directory, name), { force: true }) },
    has: (name: string) => existsSync(join(directory, name)),
    outputs: () => existsSync(join(directory, 'output-count')) ? Number(readFileSync(join(directory, 'output-count'), 'utf8')) : 0 }
}
