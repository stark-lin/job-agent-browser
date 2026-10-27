const { createHash, randomUUID } = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { mkdir, rename, rm, lstat } = require('node:fs/promises')
const { dirname, join } = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Transform, Readable } = require('node:stream')
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
async function prepare({ directory, verify = false, model, fetcher = fetch, signal, onProgress = () => {}, seed } = {}) {
  validateManifest(model)
  let completed = 0
  const total = model.files.reduce((n, file) => n + file.size, 0)
  for (const file of model.files) {
    signal?.throwIfAborted()
    if (await verifyFile(directory, file)) { completed += file.size; onProgress(completed, total); continue }
    if (verify) throw new Error('MODEL_INCOMPLETE_OR_CHECKSUM_FAILED: ' + file.path)
    const path = join(directory, file.path)
    await mkdir(dirname(path), { recursive: true })
    let failure
    for (let attempt = 0; attempt < 3; attempt++) {
      const temporary = path + '.' + randomUUID() + '.tmp'
      try {
        const transferSignal = AbortSignal.any([AbortSignal.timeout(900000), ...(signal ? [signal] : [])])
        if (seed && !await verifyFile(seed, file)) throw new Error('MODEL_SEED_INVALID')
        const response = seed ? undefined : await fetcher(`https://huggingface.co/${model.source}/resolve/${model.revision}/${file.path}`, { signal: transferSignal })
        if (!seed && (!response.ok || !response.body)) throw new Error('MODEL_DOWNLOAD_FAILED')
        const hash = createHash('sha256')
        let bytes = 0
        const check = new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length
          if (bytes > file.size) return callback(new Error('MODEL_CHECKSUM_FAILED'))
          hash.update(chunk); callback(null, chunk)
          onProgress(completed + bytes, total)
        } })
        await pipeline(seed ? createReadStream(join(seed, file.path)) : Readable.fromWeb(response.body), check, createWriteStream(temporary, { flags: 'wx' }), { signal: transferSignal })
        if (bytes !== file.size || hash.digest('hex') !== file.sha256) throw new Error('MODEL_CHECKSUM_FAILED')
        await rename(temporary, path)
        failure = undefined
        break
      } catch (error) { failure = error; if (signal?.aborted) throw error }
      finally { await rm(temporary, { force: true }) }
    }
    if (failure) throw failure
    completed += file.size
    onProgress(completed, total)
  }
  return directory
}
module.exports = { prepare, digest, validateManifest, verifyFile, safeParents }
