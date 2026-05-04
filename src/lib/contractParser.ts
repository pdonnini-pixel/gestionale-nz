/**
 * Parser contratti outlet italiani
 * Estrae dati strutturati da testo di contratti di affitto ramo d'azienda
 */

// Helper: trova una data nel testo
function findDate(text: string, pattern: string): string | null {
  // Pattern: "12 marzo 2026" o "12/03/2026" o "2026-03-12"
  const mesi: Record<string, string> = {
    'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04',
    'maggio': '05', 'giugno': '06', 'luglio': '07', 'agosto': '08',
    'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12'
  }

  // Cerca dopo il pattern
  const idx = text.toLowerCase().indexOf(pattern.toLowerCase())
  if (idx === -1) return null

  const chunk = text.substring(idx, idx + 200)

  // "12 marzo 2026"
  const itMatch = chunk.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i)
  if (itMatch) {
    const day = itMatch[1].padStart(2, '0')
    const month = mesi[itMatch[2].toLowerCase()]
    return `${itMatch[3]}-${month}-${day}`
  }

  // "2 aprile 2026"
  const itMatch2 = chunk.match(/(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i)
  if (itMatch2) {
    const day = itMatch2[1].padStart(2, '0')
    const month = mesi[itMatch2[2].toLowerCase()]
    return `${itMatch2[3]}-${month}-${day}`
  }

  return null
}

// Estrae gli allegati menzionati nel contratto
function findAllegati(text: string): Array<{ code: string; description: string }> {
  const allegati: Array<{ code: string; description: string }> = []
  const seen = new Set<string>()

  // Pattern: allegato "A", allegato A, Allegato "B"
  const matches = text.matchAll(/[Aa]llegato\s*"?([A-Z])"?\s*(?:[-(]([^)"\n]{5,80}))?/g)
  for (const m of matches) {
    const code = m[1]
    if (!seen.has(code)) {
      seen.add(code)
      const desc = m[2] ? m[2].trim().replace(/[,.]$/, '') : ''
      allegati.push({ code, description: desc })
    }
  }

  // Cerca anche "Condizioni Generali"
  if (text.includes('Condizioni Generali')) {
    if (!allegati.find(a => a.description?.includes('Condizioni'))) {
      allegati.push({ code: 'CG', description: 'Condizioni Generali' })
    }
  }

  // Cerca "Regolamento"
  if (text.includes('Regolamento immobiliare') || text.includes('Regolamento dell')) {
    allegati.push({ code: 'REG', description: 'Regolamento immobiliare e commerciale' })
  }

  return allegati
}

/**
 * Analizza il testo di un contratto e restituisce dati strutturati
 */
export function parseContract(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    // Anagrafica
    name: null,
    brand: null,
    outlet_type: 'outlet',
    sqm: null,
    sell_sqm: null,
    unit_code: null,
    // Location
    mall_name: null,
    concedente: null,
    address: null,
    city: null,
    province: null,
    // Contratto
    delivery_date: null,
    opening_date: null,
    contract_duration_months: null,
    contract_min_months: null,
    rent_free_days: null,
    // Canone
    rent_annual: null,
    rent_per_sqm: null,
    variable_rent_pct: null,
    rent_year2_annual: null,
    rent_year3_annual: null,
    // Garanzie
    deposit_guarantee: null,
    advance_payment: null,
    // Allegati
    allegati: [] as Array<{ code: string; description: string }>,
    // Confidence
    confidence: {} as Record<string, number>,
  }

  if (!text || text.length < 100) return result

  // Normalizza testo PDF: comprimi spazi multipli, normalizza punteggiatura
  const t = text
    .replace(/[''ʼ]/g, "'")
    .replace(/[""«»]/g, '"')
    .replace(/[ \t]+/g, ' ')          // comprimi spazi orizzontali
    .replace(/ ?\n ?/g, '\n')         // pulisci spazi attorno a newline

  // Helper per parsing importi euro in vari formati
  function parseEuro(str: string | null | undefined): number | null {
    if (!str) return null
    return parseFloat(str.replace(/\./g, '').replace(',', '.'))
  }

  // === CONCEDENTE ===
  const concPatterns = [
    // "NOME S.P.A." (concedente) — formato notarile
    /"([^"]{3,50}(?:S\.?P\.?A\.?|S\.?R\.?L\.?|SPA|SRL))"\s*\(concedente\)/i,
    // "NOME SPA" ... denominata "Concedente"
    /"([^"]{3,50}(?:S\.?P\.?A\.?|S\.?R\.?L\.?|SPA|SRL)[^"]*)"\s*[\s\S]{0,200}?(?:denominat[oa]|infra\s+denominat)[\s\S]{0,40}?"?Concedente"?/i,
    // società "NOME" ... Concedente
    /societ[àa]\s+"([^"]{3,50})"\s*[\s\S]{0,200}?(?:denominat[oa]|infra)[\s\S]{0,40}?"?Concedente"?/i,
    // Concedente ... "NOME SPA"
    /(?:Concedente|concedente)[\s\S]{0,100}?"([^"]{3,50}(?:S\.?P\.?A\.?|S\.?R\.?L\.?|SPA|SRL)[^"]*)"/i,
  ]
  for (const re of concPatterns) {
    const m = t.match(re)
    if (m) {
      // Pulisci testo contaminato da timbri di registrazione
      let name = m[1].trim()
        .replace(/\s*(?:REGISTRATO|al\s+N\.\s*\d+|serie\s+\w+|in\s+data\s+[\d-]+|€\s*[\d.,]+)\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      result.concedente = name
      break
    }
  }

  // === MALL/COMPLESSO ===
  const mallPatterns = [
    /(?:denominat[oa]|indicat[oa]\s+come|presso\s+il)\s+(?:complesso\s+immobiliare\s+)?[""]([A-Z][a-zA-Zà-ú\s]+(?:Outlet|Village|Mall|Center|Centre|Park|Factory)[^"",\n]{0,30})[""]?/i,
    /complesso\s+(?:immobiliare|commerciale)\s+(?:denominato\s+)?[""]([^""]{5,50}?)[""](?:\s*(?:sito|ubicato|in\s+Comune))/i,
    /(?:Outlet|Village|Mall|Center)\s+(?:di\s+)?([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-Za-zà-ú]+){0,3})/i,
  ]
  for (const re of mallPatterns) {
    const m = t.match(re)
    if (m) { result.mall_name = m[1].trim(); break }
  }

  // === CITTÀ / PROVINCIA / INDIRIZZO ===
  // Pattern generico: "Comune di CITTÀ (PROV)" o "sito in CITTÀ (PROV)" o "ubicata in CITTÀ (PROV)"
  const cityPatterns = [
    /[Cc]omune\s+di\s+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?)?)\s*\(([A-Z]{2})\)/,
    /(?:sit[oa]|ubicat[oa]|che\s+si\s+trova)\s+(?:nel\s+Comune\s+di\s+|in\s+)([A-ZÀ-Ú][a-zà-ú]+(?:\s+[a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+)?)?)\s*\(([A-Z]{2})\)/,
  ]
  for (const re of cityPatterns) {
    const m = t.match(re)
    if (m && !result.city) {
      const cityName = m[1].trim()
      result.city = cityName
      result.province = m[2]
      // Estrai nome outlet dalla città
      if (!result.name) result.name = cityName.toUpperCase()
    }
  }

  // Indirizzo: via/corso/piazza dopo la città
  if (typeof result.city === 'string' && result.city) {
    const addrRe = new RegExp(result.city + '[^]*?(?:,\\s*)?([Vv]ia|[Cc]orso|[Pp]iazza|[Ll]argo|[Vv]iale|[Ss]trada)\\s+([^,\\n]{3,60})', 'i')
    const addrM = t.match(addrRe)
    if (addrM) result.address = (addrM[1] + ' ' + addrM[2]).trim()
  }

  // === BRAND/INSEGNA ===
  const brandPatterns = [
    /(?:insegna|marchio)\s+(?:e\s+con\s+insegna\s+)?[""]?([A-Z][A-Z\s]{1,25})[""]?[.,;\s]/,
    /con\s+insegna\s+[""]([^""]{2,25})[""]?/i,
  ]
  for (const re of brandPatterns) {
    const m = t.match(re)
    if (m) { result.brand = m[1].trim(); break }
  }

  // === SUPERFICI (mq) ===
  const sqmPatterns = [
    /(?:Superficie\s+Lorda\s+di\s+Pavimento|SLP)[\s\S]{0,80}?(?:(?:pari\s+a|di)\s+(?:circa\s+)?)?(?:mq\.?\s*|metri\s+quadrati\s+)?(\d+[\.,]?\d*)/i,
    /(?:metri\s+quadrati|mq\.?)\s+(\d+[\.,]\d+)\s*\(/i,
    /(?:di|pari\s+a)\s+(?:circa\s+)?(?:mq\.?\s*)?(\d+[\.,]\d+)\s*\([^)]+\)\s*(?:,\s*)?(?:ubicat|compres)/i,
    /unit[àa][\s\S]{0,200}?(?:di\s+)?(?:metri\s+quadrati|mq\.?)\s+(\d+[\.,]\d+)/i,
  ]
  for (const re of sqmPatterns) {
    const m = t.match(re)
    if (m) {
      const val = parseFloat(m[1].replace(',', '.'))
      if (val > 10 && val < 10000) {
        result.sqm = Math.round(val)
        break
      }
    }
  }

  // Superficie vendita (spesso distinta dalla SLP)
  const svMatch = t.match(/[Ss]uperficie\s+di\s+[Vv]endita[\s\S]{0,80}?(?:mq\.?\s*)?(\d+[\.,]?\d*)/i)
  if (svMatch) result.sell_sqm = Math.round(parseFloat(svMatch[1].replace(',', '.')))

  // === UNITÀ ===
  const unitPatterns = [
    /(?:unit[àa]|porzione\s+immobiliare)\s*(?:identificata\s+con\s+)?(?:il\s+)?(?:numero|n\.?°?)\s*(\d+[A-Z]?)/i,
    /unit[àa]\s*\(\s*l['"]\s*"?Unit[àa]"?\s*\)\s*identificata\s+con\s+il\s+numero\s+(\d+)/i,
  ]
  for (const re of unitPatterns) {
    const m = t.match(re)
    if (m) { result.unit_code = m[1]; break }
  }

  // === DATE ===
  const mesi: Record<string, string> = { 'gennaio': '01', 'febbraio': '02', 'marzo': '03', 'aprile': '04', 'maggio': '05', 'giugno': '06', 'luglio': '07', 'agosto': '08', 'settembre': '09', 'ottobre': '10', 'novembre': '11', 'dicembre': '12' }

  function findDateFlex(text: string, ...keywords: string[]): string | null {
    for (const kw of keywords) {
      const d = findDate(text, kw)
      if (d) return d
    }
    return null
  }

  result.delivery_date = findDateFlex(t, 'consegnato in data', 'Data di Consegna', 'data di consegna', 'consegna')

  // Data apertura
  result.opening_date = findDateFlex(t, 'data di apertura', 'aprire', 'apertura')
  if (!result.opening_date) {
    const aperturaMatch = t.match(/(?:aprire|apertura)[\s\S]{0,80}?(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i)
    if (aperturaMatch) {
      result.opening_date = `${aperturaMatch[3]}-${mesi[aperturaMatch[2].toLowerCase()]}-${aperturaMatch[1].padStart(2, '0')}`
    }
  }

  // Data contratto (primo atto/scrittura)
  if (!result.delivery_date) {
    const scrittura = t.match(/(?:scrittura\s+privata|contratto)[\s\S]{0,100}?(?:in\s+data|del)\s+(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i)
    if (scrittura) {
      result.delivery_date = `${scrittura[3]}-${mesi[scrittura[2].toLowerCase()]}-${scrittura[1].padStart(2, '0')}`
    }
  }

  // === DURATA ===
  const durataPatterns = [
    /scadr[àa]\s+trascorsi\s+(\d+)\s*\([^)]+\)\s*anni/i,
    /durata\s+(?:di|pari\s+a)\s+(\d+)\s*\([^)]+\)\s*anni/i,
    /per\s+(?:la\s+)?durata\s+di\s+anni\s+(\d+)/i,
  ]
  for (const re of durataPatterns) {
    const m = t.match(re)
    if (m) { result.contract_duration_months = parseInt(m[1]) * 12; break }
  }

  // Durata in mesi
  if (!result.contract_duration_months) {
    const mesiMatch = t.match(/durata\s+(?:di\s+)?(\d+)\s*\([^)]+\)\s*mesi/i)
    if (mesiMatch) result.contract_duration_months = parseInt(mesiMatch[1])
  }

  const minMatch = t.match(/[Dd]urata\s+minima[\s\S]{0,50}?(\d+)\s*\([^)]+\)\s*mesi/i)
  if (minMatch) result.contract_min_months = parseInt(minMatch[1])

  // === GIORNI GRATUITI ===
  const freePatterns = [
    /primi\s+(\d+)\s*\([^)]+\)\s*giorni[\s\S]{0,50}?nulla\s+sar[àa]\s+dovuto/i,
    /(\d+)\s*\([^)]+\)\s*giorni\s+(?:gratuit|free|franchi)/i,
  ]
  for (const re of freePatterns) {
    const m = t.match(re)
    if (m) { result.rent_free_days = parseInt(m[1]); break }
  }

  // === CANONE ===
  const canonePatterns = [
    /Canone\s+Annuo\s+Garantito[\s\S]{0,100}?(?:pari\s+(?:ad?\s+)?)?[Ee]uro\s+([\d.,]+)/i,
    /canone[\s\S]{0,60}?(?:annuo|annuale)[\s\S]{0,60}?[Ee]uro\s+([\d.,]+)/i,
    /[Cc]anone\s+per\s+il\s+primo\s+anno[\s\S]{0,80}?[Ee]uro\s+([\d.,]+)/i,
    /(?:somma\s+di\s+)?[Ee]uro\s+([\d.,]+)[\s\S]{0,80}?(?:corrispondente\s+al\s+)?[Cc]anone[\s\S]{0,30}?(?:primo\s+anno|annuo|annuale)/i,
    /1%[\s\S]{0,80}?(?:sulla\s+somma\s+di\s+)?[Ee]uro\s+([\d.,]+)[\s\S]{0,80}?[Cc]anone/i,
  ]
  for (const re of canonePatterns) {
    const m = t.match(re)
    if (m) {
      const val = parseEuro(m[1])
      if (val && val > 1000) { result.rent_annual = val; break }
    }
  }

  // €/mq
  const mqPatterns = [
    /[Ee]uro\s+([\d.,]+)[\s\S]{0,40}?per\s+mq/i,
    /([\d.,]+)\s*€?\s*(?:\/\s*)?mq/i,
  ]
  for (const re of mqPatterns) {
    const m = t.match(re)
    if (m) { result.rent_per_sqm = parseEuro(m[1]); break }
  }

  // Calcola €/mq se abbiamo canone e mq
  if (!result.rent_per_sqm && result.rent_annual && result.sqm) {
    result.rent_per_sqm = Math.round((result.rent_annual as number) / (result.sqm as number))
  }

  // % variabile
  const varMatch = t.match(/(\d+)\s*%?\s*(?:\([^)]+\)\s*)?(?:per\s+cento\s+)?del\s+[Vv]olume\s+(?:di\s+)?[Aa]ffari/i)
  if (varMatch) result.variable_rent_pct = parseInt(varMatch[1])

  // Anno 2 e 3
  const anno3Match = t.match(/anno\s+solare\s+202[89][\s\S]{0,50}?[Ee]uro\s+([\d.,]+)/i)
  if (anno3Match) result.rent_year3_annual = parseEuro(anno3Match[1])

  // === FIDEIUSSIONE / GARANZIA ===
  const fidPatterns = [
    /(?:fideiuss|garanzia\s+bancaria)[\s\S]{0,100}?[Ee]uro\s+([\d.,]+)/i,
    /[Ee]uro\s+([\d.,]+)[\s\S]{0,60}?(?:fideiuss|garanzia\s+bancaria)/i,
  ]
  for (const re of fidPatterns) {
    const m = t.match(re)
    if (m) { result.deposit_guarantee = parseEuro(m[1]); break }
  }

  // === ANTICIPO ===
  const antPatterns = [
    /anticipo[\s\S]{0,80}?[Ee]uro\s+([\d.,]+)/i,
    /[Ee]uro\s+([\d.,]+)[\s\S]{0,60}?(?:a\s+titolo\s+di\s+)?anticipo/i,
  ]
  for (const re of antPatterns) {
    const m = t.match(re)
    if (m) { result.advance_payment = parseEuro(m[1]); break }
  }

  // === CLAUSOLA RECESSO ===
  const exitPatterns = [
    /(?:quarantaduesimo|(\d+)°?)\s*mese[\s\S]{0,50}?(?:recedere|recesso)/i,
    /(?:recedere|recesso)[\s\S]{0,80}?(?:decorsi|trascorsi)\s+(\d+)\s*(?:\([^)]+\))?\s*mesi/i,
  ]
  for (const re of exitPatterns) {
    const m = t.match(re)
    if (m) {
      result.exit_clause_month = m[1] ? parseInt(m[1]) : (m[2] ? parseInt(m[2]) : 42)
      break
    }
  }

  // Soglia per recesso
  const sogliaMatch = t.match(/inferiore\s+ad?\s+[Ee]uro\s+([\d.,]+)[\s\S]{0,40}?(?:annui\s+)?per\s+metro\s+quadrato/i)
  if (sogliaMatch && result.sqm) {
    const eur = parseEuro(sogliaMatch[1])
    if (eur != null) result.exit_revenue_threshold = eur * (result.sqm as number)
  }

  // === ALLEGATI ===
  result.allegati = findAllegati(t)

  // === CONFIDENCE (quanti campi estratti) ===
  let found = 0
  let total = 0
  for (const [key, val] of Object.entries(result)) {
    if (key === 'allegati' || key === 'confidence' || key === 'outlet_type') continue
    total++
    if (val !== null && val !== '') found++
  }
  (result.confidence as Record<string, number>).extracted = found;
  (result.confidence as Record<string, number>).total = total;
  (result.confidence as Record<string, number>).pct = Math.round((found / total) * 100)

  return result
}

/**
 * Estrae testo da un file .doc (vecchio formato) lato client
 * Approccio best-effort: estrae stringhe leggibili dal binario
 */
export async function extractTextFromDoc(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  // Decodifica come latin-1 e filtra caratteri leggibili
  let text = ''
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if ((c >= 32 && c <= 126) || (c >= 192 && c <= 255) || c === 10 || c === 13 || c === 9) {
      text += String.fromCharCode(c)
    } else if (c === 0 && bytes[i + 1] >= 32) {
      // Skip null bytes in Unicode pairs
      continue
    } else {
      text += ' '
    }
  }

  // Pulisci spazi multipli
  text = text.replace(/ {3,}/g, '\n').replace(/\n{3,}/g, '\n\n')
  return text
}

/**
 * Estrae testo da un file .docx usando mammoth
 */
export async function extractTextFromDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const buffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value
}

/**
 * Estrae testo da un file .pdf usando pdfjs-dist
 * Ricostruisce righe e paragrafi usando le coordinate Y degli elementi
 */
export async function extractTextFromPdf(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')

  // Worker: usa il bundled worker da pdfjs-dist
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString()

  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    if (!content.items.length) continue

    // Ricostruisci il testo rispettando le coordinate Y (righe) e X (spazi)
    // Ogni item ha: str, transform[4]=x, transform[5]=y, height
    type PdfItem = { text: string; x: number; y: number; height: number }
    const items: PdfItem[] = (content.items as Array<{ str?: string; transform: number[]; height?: number }>)
      .filter(it => it.str !== undefined)
      .map(it => ({
        text: it.str ?? '',
        x: it.transform[4],
        y: Math.round(it.transform[5] * 10) / 10, // arrotonda per raggruppare
        height: it.height || 10,
      }))

    // Ordina per Y decrescente (alto→basso) poi X crescente (sinistra→destra)
    items.sort((a, b) => b.y - a.y || a.x - b.x)

    const lines: string[] = []
    let currentLine: PdfItem[] = []
    let lastY: number | null = null
    const lineThreshold = 3 // pixel di tolleranza per stessa riga

    for (const item of items) {
      if (lastY !== null && Math.abs(lastY - item.y) > lineThreshold) {
        // Nuova riga — salva la riga precedente
        lines.push(currentLine.sort((a, b) => a.x - b.x).map(i => i.text).join(' '))

        // Se il salto Y è grande (>1.5x altezza font), aggiungi riga vuota (paragrafo)
        if (lastY !== null && Math.abs(lastY - item.y) > item.height * 1.8) {
          lines.push('')
        }
        currentLine = []
      }
      currentLine.push(item)
      lastY = item.y
    }
    // Ultima riga
    if (currentLine.length) {
      lines.push(currentLine.sort((a, b) => a.x - b.x).map(i => i.text).join(' '))
    }

    pages.push(lines.join('\n'))
  }
  return pages.join('\n\n')
}
