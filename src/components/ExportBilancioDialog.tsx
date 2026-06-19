/**
 * ExportBilancioDialog
 *
 * Export del Bilancio previsionale (Budget & Controllo → "Preventivo vs
 * Consuntivo"). Riproduce ESATTAMENTE la vista gerarchica a monitor — macro
 * civilistiche con i sottoconti — non più la vecchia lista piatta.
 *
 * Output (uguale all'anteprima approvata):
 *  - Excel multi-foglio: 1 foglio per scheda (Totale azienda + ogni outlet +
 *    Sede), righe raggruppabili (outline) per espandere/collassare i sottoconti.
 *  - PDF: 1 pagina per scheda, una tabella per sezione (Ricavi sopra, Costi sotto).
 *
 * Sezioni nell'ordine: COMPONENTI POSITIVE (RICAVI) → COMPONENTI NEGATIVE (COSTI)
 * → riga RISULTATO PREVISIONALE (Ricavi − Costi).
 * Colonna unica: Voce | Preventivo. Negativi in rosso col meno (Excel: number
 * format [Red]; PDF: testo rosso).
 *
 * Fonti dati e ordinamento sono in src/lib/bilancioExport.ts (verificati su DB).
 * Tutto client-side: nessuna edge function, nessuna scrittura su DB.
 */

import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { X, FileSpreadsheet, FileText, Download } from 'lucide-react'
import { useToast } from './Toast'
import {
  buildSheets,
  fmtEuroIt,
  periodLabel,
  slugify,
  sheetName,
  XLSX_EURO_FMT,
  type CenterSheet,
  type ExportSection,
  type BudgetEntryLite,
  type MonthlyMap,
  type CoaNode,
  type CenterRef,
} from '../lib/bilancioExport'

type CostCenter = { code: string; label?: string; name?: string }

type PeriodType = 'mensile' | 'trimestrale' | 'annuale' | 'custom'
type FormatType = 'excel' | 'pdf'

type Props = {
  open: boolean
  onClose: () => void
  budgetEntries: BudgetEntryLite[]
  operativeOutlets: CostCenter[]
  hq: CostCenter | null
  revMonthly: MonthlyMap
  consMonthly: MonthlyMap
  coaCosti: CoaNode[]
  coaRicavi: CoaNode[]
  year: number
  tenantName: string
  tenantCode: string
  userEmail: string
}

const MESI_IT = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

const PREV_NOTE = 'Solo colonna Preventivo · negativi in rosso · sottoconti esplosi sotto ogni macro.'

const centerRef = (c: CostCenter): CenterRef => ({ code: c.code, label: c.label || c.name || c.code })

export default function ExportBilancioDialog({
  open, onClose, budgetEntries, operativeOutlets, hq, revMonthly, consMonthly,
  coaCosti, coaRicavi, year, tenantName, tenantCode, userEmail,
}: Props) {
  const { toast } = useToast()
  const [periodType, setPeriodType] = useState<PeriodType>('annuale')
  const [singleMonth, setSingleMonth] = useState(new Date().getMonth() + 1)
  const [trimestre, setTrimestre] = useState<1 | 2 | 3 | 4>(1)
  const [customFrom, setCustomFrom] = useState(1)
  const [customTo, setCustomTo] = useState(12)
  const [format, setFormat] = useState<FormatType>('excel')
  const [outletFilter, setOutletFilter] = useState<string>('__all__') // __all__ o cost_center code
  const [generating, setGenerating] = useState(false)

  // Intervallo mesi in base al periodo scelto
  const monthRange = useMemo((): { from: number; to: number } => {
    switch (periodType) {
      case 'mensile':
        return { from: singleMonth, to: singleMonth }
      case 'trimestrale': {
        const from = (trimestre - 1) * 3 + 1
        return { from, to: from + 2 }
      }
      case 'annuale':
        return { from: 1, to: 12 }
      case 'custom':
        return { from: Math.min(customFrom, customTo), to: Math.max(customFrom, customTo) }
    }
  }, [periodType, singleMonth, trimestre, customFrom, customTo])

  const periodTxt = periodLabel(monthRange.from, monthRange.to, year)

  const sheets = useMemo<CenterSheet[]>(() => {
    if (!open) return []
    return buildSheets({
      selection: outletFilter,
      operativeOutlets: operativeOutlets.map(centerRef),
      hq: hq ? centerRef(hq) : null,
      fromMonth: monthRange.from,
      toMonth: monthRange.to,
      budgetEntries,
      revMonthly,
      consMonthly,
      coaCosti,
      coaRicavi,
    })
  }, [open, outletFilter, operativeOutlets, hq, monthRange, budgetEntries, revMonthly, consMonthly, coaCosti, coaRicavi])

  const outletLabel = (code: string): string => {
    if (code === '__all__') return 'Tutti (Totale azienda + outlet + Sede)'
    const found = operativeOutlets.find((o) => o.code === code)
    if (found) return found.label || found.name || code
    if (hq && hq.code === code) return hq.label || hq.name || code
    return code
  }

  function fileBase(): string {
    const outletSlug = outletFilter === '__all__' ? 'tutti' : (slugify(outletLabel(outletFilter)) || outletFilter)
    const ts = new Date().toISOString().slice(0, 10)
    return `bilancio_previsionale_${slugify(tenantCode)}_${outletSlug}_${slugify(periodTxt)}_${ts}`
  }

  // ─── EXCEL ──────────────────────────────────────────────────────────────
  function generaExcel() {
    const wb = XLSX.utils.book_new()
    const usedNames = new Set<string>()

    sheets.forEach((sheet) => {
      type Cell = string | number
      const aoa: Cell[][] = []
      const rowLevels: number[] = []
      const pushRow = (cells: Cell[], level = 0) => { aoa.push(cells); rowLevels.push(level) }

      pushRow([`${tenantName} — ${sheet.title} — Previsionale ${year}`])
      pushRow([`Periodo: ${periodTxt}`])
      pushRow([`Nota: ${PREV_NOTE}`])
      pushRow([])
      pushRow(['Voce', 'Preventivo'])

      const emitSection = (sec: ExportSection) => {
        pushRow([sec.title])
        sec.rows.forEach((r) => {
          pushRow([`${'    '.repeat(r.depth)}${r.label}`, r.prev], Math.min(r.depth, 7))
        })
        pushRow([sec.totalLabel, sec.totalPrev])
      }

      // Ordine come l'anteprima: Ricavi sopra, Costi sotto, poi Risultato.
      emitSection(sheet.ricavi)
      pushRow([])
      emitSection(sheet.costi)
      pushRow([])
      pushRow(['RISULTATO PREVISIONALE', sheet.ricavi.totalPrev - sheet.costi.totalPrev])

      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 56 }, { wch: 18 }]
      // Outline righe (raggruppamento espandibile) + sommario sopra i sottoconti
      ws['!rows'] = rowLevels.map((lvl) => (lvl > 0 ? { level: lvl } : {}))
      ;(ws as { [k: string]: unknown })['!outline'] = { above: true }

      // Number format euro: nero positivo, rosso negativo (no verde). Colonna 1.
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
      for (let r = range.s.r; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })] as { t?: string; z?: string } | undefined
        if (cell && cell.t === 'n') cell.z = XLSX_EURO_FMT
      }

      let name = sheetName(sheet.title)
      let i = 2
      while (usedNames.has(name.toLowerCase())) { name = sheetName(`${sheet.title} ${i++}`) }
      usedNames.add(name.toLowerCase())
      XLSX.utils.book_append_sheet(wb, ws, name)
    })

    XLSX.writeFile(wb, `${fileBase()}.xlsx`)
  }

  // ─── PDF ────────────────────────────────────────────────────────────────
  function generaPdf() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const RED: [number, number, number] = [220, 38, 38]
    const isNeg = (txt: string) => txt.trim().startsWith('-')

    sheets.forEach((sheet, sIdx) => {
      if (sIdx > 0) doc.addPage()
      doc.setFontSize(13)
      doc.setTextColor(15, 23, 42)
      doc.text(`${tenantName} — ${sheet.title} — Previsionale ${year}`, 40, 44)
      doc.setFontSize(9)
      doc.setTextColor(100, 116, 139)
      doc.text(`Periodo: ${periodTxt}`, 40, 60)
      doc.text(PREV_NOTE, 40, 73, { maxWidth: 515 })

      let startY = 90
      const emitSection = (sec: ExportSection) => {
        type Meta = { macro: boolean; total: boolean }
        const meta: Meta[] = []
        const body = sec.rows.map((r) => {
          meta.push({ macro: r.isMacro, total: false })
          return [`${'   '.repeat(r.depth)}${r.label}`, fmtEuroIt(r.prev)]
        })
        meta.push({ macro: false, total: true })
        body.push([sec.totalLabel, fmtEuroIt(sec.totalPrev)])

        autoTable(doc, {
          startY,
          head: [[sec.title, 'Preventivo']],
          body,
          theme: 'grid',
          styles: { fontSize: 7.5, cellPadding: 2.5, overflow: 'linebreak', textColor: [30, 41, 59] },
          headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold', halign: 'left' },
          columnStyles: {
            0: { cellWidth: 414, halign: 'left' },
            1: { cellWidth: 100, halign: 'right' },
          },
          margin: { left: 40, right: 40 },
          didParseCell: (data) => {
            const m = meta[data.row.index]
            if (data.section === 'body' && m && (m.macro || m.total)) data.cell.styles.fontStyle = 'bold'
            // Negativi in rosso (colonna importi)
            if (data.section === 'body' && data.column.index === 1) {
              const text = Array.isArray(data.cell.text) ? data.cell.text.join('') : String(data.cell.text)
              if (isNeg(text)) data.cell.styles.textColor = RED
            }
          },
        })
        const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
        startY = (after ? after.finalY : startY) + 14
      }

      // Ordine come l'anteprima: Ricavi sopra, Costi sotto.
      emitSection(sheet.ricavi)
      emitSection(sheet.costi)

      // Riga RISULTATO PREVISIONALE = Ricavi − Costi
      const ris = sheet.ricavi.totalPrev - sheet.costi.totalPrev
      autoTable(doc, {
        startY,
        body: [['RISULTATO PREVISIONALE', fmtEuroIt(ris)]],
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 3, fontStyle: 'bold', textColor: [15, 23, 42] },
        columnStyles: { 0: { cellWidth: 414 }, 1: { cellWidth: 100, halign: 'right' } },
        margin: { left: 40, right: 40 },
        didParseCell: (data) => {
          if (data.column.index === 1 && isNeg(fmtEuroIt(ris))) data.cell.styles.textColor = RED
        },
      })
    })

    doc.save(`${fileBase()}.pdf`)
  }

  function genera() {
    setGenerating(true)
    try {
      if (format === 'excel') generaExcel()
      else generaPdf()
      onClose()
    } catch (err) {
      console.error('[ExportBilancio]', err)
      toast({ type: 'error', message: 'Errore durante la generazione del file. Vedi console per dettagli.' })
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
              <h2 className="text-lg font-bold text-slate-900">Esporta bilancio previsionale</h2>
              <p className="text-sm text-slate-500">Vista gerarchica previsionale (macro + sottoconti esplosi) per outlet e Totale azienda</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X size={20} className="text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Formato */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Formato</label>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setFormat('excel')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 ${
                  format === 'excel' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600'
                }`}>
                <FileSpreadsheet size={16} /> Excel (multi-foglio)
              </button>
              <button onClick={() => setFormat('pdf')}
                className={`px-3 py-2 rounded-lg text-sm font-medium border flex items-center gap-2 ${
                  format === 'pdf' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600'
                }`}>
                <FileText size={16} /> PDF
              </button>
            </div>
          </div>

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

          {/* Outlet */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Scheda</label>
            <select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
              <option value="__all__">Tutti (Totale azienda + outlet + Sede)</option>
              {operativeOutlets.map((o) => (
                <option key={o.code} value={o.code}>{o.label || o.name || o.code}</option>
              ))}
              {hq && <option value={hq.code}>{hq.label || hq.name || hq.code}</option>}
            </select>
          </div>

          {/* Anteprima */}
          <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
            <div className="font-semibold text-slate-800 mb-1">Anteprima export</div>
            <div>🗂️ Formato: <span className="font-medium">{format === 'excel' ? 'Excel multi-foglio' : 'PDF'}</span></div>
            <div>📅 Periodo: <span className="font-medium">{periodTxt}</span></div>
            <div>🏪 Scheda: <span className="font-medium">{outletLabel(outletFilter)}</span></div>
            <div>📄 {format === 'excel' ? 'Fogli' : 'Pagine'} nel file: <span className="font-medium">{sheets.length}</span></div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">
            Annulla
          </button>
          <button onClick={genera}
            disabled={generating || sheets.length === 0}
            className="px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
            <Download size={16} />
            {generating ? 'Generazione…' : (format === 'excel' ? 'Scarica Excel' : 'Scarica PDF')}
          </button>
        </div>
      </div>
    </div>
  )
}
