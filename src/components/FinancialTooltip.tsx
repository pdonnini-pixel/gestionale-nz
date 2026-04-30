import React, { useState, useRef, useEffect } from 'react'
import { HelpCircle } from 'lucide-react'

interface GlossaryEntry {
  term: string
  def: string
}

const GLOSSARY: Record<string, GlossaryEntry> = {
  pfn: { term: 'PFN', def: 'Posizione Finanziaria Netta — differenza tra liquidità attiva e debiti finanziari. Se negativa, l\'azienda ha più debiti che cassa.' },
  ebitda: { term: 'EBITDA', def: 'Utile prima di interessi, tasse, ammortamenti e svalutazioni. Indica la redditività operativa pura dell\'azienda.' },
  margine: { term: 'Margine', def: 'Differenza tra ricavi e costi. Il margine lordo esclude costi fissi, il margine netto li include tutti.' },
  breakeven: { term: 'Break-even', def: 'Punto di pareggio — il livello di fatturato in cui ricavi e costi totali si equivalgono. Sotto il break-even si è in perdita.' },
  riconciliazione: { term: 'Riconciliazione', def: 'Processo di verifica che i movimenti bancari corrispondano alle fatture registrate. Garantisce l\'accuratezza contabile.' },
  sdi: { term: 'SDI', def: 'Sistema di Interscambio — il sistema dell\'Agenzia delle Entrate per trasmettere e ricevere fatture elettroniche in formato XML.' },
  riba: { term: 'Ri.Ba.', def: 'Ricevuta Bancaria — strumento di pagamento dove il creditore emette un ordine di incasso tramite la banca del debitore.' },
  sdd: { term: 'SDD', def: 'SEPA Direct Debit — addebito diretto sul conto del debitore, autorizzato tramite mandato. Usato per pagamenti ricorrenti.' },
  ral: { term: 'RAL', def: 'Retribuzione Annua Lorda — il compenso totale annuo di un dipendente prima di tasse e contributi.' },
  tfr: { term: 'TFR', def: 'Trattamento di Fine Rapporto — l\'indennità accantonata mensilmente dal datore di lavoro, liquidata alla fine del rapporto.' },
  corrispettivi: { term: 'Corrispettivi', def: 'Incassi giornalieri registrati dal registratore di cassa e trasmessi telematicamente all\'Agenzia delle Entrate.' },
  consuntivo: { term: 'Consuntivo', def: 'Dati effettivi (reali) di un periodo, contrapposti al preventivo (budget). "Consuntivo 2025" = cosa è successo davvero nel 2025.' },
  scostamento: { term: 'Scostamento', def: 'Differenza tra budget previsto e consuntivo reale. Positivo = si è speso meno del previsto, negativo = si è sforato.' },
  f24: { term: 'F24', def: 'Modello di pagamento unificato per imposte, contributi e tributi verso lo Stato. Scadenze tipiche: 16 del mese, fine trimestre.' },
  iva: { term: 'IVA', def: 'Imposta sul Valore Aggiunto — imposta indiretta sui consumi. L\'azienda la incassa sulle vendite e la versa all\'erario, detraendo quella pagata sugli acquisti.' },
  open_banking: { term: 'Open Banking', def: 'Sistema regolamentato (PSD2) che permette di accedere ai dati bancari tramite API, con il consenso del titolare del conto.' },
}

interface FinancialTooltipProps {
  term: string
  children?: React.ReactNode
  size?: number
}

export default function FinancialTooltip({ term, children, size = 13 }: FinancialTooltipProps) {
  const [show, setShow] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const entry = GLOSSARY[term]

  useEffect(() => {
    if (!show) return
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [show])

  if (!entry) return <>{children}</> || null

  return (
    <span className="relative inline-flex items-center gap-1" ref={ref}>
      {children}
      <button
        onClick={(e) => { e.stopPropagation(); setShow(!show) }}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="text-slate-300 hover:text-slate-500 transition inline-flex"
        aria-label={`Info: ${entry.term}`}
      >
        <HelpCircle size={size} />
      </button>
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-slate-800 text-white text-xs leading-relaxed rounded-lg shadow-xl z-50 pointer-events-none">
          <strong className="text-amber-300">{entry.term}</strong>
          <span className="block mt-1 text-slate-200">{entry.def}</span>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 bg-slate-800 rotate-45" />
        </div>
      )}
    </span>
  )
}

// Export glossary for use in other components
export { GLOSSARY }
