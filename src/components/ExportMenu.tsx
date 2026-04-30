import React, { useState, useRef, useEffect } from 'react'
import { Download, FileText, Table, FileSpreadsheet } from 'lucide-react'

interface ExportColumn {
  key: string
  label: string
  format?: 'euro' | 'date' | 'percent'
}

interface ExportMenuProps {
  data: Record<string, unknown>[] // TODO: tighten type
  columns: ExportColumn[]
  filename?: string
  title?: string
}

export default function ExportMenu({ data, columns, filename = 'export', title }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function formatValue(row: Record<string, unknown>, col: ExportColumn): string {
    const val = row[col.key]
    if (val == null) return ''
    if (col.format === 'euro') return `\u20AC ${Number(val).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`
    if (col.format === 'date') return val ? new Date(val as string).toLocaleDateString('it-IT') : ''
    if (col.format === 'percent') return `${Number(val).toFixed(1)}%`
    return String(val)
  }

  function rawValue(row: Record<string, unknown>, col: ExportColumn): unknown {
    const val = row[col.key]
    if (val == null) return ''
    return val
  }

  // CSV Export
  function exportCSV() {
    setExporting('csv')
    try {
      const header = columns.map(c => `"${c.label}"`).join(',')
      const rows = data.map(row =>
        columns.map(col => {
          const v = formatValue(row, col)
          return `"${String(v).replace(/"/g, '""')}"`
        }).join(',')
      )
      const csv = [header, ...rows].join('\n')
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      downloadBlob(blob, `${filename}.csv`)
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }

  // Excel (XLSX via simple HTML table)
  function exportExcel() {
    setExporting('xlsx')
    try {
      let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>'
      html += `<table border="1"><thead><tr>${columns.map(c => `<th style="background:#f1f5f9;font-weight:bold;padding:6px">${c.label}</th>`).join('')}</tr></thead><tbody>`
      data.forEach(row => {
        html += '<tr>'
        columns.forEach(col => {
          const v = formatValue(row, col)
          const isNum = col.format === 'euro' || col.format === 'percent' || typeof rawValue(row, col) === 'number'
          html += `<td style="padding:4px;${isNum ? 'text-align:right' : ''}">${v}</td>`
        })
        html += '</tr>'
      })
      html += '</tbody></table></body></html>'
      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
      downloadBlob(blob, `${filename}.xls`)
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }

  // PDF (simple HTML print)
  function exportPDF() {
    setExporting('pdf')
    try {
      const printWindow = window.open('', '_blank')
      if (!printWindow) { alert('Abilita i popup per esportare in PDF'); return }

      let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title || filename}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 11px; color: #334155; margin: 20px; }
        h1 { font-size: 16px; margin-bottom: 4px; }
        .subtitle { color: #94a3b8; font-size: 10px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f1f5f9; font-weight: 600; text-align: left; padding: 6px 8px; border-bottom: 2px solid #e2e8f0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; }
        td { padding: 5px 8px; border-bottom: 1px solid #f1f5f0; }
        tr:nth-child(even) { background: #fafafa; }
        .right { text-align: right; }
        @media print { body { margin: 0; } }
      </style></head><body>`

      if (title) html += `<h1>${title}</h1>`
      html += `<div class="subtitle">Esportato il ${new Date().toLocaleDateString('it-IT')} \u2014 ${data.length} righe</div>`
      html += `<table><thead><tr>${columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>`
      data.forEach(row => {
        html += '<tr>'
        columns.forEach(col => {
          const v = formatValue(row, col)
          const isRight = col.format === 'euro' || col.format === 'percent'
          html += `<td${isRight ? ' class="right"' : ''}>${v}</td>`
        })
        html += '</tr>'
      })
      html += '</tbody></table></body></html>'

      printWindow.document.write(html)
      printWindow.document.close()
      setTimeout(() => { printWindow.print() }, 300)
    } finally {
      setExporting(null)
      setOpen(false)
    }
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (!data || data.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 hover:bg-slate-50 transition text-slate-600"
      >
        <Download size={14} />
        Esporta
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
          <button
            onClick={exportPDF}
            disabled={exporting === 'pdf'}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <FileText size={15} className="text-red-500" />
            {exporting === 'pdf' ? 'Generazione...' : 'PDF (stampa)'}
          </button>
          <button
            onClick={exportExcel}
            disabled={exporting === 'xlsx'}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <FileSpreadsheet size={15} className="text-emerald-500" />
            {exporting === 'xlsx' ? 'Generazione...' : 'Excel (.xls)'}
          </button>
          <button
            onClick={exportCSV}
            disabled={exporting === 'csv'}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition"
          >
            <Table size={15} className="text-blue-500" />
            {exporting === 'csv' ? 'Generazione...' : 'CSV'}
          </button>
        </div>
      )}
    </div>
  )
}
