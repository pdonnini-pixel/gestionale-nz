// Documenti della banca: la porta unica da cui Sabrina carica tutto (R27, R28
// in RICONCILIAZIONE_REGOLE.md).
//
// Qui c'e' solo logica pura e testata: riconoscere che documento e' arrivato
// (dal contenuto, non dal nome del file), a quale conto appartiene (dall'IBAN
// scritto nel documento), quali saldi dichiara, e preparare le righe per la
// funzione del database `apply_bank_statement`, che le confronta coi movimenti
// e applica la regola «l'estratto comanda».
//
// Il file lo legge la pagina (SheetJS per Excel, extractPdfLines per PDF): qui
// arrivano righe di testo e celle.

import { parseEcAoa, parseEcLines, parseAmountCell, type EcParsed, type EcRow } from './estrattoConto'
import { detectIssuer } from './cartaEstratto'
import { tipoEstratto } from './acquirerFees'
import { extractBeneficiary } from './reconcileMatch'

export type TipoDocumento = 'estratto_conto' | 'estratto_carta' | 'distinta_riba' | 'commissioni' | 'sconosciuto'

export const ETICHETTA_TIPO: Record<TipoDocumento, string> = {
  estratto_conto: 'Estratto conto corrente',
  estratto_carta: 'Estratto carta',
  distinta_riba: 'Distinta RiBa',
  commissioni: 'Estratto commissioni Nexi/Amex',
  sconosciuto: 'Documento non riconosciuto',
}

export type ContoLite = {
  id: string
  bank_name: string | null
  iban: string | null
  account_name: string | null
  account_type?: string | null
  acube_account_uuid?: string | null
  is_active?: boolean | null
}

const norm = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim()

/** IBAN senza spazi, maiuscolo. */
export const normIban = (s: string | null | undefined): string => String(s ?? '').replace(/[\s-]/g, '').toUpperCase()

// IBAN italiano: IT + 2 cifre di controllo + CIN + ABI(5) + CAB(5) + conto(12).
// Le banche lo stampano spesso a gruppi di quattro, quindi gli spazi sono ammessi.
const RE_IBAN_IT = /I\s*T\s*\d\s*\d\s*[A-Z](?:\s*\d){10}(?:\s*[0-9A-Z]){12}/gi

/** Tutti gli IBAN italiani che compaiono nel testo, normalizzati. */
export function ibanNelTesto(testo: string): string[] {
  const out = new Set<string>()
  for (const m of String(testo || '').matchAll(RE_IBAN_IT)) out.add(normIban(m[0]))
  return [...out]
}

/**
 * Il conto a cui appartiene il documento, dall'IBAN scritto dentro.
 *
 * Su NZ lo stesso IBAN compare su due righe di `bank_accounts` (una collegata
 * all'open banking, una rimasta dal primo caricamento): si preferisce quella
 * collegata, poi quella attiva. Se l'IBAN non c'e' o non corrisponde a nessun
 * conto torna null, e la pagina chiede di scegliere: non si indovina.
 */
export function trovaConto(testo: string, conti: ContoLite[]): ContoLite | null {
  const ibans = ibanNelTesto(testo)
  if (ibans.length === 0) return null
  const candidati = conti.filter((c) => {
    const a = normIban(c.iban)
    const b = normIban(c.account_name)
    return ibans.some((i) => i === a || i === b)
  })
  if (candidati.length === 0) return null
  const punteggio = (c: ContoLite) => (c.acube_account_uuid ? 2 : 0) + (c.is_active === false ? 0 : 1)
  return [...candidati].sort((x, y) => punteggio(y) - punteggio(x))[0]
}

// Distinte RiBa MPS: «Distinta Di Ritiro Effetti Pagati», «Effetti - Disposizioni».
const RE_DISTINTA = /DISTINTA\s+DI\s+RITIRO\s+EFFETTI|RITIRO\s+EFFETTI\s+PAGATI|EFFETTI\s*-\s*DISPOSIZIONI|DISTINTA\s+(?:RI\.?\s*BA|EFFETTI)/i

/**
 * Che documento e', letto dal contenuto.
 *
 * Ordine: la distinta e le commissioni hanno intestazioni inconfondibili; un
 * estratto conto corrente si riconosce perche' porta l'IBAN di un nostro conto
 * e righe «data · causale · importo»; una carta dal lettore delle carte.
 */
export function classificaDocumento(p: {
  testo: string
  righe: string[]
  conto: ContoLite | null
  righeEstratto: number
}): TipoDocumento {
  if (RE_DISTINTA.test(p.testo)) return 'distinta_riba'
  if (tipoEstratto(p.righe)) return 'commissioni'
  if (p.conto && p.righeEstratto > 0) return 'estratto_conto'
  if (detectIssuer(p.righe) !== 'generico') return 'estratto_carta'
  if (/ESTRATTO\s+CONTO\s+CARTA|CARTA\s+DI\s+CREDITO|CARTA\s+PREPAGATA/i.test(p.testo) && !p.conto) return 'estratto_carta'
  if (p.righeEstratto > 0) return 'estratto_conto'
  return 'sconosciuto'
}

// Saldi dichiarati. Le banche li scrivono in tanti modi: si accetta solo una
// riga che dice esplicitamente «saldo iniziale/finale» (o «precedente»,
// «contabile al») e porta un importo. Se non si trova, si torna null: meglio
// nessuna quadratura sul documento che una quadratura su un numero sbagliato.
const RE_SALDO_INIZ = /SALDO\s+(?:CONTABILE\s+)?(?:INIZIALE|PRECEDENTE|DI\s+APERTURA|INIZIO\s+PERIODO)/i
const RE_SALDO_FIN = /SALDO\s+(?:CONTABILE\s+)?(?:FINALE|DI\s+CHIUSURA|FINE\s+PERIODO)/i
const RE_IMPORTO = /-?\d{1,3}(?:\.\d{3})*,\d{2}-?/g

const ultimoImporto = (riga: string): number | null => {
  const tutti = riga.match(RE_IMPORTO)
  if (!tutti || tutti.length === 0) return null
  let t = tutti[tutti.length - 1]
  // Alcune banche mettono il segno meno in coda: «1.234,56-».
  if (t.endsWith('-')) t = '-' + t.slice(0, -1)
  return parseAmountCell(t)
}

export function saldiDichiarati(righe: string[]): { iniziale: number | null; finale: number | null } {
  let iniziale: number | null = null
  let finale: number | null = null
  for (const raw of righe) {
    const r = norm(raw)
    if (iniziale == null && RE_SALDO_INIZ.test(r)) iniziale = ultimoImporto(r)
    else if (RE_SALDO_FIN.test(r)) finale = ultimoImporto(r) ?? finale
  }
  return { iniziale, finale }
}

/** Mese a cui si riferisce l'estratto: quello con piu' righe. */
export function periodoDelle(righe: Array<{ date: string }>): { year: number; month: number } | null {
  if (righe.length === 0) return null
  const conta = new Map<string, number>()
  for (const r of righe) {
    const k = r.date.slice(0, 7)
    conta.set(k, (conta.get(k) ?? 0) + 1)
  }
  const [k] = [...conta.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]
  return { year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) }
}

export type RigaPerDb = {
  row_no: number
  date: string
  value_date: string | null
  amount: number
  sign_known: boolean
  description: string
  flusso_cbi: string | null
  beneficiario: string | null
}

/**
 * Le righe nel formato di `apply_bank_statement`.
 * Dal PDF il segno (dare/avere) non si legge: sign_known=false, e il database
 * confronta l'importo in valore assoluto e non inserisce righe senza segno.
 */
export function righePerDb(parsed: EcParsed, dalPdf: boolean): RigaPerDb[] {
  return parsed.rows.map((r: EcRow, i: number) => ({
    row_no: i + 1,
    date: r.date,
    value_date: r.value_date,
    amount: dalPdf ? Math.abs(r.amount) : r.amount,
    sign_known: !dalPdf,
    description: r.description,
    flusso_cbi: r.flusso_cbi,
    beneficiario: extractBeneficiary(r.description) || null,
  }))
}

/** Tutte le celle di un foglio come righe di testo, per cercarci IBAN e saldi. */
export function righeDaFoglio(aoa: unknown[][]): string[] {
  return aoa.map((r) => (r ?? []).map((c) => (c instanceof Date ? '' : norm(c))).filter(Boolean).join(' ')).filter(Boolean)
}

/** Lettura di un estratto conto: dal foglio Excel che produce piu' righe, o dal PDF. */
export function leggiEstratto(p: { fogli?: unknown[][][]; righePdf?: string[] }): EcParsed {
  if (p.righePdf) return parseEcLines(p.righePdf)
  let migliore: EcParsed = { rows: [], columns: null, warnings: [] }
  for (const aoa of p.fogli ?? []) {
    const q = parseEcAoa(aoa)
    if (q.rows.length > migliore.rows.length) migliore = q
  }
  return migliore
}

export type EsitoApplicazione = {
  righe: number
  confermati: number
  corretti: number
  inseriti: number
  ambigui: number
  altro_conto: number
  non_inseriti: number
  domande_nuove: number
  quadratura?: {
    periodo_da?: string
    periodo_a?: string
    saldo_iniziale?: number | null
    saldo_finale?: number | null
    scarto_documento?: number | null
    scarto_gestionale?: number | null
  }
}

const eur = (n: number): string => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

/**
 * L'esito in una frase, per Sabrina: cosa e' stato fatto, senza sigle.
 * Esempio: «412 movimenti: 405 gia' a posto, 3 date corrette, 2 inseriti. Torna al centesimo.»
 */
export function fraseEsito(e: EsitoApplicazione): string {
  const pezzi: string[] = []
  pezzi.push(`${e.confermati} già a posto`)
  if (e.corretti) pezzi.push(`${e.corretti} ${e.corretti === 1 ? 'corretto' : 'corretti'} come dice la banca`)
  if (e.inseriti) pezzi.push(`${e.inseriti} ${e.inseriti === 1 ? 'aggiunto' : 'aggiunti'} perché mancavano`)
  if (e.non_inseriti) pezzi.push(`${e.non_inseriti} non ${e.non_inseriti === 1 ? 'aggiunto' : 'aggiunti'}`)
  let frase = `${e.righe} movimenti: ${pezzi.join(', ')}.`
  const scarto = e.quadratura?.scarto_gestionale
  if (scarto === 0) frase += ' Il periodo torna al centesimo.'
  else if (typeof scarto === 'number') frase += ` Scarto sul periodo: ${eur(scarto)}.`
  if (e.domande_nuove) frase += ` ${e.domande_nuove === 1 ? 'Una cosa da chiederti' : `${e.domande_nuove} cose da chiederti`} qui sotto.`
  return frase
}
