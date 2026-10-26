import { createElement, useEffect, useState, type ReactNode } from 'react'
import { Button } from './Button'
interface Node {
  type: string
  value?: string
  depth?: number
  url?: string
  alt?: string
  identifier?: string
  ordered?: boolean
  start?: number
  lang?: string
  children?: Node[]
}
function safeLink(href: string) {
  try {
    const url = new URL(href)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}
function CodeBlock({
  text,
  language,
  copyLabel,
  copiedLabel
}: {
  text: string
  language: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="ui-code-block">
      <div className="ui-code-heading">
        <span>{language}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => setCopied(false))
          }}
        >
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
    </div>
  )
}
/** MDAST rendered as React text/elements. Raw HTML and image URLs are never executed or loaded. */
export function Markdown({
  text,
  copyLabel,
  copiedLabel,
  onOpenLink
}: {
  text: string
  copyLabel: string
  copiedLabel: string
  onOpenLink?: (path: string) => void
}) {
  const [ast, setAst] = useState<Node>({
    type: 'root',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }]
  })
  useEffect(() => {
    let live = true
    void Promise.all([import('unified'), import('remark-parse'), import('remark-gfm')]).then(
      ([{ unified }, { default: parse }, { default: gfm }]) => {
        if (live) setAst(unified().use(parse).use(gfm).parse(text) as Node)
      }
    )
    return () => {
      live = false
    }
  }, [text])
  const definitions = new Map<string, string>()
  for (const n of ast.children ?? [])
    if (n.type === 'definition' && n.identifier && n.url) definitions.set(n.identifier, n.url)
  const render = (n: Node, key: number): ReactNode => {
    const children = n.children?.map(render)
    switch (n.type) {
      case 'text':
      case 'html':
        return n.value
      case 'paragraph':
        return <p key={key}>{children}</p>
      case 'heading':
        return createElement(`h${Math.max(1, Math.min(6, n.depth ?? 1))}`, { key }, children)
      case 'strong':
        return <strong key={key}>{children}</strong>
      case 'emphasis':
        return <em key={key}>{children}</em>
      case 'delete':
        return <del key={key}>{children}</del>
      case 'inlineCode':
        return <code key={key}>{n.value}</code>
      case 'code':
        return (
          <CodeBlock
            key={key}
            text={n.value ?? ''}
            language={n.lang ?? ''}
            copyLabel={copyLabel}
            copiedLabel={copiedLabel}
          />
        )
      case 'blockquote':
        return <blockquote key={key}>{children}</blockquote>
      case 'list':
        return n.ordered ? (
          <ol key={key} start={n.start}>
            {children}
          </ol>
        ) : (
          <ul key={key}>{children}</ul>
        )
      case 'listItem':
        return <li key={key}>{children}</li>
      case 'thematicBreak':
        return <hr key={key} />
      case 'break':
        return <br key={key} />
      case 'link':
      case 'linkReference': {
        const url = n.url ?? definitions.get(n.identifier ?? '') ?? '',
          href = safeLink(url)
        if (href)
          return (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          )
        if (onOpenLink && !/^[a-z][\w+.-]*:|^\/\/|^\//i.test(url))
          return (
            <Button key={key} variant="ghost" size="sm" onClick={() => onOpenLink(url)}>
              {children}
            </Button>
          )
        return <span key={key}>{children}</span>
      }
      case 'image':
      case 'imageReference':
        return <span key={key}>{n.alt ?? ''}</span>
      case 'table':
        return (
          <div key={key} className="ui-markdown-table" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {n.children?.[0]?.children?.map((c, i) => (
                    <th key={i}>{c.children?.map(render)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {n.children?.slice(1).map((r, i) => (
                  <tr key={i}>
                    {r.children?.map((c, j) => (
                      <td key={j}>{c.children?.map(render)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'definition':
        return null
      default:
        return <span key={key}>{children ?? n.value}</span>
    }
  }
  return <div className="ui-markdown">{ast.children?.map(render)}</div>
}
