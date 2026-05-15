// Pagina /prima-nota
// Riepilogo movimenti banca per periodo, formato export per commercialista (Lilian).
// Sorgente: bank_transactions (single source A-Cube post-15/05).
// Filtri: anno + mese + conto. Export CSV + XLSX.

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Download, FileSpreadsheet, Calendar, Filter, RefreshCw, Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'

type BankAccount = { id: string; bank_name: string; account_name: string | null; iban: string | null }
type Supplier = { id: string; ragione_sociale: string | null; name: string | null; partita_iva: string | null }
type Movement = {
  id: string
  transaction_date: string
  amount: number
  currency: string | null
  description: string | null
  reference: string | null
  category: string | null
  counterpart: string | null
  merchant_name: string | null
  supplier_id: string | null
  invoice_id: string | null
  bank_account_id: string | null
  bank_accounts?: BankAccount | null
  suppliers?: Supplier | null
  payables?: { invoice_number: string | null; supplier_name: string | null; supplier_vat: string | null } | null
}

const MONTHS = [
  { v: 1, l: 'Gennaio' }, { v: 2, l: 'Febbraio' }, { v: 3, l: 'Marzo' }, { v: 4, l: 'Aprile' },
  { v: 5, l: 'Maggio' }, { v: 6, l: 'Giugno' }, { v: 7, l: 'Luglio' }, { v: 8, l: 'Agosto' },
  { v: 9, l: 'Settembre' }, { v: 10, l: 'Ottobre' }, { v: 11, l: 'Novembre' }, { v: 12, l: 'Dicembre' },
]

const fmt = (n: number) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('it-IT') : '—'

function getCounterpart(m: Movement): string {
  if (m.suppliers?.ragione_sociale) return m.suppliers.ragione_sociale
  if (m.suppliers?.name) return m.suppliers.name
  if (m.payables?.supplier_name) return m.payables.supplier_name
  if (m.counterpart) return m.counterpart
  if (m.merchant_name) return m.merchant_name
  return '—'
}

function getCausale(m: Movement): string {
  if (m.payables?.invoice_number) return `Fatt. ${m.payables.invoice_number}`
  if (m.reference) return m.reference
  if (m.description) return m.description.length > 60 ? m.description.slice(0, 60) + '…' : m.description
  return '—'
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
      const dateEnd = month
        ? new Date(year, month, 0).toISOString().slice(0, 10)
        : `${year}-12-31`

      // Embed payables tramite bank_transaction_id FK omesso: PostgREST non risolve auto.
      // Fetch separato dei payables collegati e join lato client.
      let q = supabase
        .from('bank_transactions')
        .select(`
          id, transaction_date, amount, currency, description, reference, category,
          counterpart, merchant_name, supplier_id, invoice_id, bank_account_id,
          bank_accounts!inner(id, bank_name, account_name, iban),
          suppliers(id, ragione_sociale, name, partita_iva)
        `)
        .eq('company_id', companyId)
        .gte('transaction_date', dateStart)
        .lte('transaction_date', dateEnd)
        .order('transaction_date', { ascending: true })
        .limit(5000)

      if (bankAccountId !== 'all') {
        q = q.eq('bank_account_id', bankAccountId)
      }

      const { data, error: err } = await q
      if (err) throw err
      const baseMovs = (data as unknown as Movement[]) ?? []

      // Fetch separato payables collegati. types stale per bank_transaction_id (col aggiunta in 028).
      const btIds = baseMovs.map(m => m.id).filter(Boolean)
      if (btIds.length > 0) {
        const { data: payRows } = await (supabase
          .from('payables') as unknown as { select: (s: string) => { in: (k: string, v: string[]) => Promise<{ data: Array<Record<string, unknown>> | null }> } })
          .select('bank_transaction_id, invoice_number, supplier_name, supplier_vat')
          .in('bank_transaction_id', btIds)
        const payMap = new Map<string, { invoice_number: string | null; supplier_name: string | null; supplier_vat: string | null }>()
        ;(payRows ?? []).forEach((p) => {
          const btId = p.bank_transaction_id as string | null
          if (btId) payMap.set(btId, {
            invoice_number: (p.invoice_number as string | null) ?? null,
            supplier_name: (p.supplier_name as string | null) ?? null,
            supplier_vat: (p.supplier_vat as string | null) ?? null,
          })
        })
        baseMovs.forEach(m => {
          const p = payMap.get(m.id)
          if (p) m.payables = p
        })
      }
      setMovements(baseMovs)
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
    return { dare, avere, netto: dare - avere, count: movements.length }
  }, [movements])

  // Costruisce le righe formato Prima Nota standardizzato
  const rows = useMemo(() => movements.map(m => ({
    Data: fmtDate(m.transaction_date),
    'Conto Banca': m.bank_accounts ? `${m.bank_accounts.bank_name} ${m.bank_accounts.account_name ? '— ' + m.bank_accounts.account_name : ''}` : '—',
    'IBAN': m.bank_accounts?.iban ? `***${m.bank_accounts.iban.slice(-6)}` : '—',
    Tipo: m.amount > 0 ? 'Entrata' : 'Uscita',
    Importo: Math.abs(m.amount),
    Valuta: m.currency ?? 'EUR',
    Contropartita: getCounterpart(m),
    'P.IVA Contropartita': m.suppliers?.partita_iva ?? m.payables?.supplier_vat ?? '—',
    Causale: getCausale(m),
    Categoria: m.category ?? '—',
  })), [movements])

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

  const exportXlsx = () => {
    if (rows.length === 0) return
    const ws = XLSX.utils.json_to_sheet(rows)
    // Larghezza colonne suggerita
    ws['!cols'] = [
      { wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 8 },
      { wch: 35 }, { wch: 16 }, { wch: 40 }, { wch: 18 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Prima Nota')

    // Sheet riepilogo
    const summaryData = [
      ['Periodo', month ? `${MONTHS.find(m => m.v === month)?.l} ${year}` : `Anno ${year}`],
      ['Conto', bankAccountId === 'all' ? 'Tutti i conti' : bankAccounts.find(b => b.id === bankAccountId)?.bank_name ?? '—'],
      ['Movimenti', totals.count],
      ['Totale Dare (entrate)', totals.dare],
      ['Totale Avere (uscite)', totals.avere],
      ['Saldo netto', totals.netto],
      ['Generato il', new Date().toLocaleString('it-IT')],
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
    wsSummary['!cols'] = [{ wch: 25 }, { wch: 25 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Riepilogo')

    XLSX.writeFile(wb, `prima_nota_${year}${month ? '-' + String(month).padStart(2, '0') : ''}.xlsx`)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-600">
          Riepilogo movimenti bancari per periodo, formato pronto per la commercialista.
          Sorgente: <strong>banche A-Cube</strong>.
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
        <button onClick={loadMovements} disabled={loading}
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiBox label="Movimenti" value={totals.count.toString()} color="slate" />
        <KpiBox label="Entrate (Dare)" value={`€ ${fmt(totals.dare)}`} color="emerald" />
        <KpiBox label="Uscite (Avere)" value={`€ ${fmt(totals.avere)}`} color="red" />
        <KpiBox label="Saldo netto" value={`€ ${fmt(totals.netto)}`} color={totals.netto >= 0 ? 'emerald' : 'red'} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
          Errore caricamento: {error}
        </div>
      )}

      {/* Tabella */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Conto Banca</th>
                <th className="px-3 py-2 text-center">Tipo</th>
                <th className="px-3 py-2 text-right">Importo</th>
                <th className="px-3 py-2 text-left">Contropartita</th>
                <th className="px-3 py-2 text-left">P.IVA</th>
                <th className="px-3 py-2 text-left">Causale</th>
                <th className="px-3 py-2 text-left">Categoria</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
                </td></tr>
              ) : movements.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Nessun movimento nel periodo selezionato
                </td></tr>
              ) : movements.map(m => (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-slate-700">{fmtDate(m.transaction_date)}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs">
                    {m.bank_accounts?.bank_name ?? '—'}
                    {m.bank_accounts?.iban && <span className="block text-slate-400">***{m.bank_accounts.iban.slice(-6)}</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${m.amount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {m.amount > 0 ? 'Entrata' : 'Uscita'}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${m.amount > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    € {fmt(Math.abs(m.amount))}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{getCounterpart(m)}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs font-mono">{m.suppliers?.partita_iva ?? m.payables?.supplier_vat ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600 text-xs max-w-md truncate" title={getCausale(m)}>{getCausale(m)}</td>
                  <td className="px-3 py-2 text-slate-500 text-xs">{m.category ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

type KpiColor = 'slate' | 'emerald' | 'red'
function KpiBox({ label, value, color }: { label: string; value: string; color: KpiColor }) {
  const colors: Record<KpiColor, string> = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colors[color]}`}>{value}</div>
    </div>
  )
}
