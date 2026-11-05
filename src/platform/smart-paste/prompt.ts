import type { FieldContext } from '../browser/smartPasteFieldProtocol'

export function buildSmartPasteMessage(prompt: string, input: {
  clipboard: string
  page: { title: string; url: string }
  frameURL?: string
  field: FieldContext
}): string {
  const clean = (value: string) => value.replaceAll('\0', '').slice(0, 32000)
  const source = (value: string) => {
    const url = new URL(value)
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    return url.href.slice(0, 4096)
  }
  const { frameTitle, ...field } = input.field
  const context = {
    clipboard: clean(input.clipboard),
    page: { title: clean(input.page.title).slice(0, 1000), url: source(input.page.url) },
    ...(input.frameURL ? { frame: { title: clean(frameTitle), url: source(input.frameURL) } } : {}),
    field: Object.fromEntries(Object.entries(field).map(([key, value]) => [key, clean(value)]))
  }
  // Escaping angle brackets keeps the context delimiter unambiguous even for webpage text.
  const data = JSON.stringify(context).replace(/[<>]/g, char => char === '<' ? '\\u003c' : '\\u003e')
  return `${prompt}\n\n<smart-paste-context>\n${data}\n</smart-paste-context>`
}
