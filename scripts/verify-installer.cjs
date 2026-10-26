const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync, cpSync, existsSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 240000, ...options })
  if (result.error || result.status !== 0) throw new Error('Installer verification command failed: ' + command)
}
function main() {
  const installer = resolve(process.argv[2])
  const directory = mkdtempSync(join(tmpdir(), 'jab-installed-'))
  let mounted = false, installed = false
  const mountpoint = join(directory, 'volume'), destination = join(directory, 'installed')
  try {
    if (process.platform === 'darwin') {
      mkdirSync(mountpoint)
      run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountpoint, installer])
      mounted = true
      cpSync(join(mountpoint, 'JAB.app'), join(destination, 'JAB.app'), { recursive: true, verbatimSymlinks: true })
      run('hdiutil', ['detach', '-force', mountpoint])
      mounted = false
      run(process.execPath, [join(__dirname, 'verify-package.cjs'), join(destination, 'JAB.app')])
    } else if (process.platform === 'win32') {
      run(installer, ['/S', '/D=' + destination])
      installed = true
      run(process.execPath, [join(__dirname, 'verify-package.cjs'), destination])
    } else {
      run(installer, ['--appimage-extract'], { cwd: directory, stdio: 'ignore' })
      run(process.execPath, [join(__dirname, 'verify-package.cjs'), join(directory, 'squashfs-root')])
    }
    console.log('Distributed installer extraction/installation and runtime verified.')
  } finally {
    if (mounted) run('hdiutil', ['detach', '-force', mountpoint])
    if (installed) {
      const uninstaller = join(destination, 'Uninstall JAB.exe')
      if (!existsSync(uninstaller)) throw new Error('UNINSTALLER_MISSING')
      run(uninstaller, ['/S'])
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
}
try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
