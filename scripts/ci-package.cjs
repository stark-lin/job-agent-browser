const { spawnSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { mkdirSync, rmSync, readdirSync, copyFileSync, writeFileSync, statSync } = require('node:fs')
const { metadata } = require('./release-metadata.cjs')
const { digest } = require('./prepare-embedding-model.cjs')
const manifest = require('../resources/embedding-model.json')
const root = resolve(__dirname, '..')
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error(`Command failed: ${command} (${result.status})`)
}
async function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('RELEASE_TARGET_MAC_ARM64_REQUIRED')
  const meta = metadata(require('../package.json').version, process.env.GITHUB_RUN_NUMBER, process.env.GITHUB_SHA)
  const release = process.env.JAB_RELEASE_BUILD === 'true'
  if (release && process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('RELEASE_REQUIRES_MAIN')
  const mode = process.env.JAB_SIGNING || 'unsigned'
  if (!['signed', 'unsigned'].includes(mode)) throw new Error('INVALID_SIGNING_MODE')
  const signed = release && mode === 'signed' && process.platform !== 'linux'
  const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform]
  if (!platform || !['arm64', 'x64'].includes(process.arch)) throw new Error('UNSUPPORTED_TARGET')
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: signed ? 'true' : 'false' }
  delete env.CSC_LINK; delete env.CSC_KEY_PASSWORD; delete env.APPLE_API_KEY
  const options = [`--${platform}`, process.platform === 'win32' ? 'nsis' : process.platform === 'darwin' ? 'dmg' : 'AppImage',
    `--${process.arch}`, '--publish', 'never', `--config.extraMetadata.version=${meta.version}`, `--config.buildVersion=${meta.buildVersion}`,
    `--config.mac.bundleVersion=${meta.macBundleVersion}`, `--config.mac.bundleShortVersion=${require('../package.json').version}`]
  const keyPath = join(root, '.cache/notary-key.p8')
  try {
    if (signed) {
      const prefix = process.platform === 'darwin' ? 'JAB_MAC' : 'JAB_WIN'
      env.CSC_LINK = env[prefix + '_CSC_LINK']; env.CSC_KEY_PASSWORD = env[prefix + '_CSC_KEY_PASSWORD']
      if (!env.CSC_LINK || !env.CSC_KEY_PASSWORD) throw new Error('SIGNING_CREDENTIALS_REQUIRED')
      options.push('--config.forceCodeSigning=true')
      if (process.platform === 'darwin') {
        if (!env.JAB_APPLE_API_KEY || !env.APPLE_API_KEY_ID || !env.APPLE_API_ISSUER) throw new Error('NOTARIZATION_CREDENTIALS_REQUIRED')
        mkdirSync(join(root, '.cache'), { recursive: true })
        writeFileSync(keyPath, env.JAB_APPLE_API_KEY, { mode: 0o600 })
        env.APPLE_API_KEY = keyPath
        options.push('--config.mac.notarize=true')
      }
    } else if (process.platform === 'darwin') options.push('--config.mac.identity=null', '--config.mac.notarize=false')
    run(process.execPath, [join(root, 'node_modules/electron-builder/out/cli/cli.js'), ...options], env)
    const stage = process.platform === 'darwin' ? join(root, 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'JAB.app') : join(root, 'release', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
    run(process.execPath, [join(root, 'scripts/verify-package.cjs'), stage])
    if (signed && process.platform === 'darwin') {
      run('codesign', ['--verify', '--deep', '--strict', stage])
      run('xcrun', ['stapler', 'validate', stage])
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', stage])
    }
    const output = join(root, 'release/publish')
    rmSync(output, { recursive: true, force: true }); mkdirSync(output, { recursive: true })
    const extension = { mac: '.dmg', win: '.exe', linux: '.AppImage' }[platform]
    const names = readdirSync(join(root, 'release')).filter(name => name.startsWith(`JAB-${meta.version}-`) && name.endsWith(extension))
    if (names.length !== 1) throw new Error('INSTALLER_COUNT_MISMATCH')
    const assets = []
    for (const name of names) {
      const path = join(root, 'release', name)
      if (signed && process.platform === 'win32') run('powershell', ['-NoProfile', '-Command', 'if ((Get-AuthenticodeSignature -LiteralPath $env:JAB_SIGNED_INSTALLER).Status -ne "Valid") { exit 1 }'], { ...process.env, JAB_SIGNED_INSTALLER: path })
      run(process.execPath, [join(root, 'scripts/verify-installer.cjs'), path])
      assets.push({ name, size: statSync(path).size, sha256: await digest(path) })
      copyFileSync(path, join(output, name))
    }
    writeFileSync(join(output, `${platform}-${process.arch}.json`), JSON.stringify({ ...meta, platform, arch: process.arch,
      modelRevision: manifest.revision, modelManifest: await digest(join(root, 'resources/embedding-model.json')),
      signing: signed ? 'signed' : 'unsigned', runtimeVerified: true, assets }, null, 2) + '\n')
  } finally { rmSync(keyPath, { force: true }) }
}
void main().catch(error => { console.error(error.message); process.exitCode = 1 })
