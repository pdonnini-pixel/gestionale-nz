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

    // Group by Y (rows) with snap
    const rows: Record<number, Array<{ text: string; x: number; y: number }>> = {}
    items.forEach(i => {
      const ry = Math.round(i.y / 4) * 4
      if (!rows[ry]) rows[ry] = []
      rows[ry].push(i)
    })

    // Process rows top to bottom
    const sortedYs = Object.keys(rows).sort((a, b) => Number(b) - Number(a))

    for (const y of sortedYs) {
      const cells = rows[Number(y)].sort((a, b) => a.x - b.x)
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

      if (/(?:Perdita|Utile)\b/i.test(fullLine) && !/Utile.*netto/i.test(fullLine)) {
        const amt = fullLine.match(/([\d.,]+)/)?.[1]
        if (amt) {
          const val = parseItalianNumber(amt)
          if (currentSection === 'patrimoniale') {
            result.patrimoniale.totals.risultato = /Perdita/i.test(fullLine) ? -val : val
          } else if (currentSection === 'conto_economico') {
            result.contoEconomico.totals.risultato = /Perdita/i.test(fullLine) ? -val : val
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
        if (leftRow) result.contoEconomico.costi.push(leftRow)
        if (rightRow) result.contoEconomico.ricavi.push(rightRow)
      }
    }
  }

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

  // Totali (righe speciali)
  const t = parsed.contoEconomico.totals
  if (t.costi) {
    records.push({
      company_id: companyId, year, period_type: periodType,
      section: 'conto_economico', account_code: 'totale_costi_produzione',
      account_name: 'Totale costi', amount: t.costi, sort_order: 900,
    })
  }
  if (t.ricavi) {
    records.push({
      company_id: companyId, year, period_type: periodType,
      section: 'conto_economico', account_code: 'ricavi_vendite',
      account_name: 'Valore della produzione', amount: t.ricavi, sort_order: 901,
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
  const ceMacro: Record<string, number> = {}
  const pCE = parsed.contoEconomico
  pCE.costi.forEach((row: BilancioRow) => {
    if (row.isMacro) ceMacro[row.code] = row.amount
  })
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
  const ricaviTotale = t.ricavi || 0
  const costiProduzione = (ceMap.materie_prime + ceMap.servizi + ceMap.godimento_beni_terzi +
    ceMap.totale_personale + ceMap.totale_ammortamenti + ceMap.variazione_rimanenze + ceMap.oneri_diversi)
  ceMap.differenza_ab = Math.round((ricaviTotale - costiProduzione) * 100) / 100
  ceMap.imposte = 0 // not in this bilancio (loss)

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
