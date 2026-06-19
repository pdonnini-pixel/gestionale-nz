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

function buildTree(rows: CoaNode[]): Node[] {
  const nodes: Node[] = rows.map((r) => ({
    code: r.code,
    description: r.description || '',
    children: [],
    prev: 0,
    cons: 0,
  }))
  const byCode = new Map<string, Node>()
  nodes.forEach((n) => {
    const k = norm(n.code)
    if (k && !byCode.has(k)) byCode.set(k, n)
  })
  const tree: Node[] = []
  for (const node of nodes) {
    const nc = norm(node.code)
    let parent: Node | null = null
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

/**
 * Genera i fogli in ordine: Totale azienda (tutti i centri) → ogni outlet
 * operativo → Sede/Magazzino. Con un singolo outlet selezionato genera solo
 * quel foglio.
 */
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
  const allCenters = [
    ...input.operativeOutlets.map((o) => o.code),
    ...(input.hq ? [input.hq.code] : []),
  ]

  if (input.selection !== '__all__') {
    const ref =
      input.operativeOutlets.find((o) => o.code === input.selection) ||
      (input.hq && input.hq.code === input.selection ? input.hq : null)
    const title = ref ? ref.label : input.selection
    return [buildCenterSheet({ key: input.selection, title, centers: [input.selection], ...base })]
  }

  const sheets: CenterSheet[] = [
    buildCenterSheet({ key: 'totale_azienda', title: 'Totale azienda', centers: allCenters, ...base }),
  ]
  for (const o of input.operativeOutlets) {
    sheets.push(buildCenterSheet({ key: o.code, title: o.label, centers: [o.code], ...base }))
  }
  if (input.hq) {
    sheets.push(buildCenterSheet({ key: input.hq.code, title: input.hq.label, centers: [input.hq.code], ...base }))
  }
  return sheets
}

// ─── FORMATTAZIONE ─────────────────────────────────────────────────────────

/**
 * Euro it-IT, separatore migliaia + 2 decimali. Usa locale de-DE (TS-safe) per
 * il raggruppamento a 4 cifre → "2.000,00". Negativo col segno meno.
 */
export function fmtEuroIt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—'
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
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

/** Number format Excel: nero positivo, rosso col meno (no verde). */
export const XLSX_EURO_FMT = '#,##0.00;[Red]-#,##0.00'
export const XLSX_PCT_FMT = '#,##0.0"%";[Red]-#,##0.0"%"'

const MESI_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
]

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
