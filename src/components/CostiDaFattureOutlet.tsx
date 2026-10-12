/**
 * Riquadro «Costi da fatture (riparto automatico)» di Confronto Outlet.
 *
 * Legge la vista v_costi_outlet_da_fatture (migrazione 285): fatture passive
 * ripartite sugli outlet con le regole dei fornitori, calcolate dal database.
 * Sola lettura: non scrive niente e non tocca il consuntivo inserito in
 * Budget & Controllo, che resta l'unico consuntivo delle schede qui sotto.
 */
import { useEffect, useMemo, useState } from 'react'
import { FileText, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatOutletName } from '../lib/formatters'
import { aggregaCostiDaFatture, type CostiOutlet, type RigaCostiDaFatture } from '../lib/costiDaFatture'

type Props = {
  companyId: string
  year: number
  /** Mesi del periodo scelto; null = tutto l'anno */
  months: number[] | null
  periodLabel: string
  /** cost_center_key della sede (ruolo 'hq'), mostrata in fondo */
  sedeKeys: Set<string>
}

function euro(n: number): string {
  return Math.round(n).toLocaleString('it-IT')
}

function Cella({ v, forte }: { v: number; forte?: boolean }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${forte ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
      {v === 0 ? <span className="text-slate-300">–</span> : euro(v)}
    </td>
  )
}

function Riga({ o, totale }: { o: CostiOutlet; totale?: boolean }) {
  return (
    <tr className={totale ? 'bg-slate-50 border-t-2 border-slate-200' : 'border-t border-slate-100'}>
      <td className={`px-3 py-2 whitespace-nowrap ${totale ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>
        {totale || o.key === '__non_assegnato__' ? o.nome : formatOutletName(o.nome)}
        {o.isSede && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">sede</span>}
      </td>
      <Cella v={o.merce} />
      <Cella v={o.affitti} />
      <Cella v={o.struttura} />
      <Cella v={o.altro} />
      <Cella v={o.senzaCategoria} />
      <Cella v={o.correnti} forte />
      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-violet-700 border-l border-slate-100">
        {o.allestimenti === 0 ? <span className="text-slate-300">–</span> : euro(o.allestimenti)}
      </td>
    </tr>
  )
}

export default function CostiDaFattureOutlet({ companyId, year, months, periodLabel, sedeKeys }: Props) {
  const [righe, setRighe] = useState<RigaCostiDaFatture[]>([])
  const [caricamento, setCaricamento] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCaricamento(true)
    setErrore(null)
    void (async () => {
      const { data, error } = await supabase
        .from('v_costi_outlet_da_fatture')
        .select('outlet_id, outlet, cost_center_key, mese, gruppo, importo')
        .eq('company_id', companyId)
        .eq('anno', year)
        .range(0, 9999)
      if (!vivo) return
      if (error) setErrore(error.message)
      setRighe((data as RigaCostiDaFatture[]) ?? [])
      setCaricamento(false)
    })()
    return () => { vivo = false }
  }, [companyId, year])

  const riepilogo = useMemo(() => aggregaCostiDaFatture(righe, months, sedeKeys), [righe, months, sedeKeys])
  const vuota = riepilogo.outlet.length === 0 && !riepilogo.nonAssegnato

  return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
        <FileText size={16} className="text-violet-600" />
        Costi da fatture (riparto automatico): {year}, {periodLabel}
      </h3>
      <p className="text-xs text-slate-500 mt-1 mb-4">
        Fatture dei fornitori divise sugli outlet con le regole di riparto (pagina Fornitori). È un riferimento
        in sola lettura: non cambia il consuntivo di Budget &amp; Controllo né le schede qui sotto.
      </p>

      {caricamento ? (
        <div className="text-sm text-slate-400 py-6 text-center">Caricamento…</div>
      ) : errore ? (
        <div className="text-sm text-red-600 flex items-center gap-2"><AlertCircle size={14} /> Impossibile leggere i costi da fatture: {errore}</div>
      ) : vuota ? (
        <div className="text-sm text-slate-500 py-6 text-center">Nessuna fattura fornitore nel periodo scelto.</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Outlet</th>
                <th className="px-3 py-2 text-right font-medium">Merce</th>
                <th className="px-3 py-2 text-right font-medium">Affitti</th>
                <th className="px-3 py-2 text-right font-medium">Struttura</th>
                <th className="px-3 py-2 text-right font-medium">Altri costi</th>
                <th className="px-3 py-2 text-right font-medium">Senza categoria</th>
                <th className="px-3 py-2 text-right font-semibold text-slate-700">Totale costi</th>
                <th className="px-3 py-2 text-right font-medium text-violet-700 border-l border-slate-100">Allestimenti (a parte)</th>
              </tr>
            </thead>
            <tbody>
              {riepilogo.outlet.map(o => <Riga key={o.key} o={o} />)}
              {riepilogo.nonAssegnato && <Riga o={riepilogo.nonAssegnato} />}
              <Riga o={riepilogo.totale} totale />
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-500 mt-4 space-y-1">
        <p>
          <span className="font-medium text-slate-600">Cosa c'è:</span> fatture elettroniche dei fornitori per data
          fattura, importi senza IVA, note di credito in meno. Merce, mezzi e carburante divisi come il preventivo
          acquisti; costi di struttura divisi in proporzione ai ricavi; affitti, bollette e trasferte sull'outlet a cui si riferiscono.
        </p>
        <p>
          <span className="font-medium text-slate-600">Cosa non c'è:</span> stipendi, F24, commissioni bancarie e tutto ciò
          che non arriva come fattura; caparre e depositi a garanzia; autofatture di integrazione IVA. Per questo il totale
          non coincide con il conto economico.
        </p>
        <p>
          <span className="font-medium text-violet-700">Allestimenti:</span> arredi, insegne, impianti, lavori e progettazione per aprire
          un negozio o ristrutturare la sede e il magazzino. Sono un investimento e restano fuori dal totale dei costi.
        </p>
      </div>
    </div>
  )
}
