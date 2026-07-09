import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, ChevronDown, ChevronRight, Landmark, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import PageHeader from '../components/PageHeader'

// Storico delle distinte di pagamento (disposizioni fornitori).
// Ogni distinta = insieme di azioni 'disposizione' create nello stesso giorno.
// Per ogni distinta: lista fatture + totale complessivo + totale per banca
// (con quota gia' effettivamente pagata/riconciliata).

interface DispRow {
  id: string
  amount: number | null
  bank_account_id: string | null
  note: string | null
  performed_at: string
  operator_name: string | null
  payables: {
    id: string
    invoice_number: string | null
    supplier_name: string | null
    gross_amount: number | null
    status: string | null
    due_date: string | null
    payment_date: string | null
  } | null
}

interface BankAgg { bankId: string; bankName: string; total: number; count: number; paidTotal: number; paidCount: number }
interface Distinta {
  giorno: string           // YYYY-MM-DD
  righe: DispRow[]
  totale: number
  totalePagato: number
  banche: BankAgg[]
}

const fmt = (n: number) =>
  new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)

const isPaid = (s: string | null | undefined) => s === 'pagato'

export default function StoricoDistinte() {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id
  const [rows, setRows] = useState<DispRow[]>([])
  const [bankNames, setBankNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!COMPANY_ID) return
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const [{ data: banks }, { data }] = await Promise.all([
          supabase.from('bank_accounts').select('id, bank_name').eq('company_id', COMPANY_ID),
          supabase
            .from('payable_actions')
            .select('id, amount, bank_account_id, note, performed_at, operator_name, payables!inner(id, invoice_number, supplier_name, gross_amount, status, due_date, payment_date, company_id)')
            .eq('action_type', 'disposizione')
            .eq('payables.company_id', COMPANY_ID)
            .order('performed_at', { ascending: false }),
        ])
        if (!active) return
        const bmap: Record<string, string> = {}
        ;(banks as { id: string; bank_name: string | null }[] | null)?.forEach(b => { bmap[b.id] = b.bank_name || '—' })
        setBankNames(bmap)
        setRows(((data || []) as unknown as DispRow[]))
      } catch (e) {
        console.warn('[storico-distinte]', e)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [COMPANY_ID])

  const distinte: Distinta[] = useMemo(() => {
    const byDay = new Map<string, DispRow[]>()
    for (const r of rows) {
      const g = (r.performed_at || '').slice(0, 10)
      if (!g) continue
      if (!byDay.has(g)) byDay.set(g, [])
      byDay.get(g)!.push(r)
    }
    const out: Distinta[] = []
    for (const [giorno, righe] of byDay) {
      let totale = 0, totalePagato = 0
      const bankMap = new Map<string, BankAgg>()
      for (const r of righe) {
        const amt = Number(r.amount ?? r.payables?.gross_amount ?? 0)
        const paid = isPaid(r.payables?.status)
        totale += amt
        if (paid) totalePagato += amt
        const bid = r.bank_account_id || 'nd'
        if (!bankMap.has(bid)) bankMap.set(bid, { bankId: bid, bankName: bankNames[bid] || (bid === 'nd' ? 'Banca non indicata' : '—'), total: 0, count: 0, paidTotal: 0, paidCount: 0 })
        const agg = bankMap.get(bid)!
        agg.total += amt; agg.count += 1
        if (paid) { agg.paidTotal += amt; agg.paidCount += 1 }
      }
      out.push({ giorno, righe, totale, totalePagato, banche: [...bankMap.values()].sort((a, b) => b.total - a.total) })
    }
    return out.sort((a, b) => (a.giorno < b.giorno ? 1 : -1))
  }, [rows, bankNames])

  const totali = useMemo(() => {
    const t = distinte.reduce((s, d) => s + d.totale, 0)
    const p = distinte.reduce((s, d) => s + d.totalePagato, 0)
    return { distinte: distinte.length, righe: rows.length, totale: t, pagato: p }
  }, [distinte, rows.length])

  const fmtGiorno = (g: string) => {
    const d = new Date(g + 'T00:00:00')
    return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
        <PageHeader
          title="Storico Distinte"
          subtitle="Distinte di pagamento fornitori: lista, totale e totale per banca (con quota già pagata)"
          noDivider
        />

        {/* Riepilogo generale */}
        {!loading && distinte.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Distinte" value={String(totali.distinte)} />
            <Kpi label="Scadenze disposte" value={String(totali.righe)} />
            <Kpi label="Totale disposto" value={`€ ${fmt(totali.totale)}`} />
            <Kpi label="Totale pagato" value={`€ ${fmt(totali.pagato)}`} accent="emerald" />
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
            <Loader2 size={18} className="animate-spin" /> Caricamento distinte…
          </div>
        ) : distinte.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <ClipboardList size={40} className="mx-auto mb-3 text-slate-300" />
            <p className="font-medium text-slate-500">Nessuna distinta ancora creata</p>
            <p className="text-sm mt-1">Le distinte create dallo Scadenzario compariranno qui, con totali per banca.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {distinte.map(d => {
              const isOpen = open[d.giorno] ?? false
              return (
                <div key={d.giorno} className="rounded-xl border border-slate-200 overflow-hidden">
                  <button
                    onClick={() => setOpen(o => ({ ...o, [d.giorno]: !isOpen }))}
                    className="w-full flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {isOpen ? <ChevronDown size={18} className="text-slate-400 shrink-0" /> : <ChevronRight size={18} className="text-slate-400 shrink-0" />}
                      <ClipboardList size={18} className="text-blue-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 capitalize truncate">Distinta del {fmtGiorno(d.giorno)}</div>
                        <div className="text-xs text-slate-400">{d.righe.length} scadenz{d.righe.length === 1 ? 'a' : 'e'}</div>
                      </div>
                    </div>
                    {/* chip per banca */}
                    <div className="flex flex-wrap gap-1.5">
                      {d.banche.map(b => (
                        <span key={b.bankId} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-[11px] text-slate-600">
                          <Landmark size={11} className="text-slate-400" />
                          <span className="font-medium">{b.bankName}</span>
                          <span className="text-slate-500">€ {fmt(b.total)}</span>
                        </span>
                      ))}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-bold text-slate-900">€ {fmt(d.totale)}</div>
                      <div className="text-[11px] text-emerald-600">pagato € {fmt(d.totalePagato)}</div>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-slate-100">
                      {/* Totali per banca (dettaglio) */}
                      <div className="px-4 py-3 bg-slate-50/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {d.banche.map(b => (
                          <div key={b.bankId} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                              <Landmark size={13} className="text-slate-400" /> {b.bankName}
                            </div>
                            <div className="mt-1 flex items-baseline justify-between">
                              <span className="text-xs text-slate-500">Totale</span>
                              <span className="text-sm font-bold text-slate-900">€ {fmt(b.total)}</span>
                            </div>
                            <div className="flex items-baseline justify-between">
                              <span className="text-xs text-slate-500">Pagato</span>
                              <span className="text-sm font-semibold text-emerald-600">€ {fmt(b.paidTotal)} <span className="text-[10px] text-slate-400">({b.paidCount}/{b.count})</span></span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Lista fatture */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                              <th className="py-2 px-4 font-medium">Fornitore</th>
                              <th className="py-2 px-4 font-medium">Fattura</th>
                              <th className="py-2 px-4 font-medium">Banca</th>
                              <th className="py-2 px-4 font-medium text-right">Importo</th>
                              <th className="py-2 px-4 font-medium text-center">Stato</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.righe.map(r => {
                              const paid = isPaid(r.payables?.status)
                              const amt = Number(r.amount ?? r.payables?.gross_amount ?? 0)
                              return (
                                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                                  <td className="py-2 px-4 text-slate-800">{r.payables?.supplier_name || '—'}</td>
                                  <td className="py-2 px-4 text-slate-500">{r.payables?.invoice_number || '—'}</td>
                                  <td className="py-2 px-4 text-slate-500">{bankNames[r.bank_account_id || ''] || 'Banca non indicata'}</td>
                                  <td className="py-2 px-4 text-right font-medium text-slate-800">€ {fmt(amt)}</td>
                                  <td className="py-2 px-4 text-center">
                                    {paid ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[11px] font-medium">
                                        <CheckCircle2 size={11} /> Pagato
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[11px] font-medium">
                                        <Clock size={11} /> In distinta
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'emerald' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${accent === 'emerald' ? 'text-emerald-600' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}
