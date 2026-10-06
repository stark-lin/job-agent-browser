const assert = require('node:assert/strict')
const { createServer } = require('node:http')

// Keep the outsider window alive until this check ends, so window-all-closed
// cannot quit the app before the retained native views are inspected.
module.exports = async function windowCloseSmoke(window) {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<title>Retained page</title><h1>Window close fixture</h1>')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const url = `http://127.0.0.1:${server.address().port}/retained`
    await window.webContents.executeJavaScript(`window.browser.navigate(${JSON.stringify(url)})`)
    await window.webContents.executeJavaScript("window.browser.navigate('app://home')")
    const retained = window.contentView.children.filter((view) => view.webContents).map((view) => view.webContents)
    assert(retained.length > 0)
    // WebContents.close() completes asynchronously after the BrowserWindow's
    // closed event; verify the actual native destruction events before checking.
    const released = Promise.all(retained.map((contents) => new Promise((resolve) => contents.once('destroyed', resolve))))
    const closed = new Promise((resolve) => window.once('closed', resolve))
    window.destroy()
    await closed
    await released
    assert(retained.every((contents) => contents.isDestroyed()))
    console.log('Window close smoke passed: hidden retained native views are released when the owning window closes.')
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
