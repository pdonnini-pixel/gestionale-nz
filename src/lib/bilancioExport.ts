/**
 * bilancioExport — pipeline dati per l'export del Bilancio previsionale
 * (Budget & Controllo → vista "Preventivo vs Consuntivo").
 *
 * Riproduce ESATTAMENTE i numeri della vista gerarchica a monitor, con le
 * stesse fonti dati documentate e verificate su DB (NZ 2026, annuale):
 *
 *   COSTI  — Preventivo = Σ budget_entries.budget_amount  (righe NON-ricavo,
 *            escluse is_placeholder=true e cost_center='rettifica_bilancio')
 *          — Consuntivo = Σ budget_entries.actual_amount  (stesse righe)
 *   RICAVI — Preventivo = Σ budget_confronto.amount  entry_type='rev_monthly'
 *          — Consuntivo = Σ budget_confronto.amount  entry_type='cons_monthly'
 *
 * Classificazione e label (macro + sottoconti) vengono SEMPRE da
 * chart_of_accounts (code, name, is_revenue, sort_order): niente conti,
 * importi o nomi hardcoded. Il "Totale azienda" somma i 7 outlet + la Sede,
 * così da quadrare col TOTALE COMPLESSIVO di Budget & Controllo, col Business
 * Plan e col Conto Economico.
 *
 * Il filtro di periodo somma solo i mesi nel range [fromMonth, toMonth] sia per
 * budget_entries sia per i mensili di budget_confronto.
 */

// ─── INPUT ───────────────────────────────────────────────────────────────

/** Riga budget_entries (subset usato qui). */
export type BudgetEntryLite = {
  cost_center?: string | null
  account_code?: string | null
  budget_amount?: number | null
  actual_amount?: number | null
  month?: number | null
  is_placeholder?: boolean | null
}

/**
 * Mappa dei mensili ricostruita in BudgetControl da budget_confronto:
 *   cost_center → account_code → array di 12 valori (mese 1..12 → index 0..11).
 * Una per entry_type: rev_monthly (preventivo ricavi) e cons_monthly (consuntivo).
 */
export type MonthlyMap = Record<string, Record<string, number[]>>

/** Riga del piano dei conti (ceRawCosti / ceRawRicavi). Già ordinata per sort_order. */
export type CoaNode = {
  code: string
  description?: string
  level?: number
}

export type CenterRef = { code: string; label: string }

// ─── OUTPUT ──────────────────────────────────────────────────────────────

export type ExportRow = {
  code: string
  /** Etichetta "Voce": macro = "61 Costi della produzione"; sottoconto = "610101 …". */
  label: string
  /** Profondità nella gerarchia: 0 = macro, 1+ = sottoconti. */
  depth: number
  isMacro: boolean
  prev: number
  cons: number
  /** Rettifica: sempre null in vista gestionale (resa come "—"). */
  rett: number | null
}

export type ExportSection = {
  title: string
  rows: ExportRow[]
  totalLabel: string
  totalPrev: number
  totalCons: number
}

export type CenterSheet = {
  /** Slug stabile per nome foglio/file. */
  key: string
  /** Nome leggibile (Totale azienda / nome outlet / Sede). */
  title: string
  costi: ExportSection
  ricavi: ExportSection
}

// ─── TREE (prefix-based, identico a BudgetControl.buildTree) ───────────────
// Ogni nodo viene agganciato al nodo esistente il cui codice è il prefisso più
// lungo (non per adiacenza di livello): 6305 contiene SOLO i codici 6305xx.

type Node = { code: string; description: string; children: Node[]; prev: number; cons: number }

const norm = (c: string | null | undefined) => (c || '').replace(/\s/g, '')

/** Annida i nodi per prefisso di codice (6305 contiene SOLO i codici 6305xx). */
function nestByPrefix<T extends { code: string; children: T[] }>(nodes: T[]): T[] {
  const byCode = new Map<string, T>()
  nodes.forEach((n) => {
    const k = norm(n.code)
    if (k && !byCode.has(k)) byCode.set(k, n)
  })
  const tree: T[] = []
  for (const node of nodes) {
    const nc = norm(node.code)
    let parent: T | null = null
    for (let l = nc.length - 1; l >= 1; l--) {
      const cand = byCode.get(nc.slice(0, l))
      if (cand && cand !== node) {
        parent = cand
        break
      }
    }
    if (parent) parent.children.push(node)
    else tree.push(node)
  }
  return tree
}

function buildTree(rows: CoaNode[]): Node[] {
  return nestByPrefix(rows.map((r) => ({
    code: r.code,
    description: r.description || '',
    children: [] as Node[],
    prev: 0,
    cons: 0,
  })))
}

/** Riempie le foglie dai valori per-conto e somma ricorsivamente i nodi padre. */
function fill(node: Node, prevMap: Record<string, number>, consMap: Record<string, number>): void {
  if (node.children.length > 0) {
    let p = 0
    let c = 0
    for (const ch of node.children) {
      fill(ch, prevMap, consMap)
      p += ch.prev
      c += ch.cons
    }
    node.prev = p
    node.cons = c
  } else {
    node.prev = prevMap[node.code] || 0
    node.cons = consMap[node.code] || 0
  }
}

function flatten(nodes: Node[], depth: number, out: ExportRow[]): void {
  for (const n of nodes) {
    out.push({
      code: n.code,
      label: n.description ? `${n.code} ${n.description}` : n.code,
      depth,
      isMacro: depth === 0,
      prev: n.prev,
      cons: n.cons,
      rett: null,
    })
    if (n.children.length > 0) flatten(n.children, depth + 1, out)
  }
}

function buildSection(
  coaRows: CoaNode[],
  prevMap: Record<string, number>,
  consMap: Record<string, number>,
  title: string,
  totalLabel: string,
): ExportSection {
  const tree = buildTree(coaRows)
  tree.forEach((n) => fill(n, prevMap, consMap))
  const rows: ExportRow[] = []
  flatten(tree, 0, rows)
  const totalPrev = tree.reduce((s, n) => s + n.prev, 0)
  const totalCons = tree.reduce((s, n) => s + n.cons, 0)
  return { title, rows, totalLabel, totalPrev, totalCons }
}

// ─── AGGREGAZIONE PER-CENTRO / PERIODO ─────────────────────────────────────

/** COSTI: Σ budget_amount (prev) e Σ actual_amount (cons) per account_code. */
function costLeafAmounts(
  entries: BudgetEntryLite[],
  centers: Set<string>,
  from: number,
  to: number,
): { prev: Record<string, number>; cons: Record<string, number> } {
  const prev: Record<string, number> = {}
  const cons: Record<string, number> = {}
  for (const e of entries) {
    if (e.is_placeholder === true) continue
    const cc = e.cost_center || ''
    if (cc === 'rettifica_bilancio') continue
    if (!centers.has(cc)) continue
    const m = Number(e.month || 0)
    if (m < from || m > to) continue
    const code = e.account_code
    if (!code) continue
    prev[code] = (prev[code] || 0) + (Number(e.budget_amount) || 0)
    cons[code] = (cons[code] || 0) + (Number(e.actual_amount) || 0)
  }
  return { prev, cons }
}

/** RICAVI: somma dei mensili rev_monthly (prev) e cons_monthly (cons) nel range. */
function revLeafAmounts(
  revMonthly: MonthlyMap,
  consMonthly: MonthlyMap,
  centers: Set<string>,
  from: number,
  to: number,
): { prev: Record<string, number>; cons: Record<string, number> } {
  const accumulate = (dst: Record<string, number>, map: MonthlyMap) => {
    for (const cc of Object.keys(map)) {
      if (!centers.has(cc)) continue
      const byCode = map[cc] || {}
      for (const code of Object.keys(byCode)) {
        const arr = byCode[code] || []
        let s = 0
        for (let mi = from - 1; mi <= to - 1; mi++) {
          const v = arr[mi]
          if (typeof v === 'number') s += v
        }
        dst[code] = (dst[code] || 0) + s
      }
    }
  }
  const prev: Record<string, number> = {}
  const cons: Record<string, number> = {}
  accumulate(prev, revMonthly)
  accumulate(cons, consMonthly)
  return { prev, cons }
}

export type BuildSheetInput = {
  key: string
  title: string
  /** Cost center inclusi (1 per outlet; tutti per "Totale azienda"). */
  centers: string[]
  fromMonth: number
  toMonth: number
  budgetEntries: BudgetEntryLite[]
  revMonthly: MonthlyMap
  consMonthly: MonthlyMap
  coaCosti: CoaNode[]
  coaRicavi: CoaNode[]
}

const COSTI_TITLE = 'COMPONENTI NEGATIVE (COSTI)'
const RICAVI_TITLE = 'COMPONENTI POSITIVE (RICAVI)'

/** Costruisce le due sezioni gerarchiche per un insieme di centri + periodo. */
export function buildCenterSheet(input: BuildSheetInput): CenterSheet {
  const centerSet = new Set(input.centers)
  const costAmts = costLeafAmounts(input.budgetEntries, centerSet, input.fromMonth, input.toMonth)
  const revAmts = revLeafAmounts(input.revMonthly, input.consMonthly, centerSet, input.fromMonth, input.toMonth)
  return {
    key: input.key,
    title: input.title,
    costi: buildSection(input.coaCosti, costAmts.prev, costAmts.cons, COSTI_TITLE, 'TOTALE COSTI'),
    ricavi: buildSection(input.coaRicavi, revAmts.prev, revAmts.cons, RICAVI_TITLE, 'TOTALE RICAVI'),
  }
}

export type BuildAllInput = {
  /** '__all__' = Totale azienda + tutti i centri; altrimenti il singolo cost_center. */
  selection: string
  operativeOutlets: CenterRef[]
  hq: CenterRef | null
  fromMonth: number
  toMonth: number
  budgetEntries: BudgetEntryLite[]
  revMonthly: MonthlyMap
  consMonthly: MonthlyMap
  coaCosti: CoaNode[]
  coaRicavi: CoaNode[]
}

type PlanItem = { key: string; title: string; centers: string[] }

/**
 * Ordine schede: Totale azienda (tutti i centri) → ogni outlet operativo →
 * Sede/Magazzino. Con un singolo centro selezionato, solo quella scheda.
 */
function sheetPlan(input: BuildAllInput): PlanItem[] {
  const allCenters = [
    ...input.operativeOutlets.map((o) => o.code),
    ...(input.hq ? [input.hq.code] : []),
  ]
  if (input.selection !== '__all__') {
    const ref =
      input.operativeOutlets.find((o) => o.code === input.selection) ||
      (input.hq && input.hq.code === input.selection ? input.hq : null)
    return [{ key: input.selection, title: ref ? ref.label : input.selection, centers: [input.selection] }]
  }
  const plan: PlanItem[] = [{ key: 'totale_azienda', title: 'Totale azienda', centers: allCenters }]
  for (const o of input.operativeOutlets) plan.push({ key: o.code, title: o.label, centers: [o.code] })
  if (input.hq) plan.push({ key: input.hq.code, title: input.hq.label, centers: [input.hq.code] })
  return plan
}

/** Versione ANNUALE (1 colonna Preventivo, somma del periodo). */
export function buildSheets(input: BuildAllInput): CenterSheet[] {
  const base = {
    fromMonth: input.fromMonth,
    toMonth: input.toMonth,
    budgetEntries: input.budgetEntries,
    revMonthly: input.revMonthly,
    consMonthly: input.consMonthly,
    coaCosti: input.coaCosti,
    coaRicavi: input.coaRicavi,
  }
  return sheetPlan(input).map((it) => buildCenterSheet({ ...it, ...base }))
}

// ─── VERSIONE MENSILE (12 colonne Gen…Dic + Totale anno) ───────────────────

export type MonthlyRow = {
  code: string
  label: string
  depth: number
  isMacro: boolean
  /** 12 valori, indice 0 = Gennaio. */
  months: number[]
  total: number
}

export type MonthlySection = {
  title: string
  rows: MonthlyRow[]
  totalLabel: string
  totals: number[]
  total: number
}

export type MonthlyCenterSheet = {
  key: string
  title: string
  costi: MonthlySection
  ricavi: MonthlySection
}

type MNode = { code: string; description: string; children: MNode[]; months: number[] }

const zeros = (): number[] => Array(12).fill(0)
const sum12 = (a: number[]): number => a.reduce((s, v) => s + v, 0)

/** COSTI mensili: budget_amount per mese (no placeholder, no rettifica). */
function costMonthlyLeaves(entries: BudgetEntryLite[], centers: Set<string>): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const e of entries) {
    if (e.is_placeholder === true) continue
    const cc = e.cost_center || ''
    if (cc === 'rettifica_bilancio' || !centers.has(cc)) continue
    const m = Number(e.month || 0)
    if (m < 1 || m > 12) continue
    const code = e.account_code
    if (!code) continue
    ;(out[code] ||= zeros())[m - 1] += Number(e.budget_amount) || 0
  }
  return out
}

/** RICAVI mensili: rev_monthly per mese. */
function revMonthlyLeaves(revMonthly: MonthlyMap, centers: Set<string>): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const cc of Object.keys(revMonthly)) {
    if (!centers.has(cc)) continue
    const byCode = revMonthly[cc] || {}
    for (const code of Object.keys(byCode)) {
      const arr = byCode[code] || []
      const dst = (out[code] ||= zeros())
      for (let i = 0; i < 12; i++) {
        const v = arr[i]
        if (typeof v === 'number') dst[i] += v
      }
    }
  }
  return out
}

function buildMonthlySection(coaRows: CoaNode[], leaf: Record<string, number[]>, title: string, totalLabel: string): MonthlySection {
  const tree = nestByPrefix(coaRows.map((r) => ({
    code: r.code,
    description: r.description || '',
    children: [] as MNode[],
    months: zeros(),
  })))
  const fillM = (n: MNode): void => {
    if (n.children.length > 0) {
      const m = zeros()
      for (const ch of n.children) {
        fillM(ch)
        for (let i = 0; i < 12; i++) m[i] += ch.months[i]
      }
      n.months = m
    } else {
      n.months = (leaf[n.code] || zeros()).slice()
    }
  }
  tree.forEach(fillM)
  const rows: MonthlyRow[] = []
  const flat = (nodes: MNode[], depth: number): void => {
    for (const n of nodes) {
      rows.push({
        code: n.code,
        label: n.description ? `${n.code} ${n.description}` : n.code,
        depth,
        isMacro: depth === 0,
        months: n.months,
        total: sum12(n.months),
      })
      if (n.children.length > 0) flat(n.children, depth + 1)
    }
  }
  flat(tree, 0)
  const totals = zeros()
  tree.forEach((n) => { for (let i = 0; i < 12; i++) totals[i] += n.months[i] })
  return { title, rows, totalLabel, totals, total: sum12(totals) }
}

function buildMonthlyCenterSheet(item: PlanItem, input: BuildAllInput): MonthlyCenterSheet {
  const centerSet = new Set(item.centers)
  const costLeaf = costMonthlyLeaves(input.budgetEntries, centerSet)
  const revLeaf = revMonthlyLeaves(input.revMonthly, centerSet)
  return {
    key: item.key,
    title: item.title,
    costi: buildMonthlySection(input.coaCosti, costLeaf, COSTI_TITLE, 'TOTALE COSTI'),
    ricavi: buildMonthlySection(input.coaRicavi, revLeaf, RICAVI_TITLE, 'TOTALE RICAVI'),
  }
}

/** Versione MENSILE: 12 mesi (Gen…Dic) + Totale anno, sempre anno intero. */
export function buildMonthlySheets(input: BuildAllInput): MonthlyCenterSheet[] {
  return sheetPlan(input).map((it) => buildMonthlyCenterSheet(it, input))
}

// ─── FORMATTAZIONE ─────────────────────────────────────────────────────────

/**
 * Valuta euro it-IT: separatore migliaia + 2 decimali + simbolo € → "2.000,00 €".
 * Usa locale de-DE (TS-safe) con style:'currency' per grouping a 4 cifre corretto.
 * Negativo col segno meno (es. "-270.187,06 €").
 */
export function fmtEuroIt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  // Intl mette un non-breaking space (U+00A0) prima di €: lo normalizziamo a
  // spazio normale per un rendering prevedibile in PDF.
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n).replace(/ /g, ' ')
}

/** Scostamento = Consuntivo − Preventivo. */
export function scostamento(prev: number, cons: number): number {
  return cons - prev
}

/** % = Scostamento / |Preventivo| × 100. Null (→ "—") se Preventivo = 0. */
export function scostamentoPct(prev: number, cons: number): number | null {
  if (prev === 0) return null
  return ((cons - prev) / Math.abs(prev)) * 100
}

export function fmtPct(p: number | null): string {
  if (p == null) return '—'
  return `${new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(p)}%`
}

/** Number format Excel: valuta € nera positiva, rossa col meno (no verde). */
export const XLSX_EURO_FMT = '#,##0.00\\ "€";[Red]-#,##0.00\\ "€"'
export const XLSX_PCT_FMT = '#,##0.0"%";[Red]-#,##0.0"%"'

const MESI_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

/** Sigle mesi per le intestazioni colonna della versione mensile. */
export const MESI_ABBR = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic']

export function periodLabel(from: number, to: number, year: number): string {
  if (from === to) return `${MESI_IT[from - 1]} ${year}`
  if (from === 1 && to === 12) return `Anno ${year}`
  return `${MESI_IT[from - 1]} – ${MESI_IT[to - 1]} ${year}`
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
}

/** Nome foglio Excel valido: ≤31 char, senza caratteri proibiti. */
export function sheetName(s: string): string {
  return s.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Foglio'
}
