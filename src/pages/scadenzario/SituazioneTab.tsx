// Tab "Situazione" dello Scadenzario: riepilogo da pagare/incassare, scaduto
// e KPI banche. Estratto da ScadenzarioSmart.tsx (spezzatura ondata 9) senza
// cambi funzionali: componente presentazionale, dati e navigazione via props.
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import { UiTooltip } from '../../components/Tooltip';
import { fmt } from './helpers';

export type SituazioneKpis = { totalToPay: number; totalOverdue: number; nextSevenDays: number }
export type PayableLite = {
  id?: string
  status?: string | null
  gross_amount?: number | null
  amount_remaining?: number | null
  suppliers?: { name?: string | null; ragione_sociale?: string | null } | null
  [k: string]: unknown
}

export function SituazioneTab({ kpis, displayPayables, cashPosition, onGoToScadenze }: {
  kpis: SituazioneKpis
  displayPayables: PayableLite[]
  cashPosition: number
  onGoToScadenze: () => void
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* DA PAGARE */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-baseline justify-between mb-1">
            <span className={`text-2xl font-bold ${kpis.totalToPay > 0 ? 'text-slate-800' : 'text-slate-400'}`}>{fmt(kpis.totalToPay)} €</span>
            <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Da pagare</span>
          </div>
          <p className="text-xs text-slate-400 mb-4">Prossime {displayPayables.filter(p => p.status !== 'pagato').length} scadenze</p>
          <div className="space-y-2">
            {displayPayables.filter(p => p.status !== 'pagato' && p.status !== 'annullato').slice(0, 3).map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <UiTooltip content={p.suppliers?.ragione_sociale || p.suppliers?.name || ''}><span className="text-slate-600 truncate max-w-[200px]">{p.suppliers?.ragione_sociale || p.suppliers?.name || '—'}</span></UiTooltip>
                <span className="font-medium text-slate-800">{fmt(p.amount_remaining || p.gross_amount)} €</span>
              </div>
            ))}
          </div>
          {displayPayables.filter(p => p.status !== 'pagato').length > 3 && (
            <button onClick={onGoToScadenze} className="mt-4 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
              Vedi tutte <ChevronRight size={12} />
            </button>
          )}
        </div>
        {/* DA INCASSARE — placeholder */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-2xl font-bold text-slate-400">0,00 €</span>
            <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Da incassare</span>
          </div>
          <p className="text-xs text-slate-400 mb-4">Nessuna scadenza in entrata</p>
          <div className="flex flex-col items-center justify-center py-6 text-slate-300">
            <CheckCircle2 size={32} className="mb-2" />
            <span className="text-xs">Nessuna scadenza prevista. Ottimo lavoro!</span>
          </div>
        </div>
      </div>
      {/* Pagamenti ed incassi scaduti */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Pagamenti ed incassi scaduti</h3>
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-2xl font-bold text-slate-800">{fmt(kpis.totalOverdue)} €</span>
              <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">Pagamenti scaduti</span>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-2xl font-bold text-slate-400">0,00 €</span>
              <span className="text-xs font-semibold text-blue-500 uppercase tracking-wide">Incassi scaduti</span>
            </div>
          </div>
        </div>
      </div>
      {/* KPI tesoreria */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Riepilogo banche</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 text-center">
          <div>
            <span className="text-xs text-slate-500 uppercase block">Saldo oggi</span>
            <span className={`text-lg font-bold ${cashPosition >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{fmt(cashPosition)} €</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 uppercase block">Da pagare</span>
            <span className="text-lg font-bold text-red-500">{fmt(kpis.totalToPay)} €</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 uppercase block">Scaduto</span>
            <span className="text-lg font-bold text-amber-600">{fmt(kpis.totalOverdue)} €</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 uppercase block">Prossimi 7gg</span>
            <span className="text-lg font-bold text-blue-600">{fmt(kpis.nextSevenDays)} €</span>
          </div>
          <div>
            <span className="text-xs text-slate-500 uppercase block">Saldo proiettato</span>
            <span className={`text-lg font-bold ${(cashPosition - kpis.totalToPay) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(cashPosition - kpis.totalToPay)} €</span>
          </div>
        </div>
      </div>
    </div>
  );
}
