import { Fragment, useState, type ReactNode } from 'react'
import { Button } from './Button'

function safeLink(href: string) {
  try { const url = new URL(href); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part), href = link && safeLink(link[2])
    return link && href ? <a key={i} href={href} target="_blank" rel="noopener noreferrer">{link[1]}</a> : part
  })
}
function CodeBlock({ text, language, copyLabel, copiedLabel }: { text: string; language: string; copyLabel: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="ui-code-block"><div className="ui-code-heading"><span>{language}</span><Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false)) }}>{copied ? copiedLabel : copyLabel}</Button></div><pre tabIndex={0}><code>{text}</code></pre></div>
}
/** Conservative Markdown subset. HTML is always text; links accept credential-free HTTP(S) only. */
export function Markdown({ text, copyLabel, copiedLabel }: { text: string; copyLabel: string; copiedLabel: string }) {
  const lines = text.split('\n'), blocks: ReactNode[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(), code: string[] = []; i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      if (i < lines.length) i++
      blocks.push(<CodeBlock key={blocks.length} text={code.join('\n')} language={language} copyLabel={copyLabel} copiedLabel={copiedLabel} />); continue
    }
    if (!line.trim()) { i++; continue }
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading) { blocks.push(<h3 key={blocks.length}>{inline(heading[1])}</h3>); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const cells = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
      const header = cells(line), rows: string[][] = []; i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      blocks.push(<div key={blocks.length} className="ui-markdown-table" tabIndex={0}><table><thead><tr>{header.map((c, n) => <th key={n}>{inline(c)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{header.map((_, c) => <td key={c}>{inline(row[c] ?? '')}</td>)}</tr>)}</tbody></table></div>); continue
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line), pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, items: ReactNode[] = []
      while (i < lines.length && pattern.test(lines[i])) items.push(<li key={items.length}>{inline(lines[i++].replace(pattern, ''))}</li>)
      blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>); continue
    }
    if (line.startsWith('> ')) { blocks.push(<blockquote key={blocks.length}>{inline(line.slice(2))}</blockquote>); i++; continue }
    const paragraph: string[] = [line]; i++
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,6} |[-*+] |\d+\. |> )/.test(lines[i]) && !(lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? ''))) paragraph.push(lines[i++])
    blocks.push(<p key={blocks.length}>{paragraph.map((value, n) => <Fragment key={n}>{n > 0 && <br />}{inline(value)}</Fragment>)}</p>)
  }
  return <div className="ui-markdown">{blocks}</div>
}
