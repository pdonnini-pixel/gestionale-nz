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

import React from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

interface SortEntry {
  key: string
  dir: 'asc' | 'desc'
}

interface SortableThProps {
  sortKey: string
  children: React.ReactNode
  sortBy?: SortEntry[]
  onSort?: (key: string, shiftKey: boolean) => void
  align?: 'left' | 'center' | 'right'
  className?: string
}

export function SortableTh({
  sortKey,
  children,
  sortBy = [],
  onSort,
  align = 'left',
  className = '',
}: SortableThProps) {
  const idx = sortBy.findIndex(s => s.key === sortKey)
  const active = idx >= 0
  const dir = active ? sortBy[idx].dir : null
  const Icon = !active ? ArrowUpDown : (dir === 'asc' ? ArrowUp : ArrowDown)
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  const hint = active
    ? `Ordinato ${dir === 'asc' ? 'crescente' : 'decrescente'}. Click per ${dir === 'asc' ? 'invertire' : 'rimuovere'}. Shift+Click per ordinamento multiplo.`
    : 'Click per ordinare. Shift+Click per ordinamento multiplo.'
  // Con flex-row-reverse (colonne a destra) justify-start allinea al bordo destro
  const justify = align === 'center' ? 'justify-center' : 'justify-start'
  return (
    // Il controllo interattivo e' un vero <button> dentro il th (audit M18):
    // Enter/Space e focus arrivano gratis dal browser, e gli screen reader
    // annunciano un pulsante con etichetta, non una cella anonima.
    // aria-sort resta sul th, dove ha valore semantico.
    <th
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`p-0 ${alignClass} ${className}`}
    >
      <button
        type="button"
        onClick={(e) => onSort?.(sortKey, e.shiftKey)}
        title={hint}
        aria-label={`Ordina per ${typeof children === 'string' ? children : sortKey}${active ? ` (${dir === 'asc' ? 'crescente' : 'decrescente'})` : ''}`}
        className={`w-full px-3 py-2 font-semibold text-[11px] uppercase tracking-wider cursor-pointer select-none transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${
          active ? 'text-blue-700' : 'text-slate-500'
        }`}
      >
        <span className={`flex items-center gap-1.5 ${justify} ${align === 'right' ? 'flex-row-reverse' : ''}`}>
          <span>{children}</span>
          <Icon size={12} className={active ? 'text-blue-600' : 'text-slate-300'} />
          {sortBy.length > 1 && active && (
            <span className="text-[10px] font-bold text-blue-600 leading-none">{idx + 1}</span>
          )}
        </span>
      </button>
    </th>
  )
}

export default SortableTh
