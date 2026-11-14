const assert = require('node:assert/strict')
const { ipcMain } = require('electron')
let holdWrite, holdSearch, failWrite = false, writing = false, searching = false
/** Delay actual production IPC replies to make editor/search races deterministic. */
function install() {
  const handle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
    if (channel !== 'knowledge:call') return listener(event, ...args)
    const [method, input] = args
    if (method === 'write' && input.path === 'switch.md' && failWrite) return { ok: false, error: 'KNOWLEDGE_CONFLICT' }
    const result = await listener(event, method, input)
    if (method === 'write' && input.path === 'switch.md' && holdWrite) { writing = true; await holdWrite }
    if (method === 'search' && input.query === 'UNIQUE_KNOWLEDGE_SEARCH' && holdSearch) { searching = true; await holdSearch }
    return result
  })
}
async function run({ window, evaluate, call, wait, click }) {
  const select = async (space, name) => {
    await wait(() => evaluate(`[...document.querySelectorAll('[role=tree][aria-label="${space}"] [role=treeitem]')].some(row=>row.querySelector(':scope > span:last-child')?.textContent===${JSON.stringify(name)})`), `row ${space}/${name}`)
    return evaluate(`[...document.querySelectorAll('[role=tree][aria-label="${space}"] [role=treeitem]')].find(row=>row.querySelector(':scope > span:last-child')?.textContent===${JSON.stringify(name)}).click()`)
  }
  const edit = async text => {
    window.focus(); window.webContents.focus()
    await evaluate('document.querySelector(".cm-content").focus()')
    window.webContents.selectAll()
    await new Promise(resolve => setTimeout(resolve, 30))
    await window.webContents.insertText(text)
  }
  await wait(() => evaluate('document.querySelectorAll("[role=tree]").length===2'), 'two spaces')
  assert.equal(await evaluate('document.querySelector("[role=treeitem]").getAttribute("aria-expanded")'), 'false')
  assert.equal(await evaluate('document.querySelector("[role=treeitem] > span:last-child").textContent'), 'Memory')
  await select('Memory', 'Memory')
  await wait(() => evaluate('document.querySelector(".knowledge-breadcrumb").textContent.includes("Memory")'), 'Memory root')
  await edit('# Memory README\nMEMORY_README_BODY')
  await select('Knowledge', 'Knowledge')
  await wait(async () => (await call('read', { space: 'memory', path: 'README.md' })).value.content.includes('MEMORY_README_BODY'), 'Memory flush')
  await wait(() => evaluate('document.querySelector(".knowledge-breadcrumb").textContent.includes("Knowledge")'), 'Knowledge root')
  assert(!(await call('read', { path: 'README.md' })).value.content.includes('MEMORY_README_BODY'))
  assert((await call('write', { path: 'switch.md', content: 'UNIQUE_KNOWLEDGE_SEARCH', expectedRevision: null })).ok)
  assert((await call('write', { space: 'memory', path: 'switch.md', content: 'MEMORY_SWITCH_BODY', expectedRevision: null })).ok)
  await wait(() => evaluate('[...document.querySelectorAll("[role=tree][aria-label=Knowledge] [role=treeitem]")].some(x=>x.textContent.includes("switch.md"))'), 'switch files')
  await select('Knowledge', 'switch.md')
  await wait(() => evaluate('document.querySelector(".cm-content").textContent.includes("UNIQUE_KNOWLEDGE_SEARCH")'), 'Knowledge file')
  let releaseWrite
  holdWrite = new Promise(resolve => { releaseWrite = resolve }); writing = false
  await edit('KNOWLEDGE_DELAYED_SAVE')
  await select('Memory', 'switch.md')
  await wait(() => Promise.resolve(writing), 'held save')
  assert(await evaluate('document.querySelector(".knowledge-breadcrumb").textContent.includes("Knowledge")'))
  releaseWrite(); holdWrite = null
  await wait(() => evaluate('document.querySelector(".cm-content").textContent.includes("MEMORY_SWITCH_BODY")'), 'switch after flush')
  assert.equal((await call('read', { space: 'memory', path: 'switch.md' })).value.content, 'MEMORY_SWITCH_BODY')
  assert.equal((await call('read', { path: 'switch.md' })).value.content, 'KNOWLEDGE_DELAYED_SAVE')
  // A failing flush preserves the original selection and draft.
  failWrite = true
  await edit('MEMORY_UNSAVED_DRAFT')
  await select('Knowledge', 'Knowledge')
  await wait(() => evaluate('document.body.textContent.includes("KNOWLEDGE_CONFLICT")'), 'failed flush')
  assert(await evaluate('document.querySelector(".knowledge-breadcrumb").textContent.includes("Memory")'))
  assert(await evaluate('document.querySelector(".cm-content").textContent.includes("MEMORY_UNSAVED_DRAFT")'))
  failWrite = false
  await select('Knowledge', 'Knowledge')
  await wait(() => evaluate('document.querySelector(".knowledge-breadcrumb").textContent.includes("Knowledge")'), 'retry flush')
  assert.equal((await call('read', { space: 'memory', path: 'switch.md' })).value.content, 'MEMORY_UNSAVED_DRAFT')
  const current = await call('read', { path: 'switch.md' })
  await call('write', { path: 'switch.md', content: 'UNIQUE_KNOWLEDGE_SEARCH', expectedRevision: current.value.revision })
  let releaseSearch
  holdSearch = new Promise(resolve => { releaseSearch = resolve }); searching = false
  await evaluate(`(()=>{const field=document.querySelector('.knowledge-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'UNIQUE_KNOWLEDGE_SEARCH');field.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await evaluate('document.querySelector(".knowledge-search").requestSubmit()')
  await wait(() => Promise.resolve(searching), 'held search')
  await select('Memory', 'Memory')
  await wait(() => evaluate('document.querySelector(".knowledge-breadcrumb").textContent.includes("Memory")'), 'scope switch')
  releaseSearch(); holdSearch = null
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(await evaluate('!!document.querySelector(".knowledge-results")'), false, 'late Knowledge results must not appear in Memory')
  // Keyboard activation and root protections use the shared row.
  await evaluate('document.querySelector("[role=tree][aria-label=Memory] [role=treeitem]").focus()')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F2' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F2' })
  assert.equal(await evaluate('!!document.querySelector("dialog[open]")'), false)
  await click('History')
  await wait(() => evaluate('!!document.querySelector("dialog[open]")'), 'Memory history')
  assert(await evaluate('document.querySelector("dialog[open]").textContent.includes("Memory")'))
  await click('Close')
  const prefs = (await call('configuration')).value.preferences
  await call('configure', { ...prefs, remote: 'https://github.com/fixture/memory-ui.git' })
  await evaluate(`document.querySelector('.knowledge-toolbar-actions button:last-child').click()`)
  await wait(() => evaluate('document.querySelector("dialog[open]")?.textContent.includes("Upload Memory and its history?")'), 'sync disclosure')
  assert(await evaluate('document.querySelector("dialog[open]").textContent.includes("Git history")'))
  await click('Cancel')
  assert((await call('syncConsent')).value.required)
  await call('configure', { ...prefs, remote: '' })
  await select('Knowledge', 'Knowledge')
  await wait(() => evaluate('document.querySelector(".knowledge-breadcrumb").textContent.includes("Knowledge")'), 'final Knowledge selection')
  for (const language of ['en', 'zh-CN']) for (const theme of ['light', 'dark']) {
    assert((await evaluate(`window.data.settings.savePreferences(${JSON.stringify({ language, theme })})`)).ok)
    const label = language === 'en' ? 'Memory' : '记忆'
    await wait(() => evaluate(`document.querySelector('[role=tree]')?.getAttribute('aria-label')===${JSON.stringify(label)}&&document.documentElement.dataset.theme===${JSON.stringify(theme)}`), 'Memory language/theme')
    for (const width of [320, 640, 1200]) {
      window.setContentSize(width, 800)
      await new Promise(resolve => setTimeout(resolve, 30))
      assert(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'), `${language}/${theme}/${width} page overflow`)
      assert(await evaluate('!!document.querySelector(".ui-explorer-row--special svg")'), 'central brain glyph')
    }
  }
  await evaluate('window.data.settings.savePreferences({language:"en",theme:"light"})')
  window.setContentSize(1200, 800)
  await wait(() => evaluate('document.querySelector("[role=tree]")?.getAttribute("aria-label")==="Memory"'), 'restore English')
  console.log('Memory UI verified: pinned collapsed root, same-name file isolation, delayed save/search, failed flush, keyboard protection, scoped history and cancelled remote consent.')
}
module.exports = { install, run }
