import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
export function MarkdownEditor({
  value,
  onChange,
  onSave,
  label
}: {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  label: string
}) {
  const element = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    updating = useRef(false),
    callbacks = useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }
  useEffect(() => {
    if (!element.current) return
    const editor = new EditorView({
      parent: element.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          keymap.of([
            {
              key: 'Mod-s',
              run: () => {
                callbacks.current.onSave()
                return true
              }
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !updating.current) callbacks.current.onChange(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'var(--surface)', color: 'var(--text)' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, monospace' },
            '.cm-content': { caretColor: 'var(--text)', padding: 'var(--space-2)' },
            '.cm-gutters': { backgroundColor: 'var(--panel-solid)', color: 'var(--muted)', borderColor: 'var(--line)' },
            '.cm-activeLine': { backgroundColor: 'var(--primary-soft)' },
            '.cm-activeLineGutter': { backgroundColor: 'var(--primary-soft)' },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--primary-line)' },
            '.cm-cursor': { borderLeftColor: 'var(--text)' },
            '.cm-searchMatch': { backgroundColor: 'var(--warning-bg)' },
            '.cm-panels': { backgroundColor: 'var(--panel-solid)', color: 'var(--text)' }
          })
        ]
      })
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // A workspace remounts the editor on file changes, preserving history within the current file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      updating.current = true
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
      updating.current = false
    }
  }, [value])
  return <div className="ui-markdown-editor" ref={element} />
}
