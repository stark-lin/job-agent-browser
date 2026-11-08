// Other feature suites enter the workspace through the real first-run UI.
module.exports = async function completeOnboarding(window) {
  const evaluate = code => window.webContents.executeJavaScript(code)
  const wait = async check => {
    const end = Date.now() + 8000
    while (!await check()) {
      if (Date.now() > end) throw new Error('Setup did not become ready')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  await wait(() => evaluate('!!document.querySelector(".onboarding-page, .app-shell")'))
  if (await evaluate('!!document.querySelector(".app-shell")')) return
  for (const text of ['Continue', 'Not now', 'Skip', 'Open JAB']) {
    await wait(() => evaluate(`[...document.querySelectorAll('.onboarding-page button')].some(b => b.checkVisibility() && !b.disabled && b.textContent === ${JSON.stringify(text)})`))
    await evaluate(`[...document.querySelectorAll('.onboarding-page button')].find(b => b.checkVisibility() && !b.disabled && b.textContent === ${JSON.stringify(text)}).click()`)
  }
  await wait(() => evaluate('!!document.querySelector(".app-shell")'))
}
