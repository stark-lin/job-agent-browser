import { createElement, useEffect, useState, type ReactNode } from 'react'
import { Button, CodeBlock, Link, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '@astryxdesign/core'
import { parseHttpUrl } from '../../shared/http-url'
import { useTranslation } from 'react-i18next'
import { useCopyFeedback } from '../../shared/use-copy-feedback'

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
/** MDAST rendered as React text/elements. Raw HTML and image URLs are never executed or loaded. */
export function UntrustedProse({
  text,
  onOpenLink
}: {
  text: string
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
          <MarkdownFence key={key} code={n.value ?? ''} language={n.lang ?? undefined} />
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
          href = parseHttpUrl(url)?.href
        if (href)
          return (
            <Link key={key} href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </Link>
          )
        if (onOpenLink && url && !/^(?:[a-z][\w+.-]*:|[\/\\])/i.test(url.trim()))
          return (
            <Link key={key} onClick={() => onOpenLink(url)}>{children}</Link>
          )
        return <span key={key}>{children}</span>
      }
      case 'image':
      case 'imageReference':
        return <span key={key}>{n.alt ?? ''}</span>
      case 'table':
        return (
          <div key={key} className="untrusted-prose-table" tabIndex={0}>
            <Table density="compact">
              <TableHeader>
                <TableRow isHeaderRow>
                  {n.children?.[0]?.children?.map((c, i) => (
                    <TableHeaderCell key={i}>{c.children?.map(render)}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {n.children?.slice(1).map((r, i) => (
                  <TableRow key={i}>
                    {r.children?.map((c, j) => (
                      <TableCell key={j}>{c.children?.map(render)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      case 'definition':
        return null
      default:
        return <span key={key}>{children ?? n.value}</span>
    }
  }
  return <div className="untrusted-prose">{ast.children?.map(render)}</div>
}

function MarkdownFence({ code, language }: { code: string; language?: string }) {
  const { t } = useTranslation()
  const clipboard = useCopyFeedback(code)
  return <CodeBlock code={code} language={language} hasLanguageLabel={Boolean(language)} width="100%" hasCopyButton={false}
    endContent={<Button size="sm" variant="ghost" isDisabled={clipboard.copying || clipboard.copied} aria-live="polite" aria-busy={clipboard.copying}
      label={t($ => clipboard.copied ? $.ask.copied : $.ask.copy)}
      onClick={() => void clipboard.copy(async () => { await navigator.clipboard.writeText(code); return true })} />} />
}
