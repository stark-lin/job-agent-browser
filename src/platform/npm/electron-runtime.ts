import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

/** Initialize Electron through its official module without contaminating MCP stdout. */
export function resolveElectronRuntime(signal: AbortSignal, executable?: string): Promise<string> {
  signal.throwIfAborted()
  const selected = executable ?? process.env.JOB_BROWSER_ELECTRON
  if (selected) return Promise.resolve(selected)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', "const path=require(process.argv[1]);if(typeof path!=='string')process.exit(1);process.stdout.write('\\n'+path)", require.resolve('electron')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'], signal
    })
    let output = '', failure = false
    const timer = setTimeout(() => { failure = true; child.kill('SIGKILL') }, 120000)
    child.stdout.on('data', data => {
      output += data.toString()
      if (Buffer.byteLength(output) > 1048576) { failure = true; child.kill('SIGKILL') }
    })
    child.stderr.on('data', data => process.stderr.write(data))
    child.once('error', () => { clearTimeout(timer); reject(new Error('OUTPUT_RUNTIME_UNAVAILABLE')) })
    child.once('close', code => {
      clearTimeout(timer)
      const path = output.trimEnd().split('\n').at(-1) ?? ''
      if (failure || code !== 0 || !isAbsolute(path)) reject(new Error('OUTPUT_RUNTIME_UNAVAILABLE'))
      else resolve(path)
    })
  })
}
