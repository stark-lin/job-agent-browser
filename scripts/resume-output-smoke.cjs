const { app } = require('electron')
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const { randomUUID } = require('node:crypto')
app.on('web-contents-created', (_event, contents) => contents.on('console-message', details => { if (details.level === 'error') console.error(details.message) }))
app.setPath('userData', process.env.JOB_BROWSER_SMOKE_DATA)
const { exportDocument } = require('../.cache/tests/src/platform/resume-output/exporter.js')
app.on('window-all-closed', () => {})
const timer = setTimeout(() => { console.error('Resume PDF smoke timed out'); app.exit(1) }, 50000)
app.whenReady().then(async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const make = (text, language = 'en') => ({ schemaVersion: 1, language, basics: { name: '林测试 PDF Fixture', email: 'offline@example.com', phone: '', location: 'Sydney', links: [{ label: 'Long link', url: 'https://example.com/' + 'link'.repeat(60) }] },
    summary: { id: randomUUID(), text, factIds: [randomUUID()] }, experience: [], projects: [], education: [], skills: [] })
  const longBullet = make('')
  longBullet.summary = null
  longBullet.experience = [{ profileItemId: randomUUID(), title: 'A heading that follows its first paragraph', organization: 'Fixture', role: 'Engineer', location: '', startDate: '2020', endDate: '2024', isCurrent: false, degree: '', major: '', gpa: '', url: '',
    bullets: [{ id: randomUUID(), text: 'Built reliable services. '.repeat(450), factIds: [randomUUID()] }] }]
  const optional = make(''); optional.summary = null; optional.skills = [{ id: randomUUID(), text: 'TypeScript 中文能力', factIds: [randomUUID()] }]
  for (const [name, document] of [['English', make('Built reliable services. '.repeat(450))], ['Chinese', make('开发中文服务并完成测试。'.repeat(250), 'zh-CN')], ['Mixed', make('中文能力 TypeScript tests. '.repeat(250), 'zh-CN')], ['Long bullet', longBullet], ['Empty optional sections', optional]]) {
    const result = await exportDocument(document, resolve(__dirname, '../out/main/fonts'), new AbortController().signal)
    if (name !== 'Empty optional sections') assert(result.pages > 1, `${name} requires pagination`)
    for (const match of result.html.matchAll(/<article class="page"><div class="page-body">([\s\S]*?)<\/div><\/article>/g)) assert(!/<h[23][^>]*>[\s\S]*?<\/h[23]>$/.test(match[1]), 'heading must follow body text on its page')
    if (name === 'Empty optional sections') assert.equal(result.html, (await exportDocument(document, resolve(__dirname, '../out/main/fonts'), new AbortController().signal)).html, 'fixed pagination must be stable')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(result.pdf), useSystemFonts: false }).promise
    assert.equal(pdf.numPages, result.pages, `${name} preview/PDF page parity`)
    let text = ''
    for (let page = 1; page <= pdf.numPages; page++) {
      const p = await pdf.getPage(page), view = p.getViewport({ scale: 1 })
      assert(Math.abs(view.width - 595.28) < 1); assert(Math.abs(view.height - 841.89) < 1)
      const content = await p.getTextContent()
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        assert(item.transform[4] >= 0 && item.transform[4] + item.width <= view.width + 1, `${name} horizontal crop`)
        assert(item.transform[5] >= 0 && item.transform[5] <= view.height + 1, `${name} vertical crop`)
      }
    }
    const normalize = value => value.normalize('NFKC').replace(/[\s•·]/g, '')
    assert(normalize(text).includes(normalize(document.summary?.text ?? document.experience[0]?.bullets[0].text ?? document.skills[0].text)), `${name} complete paragraph extracted (${(text.match(/Built/g) ?? []).length} repeated source sentences)`)
    await pdf.loadingTask.destroy()
    console.log(`${name} PDF passed: ${result.pages} A4 pages, exact text coverage, no cropped text.`)
  }
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(exportDocument(make('Cancelled'), resolve(__dirname, '../out/main/fonts'), cancelled.signal))
  clearTimeout(timer); app.exit(0)
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1) })
