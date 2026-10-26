const { app } = require('electron'),
  assert = require('node:assert/strict'),
  { resolve, join } = require('node:path'),
  { writeFileSync } = require('node:fs')
const directory = process.env.JOB_BROWSER_SMOKE_DATA
assert(directory)
app.setPath('userData', directory)
const timeout = setTimeout(() => {
  console.error('Knowledge smoke timed out')
  app.exit(1)
}, 55000)
let selected = false
app.on('browser-window-created', (_event, window) => {
  if (selected) return
  selected = true
  window.webContents.setBackgroundThrottling(false)
  window.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error('Renderer:', e.message)
  })
  window.webContents.once('did-finish-load', async () => {
    const evaluate = (code) => window.webContents.executeJavaScript(code),
      call = (method, input = {}) => evaluate(`window.knowledge.${method}(${JSON.stringify(input)})`)
    const wait = async (fn, label) => {
      const end = Date.now() + 10000
      while (!(await fn())) {
        if (Date.now() > end) throw new Error('Timed out: ' + label)
        await new Promise((r) => setTimeout(r, 25))
      }
    }
    const click = (text) =>
      evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`)
    try {
      await evaluate("window.browser.navigate('app://knowledge')")
      await wait(() => evaluate('!!document.querySelector("[data-knowledge-page]")'), 'knowledge page')
      if (process.env.KNOWLEDGE_SMOKE_STAGE === 'restart') {
        const saved = await call('read', { path: 'interview/ctrip.md' })
        assert(saved.ok)
        assert(saved.value.content.includes('Restored final'))
        assert(saved.value.content.includes('Normal close persisted'))
        assert((await call('history')).value.length > 0)
        assert.equal((await call('configuration')).value.preferences.mode, 'edit')
        assert((await call('search', { query: 'Restored' })).value.items.some((h) => h.path === 'interview/ctrip.md'))
        console.log(
          'Knowledge restart smoke passed: Markdown, preferences, Git history and rebuilt retrieval survive restart.'
        )
      } else {
        assert((await call('mkdir', { path: 'interview' })).ok)
        assert(
          (
            await call('write', {
              path: 'interview/README.md',
              content: '# Interview\n\nFolder context',
              expectedRevision: null
            })
          ).ok
        )
        assert(
          (
            await call('write', {
              path: 'interview/ctrip.md',
              content: '# Ctrip\n\nInitial note',
              expectedRevision: null
            })
          ).ok
        )
        const openFile = async () => {
          await wait(
            () =>
              evaluate(
                '[...document.querySelectorAll("[role=treeitem]")].some(b=>b.textContent.includes("interview"))'
              ),
            'folder'
          )
          await evaluate(
            '[...document.querySelectorAll("[role=treeitem]")].find(b=>b.textContent.includes("interview")).click()'
          )
          await wait(
            () =>
              evaluate('[...document.querySelectorAll("[role=treeitem]")].some(b=>b.textContent.includes("ctrip.md"))'),
            'note'
          )
          await evaluate(
            '[...document.querySelectorAll("[role=treeitem]")].find(b=>b.textContent.includes("ctrip.md")).click()'
          )
          await wait(
            () =>
              evaluate(
                '!!document.querySelector(".cm-content")&&document.querySelector(".knowledge-breadcrumb").textContent.includes("ctrip.md")'
              ),
            'CodeMirror'
          )
        }
        await openFile()
        const edit = async (text) => {
          await evaluate('document.querySelector(".cm-content").focus();document.execCommand("selectAll")')
          await window.webContents.insertText(text)
        }
        await edit(
          '# Ctrip pricing\n\n携程定价笔记\n\n**Bold** and *italic*\n\n<script>window.BAD=true</script>\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
        )
        await wait(async () => {
          const r = await call('read', { path: 'interview/ctrip.md' })
          return r.ok && r.value.content.includes('携程定价')
        }, 'autosave')
        await wait(() => evaluate('!!document.querySelector("[data-knowledge-preview] h1")'), 'heading preview')
        assert.equal(await evaluate('!!window.BAD'), false)
        assert.equal(await evaluate('document.querySelector("[data-knowledge-preview] em").textContent'), 'italic')
        assert.equal(
          await evaluate(
            'getComputedStyle(document.querySelector(".knowledge-document")).gridTemplateColumns.split(" ").length'
          ),
          2
        )
        await click('Preview')
        await wait(() => evaluate('!document.querySelector(".cm-editor")'), 'preview mode')
        await click('Edit')
        await wait(
          () => evaluate('!!document.querySelector(".cm-editor")&&!document.querySelector("[data-knowledge-preview]")'),
          'edit mode'
        )
        await click('Split')
        writeFileSync(join(directory, 'knowledge', 'interview', 'ctrip.md'), '# External update\n\n外部编辑')
        await wait(
          () => evaluate('document.querySelector(".cm-content").textContent.includes("External update")'),
          'watcher reload'
        )
        await edit('# Local draft\n\nMust survive conflict')
        writeFileSync(join(directory, 'knowledge', 'interview', 'ctrip.md'), '# Other writer\n\nExternal version')
        await wait(() => evaluate('document.body.textContent.includes("This file changed")'), 'conflict UI')
        assert((await call('read', { path: 'interview/ctrip.md' })).value.content.includes('Other writer'))
        await click('Save draft as…')
        await evaluate(
          "(()=>{const input=document.querySelector('dialog[open] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'draft-copy.md');input.dispatchEvent(new Event('input',{bubbles:true}))})()"
        )
        await new Promise((r) => setTimeout(r, 50))
        await evaluate(
          "[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Confirm').click()"
        )
        await wait(async () => {
          const r = await call('read', { path: 'draft-copy.md' })
          return r.ok && r.value.content.includes('Must survive')
        }, 'draft copy')
        const current = await call('read', { path: 'interview/ctrip.md' })
        assert(
          (
            await call('write', {
              path: 'interview/ctrip.md',
              content: '# Restored final\n\n持久知识',
              expectedRevision: current.value.revision
            })
          ).ok
        )
        const version = await call('backup')
        assert(version.ok)
        const now = await call('read', { path: 'interview/ctrip.md' })
        await call('write', {
          path: 'interview/ctrip.md',
          content: 'Temporary change',
          expectedRevision: now.value.revision
        })
        const tree = await call('tree')
        assert((await call('restore', { commit: version.value, expectedRevision: tree.value.revision })).ok)
        assert((await call('read', { path: 'interview/ctrip.md' })).value.content.includes('Restored final'))
        await click('Preview')
        await new Promise((r) => setTimeout(r, 700))
        // Capture the actual production renderer for visual inspection outside the repository.
        writeFileSync(join(require('node:os').tmpdir(), 'jab-smart-note.png'), (await window.webContents.capturePage()).toPNG())
        await evaluate("window.browser.navigate('app://settings')")
        await wait(
          () => evaluate('document.body.textContent.includes("Knowledge backup and retrieval")'),
          'knowledge settings'
        )
        assert.equal((await call('configuration')).value.preferences.semanticEnabled, true)
        await evaluate("window.browser.navigate('app://knowledge')")
        await wait(() => evaluate('!!document.querySelector("[data-knowledge-page]")'), 'knowledge before quit')
        await click('Edit')
        await openFile()
        await edit('# Restored final\n\nNormal close persisted')
        // Quit immediately, before the autosave debounce. Main must flush the editor first.
        console.log(
          'Knowledge Electron smoke passed: sandboxed IPC, Explorer, CodeMirror autosave, modes, safe Markdown, external conflict copy, backup/restore and settings.'
        )
      }
      clearTimeout(timeout)
      app.quit()
    } catch (error) {
      console.error(error)
      clearTimeout(timeout)
      app.exit(1)
    }
  })
})
require(resolve(__dirname, '../out/main/index.js'))
