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

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Download, FileSpreadsheet, Calendar, Filter, RefreshCw, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import { lastDayOfMonthYMD } from '../lib/dateLocal'
import {
  buildRow, classifyMovement, counterpartOf, causaleOf, pivaOf, invoiceCountOf, invoicesTotalOf,
  summarizeByKind, KIND_LABELS, PN_COLUMN_WIDTHS,
  type PnPayable, type PnFiscalDeadline, type PnMovement, type MovementKind,
} from '../lib/primaNotaExport'
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
  const [movements, setMovements] = useState<Movement[]>([])
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

  useEffect(() => { loadBankAccounts() }, [loadBankAccounts])
  useEffect(() => { loadMovements() }, [loadMovements])

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
    if (rows.length === 0) return
    const headers = Object.keys(rows[0])
    const csvRows = [
      headers.join(';'),
      ...rows.map(r => headers.map(h => {
        const v = (r as Record<string, unknown>)[h]
        const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? '')
        return s.includes(';') || s.includes('\n') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(';')),
    ]
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prima_nota_${year}${month ? '-' + String(month).padStart(2, '0') : ''}.csv`
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
        <button onClick={exportCsv} disabled={rows.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg text-sm font-medium">
          <Download size={14} /> CSV
        </button>
        <button onClick={exportXlsx} disabled={rows.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
          <FileSpreadsheet size={14} /> Excel
        </button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <KpiBox label="Movimenti" value={totals.count.toString()} color="slate" />
        <KpiBox label="Entrate (Dare)" value={`€ ${fmt(totals.dare)}`} color="emerald" />
        <KpiBox label="Uscite (Avere)" value={`€ ${fmt(totals.avere)}`} color="red" />
        <KpiBox label="Saldo netto" value={`€ ${fmt(totals.netto)}`} color={totals.netto >= 0 ? 'emerald' : 'red'} />
        <KpiBox label="Da chiarire" value={totals.daChiarire.toString()} color={totals.daChiarire > 0 ? 'orange' : 'slate'}
          hint="Movimenti che nessuna fonte spiega: né fattura, né F24, né causale riconoscibile" />
      </div>

      {/* Riepilogo per tipo di movimento: stesso contenuto del foglio Riepilogo dell'Excel */}
      {byKind.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {byKind.map(k => (
            <span key={k.kind} className="inline-flex items-center gap-1.5">
              <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${KIND_BADGE[k.kind]}`}>{k.label}</span>
              <span className="tabular-nums">{k.n}</span>
              {k.entrate > 0 && <span className="text-emerald-700 tabular-nums">+{fmt(k.entrate)}</span>}
              {k.uscite > 0 && <span className="text-red-700 tabular-nums">−{fmt(k.uscite)}</span>}
            </span>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
          Errore caricamento: {error}
        </div>
      )}

      {/* Lista mobile a schede (sotto md): stessa fonte dati della tabella,
          una card per movimento con i dati chiave. La tabella resta su desktop. */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
          </div>
        ) : movements.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            Nessun movimento nel periodo selezionato
          </div>
        ) : movements.map(m => (
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
              ) : movements.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                  Nessun movimento nel periodo selezionato
                </td></tr>
              ) : movements.map(m => {
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
    </div>
  )
}

type KpiColor = 'slate' | 'emerald' | 'red' | 'orange'
function KpiBox({ label, value, color, hint }: { label: string; value: string; color: KpiColor; hint?: string }) {
  const colors: Record<KpiColor, string> = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
    orange: 'text-orange-700',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colors[color]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-1 leading-tight">{hint}</div>}
    </div>
  )
}
