/**
 * StatKpi — card KPI compatta condivisa (icona in chip colorato + valore +
 * etichetta + sottotitolo). Nata dall'unificazione delle copie locali identiche
 * di MarginiCategoria, Fornitori e Fatturazione (audit M18/KpiCard duplicata):
 * un solo punto da mantenere, stesse classi delle versioni locali.
 *
 * NON sostituisce ui/KpiCard (layout con trend/onClick) ne' le KPI
 * specializzate (Dashboard con link/alert, Dipendenti con 'source', ecc.).
 */
import React from 'react'
import Tooltip from '../Tooltip'

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600',
  green: 'bg-emerald-50 text-emerald-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  purple: 'bg-purple-50 text-purple-600',
  slate: 'bg-slate-50 text-slate-600',
}

// Taglie ereditate dalle vecchie copie locali: sm=MarginiCategoria,
// md=Fornitori, lg=Fatturazione — cosi' la migrazione non cambia l'aspetto.
const SIZES = {
  sm: { icon: 18, value: 'text-lg' },
  md: { icon: 20, value: 'text-xl' },
  lg: { icon: 20, value: 'text-2xl' },
} as const

interface StatKpiProps {
  icon: React.ComponentType<{ size?: number }>
  label: string
  value: string | number
  sub?: string
  color?: string
  size?: keyof typeof SIZES
}

export default function StatKpi({ icon: Icon, label, value, sub, color = 'indigo', size = 'md' }: StatKpiProps) {
  const cls = COLOR_MAP[color] || COLOR_MAP.indigo
  const sz = SIZES[size]
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${cls}`}><Icon size={sz.icon} /></div>
        <div className="min-w-0">
          <Tooltip content={value == null || value === '' ? '' : String(value)}>
            <div className={`${sz.value} font-bold text-slate-900 truncate`}>{value}</div>
          </Tooltip>
          <div className="text-xs text-slate-500">{label}</div>
          {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
        </div>
      </div>
    </div>
  )
}
