// PageHeader — header standard per tutte le pagine route-level.
// Allinea visivamente le 27 pagine alla "sensazione" del pattern Banche:
// titolo compatto (text-2xl), sottotitolo neutro, azioni a destra, divider sotto.
//
// Uso:
//   <PageHeader
//     title="Gestione Dipendenti"
//     subtitle="Costi personale per outlet"
//     actions={<button>...</button>}
//   />

import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Disattiva il border-b sotto l'header (es. se la pagina ha già tab che fanno separatore) */
  noDivider?: boolean
}

export default function PageHeader({ title, subtitle, actions, noDivider = false }: PageHeaderProps) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 pb-4 ${noDivider ? '' : 'border-b border-slate-200 mb-6'}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900 leading-tight">{title}</h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  )
}
