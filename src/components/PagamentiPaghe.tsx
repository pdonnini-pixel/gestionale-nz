// Riquadro «Pagamenti in banca» del mese (Dipendenti → Costi & cedolini).
//
// Legge quello che il motore paghe (migration 268, fn_payroll_sync) ha trovato:
//  - quali buste del mese sono state pagate e da quali disposizioni di
//    emolumenti (payroll_payment_links);
//  - l'F24 del personale atteso dal Prospetto e le deleghe trovate in banca
//    intorno al 16 del mese dopo (payroll_f24_checks).
// Non scrive niente, salvo il bottone «Ricontrolla ora» che rilancia il motore.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Landmark, RefreshCw, Check, AlertTriangle, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const eur = (n: number) => `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`
const gg = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

type Link = { slip_id: string; bank_transaction_id: string; netto: number; commissioni: number | null; id_flusso: string | null }
type Slip = { id: string; employee_id: string | null; netto: number | null; tipo: string | null }
type Bt = { id: string; transaction_date: string; amount: number }
type Check = { periodo: string; scadenza: string; atteso: number; pagato: number | null; esito: string; bank_transaction_ids: string[] }

export default function PagamentiPaghe({ companyId, year, month, nomeDi }: {
  companyId: string
  year: number
  month: number
  nomeDi: (employeeId: string | null) => string
}) {
  const [links, setLinks] = useState<Link[]>([])
  const [slips, setSlips] = useState<Slip[]>([])
  const [bts, setBts] = useState<Bt[]>([])
  const [check, setCheck] = useState<Check | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const periodo = `${year}-${String(month).padStart(2, '0')}-01`

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const [l, s, c] = await Promise.all([
      supabase.from('payroll_payment_links').select('slip_id, bank_transaction_id, netto, commissioni, id_flusso')
        .eq('company_id', companyId).eq('year', year).eq('month', month),
      supabase.from('employee_cost_slips').select('id, employee_id, netto, tipo')
        .eq('company_id', companyId).eq('year', year).eq('month', month).gt('netto', 0),
      supabase.from('payroll_f24_checks').select('periodo, scadenza, atteso, pagato, esito, bank_transaction_ids')
        .eq('company_id', companyId).eq('periodo', periodo).maybeSingle(),
    ])
    const ls = (l.data ?? []) as Link[]
    setLinks(ls)
    setSlips((s.data ?? []) as Slip[])
    setCheck((c.data ?? null) as Check | null)
    const ids = [...new Set(ls.map((x) => x.bank_transaction_id))]
    if (ids.length) {
      const { data } = await supabase.from('bank_transactions').select('id, transaction_date, amount').in('id', ids)
      setBts((data ?? []) as Bt[])
    } else setBts([])
    setLoading(false)
  }, [companyId, year, month, periodo])

  useEffect(() => { void load() }, [load])

  const ricontrolla = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('payroll_sync_now')
    if (error) console.error('[PagamentiPaghe] ricontrollo non riuscito', error)
    await load()
    setBusy(false)
  }

  const r = useMemo(() => {
    const pagate = new Set(links.map((l) => l.slip_id))
    const scoperte = slips.filter((s) => !pagate.has(s.id))
    const nettiPagati = links.reduce((a, l) => a + Number(l.netto), 0)
    const addebitato = bts.reduce((a, b) => a - Number(b.amount), 0)
    const date = [...new Set(bts.map((b) => b.transaction_date))].sort()
    return { scoperte, nettiPagati, addebitato, commissioni: addebitato - nettiPagati, date, nDisp: bts.length }
  }, [links, slips, bts])

  const mese = `${MESI[month - 1]} ${year}`

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-3">
        <Landmark size={18} className="text-slate-500" />
        <h3 className="font-bold text-slate-800">Pagamenti in banca · {mese}</h3>
        <button onClick={ricontrolla} disabled={busy}
          className="ml-auto text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 disabled:opacity-50">
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Ricontrolla ora
        </button>
      </div>

      {loading ? <div className="text-sm text-slate-400">Caricamento…</div> : (
        <div className="space-y-3 text-sm text-slate-700">
          {/* Stipendi */}
          <div className="flex items-start gap-2">
            {slips.length === 0 ? <Clock size={16} className="text-slate-400 mt-0.5" />
              : r.scoperte.length === 0 ? <Check size={16} className="text-green-600 mt-0.5" />
              : <AlertTriangle size={16} className="text-amber-600 mt-0.5" />}
            <div>
              <strong>Stipendi.</strong>{' '}
              {slips.length === 0 ? <>Nessuna busta paga caricata per {mese}.</>
                : links.length === 0 ? <>{slips.length} buste di {mese}, nessuna ancora trovata in banca. Le disposizioni di emolumenti arrivano di solito intorno al 10 del mese dopo.</>
                : <>
                    {links.length} buste su {slips.length} pagate ({eur(r.nettiPagati)}) con {r.nDisp} {r.nDisp === 1 ? 'disposizione' : 'disposizioni'}
                    {r.date.length > 0 && <> del {r.date.map(gg).join(', ')}</>}
                    {r.commissioni > 0.004 && <>, più {eur(r.commissioni)} di commissioni</>}.
                  </>}
              {r.scoperte.length > 0 && links.length > 0 && (
                <div className="mt-1 text-xs text-slate-500">
                  Non trovate in banca: {r.scoperte.map((s) => `${nomeDi(s.employee_id)} (${eur(Number(s.netto))})`).join(', ')}.
                  Di solito è chi è stato pagato con più bonifici o a parte.
                </div>
              )}
            </div>
          </div>

          {/* F24 */}
          <div className="flex items-start gap-2">
            {!check ? <Clock size={16} className="text-slate-400 mt-0.5" />
              : check.esito === 'pagato' || check.esito === 'pagato_con_altre_voci' ? <Check size={16} className="text-green-600 mt-0.5" />
              : check.esito === 'da_chiarire' ? <AlertTriangle size={16} className="text-amber-600 mt-0.5" />
              : <Clock size={16} className="text-slate-400 mt-0.5" />}
            <div>
              <strong>F24 del personale.</strong>{' '}
              {!check ? <>Il controllo parte quando carichi il Prospetto riepilogativo di {mese}: da lì il gestionale sa quanto va versato.</>
                : <>
                    Il prospetto chiede {eur(Number(check.atteso))} entro il {gg(check.scadenza)}.{' '}
                    {check.esito === 'pagato' && <>Pagato: {check.bank_transaction_ids.length} {check.bank_transaction_ids.length === 1 ? 'delega' : 'deleghe'} per la cifra esatta.</>}
                    {check.esito === 'pagato_con_altre_voci' && <>Coperto: le deleghe di quei giorni fanno {eur(Number(check.pagato))} e comprendono anche altre imposte.</>}
                    {check.esito === 'in_attesa' && <>Deleghe non ancora arrivate in banca.</>}
                    {check.esito === 'da_chiarire' && <>In banca non torna: la domanda è in Banche → Documenti banca → «Da chiarire».</>}
                  </>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
