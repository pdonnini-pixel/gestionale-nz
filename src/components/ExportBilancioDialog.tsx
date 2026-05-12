/**
 * ExportBilancioDialog
 *
 * Dialog modale per export del bilancio consuntivo periodico (Lavoro 3 Task A).
 *
 * Permette di scegliere:
 *  - Periodo: mensile singolo / trimestrale / annuale / range custom
 *  - Vista: gestionale (per outlet, senza rettifica magazzino)
 *           civilistico (consolidato, con rettifica magazzino)
 *  - Outlet: singolo o tutti
 *
 * Genera un file .xlsx multi-sheet con:
 *  - Foglio "Riepilogo": metadati + totali per macro_group
 *  - Foglio "Dettaglio": righe budget_entries con preventivo / consuntivo /
 *    scostamento €/% / ultimo refresh consuntivo
 *
 * Il file viene scaricato direttamente dal browser. Niente edge function:
 * la libreria xlsx (SheetJS v0.18.5) genera tutto client-side.
 */

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { X, FileSpreadsheet, Download } from 'lucide-react'

type BudgetEntry = {
  cost_center?: string
  account_code?: string
  account_name?: string
  macro_group?: string
  budget_amount?: number
  actual_amount?: number | null
  month?: number
  year?: number
  actual_refreshed_at?: string | null
}

type CostCenter = {
  code: string
  label?: string
  name?: string
}

type PeriodType = 'mensile' | 'trimestrale' | 'annuale' | 'custom'
type ViewType = 'gestionale' | 'civilistico'

type Props = {
  open: boolean
  onClose: () => void
  budgetEntries: BudgetEntry[]
  operativeOutlets: CostCenter[]
  year: number
  tenantName: string
  tenantCode: string
  userEmail: string
}

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

export default function ExportBilancioDialog({
  open, onClose, budgetEntries, operativeOutlets, year, tenantName, tenantCode, userEmail,
}: Props) {
  const [periodType, setPeriodType] = useState<PeriodType>('annuale')
  const [singleMonth, setSingleMonth] = useState(new Date().getMonth() + 1)
  const [trimestre, setTrimestre] = useState<1 | 2 | 3 | 4>(1)
  const [customFrom, setCustomFrom] = useState(1)
  const [customTo, setCustomTo] = useState(12)
  const [viewType, setViewType] = useState<ViewType>('gestionale')
  const [outletFilter, setOutletFilter] = useState<string>('__all__') // __all__ o cost_center code
  const [generating, setGenerating] = useState(false)

  // Calcola intervallo mesi in base al periodo scelto
  const monthRange = useMemo((): { from: number; to: number; label: string } => {
    switch (periodType) {
      case 'mensile':
        return { from: singleMonth, to: singleMonth, label: `${MESI_IT[singleMonth - 1]} ${year}` }
      case 'trimestrale': {
        const from = (trimestre - 1) * 3 + 1
        return { from, to: from + 2, label: `Q${trimestre} ${year}` }
      }
      case 'annuale':
        return { from: 1, to: 12, label: `Anno ${year}` }
      case 'custom':
        return {
          from: Math.min(customFrom, customTo),
          to: Math.max(customFrom, customTo),
          label: `${MESI_IT[Math.min(customFrom, customTo) - 1]} – ${MESI_IT[Math.max(customFrom, customTo) - 1]} ${year}`,
        }
    }
  }, [periodType, singleMonth, trimestre, customFrom, customTo, year])

  // Filtra le righe budget_entries in base ai criteri scelti
  const filteredRows = useMemo(() => {
    return budgetEntries.filter((e) => {
      // Anno
      if (e.year !== year) return false
      // Mese in range
      const m = e.month || 0
      if (m < monthRange.from || m > monthRange.to) return false
      // Vista: gestionale esclude rettifica_bilancio, civilistico la include
      if (viewType === 'gestionale' && e.cost_center === 'rettifica_bilancio') return false
      // Outlet filter
      if (outletFilter !== '__all__' && e.cost_center !== outletFilter) return false
      // Esclude righe "sede"/"spese_non_divise" da vista gestionale per outlet specifico
      // Mantiene tutte le righe in vista civilistica/aggregata
      return true
    })
  }, [budgetEntries, year, monthRange, viewType, outletFilter])

  // Etichette outlet per UI e per export
  const outletLabel = (code?: string): string => {
    if (!code) return ''
    if (code === 'all') return 'Generale (non assegnato)'
    if (code === 'rettifica_bilancio') return 'Rettifica magazzino'
    if (code === 'spese_non_divise') return 'Spese non divise'
    const found = operativeOutlets.find((o) => o.code === code)
    return found ? (found.label || found.name || code) : code
  }

  function generaExcel() {
    setGenerating(true)
    try {
      const wb = XLSX.utils.book_new()

      // ─── FOGLIO 1: RIEPILOGO ─────────────────────────────────────────
      const totals = filteredRows.reduce(
        (acc, r) => {
          const isRev = (r.account_code || '').startsWith('510')
          const budget = Number(r.budget_amount || 0)
          const actual = Number(r.actual_amount || 0)
          if (isRev) {
            acc.ricaviPrev += budget
            acc.ricaviCons += actual
          } else {
            acc.costiPrev += budget
            acc.costiCons += actual
          }
          return acc
        },
        { ricaviPrev: 0, ricaviCons: 0, costiPrev: 0, costiCons: 0 },
      )
      const utilePrev = totals.ricaviPrev - Math.abs(totals.costiPrev)
      const utileCons = totals.ricaviCons - Math.abs(totals.costiCons)
      const scostUtile = utileCons - utilePrev
      const scostUtilePct = utilePrev !== 0 ? (scostUtile / Math.abs(utilePrev)) * 100 : 0

      const summary: (string | number)[][] = [
        ['BILANCIO CONSUNTIVO'],
        [],
        ['Tenant', tenantName],
        ['Codice tenant', tenantCode],
        ['Periodo', monthRange.label],
        ['Vista', viewType === 'gestionale' ? 'Gestionale (per outlet, senza rettifica magazzino)' : 'Civilistico (consolidato, con rettifica magazzino)'],
        ['Outlet', outletFilter === '__all__' ? 'Tutti gli outlet operativi' : outletLabel(outletFilter)],
        ['Generato il', new Date().toLocaleString('it-IT')],
        ['Generato da', userEmail],
        ['Righe totali', filteredRows.length],
        [],
        ['VOCE', 'PREVENTIVO', 'CONSUNTIVO', 'SCOSTAMENTO €', 'SCOSTAMENTO %'],
        ['Ricavi', totals.ricaviPrev, totals.ricaviCons, totals.ricaviCons - totals.ricaviPrev,
         totals.ricaviPrev !== 0 ? ((totals.ricaviCons - totals.ricaviPrev) / Math.abs(totals.ricaviPrev)) * 100 : 0],
        ['Costi', totals.costiPrev, totals.costiCons, totals.costiCons - totals.costiPrev,
         totals.costiPrev !== 0 ? ((totals.costiCons - totals.costiPrev) / Math.abs(totals.costiPrev)) * 100 : 0],
        ['Utile / Perdita', utilePrev, utileCons, scostUtile, scostUtilePct],
      ]

      const ws1 = XLSX.utils.aoa_to_sheet(summary)
      // Larghezza colonne
      ws1['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 16 }]
      XLSX.utils.book_append_sheet(wb, ws1, 'Riepilogo')

      // ─── FOGLIO 2: DETTAGLIO ─────────────────────────────────────────
      const detail: (string | number)[][] = [
        ['Codice conto', 'Descrizione conto', 'Macro gruppo', 'Outlet (cost center)',
         'Mese', 'Anno', 'Preventivo', 'Consuntivo', 'Scostamento €', 'Scostamento %',
         'Ultimo refresh consuntivo'],
      ]
      // Ordina per: macro_group, account_code, cost_center, month
      const sorted = [...filteredRows].sort((a, b) => {
        const k1 = (a.macro_group || 'zzz')
        const k2 = (b.macro_group || 'zzz')
        if (k1 !== k2) return k1.localeCompare(k2)
        const c1 = (a.account_code || '')
        const c2 = (b.account_code || '')
        if (c1 !== c2) return c1.localeCompare(c2)
        const cc1 = (a.cost_center || '')
        const cc2 = (b.cost_center || '')
        if (cc1 !== cc2) return cc1.localeCompare(cc2)
        return (a.month || 0) - (b.month || 0)
      })
      sorted.forEach((r) => {
        const prev = Number(r.budget_amount || 0)
        const cons = Number(r.actual_amount || 0)
        const scost = cons - prev
        const scostPct = prev !== 0 ? (scost / Math.abs(prev)) * 100 : 0
        detail.push([
          r.account_code || '',
          r.account_name || '',
          r.macro_group || '',
          outletLabel(r.cost_center),
          (r.month || 0) >= 1 && (r.month || 0) <= 12 ? MESI_IT[(r.month || 1) - 1] : '',
          r.year || year,
          prev, cons, scost, scostPct,
          r.actual_refreshed_at ? new Date(r.actual_refreshed_at).toLocaleString('it-IT') : '—',
        ])
      })
      const ws2 = XLSX.utils.aoa_to_sheet(detail)
      ws2['!cols'] = [
        { wch: 14 }, { wch: 36 }, { wch: 18 }, { wch: 22 },
        { wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        { wch: 22 },
      ]
      XLSX.utils.book_append_sheet(wb, ws2, 'Dettaglio')

      // ─── DOWNLOAD ────────────────────────────────────────────────────
      const periodSlug = monthRange.label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const ts = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
      const filename = `bilancio_consuntivo_${tenantCode.toLowerCase()}_${periodSlug}_${ts}.xlsx`
      XLSX.writeFile(wb, filename)
      onClose()
    } catch (err) {
      console.error('[ExportBilancio]', err)
      alert('Errore durante la generazione del file Excel. Vedi console per dettagli.')
    } finally {
      setGenerating(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-100 rounded-lg p-2">
              <FileSpreadsheet size={22} className="text-emerald-700" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Esporta bilancio consuntivo</h2>
              <p className="text-sm text-slate-500">Genera file Excel con preventivo, consuntivo e scostamento per il periodo scelto</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Periodo */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Periodo</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { k: 'mensile', l: 'Mensile' },
                { k: 'trimestrale', l: 'Trimestrale' },
                { k: 'annuale', l: 'Annuale' },
                { k: 'custom', l: 'Range custom' },
              ] as const).map((p) => (
                <button key={p.k} onClick={() => setPeriodType(p.k)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
                    periodType === p.k
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
                  {p.l}
                </button>
              ))}
            </div>

            {periodType === 'mensile' && (
              <div className="mt-3">
                <select value={singleMonth} onChange={(e) => setSingleMonth(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {MESI_IT.map((m, idx) => (
                    <option key={idx + 1} value={idx + 1}>{m} {year}</option>
                  ))}
                </select>
              </div>
            )}
            {periodType === 'trimestrale' && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {([1, 2, 3, 4] as const).map((q) => (
                  <button key={q} onClick={() => setTrimestre(q)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                      trimestre === q ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600'
                    }`}>
                    Q{q}
                  </button>
                ))}
              </div>
            )}
            {periodType === 'custom' && (
              <div className="mt-3 flex items-center gap-2">
                <select value={customFrom} onChange={(e) => setCustomFrom(Number(e.target.value))}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {MESI_IT.map((m, idx) => (<option key={idx + 1} value={idx + 1}>{m}</option>))}
                </select>
                <span className="text-slate-500">→</span>
                <select value={customTo} onChange={(e) => setCustomTo(Number(e.target.value))}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {MESI_IT.map((m, idx) => (<option key={idx + 1} value={idx + 1}>{m}</option>))}
                </select>
              </div>
            )}
          </div>

          {/* Vista */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Vista</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setViewType('gestionale')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border text-left ${
                  viewType === 'gestionale' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600'
                }`}>
                <div className="font-semibold">Gestionale</div>
                <div className="text-xs opacity-75">Per outlet, senza rettifica magazzino</div>
              </button>
              <button onClick={() => setViewType('civilistico')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border text-left ${
                  viewType === 'civilistico' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600'
                }`}>
                <div className="font-semibold">Civilistico</div>
                <div className="text-xs opacity-75">Consolidato, con rettifica magazzino</div>
              </button>
            </div>
          </div>

          {/* Outlet */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Outlet</label>
            <select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
              <option value="__all__">Tutti gli outlet operativi</option>
              {operativeOutlets.map((o) => (
                <option key={o.code} value={o.code}>{o.label || o.name || o.code}</option>
              ))}
            </select>
          </div>

          {/* Anteprima */}
          <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
            <div className="font-semibold text-slate-800 mb-1">Anteprima export</div>
            <div>📅 <span className="font-medium">{monthRange.label}</span></div>
            <div>📊 Vista <span className="font-medium">{viewType}</span></div>
            <div>🏪 Outlet: <span className="font-medium">{outletFilter === '__all__' ? 'tutti operativi' : outletLabel(outletFilter)}</span></div>
            <div>📋 Righe nel file: <span className="font-medium">{filteredRows.length}</span></div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Annulla
          </button>
          <button onClick={generaExcel}
            disabled={generating || filteredRows.length === 0}
            className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
            <Download size={16} />
            {generating ? 'Generazione…' : 'Scarica Excel'}
          </button>
        </div>
      </div>
    </div>
  )
}
