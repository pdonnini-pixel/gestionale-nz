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
  /** Prepagata: «Disponibilita'» stampata sul PDF, cioe' il saldo della carta alla data di stampa del documento. */
  available_balance: number | null
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
  // «Carta Numero:» senza numero sulla stessa riga: pdf.js a volte spezza
  // l'etichetta dal numero («5582 **** **** 3145» sulla riga dopo).
  let attesaNumero = false
  const ROW = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})$/
  const MASKED = /^\d{4}[\s*]+\*{4}[\s*]+(\d{4})$/
  const openCard = (last4: string | null): CardSection => { const c: CardSection = { card_last4: last4, holder: null, total_declared: null }; cards.push(c); return c }
  for (const raw of lines) {
    const l = raw.trim()
    let m: RegExpExecArray | null
    if ((m = /Carta Numero:\s*(.*)$/i.exec(l))) {
      const last4 = last4Of(m[1])
      if (last4) { cur = openCard(last4); attesaNumero = false } else attesaNumero = true
      continue
    }
    if (attesaNumero && (m = MASKED.exec(l))) { cur = openCard(m[1]); attesaNumero = false; continue }
    if ((m = /Nominativo:\s*(.+)$/i.exec(l))) { if (cur) cur.holder = m[1].trim(); continue }
    if ((m = /TOTALE OPERAZIONI\s+(-?[\d.]+,\d{2})/i.exec(l))) {
      const v = parseItAmount(m[1])
      if (!cur) cur = openCard(null)
      if (v != null) cur.total_declared = r2(-v)
      continue
    }
    if ((m = ROW.exec(l))) {
      const v = parseItAmount(m[4])
      if (v == null) continue
      out.push({ card_last4: cur?.card_last4 ?? null, purchase_date: toIsoDate(m[1])!, posting_date: toIsoDate(m[2]), description: m[3].trim(), amount: r2(-v), fee: 0, currency: 'EUR', original_amount: null })
    }
  }
  if (!cards.some(c => c.card_last4)) warnings.push('numero di carta non trovato nel documento')
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

/**
 * Prepagata Tasca, PDF «Lista Movimenti»: importi a punto decimale, «Totale
 * Movimenti x», «Disponibilita' x EUR» (saldo alla stampa). Il portale spezza
 * ogni movimento su due o tre righe: «data acquisto data registrazione inizio
 * descrizione», poi «importo importo commissioni EUR» (a volte con il resto
 * della descrizione davanti), poi «hh:mm:ss resto della descrizione». Si legge
 * a blocchi: un blocco parte da una riga con le due date e finisce alla
 * successiva; gli importi arrivano su una riga qualsiasi del blocco.
 */
export function parseTascaLines(lines: string[]): CardStatementParsed {
  const out: CardLine[] = []
  const warnings: string[] = []
  const cards: CardSection[] = []
  let total: number | null = null
  let available: number | null = null
  let inAuth = false
  const DATES = /^(\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2}:\d{2})?\s+(\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2}:\d{2})?(?:\s+(.*))?$/
  const AMOUNTS = /^(.*?)\s*(-?\d+\.\d{2})\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})\s+([A-Z]{3})$/
  const TIME = /^\d{2}:\d{2}:\d{2}(?:\s+(.*))?$/
  const NOISE = /^(Pag\.|Per le eventuali|Ove l'informazione|NOTA:|e' precisata|Data |registrazione|Lista )/i
  type Pending = { purchase: string; posting: string | null; desc: string[]; amount: number | null; orig: number | null; fee: number; cur: string }
  let cur: Pending | null = null
  const flush = () => {
    if (cur && cur.amount != null) {
      out.push({ card_last4: cards[0]?.card_last4 ?? null, purchase_date: toIsoDate(cur.purchase)!, posting_date: toIsoDate(cur.posting), description: cur.desc.join(' ').replace(/\s+/g, ' ').trim(), amount: r2(cur.amount), fee: r2(cur.fee), currency: cur.cur, original_amount: cur.orig })
    }
    cur = null
  }
  const takeAmounts = (p: Pending, a: RegExpExecArray) => {
    const amount = parseDotAmount(a[2]); if (amount == null) return
    if (a[1]) p.desc.push(a[1])
    p.amount = amount; p.orig = parseDotAmount(a[3]); p.fee = parseDotAmount(a[4]) ?? 0; p.cur = a[5]
  }
  for (const raw of lines) {
    const l = raw.trim().replace(/\s+/g, ' ')
    let m: RegExpExecArray | null
    if (/Lista Autorizzazioni/i.test(l)) { flush(); inAuth = true; continue }
    if (/Lista Movimenti/i.test(l)) { flush(); inAuth = false; continue }
    if ((m = /Totale Movimenti\s+(-?\d+\.\d{2})/i.exec(l))) { flush(); total = parseDotAmount(m[1]); continue }
    if ((m = /Disponibilit[aà]\s+(-?\d+\.\d{2})\s*EUR/i.exec(l))) { available = parseDotAmount(m[1]); continue }
    const withHolder = /^([A-Z' ]+?)\s+(\d{6}\*+\d{4})\s+Prepaid/i.exec(l)
    if (withHolder || (m = /(\d{6}\*+\d{4})\s+(Prepaid|Business|MC|Mastercard)/i.exec(l)) || (m = /Numero Carta\s+(\d{6}\*+\d{4})/i.exec(l))) {
      const num = withHolder ? withHolder[2] : m![1]
      const holder = withHolder ? withHolder[1].trim() : null
      const l4 = last4Of(num)
      if (l4 && !cards.some(c => c.card_last4 === l4)) cards.push({ card_last4: l4, holder, total_declared: null })
      continue
    }
    if ((m = /^Intestatario\s+(.+)$/i.exec(l)) && cards.length === 0) { cards.push({ card_last4: null, holder: m[1].trim(), total_declared: null }); continue }
    if (inAuth) continue
    if ((m = DATES.exec(l))) {
      flush()
      cur = { purchase: m[1], posting: m[2], desc: [], amount: null, orig: null, fee: 0, cur: 'EUR' }
      const rest = m[3]
      if (rest) { const a = AMOUNTS.exec(rest); if (a) takeAmounts(cur, a); else cur.desc.push(rest) }
      continue
    }
    if (!cur) continue
    if (cur.amount == null && (m = AMOUNTS.exec(l))) { takeAmounts(cur, m); continue }
    if ((m = TIME.exec(l))) { if (m[1]) cur.desc.push(m[1]); continue }
    if (!NOISE.test(l)) cur.desc.push(l)
  }
  flush()
  // Intestazione «Intestatario … / Numero Carta …» su righe separate: unisce titolare e carta
  if (cards.length > 1 && cards[0].card_last4 == null && cards[1].card_last4) { cards[1].holder = cards[1].holder ?? cards[0].holder; cards.shift() }
  for (const l of out) if (!l.card_last4) l.card_last4 = cards[0]?.card_last4 ?? null
  if (cards.length > 0 && total != null) cards[0].total_declared = r2(total)
  if (out.length === 0) warnings.push('nessuna riga «data acquisto, data registrazione, descrizione, importo» riconosciuta: per la prepagata conviene l\'export Excel del portale')
  return finish('tasca', cards, out, null, warnings, available)
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

function finish(issuer: CardIssuer, cards: CardSection[], lines: CardLine[], debit_date: string | null, warnings: string[], available_balance: number | null = null): CardStatementParsed {
  const declared = cards.some(c => c.total_declared != null) ? r2(cards.reduce((s, c) => s + (c.total_declared ?? 0), 0)) : null
  const computed = r2(lines.reduce((s, l) => s + l.amount + l.fee, 0))
  if (declared != null && Math.abs(declared - computed) > 0.005) warnings.push(`il totale dichiarato dal documento (${declared.toFixed(2)}) non coincide con la somma delle righe lette (${computed.toFixed(2)})`)
  if (lines.length === 0) warnings.push('nessuna operazione letta')
  return { issuer, cards, lines, total_declared: declared, total_computed: computed, debit_date, period: periodOf(lines), available_balance, warnings }
}

/**
 * Mese dell'estratto: quello dell'ULTIMA data di acquisto. Un estratto
 * mensile chiude nel suo mese: nessun acquisto puo' essere posteriore, mentre
 * puo' aprirsi con le ultime operazioni del mese prima (la CartaBCC chiude
 * intorno al 27: l'estratto di agosto 2026 della *3145 aveva tre righe del
 * 29/07 e due di agosto, e «il mese piu' frequente» lo mandava a luglio).
 * Si guarda l'acquisto e non la registrazione perche' il portale Tasca
 * esporta per data di acquisto (un acquisto del 30/06 registrato l'1/07 sta
 * nell'estratto di giugno).
 */
export function periodOf(lines: CardLine[]): { year: number; month: number } | null {
  let last: string | null = null
  for (const l of lines) {
    const k = l.purchase_date.slice(0, 7)
    if (last == null || k > last) last = k
  }
  return last ? { year: Number(last.slice(0, 4)), month: Number(last.slice(5, 7)) } : null
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

export type PayableLite = { id: string; payment_date: string | null; invoice_date: string | null; gross_amount: number; supplier_name: string | null; invoice_number: string | null; payment_method?: string | null }

const tokens = (s: string | null): string[] => (s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').split(' ').filter(t => t.length >= 3 && !/^(SRL|SPA|SNC|SAS|SRLS|DI|DEL|DELLA|THE|AND|ITA|IRL)$/.test(t))

/**
 * Per ogni spesa dell'estratto la fattura dello Scadenzario pagata con carta
 * con lo stesso importo, entro 10 giorni fra data di acquisto e data di
 * pagamento (o data fattura). A parita' vince chi ha il numero di fattura o
 * un pezzo del nome del fornitore nella descrizione. Ogni fattura una volta.
 *
 * Il nome del fornitore e il numero di fattura allargano la finestra, non la
 * tolgono: lo stesso importo dallo stesso fornitore ricorre (un biglietto
 * Trenitalia da 24,80 a marzo e un altro identico a luglio), e senza un
 * limite di distanza la spesa di marzo si prenderebbe la fattura di luglio.
 * Il numero di fattura nella descrizione e' una prova forte e arriva a
 * quattro mesi; il solo nome si ferma a 45 giorni, che coprono la fattura
 * riepilogativa di fine mese pagata con l'addebito dell'estratto.
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
      .filter(c => c.dist <= (c.score >= 2 ? 120 : c.score > 0 ? 45 : 10))
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
  /** Prepagata: saldo della carta dopo la riga (righe in ordine cronologico); vuoto per le carte di credito. */
  Saldo: number | ''
}

export function buildCartaRow(cardLabel: string, l: CardLine, payable: PayableLite | undefined, riscontro: string, fmtDate: (d: string) => string, saldo: number | null = null): CartaExportRow {
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
    Saldo: saldo ?? '',
  }
}

export const CARTE_COLUMN_WIDTHS = [26, 13, 15, 50, 12, 11, 7, 30, 18, 12, 30, 12]

/** Totali di un estratto: spese, accrediti (ricariche/storni), commissioni, netto. */
export function totaliCarta(lines: CardLine[]): { spese: number; accrediti: number; commissioni: number; netto: number; n: number } {
  const spese = r2(lines.filter(l => l.amount < 0).reduce((s, l) => s - l.amount, 0))
  const accrediti = r2(lines.filter(l => l.amount > 0).reduce((s, l) => s + l.amount, 0))
  const commissioni = r2(lines.reduce((s, l) => s + l.fee, 0))
  return { spese, accrediti, commissioni, netto: r2(accrediti - spese + commissioni), n: lines.length }
}

// ---------------------------------------------------------------------------
// Carte di DEBITO: non hanno un estratto a parte, ogni pagamento POS e' un
// movimento del conto corrente. La causale della banca porta la carta, la data
// di acquisto e l'esercente: da li' si ricostruisce un «estratto» per carta con
// la stessa struttura di quelli delle carte di credito (riga per operazione,
// fattura pagata, riscontro), senza addebito cumulativo da cercare.
//   BCC: «Operazione POS Eurozona Del 17.02.26 17:36 Carta *453 COSTO DEL NOLEGGIO FIRENZE IT»
//   MPS: «PAGAMENTO TRAMITE POS PAG.POS MASTERCARD DATA 28/01/26 ORA 10.31 LOC.REGGELLO ESERCENTE : STAZIONE BEYFIN C.C.S. IMP.IN DIV.ORIG -129.30 COM. E. 0.00 N.CARTA: 98957552»
//   MPS: «Causale: PAG.POS MASTERCARD - Descrizione: DATA 14/05/26 ORA 00.00 LOC.TORINO ESERCENTE : SCANNABUE IMP.IN DIV.ORIG -53.00 COM. E. 0.00 N.CARTA: 99899952»
export const RE_POS_DEBITO = /OPERAZIONE POS|PAG\.?\s*POS|PAGAMENTO TRAMITE POS/i

export type DebitPos = {
  /** Identificativo della carta come lo scrive la banca (ultime cifre BCC «453», numero MPS «99899952»). */
  card: string
  purchase_date: string
  merchant: string
  place: string | null
  fee: number
  original_amount: number | null
}

const ymd = (d: string, m: string, y: string): string => `${y.length === 2 ? '20' + y : y}-${m}-${d}`

/** Legge carta, data di acquisto ed esercente dalla causale di un pagamento POS; null se non e' un POS riconoscibile. */
export function parseDebitPos(description: string | null | undefined, fallbackDate: string): DebitPos | null {
  const d = (description ?? '').replace(/\s+/g, ' ').trim()
  if (!RE_POS_DEBITO.test(d)) return null
  const bcc = /Operazione POS(?: Eurozona| Estero)? Del (\d{2})\.(\d{2})\.(\d{2,4})(?: \d{2}:\d{2})? Carta \*(\d+)\s*(.*)$/i.exec(d)
  if (bcc) return { card: bcc[4], purchase_date: ymd(bcc[1], bcc[2], bcc[3]), merchant: bcc[5].trim() || 'POS', place: null, fee: 0, original_amount: null }
  const card = /N\.\s*CARTA:?\s*(\d+)/i.exec(d)?.[1]
  if (!card) return null
  const dt = /DATA (\d{2})\/(\d{2})\/(\d{2,4})/i.exec(d)
  const loc = /LOC\.\s*(.+?)\s+ESERCENTE/i.exec(d)?.[1]?.trim() ?? null
  const merchant = /ESERCENTE\s*:\s*(.+?)\s+IMP\.IN DIV\.ORIG/i.exec(d)?.[1]?.trim() ?? /ESERCENTE\s*:\s*(.+?)(?:\s+COM\.|\s+N\.\s*CARTA|$)/i.exec(d)?.[1]?.trim() ?? 'POS'
  const orig = parseDotAmount(/IMP\.IN DIV\.ORIG\s*(-?[\d.,]+)/i.exec(d)?.[1] ?? null)
  const fee = parseDotAmount(/COM\.\s*E\.\s*(-?[\d.,]+)/i.exec(d)?.[1] ?? null) ?? 0
  return { card, purchase_date: dt ? ymd(dt[1], dt[2], dt[3]) : fallbackDate, merchant, place: loc, fee: -Math.abs(fee), original_amount: orig }
}

export type DebitMovLite = { id: string; bank_account_id: string | null; transaction_date: string; posting_date?: string | null; amount: number; description: string | null }
export type DebitCardGroup = { key: string; bank_account_id: string | null; card: string; lines: Array<CardLine & { id: string }> }

/** Raggruppa i pagamenti POS del periodo per conto e carta; ogni riga e' un movimento del conto. */
export function debitCardsFromMovements(movs: DebitMovLite[]): DebitCardGroup[] {
  const groups = new Map<string, DebitCardGroup>()
  for (const m of movs) {
    if (m.amount >= 0) continue
    const pos = parseDebitPos(m.description, m.transaction_date)
    if (!pos) continue
    const key = `${m.bank_account_id ?? ''}|${pos.card}`
    const g = groups.get(key) ?? { key, bank_account_id: m.bank_account_id, card: pos.card, lines: [] }
    g.lines.push({
      id: m.id, card_last4: pos.card.slice(-4), purchase_date: pos.purchase_date, posting_date: m.posting_date ?? m.transaction_date,
      description: pos.place ? `${pos.merchant} (${pos.place})` : pos.merchant, amount: r2(Number(m.amount)), fee: pos.fee, currency: 'EUR', original_amount: pos.original_amount,
    })
    groups.set(key, g)
  }
  for (const g of groups.values()) g.lines.sort((a, b) => a.purchase_date.localeCompare(b.purchase_date) || a.id.localeCompare(b.id))
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Nome breve della banca per le etichette («BCC Valdarno», «MPS», «Intesa Sanpaolo»). */
export function bankShortName(name: string | null | undefined): string {
  const base = (name ?? '').split(' - ')[0].trim()
  return base.split(/\s+/).slice(0, 2).join(' ') || 'Banca'
}

export const debitCardLabel = (bankName: string | null | undefined, card: string): string =>
  `Carta di debito ${bankShortName(bankName)} ${card.length <= 4 ? '*' + card : 'n. ' + card}`

// ── Saldo della prepagata ──────────────────────────────────────────────
// La Tasca non ha un estratto con saldo iniziale e finale: il portale da'
// solo i movimenti e, nel PDF, la «Disponibilita'» alla data di stampa. Il
// saldo di ogni mese si ricostruisce concatenando gli estratti: si parte dal
// primo estratto che dichiara una disponibilita' (stampato di norma appena
// chiuso il mese, quindi = saldo a fine mese) e si va avanti e indietro
// sommando o togliendo il netto di ogni mese. Senza nessuna disponibilita'
// si parte da zero al primo estratto e lo si dice.

export type PrepaidStmtLite = { key: string; period: { year: number; month: number } | null; netto: number; available_balance: number | null }
export type PrepaidBalance = { saldo_iniziale: number; saldo_finale: number; ancoraggio: 'documento' | 'catena' | 'da_zero'; anchor_key: string | null }

export function prepaidBalances(stmts: PrepaidStmtLite[]): Map<string, PrepaidBalance> {
  const out = new Map<string, PrepaidBalance>()
  const dated = stmts.filter(s => s.period).sort((a, b) => (a.period!.year - b.period!.year) || (a.period!.month - b.period!.month))
  if (dated.length === 0) return out
  const ai = dated.findIndex(s => s.available_balance != null)
  if (ai < 0) {
    let saldo = 0
    for (const s of dated) { out.set(s.key, { saldo_iniziale: saldo, saldo_finale: r2(saldo + s.netto), ancoraggio: 'da_zero', anchor_key: null }); saldo = r2(saldo + s.netto) }
    return out
  }
  const anchor = dated[ai]
  out.set(anchor.key, { saldo_iniziale: r2(anchor.available_balance! - anchor.netto), saldo_finale: r2(anchor.available_balance!), ancoraggio: 'documento', anchor_key: anchor.key })
  let saldo = r2(anchor.available_balance!)
  for (let i = ai + 1; i < dated.length; i++) { const s = dated[i]; out.set(s.key, { saldo_iniziale: saldo, saldo_finale: r2(saldo + s.netto), ancoraggio: 'catena', anchor_key: anchor.key }); saldo = r2(saldo + s.netto) }
  saldo = out.get(anchor.key)!.saldo_iniziale
  for (let i = ai - 1; i >= 0; i--) { const s = dated[i]; out.set(s.key, { saldo_iniziale: r2(saldo - s.netto), saldo_finale: saldo, ancoraggio: 'catena', anchor_key: anchor.key }); saldo = r2(saldo - s.netto) }
  return out
}

/** Netto di un estratto: ricariche e storni meno spese, commissioni comprese (le commissioni sono negative). */
export const nettoCarta = (lines: Array<{ amount: number; fee: number }>): number => r2(lines.reduce((s, l) => s + l.amount + l.fee, 0))

/** Righe in ordine cronologico (data acquisto, poi riga) con il saldo progressivo della prepagata. */
export function conSaldoProgressivo<T extends { amount: number; fee: number; purchase_date: string }>(lines: T[], saldoIniziale: number): Array<{ line: T; index: number; saldo: number }> {
  // Stesso giorno: prima le ricariche (importo positivo), poi le spese. Una
  // prepagata non va sotto zero: la ricarica del 27/08 precede le spese del
  // 27/08 anche se il portale le stampa dopo.
  const idx = lines.map((line, index) => ({ line, index })).sort((a, b) => a.line.purchase_date.localeCompare(b.line.purchase_date) || (b.line.amount > 0 ? 1 : 0) - (a.line.amount > 0 ? 1 : 0) || a.index - b.index)
  let saldo = saldoIniziale
  return idx.map(({ line, index }) => { saldo = r2(saldo + line.amount + line.fee); return { line, index, saldo } })
}
