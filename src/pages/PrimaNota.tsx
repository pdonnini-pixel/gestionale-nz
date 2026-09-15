// Pagina /prima-nota
// Riepilogo movimenti banca per periodo, formato export per la commercialista.
// Sorgente: bank_transactions (single source A-Cube post-15/05).
// Filtri: anno + mese + conto. Export CSV + XLSX.
//
// Ogni movimento porta TUTTE le fatture che salda (non una sola: una RiBa da 31
// effetti ne mostrava una a caso), il tipo di movimento (fornitore, F24, stipendi,
// POS, versamento, carta, spese bancarie, finanziamento, giroconto, da chiarire)
// e per gli F24 il codice tributo e il periodo letti da Scadenze fiscali.
// La logica è in src/lib/primaNotaExport.ts (testata), qui solo dati e UI.
//
// Seconda vista «Pagamenti fornitori» (passo B dell'audit): una riga per FATTURA
// pagata nel periodo, contanti, carta e note di credito compresi, con conto,
// data del movimento, imponibile/IVA, metodo, categoria e conto CE. È il foglio
// che serve allo studio per chiudere le partite fornitori. Logica in
// src/lib/primaNotaPagamenti.ts (testata).

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Download, FileSpreadsheet, Calendar, Filter, RefreshCw, Loader2, Landmark, Receipt } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import { lastDayOfMonthYMD } from '../lib/dateLocal'
import {
  buildRow, classifyMovement, counterpartOf, causaleOf, pivaOf, invoiceCountOf, invoicesTotalOf,
  summarizeByKind, KIND_LABELS, PN_COLUMN_WIDTHS,
  type PnPayable, type PnFiscalDeadline, type PnMovement, type MovementKind,
} from '../lib/primaNotaExport'
import {
  buildPagamentoRow, fonteOf, includePagamento, sortPagamenti, summarizePagamenti, importoPagato, metodoLabel, rataOf,
  FONTE_LABELS, PAGAMENTI_COLUMN_WIDTHS, type PnPagamento, type PnLookups, type PagamentoFonte,
} from '../lib/primaNotaPagamenti'
import { useCompany } from '../hooks/useCompany'
import Tooltip from '../components/Tooltip'
import TableScroll from '../components/ui/TableScroll'

type BankAccount = { id: string; bank_name: string; account_name: string | null; iban: string | null }
type Supplier = { id: string; ragione_sociale: string | null; name: string | null; partita_iva: string | null }
type MovementRaw = {
  id: string
  transaction_date: string
  amount: number
  currency: string | null
  description: string | null
  reference: string | null
  category: string | null
  counterpart: string | null
  counterpart_name: string | null
  merchant_name: string | null
  supplier_id: string | null
  bank_account_id: string | null
  bank_accounts?: BankAccount | null
  suppliers?: Supplier | null
}
type Movement = MovementRaw & PnMovement
type Pagamento = PnPagamento & { is_placeholder: boolean | null; is_forecast: boolean | null }
type View = 'banca' | 'pagamenti'

const MONTHS = [
  { v: 1, l: 'Gennaio' }, { v: 2, l: 'Febbraio' }, { v: 3, l: 'Marzo' }, { v: 4, l: 'Aprile' },
  { v: 5, l: 'Maggio' }, { v: 6, l: 'Giugno' }, { v: 7, l: 'Luglio' }, { v: 8, l: 'Agosto' },
  { v: 9, l: 'Settembre' }, { v: 10, l: 'Ottobre' }, { v: 11, l: 'Novembre' }, { v: 12, l: 'Dicembre' },
]

const fmt = (n: number) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('it-IT') : '—'

// Colori dei badge «Tipo movimento»: verde incassi, rosso fornitori, ambra
// imposte, grigio banca, arancio da chiarire (quello che Sabrina deve guardare).
const KIND_BADGE: Record<MovementKind, string> = {
  fornitore: 'bg-red-50 text-red-700',
  f24: 'bg-amber-100 text-amber-800',
  stipendi: 'bg-violet-100 text-violet-700',
  pos: 'bg-emerald-100 text-emerald-700',
  versamento: 'bg-emerald-50 text-emerald-700',
  carta: 'bg-sky-100 text-sky-700',
  finanziamento: 'bg-slate-200 text-slate-700',
  spese_banca: 'bg-slate-100 text-slate-600',
  giroconto: 'bg-slate-100 text-slate-600',
  da_chiarire: 'bg-orange-100 text-orange-800',
}

const FONTE_BADGE: Record<PagamentoFonte, string> = {
  banca: 'bg-emerald-100 text-emerald-700',
  contanti: 'bg-amber-100 text-amber-800',
  carta: 'bg-sky-100 text-sky-700',
  nota_credito: 'bg-violet-100 text-violet-700',
  provvisoria: 'bg-orange-100 text-orange-800',
  chiusa_a_mano: 'bg-slate-200 text-slate-700',
  senza_riscontro: 'bg-red-100 text-red-700',
}

// PostgREST IN() ha un limite di URL (~16KB): si spacchetta in blocchi da 200 UUID.
const chunk = <T,>(xs: T[], size = 200): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export default function PrimaNota() {
  const { company } = useCompany()
  const today = new Date()
  const [year, setYear] = useState<number>(today.getFullYear())
  const [month, setMonth] = useState<number | null>(today.getMonth() + 1)
  const [bankAccountId, setBankAccountId] = useState<string>('all')
  const [view, setView] = useState<View>('banca')
  const [movements, setMovements] = useState<Movement[]>([])
  const [pagamenti, setPagamenti] = useState<Pagamento[]>([])
  const [lookups, setLookups] = useState<PnLookups>({ bankAccounts: new Map(), bankTx: new Map(), categories: new Map(), outlets: new Map() })
  const [loadingPag, setLoadingPag] = useState(false)
  // Filtro a clic dalle card e dalle etichette: «Da chiarire» deve portare
  // SUBITO alle righe da sistemare, non a un numero da interpretare.
  const [kindFilter, setKindFilter] = useState<MovementKind | null>(null)
  const [fonteFilter, setFonteFilter] = useState<PagamentoFonte[] | null>(null)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const companyId = company?.id

  const loadBankAccounts = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase
      .from('bank_accounts')
      .select('id, bank_name, account_name, iban')
      .eq('company_id', companyId)
      .order('bank_name')
    setBankAccounts((data ?? []) as BankAccount[])
  }, [companyId])

  const loadMovements = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setError(null)
    try {
      const dateStart = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
      // Ultimo giorno del mese in LOCALE: prima `.toISOString()` lo spostava a UTC,
      // escludendo l'ultimo giorno del mese dai movimenti (bug fuso orario).
      const dateEnd = month
        ? lastDayOfMonthYMD(year, month)
        : `${year}-12-31`

      // Paginato: prima un `.limit(5000)` troncava SILENZIOSAMENTE l'estratto (su piu'
      // conti "Tutto l'anno" e' realistico superare 5.000 movimenti): KPI ed export
      // CSV/XLSX per la commercialista risultavano incompleti senza alcun avviso. Ora
      // si scarica tutto in blocchi da 1000. Ordine stabile (data + id) per non
      // perdere/duplicare righe al confine tra le pagine.
      const baseMovs = await fetchAllPaged<MovementRaw>(
        (from, to) => {
          let q = supabase
            .from('bank_transactions')
            .select(`
              id, transaction_date, amount, currency, description, reference, category,
              counterpart, counterpart_name, merchant_name, supplier_id, bank_account_id,
              bank_accounts!inner(id, bank_name, account_name, iban),
              suppliers(id, ragione_sociale, name, partita_iva)
            `)
            .eq('company_id', companyId)
            .gte('transaction_date', dateStart)
            .lte('transaction_date', dateEnd)
            .order('transaction_date', { ascending: true })
            .order('id', { ascending: true })
          if (bankAccountId !== 'all') q = q.eq('bank_account_id', bankAccountId)
          return q.range(from, to)
        },
        'bank_transactions',
      ) as unknown as MovementRaw[]

      // Fatture e scadenze fiscali agganciate al movimento (FK bank_transaction_id,
      // che PostgREST non risolve in embed): fetch separato e join lato client.
      // TUTTE le fatture per movimento: una RiBa o una distinta CBI ne salda decine.
      const btIds = baseMovs.map(m => m.id).filter(Boolean)
      const payMap = new Map<string, PnPayable[]>()
      const fdMap = new Map<string, PnFiscalDeadline[]>()
      if (btIds.length > 0) {
        const chunks = chunk(btIds)
        const [payResults, fdResults] = await Promise.all([
          Promise.all(chunks.map(ids => supabase
            .from('payables')
            .select('bank_transaction_id, invoice_number, supplier_name, supplier_vat, gross_amount')
            .in('bank_transaction_id', ids)
            .order('invoice_number', { ascending: true }))),
          Promise.all(chunks.map(ids => supabase
            .from('fiscal_deadlines')
            .select('bank_transaction_id, title, f24_code, tax_period, deadline_type')
            .in('bank_transaction_id', ids))),
        ])
        for (const p of payResults.flatMap(r => r.data ?? [])) {
          if (!p.bank_transaction_id) continue
          const list = payMap.get(p.bank_transaction_id) ?? []
          list.push({ invoice_number: p.invoice_number, supplier_name: p.supplier_name, supplier_vat: p.supplier_vat, gross_amount: p.gross_amount })
          payMap.set(p.bank_transaction_id, list)
        }
        for (const f of fdResults.flatMap(r => r.data ?? [])) {
          if (!f.bank_transaction_id) continue
          const list = fdMap.get(f.bank_transaction_id) ?? []
          list.push({ title: f.title, f24_code: f.f24_code, tax_period: f.tax_period, deadline_type: f.deadline_type })
          fdMap.set(f.bank_transaction_id, list)
        }
      }
      setMovements(baseMovs.map(m => ({
        ...m,
        supplier: m.suppliers ? { name: m.suppliers.ragione_sociale ?? m.suppliers.name, partita_iva: m.suppliers.partita_iva } : null,
        payables: payMap.get(m.id) ?? [],
        fiscal_deadlines: fdMap.get(m.id) ?? [],
      })))
    } catch (e) {
      // Estrae messaggio leggibile da Error, oggetti Supabase ({message,details,code}), o stringifica
      let msg: string
      if (e instanceof Error) msg = e.message
      else if (e && typeof e === 'object' && 'message' in e) msg = String((e as { message: unknown }).message)
      else { try { msg = JSON.stringify(e) } catch { msg = String(e) } }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [companyId, year, month, bankAccountId])

  // Fatture pagate nel periodo (passo B): payables per payment_date, con i
  // dizionari per conto, movimento riscontrato, categoria e outlet. Il filtro
  // conto e l'esclusione di segnaposto/previsioni sono lato client
  // (includePagamento), così la regola sta in un posto solo e testato.
  const loadPagamenti = useCallback(async () => {
    if (!companyId) return
    setLoadingPag(true)
    try {
      const dateStart = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
      const dateEnd = month ? lastDayOfMonthYMD(year, month) : `${year}-12-31`
      const rows = await fetchAllPaged<Pagamento>(
        (from, to) => supabase
          .from('payables')
          .select(`
            id, payment_date, invoice_number, invoice_date, supplier_name, supplier_vat,
            net_amount, vat_amount, gross_amount, amount_paid, withholding_amount,
            payment_method, payment_method_label, status, closed_manually, manual_close_reason,
            is_provisional_paid, installment_number, installment_total,
            bank_transaction_id, payment_bank_account_id, cost_category_id, outlet_id,
            is_placeholder, is_forecast
          `)
          .eq('company_id', companyId)
          .gte('payment_date', dateStart)
          .lte('payment_date', dateEnd)
          .order('payment_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
        'payables',
      ) as unknown as Pagamento[]

      const txIds = Array.from(new Set(rows.map(r => r.bank_transaction_id).filter((x): x is string => !!x)))
      const [txResults, catRes, outRes, accRes] = await Promise.all([
        Promise.all(chunk(txIds).map(ids => supabase
          .from('bank_transactions')
          .select('id, transaction_date, bank_account_id, description')
          .in('id', ids))),
        supabase.from('cost_categories').select('id, name, ce_account_code').eq('company_id', companyId),
        supabase.from('outlets').select('id, code, name').eq('company_id', companyId),
        supabase.from('bank_accounts').select('id, bank_name, iban').eq('company_id', companyId),
      ])
      const lk: PnLookups = { bankAccounts: new Map(), bankTx: new Map(), categories: new Map(), outlets: new Map() }
      for (const t of txResults.flatMap(r => r.data ?? [])) lk.bankTx.set(t.id, { transaction_date: t.transaction_date, bank_account_id: t.bank_account_id, description: t.description })
      for (const c of catRes.data ?? []) lk.categories.set(c.id, { name: c.name, ce_account_code: c.ce_account_code })
      for (const o of outRes.data ?? []) lk.outlets.set(o.id, { code: o.code, name: o.name })
      for (const a of accRes.data ?? []) lk.bankAccounts.set(a.id, { bank_name: a.bank_name, iban: a.iban })
      setLookups(lk)
      setPagamenti(sortPagamenti(rows))
    } catch (e) {
      console.error('[PrimaNota] pagamenti:', e)
      setPagamenti([])
    } finally {
      setLoadingPag(false)
    }
  }, [companyId, year, month])

  useEffect(() => { loadBankAccounts() }, [loadBankAccounts])
  useEffect(() => { loadMovements() }, [loadMovements])
  useEffect(() => { loadPagamenti() }, [loadPagamenti])

  // Fatture pagate visibili con il filtro conto corrente
  const pagamentiVisibili = useMemo(
    () => pagamenti.filter(p => includePagamento(p, lookups, bankAccountId)),
    [pagamenti, lookups, bankAccountId],
  )
  const pagRows = useMemo(() => pagamentiVisibili.map(p => buildPagamentoRow(p, lookups, fmtDate)), [pagamentiVisibili, lookups])
  const pagByFonte = useMemo(() => summarizePagamenti(pagamentiVisibili), [pagamentiVisibili])
  const pagTotale = useMemo(() => pagamentiVisibili.reduce((s, p) => s + importoPagato(p), 0), [pagamentiVisibili])
  const senzaRiscontro = useMemo(
    () => pagamentiVisibili.filter(p => { const f = fonteOf(p); return f === 'senza_riscontro' || f === 'provvisoria' }).length,
    [pagamentiVisibili],
  )

  // Righe mostrate in tabella: quelle del filtro a clic, se attivo. Gli export
  // restano sempre completi (la commercialista riceve tutto il periodo).
  const movementsShown = useMemo(
    () => kindFilter ? movements.filter(m => classifyMovement(m) === kindFilter) : movements,
    [movements, kindFilter],
  )
  const pagamentiShown = useMemo(
    () => fonteFilter ? pagamentiVisibili.filter(p => fonteFilter.includes(fonteOf(p))) : pagamentiVisibili,
    [pagamentiVisibili, fonteFilter],
  )
  const pagRowsShown = useMemo(() => pagamentiShown.map(p => buildPagamentoRow(p, lookups, fmtDate)), [pagamentiShown, lookups])
  const toggleKind = (k: MovementKind) => setKindFilter(cur => (cur === k ? null : k))
  const toggleFonte = (fs: PagamentoFonte[]) => setFonteFilter(cur => (cur && cur.join() === fs.join() ? null : fs))
  // Cambiando periodo, conto o vista il filtro a clic si azzera
  useEffect(() => { setKindFilter(null); setFonteFilter(null) }, [year, month, bankAccountId, view])

  const totals = useMemo(() => {
    const dare = movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0)
    const avere = movements.filter(m => m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0)
    const daChiarire = movements.filter(m => classifyMovement(m) === 'da_chiarire').length
    return { dare, avere, netto: dare - avere, count: movements.length, daChiarire }
  }, [movements])

  const byKind = useMemo(() => summarizeByKind(movements), [movements])

  // Righe formato Prima Nota standardizzato (una per movimento, fatture in causale)
  const rows = useMemo(() => movements.map(m => buildRow(m, fmtDate)), [movements])

  const exportCsv = () => {
    const src: Array<Record<string, unknown>> = view === 'banca' ? rows : pagRows
    if (src.length === 0) return
    const headers = Object.keys(src[0])
    const csvRows = [
      headers.join(';'),
      ...src.map(r => headers.map(h => {
        const v = (r as Record<string, unknown>)[h]
        const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? '')
        return s.includes(';') || s.includes('\n') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(';')),
    ]
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${view === 'banca' ? 'prima_nota' : 'pagamenti_fornitori'}_${year}${month ? '-' + String(month).padStart(2, '0') : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportXlsx = async () => {
    if (rows.length === 0) return
    // xlsx caricata on-demand: ~140KB gzip che non devono pesare sull'apertura pagina
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = PN_COLUMN_WIDTHS.map(wch => ({ wch }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Prima Nota')
    // Foglio Pagamenti fornitori: una riga per fattura pagata nel periodo
    const wsPag = XLSX.utils.json_to_sheet(pagRows.length > 0 ? pagRows : [{ Nota: 'Nessuna fattura pagata nel periodo' }])
    wsPag['!cols'] = PAGAMENTI_COLUMN_WIDTHS.map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, wsPag, 'Pagamenti fornitori')
    // Sheet riepilogo: totali del periodo + righe e importi per tipo di movimento
    const summaryData: Array<Array<string | number>> = [
      ['Periodo', month ? `${MONTHS.find(m => m.v === month)?.l} ${year}` : `Anno ${year}`],
      ['Conto', bankAccountId === 'all' ? 'Tutti i conti' : bankAccounts.find(b => b.id === bankAccountId)?.bank_name ?? '—'],
      ['Movimenti', totals.count],
      ['Totale Dare (entrate)', totals.dare],
      ['Totale Avere (uscite)', totals.avere],
      ['Saldo netto', totals.netto],
      ['Generato il', new Date().toLocaleString('it-IT')],
      [],
      ['Tipo movimento', 'Movimenti', 'Entrate', 'Uscite'],
      ...byKind.map(k => [k.label, k.n, k.entrate, k.uscite]),
      [],
      ['Pagamenti fornitori (per fonte)', 'Fatture', 'Importo pagato'],
      ...pagByFonte.map(f => [f.label, f.n, f.importo]),
      ['Totale fatture pagate', pagamentiVisibili.length, Math.round(pagTotale * 100) / 100],
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
    wsSummary['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 14 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Riepilogo')
    XLSX.writeFile(wb, `prima_nota_${year}${month ? '-' + String(month).padStart(2, '0') : ''}.xlsx`)
  }

  const KindBadge = ({ m }: { m: Movement }) => {
    const k = classifyMovement(m)
    return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${KIND_BADGE[k]}`}>{KIND_LABELS[k]}</span>
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-600">
          Riepilogo movimenti bancari per periodo, formato pronto per la commercialista.
          Sorgente: <strong>banche A-Cube</strong>. Ogni riga dice che tipo di movimento è e
          quali fatture o F24 salda.
        </p>
      </div>

      {/* Filtri */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-slate-600 flex items-center gap-1"><Calendar size={12} /> Anno</span>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            {[today.getFullYear() - 2, today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Mese</span>
          <select value={month ?? ''} onChange={e => setMonth(e.target.value ? parseInt(e.target.value) : null)}
            className="mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Tutto l'anno</option>
            {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="text-xs text-slate-600 flex items-center gap-1"><Filter size={12} /> Conto</span>
          <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="all">Tutti i conti</option>
            {bankAccounts.map(b => (
              <option key={b.id} value={b.id}>
                {b.bank_name}{b.account_name ? ` — ${b.account_name}` : ''}{b.iban ? ` (***${b.iban.slice(-6)})` : ''}
              </option>
            ))}
          </select>
        </label>
        <button onClick={loadMovements} disabled={loading} title="Aggiorna"
          className="px-3 py-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
        <div className="flex-1" />
        <button onClick={exportCsv} disabled={(view === 'banca' ? rows : pagRows).length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg text-sm font-medium">
          <Download size={14} /> CSV
        </button>
        <button onClick={exportXlsx} disabled={rows.length === 0 && pagRows.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
          <FileSpreadsheet size={14} /> Excel
        </button>
      </div>

      {/* Vista: movimenti banca (una riga per movimento) o pagamenti fornitori (una riga per fattura) */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 mb-4" role="tablist" aria-label="Vista prima nota">
        <button role="tab" aria-selected={view === 'banca'} onClick={() => setView('banca')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view === 'banca' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Landmark size={14} /> Movimenti banca <span className="text-xs opacity-70">{totals.count}</span>
        </button>
        <button role="tab" aria-selected={view === 'pagamenti'} onClick={() => setView('pagamenti')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view === 'pagamenti' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Receipt size={14} /> Pagamenti fornitori <span className="text-xs opacity-70">{pagamentiVisibili.length}</span>
        </button>
      </div>

      {view === 'banca' && (<>
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <KpiBox label="Movimenti" value={totals.count.toString()} color="slate" />
        <KpiBox label="Entrate (Dare)" value={`€ ${fmt(totals.dare)}`} color="emerald" />
        <KpiBox label="Uscite (Avere)" value={`€ ${fmt(totals.avere)}`} color="red" />
        <KpiBox label="Saldo netto" value={`€ ${fmt(totals.netto)}`} color={totals.netto >= 0 ? 'emerald' : 'red'} />
        <KpiBox label="Da chiarire" value={totals.daChiarire.toString()} color={totals.daChiarire > 0 ? 'orange' : 'slate'}
          hint={totals.daChiarire > 0 ? 'Clicca per vedere solo questi movimenti e agganciarli in Riconciliazione o in Scadenze fiscali' : 'Nessun movimento senza spiegazione nel periodo'}
          active={kindFilter === 'da_chiarire'} onClick={totals.daChiarire > 0 ? () => toggleKind('da_chiarire') : undefined} />
      </div>

      {/* Riepilogo per tipo di movimento: stesso contenuto del foglio Riepilogo dell'Excel */}
      {byKind.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {byKind.map(k => (
            <button key={k.kind} type="button" onClick={() => toggleKind(k.kind)} aria-pressed={kindFilter === k.kind}
              title={kindFilter === k.kind ? 'Togli il filtro' : `Mostra solo: ${k.label}`}
              className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 hover:bg-slate-100 ${kindFilter === k.kind ? 'ring-2 ring-slate-900 bg-slate-100' : ''}`}>
              <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${KIND_BADGE[k.kind]}`}>{k.label}</span>
              <span className="tabular-nums">{k.n}</span>
              {k.entrate > 0 && <span className="text-emerald-700 tabular-nums">+{fmt(k.entrate)}</span>}
              {k.uscite > 0 && <span className="text-red-700 tabular-nums">−{fmt(k.uscite)}</span>}
            </button>
          ))}
        </div>
      )}
      {kindFilter && (
        <div className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4 text-sm text-orange-900">
          <span>
            Filtro attivo: <strong>{KIND_LABELS[kindFilter]}</strong> · {movementsShown.length} movimenti su {movements.length}.
            {kindFilter === 'da_chiarire' && ' Per ognuno: se è un pagamento a fornitore agganciarlo in Riconciliazione, se è un F24 in Scadenze fiscali; il resto va spiegato a mano alla commercialista.'}
            {' '}Gli export restano completi.
          </span>
          <button type="button" onClick={() => setKindFilter(null)} className="shrink-0 px-2 py-1 rounded bg-white border border-orange-200 hover:bg-orange-100 text-xs font-medium">Togli filtro</button>
        </div>
      )}

      </>)}

      {view === 'pagamenti' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiBox label="Fatture pagate" value={pagamentiVisibili.length.toString()} color="slate" />
          <KpiBox label="Importo pagato" value={`€ ${fmt(pagTotale)}`} color="red" />
          <KpiBox label="Fornitori" value={new Set(pagamentiVisibili.map(p => p.supplier_vat || p.supplier_name || '')).size.toString()} color="slate" />
          <KpiBox label="Senza riscontro" value={senzaRiscontro.toString()} color={senzaRiscontro > 0 ? 'orange' : 'slate'}
            hint={senzaRiscontro > 0 ? 'Clicca per vedere solo le fatture dichiarate pagate senza movimento né contanti/carta' : 'Tutte le fatture pagate hanno un riscontro'}
            active={!!fonteFilter && fonteFilter.includes('senza_riscontro')}
            onClick={senzaRiscontro > 0 ? () => toggleFonte(['senza_riscontro', 'provvisoria']) : undefined} />
        </div>
      )}
      {view === 'pagamenti' && pagByFonte.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {pagByFonte.map(f => (
            <button key={f.fonte} type="button" onClick={() => toggleFonte([f.fonte])} aria-pressed={!!fonteFilter && fonteFilter.length === 1 && fonteFilter[0] === f.fonte}
              title={fonteFilter?.[0] === f.fonte && fonteFilter.length === 1 ? 'Togli il filtro' : `Mostra solo: ${f.label}`}
              className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 hover:bg-slate-100 ${fonteFilter && fonteFilter.length === 1 && fonteFilter[0] === f.fonte ? 'ring-2 ring-slate-900 bg-slate-100' : ''}`}>
              <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${FONTE_BADGE[f.fonte]}`}>{f.label}</span>
              <span className="tabular-nums">{f.n}</span>
              <span className={`tabular-nums ${f.importo < 0 ? 'text-violet-700' : 'text-red-700'}`}>{f.importo < 0 ? '+' : '−'}{fmt(Math.abs(f.importo))}</span>
            </button>
          ))}
        </div>
      )}
      {view === 'pagamenti' && fonteFilter && (
        <div className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4 text-sm text-orange-900">
          <span>
            Filtro attivo: <strong>{fonteFilter.map(f => FONTE_LABELS[f]).join(' + ')}</strong> · {pagamentiShown.length} fatture su {pagamentiVisibili.length}.
            {fonteFilter.includes('senza_riscontro') && ' Sono fatture segnate pagate senza un movimento collegato: si agganciano in Banche → Riconciliazione (anche se già chiuse a mano).'}
            {' '}Gli export restano completi.
          </span>
          <button type="button" onClick={() => setFonteFilter(null)} className="shrink-0 px-2 py-1 rounded bg-white border border-orange-200 hover:bg-orange-100 text-xs font-medium">Togli filtro</button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
          Errore caricamento: {error}
        </div>
      )}

      {view === 'pagamenti' && (<>
      {/* Pagamenti fornitori, mobile: una card per fattura */}
      <div className="md:hidden space-y-2">
        {loadingPag ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
          </div>
        ) : pagamentiShown.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            {fonteFilter ? 'Nessuna fattura con questo filtro' : 'Nessuna fattura pagata nel periodo selezionato'}
          </div>
        ) : pagamentiShown.map(p => {
          const f = fonteOf(p)
          const tx = p.bank_transaction_id ? lookups.bankTx.get(p.bank_transaction_id) : undefined
          const acc = (tx?.bank_account_id ?? p.payment_bank_account_id) ? lookups.bankAccounts.get((tx?.bank_account_id ?? p.payment_bank_account_id) as string) : undefined
          const cat = p.cost_category_id ? lookups.categories.get(p.cost_category_id) : undefined
          const paid = importoPagato(p)
          return (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">
                  {p.payment_date ? fmtDate(p.payment_date) : '—'}
                  {acc && f === 'banca' && <><span className="mx-1 text-slate-300">·</span>{acc.bank_name}</>}
                </div>
                <span className={`shrink-0 inline-block px-2 py-0.5 rounded text-xs font-medium ${FONTE_BADGE[f]}`}>{FONTE_LABELS[f]}</span>
              </div>
              <div className={`text-lg font-bold mt-1 ${paid < 0 ? 'text-violet-700' : 'text-red-700'}`}>€ {fmt(Math.abs(paid))}</div>
              <div className="text-sm font-medium text-slate-800 mt-0.5 break-words">{p.supplier_name ?? '—'}</div>
              <div className="text-xs text-slate-600 mt-0.5">
                Fatt. {p.invoice_number ?? '?'}{p.invoice_date ? ` del ${fmtDate(p.invoice_date)}` : ''}{rataOf(p) ? ` · rata ${rataOf(p)}` : ''}
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-slate-500">
                {metodoLabel(p) && <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{metodoLabel(p)}</span>}
                {cat && <span>{cat.name}{cat.ce_account_code ? ` (${cat.ce_account_code})` : ''}</span>}
                {p.supplier_vat && <span className="font-mono">P.IVA {p.supplier_vat}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagamenti fornitori, desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <TableScroll className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left">Pagata il</th>
                <th className="px-3 py-2 text-center">Fonte</th>
                <th className="px-3 py-2 text-left">Conto</th>
                <th className="px-3 py-2 text-left">Fornitore</th>
                <th className="px-3 py-2 text-left">P.IVA</th>
                <th className="px-3 py-2 text-left">Fattura</th>
                <th className="px-3 py-2 text-right">Imponibile</th>
                <th className="px-3 py-2 text-right">IVA</th>
                <th className="px-3 py-2 text-right">Pagato</th>
                <th className="px-3 py-2 text-left">Metodo</th>
                <th className="px-3 py-2 text-left">Categoria</th>
              </tr>
            </thead>
            <tbody>
              {loadingPag ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
                </td></tr>
              ) : pagRowsShown.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                  {fonteFilter ? 'Nessuna fattura con questo filtro' : 'Nessuna fattura pagata nel periodo selezionato'}
                </td></tr>
              ) : pagamentiShown.map((p, i) => {
                const r = pagRowsShown[i]
                const f = fonteOf(p)
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r['Data pagamento'] || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <Tooltip content={r.Note}>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${r.Note ? 'cursor-help' : ''} ${FONTE_BADGE[f]}`}>{r.Fonte}</span>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs max-w-[160px]">
                      <Tooltip content={r.IBAN ? `${r['Conto Banca']} · ${r.IBAN}${r['Data movimento'] ? ` · movimento del ${r['Data movimento']}` : ''}` : ''}>
                        <div className="truncate cursor-help">{r['Conto Banca'] || '—'}{r['Data movimento'] && <span className="block text-slate-400">mov. {r['Data movimento']}</span>}</div>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2 text-slate-700 max-w-[200px]">
                      <Tooltip content={r.Fornitore}><div className="truncate cursor-help">{r.Fornitore || '—'}</div></Tooltip>
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs font-mono">{r['P.IVA'] || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">
                      {r['N. fattura'] || '?'}{r['Data fattura'] && <span className="block text-slate-400">{r['Data fattura']}{r.Rata ? ` · rata ${r.Rata}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600 tabular-nums whitespace-nowrap">{r.Imponibile !== '' ? fmt(r.Imponibile) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-600 tabular-nums whitespace-nowrap">{r.IVA !== '' ? fmt(r.IVA) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${r.Pagato < 0 ? 'text-violet-700' : 'text-red-700'}`}>
                      {r.Pagato < 0 ? '+' : '−'} € {fmt(Math.abs(r.Pagato))}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">{r.Metodo || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs max-w-[180px]">
                      <Tooltip content={r.Categoria ? `${r.Categoria}${r['Conto CE'] ? ` · conto ${r['Conto CE']}` : ''}${r.Outlet ? ` · ${r.Outlet}` : ''}` : ''}>
                        <div className="truncate cursor-help">{r.Categoria || '—'}{r['Conto CE'] && <span className="text-slate-400"> {r['Conto CE']}</span>}</div>
                      </Tooltip>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
      </>)}

      {view === 'banca' && (<>

      {/* Lista mobile a schede (sotto md): stessa fonte dati della tabella,
          una card per movimento con i dati chiave. La tabella resta su desktop. */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
          </div>
        ) : movementsShown.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            {kindFilter ? 'Nessun movimento con questo filtro' : 'Nessun movimento nel periodo selezionato'}
          </div>
        ) : movementsShown.map(m => (
          <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                {fmtDate(m.transaction_date)}
                <span className="mx-1 text-slate-300">·</span>
                {m.bank_accounts?.bank_name ?? '—'}
                {m.bank_accounts?.iban && <span className="text-slate-400"> ***{m.bank_accounts.iban.slice(-6)}</span>}
              </div>
              <KindBadge m={m} />
            </div>
            <div className={`text-lg font-bold mt-1 ${m.amount > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              € {fmt(Math.abs(m.amount))}
            </div>
            <div className="text-sm font-medium text-slate-800 mt-0.5 break-words">{counterpartOf(m) || '—'}</div>
            {causaleOf(m) && (
              <div className="text-xs text-slate-600 mt-0.5 break-words">{causaleOf(m)}</div>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {m.category && (
                <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{m.category}</span>
              )}
              {invoiceCountOf(m) > 1 && (
                <span className="text-xs text-slate-500">{invoiceCountOf(m)} fatture · tot. {fmt(invoicesTotalOf(m) ?? 0)}</span>
              )}
              {pivaOf(m) && (
                <span className="text-xs text-slate-500 font-mono">P.IVA {pivaOf(m)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tabella desktop — max-height 70vh + sticky header per gestire bene 200+ movimenti */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <TableScroll className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Conto Banca</th>
                <th className="px-3 py-2 text-center">Tipo movimento</th>
                <th className="px-3 py-2 text-right">Importo</th>
                <th className="px-3 py-2 text-left">Contropartita</th>
                <th className="px-3 py-2 text-left">P.IVA</th>
                <th className="px-3 py-2 text-right">Fatt.</th>
                <th className="px-3 py-2 text-left">Causale</th>
                <th className="px-3 py-2 text-left">Categoria</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
                </td></tr>
              ) : movementsShown.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                  {kindFilter ? 'Nessun movimento con questo filtro' : 'Nessun movimento nel periodo selezionato'}
                </td></tr>
              ) : movementsShown.map(m => {
                const nFatt = invoiceCountOf(m)
                const totFatt = invoicesTotalOf(m)
                return (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-slate-700">{fmtDate(m.transaction_date)}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">
                    <Tooltip content={`${m.bank_accounts?.bank_name ?? ''}${m.bank_accounts?.account_name ? ' — ' + m.bank_accounts.account_name : ''}${m.bank_accounts?.iban ? ' · ' + m.bank_accounts.iban : ''}`}>
                      <div>
                        {m.bank_accounts?.bank_name ?? '—'}
                        {m.bank_accounts?.iban && <span className="block text-slate-400">***{m.bank_accounts.iban.slice(-6)}</span>}
                      </div>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 text-center"><KindBadge m={m} /></td>
                  <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${m.amount > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {m.amount > 0 ? '+' : '−'} € {fmt(Math.abs(m.amount))}
                  </td>
                  <td className="px-3 py-2 text-slate-700 max-w-[200px]">
                    <Tooltip content={counterpartOf(m)}>
                      <div className="truncate cursor-help">{counterpartOf(m) || '—'}</div>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs font-mono">{pivaOf(m) || '—'}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-600 whitespace-nowrap">
                    {nFatt > 0 ? (
                      <Tooltip content={totFatt != null ? `Totale fatture € ${fmt(totFatt)}${Math.abs(totFatt - Math.abs(m.amount)) >= 0.01 ? ` (differenza € ${fmt(Math.abs(m.amount) - totFatt)}, commissioni)` : ''}` : ''}>
                        <span className="cursor-help">{nFatt}</span>
                      </Tooltip>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs max-w-md">
                    <Tooltip content={causaleOf(m)}>
                      <div className="truncate cursor-help">{causaleOf(m) || '—'}</div>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs max-w-[160px]">
                    <Tooltip content={m.category ?? ''}>
                      <div className="truncate cursor-help">{m.category ?? '—'}</div>
                    </Tooltip>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
      </>)}
    </div>
  )
}

type KpiColor = 'slate' | 'emerald' | 'red' | 'orange'
function KpiBox({ label, value, color, hint, onClick, active }: { label: string; value: string; color: KpiColor; hint?: string; onClick?: () => void; active?: boolean }) {
  const colors: Record<KpiColor, string> = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
    orange: 'text-orange-700',
  }
  const inner = (
    <>
      <div className="text-xs text-slate-500 flex items-center justify-between gap-2">
        <span>{label}</span>
        {onClick && <span className="text-[10px] uppercase tracking-wide text-slate-400">{active ? 'filtro attivo' : 'clicca'}</span>}
      </div>
      <div className={`text-2xl font-bold mt-1 ${colors[color]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-1 leading-tight">{hint}</div>}
    </>
  )
  // Una card cliccabile è un bottone vero: tastiera e screen reader la usano come tale.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={!!active}
        className={`text-left w-full bg-white rounded-xl border p-4 cursor-pointer hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${active ? 'border-orange-400 ring-2 ring-orange-300' : 'border-slate-200'}`}>
        {inner}
      </button>
    )
  }
  return <div className="bg-white rounded-xl border border-slate-200 p-4">{inner}</div>
}
