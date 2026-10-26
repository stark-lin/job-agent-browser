const { app } = require('electron')
const { resolve } = require('node:path')
const { verifyEmbeddingRuntime } = require('../.cache/embedding-smoke/verification.cjs')
const deadline = setTimeout(() => app.exit(1), 170000)
app.whenReady().then(async () => {
  console.log(await verifyEmbeddingRuntime(resolve(__dirname, '../out/main'), resolve(__dirname, '../.cache/models'), process.env.JAB_EMBEDDING_SMOKE_DATA))
  clearTimeout(deadline); app.exit(0)
}).catch(e => { console.error(e); app.exit(1) })
