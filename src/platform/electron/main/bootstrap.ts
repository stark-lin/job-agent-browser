import { join } from 'node:path'

// A packaged executable always enters package.main; dispatch child roles before Main side effects.
const entry = process.argv.includes('--resume-output-worker') ? 'resume-output-worker.js' : 'application-main.js'
require(join(__dirname, entry))
