// SMOKE TEST AutoFix 2026-05-28 - rimuovere dopo verifica
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  Landmark, Building2, Wallet, CreditCard, TrendingUp, TrendingDown,
  Search, ChevronDown, ChevronUp, Banknote, Store, PiggyBank,
  Plus, Edit2, Trash2, Check, X, AlertCircle, Download, Upload,
  ArrowUpRight, ArrowDownLeft, Filter, Eye, EyeOff, RefreshCw,
  Clock, ListOrdered, Link2, CheckCircle2, History, FileText, BookOpen,
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
type TesoreriaTab = 'panoramica' | 'conti' | 'movimenti' | 'riconciliazione' | 'prima_nota' | 'finanziamenti'
const VALID_TESORERIA_TABS: TesoreriaTab[] = ['panoramica', 'conti', 'movimenti', 'riconciliazione', 'prima_nota', 'finanziamenti']
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import { useToast } from '../components/Toast'
import { BANK_CATEGORY_OPTIONS, bankCategoryLabel } from '../lib/bankCategories'
import PrimaNota from './PrimaNota'
import OpenBankingAcube from '../components/OpenBankingAcube'
import FinanziamentiTab from '../components/FinanziamentiTab'
import CellTooltip from '../components/Tooltip'
import SyncStatusBadge from '../components/SyncStatusBadge'

// ═══════════════════════════════════════════════════════════════════
// ═══ HELPERS ═══
// ═══════════════════════════════════════════════════════════════════

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#f97316']

const TABS = [
  { key: 'panoramica', label: 'Panoramica', icon: BarChart3 },
  { key: 'conti', label: 'Conti Bancari', icon: Building2 },
  { key: 'movimenti', label: 'Movimenti', icon: ArrowUpRight },
  { key: 'riconciliazione', label: 'Riconciliazione', icon: Link2 },
  { key: 'prima_nota', label: 'Prima Nota', icon: BookOpen },
  { key: 'finanziamenti', label: 'Finanziamenti', icon: Banknote },
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
  return new Intl.NumberFormat('de-DE', {
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
type TransactionT = Record<string, unknown> & { id: string; transaction_date?: string | null; amount?: number | null; type?: string | null; description?: string | null; bank_account_id?: string | null; reconciliation_status?: string | null; counterpart_name?: string | null; is_reconciled?: boolean | null; note?: string | null; reconciled_at?: string | null; reconciled_invoice_id?: string | null; category?: string | null }
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
                      <CellTooltip content={getSupplierName(p)}><div className="text-sm font-medium text-slate-900 truncate">{getSupplierName(p)}</div></CellTooltip>
                      <div className="text-xs text-slate-400" title={String(p.invoice_number || '')}>{String(p.invoice_number || '')} - Scadenza {fmtDate(p.due_date)}</div>
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
                      <CellTooltip content={(m.description as string | null) || (m.counterpart_name as string | null) || 'Movimento'}><div className="text-sm font-medium text-slate-900 truncate">{(m.description as string | null) || (m.counterpart_name as string | null) || 'Movimento'}</div></CellTooltip>
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
  type ImportResultT = { success: boolean; count?: number; skipped?: number; error?: string } | null
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
          // 'booked' = contabilizzato: attiva il trigger di riconciliazione automatica
          status: 'booked',
        }
      }).filter(t => t.amount !== 0)

      // ─────────────────────────────────────────────────────────────
      // DEDUP: evita raddoppio movimenti se l'utente reimporta
      // un CSV già caricato (anche parzialmente sovrapposto).
      // Chiave dedup: bank_account_id|transaction_date|amount|description trimmed.
      // Filtra sia contro i movimenti esistenti su DB nello stesso range
      // di date sia contro duplicati interni al CSV stesso.
      // ─────────────────────────────────────────────────────────────
      const makeKey = (date: string, amount: number, desc: string) =>
        `${date}|${Number(amount).toFixed(2)}|${(desc || '').trim().toLowerCase()}`

      const dates = transactions
        .map(t => t.transaction_date)
        .filter((d): d is string => Boolean(d))
        .sort()
      const minDate = dates[0]
      const maxDate = dates[dates.length - 1]

      const existingKeys = new Set<string>()
      if (minDate && maxDate) {
        const { data: existingRows, error: existingErr } = await supabase
          .from('bank_transactions')
          .select('transaction_date, amount, description')
          .eq('company_id', companyId)
          .eq('bank_account_id', account.id)
          .gte('transaction_date', minDate)
          .lte('transaction_date', maxDate)
          .limit(50000)
        if (existingErr) throw existingErr
        for (const r of (existingRows ?? []) as Array<{ transaction_date: string; amount: number | string; description: string | null }>) {
          existingKeys.add(makeKey(r.transaction_date, Number(r.amount), r.description ?? ''))
        }
      }

      const seenKeys = new Set<string>()
      const toInsert = transactions.filter(t => {
        const k = makeKey(t.transaction_date ?? '', t.amount, t.description ?? '')
        if (existingKeys.has(k) || seenKeys.has(k)) return false
        seenKeys.add(k)
        return true
      })
      let skipped = transactions.length - toInsert.length

      // Insert in batches of 100. Doppia rete di sicurezza:
      // 1) Dedup client-side gia' applicato sopra
      // 2) Il DB ha UNIQUE INDEX (company_id, import_dedup_hash) — se per qualche
      //    motivo (race condition, normalizzazione differente) un duplicato
      //    sfugge al check client, l'insert batch fallisce con code 23505.
      //    In quel caso facciamo fallback row-by-row e contiamo i rifiuti DB.
      let inserted = 0
      for (let i = 0; i < toInsert.length; i += 100) {
        const batch = toInsert.slice(i, i + 100)
        const { error: txErr } = await supabase.from('bank_transactions').insert(batch as never)
        if (!txErr) {
          inserted += batch.length
          continue
        }
        const code = (txErr as { code?: string }).code
        if (code !== '23505') throw txErr
        // Fallback row-by-row: il batch conteneva almeno un duplicato che il DB ha rigettato
        for (const row of batch) {
          const { error: rowErr } = await supabase.from('bank_transactions').insert([row] as never)
          if (!rowErr) {
            inserted++
            continue
          }
          const rowCode = (rowErr as { code?: string }).code
          if (rowCode === '23505') {
            skipped++
            continue
          }
          throw rowErr
        }
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

      setImportResult({ success: true, count: inserted, skipped })
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
                    <td className="px-3 py-2 text-slate-700 max-w-[250px]"><CellTooltip content={row.description}><div className="truncate">{row.description}</div></CellTooltip></td>
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
            Verranno analizzate <strong>{parsed?.rows?.length || 0}</strong> righe. Le righe con importo zero e i duplicati gi&agrave; presenti per questo conto saranno saltati automaticamente.
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
              {(importResult.skipped ?? 0) > 0 && (
                <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 inline-block">
                  <AlertTriangle size={12} className="inline mr-1" />
                  {importResult.skipped} riga{importResult.skipped === 1 ? '' : 'he'} duplicat{importResult.skipped === 1 ? 'a' : 'e'} salt{importResult.skipped === 1 ? 'ata' : 'ate'} (gi&agrave; presenti per questo conto nel periodo).
                </p>
              )}
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
      {/* Open Banking A-Cube — collegamento banche via PSD2 */}
      <OpenBankingAcube />

      {/* "Totale disponibilita" + griglia 3 KPI ridondante rimossa: gli stessi
          conti, saldi, IBAN e timestamp di sincronizzazione sono gia' mostrati
          nel riquadro Open Banking A-Cube sopra. Patrizio (29/05/2026): "ci sono
          2 volte i totali e 2 volte i singoli, usa solo quelli piu in alto e leva
          il totale e i tre kpi che sono ridondanti". */}
      {false && (
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
                    {acct.acube_account_uuid ? (
                      <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200" title="Conto sincronizzato via A-Cube Open Banking — read-only">
                        A-Cube
                      </span>
                    ) : (
                      <>
                        <button onClick={() => { setEditAccount(acct as unknown as AccountFormT); setShowAdd(true) }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Modifica">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => setDeleteConfirm(acct)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500" title="Disattiva">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
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

                {/* Bottoni "Aggiorna saldo" e "Importa EC" rimossi: saldo + movimenti arrivano via A-Cube automatico */}
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

function TabMovimenti({ transactions, accounts, onAssignCategory, initialCategoryFilter, year }: { transactions: TransactionT[]; accounts: AccountT[]; onAssignCategory: (t: TransactionT, category: string) => void | Promise<void>; initialCategoryFilter?: string; year: number }) {
  // Deep-link Dashboard: ?filter=senza-categoria preseleziona il filtro categoria
  // e azzera il range date (default = mese corrente) per mostrare TUTTI i movimenti
  // senza categoria, non solo quelli del mese.
  const wantsUncat = initialCategoryFilter === 'senza_categoria'
  const [searchInput, setSearchInput] = useState('') // input non applicato
  const [search, setSearch] = useState('')           // valore applicato (premuto Cerca o Enter)
  const [filterAccount, setFilterAccount] = useState('all')
  const [filterType, setFilterType] = useState('all') // all, entrata, uscita
  const [filterReconciled, setFilterReconciled] = useState('all') // all, yes, no
  const [filterCategory, setFilterCategory] = useState(() => wantsUncat ? 'senza_categoria' : 'all') // all, senza_categoria, <slug>
  // Default: l'anno selezionato dal Period Selector globale (modificabile).
  // Col deep-link senza-categoria: vuoto (mostra tutti gli scategorizzati).
  const [dateFrom, setDateFrom] = useState(() => wantsUncat ? '' : `${year}-01-01`)
  const [dateTo, setDateTo] = useState(() => wantsUncat ? '' : `${year}-12-31`)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50) // 50/100/250 selezionabile (default 50)
  const [sortField, setSortField] = useState<keyof TransactionT | string>('transaction_date')
  const [sortDir, setSortDir] = useState('desc')
  const [assigningId, setAssigningId] = useState<string | null>(null)

  // Se il deep-link cambia dopo il mount (navigazione da Dashboard con Banche già aperta)
  useEffect(() => {
    if (initialCategoryFilter === 'senza_categoria') {
      setFilterCategory('senza_categoria'); setDateFrom(''); setDateTo('')
    }
  }, [initialCategoryFilter])

  // L'anno selezionato dal Period Selector globale guida il range del tab Movimenti:
  // selezionando un anno la lista mostra i movimenti di quell'anno. Il deep-link
  // "senza-categoria" resta senza date (mostra tutti gli scategorizzati, vedi sopra).
  useEffect(() => {
    if (wantsUncat) return
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
  }, [year, wantsUncat])

  const uncategorizedCount = useMemo(() => transactions.filter(t => t.category == null).length, [transactions])

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
    if (filterCategory === 'senza_categoria') items = items.filter(t => t.category == null)
    else if (filterCategory !== 'all') items = items.filter(t => t.category === filterCategory)
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
  }, [transactions, search, filterAccount, filterType, filterReconciled, filterCategory, dateFrom, dateTo, sortField, sortDir])

  const totalPages = Math.ceil(filtered.length / perPage) || 1
  const pageItems = filtered.slice((page - 1) * perPage, page * perPage)
  const rangeStart = filtered.length === 0 ? 0 : (page - 1) * perPage + 1
  const rangeEnd = Math.min(page * perPage, filtered.length)

  const totalEntrate = useMemo(() => filtered.reduce<number>((s, t) => s + ((t.amount || 0) > 0 ? (t.amount || 0) : 0), 0), [filtered])
  const totalUscite = useMemo(() => filtered.reduce<number>((s, t) => s + ((t.amount || 0) < 0 ? Math.abs(t.amount || 0) : 0), 0), [filtered])
  const totalFiltered = useMemo(() => filtered.reduce<number>((s, t) => s + (t.amount || 0), 0), [filtered])

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ChevronsUpDown size={12} className="text-slate-300" />
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-600" /> : <ChevronDown size={12} className="text-blue-600" />
  }

  useEffect(() => { setPage(1) }, [search, filterAccount, filterType, filterReconciled, filterCategory, dateFrom, dateTo, perPage])

  // Assegna/azzera la categoria contabile reale (bank_transactions.category).
  const handleCategoryChange = async (t: TransactionT, value: string) => {
    setAssigningId(t.id)
    try {
      await onAssignCategory(t, value)
    } finally {
      setAssigningId(null)
    }
  }

  // Reset di TUTTI i filtri ai valori di default (utile quando i numeri non tornano)
  const handleResetFilters = () => {
    setSearchInput('')
    setSearch('')
    setFilterAccount('all')
    setFilterType('all')
    setFilterReconciled('all')
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
    setPage(1)
  }

  const handleCerca = () => {
    setSearch(searchInput.trim())
    setPage(1)
  }

  // Helper: build rows array per export (riusabile da CSV / XLSX / PDF)
  const buildExportRows = () => {
    const headers = ['Data', 'Banca', 'Descrizione', 'Importo', 'Saldo', 'Riconciliato']
    const rows = filtered.map(t => {
      const acct = accounts.find(a => a.id === t.bank_account_id)
      return [
        fmtDate(t.transaction_date),
        (acct?.bank_name as string | undefined) || (acct?.account_name as string | undefined) || '',
        String(t.description || ''),
        Number(t.amount) || 0,
        t.running_balance != null ? Number(t.running_balance) : '',
        t.is_reconciled ? 'S\u00EC' : 'No',
      ]
    })
    return { headers, rows }
  }

  const handleExportCSV = () => {
    const { headers, rows } = buildExportRows()
    const csvRows = rows.map(r => r.map((v, i) => {
      if (i === 3 || i === 4) return typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v
      return `"${String(v).replace(/"/g, '""')}"`
    }).join(';'))
    const csv = [headers.join(';'), ...csvRows].join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `movimenti_${new Date().toISOString().slice(0,10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const handleExportXLSX = async () => {
    const XLSX = await import('xlsx')
    const { headers, rows } = buildExportRows()
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 60 }, { wch: 12 }, { wch: 12 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Movimenti')
    XLSX.writeFile(wb, `movimenti_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  // PDF via browser print (utente sceglie "Salva come PDF" nel dialog di stampa)
  const handleExportPDF = () => {
    const { headers, rows } = buildExportRows()
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    const escape = (s: string | number) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c))
    const trs = rows.map(r => `<tr>${r.map((v, i) => {
      const cls = (i === 3 || i === 4) ? 'num' : ''
      const display = (i === 3 || i === 4) && typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v)
      return `<td class="${cls}">${escape(display)}</td>`
    }).join('')}</tr>`).join('')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Movimenti bancari</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 20px; color: #111827; }
        h1 { font-size: 16px; margin: 0 0 4px; }
        .meta { font-size: 10px; color: #6b7280; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; }
        th { background: #2563eb; color: white; padding: 6px; text-align: left; font-weight: 600; }
        td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; }
        td.num { text-align: right; white-space: nowrap; }
        @media print { @page { size: A4 landscape; margin: 10mm; } }
      </style></head><body>
      <h1>Movimenti bancari</h1>
      <div class="meta">Periodo: ${escape(fmtDate(dateFrom) || '\u2014')} \u2192 ${escape(fmtDate(dateTo) || '\u2014')} \u2022 ${filtered.length} movimenti \u2022 Saldo netto: ${escape(fmt(totalFiltered))} \u20AC</div>
      <table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${trs}</tbody></table>
      <script>setTimeout(() => window.print(), 250);</script>
      </body></html>`)
    w.document.close()
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCerca(); }}
              placeholder="Cerca descrizione, controparte… (Invio per filtrare)"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">Tutti i conti</option>
            {accounts.filter(a => a.is_active !== false).map(a => (
              <option key={a.id} value={a.id}>{(a.bank_name as string | undefined) || (a.account_name as string | undefined) || 'Conto'}</option>
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
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            title="Filtra per categoria contabile"
            className={classNames(
              'px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
              filterCategory === 'senza_categoria' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200'
            )}>
            <option value="all">Tutte le categorie</option>
            <option value="senza_categoria">Senza categoria{uncategorizedCount > 0 ? ` (${uncategorizedCount})` : ''}</option>
            {BANK_CATEGORY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" title="Da data" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" title="A data" />
          <button onClick={handleCerca} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white">
            <Search size={14} /> Cerca
          </button>
          <button onClick={handleResetFilters} title="Ripristina tutti i filtri al default (mese corrente, tutti i conti)" className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50">
            Pulisci filtri
          </button>
          <button onClick={handleExportPDF} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50" title="Esporta in PDF">
            <Download size={14} /> PDF
          </button>
          <button onClick={handleExportCSV} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50" title="Esporta in CSV">
            <Download size={14} /> CSV
          </button>
          <button onClick={handleExportXLSX} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50" title="Esporta in Excel">
            <Download size={14} /> Excel
          </button>
        </div>
        {/* Riga 1: riepilogo numeri (sempre dei filtri attivi) */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-xs">
          <span className="text-slate-600"><strong className="text-slate-900">{filtered.length.toLocaleString('de-DE')}</strong> movimenti dal <strong>{fmtDate(dateFrom) || '—'}</strong> al <strong>{fmtDate(dateTo) || '—'}</strong></span>
          <span className="text-slate-400">·</span>
          <span className="text-slate-600">Entrate <strong className="text-emerald-600">+{fmt(totalEntrate)} €</strong></span>
          <span className="text-slate-600">Uscite <strong className="text-red-600">−{fmt(totalUscite)} €</strong></span>
          <span className="text-slate-600">Netto <strong className={totalFiltered >= 0 ? 'text-emerald-600' : 'text-red-600'}>{totalFiltered >= 0 ? '+' : ''}{fmt(totalFiltered)} €</strong></span>
        </div>
        {/* Riga 2: paginazione + per-page selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2 text-xs text-slate-500">
          <span>
            {filtered.length === 0 ? 'Nessun risultato' : <>Mostrati <strong className="text-slate-900">{rangeStart.toLocaleString('de-DE')}–{rangeEnd.toLocaleString('de-DE')}</strong> di <strong className="text-slate-900">{filtered.length.toLocaleString('de-DE')}</strong></>}
          </span>
          <div className="flex items-center gap-2">
            <label className="text-slate-500">Per pagina</label>
            <select value={perPage} onChange={e => setPerPage(Number(e.target.value))} className="px-2 py-1 border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
            </select>
          </div>
        </div>
        {transactions.length >= 10000 && (
          <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Stai vedendo i 10.000 movimenti più recenti. Restringi il periodo per non perdere dati storici.
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {pageItems.length === 0 ? (
          <EmptyState icon={ArrowUpRight}
            title={filterCategory === 'senza_categoria' ? 'Nessun movimento senza categoria' : 'Nessun movimento'}
            description={filterCategory === 'senza_categoria'
              ? 'Tutti i movimenti nel periodo/filtro selezionato hanno già una categoria contabile.'
              : 'Importa un estratto conto o collega una banca per vedere i movimenti.'} />
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
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-500">Categoria contabile</th>
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
                          <CellTooltip content={String(acct?.account_name || acct?.iban || '')}><span className="text-slate-600 text-xs truncate max-w-[160px]">{(acct?.bank_name as string | undefined) || (acct?.account_name as string | undefined) || '\u2014'}</span></CellTooltip>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-900 max-w-[300px]">
                        <CellTooltip content={String(t.description || '')}><div className="truncate cursor-help">{t.description || '\u2014'}</div></CellTooltip>
                        {Boolean(t.counterpart_name) && <CellTooltip content={String(t.counterpart_name)}><div className="text-xs text-slate-400 truncate">{String(t.counterpart_name)}</div></CellTooltip>}
                      </td>
                      <td className={classNames('px-4 py-3 text-right font-semibold whitespace-nowrap', (Number(t.amount) || 0) >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {(Number(t.amount) || 0) >= 0 ? '+' : ''}{fmt(t.amount)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 whitespace-nowrap">
                        {t.running_balance != null ? fmt(Number(t.running_balance)) : '\u2014'}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={t.category || ''}
                          disabled={assigningId === t.id}
                          onChange={e => handleCategoryChange(t, e.target.value)}
                          title={bankCategoryLabel(t.category) || 'Nessuna categoria'}
                          className={classNames(
                            'max-w-[180px] px-2 py-1 rounded-md text-xs border focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition',
                            t.category ? 'border-slate-200 bg-white text-slate-700' : 'border-amber-200 bg-amber-50 text-amber-700',
                            assigningId === t.id ? 'opacity-50 cursor-wait' : 'cursor-pointer'
                          )}
                        >
                          <option value="">\u2014 Senza categoria \u2014</option>
                          {/* Slug legacy non in lista (es. "taxi"): mostralo comunque leggibile */}
                          {t.category && !BANK_CATEGORY_OPTIONS.some(o => o.value === t.category) && (
                            <option value={String(t.category)}>{bankCategoryLabel(t.category)}</option>
                          )}
                          {BANK_CATEGORY_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
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
  const { toast } = useToast()
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
      toast({ type: 'error', message: `Errore: ${(err as Error).message}` })
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
                          <CellTooltip content={getSupplierName(p)}><div className="font-medium text-slate-900 truncate max-w-[180px]">{getSupplierName(p)}</div></CellTooltip>
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
                        <CellTooltip content={getSupplierName(p)}><div className="text-sm font-medium text-slate-800 truncate">{getSupplierName(p)}</div></CellTooltip>
                        <div className="text-xs text-slate-400" title={String(p.invoice_number || '')}>{String(p.invoice_number || '')}</div>
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
  const { toast } = useToast()
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [confirmExec, setConfirmExec] = useState<BatchT | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<BatchT | null>(null)
  const [confirmAcube, setConfirmAcube] = useState<BatchT | null>(null)

  const handleAcubeSend = async () => {
    if (!confirmAcube) return
    const batch = confirmAcube
    setConfirmAcube(null)
    const { data, error } = await supabase.functions.invoke('acube-payment-send', { body: { batch_id: batch.id, stage: 'sandbox' } })
    if (error) { toast({ type: 'error', message: 'Errore: ' + error.message }); return }
    const result = data as { initiated?: number; failed?: number; items?: Array<{ acube_authorize_url?: string; error?: string }> }
    toast({ type: 'info', message: `Risultato:\n• Iniziati: ${result.initiated ?? 0}\n• Falliti: ${result.failed ?? 0}\n\nApri ogni URL per autorizzare il bonifico sulla banca.` })
    result.items?.forEach((it, i) => {
      if (it.acube_authorize_url) setTimeout(() => window.open(it.acube_authorize_url, '_blank'), i * 500)
    })
    onRefresh()
  }
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
      toast({ type: 'error', message: `Errore: ${(err as Error).message}` })
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
                        onClick={() => setConfirmAcube(batch)}
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
      <ConfirmDialog isOpen={!!confirmAcube} onClose={() => setConfirmAcube(null)} onConfirm={handleAcubeSend}
        title="Pagare via A-Cube?"
        message={`Verranno lanciati ${batchItems.filter(i => i.batch_id === confirmAcube?.id).length} bonifico/i via A-Cube (sandbox) per la distinta ${confirmAcube?.batch_number || ''}. Ogni bonifico richiede autorizzazione PSD2 sulla tua app banca.`}
        confirmLabel="Lancia bonifici" />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ TAB 6: RICONCILIAZIONE ═══
// ═══════════════════════════════════════════════════════════════════

type TxT = TransactionT
type PayT = PayableT
type MatchT = { payable: PayT; score: number; percentDiff: number; remaining: number }

// Categorie A-Cube che NON sono pagamenti a fornitori: non vanno mai riconciliate
// a una fattura (commissioni bancarie, stipendi, imposte, finanziamenti, movimenti
// finanziari, incassi). I movimenti senza categoria restano riconciliabili.
const NON_RECONCILABLE_CATEGORIES = new Set(['fees', 'wages', 'taxes', 'loans', 'financials', 'income'])
// Fallback sulla causale: alcune commissioni/spese bancarie arrivano da A-Cube SENZA
// categoria (category null), quindi le riconosciamo anche dal testo. Il pattern è
// ancorato all'inizio della causale: i pagamenti a fornitori iniziano con "Bonifico…",
// "Pagamento…", "SDD…", mai con "Comm."/"Commissioni"/"Competenze"/"Imposta di bollo"/
// "Canone"/"Spese tenuta conto" → così non si escludono per errore pagamenti reali.
const FEE_DESC_RE = /^\s*(comm\.|commission|commissioni|competenze|imposta di bollo|bollo\b|canone\b|spese tenuta conto|spese e competenze)/i
function isReconcilableTx(t: { category?: string | null; description?: string | null }): boolean {
  const c = t.category ? String(t.category) : ''
  if (NON_RECONCILABLE_CATEGORIES.has(c)) return false
  if (FEE_DESC_RE.test(String(t.description || ''))) return false
  return true
}

/* ────────────────────────────────────────
   Riepilogo del giorno (controllo operativo)
   Cosa è stato riconciliato in una data e le uscite ancora senza match
   (escluse commissioni & simili). Sola lettura: legge reconciliation_log
   e bank_transactions, non scrive nulla.
   ──────────────────────────────────────── */
type ReconLogRowR = {
  id: string
  performed_at?: string | null
  applied_amount?: number | null
  match_type?: string | null
  bank_transactions?: { transaction_date?: string | null; amount?: number | null; description?: string | null; counterpart_name?: string | null } | null
  payables?: { invoice_number?: string | null; supplier_name?: string | null; gross_amount?: number | null } | null
}
type PendingMovR = { id: string; transaction_date?: string | null; amount?: number | null; description?: string | null; counterpart_name?: string | null; bank_account_id?: string | null; category?: string | null }

function RiepilogoGiornaliero({ companyId, accounts }: { companyId: string; accounts: AccountT[] }) {
  const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const euro = (n: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  const [day, setDay] = useState<string>(() => toISO(new Date()))
  const [windowDays, setWindowDays] = useState<number>(90)
  const [reconRows, setReconRows] = useState<ReconLogRowR[]>([])
  const [pending, setPending] = useState<PendingMovR[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [pendingAmount, setPendingAmount] = useState(0)
  const [loadingRecon, setLoadingRecon] = useState(false)
  const [loadingPending, setLoadingPending] = useState(false)
  const [showRecon, setShowRecon] = useState(true)
  const [showPending, setShowPending] = useState(false)

  const isToday = day === toISO(new Date())
  const fmtD = (d?: string | null) => d ? new Date(d).toLocaleDateString('it-IT') : '—'
  const bankName = (id?: string | null) => {
    const a = accounts.find(x => x.id === id)
    return a ? (a.bank_name || a.account_name || '—') : '—'
  }
  const shiftDay = (delta: number) => {
    const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + delta)
    if (toISO(d) > toISO(new Date())) return
    setDay(toISO(d))
  }
  const reconTotal = useMemo(
    () => reconRows.reduce((s, r) => s + Math.abs(Number(r.bank_transactions?.amount ?? r.applied_amount ?? r.payables?.gross_amount ?? 0)), 0),
    [reconRows],
  )

  // Riconciliati nella data selezionata (audit reale: reconciliation_log applicati)
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    const run = async () => {
      setLoadingRecon(true)
      try {
        const start = `${day}T00:00:00`
        const nd = new Date(day + 'T00:00:00'); nd.setDate(nd.getDate() + 1)
        const end = `${toISO(nd)}T00:00:00`
        // reconciliation_log ha status/bank_transaction_id/applied_amount ma i types sono stale → cast chainable
        type LogChain = {
          eq: (k: string, v: string) => LogChain
          gte: (k: string, v: string) => LogChain
          lt: (k: string, v: string) => LogChain
          order: (k: string, o: { ascending: boolean }) => Promise<{ data: ReconLogRowR[] | null }>
        }
        const q = supabase
          .from('reconciliation_log')
          .select('id, performed_at, applied_amount, match_type, bank_transactions(transaction_date, amount, description, counterpart_name), payables(invoice_number, supplier_name, gross_amount)') as unknown as LogChain
        const { data } = await q
          .eq('company_id', companyId).eq('status', 'applied')
          .gte('performed_at', start).lt('performed_at', end)
          .order('performed_at', { ascending: false })
        if (!cancelled) setReconRows((data || []) as unknown as ReconLogRowR[])
      } catch { if (!cancelled) setReconRows([]) }
      finally { if (!cancelled) setLoadingRecon(false) }
    }
    run(); return () => { cancelled = true }
  }, [companyId, day])

  // Da riconciliare: uscite non abbinate (finestra recente, escluse commissioni & simili)
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    const run = async () => {
      setLoadingPending(true)
      try {
        let q = (supabase
          .from('bank_transactions')
          .select('id, transaction_date, amount, description, counterpart_name, bank_account_id, category')
          .eq('company_id', companyId)
          .lt('amount', 0)
          .or('is_reconciled.is.null,is_reconciled.eq.false')
          .order('transaction_date', { ascending: false })
          .limit(1000)) as unknown as { gte: (k: string, v: string) => unknown }
        if (windowDays > 0) {
          const fd = new Date(); fd.setDate(fd.getDate() - windowDays)
          q = q.gte('transaction_date', toISO(fd)) as unknown as { gte: (k: string, v: string) => unknown }
        }
        const { data } = await (q as unknown as Promise<{ data: PendingMovR[] | null }>)
        if (!cancelled) {
          const rows = ((data || []) as PendingMovR[]).filter(isReconcilableTx)
          setPending(rows.slice(0, 50))
          setPendingCount(rows.length)
          setPendingAmount(rows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0))
        }
      } catch { if (!cancelled) { setPending([]); setPendingCount(0); setPendingAmount(0) } }
      finally { if (!cancelled) setLoadingPending(false) }
    }
    run(); return () => { cancelled = true }
  }, [companyId, windowDays])

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-blue-500" />
          <span className="font-semibold text-slate-800 text-sm">Riepilogo del giorno</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => shiftDay(-1)} className="p-1.5 rounded-md border border-slate-200 hover:bg-white transition text-slate-500" title="Giorno precedente">
            <ChevronLeft size={14} />
          </button>
          <input type="date" value={day} max={toISO(new Date())}
            onChange={e => e.target.value && setDay(e.target.value)}
            className="px-2 py-1 border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-slate-700" />
          <button onClick={() => shiftDay(1)} disabled={isToday} className="p-1.5 rounded-md border border-slate-200 hover:bg-white transition text-slate-500 disabled:opacity-30" title="Giorno successivo">
            <ChevronRight size={14} />
          </button>
          {!isToday && (
            <button onClick={() => setDay(toISO(new Date()))} className="px-2 py-1 rounded-md border border-slate-200 hover:bg-white transition text-xs text-blue-600 font-medium">Oggi</button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
        <button onClick={() => setShowRecon(v => !v)} className="flex items-center justify-between gap-3 p-4 text-left hover:bg-emerald-50/30 transition">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 size={18} /></div>
            <div>
              <div className="text-xs text-slate-500">Riconciliati {isToday ? 'oggi' : `il ${fmtD(day)}`}</div>
              <div className="text-lg font-bold text-slate-900">{loadingRecon ? '…' : reconRows.length} <span className="text-sm font-medium text-slate-400">pagamenti</span></div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-emerald-600">{euro(reconTotal)} €</div>
            {showRecon ? <ChevronUp size={14} className="text-slate-300 inline mt-1" /> : <ChevronDown size={14} className="text-slate-300 inline mt-1" />}
          </div>
        </button>

        <button onClick={() => setShowPending(v => !v)} className="flex items-center justify-between gap-3 p-4 text-left hover:bg-amber-50/30 transition">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50 text-amber-600"><Clock size={18} /></div>
            <div>
              <div className="text-xs text-slate-500">Da riconciliare (uscite senza match)</div>
              <div className="text-lg font-bold text-slate-900">{loadingPending ? '…' : pendingCount} <span className="text-sm font-medium text-slate-400">movimenti</span></div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-amber-600">{euro(pendingAmount)} €</div>
            {showPending ? <ChevronUp size={14} className="text-slate-300 inline mt-1" /> : <ChevronDown size={14} className="text-slate-300 inline mt-1" />}
          </div>
        </button>
      </div>

      {showRecon && (
        <div className="border-t border-slate-100">
          {loadingRecon ? (
            <div className="p-6 text-center text-slate-400 text-sm">Caricamento…</div>
          ) : reconRows.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm">Nessun pagamento riconciliato in questa data.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-500">
                    <th className="py-2 px-4 text-left font-medium">Fornitore</th>
                    <th className="py-2 px-4 text-left font-medium">Fattura</th>
                    <th className="py-2 px-4 text-left font-medium">Movimento</th>
                    <th className="py-2 px-4 text-right font-medium">Importo</th>
                    <th className="py-2 px-4 text-center font-medium">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {reconRows.map(r => (
                    <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                      <td className="py-2 px-4 text-slate-800 max-w-[220px] truncate">{r.payables?.supplier_name || r.bank_transactions?.counterpart_name || '—'}</td>
                      <td className="py-2 px-4 text-slate-500 text-xs">{r.payables?.invoice_number || '—'}</td>
                      <td className="py-2 px-4 text-slate-500 text-xs">{fmtD(r.bank_transactions?.transaction_date)}</td>
                      <td className="py-2 px-4 text-right font-medium text-slate-900 whitespace-nowrap">{euro(Math.abs(Number(r.bank_transactions?.amount ?? r.applied_amount ?? r.payables?.gross_amount ?? 0)))} €</td>
                      <td className="py-2 px-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${r.match_type === 'manual' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>{r.match_type === 'manual' ? 'a mano' : 'auto'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showPending && (
        <div className="border-t border-slate-100">
          <div className="flex items-center justify-between gap-2 px-4 py-2 bg-amber-50/40 text-xs text-amber-800">
            <span>Uscite non ancora abbinate a una fattura (commissioni e movimenti non-fornitore esclusi). Abbinale sotto in "Da riconciliare".</span>
            <select value={windowDays} onChange={e => setWindowDays(Number(e.target.value))}
              className="px-2 py-1 border border-amber-200 rounded-md text-xs bg-white text-slate-600 focus:outline-none">
              <option value={30}>Ultimi 30 gg</option>
              <option value={60}>Ultimi 60 gg</option>
              <option value={90}>Ultimi 90 gg</option>
              <option value={180}>Ultimi 6 mesi</option>
              <option value={0}>Tutte</option>
            </select>
          </div>
          {loadingPending ? (
            <div className="p-6 text-center text-slate-400 text-sm">Caricamento…</div>
          ) : pending.length === 0 ? (
            <div className="p-6 text-center text-slate-400 text-sm">Nessuna uscita da riconciliare nel periodo scelto. Tutto abbinato 🎉</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500">
                      <th className="py-2 px-4 text-left font-medium">Data</th>
                      <th className="py-2 px-4 text-left font-medium">Banca</th>
                      <th className="py-2 px-4 text-left font-medium">Descrizione / Controparte</th>
                      <th className="py-2 px-4 text-right font-medium">Importo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map(m => (
                      <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                        <td className="py-2 px-4 text-slate-500 text-xs whitespace-nowrap">{fmtD(m.transaction_date)}</td>
                        <td className="py-2 px-4 text-slate-500 text-xs max-w-[140px] truncate">{bankName(m.bank_account_id)}</td>
                        <td className="py-2 px-4 text-slate-700 text-xs max-w-[280px] truncate">{m.counterpart_name || m.description || '—'}</td>
                        <td className="py-2 px-4 text-right font-medium text-red-500 whitespace-nowrap">-{euro(Math.abs(Number(m.amount) || 0))} €</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pendingCount > pending.length && (
                <div className="px-4 py-2 text-center text-xs text-slate-400 border-t border-slate-100">
                  Mostrati i {pending.length} più recenti di {pendingCount}. Restringi il periodo o abbinali sotto.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function TabRiconciliazione({ transactions, payables, accounts, companyId, onRefresh }: {
  transactions: TxT[]
  payables: PayT[]
  accounts: AccountT[]
  companyId: string
  onRefresh: () => void
}) {
  const { toast } = useToast()
  const [filterAccount, setFilterAccount] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedMovement, setSelectedMovement] = useState<TxT | null>(null)
  const [manualPayableId, setManualPayableId] = useState('')
  // Nuovo: campo di ricerca per il combobox abbinamento manuale
  const [manualSearch, setManualSearch] = useState('')
  const [reconciling, setReconciling] = useState(false)

  // Suggerimenti riconciliazione (reconciliation_log) + vista riconciliati + annullo
  type LogRow = { id: string; bank_transaction_id: string | null; payable_id: string | null; confidence: number | null; status: string; applied_amount: number | null }
  type SugRow = { log: LogRow; bt: TxT; payable: PayT; confidence: number }
  const [viewMode, setViewMode] = useState<'da_riconciliare' | 'riconciliati'>('da_riconciliare')
  const [suggCollapsed, setSuggCollapsed] = useState(false)
  const [logRows, setLogRows] = useState<LogRow[]>([])
  const [selectedSug, setSelectedSug] = useState<Set<string>>(new Set())
  const [summaryModal, setSummaryModal] = useState<{ rows: SugRow[] } | null>(null)
  const [undoModal, setUndoModal] = useState<{ logId: string; label: string; amount: number } | null>(null)
  const [processingSug, setProcessingSug] = useState(false)

  // Get unreconciled outgoing movements
  const unreconciledMovements = useMemo(() => {
    let items = transactions.filter((t) => !t.is_reconciled && (Number(t.amount) || 0) < 0 && isReconcilableTx(t))
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
      // RPC transazionale (tutto-o-niente). NON tocca payables.cash_movement_id che e'
      // GENERATED ALWAYS AS (bank_transaction_id): scrive bank_transaction_id sulla
      // fattura, marca il movimento riconciliato e logga in reconciliation_log.
      const { data, error } = await supabase.rpc('reconcile_movement' as never, {
        p_bt_id: String(movement.id),
        p_payable_id: String(payable.id),
      } as never)
      if (error) throw error
      const res = data as { ok?: boolean } | null
      if (!res?.ok) throw new Error('Riconciliazione non applicata')

      setSelectedMovement(null)
      onRefresh()
    } catch (err: unknown) {
      console.error('Reconcile error:', err)
      toast({ type: 'error', message: `Errore riconciliazione: ${(err as Error).message}` })
    } finally {
      setReconciling(false)
    }
  }

  const handleManualReconcile = async () => {
    if (!selectedMovement || !manualPayableId) return
    const payable = unpaidPayables.find((p) => p.id === manualPayableId)
    if (!payable) { toast({ type: 'warning', message: 'Fattura non trovata' }); return }
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

  // Carica le righe di log (suggerimenti + applicate per l'annullo). Si ricarica a
  // ogni refresh del parent (transactions cambia) per restare coerente.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // NB: i tipi generati di reconciliation_log sono obsoleti (manca bank_transaction_id/
      // status/applied_amount); cast a any per usare lo schema reale (migration 032/063/064).
      const { data } = await (supabase.from('reconciliation_log') as any)
        .select('id, bank_transaction_id, payable_id, confidence, status, applied_amount')
        .eq('company_id', companyId)
        .in('status', ['to_confirm', 'applied'])
        .order('confidence', { ascending: false })
      if (!cancelled) setLogRows((data || []) as LogRow[])
    })()
    return () => { cancelled = true }
  }, [companyId, transactions])

  const txById = useMemo(() => {
    const m = new Map<string, TxT>()
    for (const t of transactions) m.set(String(t.id), t)
    return m
  }, [transactions])
  const payById = useMemo(() => {
    const m = new Map<string, PayT>()
    for (const p of payables) m.set(String(p.id), p)
    return m
  }, [payables])

  const OPEN_STATUSES = ['da_pagare', 'in_scadenza', 'scaduto', 'parziale']
  // Un suggerimento si mostra solo se: importo del movimento coincide col residuo
  // della fattura (entro il 5%) E affidabilità >= 70%. Così spariscono gli
  // abbinamenti assurdi (importo lontano, proposti solo per nome/data).
  const SUGGEST_MIN_CONFIDENCE = 70
  const SUGGEST_AMOUNT_TOLERANCE = 0.05

  // Suggerimenti validi: log 'to_confirm' la cui fattura è ancora aperta e il
  // cui movimento non è ancora riconciliato. Gli stantii/deboli vengono nascosti.
  const suggestions = useMemo<SugRow[]>(() => {
    const out: SugRow[] = []
    for (const log of logRows) {
      if (log.status !== 'to_confirm') continue
      if (!log.bank_transaction_id || !log.payable_id) continue
      const bt = txById.get(log.bank_transaction_id)
      const payable = payById.get(log.payable_id)
      if (!bt || bt.is_reconciled) continue
      if (!payable || !OPEN_STATUSES.includes(String(payable.status))) continue
      const rem = payable.amount_remaining != null ? Number(payable.amount_remaining) : Number(payable.gross_amount || 0) - Number(payable.amount_paid || 0)
      if (rem <= 0) continue
      const conf = Number(log.confidence) || 0
      if (conf < SUGGEST_MIN_CONFIDENCE) continue
      // importo del movimento deve coincidere col residuo (entro tolleranza)
      const mov = Math.abs(Number(bt.amount) || 0)
      if (Math.abs(mov - rem) / rem > SUGGEST_AMOUNT_TOLERANCE) continue
      out.push({ log, bt, payable, confidence: conf })
    }
    return out.sort((a, b) => b.confidence - a.confidence)
  }, [logRows, txById, payById])

  // Mappa bt riconciliato -> riga di log 'applied' con applied_amount (per l'annullo)
  const appliedLogByBt = useMemo(() => {
    const m = new Map<string, LogRow>()
    for (const log of logRows) {
      if (log.status === 'applied' && log.applied_amount != null && log.bank_transaction_id) {
        if (!m.has(log.bank_transaction_id)) m.set(log.bank_transaction_id, log)
      }
    }
    return m
  }, [logRows])

  // Vista "Riconciliati": movimenti in uscita riconciliati, con fattura linkata
  const reconciledMovements = useMemo(() => {
    let items = transactions.filter((t) => t.is_reconciled && (Number(t.amount) || 0) < 0)
    if (filterAccount !== 'all') items = items.filter((t) => t.bank_account_id === filterAccount)
    if (search) {
      const q = search.toLowerCase()
      items = items.filter((t) => String(t.description || '').toLowerCase().includes(q) || String(t.counterpart_name || '').toLowerCase().includes(q))
    }
    return items
      .map((t) => ({
        bt: t as TxT,
        payable: t.reconciled_invoice_id ? payById.get(String(t.reconciled_invoice_id)) || null : null,
        appliedLog: appliedLogByBt.get(String(t.id)) || null,
      }))
      .sort((a, b) => new Date(String(b.bt.reconciled_at || b.bt.transaction_date) || 0).getTime() - new Date(String(a.bt.reconciled_at || a.bt.transaction_date) || 0).getTime())
  }, [transactions, filterAccount, search, payById, appliedLogByBt])

  // Conferma una singola riga (o usata nel batch). Ritorna 'ok' | 'stale' | 'error'.
  const confirmSuggestion = async (s: SugRow): Promise<'ok' | 'stale' | 'error'> => {
    try {
      const { data, error } = await supabase.rpc('reconcile_movement' as never, {
        p_bt_id: String(s.bt.id),
        p_payable_id: String(s.payable.id),
        p_log_id: String(s.log.id),
      } as never)
      if (error) throw error
      const res = data as { ok?: boolean; reason?: string } | null
      if (res?.ok) return 'ok'
      if (res?.reason === 'stale') return 'stale'
      return 'error'
    } catch (err) {
      console.error('confirmSuggestion error:', err)
      return 'error'
    }
  }

  const handleConfirmOne = async (s: SugRow) => {
    setProcessingSug(true)
    const r = await confirmSuggestion(s)
    setProcessingSug(false)
    if (r === 'ok') toast({ type: 'success', message: `Abbinamento confermato: ${getSupplierName(s.payable)} • ${fmt(Math.abs(Number(s.bt.amount) || 0))} €` })
    else if (r === 'stale') toast({ type: 'info', message: 'Suggerimento non più valido: rimosso dalla lista.' })
    else toast({ type: 'error', message: 'Errore nella conferma dell’abbinamento.' })
    setSelectedSug(new Set())
    onRefresh()
  }

  const handleRejectOne = async (s: SugRow) => {
    setProcessingSug(true)
    const { error } = await supabase.from('reconciliation_log')
      .update({ status: 'rejected', notes: 'rifiutato manualmente' } as never)
      .eq('id', s.log.id).eq('company_id', companyId)
    setProcessingSug(false)
    if (error) { toast({ type: 'error', message: 'Errore nel rifiuto: ' + error.message }); return }
    toast({ type: 'info', message: 'Suggerimento rifiutato. Il movimento resta abbinabile a mano.' })
    setSelectedSug(prev => { const n = new Set(prev); n.delete(s.log.id); return n })
    onRefresh()
  }

  const runBatchConfirm = async (rows: SugRow[]) => {
    setSummaryModal(null)
    setProcessingSug(true)
    let okN = 0, staleN = 0, errN = 0
    for (const s of rows) {
      const r = await confirmSuggestion(s)
      if (r === 'ok') okN++
      else if (r === 'stale') staleN++
      else errN++
    }
    setProcessingSug(false)
    setSelectedSug(new Set())
    const parts = [`Confermati ${okN}`]
    if (staleN > 0) parts.push(`saltati ${staleN} perché nel frattempo non più validi`)
    if (errN > 0) parts.push(`${errN} in errore`)
    toast({ type: errN > 0 ? 'error' : 'success', message: parts.join(', ') })
    onRefresh()
  }

  const handleUndo = async () => {
    if (!undoModal) return
    const logId = undoModal.logId
    setUndoModal(null)
    setProcessingSug(true)
    const { data, error } = await supabase.rpc('undo_reconcile_movement' as never, { p_log_id: logId } as never)
    setProcessingSug(false)
    if (error) { toast({ type: 'error', message: 'Errore annullo: ' + error.message }); return }
    const res = data as { ok?: boolean; reason?: string } | null
    if (!res?.ok) { toast({ type: 'warning', message: 'Abbinamento non annullabile (non più valido).' }); onRefresh(); return }
    toast({ type: 'success', message: 'Abbinamento annullato: la fattura è tornata aperta.' })
    onRefresh()
  }

  const toggleSug = (logId: string) => setSelectedSug(prev => {
    const n = new Set(prev); n.has(logId) ? n.delete(logId) : n.add(logId); return n
  })
  const selectedSugRows = useMemo(() => suggestions.filter(s => selectedSug.has(s.log.id)), [suggestions, selectedSug])

  const confidenceColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-100 text-emerald-700'
    if (score >= 50) return 'bg-amber-100 text-amber-700'
    return 'bg-red-100 text-red-700'
  }

  return (
    <div className="space-y-6">
      {/* Riepilogo del giorno (controllo operativo) */}
      <RiepilogoGiornaliero companyId={companyId} accounts={accounts} />

      {/* Toggle vista: Da riconciliare / Riconciliati */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
        <button onClick={() => setViewMode('da_riconciliare')}
          className={classNames('px-4 py-1.5 rounded-md text-sm font-medium transition', viewMode === 'da_riconciliare' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
          Da riconciliare
        </button>
        <button onClick={() => setViewMode('riconciliati')}
          className={classNames('px-4 py-1.5 rounded-md text-sm font-medium transition', viewMode === 'riconciliati' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
          Riconciliati
        </button>
      </div>

      {viewMode === 'riconciliati' ? (
        /* ═══ VISTA RICONCILIATI ═══ */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Movimenti riconciliati ({reconciledMovements.length})</h3>
            <div className="flex gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Cerca..."
                  className="w-44 pl-8 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <select value={filterAccount} onChange={e => setFilterAccount(e.target.value)}
                className="px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">Tutti i conti</option>
                {accounts.filter(a => a.is_active !== false).map(a => (
                  <option key={a.id} value={a.id}>{a.account_name || a.bank_name}</option>
                ))}
              </select>
            </div>
          </div>
          {reconciledMovements.length === 0 ? (
            <EmptyState icon={Link2} title="Nessun movimento riconciliato" description="I movimenti abbinati a una fattura compariranno qui." />
          ) : (
            <div className="divide-y divide-slate-50 max-h-[640px] overflow-y-auto">
              {reconciledMovements.map(({ bt, payable, appliedLog }) => {
                const acct = accounts.find(a => a.id === bt.bank_account_id)
                return (
                  <div key={bt.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="p-1.5 rounded-lg bg-emerald-50"><CheckCircle2 size={14} className="text-emerald-600" /></div>
                    <div className="flex-1 min-w-0">
                      <CellTooltip content={String(bt.description || 'Movimento')}><div className="text-sm font-medium text-slate-900 truncate">{bt.description || 'Movimento'}</div></CellTooltip>
                      <div className="text-xs text-slate-400 truncate">
                        {fmtDate(bt.transaction_date)} {acct ? `• ${acct.account_name || acct.bank_name}` : ''}
                        {payable ? <> {'•'} <CellTooltip content={getSupplierName(payable)}><span className="cursor-help">{getSupplierName(payable)}</span></CellTooltip> {payable.invoice_number ? `(${payable.invoice_number})` : ''}</> : ' • fattura non collegata'}
                        {bt.reconciled_at ? ` • ric. ${fmtDate(bt.reconciled_at)}` : ''}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-red-600 whitespace-nowrap">{fmt(bt.amount)} &euro;</div>
                    {appliedLog ? (
                      <button onClick={() => setUndoModal({ logId: appliedLog.id, label: payable ? getSupplierName(payable) : 'fattura', amount: Number(appliedLog.applied_amount) || 0 })}
                        disabled={processingSug}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-200 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-50 transition disabled:opacity-50">
                        <Unlink size={12} /> Annulla abbinamento
                      </button>
                    ) : (
                      <CellTooltip content="Abbinamento senza log — non annullabile da qui">
                        <span className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-100 text-slate-300 rounded-lg text-xs font-medium cursor-not-allowed">
                          <Unlink size={12} /> Annulla abbinamento
                        </span>
                      </CellTooltip>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
      <>
      {/* ═══ SEZIONE ABBINAMENTI SUGGERITI ═══ */}
      {suggestions.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-100 flex items-center justify-between gap-3">
            <button onClick={() => setSuggCollapsed(c => !c)} className="flex items-center gap-2 text-sm font-semibold text-amber-800">
              {suggCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              Abbinamenti suggeriti ({suggestions.length})
            </button>
            {!suggCollapsed && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSummaryModal({ rows: selectedSugRows })}
                  disabled={processingSug || selectedSugRows.length === 0}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-blue-200 text-blue-700 hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed">
                  Conferma selezionati ({selectedSugRows.length})
                </button>
                <button
                  onClick={() => setSummaryModal({ rows: suggestions })}
                  disabled={processingSug}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50">
                  Conferma tutti ({suggestions.length})
                </button>
              </div>
            )}
          </div>
          {!suggCollapsed && (
            <div className="divide-y divide-slate-50 max-h-[420px] overflow-y-auto">
              {suggestions.map((s) => {
                const acct = accounts.find(a => a.id === s.bt.bank_account_id)
                const rem = s.payable.amount_remaining != null ? Number(s.payable.amount_remaining) : Number(s.payable.gross_amount || 0) - Number(s.payable.amount_paid || 0)
                return (
                  <div key={s.log.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60">
                    <input type="checkbox" checked={selectedSug.has(s.log.id)} onChange={() => toggleSug(s.log.id)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                    {/* Movimento */}
                    <div className="flex-1 min-w-0">
                      <CellTooltip content={String(s.bt.description || 'Movimento')}><div className="text-sm font-medium text-slate-900 truncate">{s.bt.description || 'Movimento'}</div></CellTooltip>
                      <div className="text-xs text-slate-400 truncate">
                        {fmtDate(s.bt.transaction_date)} {acct ? `• ${acct.account_name || acct.bank_name}` : ''}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-red-600 whitespace-nowrap">{fmt(s.bt.amount)} &euro;</div>
                    <ArrowRight size={16} className="text-slate-300 flex-shrink-0" />
                    {/* Fattura proposta */}
                    <div className="flex-1 min-w-0">
                      <CellTooltip content={getSupplierName(s.payable)}><div className="text-sm font-medium text-slate-800 truncate">{getSupplierName(s.payable)}</div></CellTooltip>
                      <div className="text-xs text-slate-400 truncate">
                        Fatt. {s.payable.invoice_number || '—'} {'•'} residuo {fmt(rem)} €
                      </div>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${confidenceColor(s.confidence)}`}>{Math.round(s.confidence)}%</span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => handleConfirmOne(s)} disabled={processingSug}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition disabled:opacity-50">
                        <Check size={12} /> Conferma
                      </button>
                      <button onClick={() => handleRejectOne(s)} disabled={processingSug}
                        className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 transition disabled:opacity-50">
                        <X size={12} /> Rifiuta
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

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
                      <CellTooltip content={String(m.description || 'Movimento')}><div className="text-sm font-medium text-slate-900 truncate">{m.description || 'Movimento'}</div></CellTooltip>
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
                          <CellTooltip content={getSupplierName(p)}><div className="text-sm font-medium text-slate-900 truncate">{getSupplierName(p)}</div></CellTooltip>
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
      </div>{/* chiude grid 2 colonne */}
      </>
      )}

      {/* Modal riepilogo conferma (selezionati / tutti) */}
      {summaryModal && (() => {
        const rows = summaryModal.rows
        const total = rows.reduce((s, r) => s + Math.abs(Number(r.bt.amount) || 0), 0)
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setSummaryModal(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <h3 className="text-lg font-semibold text-slate-900">Conferma abbinamenti</h3>
                <button onClick={() => setSummaryModal(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={20} /></button>
              </div>
              <div className="p-5 space-y-3 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Abbinamenti</span><span className="font-bold">{rows.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Totale</span><span className="font-bold">{fmt(total)} €</span>
                </div>
                <div className="border border-slate-100 rounded-lg divide-y divide-slate-50 overflow-y-auto max-h-[40vh]">
                  {rows.map(r => (
                    <div key={r.log.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                      <CellTooltip content={getSupplierName(r.payable)}><span className="truncate max-w-[200px] text-slate-700">{getSupplierName(r.payable)} <span className="text-slate-400">· {r.payable.invoice_number || '—'}</span></span></CellTooltip>
                      <span className="font-semibold text-red-600 whitespace-nowrap">{fmt(r.bt.amount)} €</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setSummaryModal(null)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
                  <button onClick={() => runBatchConfirm(rows)} disabled={processingSug || rows.length === 0}
                    className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                    {processingSug ? 'Conferma in corso...' : `Conferma ${rows.length}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal conferma annullo abbinamento */}
      {undoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setUndoModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <h3 className="text-lg font-semibold text-slate-900">Annullare l'abbinamento?</h3>
              <button onClick={() => setUndoModal(null)} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-700">La fattura <strong>{undoModal.label}</strong> tornerà aperta per <strong>{fmt(undoModal.amount)} €</strong> e il movimento tornerà fra quelli da riconciliare.</p>
              <div className="flex gap-3">
                <button onClick={() => setUndoModal(null)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
                <button onClick={handleUndo} disabled={processingSug}
                  className="flex-1 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50">
                  {processingSug ? 'Annullamento...' : 'Annulla abbinamento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// ═══ MAIN COMPONENT ═══
// ═══════════════════════════════════════════════════════════════════

export default function TesoreriaManuale() {
  const { session, profile } = useAuth()
  const { toast } = useToast()
  // Anno selezionato dal Period Selector globale (Layout): guida il tab Movimenti.
  // I KPI "live" (posizione di cassa, entrate/uscite 30gg) NON dipendono dall'anno.
  const { year } = usePeriod()
  // Multi-tenant: mai fallback su un company_id hardcoded (contaminazione cross-tenant).
  // profile.company_id (da user_profiles) è più affidabile di app_metadata post-onboarding.
  const companyId = profile?.company_id || session?.user?.app_metadata?.company_id || ''

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
  const [suggestCount, setSuggestCount] = useState(0)

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  // Assegna/azzera la categoria contabile reale su bank_transactions, scoped a
  // company_id (RLS). Update ottimistico + rollback su errore + toast custom.
  const handleAssignCategory = useCallback(async (t: TransactionT, category: string) => {
    if (!companyId) return
    const newCat = category || null
    const prevCat = (t.category ?? null) as string | null
    if (newCat === prevCat) return
    setTransactions(prev => prev.map(x => x.id === t.id ? { ...x, category: newCat } : x))
    const { error } = await supabase
      .from('bank_transactions')
      .update({ category: newCat } as never)
      .eq('id', t.id)
      .eq('company_id', companyId)
    if (error) {
      setTransactions(prev => prev.map(x => x.id === t.id ? { ...x, category: prevCat } : x))
      toast({ type: 'error', message: 'Impossibile salvare la categoria: ' + (error.message || 'errore') })
      return
    }
    toast({
      type: 'success',
      message: newCat ? `Categoria assegnata: ${bankCategoryLabel(newCat)}` : 'Categoria rimossa dal movimento',
    })
  }, [companyId, toast])

  // Fetch all data
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [acctRes, txRes, payRes, batchRes, itemsRes, sugRes] = await Promise.all([
          supabase.from('bank_accounts').select('*').eq('company_id', companyId).order('bank_name'),
          supabase.from('bank_transactions').select('*').eq('company_id', companyId).order('transaction_date', { ascending: false }).limit(10000),
          supabase.from('payables').select('*, suppliers(id, name, ragione_sociale, iban)').eq('company_id', companyId).order('due_date'),
          supabase.from('payment_batches').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
          supabase.from('payment_batch_items').select('*').eq('company_id', companyId).order('priority'),
          (supabase.from('reconciliation_log') as any).select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'to_confirm').gte('confidence', 70),
        ])

        if (!cancelled) {
          setAccounts(acctRes.data || [])
          setTransactions(txRes.data || [])
          setPayables(payRes.data || [])
          setBatches(batchRes.data || [])
          setBatchItems(itemsRes.data || [])
          setSuggestCount(sugRes.count || 0)
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
        <div className="flex items-center gap-2">
          <SyncStatusBadge feed="banche" />
        </div>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-1 -mb-px overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            // Badge counts
            let badge = null
            let suggBadge = null
            if (tab.key === 'riconciliazione') {
              // Un solo badge, quello azionabile: se ci sono abbinamenti già suggeriti
              // dal sistema mostra quelli (da confermare); altrimenti il backlog di
              // uscite da abbinare a mano, escluse commissioni & movimenti non-fornitore.
              if (suggestCount > 0) {
                suggBadge = suggestCount
              } else {
                const unrecCount = transactions.filter(t => !t.is_reconciled && (Number(t.amount) || 0) < 0 && isReconcilableTx(t)).length
                if (unrecCount > 0) badge = unrecCount
              }
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
                {suggBadge != null && (
                  <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold min-w-[20px] text-center" title={`${suggBadge} abbinamenti suggeriti da confermare`}>
                    {suggBadge > 99 ? '99+' : suggBadge}
                  </span>
                )}
                {badge != null && (
                  <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-semibold min-w-[20px] text-center" title={`${badge} movimenti da riconciliare`}>
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
        <TabMovimenti
          transactions={transactions}
          accounts={accounts}
          onAssignCategory={handleAssignCategory}
          initialCategoryFilter={searchParams.get('filter') === 'senza-categoria' ? 'senza_categoria' : undefined}
          year={year}
        />
      )}
      {activeTab === 'riconciliazione' && (
        <TabRiconciliazione transactions={transactions} payables={payables} accounts={accounts} companyId={companyId} onRefresh={refresh} />
      )}
      {activeTab === 'prima_nota' && (
        <PrimaNota />
      )}
      {activeTab === 'finanziamenti' && (
        <FinanziamentiTab accounts={accounts} companyId={companyId} uploadedByName={[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || null} />
      )}
    </div>
  )
}
