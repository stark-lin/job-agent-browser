/** Opaque-origin, scriptless document. Main also rejects all subframe navigations. */
export function DocumentPreview({ html, title }: { html: string; title: string }) {
  return <iframe className="ui-document-preview" title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={html} />
}
