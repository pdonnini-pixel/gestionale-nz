// Estratti conto dei conti correnti: lettura del file della banca e
// ARRICCHIMENTO delle causali dei movimenti che gia' abbiamo.
//
// Perche' esiste. L'open banking A-Cube porta i movimenti, ma su MPS la
// causale di una disposizione di bonifico finisce cosi':
//
//   «Causale: DISPOSIZIONE - Descrizione: FILIALE DISPONENTE 2430 ID FLUSSO
//    CBI: 135688081 NUM. TOT. PAGAMENTI: 1 IMPORTO BONIFICI: 56.031,89
//    IMPORTO COMMISSIONI: 1,75 ORD.ORIG:»
//
// Il beneficiario manca alla fonte: dopo «ORD.ORIG:» non c'e' niente, e il
// campo counterpart arriva vuoto. Senza nome il motore non puo' agganciare il
// bonifico a una fattura, e il movimento resta aperto per sempre.
// L'estratto conto che la banca esporta in Excel (o stampa in PDF) la stessa
// riga la scrive per esteso, beneficiario compreso.
//
// Cosa fa questo modulo: legge le righe del file, le appaia ai movimenti gia'
// presenti (stesso importo al centesimo, data vicina) e dice quale causale
// estesa scrivere accanto a quella originale. NON crea movimenti: i movimenti
// li porta l'open banking, qui si aggiunge solo il testo che manca.
//
// Logica pura e testata: il file lo legge la pagina (SheetJS per Excel,
// extractPdfLines per PDF), qui arrivano celle e righe di testo.

import { extractBeneficiary } from './reconcileMatch'

export type EcRow = {
  /** Data contabile, YYYY-MM-DD */
  date: string
  /** Data valuta se il file la distingue */
  value_date: string | null
  /** Segno di conto: uscita negativa, entrata positiva */
  amount: number
  /** Causale per esteso, come la scrive la banca */
  description: string
}

export type EcParsed = {
  rows: EcRow[]
  /** Intestazioni riconosciute, per farle vedere in pagina quando qualcosa non torna */
  columns: Record<string, number> | null
  warnings: string[]
}

export type EcMovement = {
  id: string
  transaction_date: string
  amount: number
  description: string | null
  counterpart: string | null
  statement_description?: string | null
}

export type EcMatchExito = 'nuovo' | 'gia_presente' | 'ambiguo' | 'senza_movimento'

export type EcMatch = {
  row: EcRow
  movement: EcMovement | null
  esito: EcMatchExito
  /** Beneficiario letto dalla causale estesa, quando si riesce a isolarlo */
  beneficiario: string | null
  /** Quanto testo in piu' porta l'estratto conto rispetto alla causale che abbiamo */
  testo_in_piu: number
  /** Altri movimenti con stesso importo e data vicina: se >1 non si applica niente */
  candidati: number
}

const r2 = (n: number): number => Math.round(n * 100) / 100

const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()

/** Confronto di intestazioni: senza accenti, senza punteggiatura, minuscolo. */
const normHeader = (s: unknown): string =>
  norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** «1.263,72» → 1263.72; «-29,99» → -29.99; «1263.72» → 1263.72. Null se non e' un numero. */
export function parseAmountCell(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? r2(v) : null
  const t = String(v).trim().replace(/\s|€|EUR/gi, '')
  if (!t) return null
  // Formato italiano: la virgola e' il separatore decimale.
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+,\d+$/.test(t)) {
    return r2(Number(t.replace(/\./g, '').replace(',', '.')))
  }
  // Formato con punto decimale, con o senza separatore di migliaia.
  if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(t)) {
    return r2(Number(t.replace(/,/g, '')))
  }
  return null
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Data da cella Excel (Date, seriale o testo) o da testo «gg/mm/aaaa». Null se non e' una data. */
export function parseDateCell(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
  }
  if (typeof v === 'number') {
    // Seriale Excel: giorni dal 30/12/1899, quindi un intero. Fuori dall'intervallo
    // 2000-2050, o con decimali, e' un importo travestito da data: meglio niente.
    if (!Number.isInteger(v) || v < 36526 || v > 54789) return null
    const ms = Math.round((v - 25569) * 86400000)
    const d = new Date(ms)
    if (Number.isNaN(d.getTime())) return null
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const t = norm(v)
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t)
  if (it) {
    const [, gg, mm, aa] = it
    const anno = aa.length === 2 ? 2000 + Number(aa) : Number(aa)
    return `${anno}-${pad(Number(mm))}-${pad(Number(gg))}`
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

// Sinonimi visti sugli export delle quattro banche di NZ (MPS, Intesa, BCC
// Figline, BCC Mugello). L'ordine conta: si prende la prima intestazione che
// combacia, quindi le varianti piu' specifiche stanno prima.
const H_DATA = ['data contabile', 'data contab', 'data operazione', 'data movimento', 'data mov', 'data reg', 'data registrazione', 'data']
const H_VALUTA = ['data valuta', 'valuta']
const H_DESCR = ['descrizione operazione', 'descrizione estesa', 'descrizione', 'causale', 'causale abi', 'operazione', 'dettagli', 'note']
const H_IMPORTO = ['importo in euro', 'importo euro', 'importo eur', 'importo']
const H_DARE = ['dare', 'uscite', 'uscita', 'addebiti', 'addebito']
const H_AVERE = ['avere', 'entrate', 'entrata', 'accrediti', 'accredito']

const findCol = (headers: string[], sinonimi: string[]): number => {
  for (const s of sinonimi) {
    const i = headers.findIndex((h) => h === s)
    if (i >= 0) return i
  }
  for (const s of sinonimi) {
    const i = headers.findIndex((h) => h.startsWith(s) || h.includes(s))
    if (i >= 0) return i
  }
  return -1
}

/**
 * Estratto conto in Excel: si cerca la riga di intestazione (quella che ha una
 * colonna data e una colonna importo, o dare/avere) e si leggono le righe sotto.
 * Le banche mettono sempre qualche riga di testata prima della tabella.
 */
export function parseEcAoa(aoa: unknown[][]): EcParsed {
  const warnings: string[] = []
  let head = -1
  let cols: Record<string, number> | null = null

  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const headers = (aoa[i] ?? []).map(normHeader)
    if (headers.filter(Boolean).length < 2) continue
    const iData = findCol(headers, H_DATA)
    const iImporto = findCol(headers, H_IMPORTO)
    const iDare = findCol(headers, H_DARE)
    const iAvere = findCol(headers, H_AVERE)
    if (iData < 0) continue
    if (iImporto < 0 && iDare < 0 && iAvere < 0) continue
    head = i
    cols = {
      data: iData,
      valuta: findCol(headers, H_VALUTA),
      descrizione: findCol(headers, H_DESCR),
      importo: iImporto,
      dare: iDare,
      avere: iAvere,
    }
    break
  }

  if (head < 0 || !cols) {
    return { rows: [], columns: null, warnings: ['Non ho trovato la riga di intestazione: nel foglio non c\'e\' una colonna data con accanto un importo (o dare/avere).'] }
  }
  if (cols.descrizione < 0) {
    warnings.push('Nel foglio non c\'e\' una colonna descrizione: senza causale l\'estratto conto non aggiunge niente.')
  }

  const rows: EcRow[] = []
  for (let i = head + 1; i < aoa.length; i++) {
    const r = aoa[i] ?? []
    const date = parseDateCell(r[cols.data])
    if (!date) continue

    let amount: number | null = null
    if (cols.importo >= 0) amount = parseAmountCell(r[cols.importo])
    if (amount == null && (cols.dare >= 0 || cols.avere >= 0)) {
      // Dare = uscita, Avere = entrata. Le banche le scrivono quasi sempre in
      // valore assoluto su due colonne distinte; il segno lo mette la colonna.
      const dare = cols.dare >= 0 ? parseAmountCell(r[cols.dare]) : null
      const avere = cols.avere >= 0 ? parseAmountCell(r[cols.avere]) : null
      if (dare != null || avere != null) amount = r2((avere ?? 0) - Math.abs(dare ?? 0))
    }
    if (amount == null || amount === 0) continue

    // La descrizione puo' essere spezzata su piu' colonne accanto a quella
    // riconosciuta (capita sugli export MPS): si concatenano le celle di testo
    // che non sono ne' date ne' importi.
    const pezzi: string[] = []
    if (cols.descrizione >= 0) pezzi.push(norm(r[cols.descrizione]))
    for (let c = 0; c < r.length; c++) {
      if (c === cols.data || c === cols.valuta || c === cols.importo || c === cols.dare || c === cols.avere || c === cols.descrizione) continue
      const cell = r[c]
      if (typeof cell !== 'string') continue
      const t = norm(cell)
      if (!t || t.length < 3) continue
      if (parseAmountCell(t) != null || parseDateCell(t) != null) continue
      pezzi.push(t)
    }
    const description = norm(pezzi.filter(Boolean).join(' '))
    if (!description) continue

    rows.push({ date, value_date: cols.valuta >= 0 ? parseDateCell(r[cols.valuta]) : null, amount, description })
  }

  if (rows.length === 0) warnings.push('Intestazione trovata, ma sotto non c\'e\' nessuna riga leggibile (data + importo + causale).')
  return { rows, columns: cols, warnings }
}

// PDF: «12/07/2026 13/07/2026 CAUSALE PER ESTESO 56.031,89». Due date (contabile
// e valuta) o una sola, causale in mezzo, importo in fondo. Il segno lo porta la
// colonna dare/avere, che nel testo estratto si perde: lo decide il chiamante
// confrontando con i movimenti, quindi qui l'importo resta in valore assoluto
// e viene provato con entrambi i segni in fase di abbinamento.
const RE_PDF_ROW = /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+(?:(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+)?(.+?)\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$/

/** Estratto conto in PDF: una riga per movimento, importo in coda. */
export function parseEcLines(lines: string[]): EcParsed {
  const rows: EcRow[] = []
  const warnings: string[] = []
  for (const raw of lines) {
    const line = norm(raw)
    const m = RE_PDF_ROW.exec(line)
    if (!m) continue
    const date = parseDateCell(m[1])
    const amount = parseAmountCell(m[4])
    const description = norm(m[3])
    if (!date || amount == null || amount === 0 || description.length < 3) continue
    rows.push({ date, value_date: m[2] ? parseDateCell(m[2]) : null, amount, description })
  }
  if (rows.length === 0) warnings.push('Nel PDF non ho riconosciuto nessuna riga «data · causale · importo».')
  return { rows, columns: null, warnings }
}

const giorni = (a: string, b: string): number =>
  Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86400000))

/** Parole della causale, senza sigle e numeri, per capire se il file dice qualcosa di nuovo. */
const parole = (s: string): Set<string> =>
  new Set(
    String(s || '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w)),
  )

/**
 * Appaia le righe dell'estratto conto ai movimenti che abbiamo.
 *
 * Criterio: stesso importo al centesimo e data entro `tolleranzaGiorni`. Il PDF
 * perde il segno, quindi una riga positiva viene provata anche come uscita.
 * Se i candidati sono piu' di uno l'esito e' «ambiguo» e non si scrive niente:
 * meglio nessuna causale che la causale di un altro movimento.
 */
export function matchEcRows(
  rows: EcRow[],
  movimenti: EcMovement[],
  opts: { tolleranzaGiorni?: number } = {},
): EcMatch[] {
  const tol = opts.tolleranzaGiorni ?? 3
  const usati = new Set<string>()
  const out: EcMatch[] = []

  for (const row of rows) {
    const candidati = movimenti.filter((m) => {
      if (usati.has(m.id)) return false
      const stessoImporto = Math.abs(r2(m.amount) - row.amount) < 0.005 || Math.abs(r2(m.amount) + row.amount) < 0.005
      return stessoImporto && giorni(m.transaction_date, row.date) <= tol
    })

    if (candidati.length === 0) {
      out.push({ row, movement: null, esito: 'senza_movimento', beneficiario: null, testo_in_piu: 0, candidati: 0 })
      continue
    }
    if (candidati.length > 1) {
      out.push({ row, movement: null, esito: 'ambiguo', beneficiario: null, testo_in_piu: 0, candidati: candidati.length })
      continue
    }

    const mov = candidati[0]
    usati.add(mov.id)
    const nostre = parole(`${mov.description ?? ''} ${mov.counterpart ?? ''}`)
    const loro = parole(row.description)
    let inPiu = 0
    for (const w of loro) if (!nostre.has(w)) inPiu++
    const benef = extractBeneficiary(row.description) || null

    out.push({
      row,
      movement: mov,
      esito: inPiu > 0 || (benef && !mov.counterpart) ? 'nuovo' : 'gia_presente',
      beneficiario: benef,
      testo_in_piu: inPiu,
      candidati: 1,
    })
  }

  return out
}

export type EcAggiornamento = {
  id: string
  statement_description: string
  /** Si scrive solo se il movimento non ha gia' una controparte: un dato inserito prima non si sovrascrive. */
  counterpart: string | null
}

/** Dalle corrispondenze utili alle righe da scrivere: solo quelle che aggiungono qualcosa. */
export function aggiornamentiDa(matches: EcMatch[]): EcAggiornamento[] {
  const out: EcAggiornamento[] = []
  for (const m of matches) {
    if (m.esito !== 'nuovo' || !m.movement) continue
    out.push({
      id: m.movement.id,
      statement_description: m.row.description,
      counterpart: m.movement.counterpart ? null : m.beneficiario,
    })
  }
  return out
}

export type EcRiepilogo = {
  righe: number
  nuovi: number
  gia_presenti: number
  ambigui: number
  senza_movimento: number
  con_beneficiario: number
}

export function riepilogoEc(matches: EcMatch[]): EcRiepilogo {
  return {
    righe: matches.length,
    nuovi: matches.filter((m) => m.esito === 'nuovo').length,
    gia_presenti: matches.filter((m) => m.esito === 'gia_presente').length,
    ambigui: matches.filter((m) => m.esito === 'ambiguo').length,
    senza_movimento: matches.filter((m) => m.esito === 'senza_movimento').length,
    con_beneficiario: matches.filter((m) => m.esito === 'nuovo' && m.beneficiario).length,
  }
}
