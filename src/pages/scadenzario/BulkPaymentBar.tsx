// Barra flottante dei pagamenti multipli: saldi progressivi per banca,
// totale selezionato e CTA "Crea distinta". Estratta da ScadenzarioSmart.tsx
// (spezzatura ondata 9) senza cambi funzionali: stato e azioni via props.
//
// SALDO PREVISIONALE = AVVISO, NON BLOCCO.
// Il saldo di partenza mostrato è il previsionale (reale − residuo delle distinte
// già disposte e non ancora uscite dal conto). Quei soldi sono davvero impegnati,
// quindi sforare il previsionale è una scelta che va vista e confermata; non è
// però vietata, perché la disponibilità vera resta il saldo REALE e a volte si
// decide di pagare altro. Stessa logica oltre il saldo reale (fidi, incassi in
// arrivo), con un avviso più forte. Le conferme le chiede ScadenzarioSmart.
// L'unico blocco duro rimasto è una fattura senza banca assegnata.
import { Landmark, ChevronRight, AlertTriangle, Wallet } from 'lucide-react';
import { fmt } from './helpers';

export type BankAccountLite = {
  id?: string
  bank_name?: string | null
  current_balance?: number | null
  [k: string]: unknown
}

export function BulkPaymentBar({
  selectedCount, selectedTotal, bankSpending, bankBalances, bankBaseBalances, bankRealBalances, bankCommitted, bankAccounts,
  overCommittedCount, overRealCount, missingBankCount, isSaving, onClear, onConfirm,
}: {
  selectedCount: number
  selectedTotal: number
  /** id banca -> importo in uscita stimato per la selezione corrente */
  bankSpending: Record<string, number>
  /** id banca -> residuo stimato sul previsionale (previsionale di partenza - spesa selezionata) */
  bankBalances: Record<string, number>
  /** id banca -> saldo previsionale di partenza (reale - distinte già disposte non pagate) */
  bankBaseBalances?: Record<string, number>
  /** id banca -> residuo sul saldo REALE (reale - spesa selezionata): la disponibilità vera */
  bankRealBalances?: Record<string, number>
  /** id banca -> soldi già impegnati in distinte precedenti ancora da pagare */
  bankCommitted?: Record<string, number>
  bankAccounts: BankAccountLite[]
  /** banche in cui si sfora il previsionale ma NON il saldo reale: avviso, nessun blocco */
  overCommittedCount: number
  /** banche in cui si sfora anche il saldo reale: avviso forte + conferma esplicita */
  overRealCount: number
  missingBankCount: number
  isSaving: boolean
  onClear: () => void
  onConfirm: () => void
}) {
  if (selectedCount <= 0) return null;
  return (
    // bottom-20 su mobile: sta sopra la bottom nav (h-14) e il
    // pulsante ? dell'aiuto, che altrimenti coprirebbe.
    <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,880px)]">
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg px-6 py-4">
        {/* Saldi progressivi per banca — SEMPRE visibili mentre si spuntano le fatture,
            così si tiene d'occhio quanto resta su ogni conto (saldo attuale → residuo stimato). */}
        {Object.keys(bankSpending).length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-3 pb-3 border-b border-slate-100">
            {Object.keys(bankSpending).map(bid => {
              const ba = bankAccounts.find(b => String(b.id) === String(bid));
              if (!ba) return null;
              const saldoReale = Number(ba.current_balance) || 0;
              // Partenza = previsionale (reale − distinte già disposte non pagate); se non
              // disponibile, si ricade sul saldo reale pieno.
              const saldo0 = bankBaseBalances?.[bid] ?? saldoReale;
              const hasCommitted = saldo0 < saldoReale;
              const residuoStimato = bankBalances[bid] ?? saldo0;
              const residuoReale = bankRealBalances?.[bid] ?? (saldoReale - (bankSpending[bid] || 0));
              // Rosso solo quando si va oltre i soldi VERI sul conto. Sotto il solo
              // previsionale il colore è ambra: stai intaccando quanto avevi già
              // messo in distinta, non la disponibilità reale.
              const overReal = residuoReale < 0;
              const overCommitted = !overReal && residuoStimato < 0;
              const colore = overReal ? 'font-bold text-red-600' : overCommitted ? 'font-bold text-amber-600' : 'font-semibold text-emerald-600';
              return (
                <div key={bid} className="flex items-center gap-1.5 text-xs">
                  <Landmark size={13} className="text-slate-400" />
                  <span className="font-medium text-slate-700">{ba.bank_name}</span>
                  <span
                    className="text-slate-400"
                    title={hasCommitted ? `Saldo previsionale (reale ${fmt(saldoReale)} € − distinte già disposte)` : 'Saldo attuale'}
                  >
                    {fmt(saldo0)} €{hasCommitted ? ' prev.' : ''}
                  </span>
                  <ChevronRight size={12} className="text-slate-300" />
                  <span
                    className={colore}
                    title={overCommitted
                      ? `Sotto il previsionale, ma sul conto restano ${fmt(residuoReale)} € reali: puoi procedere.`
                      : `Residuo sul saldo reale: ${fmt(residuoReale)} €`}
                  >
                    {fmt(residuoStimato)} €
                  </span>
                  <span className="text-slate-400">(−{fmt(bankSpending[bid] || 0)})</span>
                  {overCommitted && (
                    <span
                      className="text-amber-600 font-medium"
                      title={`${fmt(bankCommitted?.[bid] || 0)} € sono già destinati a distinte precedenti (Storico Distinte)`}
                    >
                      intacchi {fmt(Math.abs(residuoStimato))} € già in distinta · reale {fmt(residuoReale)} €
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-between gap-8">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-900">{selectedCount} fattura{selectedCount !== 1 ? 'e' : ''}</span>
            <span className="text-lg font-bold">{fmt(selectedTotal)} €</span>
            {overRealCount > 0 && <span className="text-sm font-medium text-red-600">Oltre il saldo reale</span>}
            {overRealCount === 0 && overCommittedCount > 0 && (
              <span className="text-sm font-medium text-amber-600">Stai usando soldi già in distinta</span>
            )}
            {missingBankCount > 0 && (
              <span className="text-sm font-medium text-amber-600">
                {missingBankCount === 1 ? '1 fattura senza banca' : `${missingBankCount} fatture senza banca`}
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClear}
              className="px-4 py-2 text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium">
              Annulla
            </button>
            {overRealCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-medium">
                <AlertTriangle size={14} /> Superi il saldo reale su {overRealCount === 1 ? 'una banca' : `${overRealCount} banche`}: ti sarà chiesta conferma
              </div>
            )}
            {overRealCount === 0 && overCommittedCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
                <AlertTriangle size={14} /> Soldi già destinati a distinte precedenti: ti sarà chiesta conferma
              </div>
            )}
            {missingBankCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
                <AlertTriangle size={14} /> Assegna una banca a ogni fattura selezionata
              </div>
            )}
            <button onClick={onConfirm} disabled={isSaving || missingBankCount > 0}
              className="px-6 py-2 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              title={missingBankCount > 0
                ? 'Assegna una banca a ogni fattura selezionata per abilitare la creazione della distinta.'
                : "Genera l'email-distinta di pagamento. La fattura resterà aperta finché il movimento bancario non verrà importato e riconciliato."}>
              {isSaving ? 'Elaborazione...' : 'Crea distinta'}
            </button>
            <button disabled
              className="px-6 py-2 bg-slate-200 text-slate-400 rounded-lg text-sm font-bold cursor-not-allowed flex items-center gap-1.5"
              title="In arrivo: bonifico SEPA diretto dal gestionale via A-Cube PSD2">
              <Wallet size={14} />
              Paga via A-Cube — Prossima feature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
