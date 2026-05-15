import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Landmark, Building2, Wallet, CreditCard, TrendingUp, TrendingDown,
  Search, ChevronDown, ChevronUp, Banknote, Store, PiggyBank,
  Plus, Edit2, Trash2, Check, X, AlertCircle, Download, Upload,
  ArrowUpRight, ArrowDownLeft, Filter, Eye, EyeOff, RefreshCw,
  Clock, ListOrdered, Link2, CheckCircle2, History, FileText,
  ChevronLeft, ChevronRight, ArrowRight, Send, Ban, Percent,
  Calendar, Info, MoreVertical, Copy, FileUp, Layers, Unlink,
  CircleDot, Sparkles, Receipt, ChevronsUpDown, AlertTriangle,
  BarChart3, PieChart as PieChartIcon, Table2, Columns3
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, Cell, Legend
} from 'recharts'
import { useSearchParams } from 'react-router-dom'

// Tab principale TesoreriaManuale — persistito in URL come ?tab=
type TesoreriaTab = 'panoramica' | 'conti' | 'movimenti' | 'riconciliazione'
const VALID_TESORERIA_TABS: TesoreriaTab[] = ['panoramica', 'conti', 'movimenti', 'riconciliazione']
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLabels } from '../hooks/useCompanyLabels'

// ═══════════════════════════════════════════════════════════════════
// ═══ HELPERS ═══
// ═══════════════════════════════════════════════════════════════════

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#f97316']

const TABS = [
  { key: 'panoramica', label: 'Panoramica', icon: BarChart3 },
  { key: 'conti', label: 'Conti Bancari', icon: Building2 },
  { key: 'movimenti', label: 'Movimenti', icon: ArrowUpRight },
  { key: 'riconciliazione', label: 'Riconciliazione', icon: Link2 },
] as const

const ACCOUNT_TYPES = [
  { value: 'conto_corrente', label: 'C/C' },
  { value: 'deposito', label: 'Deposito' },
  { value: 'cassa', label: 'Cassa' },
  { value: 'pos', label: 'POS' },
  { value: 'carta_credito', label: 'Carta di credito' },
]

function fmt(n: number | null | undefined, dec = 2) {
  if (n == null || isNaN(n)) return '\u2014'
  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(n)
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '\u2014'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '\u2014'
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDateShort(d: string | null | undefined) {
  if (!d) return '\u2014'
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return '\u2014'
  return dt.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
}

function maskIban(iban: string | null | undefined) {
  if (!iban || iban.length < 10) return iban || '\u2014'
  return iban.slice(0, 4) + '\u2022\u2022\u2022\u2022\u2022\u2022' + iban.slice(-4)
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const target = new Date(dateStr)
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function classNames(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

// Helper: nome fornitore da payable (fallback: JOIN suppliers → supplier_name diretto)
type PayableLike = { suppliers?: { ragione_sociale?: string | null; name?: string | null } | null; supplier_name?: string | null; [k: string]: unknown }
function getSupplierName(p: PayableLike) {
  return p.suppliers?.ragione_sociale || p.suppliers?.name || p.supplier_name || '—'
}

function statusBadge(status: string | null | undefined) {
  const map: Record<string, { bg: string; label: string }> = {
    // Italian DB status values (actual)
    da_pagare: { bg: 'bg-amber-100 text-amber-700', label: 'Da pagare' },
    scaduto: { bg: 'bg-red-100 text-red-800 font-semibold', label: 'Scaduta' },
    in_scadenza: { bg: 'bg-yellow-100 text-yellow-700', label: 'In scadenza' },
    pagato: { bg: 'bg-emerald-100 text-emerald-700', label: 'Pagata' },
    parziale: { bg: 'bg-amber-100 text-amber-700', label: 'Parziale' },
    sospeso: { bg: 'bg-slate-100 text-slate-600', label: 'Sospesa' },
    // English status values (payment_batches / payment_batch_items)
    draft: { bg: 'bg-slate-100 text-slate-600', label: 'Bozza' },
    pending: { bg: 'bg-amber-100 text-amber-700', label: 'In attesa' },
    sent: { bg: 'bg-blue-100 text-blue-700', label: 'Inviata' },
    executed: { bg: 'bg-emerald-100 text-emerald-700', label: 'Eseguita' },
    cancelled: { bg: 'bg-slate-100 text-slate-500', label: 'Annullata' },
    paid: { bg: 'bg-emerald-100 text-emerald-700', label: 'Pagata' },
  }
  const s = map[status || ''] || { bg: 'bg-slate-100 text-slate-600', label: status || '\u2014' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.bg}`}>{s.label}</span>
}

type TooltipPayload = { name?: string; value?: number; color?: string }
function GlassTooltipContent({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string | number }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white/90 backdrop-blur-xl border border-white/50 rounded-xl px-4 py-3 shadow-lg">
      {label && <p className="text-xs font-semibold text-slate-700 mb-1.5">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-sm" style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{fmt(p.value)} {'€'}</span>
        </p>
      ))}
    </div>
  )
}

// CSV Parser utilities
// ═══ IMPORT XLSX LIBRARY (SheetJS) ═══
import * as XLSX from 'xlsx'

function detectSeparator(text: string) {
  const firstLines = text.split('\n').slice(0, 5).join('\n')
  const counts: Record<string, number> = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of firstLines) {
    if (ch in counts) counts[ch]++
  }
  // Nella banche italiane il ; e' piu' comune — se parita' preferisci ;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return sorted[0][1] > 0 ? sorted[0][0] : ';'
}

function detectDateFormat(val: unknown) {
  if (!val) return 'unknown'
  const trimmed = String(val).trim()
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return 'dd/mm/yyyy'
  if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) return 'dd-mm-yyyy'
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return 'yyyy-mm-dd'
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) return 'dd.mm.yyyy'
  if (/^\d{2}\/\d{2}\/\d{2}$/.test(trimmed)) return 'dd/mm/yy'
  // Excel serial number (es. 45735)
  if (/^\d{5}$/.test(trimmed)) return 'excel_serial'
  return 'unknown'
}

function parseCSVDate(val: unknown, format?: string) {
  if (!val) return null
  const trimmed = String(val).trim()
  // Excel serial number
  if (format === 'excel_serial' || /^\d{5}$/.test(trimmed)) {
    const serial = parseInt(trimmed)
    if (serial > 0) {
      const d = new Date((serial - 25569) * 86400 * 1000)
      return d.toISOString().split('T')[0]
    }
  }
  // JS Date object (from XLSX)
  if (val instanceof Date) {
    return val.toISOString().split('T')[0]
  }

  // Splitta su qualsiasi separatore (/ - .)
  const parts = trimmed.split(/[\/\-.]/).map(p => p.trim()).filter(Boolean)
  if (parts.length !== 3) {
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
    return trimmed
  }

  let day, month, year
  const p0 = parseInt(parts[0]), p2 = parseInt(parts[2])

  // Logica intelligente: se il primo numero è > 31, è l'anno (yyyy-mm-dd)
  // Se l'ultimo numero è > 31 o ha 4 cifre, è l'anno (dd/mm/yyyy)
  // Se l'ultimo ha 2 cifre e <= 31, potrebbe essere dd/mm/yy
  if (parts[0].length === 4 || p0 > 31) {
    // yyyy-mm-dd o yyyy/mm/dd
    year = parts[0]; month = parts[1]; day = parts[2]
  } else if (parts[2].length === 4 || p2 > 31) {
    // dd/mm/yyyy — formato italiano standard
    day = parts[0]; month = parts[1]; year = parts[2]
  } else if (parts[2].length === 2) {
    // dd/mm/yy — anno corto
    day = parts[0]; month = parts[1]
    year = p2 > 50 ? '19' + parts[2] : '20' + parts[2]
  } else {
    // Fallback: tratta come dd/mm/yyyy (default italiano)
    day = parts[0]; month = parts[1]; year = parts[2]
  }

  // Validazione: mese 1-12, giorno 1-31
  const m = parseInt(month), d = parseInt(day)
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    // Prova swappare giorno e mese
    if (d >= 1 && d <= 12 && m >= 1 && m <= 31) {
      const tmp = day; day = month; month = tmp
    }
  }

  if (!year || !month || !day) return trimmed
  const y = String(year).length === 2 ? (parseInt(year) > 50 ? '19' + year : '20' + year) : year
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseCSVNumber(val: unknown) {
  if (val == null) return 0
  // Se e' gia' un numero (da XLSX)
  if (typeof val === 'number') return val
  const str = String(val).trim()
  if (!str) return 0
  const cleaned = str.replace(/[^\d,.\-+]/g, '')
  if (!cleaned || cleaned === '-') return 0
  // Italian format: 1.234,56 (punto migliaia, virgola decimale)
  if (cleaned.includes(',') && cleaned.indexOf(',') > cleaned.lastIndexOf('.')) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0
  }
  // English format: 1,234.56 (virgola migliaia, punto decimale)
  if (cleaned.includes('.') && cleaned.indexOf('.') > cleaned.lastIndexOf(',')) {
    return parseFloat(cleaned.replace(/,/g, '')) || 0
  }
  // Solo virgola come decimale (es. "1234,56")
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    return parseFloat(cleaned.replace(',', '.')) || 0
  }
  return parseFloat(cleaned) || 0
}

function parseCSV(text: string) {
  const separator = detectSeparator(text)
  // Rimuovi BOM UTF-8
  const cleanText = text.replace(/^\uFEFF/, '')
  const lines = cleanText.split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l.length > 0)
  if (lines.length < 2) return { headers: [] as string[], rows: [] as string[][], separator }

  // Trova la riga header: salta righe vuote o che iniziano con numeri (possono essere intestazione banca)
  let headerIdx = 0
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cells = lines[i].split(separator).map((c: string) => c.replace(/^"|"$/g, '').trim())
    // Header ha tipicamente testo non numerico in almeno 2 celle
    const textCells = cells.filter((c: string) => c && !/^\d+[.,]?\d*$/.test(c))
    if (textCells.length >= 2) { headerIdx = i; break }
  }

  const headers = lines[headerIdx].split(separator).map((h: string) => h.replace(/^"|"$/g, '').trim())
  const rows = lines.slice(headerIdx + 1).map((line: string) => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === separator && !inQuotes) { cells.push(current.trim()); current = ''; continue }
      current += ch
    }
    cells.push(current.trim())
    return cells
  }).filter((r: string[]) => r.some((c: string) => c.length > 0))
  return { headers, rows, separator, skippedRows: headerIdx }
}

// Parser per file Excel (XLSX/XLS) via SheetJS
function parseExcelFile(arrayBuffer: ArrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]

  // Converti in array of arrays preservando date e numeri
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'dd/mm/yyyy' }) as unknown[][]
  if (rawData.length < 2) return { headers: [] as string[], rows: [] as string[][], separator: 'xlsx', sheetNames: wb.SheetNames }

  // Trova la riga header (salta righe vuote, titoli banca, righe saldo)
  // Blacklist: frasi che appaiono in righe informative, NON header
  const headerBlacklist = ['saldo contabile', 'saldo iniziale', 'saldo finale', 'saldo disponibile',
    'estratto conto', 'periodo dal', 'data stampa', 'filiale', 'intestatario', 'codice iban',
    'numero conto', 'divisa', 'coordinate', 'c/c n', 'rapporto n', 'ragione sociale',
    'operazioni non contabilizzate', 'filtri applicati', 'tipo rapporto', 'intestazione']
  let headerIdx = 0
  for (let i = 0; i < Math.min(rawData.length, 50); i++) {
    const row = rawData[i]
    if (!Array.isArray(row)) continue
    const nonEmpty = row.filter((c: unknown) => c != null && String(c).trim() !== '')
    if (nonEmpty.length < 3) continue
    // Salta righe con frasi blacklisted (sono righe informative, non header)
    const rowText = nonEmpty.map((c: unknown) => String(c).toLowerCase()).join(' ')
    if (headerBlacklist.some(bl => rowText.includes(bl))) continue
    // Header: celle corte (< 30 char), prevalentemente testo, no ":" nei valori
    const textCells = nonEmpty.filter((c: unknown) => {
      const s = String(c).trim()
      return s.length > 0 && s.length < 35 && !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s) && !/^[\d.,]+$/.test(s)
    })
    // Almeno 2 celle testuali corte e la maggior parte delle celle non-vuote sono corte
    const avgLen = nonEmpty.reduce<number>((sum, c) => sum + String(c).length, 0) / nonEmpty.length
    if (textCells.length >= 2 && avgLen < 25) { headerIdx = i; break }
  }

  const headerRow = rawData[headerIdx] as unknown[]
  const headers = headerRow.map((h: unknown) => String(h || '').trim())
  console.log('[parseExcelFile] headerIdx:', headerIdx, 'headers:', headers, 'rawData rows:', rawData.length)
  const dataBlacklist = ['saldo contabile iniziale', 'saldo contabile finale', 'operazioni non contabilizzate',
    'totale movimenti', 'elenco non completo', 'per visualizzare gli altri dati', 'movimenti:',
    'operazioni contabilizzate', 'saldo iniziale', 'saldo finale', 'saldo disponibile']
  const rows: string[][] = rawData.slice(headerIdx + 1)
    .filter((r: unknown): r is unknown[] => {
      if (!Array.isArray(r)) return false
      // Non fermarsi alle righe vuote — SKIP, non BREAK
      if (!r.some((c: unknown) => c != null && String(c).trim() !== '')) return false
      const rowText = r.filter(Boolean).join(' ').toLowerCase()
      return !dataBlacklist.some(bl => rowText.includes(bl))
    })
    .map((r: unknown[]) => r.map((c: unknown) => {
      if (c instanceof Date) return c.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
      // Gestione celle multilinea — normalizza newline in spazi
      return String(c ?? '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    }))

  return { headers, rows, separator: 'xlsx', sheetNames: wb.SheetNames, skippedRows: headerIdx }
}

// Auto-detect column mappings (intelligente per banche italiane)
type ColMap = { date: number; description: number; amount: number; dare: number; avere: number; balance: number }
function autoMapColumns(headers: string[]): ColMap {
  const map: ColMap = { date: -1, description: -1, amount: -1, dare: -1, avere: -1, balance: -1 }

  // Pattern flessibili — match parziale su molte varianti banche italiane
  const datePatterns = ['data', 'date', 'dt', 'val', 'valuta', 'contab', 'operaz', 'registr', 'compet']
  const descPatterns = ['descri', 'causale', 'dettagl', 'operaz', 'movimen', 'motivo', 'beneficiari', 'tipo', 'riferim', 'note', 'testo', 'concetto']
  const amountPatterns = ['importo', 'amount', 'totale', 'controvalore', 'eur', '€']
  const darePatterns = ['dare', 'debit', 'addebit', 'uscit', 'pagament', 'prelevam']
  const averePatterns = ['avere', 'credit', 'accredit', 'entrat', 'incass', 'versament']
  const balancePatterns = ['saldo', 'balance', 'disponi', 'contabile']

  // Prima passata: match esatti e parziali sui nomi
  headers.forEach((h, i) => {
    const low = h.toLowerCase().trim().replace(/[.\s_-]+/g, ' ')
    // Data — preferenza: "data contabile" > "data operazione" > "data" > "dt"
    if (map.date === -1 && datePatterns.some(w => low.includes(w))) {
      // Evita "data valuta" se c'e' gia' una "data contabile" o "data operazione"
      map.date = i
    }
    // Descrizione (ma NON se e' "data descrizione" o simile)
    if (map.description === -1 && descPatterns.some(w => low.includes(w)) && !low.includes('data')) map.description = i
    // Dare
    if (map.dare === -1 && darePatterns.some(w => low.includes(w))) map.dare = i
    // Avere
    if (map.avere === -1 && averePatterns.some(w => low.includes(w))) map.avere = i
    // Importo singolo (solo se non e' dare/avere)
    if (map.amount === -1 && amountPatterns.some(w => low.includes(w)) && !darePatterns.some(w => low.includes(w)) && !averePatterns.some(w => low.includes(w))) map.amount = i
    // Saldo (solo se contiene specificamente "saldo" o "balance")
    if (map.balance === -1 && (low.includes('saldo') || low.includes('balance'))) map.balance = i
  })

  // Seconda passata: se non abbiamo trovato la descrizione, cerca la colonna di testo piu' larga
  if (map.description === -1) {
    // Prendi colonna non ancora assegnata che sembra testuale
    const assigned = new Set([map.date, map.amount, map.dare, map.avere, map.balance].filter(x => x >= 0))
    headers.forEach((h, i) => {
      if (!assigned.has(i) && map.description === -1) {
        const low = h.toLowerCase()
        // Se contiene parole generiche che indicano testo
        if (low.includes('descri') || low.includes('tipo') || low.includes('causale') || low.includes('operazione')) {
          map.description = i
        }
      }
    })
  }

  // Se non abbiamo trovato ne' importo ne' dare/avere, cerca colonne con nomi generici numerici
  if (map.amount === -1 && map.dare === -1 && map.avere === -1) {
    headers.forEach((h, i) => {
      const low = h.toLowerCase()
      if (low.includes('import') || low.includes('eur') || low.includes('€') || low.includes('movim')) {
        if (map.amount === -1) map.amount = i
      }
    })
  }

  console.log('[autoMapColumns] headers:', headers, 'mapping:', map)
  return map
}

// ═══════════════════════════════════════════════════════════════════
// ═══ SHARED UI COMPONENTS ═══
// ═══════════════════════════════════════════════════════════════════

type KpiColorT = 'blue' | 'green' | 'amber' | 'purple' | 'red' | 'cyan'
function KpiCard({ title, value, subtitle, icon: Icon, color = 'blue', onClick }: { title: string; value: string | number; subtitle?: string; icon: React.ComponentType<{ size?: number }>; color?: KpiColorT; onClick?: () => void }) {
  const colorMap: Record<KpiColorT, string> = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
    cyan: 'bg-cyan-50 text-cyan-600',
  }
  return (
    <div
      className={classNames(
        'bg-white rounded-xl border border-slate-200 p-5 shadow-sm',
        onClick && 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all'
      )}
      onClick={onClick}
    >
      <div className={`p-2.5 rounded-lg ${colorMap[color]} inline-flex mb-3`}>
        <Icon size={20} />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500 mt-0.5">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
    </div>
  )
}

function EmptyState({ icon: Icon, title, description, action }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="p-4 bg-slate-100 rounded-2xl mb-4">
        <Icon size={32} className="text-slate-400" />
      </div>
      <h3 className="text-lg font-semibold text-slate-700 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 max-w-md mb-4">{description}</p>
      {action}
    </div>
  )
}

function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; maxWidth?: string }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${maxWidth} max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition text-slate-400">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Conferma', danger = false }: { isOpen: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmLabel?: string; danger?: boolean }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2 rounded-lg ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
            <AlertTriangle size={20} className={danger ? 'text-red-600' : 'text-amber-600'} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{title}</h3>
            <p className="text-sm text-slate-500 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">
            Annulla
          </button>
          <button onClick={onConfirm} className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
      <span className="text-sm text-slate-500">Pagina {page} di {totalPages}</span>
      <div className="flex gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} />
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          let pageNum
          if (totalPages <= 7) {
            pageNum = i + 1
          } else if (page <= 4) {
            pageNum = i + 1
          } else if (page >= totalPages - 3) {
            pageNum = totalPages - 6 + i
          } else {
            pageNum = page - 3 + i
          }
          return (
            <button
              key={pageNum}
              onClick={() => onPageChange(pageNum)}
              className={classNames(
                'px-3 py-1.5 rounded-lg text-sm font-medium',
                pageNum === page ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 text-slate-600'
              )}
            >
              {pageNum}
            </button>
          )
        })}
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ TAB 1: PANORAMICA ═══
// ═══════════════════════════════════════════════════════════════════

type AccountT = Record<string, unknown> & { id: string; bank_name?: string | null; account_name?: string | null; current_balance?: number | null; credit_line?: number | null; iban?: string | null; account_type?: string | null; last_balance_update?: string | null }
type TransactionT = Record<string, unknown> & { id: string; transaction_date?: string | null; amount?: number | null; type?: string | null; description?: string | null; bank_account_id?: string | null; reconciliation_status?: string | null; counterpart_name?: string | null; is_reconciled?: boolean | null; note?: string | null; reconciled_at?: string | null; reconciled_invoice_id?: string | null }
type PayableT = Record<string, unknown> & { id: string; due_date?: string | null; amount?: number | null; gross_amount?: number | null; amount_paid?: number | null; amount_remaining?: number | null; supplier_name?: string | null; invoice_number?: string | null; status?: string | null; suppliers?: { ragione_sociale?: string | null; name?: string | null; iban?: string | null } | null }
function TabPanoramica({ accounts, transactions, payables, onNavigate }: { accounts: AccountT[]; transactions: TransactionT[]; payables: PayableT[]; onNavigate: (tab: string) => void }) {
  const totalBalance = useMemo(() =>
    accounts.reduce<number>((sum, a) => sum + (Number(a.current_balance) || 0), 0),
    [accounts]
  )

  const totalCreditLine = useMemo(() =>
    accounts.reduce<number>((sum, a) => sum + (Number(a.credit_line) || 0), 0),
    [accounts]
  )

  const last30 = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    return transactions.filter(t => t.transaction_date && new Date(t.transaction_date) >= cutoff)
  }, [transactions])

  const inflows = useMemo(() => last30.filter(t => (t.amount || 0) > 0).reduce<number>((s, t) => s + (t.amount || 0), 0), [last30])
  const outflows = useMemo(() => last30.filter(t => (t.amount || 0) < 0).reduce<number>((s, t) => s + Math.abs(t.amount || 0), 0), [last30])

  const overduePayables = useMemo(() =>
    payables.filter(p => p.status === 'scaduto' || (p.status === 'da_pagare' && (daysUntil(p.due_date) ?? 0) < 0)),
    [payables]
  )

  const upcomingPayables = useMemo(() =>
    payables
      .filter(p => (p.status === 'da_pagare' || p.status === 'in_scadenza' || p.status === 'parziale') && (daysUntil(p.due_date) ?? -1) >= 0 && (daysUntil(p.due_date) ?? 99) <= 30)
      .sort((a, b) => new Date(a.due_date || 0).getTime() - new Date(b.due_date || 0).getTime()),
    [payables]
  )

  // Cashflow chart - last 30 days by day
  type CashflowDay = { date: string; label: string; entrate: number; uscite: number }
  const cashflowData = useMemo<CashflowDay[]>(() => {
    const days: Record<string, CashflowDay> = {}
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      days[key] = { date: key, label: fmtDateShort(key), entrate: 0, uscite: 0 }
    }
    last30.forEach(t => {
      const key = (t.transaction_date || '').split('T')[0]
      if (days[key]) {
        if ((t.amount || 0) > 0) days[key].entrate += (t.amount || 0)
        else days[key].uscite += Math.abs(t.amount || 0)
      }
    })
    return Object.values(days)
  }, [last30])

  // Recent movements (last 10)
  const recentMovements = useMemo(() =>
    [...transactions].sort((a, b) => new Date(b.transaction_date || 0).getTime() - new Date(a.transaction_date || 0).getTime()).slice(0, 10),
    [transactions]
  )

  // Per-bank balances for mini cards
  type BankSummaryT = { name: string; balance: number; count: number; accounts: AccountT[] }
  const bankSummary = useMemo<BankSummaryT[]>(() => {
    const banks: Record<string, BankSummaryT> = {}
    accounts.forEach(a => {
      const key = a.bank_name || 'Altro'
      if (!banks[key]) banks[key] = { name: key, balance: 0, count: 0, accounts: [] }
      banks[key].balance += Number(a.current_balance) || 0
      banks[key].count++
      banks[key].accounts.push(a)
    })
    return Object.values(banks).sort((a, b) => b.balance - a.balance)
  }, [accounts])

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={Wallet}
          title="Posizione di cassa"
          value={`${fmt(totalBalance)} \u20AC`}
          subtitle={`${accounts.length} conti attivi`}
          color="blue"
          onClick={() => onNavigate('conti')}
        />
        <KpiCard
          icon={ArrowUpRight}
          title="Entrate (30gg)"
          value={`+${fmt(inflows)} \u20AC`}
          subtitle={`${last30.filter(t => (t.amount || 0) > 0).length} movimenti`}
          color="green"
          onClick={() => onNavigate('movimenti')}
        />
        <KpiCard
          icon={ArrowDownLeft}
          title="Uscite (30gg)"
          value={`-${fmt(outflows)} \u20AC`}
          subtitle={`${last30.filter(t => (t.amount || 0) < 0).length} movimenti`}
          color="red"
          onClick={() => onNavigate('movimenti')}
        />
        <KpiCard
          icon={Link2}
          title="Da riconciliare"
          value={`${transactions.filter(t => !t.is_reconciled && (t.amount || 0) < 0).length}`}
          subtitle={transactions.filter(t => !t.is_reconciled && (t.amount || 0) < 0).length > 0 ? 'Movimenti in attesa' : 'Tutto riconciliato'}
          color={transactions.filter(t => !t.is_reconciled && (t.amount || 0) < 0).length > 0 ? 'amber' : 'green'}
          onClick={() => onNavigate('riconciliazione')}
        />
      </div>

      {/* Bank cards + Cashflow chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bank cards */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Saldi per banca</h3>
          {bankSummary.length === 0 ? (
            <p className="text-sm text-slate-400">Nessun conto configurato</p>
          ) : (
            bankSummary.map((bank, idx) => (
              <div key={bank.name} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition cursor-pointer" onClick={() => onNavigate('conti')}>
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg" style={{ backgroundColor: `${COLORS[idx % COLORS.length]}20` }}>
                    <Building2 size={18} style={{ color: COLORS[idx % COLORS.length] }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 text-sm">{bank.name}</div>
                    <div className="text-xs text-slate-400">{bank.count} cont{bank.count === 1 ? 'o' : 'i'}</div>
                  </div>
                  <div className={`text-right font-bold ${bank.balance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                    {fmt(bank.balance)} &euro;
                  </div>
                </div>
              </div>
            ))
          )}
          {totalCreditLine > 0 && (
            <div className="bg-purple-50 rounded-xl border border-purple-200 p-4">
              <div className="flex items-center gap-2 mb-1">
                <CreditCard size={16} className="text-purple-600" />
                <span className="text-sm font-medium text-purple-700">Fido disponibile</span>
              </div>
              <div className="text-lg font-bold text-purple-800">{fmt(totalCreditLine)} &euro;</div>
            </div>
          )}
        </div>

        {/* Cashflow chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Flusso di cassa (ultimi 30 giorni)</h3>
          {cashflowData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">Nessun dato disponibile</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={cashflowData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradEntrate" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradUscite" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltipContent />} />
                <Area type="monotone" dataKey="entrate" name="Entrate" stroke="#10b981" fill="url(#gradEntrate)" strokeWidth={2} />
                <Area type="monotone" dataKey="uscite" name="Uscite" stroke="#ef4444" fill="url(#gradUscite)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Upcoming payments + Recent movements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Scadenze prossimi 30 giorni</h3>
            <button onClick={() => onNavigate('pagamenti')} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              Vedi tutto &rarr;
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {upcomingPayables.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Nessuna scadenza imminente</p>
            ) : (
              upcomingPayables.slice(0, 8).map(p => {
                const days = daysUntil(p.due_date) ?? 99
                const remaining = Number(p.gross_amount || p.amount_remaining || 0)
                return (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className={classNames(
                      'text-xs font-bold rounded-lg px-2 py-1 min-w-[48px] text-center',
                      days <= 3 ? 'bg-red-100 text-red-700' : days <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                    )}>
                      {days === 0 ? 'Oggi' : days === 1 ? 'Domani' : `${days}gg`}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{getSupplierName(p)}</div>
                      <div className="text-xs text-slate-400">{String(p.invoice_number || '')} - Scadenza {fmtDate(p.due_date)}</div>
                    </div>
                    <div className="text-sm font-semibold text-slate-900 whitespace-nowrap">{fmt(remaining)} &euro;</div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Recent movements */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Ultimi movimenti</h3>
            <button onClick={() => onNavigate('movimenti')} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              Vedi tutto &rarr;
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {recentMovements.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Nessun movimento</p>
            ) : (
              recentMovements.map(m => {
                const acct = accounts.find(a => a.id === m.bank_account_id)
                const amt = Number(m.amount) || 0
                return (
                  <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                    <div className={classNames(
                      'p-1.5 rounded-lg',
                      amt >= 0 ? 'bg-emerald-50' : 'bg-red-50'
                    )}>
                      {amt >= 0 ? <ArrowDownLeft size={14} className="text-emerald-600" /> : <ArrowUpRight size={14} className="text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{(m.description as string | null) || (m.counterpart_name as string | null) || 'Movimento'}</div>
                      <div className="text-xs text-slate-400">{fmtDate(m.transaction_date)} {acct ? `\u2022 ${acct.account_name || acct.bank_name}` : ''}</div>
                    </div>
                    <div className={classNames('text-sm font-semibold whitespace-nowrap', amt >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {amt >= 0 ? '+' : ''}{fmt(amt)} &euro;
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ TAB 2: CONTI BANCARI ═══
// ═══════════════════════════════════════════════════════════════════

type AccountFormT = { bank_name: string; account_name: string; iban: string; account_type: string; current_balance: number; credit_line?: number; outlet_code?: string; note?: string; id?: string; color?: string }
function AddAccountModal({ isOpen, onClose, onSave, editAccount }: { isOpen: boolean; onClose: () => void; onSave: (data: AccountFormT) => void | Promise<void>; editAccount: AccountFormT | null }) {
  const labels = useCompanyLabels()
  const [form, setForm] = useState({
    bank_name: '', account_name: '', iban: '', account_type: 'conto_corrente',
    current_balance: 0, credit_line: 0, outlet_code: '', color: '#3b82f6', note: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (editAccount) {
      setForm({
        bank_name: editAccount.bank_name || '',
        account_name: editAccount.account_name || '',
        iban: editAccount.iban || '',
        account_type: editAccount.account_type || 'conto_corrente',
        current_balance: editAccount.current_balance || 0,
        credit_line: editAccount.credit_line || 0,
        outlet_code: editAccount.outlet_code || '',
        color: editAccount.color || '#3b82f6',
        note: editAccount.note || '',
      })
    } else {
      setForm({
        bank_name: '', account_name: '', iban: '', account_type: 'conto_corrente',
        current_balance: 0, credit_line: 0, outlet_code: '', color: '#3b82f6', note: '',
      })
    }
  }, [isOpen, editAccount])

  const handleSave = async () => {
    if (!form.bank_name.trim()) return
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editAccount ? 'Modifica Conto' : 'Nuovo Conto Bancario'}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Banca *</label>
            <input type="text" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="es. MPS, BCC..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome Conto</label>
            <input type="text" value={form.account_name} onChange={e => setForm({ ...form, account_name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="es. C/C Principale" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">IBAN</label>
          <input type="text" value={form.iban} onChange={e => setForm({ ...form, iban: e.target.value.toUpperCase() })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="IT..." />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
            <select value={form.account_type} onChange={e => setForm({ ...form, account_type: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Saldo attuale</label>
            <input type="number" step="0.01" value={form.current_balance} onChange={e => setForm({ ...form, current_balance: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Fido</label>
            <input type="number" step="0.01" value={form.credit_line} onChange={e => setForm({ ...form, credit_line: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{labels.pointOfSale}</label>
            <input type="text" value={form.outlet_code} onChange={e => setForm({ ...form, outlet_code: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="es. BRB, VDC..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Colore</label>
            <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })}
              className="w-full h-10 rounded-lg border border-slate-200 cursor-pointer" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Note</label>
          <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            Annulla
          </button>
          <button onClick={handleSave} disabled={saving || !form.bank_name.trim()}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function UpdateBalanceModal({ isOpen, onClose, account, onSave }: { isOpen: boolean; onClose: () => void; account: AccountT | null; onSave: (data: { balance: number; balance_date: string; notes: string }) => void | Promise<void> }) {
  const [balance, setBalance] = useState(0)
  const [balanceDate, setBalanceDate] = useState(new Date().toISOString().split('T')[0])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (account) {
      setBalance(account.current_balance || 0)
      setBalanceDate(new Date().toISOString().split('T')[0])
      setNotes('')
    }
  }, [isOpen, account])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({ balance, balance_date: balanceDate, notes })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Aggiorna saldo \u2014 ${account?.account_name || account?.bank_name || ''}`}>
      <div className="space-y-4">
        <div className="bg-slate-50 rounded-lg p-3 text-sm">
          <span className="text-slate-500">Saldo attuale:</span>{' '}
          <span className="font-semibold">{fmt(account?.current_balance)} &euro;</span>
          <span className="text-slate-400 ml-2">({fmtDate(account?.balance_updated_at as string | null | undefined)})</span>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Nuovo saldo</label>
          <input type="number" step="0.01" value={balance} onChange={e => setBalance(parseFloat(e.target.value) || 0)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Data saldo</label>
          <input type="date" value={balanceDate} onChange={e => setBalanceDate(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Note</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="es. Saldo da estratto conto" />
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
            Annulla
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
            {saving ? 'Salvataggio...' : 'Aggiorna saldo'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function UploadStatementModal({ isOpen, onClose, account, companyId, onImported }: { isOpen: boolean; onClose: () => void; account: AccountT | null; companyId: string; onImported: () => void }) {
  type ParsedT = { headers: string[]; rows: string[][]; separator?: string; sheetNames?: string[]; skippedRows?: number }
  type PreviewRow = { date: string | null; description: string; amount: number; balance: number | null }
  type ImportResultT = { success: boolean; count?: number; error?: string } | null
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedT | null>(null)
  const [columnMap, setColumnMap] = useState<ColMap>({ date: -1, description: -1, amount: -1, dare: -1, avere: -1, balance: -1 })
  const [dateFormat, setDateFormat] = useState('dd/mm/yyyy')
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [importing, setImporting] = useState(false)
  const [step, setStep] = useState('upload') // upload | map | preview | done
  const [importResult, setImportResult] = useState<ImportResultT>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setFile(null); setParsed(null); setStep('upload'); setImportResult(null); setParseError(null); setFileType('csv')
      setColumnMap({ date: -1, description: -1, amount: -1, dare: -1, avere: -1, balance: -1 })
    }
  }, [isOpen])

  const [fileType, setFileType] = useState('csv')
  const [parseError, setParseError] = useState<string | null>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setParseError(null)

    const ext = (f.name.split('.').pop() || '').toLowerCase()
    setFileType(ext === 'xlsx' || ext === 'xls' ? 'xlsx' : ext === 'pdf' ? 'pdf' : 'csv')

    if (ext === 'pdf') {
      // PDF: mostriamo un messaggio — il parsing PDF richiede estrazione manuale
      setParsed(null)
      setStep('pdf_info')
      return
    }

    if (ext === 'xlsx' || ext === 'xls') {
      // Excel: leggi come ArrayBuffer e usa SheetJS
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const buf = ev.target?.result
          if (!buf || typeof buf === 'string') return
          const result = parseExcelFile(buf as ArrayBuffer)
          setParsed(result)
          const map = autoMapColumns(result.headers)
          setColumnMap(map)
          if (result.rows.length > 0 && map.date >= 0) {
            const detected = detectDateFormat(result.rows[0][map.date])
            if (detected !== 'unknown') setDateFormat(detected)
          }
          // Auto-skip a preview se mapping completo (date + dare/avere o amount)
          const hasAmounts = map.amount >= 0 || map.dare >= 0 || map.avere >= 0
          setStep(map.date >= 0 && hasAmounts ? 'preview' : 'map')
        } catch (err: unknown) {
          console.error('Excel parse error:', err)
          setParseError(`Errore lettura Excel: ${(err as Error).message}`)
        }
      }
      reader.readAsArrayBuffer(f)
    } else {
      // CSV/TXT: leggi come testo (prova UTF-8, poi Latin1)
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result
          if (typeof text !== 'string') return
          // Se contiene caratteri corrotti, riprova con Latin1
          if (text.includes('\ufffd')) {
            const reader2 = new FileReader()
            reader2.onload = (ev2) => {
              const t2 = ev2.target?.result
              if (typeof t2 === 'string') processCSVText(t2)
            }
            reader2.readAsText(f, 'ISO-8859-1')
            return
          }
          processCSVText(text)
        } catch (err: unknown) {
          setParseError(`Errore lettura CSV: ${(err as Error).message}`)
        }
      }
      reader.readAsText(f, 'UTF-8')
    }
  }

  const processCSVText = (text: string) => {
    const result = parseCSV(text)
    if (result.headers.length === 0) {
      setParseError('File vuoto o formato non riconosciuto. Verifica che sia un CSV valido.')
      return
    }
    setParsed(result)
    const map = autoMapColumns(result.headers)
    setColumnMap(map)
    if (result.rows.length > 0 && map.date >= 0) {
      const detected = detectDateFormat(result.rows[0][map.date])
      if (detected !== 'unknown') setDateFormat(detected)
    }
    // Auto-skip a preview se mapping completo
    const hasAmounts = map.amount >= 0 || map.dare >= 0 || map.avere >= 0
    setStep(map.date >= 0 && hasAmounts ? 'preview' : 'map')
  }

  const handlePreview = () => {
    if (!parsed) return
    const rows: PreviewRow[] = parsed.rows.slice(0, 5).map((row: string[]) => {
      let amount = 0
      if (columnMap.amount >= 0) {
        amount = parseCSVNumber(row[columnMap.amount])
      } else if (columnMap.dare >= 0 || columnMap.avere >= 0) {
        const dare = columnMap.dare >= 0 ? parseCSVNumber(row[columnMap.dare]) : 0
        const avere = columnMap.avere >= 0 ? parseCSVNumber(row[columnMap.avere]) : 0
        amount = avere - dare
      }
      return {
        date: columnMap.date >= 0 ? parseCSVDate(row[columnMap.date], dateFormat) : null,
        description: columnMap.description >= 0 ? row[columnMap.description] : '',
        amount,
        balance: columnMap.balance >= 0 ? parseCSVNumber(row[columnMap.balance]) : null,
      }
    })
    setPreview(rows)
    setStep('preview')
  }

  const handleImport = async () => {
    if (!parsed || !account) return
    setImporting(true)
    // Dichiariamo stmt fuori dal try cosi' nel catch possiamo aggiornare
    // lo status a 'error' ed evitare di lasciare il record in 'processing'
    // per sempre (bug MPS segnalato dall'utente).
    let stmt: { id: string } | null = null
    try {
      if (!file) return
      // Create bank_statement record
      const { data: stmtData, error: stmtErr } = await supabase.from('bank_statements').insert({
        company_id: companyId,
        bank_account_id: account.id,
        filename: file.name,
        file_type: fileType === 'xlsx' ? 'xlsx' : 'csv',
        transaction_count: parsed.rows.length,
        status: 'processing',
      } as never).select().single()

      if (stmtErr) throw stmtErr
      stmt = stmtData as { id: string } | null

      // Parse all rows
      const transactions = parsed.rows.map((row: string[]) => {
        let amount = 0
        if (columnMap.amount >= 0) {
          amount = parseCSVNumber(row[columnMap.amount])
        } else if (columnMap.dare >= 0 || columnMap.avere >= 0) {
          const dare = columnMap.dare >= 0 ? parseCSVNumber(row[columnMap.dare]) : 0
          const avere = columnMap.avere >= 0 ? parseCSVNumber(row[columnMap.avere]) : 0
          amount = avere - dare
        }
        const txDate = columnMap.date >= 0 ? parseCSVDate(row[columnMap.date], dateFormat) : new Date().toISOString().split('T')[0]
        return {
          company_id: companyId,
          bank_account_id: account.id,
          statement_id: stmt?.id || null,
          transaction_date: txDate,
          value_date: txDate,
          amount,
          description: columnMap.description >= 0 ? row[columnMap.description] : '',
          running_balance: columnMap.balance >= 0 ? parseCSVNumber(row[columnMap.balance]) : null,
          source: 'csv_import',
          is_reconciled: false,
          currency: 'EUR',
        }
      }).filter(t => t.amount !== 0)

      // Insert in batches of 100
      let inserted = 0
      for (let i = 0; i < transactions.length; i += 100) {
        const batch = transactions.slice(i, i + 100)
        const { error: txErr } = await supabase.from('bank_transactions').insert(batch as never)
        if (txErr) throw txErr
        inserted += batch.length
      }

      // Update statement status
      if (stmt?.id) await supabase.from('bank_statements').update({
        status: 'completed',
        transaction_count: inserted,
      } as never).eq('id', stmt.id)

      // Update account balance if last row has balance
      if (transactions.length > 0) {
        const lastBalance = transactions[transactions.length - 1].running_balance
        if (lastBalance != null) {
          await supabase.from('bank_accounts').update({
            current_balance: lastBalance,
            balance_updated_at: new Date().toISOString(),
          } as never).eq('id', account.id)
        }
      }

      setImportResult({ success: true, count: inserted })
      setStep('done')
      onImported()
    } catch (err: unknown) {
      console.error('Import error:', err)
      // Se il record bank_statements e' stato creato ma l'import e' fallito
      // a meta', aggiorna lo status a 'error' cosi' non resta in 'processing'
      // all'infinito. Uso update separato con try silenzioso per non
      // mascherare l'errore originale.
      if (stmt?.id) {
        try {
          await supabase.from('bank_statements').update({
            status: 'error',
            error_message: (err as Error).message?.substring(0, 500) || 'Errore import',
          } as never).eq('id', stmt.id)
        } catch (updateErr: unknown) {
          console.warn('impossibile marcare bank_statements come error:', (updateErr as Error)?.message)
        }
      }
      setImportResult({ success: false, error: (err as Error).message })
      setStep('done')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Importa estratto conto \u2014 ${account?.account_name || ''}`} maxWidth="max-w-2xl">
      {step === 'upload' && (
        <div className="space-y-4">
          <div
            className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center hover:border-blue-400 transition cursor-pointer"
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-blue-400', 'bg-blue-50') }}
            onDragLeave={e => { e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50') }}
            onDrop={e => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50')
              if (e.dataTransfer.files?.[0] && fileRef.current) {
                const dt = new DataTransfer()
                dt.items.add(e.dataTransfer.files[0])
                fileRef.current.files = dt.files
                handleFile({ target: fileRef.current } as unknown as React.ChangeEvent<HTMLInputElement>)
              }
            }}
          >
            <Upload size={32} className="text-slate-400 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-700">Trascina o seleziona un file</p>
            <p className="text-xs text-slate-400 mt-1">Formati supportati: CSV, Excel (.xlsx/.xls), PDF</p>
            <div className="flex gap-2 justify-center mt-3">
              <span className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded text-xs font-medium">CSV</span>
              <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs font-medium">XLSX</span>
              <span className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs font-medium">XLS</span>
              <span className="px-2 py-1 bg-red-50 text-red-600 rounded text-xs font-medium">PDF</span>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.pdf" className="hidden" onChange={handleFile} />
          {parseError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}
        </div>
      )}

      {step === 'pdf_info' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-1">Estratto conto PDF: {file?.name}</p>
                <p>I PDF bancari hanno formati molto diversi tra banche. Per ottenere i migliori risultati:</p>
                <ol className="list-decimal ml-5 mt-2 space-y-1">
                  <li>Apri il PDF dell'estratto conto</li>
                  <li>Dalla tua banca online, scarica la versione <strong>CSV o Excel</strong> (quasi tutte le banche lo offrono)</li>
                  <li>Importa il CSV/Excel qui</li>
                </ol>
                <p className="mt-2 text-xs text-amber-600">
                  In alternativa, puoi copiare i movimenti dal PDF in un foglio Excel e importare quello.
                </p>
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setStep('upload'); setFile(null) }} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
              Torna indietro
            </button>
          </div>
        </div>
      )}

      {step === 'map' && parsed && (
        <div className="space-y-4">
          <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
            <Info size={14} className="inline mr-1" />
            File: <strong>{file?.name}</strong> \u2014 {parsed.rows.length} righe, {parsed.headers.length} colonne (separatore: &quot;{parsed.separator === '\t' ? 'TAB' : parsed.separator}&quot;)
          </div>
          <p className="text-sm font-medium text-slate-700">Mappa le colonne:</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { key: 'date', label: 'Data *' },
              { key: 'description', label: 'Descrizione' },
              { key: 'amount', label: 'Importo (unico)' },
              { key: 'dare', label: 'Dare (uscite)' },
              { key: 'avere', label: 'Avere (entrate)' },
              { key: 'balance', label: 'Saldo' },
            ] as Array<{ key: keyof ColMap; label: string }>).map((field) => (
              <div key={field.key}>
                <label className="block text-xs font-medium text-slate-500 mb-1">{field.label}</label>
                <select
                  value={columnMap[field.key]}
                  onChange={e => setColumnMap({ ...columnMap, [field.key]: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={-1}>-- Non mappata --</option>
                  {parsed.headers.map((h, i) => (
                    <option key={i} value={i}>{h}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Formato data</label>
            <select value={dateFormat} onChange={e => setDateFormat(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="dd/mm/yyyy">dd/mm/yyyy (italiano)</option>
              <option value="yyyy-mm-dd">yyyy-mm-dd (ISO)</option>
              <option value="dd-mm-yyyy">dd-mm-yyyy</option>
              <option value="dd.mm.yyyy">dd.mm.yyyy</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setStep('upload'); setParsed(null); setFile(null) }} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
              Indietro
            </button>
            <button onClick={handlePreview} disabled={columnMap.date === -1 || (columnMap.amount === -1 && columnMap.dare === -1 && columnMap.avere === -1)}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
              Anteprima
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-700">Anteprima prime 5 righe:</p>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Descrizione</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Importo</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700">{fmtDate(row.date)}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[250px] truncate">{row.description}</td>
                    <td className={classNames('px-3 py-2 text-right font-medium', row.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {row.amount >= 0 ? '+' : ''}{fmt(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{row.balance != null ? fmt(row.balance) : '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-700">
            <AlertTriangle size={14} className="inline mr-1" />
            Verranno importate <strong>{parsed?.rows?.length || 0}</strong> righe (escluse quelle con importo zero).
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep('map')} className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
              Indietro
            </button>
            <button onClick={handleImport} disabled={importing}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition">
              {importing ? 'Importazione...' : `Importa ${parsed?.rows?.length || 0} movimenti`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && importResult && (
        <div className="text-center py-6">
          {importResult.success ? (
            <>
              <div className="p-3 bg-emerald-100 rounded-full inline-flex mb-3">
                <CheckCircle2 size={32} className="text-emerald-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Importazione completata</h3>
              <p className="text-sm text-slate-500 mt-1">{importResult.count} movimenti importati correttamente.</p>
            </>
          ) : (
            <>
              <div className="p-3 bg-red-100 rounded-full inline-flex mb-3">
                <AlertCircle size={32} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Errore nell&apos;importazione</h3>
              <p className="text-sm text-red-500 mt-1">{importResult.error}</p>
            </>
          )}
          <button onClick={onClose} className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
            Chiudi
          </button>
        </div>
      )}
    </Modal>
  )
}

function TabContiBancari({ accounts, companyId, onRefresh }: { accounts: AccountT[]; companyId: string; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editAccount, setEditAccount] = useState<AccountFormT | null>(null)
  const [balanceAccount, setBalanceAccount] = useState<AccountT | null>(null)
  const [uploadAccount, setUploadAccount] = useState<AccountT | null>(null)
  const [showIban, setShowIban] = useState<Record<string, boolean>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<AccountT | null>(null)

  const handleSaveAccount = async (form: AccountFormT) => {
    if (editAccount?.id) {
      const { error } = await supabase.from('bank_accounts')
        .update({ ...form, updated_at: new Date().toISOString() } as never)
        .eq('id', editAccount.id).eq('company_id', companyId)
      if (error) throw error
    } else {
      const { error } = await supabase.from('bank_accounts')
        .insert({ ...form, company_id: companyId, is_manual: true, is_active: true, currency: 'EUR', balance_updated_at: new Date().toISOString() } as never)
      if (error) throw error
    }
    onRefresh()
  }

  const handleUpdateBalance = async ({ balance, balance_date, notes }: { balance: number; balance_date: string; notes: string }) => {
    if (!balanceAccount) return
    const { error: logErr } = await supabase.from('manual_balance_entries').insert({
      company_id: companyId,
      bank_account_id: balanceAccount.id,
      balance,
      balance_date,
      notes,
    } as never)
    if (logErr) console.error('balance log error:', logErr)

    const { error } = await supabase.from('bank_accounts').update({
      current_balance: balance,
      balance_updated_at: new Date().toISOString(),
    } as never).eq('id', balanceAccount.id).eq('company_id', companyId)
    if (error) throw error
    onRefresh()
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    await supabase.from('bank_accounts').update({ is_active: false } as never).eq('id', deleteConfirm.id).eq('company_id', companyId)
    setDeleteConfirm(null)
    onRefresh()
  }

  const activeAccounts = accounts.filter(a => a.is_active !== false)
  const totalBalance = activeAccounts.reduce<number>((s, a) => s + (Number(a.current_balance) || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm text-slate-500">Totale disponibilita</h3>
          <div className="text-3xl font-bold text-slate-900">{fmt(totalBalance)} &euro;</div>
        </div>
        <button onClick={() => { setEditAccount(null); setShowAdd(true) }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition">
          <Plus size={16} /> Nuovo conto
        </button>
      </div>

      {activeAccounts.length === 0 ? (
        <EmptyState icon={Building2} title="Nessun conto bancario" description="Aggiungi il primo conto bancario per iniziare."
          action={<button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Aggiungi conto</button>} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {activeAccounts.map((acct, idx) => (
            <div key={acct.id} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition overflow-hidden">
              <div className="h-1.5" style={{ backgroundColor: (acct.color as string | undefined) || COLORS[idx % COLORS.length] }} />
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{acct.account_name || acct.bank_name}</div>
                    <div className="text-xs text-slate-400">{acct.bank_name}{acct.outlet_code ? ` \u2022 ${acct.outlet_code}` : ''}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setEditAccount(acct as unknown as AccountFormT); setShowAdd(true) }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Modifica">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setDeleteConfirm(acct)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500" title="Disattiva">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className={classNames('text-2xl font-bold mb-3', (Number(acct.current_balance) || 0) >= 0 ? 'text-slate-900' : 'text-red-600')}>
                  {fmt(acct.current_balance)} &euro;
                </div>

                <div className="flex items-center gap-2 mb-3 text-xs text-slate-400">
                  <button onClick={() => setShowIban(prev => ({ ...prev, [acct.id]: !prev[acct.id] }))}
                    className="flex items-center gap-1 hover:text-slate-600">
                    {showIban[acct.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showIban[acct.id] ? acct.iban || '\u2014' : maskIban(acct.iban)}
                  </button>
                  {acct.iban && (
                    <button onClick={() => acct.iban && navigator.clipboard.writeText(acct.iban)} className="p-1 hover:text-slate-600" title="Copia IBAN">
                      <Copy size={12} />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
                  <span>{ACCOUNT_TYPES.find(t => t.value === acct.account_type)?.label || acct.account_type}</span>
                  <span>Agg. {fmtDate(acct.balance_updated_at as string | null | undefined)}</span>
                </div>

                {(Number(acct.credit_line) || 0) > 0 && (
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>Utilizzo fido</span>
                      <span>{fmt(Math.max(0, -(Number(acct.current_balance) || 0)))} / {fmt(Number(acct.credit_line) || 0)} &euro;</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, (Math.max(0, -(Number(acct.current_balance) || 0)) / (Number(acct.credit_line) || 1)) * 100)}%`,
                          backgroundColor: (-(Number(acct.current_balance) || 0) / (Number(acct.credit_line) || 1)) > 0.8 ? '#ef4444' : '#3b82f6',
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setBalanceAccount(acct)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-700 transition">
                    <RefreshCw size={12} /> Aggiorna saldo
                  </button>
                  <button onClick={() => setUploadAccount(acct)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium border border-blue-200 rounded-lg hover:bg-blue-50 text-blue-700 transition">
                    <Upload size={12} /> Importa EC
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddAccountModal isOpen={showAdd} onClose={() => { setShowAdd(false); setEditAccount(null) }} onSave={handleSaveAccount} editAccount={editAccount} />
      <UpdateBalanceModal isOpen={!!balanceAccount} onClose={() => setBalanceAccount(null)} account={balanceAccount} onSave={handleUpdateBalance} />
      <UploadStatementModal isOpen={!!uploadAccount} onClose={() => setUploadAccount(null)} account={uploadAccount} companyId={companyId} onImported={onRefresh} />
      <ConfirmDialog isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} onConfirm={handleDelete}
        title="Disattivare questo conto?" message={`Il conto "${deleteConfirm?.account_name || deleteConfirm?.bank_name}" verra disattivato. I movimenti storici verranno mantenuti.`}
        confirmLabel="Disattiva" danger />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ TAB 3: MOVIMENTI ═══
// ═══════════════════════════════════════════════════════════════════

function TabMovimenti({ transactions, accounts }: { transactions: TransactionT[]; accounts: AccountT[] }) {
  const [search, setSearch] = useState('')
  const [filterAccount, setFilterAccount] = useState('all')
  const [filterType, setFilterType] = useState('all') // all, entrata, uscita
  const [filterReconciled, setFilterReconciled] = useState('all') // all, yes, no
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<keyof TransactionT | string>('transaction_date')
  const [sortDir, setSortDir] = useState('desc')
  const PER_PAGE = 25

  const filtered = useMemo<TransactionT[]>(() => {
    let items = [...transactions]
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (String(t.counterpart_name || '')).toLowerCase().includes(q) ||
        (String(t.reference || '')).toLowerCase().includes(q)
      )
    }
    if (filterAccount !== 'all') items = items.filter(t => t.bank_account_id === filterAccount)
    if (filterType === 'entrata') items = items.filter(t => (t.amount || 0) > 0)
    if (filterType === 'uscita') items = items.filter(t => (t.amount || 0) < 0)
    if (filterReconciled === 'yes') items = items.filter(t => t.is_reconciled)
    if (filterReconciled === 'no') items = items.filter(t => !t.is_reconciled)
    if (dateFrom) items = items.filter(t => (t.transaction_date || '') >= dateFrom)
    if (dateTo) items = items.filter(t => (t.transaction_date || '') <= dateTo)

    items.sort((a, b) => {
      const ar = a as Record<string, unknown>
      const br = b as Record<string, unknown>
      let va: unknown = ar[sortField], vb: unknown = br[sortField]
      if (sortField === 'amount') { va = (va as number) || 0; vb = (vb as number) || 0 }
      else { va = (va as string) || ''; vb = (vb as string) || '' }
      if ((va as number | string) < (vb as number | string)) return sortDir === 'asc' ? -1 : 1
      if ((va as number | string) > (vb as number | string)) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [transactions, search, filterAccount, filterType, filterReconciled, dateFrom, dateTo, sortField, sortDir])

  const totalPages = Math.ceil(filtered.length / PER_PAGE) || 1
  const pageItems = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const totalFiltered = useMemo(() => filtered.reduce<number>((s, t) => s + (t.amount || 0), 0), [filtered])

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ChevronsUpDown size={12} className="text-slate-300" />
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />
  }

  useEffect(() => { setPage(1) }, [search, filterAccount, filterType, filterReconciled, dateFrom, dateTo])

  const handleExportCSV = () => {
    const headers = ['Data', 'Descrizione', 'Importo', 'Saldo', 'Conto', 'Riconciliato']
    const rows = filtered.map(t => {
      const acct = accounts.find(a => a.id === t.bank_account_id)
      return [
        fmtDate(t.transaction_date),
        `"${(t.description || '').replace(/"/g, '""')}"`,
        (t.amount || 0).toFixed(2).replace('.', ','),
        (t.running_balance != null ? Number(t.running_balance).toFixed(2).replace('.', ',') : ''),
        acct?.account_name || acct?.bank_name || '',
        t.is_reconciled ? 'Si' : 'No',
      ].join(';')
    })
    const csv = [headers.join(';'), ...rows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `movimenti_${new Date().toISOString().split('T')[0]}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca descrizione, controparte..."
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Tutti i conti</option>
            {accounts.filter(a => a.is_active !== false).map(a => (
              <option key={a.id} value={a.id}>{a.account_name || a.bank_name}</option>
            ))}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Entrate e uscite</option>
            <option value="entrata">Solo entrate</option>
            <option value="uscita">Solo uscite</option>
          </select>
          <select value={filterReconciled} onChange={e => setFilterReconciled(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Tutti</option>
            <option value="yes">Riconciliati</option>
            <option value="no">Non riconciliati</option>
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" title="Da data" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" title="A data" />
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
            <Download size={14} /> CSV
          </button>
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
          <span>{filtered.length} movimenti</span>
          <span>Saldo netto filtrato: <strong className={totalFiltered >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmt(totalFiltered)} &euro;</strong></span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {pageItems.length === 0 ? (
          <EmptyState icon={ArrowUpRight} title="Nessun movimento" description="Importa un estratto conto o collega una banca per vedere i movimenti." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 cursor-pointer select-none" onClick={() => handleSort('transaction_date')}>
                    <div className="flex items-center gap-1">Data <SortIcon field="transaction_date" /></div>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Conto</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 cursor-pointer select-none" onClick={() => handleSort('description')}>
                    <div className="flex items-center gap-1">Descrizione <SortIcon field="description" /></div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 cursor-pointer select-none" onClick={() => handleSort('amount')}>
                    <div className="flex items-center justify-end gap-1">Importo <SortIcon field="amount" /></div>
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-500">Saldo</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-500">Stato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pageItems.map(t => {
                  const acct = accounts.find(a => a.id === t.bank_account_id)
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(t.transaction_date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: (acct?.color as string | undefined) || '#94a3b8' }} />
                          <span className="text-slate-600 text-xs truncate max-w-[100px]">{acct?.account_name || acct?.bank_name || '\u2014'}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-900 max-w-[300px]">
                        <div className="truncate" title={t.description ?? undefined}>{t.description || '\u2014'}</div>
                        {Boolean(t.counterpart_name) && <div className="text-xs text-slate-400 truncate">{String(t.counterpart_name)}</div>}
                      </td>
                      <td className={classNames('px-4 py-3 text-right font-semibold whitespace-nowrap', (Number(t.amount) || 0) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {(Number(t.amount) || 0) >= 0 ? '+' : ''}{fmt(t.amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">
                        {t.running_balance != null ? fmt(Number(t.running_balance)) : '\u2014'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {t.is_reconciled ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                            <CheckCircle2 size={12} /> Riconc.
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">Da riconciliare</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ TAB 4: PAGAMENTI ═══
// ═══════════════════════════════════════════════════════════════════

function TabPagamenti({ payables, accounts, companyId, onRefresh, preSelectId }: { payables: PayableT[]; accounts: AccountT[]; companyId: string; onRefresh: () => void; preSelectId?: string | null }) {
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('da_pagare')
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    if (preSelectId) return { [preSelectId]: true }
    return {}
  })
  const [batchAccount, setBatchAccount] = useState('')
  const [batchNotes, setBatchNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [sortField, setSortField] = useState<string>('due_date')
  const [sortDir, setSortDir] = useState('asc')

  const activeAccounts = accounts.filter(a => a.is_active !== false && a.iban)

  useEffect(() => {
    if (activeAccounts.length > 0 && !batchAccount) {
      setBatchAccount(activeAccounts[0].id)
    }
  }, [activeAccounts.length, activeAccounts, batchAccount])

  const filteredPayables = useMemo<PayableT[]>(() => {
    let items = [...payables]
    if (filterStatus !== 'all') {
      if (filterStatus === 'da_pagare') items = items.filter(p => p.status === 'da_pagare' || p.status === 'in_scadenza' || p.status === 'parziale')
      else if (filterStatus === 'scaduto') items = items.filter(p => p.status === 'scaduto')
      else items = items.filter(p => p.status === filterStatus)
    }
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(p => getSupplierName(p).toLowerCase().includes(q) || (String(p.invoice_number || '')).toLowerCase().includes(q))
    }
    items.sort((a, b) => {
      const ar = a as Record<string, unknown>
      const br = b as Record<string, unknown>
      let va: unknown = ar[sortField] || '', vb: unknown = br[sortField] || ''
      if (sortField === 'amount') { va = Number(a.gross_amount || 0); vb = Number(b.gross_amount || 0) }
      if ((va as number | string) < (vb as number | string)) return sortDir === 'asc' ? -1 : 1
      if ((va as number | string) > (vb as number | string)) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    return items
  }, [payables, filterStatus, search, sortField, sortDir])

  const selectedItems = useMemo(() => filteredPayables.filter(p => selected[p.id]), [filteredPayables, selected])
  const selectedTotal = useMemo(() => selectedItems.reduce<number>((s, p) => s + (p.amount_remaining != null ? Number(p.amount_remaining) : (Number(p.gross_amount || 0) - Number(p.amount_paid || 0))), 0), [selectedItems])

  const selectedAccount = accounts.find(a => a.id === batchAccount)
  const projectedBalance = (Number(selectedAccount?.current_balance) || 0) - selectedTotal

  const toggleSelect = (id: string) => setSelected(prev => ({ ...prev, [id]: !prev[id] }))
  const toggleSelectAll = () => {
    const allSelected = filteredPayables.every(p => selected[p.id])
    if (allSelected) setSelected({})
    else {
      const newSel: Record<string, boolean> = {}
      filteredPayables.forEach(p => { newSel[p.id] = true })
      setSelected(newSel)
    }
  }

  const handleCreateBatch = async () => {
    if (selectedItems.length === 0 || !batchAccount) return
    setCreating(true)
    try {
      // Generate batch number
      const batchNumber = `DIST-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`

      const { data: batch, error: batchErr } = await supabase.from('payment_batches').insert({
        company_id: companyId,
        bank_account_id: batchAccount,
        batch_number: batchNumber,
        status: 'draft',
        total_amount: selectedTotal,
        payment_count: selectedItems.length,
        balance_before: Number(selectedAccount?.current_balance) || 0,
        balance_after: projectedBalance,
        notes: batchNotes,
      } as never).select().single()

      if (batchErr) throw batchErr
      const batchTyped = batch as { id: string } | null
      if (!batchTyped) throw new Error('No batch created')

      // Insert batch items
      const items = selectedItems.map((p, idx) => ({
        batch_id: batchTyped.id,
        company_id: companyId,
        payable_id: p.id,
        beneficiary_name: getSupplierName(p),
        beneficiary_iban: (p.iban as string | null) || '',
        amount: p.amount_remaining != null ? Number(p.amount_remaining) : (Number(p.gross_amount || 0) - Number(p.amount_paid || 0)),
        currency: 'EUR',
        payment_reason: `Pag. fatt. ${String(p.invoice_number || '')}`.trim(),
        invoice_number: String(p.invoice_number || ''),
        invoice_date: p.invoice_date,
        due_date: p.due_date,
        priority: idx + 1,
        status: 'pending',
      }))

      const { error: itemsErr } = await supabase.from('payment_batch_items').insert(items as never)
      if (itemsErr) throw itemsErr

      setSelected({})
      setBatchNotes('')
      onRefresh()
    } catch (err: unknown) {
      console.error('Create batch error:', err)
      alert(`Errore: ${(err as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left panel: invoices to pay */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex flex-wrap gap-3 mb-3">
            <div className="flex-1 min-w-[200px] relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca fornitore, fattura..."
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">Tutte</option>
              <option value="da_pagare">Da pagare</option>
              <option value="scaduto">Scadute</option>
              <option value="pagato">Pagate</option>
            </select>
          </div>
          <div className="text-xs text-slate-500">{filteredPayables.length} fatture {selectedItems.length > 0 && `\u2022 ${selectedItems.length} selezionate`}</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {filteredPayables.length === 0 ? (
            <EmptyState icon={Receipt} title="Nessuna fattura" description="Non ci sono fatture in attesa di pagamento." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-3 text-left">
                      <input type="checkbox" checked={filteredPayables.length > 0 && filteredPayables.every(p => selected[p.id])}
                        onChange={toggleSelectAll} className="rounded border-slate-300" />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 cursor-pointer" onClick={() => { setSortField('supplier_name'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}>Fornitore</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Fattura</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 cursor-pointer" onClick={() => { setSortField('due_date'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}>Scadenza</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 cursor-pointer" onClick={() => { setSortField('amount'); setSortDir(d => d === 'asc' ? 'desc' : 'asc') }}>Residuo</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-500">Stato</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredPayables.map(p => {
                    const remaining = p.amount_remaining != null ? Number(p.amount_remaining) : (Number(p.gross_amount || 0) - Number(p.amount_paid || 0))
                    const days = daysUntil(p.due_date)
                    const isOverdue = days !== null && days < 0
                    return (
                      <tr key={p.id} className={classNames('hover:bg-slate-50', selected[p.id] && 'bg-blue-50')}>
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggleSelect(p.id)} className="rounded border-slate-300" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900 truncate max-w-[180px]">{getSupplierName(p)}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{String(p.invoice_number || '\u2014')}</td>
                        <td className="px-4 py-3">
                          <div className={classNames('text-sm', isOverdue ? 'text-red-600 font-semibold' : 'text-slate-600')}>
                            {fmtDate(p.due_date)}
                          </div>
                          {days !== null && (
                            <div className={classNames('text-xs', isOverdue ? 'text-red-500' : days <= 7 ? 'text-amber-500' : 'text-slate-400')}>
                              {isOverdue ? `${Math.abs(days)}gg in ritardo` : days === 0 ? 'Oggi' : `tra ${days}gg`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">{fmt(remaining)} &euro;</td>
                        <td className="px-4 py-3 text-center">{statusBadge(isOverdue ? 'scaduto' : p.status)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Right panel: payment batch builder */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 sticky top-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Layers size={16} className="text-blue-600" /> Costruttore distinta
          </h3>

          {selectedItems.length === 0 ? (
            <div className="text-center py-8">
              <CircleDot size={32} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">Seleziona le fatture da pagare dalla lista a sinistra</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {selectedItems.map(p => {
                  const remaining = p.amount_remaining != null ? Number(p.amount_remaining) : (Number(p.gross_amount || 0) - Number(p.amount_paid || 0))
                  return (
                    <div key={p.id} className="flex items-center justify-between py-2 px-3 bg-blue-50 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-800 truncate">{getSupplierName(p)}</div>
                        <div className="text-xs text-slate-400">{String(p.invoice_number || '')}</div>
                      </div>
                      <div className="text-sm font-semibold text-slate-900 whitespace-nowrap ml-2">{fmt(remaining)} &euro;</div>
                      <button onClick={() => toggleSelect(p.id)} className="ml-2 p-1 hover:bg-red-100 rounded text-slate-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Pagamenti:</span>
                  <span className="font-semibold">{selectedItems.length}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Totale:</span>
                  <span className="font-bold text-lg text-slate-900">{fmt(selectedTotal)} &euro;</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Conto di addebito</label>
                  <select value={batchAccount} onChange={e => setBatchAccount(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {activeAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.account_name || a.bank_name} ({fmt(a.current_balance)} &euro;)</option>
                    ))}
                  </select>
                </div>

                {selectedAccount && (
                  <div className="bg-slate-50 rounded-lg p-3 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Saldo attuale:</span>
                      <span className="font-medium">{fmt(selectedAccount.current_balance)} &euro;</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Totale distinta:</span>
                      <span className="font-medium text-red-600">-{fmt(selectedTotal)} &euro;</span>
                    </div>
                    <div className="border-t border-slate-200 pt-1.5 flex justify-between text-xs">
                      <span className="text-slate-600 font-semibold">Saldo proiettato:</span>
                      <span className={classNames('font-bold', projectedBalance >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {fmt(projectedBalance)} &euro;
                      </span>
                    </div>
                    {projectedBalance < 0 && (
                      <div className="flex items-center gap-1 text-xs text-red-600 mt-1">
                        <AlertTriangle size={12} /> Saldo insufficiente
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Note distinta</label>
                  <input type="text" value={batchNotes} onChange={e => setBatchNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="es. Pagamenti aprile 2026" />
                </div>

                <button onClick={handleCreateBatch} disabled={creating || selectedItems.length === 0 || !batchAccount}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                  {creating ? 'Creazione...' : <><Layers size={16} /> Crea distinta ({selectedItems.length})</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ TAB 5: DISTINTE ═══
// ═══════════════════════════════════════════════════════════════════

type BatchT = Record<string, unknown> & {
  id: string
  batch_number?: string | null
  status?: string | null
  bank_account_id?: string | null
  total_amount?: number | null
  payment_count?: number | null
  notes?: string | null
  created_at?: string | null
  executed_at?: string | null
}
type BatchItemT = Record<string, unknown> & {
  id: string
  batch_id: string
  payable_id?: string | null
  beneficiary_name?: string | null
  beneficiary_iban?: string | null
  invoice_number?: string | null
  due_date?: string | null
  amount?: number | null
  status?: string | null
}

function TabDistinte({ batches, batchItems, accounts, companyId, onRefresh }: {
  batches: BatchT[]
  batchItems: BatchItemT[]
  accounts: AccountT[]
  companyId: string
  onRefresh: () => void
}) {
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [confirmExec, setConfirmExec] = useState<BatchT | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<BatchT | null>(null)
  const [executing, setExecuting] = useState(false)

  const handleExecute = async () => {
    if (!confirmExec) return
    setExecuting(true)
    try {
      const now = new Date().toISOString()
      // Update batch status
      const { error: batchErr } = await supabase.from('payment_batches').update({
        status: 'executed',
        executed_at: now,
        updated_at: now,
      } as never).eq('id', String(confirmExec.id)).eq('company_id', companyId)
      if (batchErr) throw batchErr

      // Update batch items
      const { error: itemsErr } = await supabase.from('payment_batch_items').update({
        status: 'executed',
        executed_at: now,
      } as never).eq('batch_id', String(confirmExec.id)).eq('company_id', companyId)
      if (itemsErr) throw itemsErr

      // Update payables status
      const items = batchItems.filter((i) => i.batch_id === confirmExec.id)
      for (const item of items) {
        if (item.payable_id) {
          await supabase.from('payables').update({
            status: 'pagato',
            payment_date: now.split('T')[0],
            payment_bank_account_id: confirmExec.bank_account_id,
          } as never).eq('id', String(item.payable_id)).eq('company_id', companyId)
        }
      }

      // Update bank account balance
      const acct = accounts.find((a) => a.id === confirmExec.bank_account_id)
      if (acct) {
        await supabase.from('bank_accounts').update({
          current_balance: (Number(acct.current_balance) || 0) - (Number(confirmExec.total_amount) || 0),
          balance_updated_at: now,
        } as never).eq('id', String(acct.id)).eq('company_id', companyId)
      }

      setConfirmExec(null)
      onRefresh()
    } catch (err: unknown) {
      console.error('Execute batch error:', err)
      alert(`Errore: ${(err as Error).message}`)
    } finally {
      setExecuting(false)
    }
  }

  const handleCancel = async () => {
    if (!confirmCancel) return
    try {
      await supabase.from('payment_batches').update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      } as never).eq('id', String(confirmCancel.id)).eq('company_id', companyId)

      await supabase.from('payment_batch_items').update({
        status: 'cancelled',
      } as never).eq('batch_id', String(confirmCancel.id)).eq('company_id', companyId)

      setConfirmCancel(null)
      onRefresh()
    } catch (err: unknown) {
      console.error('Cancel batch error:', err)
    }
  }

  const sortedBatches = useMemo(() =>
    [...batches].sort((a, b) => new Date(String(b.created_at) || 0).getTime() - new Date(String(a.created_at) || 0).getTime()),
    [batches]
  )

  return (
    <div className="space-y-4">
      {sortedBatches.length === 0 ? (
        <EmptyState icon={Layers} title="Nessuna distinta" description="Crea una distinta di pagamento dalla scheda Pagamenti selezionando le fatture da pagare." />
      ) : (
        sortedBatches.map(batch => {
          const acct = accounts.find(a => a.id === batch.bank_account_id)
          const items = batchItems.filter(i => i.batch_id === batch.id)
          const isExpanded = expandedBatch === batch.id

          return (
            <div key={batch.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div
                className="flex items-center gap-4 p-5 cursor-pointer hover:bg-slate-50"
                onClick={() => setExpandedBatch(isExpanded ? null : batch.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-900">{batch.batch_number}</span>
                    {statusBadge(batch.status)}
                  </div>
                  <div className="text-xs text-slate-400">
                    Creata il {fmtDate(batch.created_at)} {acct ? `\u2022 ${acct.account_name || acct.bank_name}` : ''}
                    {batch.notes ? ` \u2022 ${batch.notes}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-900">{fmt(batch.total_amount)} &euro;</div>
                  <div className="text-xs text-slate-400">{batch.payment_count || items.length} pagament{(batch.payment_count || items.length) === 1 ? 'o' : 'i'}</div>
                </div>
                <div className="flex items-center gap-2">
                  {batch.status === 'draft' && (
                    <>
                      <button onClick={e => { e.stopPropagation(); setConfirmExec(batch) }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition">
                        <Check size={14} /> Conferma esecuzione
                      </button>
                      <button onClick={e => { e.stopPropagation(); setConfirmCancel(batch) }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition" title="Annulla distinta">
                        <Ban size={16} />
                      </button>
                    </>
                  )}
                  {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-slate-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-5 py-2 text-left text-xs font-medium text-slate-500">#</th>
                        <th className="px-5 py-2 text-left text-xs font-medium text-slate-500">Beneficiario</th>
                        <th className="px-5 py-2 text-left text-xs font-medium text-slate-500">IBAN</th>
                        <th className="px-5 py-2 text-left text-xs font-medium text-slate-500">Fattura</th>
                        <th className="px-5 py-2 text-left text-xs font-medium text-slate-500">Scadenza</th>
                        <th className="px-5 py-2 text-right text-xs font-medium text-slate-500">Importo</th>
                        <th className="px-5 py-2 text-center text-xs font-medium text-slate-500">Stato</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {items.map((item, idx) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-5 py-2 text-slate-400 text-xs">{idx + 1}</td>
                          <td className="px-5 py-2 font-medium text-slate-900">{item.beneficiary_name || '\u2014'}</td>
                          <td className="px-5 py-2 text-slate-500 font-mono text-xs">{maskIban(item.beneficiary_iban)}</td>
                          <td className="px-5 py-2 text-slate-600 text-xs">{item.invoice_number || '\u2014'}</td>
                          <td className="px-5 py-2 text-slate-600 text-xs">{fmtDate(item.due_date)}</td>
                          <td className="px-5 py-2 text-right font-semibold text-slate-900">{fmt(item.amount)} &euro;</td>
                          <td className="px-5 py-2 text-center">{statusBadge(item.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200">
                        <td colSpan={5} className="px-5 py-2 text-right text-xs font-semibold text-slate-600">Totale distinta:</td>
                        <td className="px-5 py-2 text-right font-bold text-slate-900">{fmt(batch.total_amount)} &euro;</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>

                  {batch.status === 'executed' && batch.executed_at && (
                    <div className="px-5 py-3 bg-emerald-50 text-sm text-emerald-700 flex items-center gap-2">
                      <CheckCircle2 size={16} /> Eseguita il {fmtDate(batch.executed_at)}
                    </div>
                  )}

                  {/* Paga via A-Cube — disponibile per distinte non ancora eseguite */}
                  {(batch.status === 'draft' || batch.status === 'pending' || batch.status === 'partial_error') && (
                    <div className="px-5 py-3 bg-emerald-50/50 border-t border-emerald-100 flex items-center justify-between gap-3">
                      <div className="text-xs text-emerald-800">
                        <strong>Pagamento PSD2 via A-Cube</strong>: ogni bonifico richiede autorizzazione sulla tua app banca (1 SCA per item).
                      </div>
                      <button
                        onClick={async () => {
                          if (!confirm(`Lanciare ${items.length} bonifico/i via A-Cube sandbox?`)) return
                          const { data, error } = await supabase.functions.invoke('acube-payment-send', { body: { batch_id: batch.id, stage: 'sandbox' } })
                          if (error) { alert('Errore: ' + error.message); return }
                          const result = data as { initiated?: number; failed?: number; items?: Array<{ acube_authorize_url?: string; error?: string }> }
                          alert(`Risultato:\n• Iniziati: ${result.initiated ?? 0}\n• Falliti: ${result.failed ?? 0}\n\nApri ogni URL per autorizzare il bonifico sulla banca.`)
                          // Apri tutti gli URL autorizzazione
                          result.items?.forEach((it, i) => {
                            if (it.acube_authorize_url) setTimeout(() => window.open(it.acube_authorize_url, '_blank'), i * 500)
                          })
                          onRefresh()
                        }}
                        className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"
                      >
                        🚀 Paga via A-Cube ({items.length})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}

      <ConfirmDialog isOpen={!!confirmExec} onClose={() => setConfirmExec(null)} onConfirm={handleExecute}
        title="Confermare esecuzione distinta?"
        message={`La distinta ${confirmExec?.batch_number || ''} per ${fmt(confirmExec?.total_amount)} EUR verra marcata come eseguita. Il saldo del conto verra aggiornato di conseguenza.`}
        confirmLabel={executing ? 'Esecuzione...' : 'Conferma esecuzione'} />
      <ConfirmDialog isOpen={!!confirmCancel} onClose={() => setConfirmCancel(null)} onConfirm={handleCancel}
        title="Annullare questa distinta?"
        message={`La distinta ${confirmCancel?.batch_number || ''} verra annullata. Le fatture torneranno disponibili per il pagamento.`}
        confirmLabel="Annulla distinta" danger />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ TAB 6: RICONCILIAZIONE ═══
// ═══════════════════════════════════════════════════════════════════

type TxT = TransactionT
type PayT = PayableT
type MatchT = { payable: PayT; score: number; percentDiff: number; remaining: number }

function TabRiconciliazione({ transactions, payables, accounts, companyId, onRefresh }: {
  transactions: TxT[]
  payables: PayT[]
  accounts: AccountT[]
  companyId: string
  onRefresh: () => void
}) {
  const [filterAccount, setFilterAccount] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedMovement, setSelectedMovement] = useState<TxT | null>(null)
  const [manualPayableId, setManualPayableId] = useState('')
  // Nuovo: campo di ricerca per il combobox abbinamento manuale
  const [manualSearch, setManualSearch] = useState('')
  const [reconciling, setReconciling] = useState(false)

  // Get unreconciled outgoing movements
  const unreconciledMovements = useMemo(() => {
    let items = transactions.filter((t) => !t.is_reconciled && (Number(t.amount) || 0) < 0)
    if (filterAccount !== 'all') items = items.filter((t) => t.bank_account_id === filterAccount)
    if (search) {
      const q = search.toLowerCase()
      items = items.filter((t) => String(t.description || '').toLowerCase().includes(q) || String(t.counterpart_name || '').toLowerCase().includes(q))
    }
    return items.sort((a, b) => new Date(String(b.transaction_date) || 0).getTime() - new Date(String(a.transaction_date) || 0).getTime())
  }, [transactions, filterAccount, search])

  // Unpaid payables for matching
  const unpaidPayables = useMemo(() =>
    payables.filter((p) => p.status === 'da_pagare' || p.status === 'in_scadenza' || p.status === 'scaduto' || p.status === 'parziale'),
    [payables]
  )

  /**
   * Lista payables per il combobox 'Abbinamento manuale':
   *  1. Filtra per testo (fornitore, numero fattura, importo)
   *  2. Ordina per prossimita' all'importo del movimento selezionato (±5%)
   *     quindi alfabeticamente, quindi per scadenza
   *  3. Limita a 20 risultati per non appesantire il DOM
   * Mostra l'importo REALE gross_amount (bug segnalato: mostrava sempre 0).
   */
  const manualMatchCandidates = useMemo(() => {
    const q = manualSearch.trim().toLowerCase()
    const mvAmt = selectedMovement ? Math.abs(Number(selectedMovement.amount) || 0) : null
    const tolerance: number = mvAmt ? mvAmt * 0.05 : 0

    let list = unpaidPayables.slice()

    if (q.length >= 2) {
      list = list.filter((p) =>
        getSupplierName(p).toLowerCase().includes(q) ||
        String(p.invoice_number || '').toLowerCase().includes(q) ||
        String(p.gross_amount || '').includes(q)
      )
    }

    list.sort((a, b) => {
      const aAmt = Math.abs(Number(a.gross_amount) || 0)
      const bAmt = Math.abs(Number(b.gross_amount) || 0)
      // Se c'e' un movimento selezionato, metti prima gli importi vicini
      if (mvAmt != null) {
        const aDiff = Math.abs(aAmt - mvAmt)
        const bDiff = Math.abs(bAmt - mvAmt)
        const aClose = aDiff <= tolerance
        const bClose = bDiff <= tolerance
        if (aClose && !bClose) return -1
        if (!aClose && bClose) return 1
        if (aClose && bClose) return aDiff - bDiff
      }
      // Ordine alfabetico per fornitore
      const nameCompare = getSupplierName(a).toLowerCase().localeCompare(getSupplierName(b).toLowerCase())
      if (nameCompare !== 0) return nameCompare
      // Poi per scadenza
      return new Date(String(a.due_date) || 0).getTime() - new Date(String(b.due_date) || 0).getTime()
    })

    return list.slice(0, 20)
  }, [unpaidPayables, manualSearch, selectedMovement])

  // Auto-match function: match by amount with 5% tolerance, produce confidence score
  const findMatches = useCallback((movement: TxT | null): MatchT[] => {
    if (!movement) return []
    const mvAmount = Math.abs(Number(movement.amount) || 0)
    const tolerance = 0.05 // 5%
    const mvDate = new Date(String(movement.transaction_date) || 0)
    const mvDesc = String(movement.description || '').toLowerCase()
    const mvCounterpart = String(movement.counterpart_name || '').toLowerCase()

    return unpaidPayables
      .map((p): MatchT | null => {
        const remaining = p.amount_remaining != null ? Number(p.amount_remaining) : (Number(p.gross_amount || 0) - Number(p.amount_paid || 0))
        const diff = Math.abs(remaining - mvAmount)
        const percentDiff = remaining > 0 ? diff / remaining : 1

        if (percentDiff > tolerance) return null

        let score = 0
        // Amount score (max 50)
        if (percentDiff === 0) score += 50
        else if (percentDiff <= 0.01) score += 45
        else if (percentDiff <= 0.02) score += 35
        else if (percentDiff <= 0.05) score += 25

        // Name match score (max 30)
        const supplierLow = getSupplierName(p).toLowerCase()
        if (supplierLow && (mvDesc.includes(supplierLow) || mvCounterpart.includes(supplierLow))) {
          score += 30
        } else if (supplierLow) {
          const words = supplierLow.split(/\s+/).filter((w: string) => w.length > 3)
          const matchedWords = words.filter((w: string) => mvDesc.includes(w) || mvCounterpart.includes(w))
          if (matchedWords.length > 0) score += 10 + Math.min(20, matchedWords.length * 7)
        }

        // Date proximity score (max 20)
        if (p.due_date) {
          const dueDate = new Date(String(p.due_date))
          const daysDiff = Math.abs(Math.ceil((mvDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)))
          if (daysDiff <= 3) score += 20
          else if (daysDiff <= 7) score += 15
          else if (daysDiff <= 30) score += 10
          else if (daysDiff <= 60) score += 5
        }

        return { payable: p, score, percentDiff, remaining }
      })
      .filter((m): m is MatchT => m !== null && m.score >= 85) // Solo match >= 85% — sotto è rumore
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
  }, [unpaidPayables])

  const matches = useMemo(() => findMatches(selectedMovement), [selectedMovement, findMatches])

  const handleReconcile = async (movement: TxT, payable: PayT) => {
    setReconciling(true)
    try {
      const now = new Date().toISOString()
      // Mark transaction as reconciled
      const { error: txErr } = await supabase.from('bank_transactions').update({
        is_reconciled: true,
        reconciled_at: now,
        reconciled_invoice_id: payable.id,
      } as never).eq('id', String(movement.id)).eq('company_id', companyId)
      if (txErr) throw txErr

      // Update payable
      const newPaid = Number(payable.amount_paid || 0) + Math.abs(Number(movement.amount) || 0)
      const totalDue = Number(payable.gross_amount || 0)
      const newRemaining = Math.max(0, totalDue - newPaid)
      const newStatus = newPaid >= totalDue ? 'pagato' : 'parziale'
      const { error: payErr } = await supabase.from('payables').update({
        amount_paid: newPaid,
        amount_remaining: newRemaining,
        status: newStatus,
        cash_movement_id: movement.id,
      } as never).eq('id', String(payable.id)).eq('company_id', companyId)
      if (payErr) throw payErr

      setSelectedMovement(null)
      onRefresh()
    } catch (err: unknown) {
      console.error('Reconcile error:', err)
      alert(`Errore: ${(err as Error).message}`)
    } finally {
      setReconciling(false)
    }
  }

  const handleManualReconcile = async () => {
    if (!selectedMovement || !manualPayableId) return
    const payable = unpaidPayables.find((p) => p.id === manualPayableId)
    if (!payable) { alert('Fattura non trovata'); return }
    await handleReconcile(selectedMovement, payable)
    setManualPayableId('')
  }

  const handleMarkIgnored = async (movement: TxT) => {
    try {
      await supabase.from('bank_transactions').update({
        is_reconciled: true,
        reconciled_at: new Date().toISOString(),
        note: (movement.note ? String(movement.note) + ' | ' : '') + 'Ignorato manualmente',
      } as never).eq('id', String(movement.id)).eq('company_id', companyId)
      setSelectedMovement(null)
      onRefresh()
    } catch (err: unknown) {
      console.error('Mark ignored error:', err)
    }
  }

  const confidenceColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-100 text-emerald-700'
    if (score >= 50) return 'bg-amber-100 text-amber-700'
    return 'bg-red-100 text-red-700'
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: unreconciled movements */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[180px] relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca movimento..."
                className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">Tutti i conti</option>
              {accounts.filter(a => a.is_active !== false).map(a => (
                <option key={a.id} value={a.id}>{a.account_name || a.bank_name}</option>
              ))}
            </select>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            {unreconciledMovements.length} movimenti da riconciliare
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {unreconciledMovements.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="Tutto riconciliato" description="Non ci sono movimenti in uscita da riconciliare." />
          ) : (
            <div className="divide-y divide-slate-50 max-h-[600px] overflow-y-auto">
              {unreconciledMovements.map(m => {
                const acct = accounts.find(a => a.id === m.bank_account_id)
                const isSelected = selectedMovement?.id === m.id
                // Quick match check
                const quickMatches = findMatches(m)
                const bestScore = quickMatches.length > 0 ? quickMatches[0].score : 0

                return (
                  <div
                    key={m.id}
                    className={classNames(
                      'flex items-center gap-3 px-5 py-3 cursor-pointer transition',
                      isSelected ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                    )}
                    onClick={() => setSelectedMovement(isSelected ? null : m)}
                  >
                    <div className="p-1.5 rounded-lg bg-red-50">
                      <ArrowUpRight size={14} className="text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{m.description || 'Movimento'}</div>
                      <div className="text-xs text-slate-400">
                        {fmtDate(m.transaction_date)} {acct ? `\u2022 ${acct.account_name || acct.bank_name}` : ''}
                        {m.counterpart_name && ` \u2022 ${m.counterpart_name}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-red-600">{fmt(m.amount)} &euro;</div>
                      {bestScore > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${confidenceColor(bestScore)}`}>
                          {bestScore}%
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right: matching suggestions */}
      <div className="space-y-4">
        {!selectedMovement ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <EmptyState icon={Link2} title="Seleziona un movimento" description="Clicca su un movimento dalla lista a sinistra per vedere le proposte di abbinamento." />
          </div>
        ) : (
          <>
            {/* Selected movement summary */}
            <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Movimento selezionato</h3>
              <div className="space-y-1">
                <div className="text-lg font-bold text-red-600">{fmt(selectedMovement.amount)} &euro;</div>
                <div className="text-sm text-slate-700">{selectedMovement.description || '\u2014'}</div>
                <div className="text-xs text-slate-400">
                  {fmtDate(selectedMovement.transaction_date)}
                  {selectedMovement.counterpart_name && ` \u2022 ${selectedMovement.counterpart_name}`}
                </div>
              </div>
            </div>

            {/* Auto-match suggestions */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="p-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Sparkles size={16} className="text-amber-500" /> Proposte di abbinamento
                </h3>
              </div>
              {matches.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-slate-400">Nessun abbinamento trovato (tolleranza &plusmn;5%)</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {matches.map((match, idx) => {
                    const p = match.payable
                    return (
                      <div key={p.id} className="p-4 hover:bg-slate-50">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-slate-900">{getSupplierName(p)}</span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${confidenceColor(match.score)}`}>
                                {match.score}%
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {p.invoice_number || ''} {p.due_date ? `\u2022 Scadenza ${fmtDate(p.due_date)}` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-slate-900">{fmt(match.remaining)} &euro;</div>
                            {match.percentDiff > 0 && (
                              <div className="text-xs text-amber-500">diff. {(match.percentDiff * 100).toFixed(1)}%</div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleReconcile(selectedMovement, p)}
                          disabled={reconciling}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 transition"
                        >
                          <Link2 size={12} /> Riconcilia
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Manual match — combobox con ricerca, ordinamento alfabetico e
                pre-ordinamento per importo vicino al movimento selezionato */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Abbinamento manuale</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Cerca fattura da abbinare
                  {selectedMovement && (
                    <span className="text-slate-400 font-normal ml-1">
                      (le fatture con importo vicino a {fmt(Math.abs(Number(selectedMovement.amount) || 0))} € sono in cima)
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={manualSearch}
                  onChange={e => setManualSearch(e.target.value)}
                  placeholder="Fornitore, n. fattura, importo..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="mt-2 max-h-72 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
                  {manualMatchCandidates.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-slate-400">
                      {unpaidPayables.length === 0 ? 'Nessuna fattura non pagata' : 'Nessun risultato — prova altri termini'}
                    </div>
                  ) : manualMatchCandidates.map(p => {
                    const isSelected = manualPayableId === p.id
                    const amt = Math.abs(Number(p.gross_amount) || 0)
                    const mvAmt = selectedMovement ? Math.abs(Number(selectedMovement.amount) || 0) : null
                    const isClose = mvAmt && Math.abs(amt - mvAmt) <= mvAmt * 0.05
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setManualPayableId(p.id)}
                        className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-3 ${isSelected ? 'bg-blue-50 ring-2 ring-blue-400' : ''}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-slate-900 truncate">{getSupplierName(p)}</div>
                          <div className="text-[11px] text-slate-500">
                            Fatt. {p.invoice_number || '—'} · Scad. {fmtDate ? fmtDate(p.due_date) : p.due_date}
                            {p.status && <span className="ml-2 text-slate-400">· {p.status}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-semibold ${isClose ? 'text-emerald-700' : 'text-slate-700'}`}>
                            {fmt(p.gross_amount)} €
                          </div>
                          {isClose && (
                            <div className="text-[9px] text-emerald-600 font-semibold uppercase">match importo</div>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleManualReconcile} disabled={!manualPayableId || reconciling}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition">
                  <Link2 size={12} /> Riconcilia manualmente
                </button>
                <button onClick={() => handleMarkIgnored(selectedMovement)}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 transition">
                  <Unlink size={12} /> Ignora
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ MAIN COMPONENT ═══
// ═══════════════════════════════════════════════════════════════════

export default function TesoreriaManuale() {
  const { session } = useAuth()
  const companyId = session?.user?.app_metadata?.company_id || '00000000-0000-0000-0000-000000000001'

  // activeTab persistito in URL come ?tab=… (default 'panoramica')
  // L'URL `?tab=…&select=…` era già supportato in lettura: ora persiste
  // anche nei click utente.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: TesoreriaTab = VALID_TESORERIA_TABS.includes(tabParam as TesoreriaTab)
    ? (tabParam as TesoreriaTab)
    : 'panoramica'
  const setActiveTab = (next: TesoreriaTab) => {
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setSearchParams(params)
  }
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  // Data state
  const [accounts, setAccounts] = useState<any[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [payables, setPayables] = useState<any[]>([])
  const [batches, setBatches] = useState<any[]>([])
  const [batchItems, setBatchItems] = useState<any[]>([])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  // Fetch all data
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [acctRes, txRes, payRes, batchRes, itemsRes] = await Promise.all([
          supabase.from('bank_accounts').select('*').eq('company_id', companyId).order('bank_name'),
          supabase.from('bank_transactions').select('*').eq('company_id', companyId).order('transaction_date', { ascending: false }).limit(2000),
          supabase.from('payables').select('*, suppliers(id, name, ragione_sociale, iban)').eq('company_id', companyId).order('due_date'),
          supabase.from('payment_batches').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
          supabase.from('payment_batch_items').select('*').eq('company_id', companyId).order('priority'),
        ])

        if (!cancelled) {
          setAccounts(acctRes.data || [])
          setTransactions(txRes.data || [])
          setPayables(payRes.data || [])
          setBatches(batchRes.data || [])
          setBatchItems(itemsRes.data || [])
        }
      } catch (err: unknown) {
        console.error('TesoreriaManuale load error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [companyId, refreshKey])

  // I figli passano stringhe (alcune obsolete come 'pagamenti'): validiamo
  // contro VALID_TESORERIA_TABS e ignoriamo i valori sconosciuti.
  const handleNavigate = useCallback((tab: string) => {
    if (VALID_TESORERIA_TABS.includes(tab as TesoreriaTab)) {
      setSearchParams(prev => {
        const params = new URLSearchParams(prev)
        params.set('tab', tab)
        return params
      })
    }
  }, [setSearchParams])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-96">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw size={32} className="text-blue-500 animate-spin" />
          <span className="text-sm text-slate-500">Caricamento banche...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 rounded-xl"><Landmark size={22} className="text-blue-600" /></div>
            Banche
          </h1>
          <p className="text-sm text-slate-500 mt-1">Gestione conti bancari, estratti conto e riconciliazione</p>
        </div>
        <button onClick={refresh} className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm">
          <RefreshCw size={14} /> Aggiorna
        </button>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            // Badge counts
            let badge = null
            if (tab.key === 'riconciliazione') {
              const unrecCount = transactions.filter(t => !t.is_reconciled && (t.amount || 0) < 0).length
              if (unrecCount > 0) badge = unrecCount
            }

            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={classNames(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition',
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                )}
              >
                <Icon size={16} />
                {tab.label}
                {badge != null && (
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold min-w-[20px] text-center">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'panoramica' && (
        <TabPanoramica accounts={accounts} transactions={transactions} payables={payables} onNavigate={handleNavigate} />
      )}
      {activeTab === 'conti' && (
        <TabContiBancari accounts={accounts} companyId={companyId} onRefresh={refresh} />
      )}
      {activeTab === 'movimenti' && (
        <TabMovimenti transactions={transactions} accounts={accounts} />
      )}
      {activeTab === 'riconciliazione' && (
        <TabRiconciliazione transactions={transactions} payables={payables} accounts={accounts} companyId={companyId} onRefresh={refresh} />
      )}
    </div>
  )
}
