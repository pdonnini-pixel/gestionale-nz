/**
 * SortableTh — header colonna ordinabile coerente in tutta l'app.
 *
 * Usage:
 *   <SortableTh sortKey="due_date" sortBy={sortBy} onSort={onSort}>Scadenza</SortableTh>
 *   <SortableTh sortKey="amount" sortBy={sortBy} onSort={onSort} align="right">Importo</SortableTh>
 *
 * Stato visivo:
 *   - non ordinata    → ↕ grigio chiaro
 *   - ordinata ASC    → ↑ blu, label blu
 *   - ordinata DESC   → ↓ blu, label blu
 *   - se sort multiplo: indice numerico accanto all'icona (1, 2, ...)
 */

import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

export function SortableTh({
  sortKey,
  children,
  sortBy = [],
  onSort,
  align = 'left',
  className = '',
}) {
  const idx = sortBy.findIndex(s => s.key === sortKey)
  const active = idx >= 0
  const dir = active ? sortBy[idx].dir : null
  const Icon = !active ? ArrowUpDown : (dir === 'asc' ? ArrowUp : ArrowDown)
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const hint = active
    ? `Ordinato ${dir === 'asc' ? 'crescente' : 'decrescente'}. Click per ${dir === 'asc' ? 'invertire' : 'rimuovere'}. Shift+Click per ordinamento multiplo.`
    : 'Click per ordinare. Shift+Click per ordinamento multiplo.'
  return (
    <th
      onClick={(e) => onSort?.(sortKey, e.shiftKey)}
      className={`px-3 py-2 ${alignClass} font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none transition hover:bg-slate-50 ${
        active ? 'text-blue-700' : 'text-slate-500'
      } ${className}`}
      title={hint}
    >
      <span className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span>{children}</span>
        <Icon size={12} className={active ? 'text-blue-600' : 'text-slate-300'} />
        {sortBy.length > 1 && active && (
          <span className="text-[9px] font-bold text-blue-600 leading-none">{idx + 1}</span>
        )}
      </span>
    </th>
  )
}

export default SortableTh
