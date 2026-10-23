const { mkdirSync, symlinkSync, existsSync, realpathSync } = require('node:fs')
const { resolve } = require('node:path')
const root = resolve(__dirname, '..'), source = resolve(root, 'skills/tailor-resume')
const parent = resolve(root, '.agents/skills'), target = resolve(parent, 'tailor-resume')
mkdirSync(parent, { recursive: true })
if (existsSync(target)) {
  if (realpathSync(target) !== realpathSync(source)) throw new Error('Existing tailor-resume skill points elsewhere; it was not changed.')
} else symlinkSync('../../skills/tailor-resume', target, 'dir')
console.log('Repository skill linked at .agents/skills/tailor-resume.')
