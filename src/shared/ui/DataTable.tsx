import type { ReactNode } from 'react'

export interface TableColumn<T> { key: string; label: string; render: (row: T) => ReactNode }

export function DataTable<T>({ label, columns, rows, rowKey, rowAction }: {
  label: string; columns: TableColumn<T>[]; rows: T[]; rowKey: (row: T) => string
  rowAction?: { label: (row: T) => string; open: (row: T) => void }
}) {
  return <div className="ui-table-scroll" role="region" aria-label={label} tabIndex={0}>
    <table className="ui-data-table" aria-label={label}>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col"><span className="ui-table-cell">{column.label}</span></th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={rowKey(row)} className={rowAction ? 'ui-table-row-action' : undefined}
        onClick={rowAction ? event => {
          event.currentTarget.querySelector<HTMLButtonElement>('.ui-table-row-trigger')?.focus({ preventScroll: true })
          rowAction.open(row)
        } : undefined}>
        {columns.map((column, index) => {
          const content = column.render(row)
          const firstLine = typeof content === 'string' ? content.split(/\r\n?|\n/, 1)[0] : content
          const cell = <span className="ui-table-cell">{firstLine}</span>
          return <td key={column.key}>{index === 0 && rowAction
            ? <button type="button" className="ui-table-row-trigger" aria-label={rowAction.label(row)} aria-haspopup="dialog">{cell}</button>
            : cell}</td>
        })}
      </tr>)}</tbody>
    </table>
  </div>
}

export function Badge({ tone = 'neutral', appearance = 'filled', children }: {
  tone?: 'neutral' | 'success' | 'error'; appearance?: 'filled' | 'text'; children: ReactNode
}) {
  const base = appearance === 'text' ? 'ui-badge-text' : 'ui-badge'
  return <span className={`${base} ${base}--${tone}`}>{children}</span>
}

export function DetailsList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="ui-details-list">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
}
