// Estratti conto delle carte: lettura riga per riga, quadratura con la banca
// e aggancio alle fatture pagate con carta. Logica pura, testata; i file
// arrivano dalla pagina (righe di testo di un PDF via extractPdfLines, o
// celle di un foglio Excel via SheetJS).
//
// Formati letti sui documenti veri di NZ (settembre 2026):
//   * CartaBCC / Numia (carte di credito 5582 **** **** 3145 e 5388): PDF
//     nativo, una riga per operazione «DATA ACQUISTO DATA REGISTR.
//     DESCRIZIONE IMPORTO», chiusa da «TOTALE OPERAZIONI x». Uno stesso PDF
//     puo' contenere piu' carte, ognuna introdotta da «Carta Numero:».
//   * Carta Montepaschi (MPS **** 6820): PDF nativo, blocco «DETTAGLIO DEI
//     SUOI MOVIMENTI» con «Data Descrizione Importo», chiuso da «TOTALE
//     SPESE x»; l'addebito sul conto e' annunciato da «QUESTO MESE LE
//     SARANNO ADDEBITATI Euro x» + «In data 15 giugno 2026».
//   * Prepagata Tasca (522675******0580): Excel esportato dal portale
//     (sezioni «Movimenti» e «Autorizzazioni», colonne NR CARTA, TITOLARE,
//     DATA REGISTR., DATA ACQUISTO, DESCRIZIONE, IMPORTO IN EURO, IMPORTO
//     IN VALUTA ORIGINALE, VALUTA, COMMISSIONI) oppure PDF «Lista Movimenti»
//     con importi a punto decimale, chiuso da «Totale Movimenti x».
//
// Convenzione sugli importi: come su un conto corrente. Spesa NEGATIVA,
// ricarica / storno / rimborso POSITIVA, commissione a parte (fee, negativa).
// Il totale dichiarato dal documento segue la stessa convenzione.

export type CardIssuer = 'numia' | 'mps' | 'tasca' | 'generico'

export type CardLine = {
  card_last4: string | null
  /** YYYY-MM-DD */
  purchase_date: string
  posting_date: string | null
  description: string
  amount: number
  fee: number
  currency: string
  original_amount: number | null
}

export type CardSection = { card_last4: string | null; holder: string | null; total_declared: number | null }

export type CardStatementParsed = {
  issuer: CardIssuer
  cards: CardSection[]
  lines: CardLine[]
  /** Totale dichiarato dal documento (somma delle sezioni), segno di conto; null se non stampato. */
  total_declared: number | null
  /** Somma di importi e commissioni delle righe lette. */
  total_computed: number
  /** Carte di credito: giorno in cui l'estratto viene addebitato sul conto, se il documento lo dice. */
  debit_date: string | null
  /** Mese dell'estratto: quello piu' frequente fra le date di registrazione. */
  period: { year: number; month: number } | null
  warnings: string[]
}

const r2 = (n: number): number => Math.round(n * 100) / 100

/** «1.263,72» → 1263.72; «-29,99» → -29.99. Null se non e' un importo italiano. */
export function parseItAmount(s: string | null | undefined): number | null {
  if (s == null) return null
  const t = String(s).trim().replace(/\s/g, '').replace(/€/g, '')
  if (!/^-?\d{1,3}(\.\d{3})*,\d{2}$|^-?\d+,\d{2}$/.test(t)) return null
  return Number(t.replace(/\./g, '').replace(',', '.'))
}

/** «-111.23» / «1,263.72» → numero (formato con punto decimale del portale Tasca). */
export function parseDotAmount(s: string | null | undefined): number | null {
  if (s == null) return null
  const t = String(s).trim().replace(/\s/g, '')
  if (!/^-?\d{1,3}(,\d{3})*\.\d{2}$|^-?\d+\.\d{2}$/.test(t)) return null
  return Number(t.replace(/,/g, ''))
}

/** «dd/mm/yyyy» o «dd/mm/yy» → «yyyy-mm-dd». */
export function toIsoDate(s: string | null | undefined): string | null {
  if (!s) return null
  const m = /^(\d{2})\/(\d{2})\/(\d{4}|\d{2})/.exec(String(s).trim())
  if (!m) return null
  const y = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${y}-${m[2]}-${m[1]}`
}

const MESI: Record<string, string> = { gennaio: '01', febbraio: '02', marzo: '03', aprile: '04', maggio: '05', giugno: '06', luglio: '07', agosto: '08', settembre: '09', ottobre: '10', novembre: '11', dicembre: '12' }

/** Riconosce il documento dal testo (non dal nome del file). */
export function detectIssuer(lines: string[]): CardIssuer {
  const text = lines.join('\n')
  if (/Carta Montepaschi|CARTA MONTEPASCHI/i.test(text)) return 'mps'
  if (/DATA ACQUISTO\s+DATA REGISTR\.|TOTALE OPERAZIONI|Numia|CartaBCC|cartabcc\.it/i.test(text)) return 'numia'
  if (/Lista Movimenti|Totale Movimenti|RICARICA DA HB|Prepaid Business/i.test(text)) return 'tasca'
  return 'generico'
}

function last4Of(s: string): string | null {
  const m = /(\d{4})\s*$/.exec(s.trim())
  return m ? m[1] : null
}

/** CartaBCC / Numia: righe «dd/mm/yyyy dd/mm/yyyy DESCRIZIONE importo». */
export function parseNumiaLines(lines: string[]): CardStatementParsed {
  const cards: CardSection[] = []
  const out: CardLine[] = []
  const warnings: string[] = []
  let cur: CardSection | null = null
  const ROW = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/
  for (const raw of lines) {
    const l = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /Carta Numero:\s*(.+)$/i.exec(l))) {
      cur = { card_last4: last4Of(m[1]), holder: null, total_declared: null }
      cards.push(cur)
      continue
    }
    if ((m = /Nominativo:\s*(.+)$/i.exec(l))) { if (cur) cur.holder = m[1].trim(); continue }
    if ((m = /TOTALE OPERAZIONI\s+(-?[\d.]+,\d{2})/i.exec(l))) {
      const v = parseItAmount(m[1])
      if (cur && v != null) cur.total_declared = r2(-v)
      continue
    }
    if ((m = ROW.exec(l))) {
      const v = parseItAmount(m[4])
      if (v == null) continue
      out.push({ card_last4: cur?.card_last4 ?? null, purchase_date: toIsoDate(m[1])!, posting_date: toIsoDate(m[2]), description: m[3].trim(), amount: r2(-v), fee: 0, currency: 'EUR', original_amount: null })
    }
  }
  if (cards.length === 0) warnings.push('numero di carta non trovato nel documento')
  return finish('numia', cards, out, null, warnings)
}

/** Carta Montepaschi: blocco «DETTAGLIO DEI SUOI MOVIMENTI» fino a «TOTALE SPESE». */
export function parseMpsLines(lines: string[]): CardStatementParsed {
  const cards: CardSection[] = []
  const out: CardLine[] = []
  const warnings: string[] = []
  let cur: CardSection | null = null
  let inDetail = false
  let debitDate: string | null = null
  const ROW = /^(\d{2}\/\d{2}\/\d{2,4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s+([A-Z]{3})(?:\s+[\d.,]+)?)?$/
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    let m: RegExpExecArray | null
    const withHolder = /^(.+?)\s+CARTA MONTEPASCHI NUMERO\s+(.+?)\s+(?:A SALDO|REVOLVING)/i.exec(l)
    if (withHolder || (m = /CARTA MONTEPASCHI NUMERO\s+(.+)$/i.exec(l))) {
      const holder = withHolder ? withHolder[1].trim() : null
      const num = withHolder ? withHolder[2] : m![1]
      cur = { card_last4: last4Of(num.replace(/\s+(A SALDO|SCADENZA).*$/i, '')), holder, total_declared: null }
      cards.push(cur)
      inDetail = false
      continue
    }
    if (/^DETTAGLIO DEI SUOI MOVIMENTI/i.test(l)) { inDetail = true; continue }
    if ((m = /^TOTALE SPESE\s+(-?[\d.]+,\d{2})/i.exec(l))) {
      const v = parseItAmount(m[1])
      if (cur && v != null) cur.total_declared = r2(-v)
      inDetail = false
      continue
    }
    if ((m = /^In data\s+(\d{1,2})\s+([a-zà]+)\s+(\d{4})/i.exec(l)) && !debitDate) {
      const mm = MESI[m[2].toLowerCase()]
      if (mm) debitDate = `${m[3]}-${mm}-${m[1].padStart(2, '0')}`
      continue
    }
    if (inDetail && (m = ROW.exec(l))) {
      if (/^Data\s+Descrizione/i.test(l)) continue
      const v = parseItAmount(m[3])
      if (v == null) continue
      const orig = m[4] ? parseItAmount(m[4]) : null
      out.push({ card_last4: cur?.card_last4 ?? null, purchase_date: toIsoDate(m[1])!, posting_date: null, description: m[2].trim(), amount: r2(-v), fee: 0, currency: m[5] ?? 'EUR', original_amount: orig })
    }
  }
  if (cards.length === 0) warnings.push('numero di carta non trovato nel documento')
  return finish('mps', cards, out, debitDate, warnings)
}

export type AoaCell = string | number | boolean | Date | null | undefined
type Cell = AoaCell
const cellStr = (c: Cell): string => (c == null ? '' : c instanceof Date ? `${String(c.getDate()).padStart(2, '0')}/${String(c.getMonth() + 1).padStart(2, '0')}/${c.getFullYear()}` : String(c).trim())
/** Importo da una cella: numero gia' numerico, «500,00», «-1,00», «-92.80». */
const cellAmount = (c: Cell): number | null => {
  if (c == null || c === '') return null
  if (typeof c === 'number') return r2(c)
  const s = String(c).trim()
  return parseItAmount(s) ?? parseDotAmount(s)
}
/** Data da una cella: testo «dd/mm/yyyy[ hh:mm:ss]», Date, o seriale Excel. */
const cellDate = (c: Cell): string | null => {
  if (c == null || c === '') return null
  if (c instanceof Date) return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
  if (typeof c === 'number') { const d = new Date(Math.round((c - 25569) * 86400 * 1000)); return d.toISOString().slice(0, 10) }
  return toIsoDate(String(c))
}

/** Prepagata Tasca, Excel del portale: sezione «Movimenti» (le «Autorizzazioni» sono pendenti, non contabilizzate). */
export function parseTascaAoa(rows: Cell[][]): CardStatementParsed {
  const out: CardLine[] = []
  const warnings: string[] = []
  const cardsMap = new Map<string, CardSection>()
  let header: Record<string, number> | null = null
  let section = 'Movimenti'
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim()
  for (const row of rows) {
    const cells = row.map(cellStr)
    const nonEmpty = cells.filter(Boolean)
    if (nonEmpty.length === 0) continue
    if (nonEmpty.length === 1 && !header) { section = nonEmpty[0]; continue }
    if (nonEmpty.length === 1 && /^(Movimenti|Autorizzazioni)$/i.test(nonEmpty[0])) { section = nonEmpty[0]; header = null; continue }
    const up = cells.map(norm)
    if (up.includes('DATA ACQUISTO') && up.some(c => c.startsWith('IMPORTO IN EURO'))) {
      header = {}
      up.forEach((c, i) => { if (c) header![c] = i })
      continue
    }
    if (!header || !/^Movimenti$/i.test(section)) continue
    const col = (name: string) => { const k = Object.keys(header!).find(h => h.startsWith(name)); return k == null ? undefined : row[header![k]] }
    const purchase = cellDate(col('DATA ACQUISTO'))
    const amount = cellAmount(col('IMPORTO IN EURO'))
    if (!purchase || amount == null) continue
    const last4 = last4Of(cellStr(col('NR CARTA')))
    const holder = cellStr(col('TITOLARE')) || null
    if (last4 && !cardsMap.has(last4)) cardsMap.set(last4, { card_last4: last4, holder, total_declared: null })
    out.push({
      card_last4: last4, purchase_date: purchase, posting_date: cellDate(col('DATA REGISTR')),
      description: cellStr(col('DESCRIZIONE')), amount: r2(amount), fee: r2(cellAmount(col('COMMISSIONI')) ?? 0),
      currency: cellStr(col('VALUTA ORIGINALE')) || 'EUR', original_amount: cellAmount(col('IMPORTO IN VALUTA')),
    })
  }
  if (!header && out.length === 0) warnings.push('intestazione «DATA ACQUISTO / IMPORTO IN EURO» non trovata nel foglio')
  return finish('tasca', [...cardsMap.values()], out, null, warnings)
}

/** Prepagata Tasca, PDF «Lista Movimenti»: importi a punto decimale, «Totale Movimenti x». */
export function parseTascaLines(lines: string[]): CardStatementParsed {
  const out: CardLine[] = []
  const warnings: string[] = []
  const cards: CardSection[] = []
  let total: number | null = null
  let inAuth = false
  const ROW = /^(\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2}:\d{2})?\s+(\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2}:\d{2})?\s+(.+?)\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})\s+([A-Z]{3})$/
  for (const raw of lines) {
    const l = raw.trim().replace(/\s+/g, ' ')
    let m: RegExpExecArray | null
    if (/Lista Autorizzazioni/i.test(l)) { inAuth = true; continue }
    if (/Lista Movimenti/i.test(l)) { inAuth = false; continue }
    if ((m = /Totale Movimenti\s+(-?\d+\.\d{2})/i.exec(l))) { total = parseDotAmount(m[1]); continue }
    const withHolder = /^([A-Z' ]+?)\s+(\d{6}\*+\d{4})\s+Prepaid/i.exec(l)
    if (withHolder || (m = /(\d{6}\*+\d{4})\s+(Prepaid|Business|MC|Mastercard)/i.exec(l))) {
      const num = withHolder ? withHolder[2] : m![1]
      const holder = withHolder ? withHolder[1].trim() : null
      const l4 = last4Of(num)
      if (l4 && !cards.some(c => c.card_last4 === l4)) cards.push({ card_last4: l4, holder, total_declared: null })
      continue
    }
    if (inAuth) continue
    if ((m = ROW.exec(l))) {
      const amount = parseDotAmount(m[4]); const orig = parseDotAmount(m[5]); const fee = parseDotAmount(m[6]) ?? 0
      if (amount == null) continue
      // Prima data = acquisto (con orario), seconda = registrazione
      out.push({ card_last4: cards[0]?.card_last4 ?? null, purchase_date: toIsoDate(m[1])!, posting_date: toIsoDate(m[2]), description: m[3].trim(), amount: r2(amount), fee: r2(fee), currency: m[7], original_amount: orig })
    }
  }
  if (cards.length > 0 && total != null) cards[0].total_declared = r2(total)
  if (out.length === 0) warnings.push('nessuna riga «data acquisto, data registrazione, descrizione, importo» riconosciuta: per la prepagata conviene l\'export Excel del portale')
  return finish('tasca', cards, out, null, warnings)
}

/** Ultima spiaggia: qualsiasi riga «data [data] descrizione importo» (formato italiano o a punto). */
export function parseGenericLines(lines: string[]): CardStatementParsed {
  const out: CardLine[] = []
  const ROW = /^(\d{2}\/\d{2}\/\d{2,4})(?:\s+(\d{2}\/\d{2}\/\d{2,4}))?\s+(.+?)\s+(-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2})$/
  for (const raw of lines) {
    const m = ROW.exec(raw.trim())
    if (!m) continue
    const v = parseItAmount(m[4]) ?? parseDotAmount(m[4])
    if (v == null) continue
    out.push({ card_last4: null, purchase_date: toIsoDate(m[1])!, posting_date: toIsoDate(m[2]), description: m[3].trim(), amount: r2(v > 0 ? -v : v), fee: 0, currency: 'EUR', original_amount: null })
  }
  return finish('generico', [], out, null, out.length === 0 ? ['formato non riconosciuto: nessuna riga con data, descrizione e importo'] : ['formato non riconosciuto: righe lette con la regola generica, controlla i segni'])
}

/** Sceglie il lettore dal testo. */
export function parseCardStatementLines(lines: string[]): CardStatementParsed {
  const issuer = detectIssuer(lines)
  if (issuer === 'numia') return parseNumiaLines(lines)
  if (issuer === 'mps') return parseMpsLines(lines)
  if (issuer === 'tasca') return parseTascaLines(lines)
  return parseGenericLines(lines)
}

function finish(issuer: CardIssuer, cards: CardSection[], lines: CardLine[], debit_date: string | null, warnings: string[]): CardStatementParsed {
  const declared = cards.some(c => c.total_declared != null) ? r2(cards.reduce((s, c) => s + (c.total_declared ?? 0), 0)) : null
  const computed = r2(lines.reduce((s, l) => s + l.amount + l.fee, 0))
  if (declared != null && Math.abs(declared - computed) > 0.005) warnings.push(`il totale dichiarato dal documento (${declared.toFixed(2)}) non coincide con la somma delle righe lette (${computed.toFixed(2)})`)
  if (lines.length === 0) warnings.push('nessuna operazione letta')
  return { issuer, cards, lines, total_declared: declared, total_computed: computed, debit_date, period: periodOf(lines), warnings }
}

/** Mese piu' frequente fra le date di registrazione (o di acquisto). */
export function periodOf(lines: CardLine[]): { year: number; month: number } | null {
  const count = new Map<string, number>()
  for (const l of lines) {
    const d = l.posting_date ?? l.purchase_date
    const k = d.slice(0, 7)
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [k, n] of count) if (best == null || n > (count.get(best) ?? 0) || (n === count.get(best) && k > best)) best = k
  return best ? { year: Number(best.slice(0, 4)), month: Number(best.slice(5, 7)) } : null
}

export const ISSUER_LABELS: Record<CardIssuer, string> = { numia: 'Carta di credito CartaBCC (Numia)', mps: 'Carta Montepaschi', tasca: 'Carta prepagata Tasca', generico: 'Carta (formato generico)' }

/** Etichetta della fonte come in bank_statements.source_label, dal documento. */
export function sourceLabelOf(issuer: CardIssuer, last4: string | null): string {
  const tail = last4 ? ` *${last4}` : ''
  if (issuer === 'numia') return `Carta credito BCC${tail}`
  if (issuer === 'mps') return `Carta credito MPS${tail}`
  if (issuer === 'tasca') return `Carta prepagata Tasca${tail}`
  return `Carta${tail}`
}

// ── Quadratura con la banca ────────────────────────────────────────────

export type BankMovLite = { id: string; transaction_date: string; amount: number; description: string | null }

const daysBetween = (a: string, b: string): number => Math.abs((new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86400000)

/** Commissioni massime che la banca puo' aggiungere all'addebito dell'estratto (BCC: 3,29 al mese per due carte). */
export const MAX_COMMISSIONI_ADDEBITO = 10

/**
 * Carta di credito: l'addebito unico in banca che salda l'estratto (o gli
 * estratti dello stesso emittente e mese: la BCC addebita le due carte in un
 * movimento solo, piu' 3,29 di commissioni). Il totale passato e' la somma
 * degli estratti del gruppo, con il segno di conto (negativo). Si accetta un
 * addebito uguale al totale o maggiore fino a MAX_COMMISSIONI_ADDEBITO, entro
 * 75 giorni dall'inizio del mese dell'estratto; vince il piu' vicino per
 * importo, poi per data annunciata. `differenza` = addebito − totale, cioe'
 * le commissioni (0 se coincide).
 */
export function matchStatementDebit(stmt: { total_declared: number | null; total_computed: number; period: { year: number; month: number } | null; debit_date: string | null }, movements: BankMovLite[]): { movement: BankMovLite | null; differenza: number } {
  const total = stmt.total_declared ?? stmt.total_computed
  if (!total || total >= 0) return { movement: null, differenza: 0 }
  const from = stmt.period ? `${stmt.period.year}-${String(stmt.period.month).padStart(2, '0')}-01` : null
  const cands = movements
    .filter(m => m.amount < 0 && -m.amount >= -total - 0.005 && -m.amount <= -total + MAX_COMMISSIONI_ADDEBITO + 0.005 && (!from || (m.transaction_date >= from && daysBetween(m.transaction_date, from) <= 75)))
    .map(m => ({ m, diff: r2(total - m.amount) }))
  if (cands.length === 0) return { movement: null, differenza: r2(total) }
  const target = stmt.debit_date
  cands.sort((a, b) => a.diff - b.diff || (target ? daysBetween(a.m.transaction_date, target) - daysBetween(b.m.transaction_date, target) : a.m.transaction_date.localeCompare(b.m.transaction_date)))
  return { movement: cands[0].m, differenza: cands[0].diff }
}

/** Prepagata: ogni ricarica dell'estratto (importo positivo) ↔ l'addebito «Ricarica carta» in banca, stesso importo, entro 3 giorni. */
export function matchRicariche(lines: CardLine[], movements: BankMovLite[]): Map<number, BankMovLite> {
  const used = new Set<string>()
  const out = new Map<number, BankMovLite>()
  lines.forEach((l, i) => {
    if (l.amount <= 0 || !/RICARICA/i.test(l.description)) return
    const c = movements
      .filter(m => !used.has(m.id) && m.amount < 0 && Math.abs(-m.amount - l.amount) < 0.005 && daysBetween(m.transaction_date, l.purchase_date) <= 3)
      .sort((a, b) => daysBetween(a.transaction_date, l.purchase_date) - daysBetween(b.transaction_date, l.purchase_date))[0]
    if (c) { used.add(c.id); out.set(i, c) }
  })
  return out
}

// ── Aggancio alle fatture pagate con carta ─────────────────────────────

export type PayableLite = { id: string; payment_date: string | null; invoice_date: string | null; gross_amount: number; supplier_name: string | null; invoice_number: string | null }

const tokens = (s: string | null): string[] => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(t => t.length >= 3 && !/^(SRL|SPA|SNC|SAS|SRLS|DI|DEL|DELLA|THE|AND|ITA|IRL)$/.test(t))

/**
 * Per ogni spesa dell'estratto la fattura dello Scadenzario pagata con carta
 * con lo stesso importo, entro 10 giorni fra data di acquisto e data di
 * pagamento (o data fattura). A parita' vince chi ha il numero di fattura o
 * un pezzo del nome del fornitore nella descrizione. Ogni fattura una volta.
 */
export function matchPayables(lines: CardLine[], payables: PayableLite[]): Map<number, PayableLite> {
  const used = new Set<string>()
  const out = new Map<number, PayableLite>()
  lines.forEach((l, i) => {
    if (l.amount >= 0) return
    const spesa = -l.amount
    const desc = l.description.toUpperCase()
    const cands = payables
      .filter(p => !used.has(p.id) && Math.abs(Number(p.gross_amount) - spesa) < 0.005)
      .map(p => {
        const dist = Math.min(...[p.payment_date, p.invoice_date].filter((d): d is string => !!d).map(d => daysBetween(d, l.purchase_date)), 999)
        const numHit = p.invoice_number ? desc.includes(p.invoice_number.toUpperCase().replace(/\s+/g, ' ').trim()) || tokens(p.invoice_number).some(t => /\d/.test(t) && desc.includes(t)) : false
        const nameHit = tokens(p.supplier_name).some(t => desc.includes(t))
        return { p, dist, score: (numHit ? 2 : 0) + (nameHit ? 1 : 0) }
      })
      .filter(c => c.dist <= 10 || c.score > 0)
      .sort((a, b) => b.score - a.score || a.dist - b.dist)
    if (cands.length > 0) { used.add(cands[0].p.id); out.set(i, cands[0].p) }
  })
  return out
}

// ── Righe export ───────────────────────────────────────────────────────

export type CartaExportRow = {
  Carta: string
  'Data acquisto': string
  'Data registrazione': string
  Descrizione: string
  Importo: number
  Commissioni: number | ''
  Valuta: string
  Fornitore: string
  Fattura: string
  'Pagata il': string
  'Riscontro banca': string
}

export function buildCartaRow(cardLabel: string, l: CardLine, payable: PayableLite | undefined, riscontro: string, fmtDate: (d: string) => string): CartaExportRow {
  return {
    Carta: cardLabel,
    'Data acquisto': fmtDate(l.purchase_date),
    'Data registrazione': l.posting_date ? fmtDate(l.posting_date) : '',
    Descrizione: l.description,
    Importo: l.amount,
    Commissioni: l.fee ? l.fee : '',
    Valuta: l.currency,
    Fornitore: payable?.supplier_name ?? '',
    Fattura: payable?.invoice_number ?? '',
    'Pagata il': payable?.payment_date ? fmtDate(payable.payment_date) : '',
    'Riscontro banca': riscontro,
  }
}

export const CARTE_COLUMN_WIDTHS = [26, 13, 15, 50, 12, 11, 7, 30, 18, 12, 30]

/** Totali di un estratto: spese, accrediti (ricariche/storni), commissioni, netto. */
export function totaliCarta(lines: CardLine[]): { spese: number; accrediti: number; commissioni: number; netto: number; n: number } {
  const spese = r2(lines.filter(l => l.amount < 0).reduce((s, l) => s - l.amount, 0))
  const accrediti = r2(lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0))
  const commissioni = r2(lines.reduce((s, l) => s + l.fee, 0))
  return { spese, accrediti, commissioni, netto: r2(accrediti - spese + commissioni), n: lines.length }
}
