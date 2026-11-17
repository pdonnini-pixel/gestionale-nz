/**
 * bilancioParser.js
 * Parser avanzato per PDF di bilancio italiano "a sezioni contrapposte"
 * Estrae Stato Patrimoniale + Conto Economico con gerarchia completa dei conti
 * Usa pdfjs-dist (browser) per estrarre testo con posizione X/Y
 */

// ── Numero italiano → Number ──
function parseItalianNumber(str: string | null | undefined): number {
  if (!str || typeof str !== 'string') return 0
  const clean = str.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(clean)
  return isNaN(n) ? 0 : n
}

// ── Determina il livello gerarchico dal codice ──
function getLevel(code: string | null | undefined): number {
  if (!code) return 0
  const len = code.replace(/\s/g, '').length
  if (len <= 2) return 0       // macro (es: 61, 63, 05)
  if (len <= 4) return 1       // sotto-conto (es: 6101, 6303)
  if (len <= 6) return 2       // dettaglio (es: 610105, 630301)
  return 3                     // sotto-dettaglio (es: 05070101)
}

// ── Determina se un codice è un "totale macro" (2 cifre) ──
function isMacro(code: string | null | undefined): boolean {
  return !!code && code.replace(/\s/g, '').length <= 2
}

/**
 * Estrae tutte le righe di dati dal PDF del bilancio
 * @param {ArrayBuffer|Uint8Array} pdfData - Dati binari del PDF
 * @returns {Object} { patrimoniale: { attivita, passivita, totals }, contoEconomico: { costi, ricavi, totals }, meta }
 */
interface BilancioTotals {
  attivita?: number
  passivita?: number
  costi?: number
  ricavi?: number
  risultato?: number
}

interface BilancioPatrimoniale {
  attivita: BilancioRow[]
  passivita: BilancioRow[]
  totals: BilancioTotals
  attivitaTree?: Array<BilancioRow & { children: unknown[] }>
  passivitaTree?: Array<BilancioRow & { children: unknown[] }>
}

interface BilancioContoEconomico {
  costi: BilancioRow[]
  ricavi: BilancioRow[]
  totals: BilancioTotals
  costiTree?: Array<BilancioRow & { children: unknown[] }>
  ricaviTree?: Array<BilancioRow & { children: unknown[] }>
}

export interface BilancioParsed {
  meta: { pages: number; company: string; period: string; date: string }
  patrimoniale: BilancioPatrimoniale
  contoEconomico: BilancioContoEconomico
}

export async function parseBilancio(pdfData: ArrayBuffer | Uint8Array): Promise<BilancioParsed> {
  const pdfjsLib = await import('pdfjs-dist')

  // Worker setup
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString()
  }

  const source = pdfData instanceof ArrayBuffer ? new Uint8Array(pdfData) : pdfData
  const pdf = await pdfjsLib.getDocument({ data: source }).promise

  const result: BilancioParsed = {
    meta: { pages: pdf.numPages, company: '', period: '', date: '' },
    patrimoniale: { attivita: [], passivita: [], totals: {} },
    contoEconomico: { costi: [], ricavi: [], totals: {} },
  }

  let currentSection: string | null = null // 'patrimoniale' | 'conto_economico'
  const risultatoZero = { sp: false, ce: false }

  for (let pn = 1; pn <= pdf.numPages; pn++) {
    const page = await pdf.getPage(pn)
    const content = await page.getTextContent()

    const items = (content.items as Array<{ str: string; transform: number[] }>)
      .map(i => ({
        text: (i.str ?? '').trim(),
        x: Math.round(i.transform[4]),
        y: Math.round(i.transform[5]),
      }))
      .filter(i => i.text.length > 0)

    // Righe per vicinanza verticale, non per arrotondamento: con lo scatto a
    // multipli di 4 un importo un pixel sopra il suo codice finiva nella riga
    // accanto (bilancio di verifica Zago 2025: «51010101» a y 533 e «6.068,37» a
    // y 534 cadevano in 532 e 536, e i corrispettivi di Firenze e Forte dei
    // Marmi risultavano 0,00). Le righe distano circa 12 punti: chi sta entro 4
    // dalla prima voce della riga ne fa parte.
    const rowList: Array<{ y: number; cells: Array<{ text: string; x: number; y: number }> }> = []
    for (const i of [...items].sort((a, b) => b.y - a.y)) {
      const last = rowList[rowList.length - 1]
      if (last && last.y - i.y <= 4) last.cells.push(i)
      else rowList.push({ y: i.y, cells: [i] })
    }

    for (let ri = 0; ri < rowList.length; ri++) {
      const cells = rowList[ri].cells.sort((a, b) => a.x - b.x)
      const fullLine = cells.map(c => c.text).join(' ')

      // Detect meta info
      if (/Azienda:\s*(.+)/i.test(fullLine) && !result.meta.company) {
        result.meta.company = fullLine.match(/Azienda:\s*(.+?)(?:\s*$)/i)?.[1] || ''
      }
      if (/PERIODO\s*DAL/i.test(fullLine) && !result.meta.period) {
        result.meta.period = fullLine
      }

      // Detect section
      if (/SITUAZIONE\s*PATRIMONIALE/i.test(fullLine)) {
        currentSection = 'patrimoniale'
        continue
      }
      if (/CONTO\s*ECONOMICO/i.test(fullLine)) {
        currentSection = 'conto_economico'
        continue
      }

      // Skip headers
      if (/^(ATTIVITA|PASSIVITA|COMPONENTI|Codice\s+Descrizione)/i.test(fullLine)) continue

      // Detect TOTALE / Perdita / Utile
      if (/^TOTALE\b/i.test(fullLine)) {
        if (currentSection === 'patrimoniale') {
          // Left side total (attivita), right side (passivita)
          const leftCells = cells.filter(c => c.x < 290)
          const rightCells = cells.filter(c => c.x >= 290)
          const leftAmt = leftCells.map(c => c.text).join(' ').match(/([\d.,]+)/)?.[1]
          const rightAmt = rightCells.map(c => c.text).join(' ').match(/([\d.,]+)/)?.[1]
          if (leftAmt) result.patrimoniale.totals.attivita = parseItalianNumber(leftAmt)
          if (rightAmt) result.patrimoniale.totals.passivita = parseItalianNumber(rightAmt)
          // Nella stampa di Zago 2025 l'importo dell'attivo sta un pixel sopra la
          // parola TOTALE e l'arrotondamento a 4 lo mette nella riga accanto:
          // se a sinistra manca, si guarda la riga sopra e quella sotto, e lo si
          // prende solo se e' uguale al passivo (a sezioni contrapposte pareggiano),
          // cosi' non si scambia per totale l'importo di un conto vicino.
          if (!leftAmt && rightAmt) {
            const passivo = parseItalianNumber(rightAmt)
            const vicini = [...(rowList[ri - 1]?.cells || []), ...(rowList[ri + 1]?.cells || [])]
            const amt = vicini.find(c => c.x < 290 && /^\d[\d.]*,\d{2}$/.test(c.text)
              && Math.abs(parseItalianNumber(c.text) - passivo) < 0.005)?.text
            if (amt) result.patrimoniale.totals.attivita = parseItalianNumber(amt)
          }
        } else if (currentSection === 'conto_economico') {
          const leftCells = cells.filter(c => c.x < 290)
          const rightCells = cells.filter(c => c.x >= 290)
          const leftAmt = leftCells.map(c => c.text).join(' ').match(/([\d.,]+)/)?.[1]
          const rightAmt = rightCells.map(c => c.text).join(' ').match(/([\d.,]+)/)?.[1]
          if (leftAmt) result.contoEconomico.totals.costi = parseItalianNumber(leftAmt)
          if (rightAmt) result.contoEconomico.totals.ricavi = parseItalianNumber(rightAmt)
        }
        continue
      }

      // La riga di chiusura «Utile 0,00» / «Perdita 14.770,16» non ha codice conto.
      // Una riga che comincia con un codice (es. «630323 Servizi di vigilanza … 9503
      // Perdita d'esercizio 14.770,16») e' invece una riga di conti: prima veniva
      // scartata intera e si perdeva il conto a sinistra, e il risultato prendeva
      // il codice come importo (-630.323, bilancio di verifica Zago 2025).
      const iniziaConCodice = /^\d{2,}\s/.test(fullLine)
      if (!iniziaConCodice && /(?:Perdita|Utile)\b/i.test(fullLine) && !/Utile.*netto/i.test(fullLine)) {
        const amt = fullLine.match(/(\d[\d.]*,\d{2})/)?.[1]
        if (amt) {
          const val = parseItalianNumber(amt)
          // «Utile 0,00» sotto il TOTALE non cancella un risultato gia' letto;
          // se a fine lettura non c'e' altro, il risultato e' davvero zero.
          if (val === 0) risultatoZero[currentSection === 'patrimoniale' ? 'sp' : 'ce'] = true
          if (val !== 0) {
            if (currentSection === 'patrimoniale') {
              result.patrimoniale.totals.risultato = /Perdita/i.test(fullLine) ? -val : val
            } else if (currentSection === 'conto_economico') {
              result.contoEconomico.totals.risultato = /Perdita/i.test(fullLine) ? -val : val
            }
          }
        }
        continue
      }

      if (/TOTALE\s*A\s*PAREGGIO/i.test(fullLine)) continue

      // Skip repeated header/footer lines from PDF (company info, metadata, page breaks)
      if (/Azienda:|Cod\.\s*Fiscale|Partita\s*IVA|^VIA\s|PERIODO\s*DAL|Totali\s*fino\s*al\s*livello|Considera\s*anche\s*i\s*movimenti|^Pag\./i.test(fullLine)) continue

      // Split into left column (x < 290) and right column (x >= 290)
      const midX = 290
      const leftCells = cells.filter(c => c.x < midX)
      const rightCells = cells.filter(c => c.x >= midX)

      // Parse each column
      const leftRow = parseRowCells(leftCells)
      const rightRow = parseRowCells(rightCells)

      if (currentSection === 'patrimoniale') {
        if (leftRow) result.patrimoniale.attivita.push(leftRow)
        if (rightRow) result.patrimoniale.passivita.push(rightRow)
      } else if (currentSection === 'conto_economico') {
        // «Perdita/Utile d'esercizio» nel conto economico e' il risultato a
        // pareggio, non un costo o un ricavo: va nel risultato, non nelle righe.
        const eRisultato = (r: BilancioRow | null) => !!r && /^(perdita|utile)\b.*esercizio/i.test(r.description)
        for (const r of [leftRow, rightRow]) {
          if (r && eRisultato(r) && r.amount !== 0 && result.contoEconomico.totals.risultato == null) {
            result.contoEconomico.totals.risultato = /^perdita/i.test(r.description) ? -Math.abs(r.amount) : Math.abs(r.amount)
          }
        }
        if (leftRow && !eRisultato(leftRow)) result.contoEconomico.costi.push(leftRow)
        if (rightRow && !eRisultato(rightRow)) result.contoEconomico.ricavi.push(rightRow)
      }
    }
  }

  // Bilancio in pareggio: c'era solo «Utile 0,00», il risultato e' zero (non assente).
  if (result.patrimoniale.totals.risultato == null && risultatoZero.sp) result.patrimoniale.totals.risultato = 0
  if (result.contoEconomico.totals.risultato == null && risultatoZero.ce) result.contoEconomico.totals.risultato = 0

  // Build tree structures
  result.patrimoniale.attivitaTree = buildTree(result.patrimoniale.attivita)
  result.patrimoniale.passivitaTree = buildTree(result.patrimoniale.passivita)
  result.contoEconomico.costiTree = buildTree(result.contoEconomico.costi)
  result.contoEconomico.ricaviTree = buildTree(result.contoEconomico.ricavi)

  return result
}

/**
 * Parsa una riga di celle (codice + descrizione + importo)
 */
interface BilancioRow {
  code: string;
  description: string;
  amount: number;
  level: number;
  isMacro: boolean;
  isItalic: boolean;
}

function parseRowCells(cells: Array<{ text: string; x: number }> | null): BilancioRow | null {
  if (!cells || cells.length === 0) return null

  const texts = cells.sort((a, b) => a.x - b.x).map(c => c.text)
  const fullText = texts.join(' ')

  // Must contain at least one number
  if (!/[\d]/.test(fullText)) return null

  // First element is usually the code (digits only or with dots)
  let code = ''
  let description = ''
  let amountStr = ''

  // Find the code (first token that's all digits)
  let i = 0
  if (/^\d+$/.test(texts[0])) {
    code = texts[0]
    i = 1
  }

  // Find the amount (last token that looks like a number with dots/commas)
  const lastIdx = texts.length - 1
  const amountPattern = /^-?[\d.,]+$/
  if (amountPattern.test(texts[lastIdx])) {
    amountStr = texts[lastIdx]
    // Check if second-to-last is a minus sign
    if (lastIdx > 0 && texts[lastIdx - 1] === '-') {
      amountStr = '-' + amountStr
      description = texts.slice(i, lastIdx - 1).join(' ')
    } else {
      description = texts.slice(i, lastIdx).join(' ')
    }
  } else {
    // No clear amount, try to extract from description
    description = texts.slice(i).join(' ')
    const match = description.match(/(-?[\d.,]+)$/)
    if (match) {
      amountStr = match[1]
      description = description.slice(0, -amountStr.length).trim()
    }
  }

  if (!code && !description) return null

  const amount = parseItalianNumber(amountStr)
  const level = getLevel(code)

  return {
    code: code.trim(),
    description: description.trim(),
    amount,
    level,
    isMacro: isMacro(code),
    isItalic: false, // pdfjs doesn't easily detect italic, but sub-accounts are usually italic in the PDF
  }
}

/**
 * Trasforma una lista piatta in un albero gerarchico
 * basato sulla lunghezza del codice conto
 */
function buildTree(rows: BilancioRow[] | null): Array<BilancioRow & { children: unknown[] }> {
  if (!rows || rows.length === 0) return []

  const tree: Array<BilancioRow & { children: unknown[] }> = []
  const stack: Array<{ node: BilancioRow & { children: unknown[] }; level: number }> = [] // stack of { node, level }

  for (const row of rows) {
    const node = { ...row, children: [] }

    // Find parent: pop stack until we find a node with lower level
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop()
    }

    if (stack.length === 0) {
      tree.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, level: node.level })
  }

  return tree
}

/**
 * Converte i dati parsed in record per balance_sheet_data di Supabase
 */
export function toSupabaseRecords(parsed: BilancioParsed, companyId: string, year: number, periodType = 'annuale'): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []

  // Stato Patrimoniale — Attività
  parsed.patrimoniale.attivita.forEach((row, i) => {
    records.push({
      company_id: companyId,
      year,
      period_type: periodType,
      section: 'sp_attivita',
      account_code: row.code,
      account_name: row.description,
      amount: row.amount,
      sort_order: i,
    })
  })

  // Stato Patrimoniale — Passività
  parsed.patrimoniale.passivita.forEach((row, i) => {
    records.push({
      company_id: companyId,
      year,
      period_type: periodType,
      section: 'sp_passivita',
      account_code: row.code,
      account_name: row.description,
      amount: row.amount,
      sort_order: i,
    })
  })

  // Conto Economico — Costi
  parsed.contoEconomico.costi.forEach((row, i) => {
    records.push({
      company_id: companyId,
      year,
      period_type: periodType,
      section: 'ce_costi',
      account_code: row.code,
      account_name: row.description,
      amount: row.amount,
      sort_order: i,
    })
  })

  // Conto Economico — Ricavi
  parsed.contoEconomico.ricavi.forEach((row, i) => {
    records.push({
      company_id: companyId,
      year,
      period_type: periodType,
      section: 'ce_ricavi',
      account_code: row.code,
      account_name: row.description,
      amount: row.amount,
      sort_order: i,
    })
  })

  // Totali (righe speciali). I TOTALE della stampa sono «a pareggio»: dal lato
  // ricavi comprendono la perdita, dal lato costi l'utile, le imposte e gli
  // oneri finanziari. Valore e costi della produzione si ricavano quindi dai
  // conti (Zago 2025, 17/11/2026: valore 1.520.764 invece di 1.505.994).
  const t = parsed.contoEconomico.totals
  const pCE = parsed.contoEconomico
  const ceMacro: Record<string, number> = {}
  pCE.costi.forEach((row: BilancioRow) => {
    if (row.isMacro) ceMacro[row.code] = row.amount
  })
  const valoreProduzione = valoreDellaProduzione(parsed)
  const costiProduzioneCalc = Math.round(((ceMacro['61'] || 0) + (ceMacro['63'] || 0) + (ceMacro['65'] || 0) +
    (ceMacro['67'] || 0) + (ceMacro['69'] || 0) + (ceMacro['71'] || 0) + (ceMacro['73'] || 0) + (ceMacro['77'] || 0)) * 100) / 100
  const ciSonoCosti = ['61', '63', '65', '67', '69', '71', '73', '77'].some(c => ceMacro[c] != null)
  const totaleCosti = ciSonoCosti ? costiProduzioneCalc : (t.costi || 0)
  if (totaleCosti) {
    records.push({
      company_id: companyId, year, period_type: periodType,
      section: 'conto_economico', account_code: 'totale_costi_produzione',
      account_name: 'Totale costi', amount: totaleCosti, sort_order: 900,
    })
  }
  if (valoreProduzione) {
    records.push({
      company_id: companyId, year, period_type: periodType,
      section: 'conto_economico', account_code: 'ricavi_vendite',
      account_name: 'Valore della produzione', amount: valoreProduzione, sort_order: 901,
    })
  }
  if (t.risultato != null) {
    records.push({
      company_id: companyId, year, period_type: periodType,
      section: 'conto_economico', account_code: 'utile_netto',
      account_name: t.risultato >= 0 ? 'Utile netto' : 'Perdita',
      amount: t.risultato, sort_order: 999,
    })
  }

  // Also add legacy CE_FIELDS mapping for backward compatibility
  const ceMap: Record<string, number> = {
    materie_prime: ceMacro['61'] || 0,
    servizi: ceMacro['63'] || 0,
    godimento_beni_terzi: ceMacro['65'] || 0,
    totale_personale: ceMacro['67'] || 0,
    totale_ammortamenti: (ceMacro['69'] || 0) + (ceMacro['71'] || 0),
    variazione_rimanenze: ceMacro['73'] || 0,
    oneri_diversi: ceMacro['77'] || 0,
    oneri_finanziari: ceMacro['83'] || 0,
  }
  // Sub-fields from sub-accounts
  const ceSub: Record<string, number> = {}
  pCE.costi.forEach((row: BilancioRow) => {
    if (row.level === 1) ceSub[row.code] = row.amount
  })
  ceMap.salari_stipendi = ceSub['6701'] || 0
  ceMap.oneri_sociali = ceSub['6703'] || 0
  ceMap.tfr = ceSub['6705'] || 0

  // Differenza A-B (EBITDA-like)
  const costiProduzione = (ceMap.materie_prime + ceMap.servizi + ceMap.godimento_beni_terzi +
    ceMap.totale_personale + ceMap.totale_ammortamenti + ceMap.variazione_rimanenze + ceMap.oneri_diversi)
  ceMap.differenza_ab = Math.round((valoreProduzione - costiProduzione) * 100) / 100
  // Imposte sul reddito: mastro 93 (prima era scritto fisso 0).
  ceMap.imposte = ceMacro['93'] || 0

  Object.entries(ceMap).forEach(([key, amount]) => {
    records.push({
      company_id: companyId, year, period_type: periodType,
      section: 'conto_economico', account_code: key,
      account_name: key.replace(/_/g, ' '),
      amount, sort_order: 950,
    })
  })

  return records
}

/**
 * Anno di fine del periodo del documento («PERIODO DAL 01/07/2025 AL 30/06/2026»
 * → 2026). «AL» come parola intera: dentro «DAL» c'e' «AL», e prima si leggeva
 * l'anno di inizio. Null se il periodo non c'e'.
 */
export function annoFinePeriodo(period: string | null | undefined): number | null {
  const m = /\bAL\s+\d{1,2}\/\d{1,2}\/(\d{4})/i.exec(period || '')
  return m ? Number(m[1]) : null
}

/**
 * Valore della produzione (A): i mastri 5x dei ricavi (51 vendite, 59 altri
 * ricavi e proventi). Il TOTALE della stampa e' «a pareggio» e comprende la
 * perdita: senza mastri 5x si usa quello, tolta l'eventuale perdita.
 * Usato dall'import (toSupabaseRecords) e dal caricamento in Conto Economico.
 */
export function valoreDellaProduzione(parsed: BilancioParsed): number {
  const t = parsed.contoEconomico.totals
  const macro = parsed.contoEconomico.ricavi.filter(r => r.isMacro && /^5\d$/.test(r.code))
  if (macro.length) return Math.round(macro.reduce((a, r) => a + r.amount, 0) * 100) / 100
  const perdita = Math.max(0, -(t.risultato || 0))
  return Math.round(((t.ricavi || 0) - perdita) * 100) / 100
}
