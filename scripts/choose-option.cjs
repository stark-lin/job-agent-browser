// Exercise the rendered combobox and its option click through the renderer.
module.exports = async function chooseOption(evaluate, selector, label) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    if (await evaluate(`(() => {
      const option = [...document.querySelectorAll('[role=option]')].find(item => item.checkVisibility() && item.textContent.trim() === ${JSON.stringify(label)});
      if (!option) return false;
      option.click();
      return true;
    })()`)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Missing option "${label}" for ${selector}`)
}
