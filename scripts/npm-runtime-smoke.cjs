const assert = require('node:assert/strict')
const { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = resolve(__dirname, '..')
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 300000, ...options })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`)
  return result.stdout || ''
}
async function main() {
  const artifact = join(root, 'dist/npm-artifacts/manifest.json')
  const report = JSON.parse(readFileSync(artifact)), tarball = join(root, 'dist/npm-artifacts', report.tarball)
  assert.equal(createHash('sha256').update(readFileSync(tarball)).digest('hex'), report.sha256)
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'jab-npm-install-')))
  const cache = process.env.JAB_NPM_TEST_CACHE || join(root, '.cache/npm-install')
  const env = { ...process.env, npm_config_cache: cache, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }
  delete env.NODE_PATH; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
  try {
    const sourceLock = require('../package-lock.json')
    const allowScripts = Object.fromEntries(['onnxruntime-node', 'protobufjs'].map(name => [name + '@' + sourceLock.packages['node_modules/' + name].version, true]))
    writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'jab-clean-install', private: true, allowScripts }))
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: scratch, env, stdio: 'inherit' })
    const installed = join(scratch, 'node_modules/@stark-lin/jab'), cli = join(installed, 'bin/jab.cjs')
    const pkg = JSON.parse(readFileSync(join(installed, 'package.json')))
    assert.equal(pkg.version, report.version); assert.equal(pkg.jab.gitSha, report.sha)
    assert.equal(run(process.execPath, [cli, '--version'], { cwd: tmpdir(), env }).trim(), report.version)
    const missing = spawnSync(process.execPath, [cli, 'mcp'], { cwd: scratch, encoding: 'utf8', env: { ...env, JOB_BROWSER_USER_DATA: '' } })
    assert.equal(missing.status, 1); assert.equal(missing.stdout, '')
    delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
    const protocol = join(scratch, 'mcp-smoke.cjs')
    writeFileSync(protocol, `
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {createRequire}=require('node:module');const local=createRequire(${JSON.stringify(join(installed, 'package.json'))});
const {Client}=local('@modelcontextprotocol/client');const {StdioClientTransport}=local('@modelcontextprotocol/client/stdio');
const client=new Client({name:'npm-cli-smoke',version:'1'});
(async()=>{const transport=new StdioClientTransport({command:process.execPath,args:[${JSON.stringify(cli)},'mcp','--data-dir',process.argv[2]],stderr:'pipe'});
try{await client.connect(transport);const tools=await client.listTools();assert(tools.tools.some(t=>t.name==='knowledge.retrieve'));
const call=async(name,input)=>{const r=await client.callTool({name,arguments:input},{timeout:180000});assert(!r.isError,JSON.stringify(r));return r.structuredContent};
const result=await call('knowledge.retrieve',{query:'SQLite'});assert(result);
const job=await call('job.import',{requestId:randomUUID(),details:{title:'TypeScript Engineer',companyNameRaw:'npm fixture',description:'Build reliable TypeScript services.'}});
const profile=await call('profile.create',{requestId:randomUUID(),details:{name:'npm PDF fixture'}});
const item=await call('profile.add_item',{profileId:profile.id,requestId:randomUUID(),expectedRevision:profile.revision,details:{type:'EXPERIENCE',title:'Engineer',organization:'Fixture'}});
const fact=await call('profile.add_fact',{profileId:profile.id,profileItemId:item.id,requestId:randomUUID(),expectedRevision:item.revision,details:{kind:'ACHIEVEMENT',content:'Built TypeScript services with automated tests.'}});
const {runId}=await call('resume.start',{jobId:job.id,profileId:profile.id,requestId:randomUUID()});
await call('resume.submit_scores',{runId,language:'en',scores:[{factId:fact.id,score:95,reason:'Direct evidence.'}]});
await call('resume.submit_gate',{runId,gate:{passed:true,reason:'Supported.',missingRequirements:[]}});
await call('resume.submit_selection',{runId,selection:{factIds:[fact.id],itemIds:[item.id],wordBudget:500}});
const writing={summary:{id:randomUUID(),text:fact.content,factIds:[fact.id]},experience:[{profileItemId:item.id,bullets:[{id:randomUUID(),text:fact.content,factIds:[fact.id]}]}],projects:[],education:[],skills:[]};
await call('resume.submit_draft',{runId,writing});await call('resume.submit_polished',{runId,writing});
const {artifact}=await call('resume.publish',{runId});const built=await call('artifact.build',{artifactId:artifact.id});assert.equal(built.output.status,'READY');
console.log('Pure Node jab mcp verified first-use Electron initialization and real PDF output without protocol stdout contamination.');
}finally{await client.close()}})().catch(e=>{console.error(e);process.exitCode=1});
`)
    const data = join(scratch, 'user-data')
    mkdirSync(data)
    writeFileSync(join(data, 'database.sqlite'), '')
    run(process.execPath, [protocol, data], { cwd: tmpdir(), env, stdio: 'inherit' })
    // The tarball is genuinely installed outside the repository. Initialize Electron through
    // its official runtime module; no dependency or binary is copied from the checkout.
    delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
    run(process.execPath, ['-e', "require('electron')"], { cwd: installed, env, stdio: 'inherit' })
    const doctor = JSON.parse(run(process.execPath, [cli, 'doctor'], { cwd: tmpdir(), env }))
    assert(doctor.electron.executable.startsWith(scratch)); assert(doctor.mcp)
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      const path = [join(installed, 'node_modules', name, 'package.json'), join(scratch, 'node_modules', name, 'package.json')].find(existsSync)
      assert(path, 'Dependency missing: ' + name)
      const actual = JSON.parse(readFileSync(path)).version
      assert.equal(actual, version, 'Installed direct dependency differs from verified lock: ' + name)
    }
    env.JAB_MODEL_STORE = join(data, 'managed-models')
    // The same built verification entry exercises keyword/MCP retrieval and real HTML/PDF.
    run(process.execPath, [cli, '--data-dir', data, '--verify-package', '--verify-minimal'], { cwd: tmpdir(), env, stdio: 'inherit' })
    const minimal = JSON.parse(readFileSync(join(data, 'package-verification.json')))
    assert(minimal.ok && minimal.pdfVerified && minimal.semanticAvailable === false)
    // Load the real GUI and typed preload, including settings and model controls.
    const guiScript = join(scratch, 'gui-smoke.cjs')
    writeFileSync(guiScript, `
const {app}=require('electron');
const assert=require('node:assert/strict');
const timeout=setTimeout(()=>app.exit(1),45000);
app.on('browser-window-created',(_event,window)=>{window.webContents.once('did-finish-load',async()=>{try{
const evaluate=code=>window.webContents.executeJavaScript(code);
await evaluate("window.browser.navigate('app://settings')");
const end=Date.now()+15000;while(!await evaluate('!!document.querySelector("[data-local-model]")')){if(Date.now()>end)throw Error('Model settings missing');await new Promise(r=>setTimeout(r,25));}
const state=await evaluate('window.knowledge.modelStatus({})');assert.equal(state.value.state,'missing');
assert(await evaluate('!!document.querySelector("[data-local-model] button")'));
clearTimeout(timeout);app.quit();
}catch(error){console.error(error);app.exit(1)}})});
require(${JSON.stringify(join(installed, 'out/main/index.js'))});
`)
    const guiEnv = { ...env, JOB_BROWSER_USER_DATA: join(scratch, 'gui-data') }
    // This fixture is outside the installed package and does not enter the tarball.
    run(doctor.electron.executable, [guiScript], { cwd: tmpdir(), env: guiEnv, stdio: 'inherit' })
    assert(existsSync(join(data, 'database.sqlite')))
    const modelSeed = process.env.JAB_NPM_MODEL_SEED || join(root, '.cache/models/multilingual-e5-small')
    let semantic = false, installedModelRecord
    if (existsSync(join(modelSeed, 'onnx/model_int8.onnx'))) {
      const fixture = join(scratch, 'model-ui-smoke.cjs')
      cpSync(join(root, 'scripts/model-runtime-smoke.cjs'), fixture)
      mkdirSync(env.JAB_MODEL_STORE, { recursive: true })
      writeFileSync(join(env.JAB_MODEL_STORE, 'seed-preferences.json'), JSON.stringify({ autoImportSeed: false, seedInitializedRevisions: [] }))
      const modelData = join(scratch, 'model-ui-data'); mkdirSync(modelData)
      run(doctor.electron.executable, [fixture], { cwd: tmpdir(), env: { ...env,
        JOB_BROWSER_SMOKE_DATA: modelData, JAB_MODEL_SMOKE_APP: installed, JAB_MODEL_SMOKE_SEED: modelSeed, JAB_MODEL_SMOKE_KEEP: '1' }, stdio: 'inherit' })
      const model = JSON.parse(readFileSync(join(installed, 'resources/embedding-model.json')))
      installedModelRecord = join(env.JAB_MODEL_STORE, model.id, model.revision, '.installed.json')
      assert(existsSync(installedModelRecord)); semantic = true
    }
    // Simulate an application reinstall while retaining user-owned database/models.
    const persisted = readFileSync(join(data, 'database.sqlite'))
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['uninstall', '--no-audit', '--no-fund', '@stark-lin/jab'], { cwd: scratch, env, stdio: 'inherit' })
    assert.deepEqual(readFileSync(join(data, 'database.sqlite')), persisted)
    if (installedModelRecord) assert(existsSync(installedModelRecord), 'Uninstall must preserve installed model files')
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: scratch, env, stdio: 'inherit' })
    assert.equal(run(process.execPath, [cli, '--version'], { cwd: tmpdir(), env }).trim(), report.version)
    if (installedModelRecord) {
      run(process.execPath, ['-e', "require('electron')"], { cwd: installed, env, stdio: 'inherit' })
      const reopened = JSON.parse(run(process.execPath, [cli, 'doctor'], { cwd: tmpdir(), env }))
      assert.equal(reopened.model.state, 'ready', 'Reinstall must detect and verify existing user model weights')
    }
    report.runtimeVerified = true
    report.runtime = { platform: process.platform, arch: process.arch, gui: true, mcp: true, pdf: true, keywordFallback: true, reinstall: true, semantic }
    writeFileSync(artifact, JSON.stringify(report, null, 2) + '\n')
    console.log('Clean npm installation verified: GUI, preload, model controls, keyword retrieval, MCP, HTML/PDF and reinstall persistence.')
  } finally { rmSync(scratch, { recursive: true, force: true }) }
}
module.exports = { main }
if (require.main === module) void main().catch(error => { console.error(error); process.exitCode = 1 })
