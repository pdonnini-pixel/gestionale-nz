// Helper puri per la Prima Nota (export per il commercialista).
// Estratti da PrimaNota.tsx per essere testabili in isolamento (Vitest).
//
// Nascono dall'audit del 14/09/2026 (AUDIT_PRIMA_NOTA_COMMERCIALISTA_2026-09-14.md):
// su agosto 2026 l'export mostrava il fornitore su 56 righe su 757 e, dove un
// movimento saldava più fatture (RiBa del 31/08: 31 effetti in un addebito),
// ne teneva UNA sola, con fornitore e numero a caso. Qui ogni movimento porta
// TUTTE le fatture che salda, un tipo di movimento leggibile (fornitore, F24,
// stipendi, POS, versamento, carta, spese bancarie, finanziamento, giroconto)
// ricavato da aggancio, etichetta e causale, e per gli F24 il codice tributo.
//
// Regola della casa: il gestionale non chiede quello che può ricavare. Le
// letture della causale riusano quelle del motore di riconciliazione
// (reconcileMatch.ts), così le due pagine dicono la stessa cosa.

import { extractBeneficiary } from './reconcileMatch'

export type PnPayable = {
  invoice_number: string | null
  supplier_name: string | null
  supplier_vat: string | null
  gross_amount: number | null
  /** Dettaglio per il sottoinsieme fatture nei fogli per conto (facoltativi: non tutti i chiamanti li hanno). */
  invoice_date?: string | null
  amount_paid?: number | null
  installment_number?: number | null
  installment_total?: number | null
  /** Metodo di pagamento della scadenza (riba_30, bonifico_ordinario, …): serve a far capire le RiBa. */
  payment_method?: string | null
}

export type PnFiscalDeadline = {
  title: string | null
  f24_code: string | null
  tax_period: string | null
  deadline_type: string | null
}

export type PnMovement = {
  amount: number
  description: string | null
  reference: string | null
  category: string | null
  counterpart: string | null
  merchant_name: string | null
  counterpart_name?: string | null
  /** Nota del movimento: "Outlet: BRB · …" assegna a mano l'outlet (vedi outletCodeFromNote). */
  note?: string | null
  supplier?: { name: string | null; partita_iva: string | null } | null
  payables: PnPayable[]
  fiscal_deadlines: PnFiscalDeadline[]
}

export type MovementKind =
  | 'fornitore'
  | 'f24'
  | 'stipendi'
  | 'pos'
  | 'versamento'
  | 'carta'
  | 'finanziamento'
  | 'spese_banca'
  | 'giroconto'
  | 'incasso_cliente'
  | 'rimborso'
  | 'da_chiarire'

export const KIND_LABELS: Record<MovementKind, string> = {
  fornitore: 'Pagamento fornitore',
  f24: 'F24 / imposte',
  stipendi: 'Stipendi',
  pos: 'Incasso POS',
  versamento: 'Versamento contanti',
  carta: 'Carta di credito',
  finanziamento: 'Finanziamento',
  spese_banca: 'Spese e commissioni bancarie',
  giroconto: 'Giroconto / prelievo',
  incasso_cliente: 'Incasso cliente (bonifico)',
  rimborso: 'Rimborso / restituzione',
  da_chiarire: 'Da chiarire',
}

// Pattern sulla CAUSALE, che la banca scrive sempre (l'etichetta `category`
// invece manca su 87 movimenti di agosto 2026). Stessa cautela di
// reconcileMatch.ts: «CANONE» da solo non basta, un canone di locazione è un
// fornitore. L'ordine dei controlli conta: prima gli agganci (fattura, F24),
// poi la causale, poi l'etichetta.
const RE_F24 = /\bF24\b|\bI24\b|DELEGA UNIFICATA|DELEGHE MOD|IMPOSTE,?\s*TASSE|IMPOSTE\/TASSE/i
const RE_STIPENDI = /EMOLUMENT|STIPEND|SALARI\b/i
const RE_POS = /INCASSO TRAMITE P\.?O\.?S|ACCREDITO POS|PAGOBANCOMAT|NUMIA|AMERICAN EXPRESS|ACCREDITO PER INCASSI/i
const RE_VERSAMENTO = /VERS\.?\s*(CONTANT|SPORT)|VERSAMENTO (DA ATM|CONTANTE)|VERSAMENTO CONTANTE/i
const RE_CARTA = /CARTA DEL CREDITO COOPERATIVO|RICARICA CARTA|ADD\.?\s*DIRETTO CARTA|ADDEBITO DIRETTO CARTA|POSIZIONE CARTA|ESTRATTO CONTO CARTA|CARTA DI CREDITO/i
const RE_FINANZIAMENTO = /RATA DI MUTUO|RIMBORSO FINANZ|RATA FINANZ|MUTUO/i
const RE_SPESE_BANCA = /COMMISSION|COMM\.|COMM\/SPESE|CANONE RAPPORTO|CANONE SET DI BASE|CANONE HOME BANKING|CANONE MENSILE|FIDEJUSSION|FIDEIUSSION|FONDO DI GARANZIA|A FAVORE NEXI PAYMENTS|A FAVORE GLOBAL BLUE|SPESE TENUTA|BOLL[OI]\b|IMPOSTA DI BOLLO|COMPETENZE/i
const RE_GIROCONTO = /GIROCONTO|PASSAGGIO CONTANTI|PREL\.?\s*CONT|PRELEVAMENTO|COSTITUZIONE PEGNO/i
// SDD di servizi bancari (commissioni POS, rimborsi tax free): spese, non fornitori.
const RE_SDD_SERVIZI = /A FAVORE NEXI PAYMENTS|A FAVORE GLOBAL BLUE/i
// Un flusso CBI o un bonifico ha la STRUTTURA di un pagamento: se nessuno l'ha
// agganciato a una fattura resta «da chiarire», non diventa «spese bancarie»
// solo perché la causale cita le commissioni scorporate (IMPORTO COMMISSIONI).
const RE_TRANSFER = /IMPORTO BONIFICI|DISPOSIZIONE|BONIFICO|BEU INTERN BANK/i
// Bonifico in ENTRATA da un cliente privato per un acquisto in negozio o online
// (corrispettivo pagato con bonifico): "BON. IST./SEPA ... ORD: NOME ... RI: Acquisto merce".
const RE_BONIFICO_IN = /\bBON\.\s*(IST|SEPA)\b|BONIFICO/i
const RE_ACQUISTO = /ACQUIST|ABITO|MERCE|ORDINE|\bODL\b|TAGLIA|SPEDIZION/i
// Rimborso o restituzione in entrata (fornitore, corriere, assicurazione)
const RE_RIMBORSO = /RIMBORS|RESTITUZ|STORNO|LIQUIDAZIONE TRANSATTIVA|RIACCREDIT/i

const CATEGORY_KIND: Record<string, MovementKind> = {
  incassi_pos: 'pos',
  versamenti: 'versamento',
  stipendi: 'stipendi',
  tasse: 'f24',
  carte: 'carta',
  spese_banca: 'spese_banca',
  commissioni_incasso: 'spese_banca',
  finanziamenti: 'finanziamento',
  giroconti: 'giroconto',
  incassi_clienti: 'incasso_cliente',
  rimborsi_fornitori: 'rimborso',
  rimborsi: 'rimborso',
}

export function classifyMovement(m: PnMovement): MovementKind {
  if (m.payables.length > 0) return 'fornitore'
  if (m.fiscal_deadlines.length > 0) return 'f24'
  const d = String(m.description || '')
  if (RE_F24.test(d)) return 'f24'
  if (RE_STIPENDI.test(d)) return 'stipendi'
  if (RE_FINANZIAMENTO.test(d)) return 'finanziamento'
  if (RE_GIROCONTO.test(d)) return 'giroconto'
  if (RE_CARTA.test(d)) return 'carta'
  if (RE_SDD_SERVIZI.test(d)) return 'spese_banca'
  if (m.amount > 0 && RE_POS.test(d)) return 'pos'
  if (m.amount > 0 && RE_VERSAMENTO.test(d)) return 'versamento'
  if (RE_SPESE_BANCA.test(d) && !RE_TRANSFER.test(d)) return 'spese_banca'
  const byCat = m.category ? CATEGORY_KIND[m.category] : undefined
  if (byCat) return byCat
  // Entrate senza etichetta: un bonifico di un privato per un acquisto è un
  // corrispettivo pagato con bonifico; un rimborso o una restituzione è tale.
  // Si guarda la causale scritta dall'ordinante (dopo "RI:"), non l'intestazione
  // tecnica della banca ("BONIFICO PER ORDINE/CONTO" conterrebbe "ordine").
  const ri = /\bRI:\s*(.*)$/i.exec(d)?.[1] ?? d.replace(/BONIFICO PER ORDINE\/CONTO/i, '')
  if (m.amount > 0 && RE_BONIFICO_IN.test(d) && RE_RIMBORSO.test(ri)) return 'rimborso'
  if (m.amount > 0 && RE_BONIFICO_IN.test(d) && RE_ACQUISTO.test(ri)) return 'incasso_cliente'
  return 'da_chiarire'
}

// Fornitori distinti fra le fatture saldate dal movimento, per P.IVA (regola di
// progetto: l'identità del fornitore è la P.IVA, non il nome).
const distinctSuppliers = (ps: PnPayable[]): Array<{ name: string; vat: string }> => {
  const seen = new Map<string, { name: string; vat: string }>()
  for (const p of ps) {
    // Stessa P.IVA con o senza prefisso paese (IT01234567890 = 01234567890).
    const vat = String(p.supplier_vat || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/^[A-Z]{2}(?=\d)/, '')
    const name = String(p.supplier_name || '').trim()
    const key = vat.length >= 8 ? `VAT:${vat}` : `NAME:${name.toUpperCase()}`
    if (!seen.has(key)) seen.set(key, { name: name || vat, vat: String(p.supplier_vat || '').trim() })
  }
  return Array.from(seen.values())
}

export function counterpartOf(m: PnMovement): string {
  const sups = distinctSuppliers(m.payables)
  if (sups.length === 1) return sups[0].name
  if (sups.length > 1) return `${sups.length} fornitori (${m.payables.length} fatture)`
  if (m.supplier?.name) return m.supplier.name
  const fd = m.fiscal_deadlines[0]
  if (fd?.title) return fd.title
  const benef = extractBeneficiary(m.description || '')
  if (benef) return benef
  // Bonifico in entrata (MPS): "ORD: SCANU SABRINA BIC: …"
  const ord = /\bORD:\s*(.+?)\s+(?:BIC|IND|INF)\s*:/i.exec(m.description || '')
  if (ord) return ord[1].trim()
  if (m.counterpart_name) return m.counterpart_name
  if (m.counterpart) return m.counterpart
  if (m.merchant_name) return m.merchant_name
  return ''
}

/**
 * Outlet assegnato a mano nella nota del movimento, con la convenzione
 * "Outlet: CODICE · …" (es. "Outlet: BRB · corrispettivi Barberino agosto 2026").
 * Serve per i casi che solo una persona può sapere (bonifico di un cliente
 * privato per un acquisto in negozio) senza cambiare lo schema.
 */
export function outletCodeFromNote(note: string | null | undefined): string | null {
  const m = /^\s*Outlet:\s*([A-Za-z0-9_-]+)/i.exec(note ?? '')
  return m ? m[1].toUpperCase() : null
}

export function pivaOf(m: PnMovement): string {
  const sups = distinctSuppliers(m.payables)
  if (sups.length === 1) return sups[0].vat
  if (sups.length > 1) return ''
  return m.supplier?.partita_iva ?? ''
}

// Fattura pagata a ricevuta bancaria (riba, riba_30/60/90/120): lo studio la
// registra diversamente da un bonifico, quindi va fatta capire ovunque.
export const isRiba = (p: PnPayable): boolean => /^riba/i.test(String(p.payment_method ?? ''))
export const ribaCountOf = (m: PnMovement): number => m.payables.filter(isRiba).length

// Tipo movimento con la RiBa in chiaro: «Pagamento fornitore (RiBa)» quando
// tutte le fatture saldate sono a ricevuta bancaria, «(RiBa e altro)» se
// solo alcune lo sono.
export function tipoMovimentoOf(m: PnMovement): string {
  const kind = classifyMovement(m)
  const label = KIND_LABELS[kind]
  if (kind !== 'fornitore') return label
  const nRiba = ribaCountOf(m)
  if (nRiba === 0) return label
  return nRiba === m.payables.length ? `${label} (RiBa)` : `${label} (RiBa e altro)`
}

// Causale: tutte le fatture saldate (numero, e fornitore quando sono di più
// fornitori), oppure il dettaglio dell'F24 (titolo, codice tributo, periodo),
// altrimenti riferimento o causale bancaria. Le RiBa si vedono: «RiBa · Fatt. …»
// quando lo sono tutte, altrimenti «· RiBa» accanto alla singola fattura.
export function causaleOf(m: PnMovement): string {
  if (m.payables.length > 0) {
    const multi = distinctSuppliers(m.payables).length > 1
    const nRiba = ribaCountOf(m)
    const allRiba = nRiba === m.payables.length
    const parts = m.payables.map((p) => {
      const n = String(p.invoice_number || '').trim() || '?'
      const base = multi ? `${n} (${String(p.supplier_name || '').trim()})` : n
      return !allRiba && isRiba(p) ? `${base} · RiBa` : base
    })
    return `${allRiba ? 'RiBa · ' : ''}Fatt. ${parts.join('; ')}`
  }
  if (m.fiscal_deadlines.length > 0) {
    return m.fiscal_deadlines
      .map((f) => [f.title, f.f24_code ? `cod. ${f.f24_code}` : '', f.tax_period ? `periodo ${f.tax_period}` : ''].filter(Boolean).join(' · '))
      .join('; ')
  }
  if (m.reference) return m.reference
  if (m.description) return m.description
  return ''
}

export const invoiceCountOf = (m: PnMovement): number => m.payables.length

// Somma delle fatture saldate, per un controllo a colpo d'occhio con l'importo
// del movimento (nei flussi CBI la differenza è la commissione).
export const invoicesTotalOf = (m: PnMovement): number | null =>
  m.payables.length > 0 ? Math.round(m.payables.reduce((s, p) => s + (Number(p.gross_amount) || 0), 0) * 100) / 100 : null

export type PnRow = {
  'Data operazione': string
  /** Data contabile della banca (raw_data.extra.postingDate); vuota se non fornita. */
  'Data contabile': string
  'Conto Banca': string
  IBAN: string
  Tipo: 'Entrata' | 'Uscita'
  'Tipo movimento': string
  Importo: number
  Valuta: string
  Contropartita: string
  'P.IVA Contropartita': string
  'N. fatture': number | ''
  'Totale fatture': number | ''
  Causale: string
  Categoria: string
}

export type PnBankAccount = { bank_name: string; account_name: string | null; iban: string | null } | null | undefined

/**
 * Riga di export. `contropartita`, se passata, sostituisce quella letta dal
 * movimento: per POS e versamenti la pagina passa l'outlet di riferimento
 * (attribuito dal codice terminale o dalla parola chiave), che allo studio
 * dice più del testo della banca.
 */
export function buildRow(
  m: PnMovement & { transaction_date: string; posting_date?: string | null; currency: string | null; bank_accounts?: PnBankAccount },
  fmtDate: (d: string) => string,
  contropartita?: string,
): PnRow {
  const n = invoiceCountOf(m)
  const tot = invoicesTotalOf(m)
  return {
    'Data operazione': fmtDate(m.transaction_date),
    'Data contabile': m.posting_date ? fmtDate(m.posting_date) : '',
    'Conto Banca': m.bank_accounts ? `${m.bank_accounts.bank_name}${m.bank_accounts.account_name ? ' — ' + m.bank_accounts.account_name : ''}` : '',
    IBAN: m.bank_accounts?.iban ?? '',
    Tipo: m.amount > 0 ? 'Entrata' : 'Uscita',
    'Tipo movimento': tipoMovimentoOf(m),
    Importo: Math.abs(m.amount),
    Valuta: m.currency ?? 'EUR',
    Contropartita: contropartita || counterpartOf(m),
    'P.IVA Contropartita': pivaOf(m),
    'N. fatture': n > 0 ? n : '',
    'Totale fatture': tot ?? '',
    Causale: causaleOf(m),
    Categoria: m.category ?? '',
  }
}

export const PN_COLUMN_WIDTHS = [14, 14, 30, 30, 9, 22, 12, 6, 35, 16, 8, 12, 60, 18]

// Riepilogo per tipo di movimento (foglio «Riepilogo» dell'Excel e controllo a
// video): quante righe e quanto importo per ciascun tipo, entrate e uscite.
export function summarizeByKind(ms: PnMovement[]): Array<{ kind: MovementKind; label: string; n: number; entrate: number; uscite: number }> {
  const acc = new Map<MovementKind, { n: number; entrate: number; uscite: number }>()
  for (const m of ms) {
    const k = classifyMovement(m)
    const cur = acc.get(k) ?? { n: 0, entrate: 0, uscite: 0 }
    cur.n += 1
    if (m.amount > 0) cur.entrate += m.amount
    else cur.uscite += Math.abs(m.amount)
    acc.set(k, cur)
  }
  return (Object.keys(KIND_LABELS) as MovementKind[])
    .filter((k) => acc.has(k))
    .map((k) => {
      const v = acc.get(k)!
      return { kind: k, label: KIND_LABELS[k], n: v.n, entrate: Math.round(v.entrate * 100) / 100, uscite: Math.round(v.uscite * 100) / 100 }
    })
}
