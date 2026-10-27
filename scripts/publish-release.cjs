const { readFileSync, readdirSync, writeFileSync, statSync, createReadStream } = require('node:fs')
const { join, resolve } = require('node:path')
const { createHash } = require('node:crypto')
const { metadata } = require('./release-metadata.cjs')
const { digest } = require('./prepare-embedding-model.cjs')
const targets = ['mac-arm64']
async function verifyAssets(directory, meta) {
  const seen = new Set(), files = [], builds = []
  for (const target of targets) {
    const build = JSON.parse(readFileSync(join(directory, target + '.json'), 'utf8'))
    const model = require('../resources/embedding-model.json')
    if (build.platform + '-' + build.arch !== target || build.sha !== meta.sha || build.version !== meta.version ||
      build.modelRevision !== model.revision || build.modelManifest !== await digest(join(__dirname, '../resources/embedding-model.json')) ||
      !build.runtimeVerified || !['signed', 'unsigned'].includes(build.signing) || build.assets.length !== 1) throw new Error('BUILD_MANIFEST_MISMATCH: ' + target)
    for (const asset of build.assets) {
      const extension = target.startsWith('win') ? 'exe' : target.startsWith('mac') ? 'dmg' : 'AppImage'
      const expected = `JAB-${meta.version}-${build.platform === 'win' ? 'win' : build.platform}-${build.arch}.${extension}`
      if (asset.name !== expected || seen.has(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('INVALID_RELEASE_ASSET')
      seen.add(asset.name)
      const path = join(directory, asset.name)
      if (statSync(path).size !== asset.size || await digest(path) !== asset.sha256) throw new Error('ASSET_CHECKSUM_MISMATCH')
      files.push(asset)
    }
    builds.push(build)
  }
  const expectedFiles = new Set([...files.map(f => f.name), ...targets.map(t => t + '.json')])
  if (readdirSync(directory).some(name => !expectedFiles.has(name) && !['SHA256SUMS', 'build-manifest.json'].includes(name))) throw new Error('UNEXPECTED_RELEASE_ASSET')
  return { files, builds }
}
async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('RELEASE_REQUIRES_MAIN')
  const meta = metadata(require('../package.json').version, process.env.GITHUB_RUN_NUMBER, process.env.GITHUB_SHA)
  const directory = resolve(__dirname, '../release/publish')
  const { files, builds } = await verifyAssets(directory, meta)
  writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify({ ...meta, builds }, null, 2) + '\n')
  files.push({ name: 'build-manifest.json', sha256: await digest(join(directory, 'build-manifest.json')), size: statSync(join(directory, 'build-manifest.json')).size })
  writeFileSync(join(directory, 'SHA256SUMS'), files.map(f => `${f.sha256}  ${f.name}\n`).join(''))
  files.push({ name: 'SHA256SUMS', sha256: await digest(join(directory, 'SHA256SUMS')), size: statSync(join(directory, 'SHA256SUMS')).size })
  const repo = process.env.GITHUB_REPOSITORY, token = process.env.GH_TOKEN
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw new Error('RELEASE_AUTH_REQUIRED')
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  async function api(path, method = 'GET', body) {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) })
    if (response.status === 404 && method === 'GET') return null
    if (!response.ok) throw new Error(`GITHUB_API_FAILED: ${method} ${response.status}`)
    return response.status === 204 ? null : response.json()
  }
  const tag = await api('/git/ref/tags/' + encodeURIComponent(meta.tag))
  if (tag && tag.object.sha !== meta.sha) throw new Error('RELEASE_TAG_TARGET_MISMATCH')
  let release = await api('/releases/tags/' + encodeURIComponent(meta.tag))
  if (release && release.target_commitish !== meta.sha) throw new Error('RELEASE_TARGET_MISMATCH')
  if (!release) release = await api('/releases', 'POST', { tag_name: meta.tag, target_commitish: meta.sha, name: `JAB ${meta.version}`,
    draft: true, prerelease: true, make_latest: 'false', body: `Automated main preview of ${meta.sha}.\n\nBundled offline multilingual model: ${builds[0].modelRevision}.\n\nSigning: ${builds.map(b => `${b.platform}-${b.arch}: ${b.signing}`).join(', ')}.\n\nIncludes verified installers, SHA256SUMS and a build manifest. Unsigned previews may require OS installation approval.` })
  if (release.draft) {
    for (const asset of release.assets) if (!files.some(file => file.name === asset.name)) await api('/releases/assets/' + asset.id, 'DELETE')
    for (const file of files) {
      const existing = release.assets.find(asset => asset.name === file.name)
      if (existing?.digest === 'sha256:' + file.sha256 && existing.size === file.size) continue
      if (existing) await api('/releases/assets/' + existing.id, 'DELETE')
      const response = await fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size) },
        body: createReadStream(join(directory, file.name)), duplex: 'half', signal: AbortSignal.timeout(600000)
      })
      if (!response.ok) throw new Error('RELEASE_UPLOAD_FAILED: ' + file.name)
      await response.json()
    }
  }
  release = await api('/releases/' + release.id)
  if (release.assets.length !== files.length) throw new Error('RELEASE_ASSET_COUNT_MISMATCH')
  for (const file of files) {
    const remote = release.assets.find(asset => asset.name === file.name)
    if (!remote || remote.size !== file.size) throw new Error('RELEASE_REMOTE_SIZE_MISMATCH')
    if (remote.digest) { if (remote.digest !== 'sha256:' + file.sha256) throw new Error('RELEASE_REMOTE_CHECKSUM_MISMATCH') }
    else {
      const response = await fetch(remote.url, { headers: { ...headers, Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(600000) })
      if (!response.ok || !response.body) throw new Error('RELEASE_REMOTE_VERIFY_FAILED')
      const hash = createHash('sha256')
      for await (const chunk of response.body) hash.update(chunk)
      if (hash.digest('hex') !== file.sha256) throw new Error('RELEASE_REMOTE_CHECKSUM_MISMATCH')
    }
  }
  if (release.draft) release = await api('/releases/' + release.id, 'PATCH', { draft: false, prerelease: true, make_latest: 'false' })
  console.log('Published complete prerelease:', release.html_url)
}
module.exports = { verifyAssets }
if (require.main === module) void main().catch(e => { console.error(e.message); process.exitCode = 1 })
