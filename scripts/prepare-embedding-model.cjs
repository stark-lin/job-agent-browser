const { createHash, randomUUID } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { mkdir, stat, rename, rm, lstat } = require('node:fs/promises')
const { dirname, join, resolve } = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Transform, Readable } = require('node:stream')
const manifest = require('../resources/embedding-model.json')
const root = resolve(__dirname, '..')
function validateManifest(m) {
  if (!/^[\w-]+$/.test(m.id) || !/^[\w-]+\/[\w.-]+$/.test(m.source) || !/^[a-f0-9]{40}$/.test(m.revision) || !m.files?.length) throw new Error('MODEL_MANIFEST_INVALID')
  const seen = new Set()
  for (const f of m.files) {
    if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(f.path) || f.path.split('/').some(p => p === '.' || p === '..') ||
      seen.has(f.path) || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.size) || f.size <= 0) throw new Error('MODEL_MANIFEST_INVALID')
    seen.add(f.path)
  }
}
async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
async function safeParents(directory, relative) {
  let path = directory
  for (const part of ['', ...relative.split('/').slice(0, -1)]) {
    path = join(path, part)
    const info = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e })
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error('MODEL_UNSAFE_PATH')
  }
}
async function verifyFile(directory, file) {
  await safeParents(directory, file.path)
  const path = join(directory, file.path)
  const info = await lstat(path).catch(e => { if (e.code !== 'ENOENT') throw e })
  if (!info) return false
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('MODEL_UNSAFE_PATH')
  return info.size === file.size && await digest(path) === file.sha256
}
async function prepare({ directory = join(root, '.cache/models', manifest.id), verify = false, model = manifest, fetcher = fetch } = {}) {
  validateManifest(model)
  for (const file of model.files) {
    if (await verifyFile(directory, file)) continue
    if (verify) throw new Error('MODEL_INCOMPLETE_OR_CHECKSUM_FAILED: ' + file.path)
    const path = join(directory, file.path)
    await mkdir(dirname(path), { recursive: true })
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      const temporary = path + '.' + randomUUID() + '.tmp'
      try {
        const response = await fetcher(`https://huggingface.co/${model.source}/resolve/${model.revision}/${file.path}`, { signal: AbortSignal.timeout(900000) })
        if (!response.ok || !response.body) throw new Error('MODEL_DOWNLOAD_FAILED')
        const hash = createHash('sha256')
        let bytes = 0
        const check = new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length
          if (bytes > file.size) return callback(new Error('MODEL_CHECKSUM_FAILED'))
          hash.update(chunk); callback(null, chunk)
        } })
        await pipeline(Readable.fromWeb(response.body), check, createWriteStream(temporary, { flags: 'wx' }))
        if (bytes !== file.size || hash.digest('hex') !== file.sha256) throw new Error('MODEL_CHECKSUM_FAILED')
        await rename(temporary, path)
        failure = undefined
        break
      } catch (error) { failure = error }
      finally { await rm(temporary, { force: true }) }
    }
    if (failure) throw failure
  }
  return directory
}
module.exports = { prepare, digest, validateManifest, verifyFile }
if (require.main === module) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--verify')) throw new Error('Unknown model option')
  prepare({ verify: args.includes('--verify') }).then(() => console.log('Model files verified: ' + manifest.revision)).catch(e => { console.error(e.message); process.exitCode = 1 })
}
