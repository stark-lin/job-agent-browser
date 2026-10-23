/** Runs only in an isolated offscreen document after fonts are ready. No input is executed. */
export async function paginateDocument(): Promise<{ html: string; pages: number }> {
  await document.fonts.ready
  const source = document.getElementById('source')!
  const blocks = [...source.children] as HTMLElement[]
  let body: HTMLElement, pages = 0
  function page() {
    if (++pages > 1000) throw new Error('LAYOUT_LIMIT')
    const sheet = document.createElement('article'); sheet.className = 'page'
    body = document.createElement('div'); body.className = 'page-body'
    sheet.append(body); document.body.append(sheet)
  }
  function fits() { return body.scrollHeight <= body.clientHeight + 1 }
  page()
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index].cloneNode(true) as HTMLElement
    // Keep heading chains with the first body block whenever the group fits on a page.
    if (block.dataset.keep && body!.childElementCount) {
      const probe: HTMLElement[] = [block]
      let next = index
      while (blocks[next]?.dataset.keep && next + 1 < blocks.length) probe.push(blocks[++next].cloneNode(true) as HTMLElement)
      const height = blocks.slice(index, next + 1).reduce((total, element) => {
        const style = getComputedStyle(element)
        return total + element.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom)
      }, 0)
      // An oversized first paragraph only needs its first line beside the heading chain.
      if (height > body!.clientHeight && probe.length > 1) probe[probe.length - 1].textContent = [...(probe[probe.length - 1].textContent ?? '')][0] ?? ''
      body!.append(...probe); const overflow = !fits(); probe.forEach(node => node.remove())
      if (overflow) page()
    }
    body!.append(block)
    if (fits()) continue
    block.remove()
    // Move a normal paragraph/bullet intact before resorting to line-boundary splitting.
    if (body!.childElementCount && blocks[index].getBoundingClientRect().height <= body!.clientHeight) { page(); body!.append(block); if (fits()) continue; block.remove() }
    const segmenter = new Intl.Segmenter(document.documentElement.lang, { granularity: 'grapheme' })
    const characters = [...segmenter.segment(block.textContent ?? '')].map(part => part.segment)
    let offset = 0, continuation = false
    while (offset < characters.length) {
      const fragment = block.cloneNode(false) as HTMLElement
      if (continuation) fragment.classList.add('continuation')
      body!.append(fragment)
      let low = 0, high = characters.length - offset
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        fragment.textContent = characters.slice(offset, offset + mid).join('')
        if (fits()) low = mid; else high = mid - 1
      }
      if (!low) { fragment.remove(); if (body!.childElementCount) { page(); continue }; throw new Error('LAYOUT_OVERFLOW') }
      // Prefer a whole-word boundary when a Latin word would straddle two pages.
      if (offset + low < characters.length && /[\p{L}\p{N}]/u.test(characters[offset + low - 1]) && /[\p{L}\p{N}]/u.test(characters[offset + low]) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(characters[offset + low])) {
        const prefix = characters.slice(offset, offset + low).join(''), boundary = prefix.search(/\S+$/u)
        if (boundary > 0) low = [...segmenter.segment(prefix.slice(0, boundary))].length
      }
      const text = characters.slice(offset, offset + low).join('')
      fragment.textContent = text
      offset += low; continuation = true
      if (offset < characters.length) page()
    }
  }
  source.remove()
  return { html: '<!doctype html>' + document.documentElement.outerHTML, pages }
}
