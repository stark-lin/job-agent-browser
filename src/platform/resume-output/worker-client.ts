import { spawn } from 'node:child_process'
import { isAbsolute, dirname, join } from 'node:path'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type { ResumeRenderer } from './service'

/** Node-side adapter. Electron is an executable dependency, never imported into the MCP process. */
export function electronRenderer(entry: string, executable?: string): ResumeRenderer {
  return (document, fonts, signal) => new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const electronDirectory = () => dirname(require.resolve('electron/package.json'))
    const command = executable ?? process.env.JOB_BROWSER_ELECTRON ?? join(electronDirectory(), 'dist', readFileSync(join(electronDirectory(), 'path.txt'), 'utf8').trim())
    if (!isAbsolute(command) || !isAbsolute(entry)) { reject(new Error('OUTPUT_WORKER_CONFIG')); return }
    const env: NodeJS.ProcessEnv = {}
    for (const name of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'WINDIR', 'COMSPEC', 'LOCALAPPDATA', 'APPDATA']) {
      if (process.env[name]) env[name] = process.env[name]
    }
    const profile = mkdtempSync(join(tmpdir(), 'jab-resume-render-'))
    env.JOB_BROWSER_RENDER_DATA = profile
    const child = spawn(command, [entry, '--resume-output-worker'], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    let result: Awaited<ReturnType<ResumeRenderer>> | undefined, failure: unknown
    let force: ReturnType<typeof setTimeout> | undefined
    const stop = () => { child.kill('SIGTERM'); force ??= setTimeout(() => child.kill('SIGKILL'), 500) }
    const abort = () => { failure = signal.reason; stop() }
    const timeout = setTimeout(() => { failure = new Error('OUTPUT_WORKER_TIMEOUT'); stop() }, 70000)
    const cleanup = () => { clearTimeout(timeout); clearTimeout(force); signal.removeEventListener('abort', abort); rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
    signal.addEventListener('abort', abort, { once: true })
    child.once('error', () => { cleanup(); reject(new Error('OUTPUT_WORKER_START')) })
    child.on('message', (value: unknown) => {
      if (value && typeof value === 'object' && 'ready' in value && value.ready === true) {
        if (signal.aborted) { abort(); return }
        child.send({ document, fonts }, error => { if (error) { failure = new Error('OUTPUT_WORKER_SEND'); stop() } })
        return
      }
      if (result || !value || typeof value !== 'object') return
      const message = value as Record<string, unknown>
      if (typeof message.html !== 'string' || typeof message.pdf !== 'string' || !Number.isInteger(message.pages) || Number(message.pages) < 1 ||
        Buffer.byteLength(message.html) > 67108864 || message.pdf.length > 44739244) { failure = new Error('OUTPUT_WORKER_RESULT'); stop(); return }
      result = { html: message.html, pdf: Buffer.from(message.pdf, 'base64'), pages: Number(message.pages) }
    })
    child.once('exit', code => { cleanup(); if (!failure && code === 0 && result) resolve(result); else reject(failure ?? new Error('OUTPUT_WORKER_FAILED')) })

  })
}
