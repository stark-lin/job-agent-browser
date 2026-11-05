import { ipcRenderer } from 'electron'
import { FIELD_COMMAND, FIELD_INVALID, FIELD_REPLY, type FieldCommand, type FieldContext } from '../../browser/smartPasteFieldProtocol'

type TextControl = HTMLInputElement | HTMLTextAreaElement
interface Field {
  element: HTMLElement
  read(): string
  replace(start: number, end: number, text: string): void
  selection: [number, number]
  multiline: boolean
  maxLength: number
  type: string
}
interface Target {
  id: string
  field: Field
  original: string
  expected: string
  generated: string
}

const inputTypes = new Set(['text', 'search', 'url', 'tel'])
const editable = (element: HTMLElement): boolean => element.isConnected
  && !element.closest('[inert], [aria-disabled="true"], [aria-readonly="true"]')
  && (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? !element.readOnly && !element.matches(':disabled') && (!(element instanceof HTMLInputElement) || inputTypes.has(element.type))
    : element.isContentEditable)

function textControl(element: TextControl): Field | undefined {
  const { selectionStart, selectionEnd, maxLength } = element
  if (selectionStart === null || selectionEnd === null) return
  const multiline = element instanceof HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(multiline ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!
  return {
    element, read: () => element.value, selection: [selectionStart, selectionEnd], multiline, maxLength, type: element.type,
    replace(start, end, text) {
      const { value, selectionStart, selectionEnd, selectionDirection } = element
      const caret = element === document.activeElement && selectionStart === start && selectionEnd === end
      setter.call(element, value.slice(0, start) + text + value.slice(end))
      if (selectionStart === null || selectionEnd === null) return
      const translate = (offset: number) => offset <= start ? offset : offset >= end ? offset + text.length - (end - start) : start + text.length
      element.setSelectionRange(caret ? start + text.length : translate(selectionStart), caret ? start + text.length : translate(selectionEnd), selectionDirection ?? undefined)
    }
  }
}

function plainContent(element: HTMLElement): Field | undefined {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount !== 1) return
  const range = selection.getRangeAt(0)
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return
  const read = () => {
    let text = ''
    for (const node of element.childNodes) {
      if (node instanceof Text) text += node.data
      else if (node instanceof HTMLBRElement) text += '\n'
      else throw new Error('Unsupported editable content')
    }
    return text
  }
  const offset = (node: Node, index: number) => {
    let size = 0
    for (const [position, child] of Array.from(element.childNodes).entries()) {
      if (node === element && position === index) return size
      if (child === node) return size + index
      size += child instanceof Text ? child.length : 1
    }
    return size
  }
  read()
  function boundary(at: number): [Node, number] {
    for (const [position, node] of Array.from(element.childNodes).entries()) {
      if (node instanceof Text && at <= node.length) return [node, at]
      if (at === 0) return [element, position]
      at -= node instanceof Text ? node.length : 1
    }
    return [element, element.childNodes.length]
  }
  return {
    element, read, selection: [offset(range.startContainer, range.startOffset), offset(range.endContainer, range.endOffset)],
    type: 'contenteditable', multiline: true, maxLength: -1,
    replace(start, end, text) {
      const range = new Range()
      range.setStart(...boundary(start))
      range.setEnd(...boundary(end))
      const current = window.getSelection()
      const caret = current?.rangeCount === 1 && element.contains(current.anchorNode)
        && offset(current.getRangeAt(0).startContainer, current.getRangeAt(0).startOffset) === start
        && offset(current.getRangeAt(0).endContainer, current.getRangeAt(0).endOffset) === end
      range.deleteContents()
      const fragment = document.createDocumentFragment()
      for (const [index, line] of text.split('\n').entries()) {
        if (index) fragment.append(document.createElement('br'))
        if (line) fragment.append(document.createTextNode(line))
      }
      const last = fragment.lastChild
      if (last) { range.insertNode(fragment); range.setStartAfter(last) }
      if (caret && current) { range.collapse(true); current.removeAllRanges(); current.addRange(range) }
    }
  }
}

function capturedField(event: MouseEvent): Field | undefined {
  const element = event.composedPath().find(node => node instanceof HTMLElement)
  if (!(element instanceof HTMLElement) || !editable(element)) return
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return textControl(element)
  let host = element
  while (host.parentElement?.isContentEditable) host = host.parentElement
  if (!editable(host)) return
  try { return plainContent(host) } catch { return }
}

function fieldContext(target: Target): FieldContext {
  const element = target.field.element
  const referenced = (attr: string) => (element.getAttribute(attr) ?? '').split(/\s+/).slice(0, 8)
    .map(id => document.getElementById(id)?.textContent?.trim().slice(0, 500) ?? '').filter(Boolean).join(' ')
  const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? Array.from(element.labels ?? []).slice(0, 4) : []
  const label = referenced('aria-labelledby') || element.getAttribute('aria-label') || labels.map(label => label.textContent?.trim().slice(0, 500)).join(' ')
  const nearbyText = [referenced('aria-describedby'), element.getAttribute('aria-description'),
    element.closest('fieldset')?.querySelector('legend')?.textContent?.trim().slice(0, 500)].filter(Boolean).join(' ')
  return { label: label.slice(0, 1000), placeholder: (element.getAttribute('placeholder') ?? element.getAttribute('aria-placeholder') ?? '').slice(0, 1000),
    type: target.field.type, currentValue: target.original.slice(0, 16000), nearbyText: nearbyText.slice(0, 2000), frameTitle: document.title.slice(0, 1000) }
}

export function installWebField(): void {
  let capture: { target?: Target; at: number } | undefined
  let offered: Target | undefined
  const active = new Map<string, Target>()
  let monitor: ReturnType<typeof setInterval> | undefined

  const valid = (target: Target) => {
    try { return editable(target.field.element) && target.field.read() === target.expected } catch { return false }
  }
  const release = (id: string) => {
    active.delete(id)
    if (!active.size) { clearInterval(monitor); monitor = undefined }
  }
  const invalidate = (id: string) => { release(id); ipcRenderer.send(FIELD_INVALID, id) }
  window.addEventListener('contextmenu', event => {
    if (!event.isTrusted) return
    const field = capturedField(event)
    capture = { at: performance.now() }
    offered = undefined
    if (!field || [...active.values()].some(target => target.field.element === field.element)) return
    const original = field.read()
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, '0')).join('')
    capture.target = { id, field, original, expected: original, generated: '' }
  }, { capture: true })
  window.addEventListener('beforeinput', event => {
    if (event.isTrusted) for (const target of active.values()) {
      if (event.composedPath().includes(target.field.element)) invalidate(target.id)
    }
  }, { capture: true })
  window.addEventListener('pagehide', () => {
    capture = undefined
    offered = undefined
    for (const id of active.keys()) invalidate(id)
  })

  ipcRenderer.on(FIELD_COMMAND, async (_event, { id, operation }: FieldCommand) => {
    const reply = (value: unknown) => ipcRenderer.send(FIELD_REPLY, id, value)
    if (operation.type === 'probe') {
      offered = capture && performance.now() - capture.at < 1500 ? capture.target : undefined
      capture = undefined
      reply(offered && valid(offered) ? offered.id : null)
      return
    }
    if (operation.type === 'begin') {
      const target = offered
      if (!target || target.id !== operation.target || !valid(target) || [...active.values()].some(other => other.field.element === target.field.element)) { reply(null); return }
      offered = undefined
      active.set(target.id, target)
      monitor ??= setInterval(() => {
        for (const target of active.values()) if (!valid(target)) invalidate(target.id)
      }, 250)
      reply(fieldContext(target))
      return
    }
    const target = active.get(operation.target)
    if (!target || !valid(target)) { release(operation.target); reply(false); return }
    if (operation.type === 'finish') { release(target.id); reply(true); return }
    const [start, end] = target.field.selection
    const rollback = operation.type === 'rollback'
    if (rollback && !target.generated) { reply(true); return }
    const from = rollback ? start : start + target.generated.length
    const to = target.generated ? start + target.generated.length : end
    const text = operation.type === 'append'
      ? operation.text.replace(target.field.multiline ? /\r\n?/g : /[\r\n]/g, target.field.multiline ? '\n' : '')
      : target.original.slice(start, end)
    if (!rollback && !text) { reply(true); return }
    const expected = target.expected.slice(0, from) + text + target.expected.slice(to)
    if (target.field.maxLength >= 0 && expected.length > target.field.maxLength) { release(target.id); reply(false); return }
    try {
      target.field.replace(from, to, text)
      target.expected = expected
      target.generated = rollback ? '' : target.generated + text
      target.field.element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: text }))
      await Promise.resolve()
      if (valid(target)) { reply(true); return }
    } catch { /* A page can invalidate its field while handling input. */ }
    release(target.id)
    reply(false)
  })
}
