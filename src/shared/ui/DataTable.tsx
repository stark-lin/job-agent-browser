import type { ReactNode } from 'react'

export interface TableColumn<T> { key: string; label: string; render: (row: T) => ReactNode }

export function DataTable<T>({ label, columns, rows, rowKey }: {
  label: string; columns: TableColumn<T>[]; rows: T[]; rowKey: (row: T) => string
}) {
  return <div className="ui-table-scroll" role="region" aria-label={label} tabIndex={0}>
    <table className="ui-data-table" aria-label={label}>
      <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key}>{column.render(row)}</td>)}</tr>)}</tbody>
    </table>
  </div>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'error'; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
}

export function DetailsList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="ui-details-list">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
}
