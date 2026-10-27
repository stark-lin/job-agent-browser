const { readFileSync, appendFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
const before = event.pull_request?.base.sha || event.before
const after = event.pull_request?.head.sha || process.env.GITHUB_SHA
let full = true
if (before && !/^0+$/.test(before)) {
  const paths = execFileSync('git', ['diff', '--name-only', before, after], { encoding: 'utf8' }).trim().split('\n')
  full = paths.some(path => /^(src\/platform\/(knowledge|models|npm|electron|mcp|resume-output)|src\/shared\/(knowledge|models)|src\/pages\/settings\/(Knowledge|LocalModel)|resources\/|scripts\/|tests\/|\.github\/|packages\/|LICENSE|package.*\.json|electron.*|tsconfig.*)/.test(path))
}
appendFileSync(process.env.GITHUB_OUTPUT, `package=${full}\n`)
