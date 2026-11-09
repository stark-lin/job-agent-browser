const assert = require('node:assert/strict')
const { clipboard, ipcMain, BrowserWindow } = require('electron')
const { DatabaseSync } = require('node:sqlite')
const { resolve } = require('node:path')

/** Exercises the production UI/bridge/handler/dispatcher/repository/output adapter. */
exports.chatDebugSmoke = async ({ window, evaluate, data, click, frame, waitFor, directory, session, running = false }) => {
  const original = ipcMain._invokeHandlers.get('data:call')
  let calls = 0, release, block = false, lastEvent
  ipcMain.removeHandler('data:call')
  ipcMain.handle('data:call', async (event, group, method, input) => {
    if (group === 'chats' && method === 'copyDebugJson') {
      calls++; lastEvent = event
      if (block) await new Promise(r => { release = r })
    }
    return original(event, group, method, input)
  })
  const open = async () => {
    await waitFor(() => evaluate(`[...document.querySelectorAll('.ui-session-title')].some(row=>row.textContent===${JSON.stringify(session.title)})`), 'debug target session listed')
    await evaluate(`[...document.querySelectorAll('.ui-session-entry')].find(row=>row.querySelector('.ui-session-title').textContent===${JSON.stringify(session.title)}).querySelector('button[aria-label]').click()`)
    await frame()
    const labels = await evaluate("[...document.querySelector('dialog[open] .ui-dialog-actions').children].map(b=>b.textContent)")
    assert.deepEqual(labels.slice(0, 3), ['Rename', 'Copy Debug JSON', 'Delete chat'])
    await click('Copy Debug JSON'); await frame()
    assert(await evaluate("document.querySelector('dialog[open]').innerText.includes('Copy full debug data?')"))
    assert.equal(await evaluate("document.querySelector('dialog[open] input[type=checkbox]')!==null"), false)
    assert.equal(await evaluate('document.activeElement.textContent'), 'Cancel')
  }
  const db = new DatabaseSync(resolve(directory, 'database.sqlite'), { readOnly: true })
  const plain = value => JSON.parse(JSON.stringify(value))
  const snapshot = () => plain(['chat_sessions', 'agent_runs', 'agent_items', 'agent_model_requests', 'agent_model_responses', 'chat_context_checkpoints', 'chat_memory_progress'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
  try {
    const before = running ? null : snapshot()
    await clipboard.writeText('DEBUG_COPY_SENTINEL')
    await open(); assert.equal(calls, 0)
    await click('Cancel'); await frame(); assert.equal(calls, 0); assert.equal(await clipboard.readText(), 'DEBUG_COPY_SENTINEL')
    await open(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await waitFor(() => evaluate('!document.querySelector(".ui-dialog[open]")'), 'debug Escape closes'); assert.equal(calls, 0)
    await open(); block = true
    await evaluate("(() => { const b=[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Copy JSON'); b.click(); b.click(); })()")
    await waitFor(() => Boolean(release), 'pending copy call')
    assert.equal(calls, 1); assert(await evaluate("[...document.querySelectorAll('dialog[open] button')].every(b=>b.disabled)"))
    release(); block = false
    await waitFor(() => evaluate('[...document.querySelectorAll(".ui-dialog[open] button")].some(b=>b.textContent==="Copied to clipboard" && b.disabled)'), 'debug button success')
    assert.equal(await evaluate('[...document.querySelectorAll(".ai-session-content > [role=status]")].some(n=>n.textContent.includes("Copied to clipboard"))'), false)
    await click('Copied to clipboard'); assert.equal(calls, 1, 'success cannot copy again without confirmation')
    await click('Cancel'); await frame()
    const text = await clipboard.readText(), bundle = JSON.parse(text)
    assert.equal(text, JSON.stringify(bundle, null, 2)); assert.equal(bundle.format, 'jab-debug'); assert.equal(bundle.schemaVersion, 2)
    assert.equal(bundle.session.id, session.id); assert.equal(bundle.app.version, require('electron').app.getVersion()); assert.equal(bundle.app.platform, process.platform)
    assert(bundle.app.commit === null || /^[0-9a-f]{40}$/.test(bundle.app.commit)); assert(Number.isFinite(Date.parse(bundle.exportedAt)))
    assert.deepEqual(bundle.session, plain(db.prepare('SELECT * FROM chat_sessions WHERE id=?').get(session.id)))
    const rows = (table, suffix = '') => plain(db.prepare(`SELECT * FROM ${table} WHERE session_id=? ${suffix}`).all(session.id))
    for (const entry of bundle.runs) {
      const cycles = db.prepare('SELECT * FROM agent_react_cycles WHERE run_id=? ORDER BY cycle_index').all(entry.run.id)
      assert.deepEqual(entry.cycles, cycles.map(c => ({ index: c.cycle_index, status: c.status, reason: c.reason,
        modelRequestOrdinal: c.model_request_ordinal, toolCallIds: JSON.parse(c.tool_call_ids_json), startedAt: c.started_at, finishedAt: c.finished_at })))
      assert.equal(entry.cycleStatus, cycles.at(-1)?.status ?? null)
    }
    if (running) assert(bundle.runs.some(r => r.run.state === 'running'))
    else {
      assert.deepEqual(bundle.runs.map(r => r.run), rows('agent_runs', 'ORDER BY created_at,id').map(({agent, source, ...run}) => run))
      assert.deepEqual(bundle.runs.flatMap(r => r.items).sort((a, b) => a.sequence - b.sequence), rows('agent_items', 'ORDER BY sequence'))
      for (const run of bundle.runs) for (const [key, table] of [['modelRequests', 'agent_model_requests'], ['providerResponses', 'agent_model_responses']]) {
        assert.deepEqual(run[key], plain(db.prepare(`SELECT * FROM ${table} WHERE run_id=? ORDER BY ordinal`).all(run.run.id)))
      }
      assert.deepEqual(bundle.context.checkpoint, plain(db.prepare('SELECT * FROM chat_context_checkpoints WHERE session_id=?').get(session.id) ?? null))
      assert.deepEqual(bundle.context.memoryProgress, rows('chat_memory_progress', 'ORDER BY sequence,message_id'))
      assert.equal(text.includes('OPAQUE_PROVIDER_STATE'), true, 'raw persisted provider capsules are not redacted again')
      assert.deepEqual(snapshot(), before, 'copy does not write business rows')
    }
    // Simulate a real host clipboard failure without substituting the Data handler's result.
    const write = clipboard.writeText
    try {
      clipboard.writeText = async () => { throw new Error('PRIVATE_CLIPBOARD_FAILURE') }
      await open(); await click('Copy JSON')
      await waitFor(() => evaluate('!!document.querySelector("dialog[open] [role=alert]")'), 'clipboard error remains in dialog')
      assert(await evaluate('document.querySelector("dialog[open]").innerText.includes("Could not verify the copied text")'))
      assert.equal(calls, 2)
    } finally { clipboard.writeText = write }
    await click('Copy JSON')
    await waitFor(() => evaluate('[...document.querySelectorAll(".ui-dialog[open] button")].some(b=>b.textContent==="Copied to clipboard" && b.disabled)'), 'copy retry button success'); assert.equal(calls, 3)
    await click('Cancel'); await frame()
    // The same handler refuses wrong frame/URL and webContents without an owned window.
    const expected = { ok: false, error: 'FORBIDDEN' }
    const base = { sender: lastEvent.sender, senderFrame: lastEvent.sender.mainFrame }
    assert.deepEqual(await original({ ...base, senderFrame: { url: base.senderFrame.url } }, 'chats', 'copyDebugJson', { sessionId: session.id }), expected)
    const outsider = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
    try {
      await outsider.loadURL('data:text/html,<p>Untrusted debug caller</p>')
      assert.deepEqual(await outsider.webContents.executeJavaScript(`require('electron').ipcRenderer.invoke('data:call','chats','copyDebugJson',${JSON.stringify({ sessionId: session.id })})`), expected)
    } finally { outsider.destroy() }
    if (!running) assert.deepEqual(snapshot(), before)
  } finally {
    release?.(); db.close(); ipcMain.removeHandler('data:call'); ipcMain.handle('data:call', original)
  }
}

exports.chatDebugLayoutSmoke = async ({ window, evaluate, click, frame, waitFor, language, width, session }) => {
  if (width < 960) { await evaluate('document.querySelector(".ai-session-toggle button").click()'); await frame() }
  await evaluate(`[...document.querySelectorAll('.ui-session-entry')].find(row=>row.querySelector('.ui-session-title').textContent===${JSON.stringify(session.title)}).querySelector('button[aria-label]').click()`); await frame()
  await click(language === 'en' ? 'Copy Debug JSON' : '复制调试 JSON'); await frame()
  const copyLabel = language === 'en' ? 'Copy JSON' : '复制 JSON', cancelLabel = language === 'en' ? 'Cancel' : '取消'
  assert.equal(await evaluate('document.activeElement.textContent'), cancelLabel)
  if (language === 'zh-CN') assert(await evaluate("document.querySelector('dialog[open]').textContent.includes('此操作会将当前对话的完整已保存调试数据复制到系统剪贴板。')"))
  const rect = await evaluate("(() => { const d=document.querySelector('.ui-dialog[open]'), r=d.getBoundingClientRect(); return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:d.scrollWidth,width:d.clientWidth,height:innerHeight } })()")
  assert(rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= rect.height)
  assert(rect.scroll <= rect.width)
  // Native Tab/Space activation verifies confirmation is keyboard reachable at narrow widths.
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' }); await frame()
  assert.equal(await evaluate('document.activeElement.textContent'), copyLabel)
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' })
  const copiedLabel = language === 'en' ? 'Copied to clipboard' : '已复制到剪贴板'
  await waitFor(() => evaluate(`[...document.querySelectorAll('.ui-dialog[open] button')].some(b=>b.textContent===${JSON.stringify(copiedLabel)} && b.disabled)`), 'keyboard copy button success')
  assert.equal(await evaluate("document.querySelector('.ui-dialog[open]').scrollWidth > document.querySelector('.ui-dialog[open]').clientWidth"), false)
  await click(cancelLabel); await frame()
  assert.equal(JSON.parse(await clipboard.readText()).session.id, session.id)
  if (width < 960) { await evaluate('document.querySelector(".ui-drawer-heading button").click()'); await frame() }
}
