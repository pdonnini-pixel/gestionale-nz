// Lettura del modello F24 preparato dallo studio paghe (PDF «… in scadenza il
// 16-10-2026 (prog.1) tipo Ordinario»).
//
// E' la delega vera: lo studio la trasmette con Entratel e la banca la addebita
// alla scadenza sul conto scritto in fondo al modulo. Il Prospetto paghe da' solo
// una stima (a settembre 2026 113,45 € in piu': la quota INPS e la TAXBENEFIT,
// che si paga fuori dall'F24), quindi quando c'e' il modello comanda il modello.
//
// Il PDF ha un modulo per pagina, tutti con la stessa intestazione
// («Azienda … Scadenza 16/10/2026 Cod.conto 000 Prog. 1 Pag. 3 Mod.invio …»).
// Il totale della delega e' la somma dei «SALDO FINALE» dei moduli. Ogni modulo
// si controlla da solo: la somma dei saldi di sezione (Erario, INPS, Regioni,
// tributi locali, altri enti) deve fare il saldo finale.
//
// Il testo arriva da pdf.js riga per riga (src/lib/pdfText.ts, extractPdfLines).
// Gli importi escono con la virgola staccata o persa: «31.216 80», «23.529 , 02».

export type SezioneF24 = 'erario' | 'inps' | 'regioni' | 'locali' | 'altri_enti'

export type ModuloF24 = {
  pagina: number
  saldo: number
  sezioni: Partial<Record<SezioneF24, number>>
  /** La somma dei saldi di sezione fa il saldo finale (al centesimo). */
  quadra: boolean
}

export type ModelloF24 = {
  scadenza: string // YYYY-MM-DD
  prog: number
  /** Mese dei contributi e delle ritenute: il mese prima della scadenza, YYYY-MM. */
  periodo: string
  modoInvio: string | null
  banca: string | null
  iban: string | null
  codiceFiscale: string | null
  contribuente: string | null
  moduli: ModuloF24[]
  totale: number
  sezioni: Partial<Record<SezioneF24, number>>
  /** Codici tributo e causali presenti, per sezione, in ordine di comparsa. */
  codici: Partial<Record<SezioneF24, string[]>>
  /** Tutti i moduli quadrano. */
  quadra: boolean
}

const RE_TESTA = /Scadenza\s+(\d{2})\/(\d{2})\/(\d{4}).*?Prog\.\s*(\d+)\s+Pag\.\s*(\d+)(?:\s+Mod\.invio\s+(.+))?/i
// Importo stampato dal modulo: «31.216 80», «31.216, 80», «23.529 , 02», «0 26».
const IMPORTO = String.raw`(\d{1,3}(?:\.\d{3})*)\s*,?\s*(\d{2})`
const RE_SALDO_FINALE = new RegExp(String.raw`EURO\s*([+-])\s*,?\s*` + IMPORTO)
const RE_TOTALE = new RegExp(String.raw`TOTALE\s+([ACEGIM])\b.*([+-])\s*,?\s*` + IMPORTO + String.raw`\s*,?\s*$`)
const SEZIONE_DI: Record<string, SezioneF24> = { A: 'erario', C: 'inps', E: 'regioni', G: 'locali', I: 'altri_enti', M: 'altri_enti' }

const num = (intero: string, cent: string): number => Number(intero.replace(/\./g, '')) + Number(cent) / 100
const r2 = (n: number): number => Math.round(n * 100) / 100

/** Il testo e' un modello F24 (delega di pagamento)? */
export function isModelloF24(righe: string[]): boolean {
  const t = righe.join(' ')
  return /MODELLO DI PAGAMENTO/i.test(t) && /DELEGA IRREVOCABILE/i.test(t) && RE_TESTA.test(t)
}

function sezioneDaRiga(r: string): SezioneF24 | null {
  if (/^SEZIONE ERARIO/i.test(r)) return 'erario'
  if (/^SEZIONE INPS/i.test(r)) return 'inps'
  if (/^SEZIONE REGIONI/i.test(r)) return 'regioni'
  if (/^SEZIONE IMU/i.test(r)) return 'locali'
  if (/^SEZIONE ALTRI ENTI/i.test(r)) return 'altri_enti'
  return null
}

// Codici di una riga di dettaglio, secondo la sezione.
function codiciDaRiga(sez: SezioneF24, r: string): string[] {
  if (sez === 'erario') {
    // «1001 0009 2026 12.824 60», «1631 2025 , 2.884 00», «IMPOSTE DIRETTE – IVA 1001 …»
    const m = r.match(/(?:^|\s)(\d{4})\s+(?:\d{4}\s+)?20\d{2}\b/)
    return m ? [m[1]] : []
  }
  if (sez === 'inps') {
    // «0500 DM10 0505543781 09 2026 …»
    const m = r.match(/^\d{4}\s+([A-Z][A-Z0-9]{2,5})\s+\S+\s+\d{2}\s+20\d{2}/)
    return m ? [m[1]] : []
  }
  if (sez === 'regioni') {
    // «0 8 3802 0009 2026 328 11»
    const m = r.match(/^\d\s\d\s(\d{4})\s+\d{4}\s+20\d{2}/)
    return m ? [m[1]] : []
  }
  if (sez === 'locali') {
    // «A 3 1 0 3845 0009 2026 23 50», «E 4 6 3 3797 2025 66 00»
    const m = r.match(/^[A-Z]\s\d\s\d\s\d\s(\d{4})\s+(?:\d{4}\s+)?20\d{2}/)
    return m ? [m[1]] : []
  }
  return []
}

/**
 * Legge il modello F24. Restituisce null se il testo non e' un modello F24 o se
 * non si trova nessun saldo finale.
 */
export function leggiModelloF24(righe: string[]): ModelloF24 | null {
  if (!isModelloF24(righe)) return null
  const moduli: ModuloF24[] = []
  const codici: Partial<Record<SezioneF24, string[]>> = {}
  let scadenza: string | null = null
  let prog: number | null = null
  let modoInvio: string | null = null
  let banca: string | null = null
  let codiceFiscale: string | null = null
  let contribuente: string | null = null
  let ibanPezzi: string | null = null

  let cur: ModuloF24 | null = null
  let sez: SezioneF24 | null = null
  let attesaSaldo = false
  let inIban = false

  for (const grezza of righe) {
    const r = grezza.replace(/\s+/g, ' ').trim()
    if (!r) continue
    const testa = r.match(RE_TESTA)
    if (testa) {
      scadenza = scadenza ?? `${testa[3]}-${testa[2]}-${testa[1]}`
      prog = prog ?? Number(testa[4])
      modoInvio = modoInvio ?? (testa[6]?.trim() || null)
      cur = { pagina: Number(testa[5]), saldo: 0, sezioni: {}, quadra: false }
      moduli.push(cur)
      sez = null; attesaSaldo = false; inIban = false
      continue
    }
    if (!cur) continue
    const banc = r.match(/DELEGA IRREVOCABILE A:\s*(.+)$/i)
    if (banc) { banca = banca ?? banc[1].trim(); continue }
    const cf = r.match(/^CODICE FISCALE\s+([0-9A-Z ]{11,40})$/i)
    if (cf && !codiceFiscale) { codiceFiscale = cf[1].replace(/\s/g, '').toUpperCase(); continue }
    const ana = r.match(/^DATI ANAGRAFICI\s+(.+)$/i)
    if (ana && !contribuente) { contribuente = ana[1].trim(); continue }

    const nuova = sezioneDaRiga(r)
    if (nuova) { sez = nuova; continue }

    const tot = r.match(RE_TOTALE)
    if (tot) {
      const s = SEZIONE_DI[tot[1]]
      const v = (tot[2] === '-' ? -1 : 1) * num(tot[3], tot[4])
      cur.sezioni[s] = r2((cur.sezioni[s] ?? 0) + v)
      continue
    }
    if (sez) {
      for (const c of codiciDaRiga(sez, r)) {
        const l = (codici[sez] ??= [])
        if (!l.includes(c)) l.push(c)
      }
    }

    if (/SALDO FINALE/i.test(r)) { attesaSaldo = true; continue }
    if (attesaSaldo) {
      const sf = r.match(RE_SALDO_FINALE)
      if (sf) {
        cur.saldo = (sf[1] === '-' ? -1 : 1) * num(sf[2], sf[3])
        attesaSaldo = false
      }
      continue
    }

    // IBAN di addebito: «Autorizzo addebito su», poi le lettere una per volta
    // su una o due righe, fino a «firma».
    if (/Autorizzo addebito su/i.test(r)) { inIban = true; ibanPezzi = ibanPezzi ?? ''; continue }
    if (inIban && ibanPezzi != null && ibanPezzi.length < 27) {
      const pulita = r.replace(/MOD\. F24.*?codice IBAN/i, ' ').replace(/\bfirma\b.*$/i, ' ')
      ibanPezzi += pulita.replace(/[^A-Z0-9]/gi, '').toUpperCase()
      if (/firma/i.test(r)) inIban = false
    }
  }

  if (!scadenza || prog == null || moduli.length === 0) return null
  for (const m of moduli) {
    const somma = r2(Object.values(m.sezioni).reduce((a, v) => a + (v ?? 0), 0))
    m.quadra = Math.abs(somma - m.saldo) < 0.005
  }
  if (moduli.every((m) => m.saldo === 0)) return null

  const sezioni: Partial<Record<SezioneF24, number>> = {}
  for (const m of moduli) {
    for (const [k, v] of Object.entries(m.sezioni) as [SezioneF24, number][]) sezioni[k] = r2((sezioni[k] ?? 0) + v)
  }
  const ibanMatch = ibanPezzi?.match(/IT\d{2}[A-Z]\d{10}[0-9A-Z]{12}/)
  const [y, mm] = scadenza.split('-').map(Number)
  const periodo = mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`

  return {
    scadenza, prog, periodo, modoInvio, banca,
    iban: ibanMatch ? ibanMatch[0] : null,
    codiceFiscale, contribuente, moduli,
    totale: r2(moduli.reduce((a, m) => a + m.saldo, 0)),
    sezioni, codici,
    quadra: moduli.every((m) => m.quadra),
  }
}

const NOME_SEZIONE: Record<SezioneF24, string> = {
  erario: 'Erario', inps: 'INPS', regioni: 'Regioni', locali: 'Tributi locali', altri_enti: 'Altri enti',
}

/** Codici in una riga sola, per la colonna «Codice F24» delle Scadenze fiscali. */
export function codiciF24InBreve(m: ModelloF24): string {
  return (Object.keys(NOME_SEZIONE) as SezioneF24[])
    .filter((s) => m.codici[s]?.length)
    .map((s) => (m.codici[s] as string[]).join('/'))
    .join(' · ')
}

/** Saldi per sezione in parole: «Erario 7.395,16 · INPS 23.529,02 · …». */
export function sezioniF24InBreve(m: ModelloF24): string {
  const eur = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (Object.keys(NOME_SEZIONE) as SezioneF24[])
    .filter((s) => m.sezioni[s] != null && m.sezioni[s] !== 0)
    .map((s) => `${NOME_SEZIONE[s]} ${eur(m.sezioni[s] as number)}`)
    .join(' · ')
}
