import { env, pipeline } from '@huggingface/transformers'
import { isAbsolute } from 'node:path'
import { manifest, validVectors, type EmbeddingRequest, type EmbeddingResponse } from './embedding-protocol'

// Inference only: no business files, database or MCP access.
env.allowLocalModels = true
env.allowRemoteModels = false
env.useBrowserCache = false
env.useFSCache = false
globalThis.fetch = async () => { throw new Error('EMBEDDING_NETWORK_DISABLED') }
let extractor: Awaited<ReturnType<typeof load>> | undefined
const load = async (directory: string) => {
  env.localModelPath = directory
  const result = await pipeline('feature-extraction', manifest.id, { dtype: 'int8', device: 'cpu', local_files_only: true,
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } })
  if (result.tokenizer.model_max_length !== manifest.maxLength) throw new Error('MODEL_TOKEN_LIMIT_MISMATCH')
  return result
}
let busy = false
let directory = ''
process.parentPort.on('message', async ({ data }: { data: EmbeddingRequest }) => {
  if (busy) { process.exit(1); return }
  busy = true
  let response: EmbeddingResponse
  try {
    if (!data || typeof data.id !== 'string' || !isAbsolute(data.modelsDirectory) ||
      !['query', 'document'].includes(data.purpose) || !Array.isArray(data.texts) ||
      !data.texts.length || data.texts.length > 16 || data.texts.some(t => typeof t !== 'string' || t.length > 20000) ||
      (directory && directory !== data.modelsDirectory)) throw new Error('INVALID_INPUT')
    directory = data.modelsDirectory
    extractor ??= await load(directory)
    const result = await extractor(data.texts.map(text => `${data.purpose === 'query' ? 'query' : 'passage'}: ${text}`), {
      pooling: 'mean', normalize: true
    })
    const vectors: unknown = result.tolist()
    if (!validVectors(vectors, data.texts.length)) throw new Error('INVALID_OUTPUT')
    response = { id: data.id, ok: true, vectors }
  } catch { response = { id: data?.id ?? '', ok: false } }
  busy = false
  process.parentPort.postMessage(response)
})
