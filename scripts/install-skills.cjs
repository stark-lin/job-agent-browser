const { mkdirSync, symlinkSync, existsSync, lstatSync, realpathSync } = require('node:fs')
const { resolve, relative, join } = require('node:path')
const root = resolve(__dirname, '..'), parent = resolve(root, '.agents/skills')
const names = ['capture-job', 'manage-applications', 'tailor-resume', 'distill-resume', 'distill-project']
// Validate every existing destination before creating any link.
for (const name of names) {
  const source = join(root, 'skills', name), target = join(parent, name)
  if (!existsSync(source)) throw new Error(`Missing repository skill: ${name}`)
  try {
    lstatSync(target)
    if (!existsSync(target) || realpathSync(target) !== realpathSync(source)) throw new Error(`Existing ${name} skill points elsewhere; it was not changed.`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
mkdirSync(parent, { recursive: true })
for (const name of names) {
  const target = join(parent, name)
  if (!existsSync(target)) symlinkSync(relative(parent, join(root, 'skills', name)), target, 'dir')
}
console.log(`Repository skills linked: ${names.join(', ')}.`)
