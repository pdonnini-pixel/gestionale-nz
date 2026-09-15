// Helper puri per il foglio «Incassi per outlet» della Prima Nota.
// Passo C dell'audit AUDIT_PRIMA_NOTA_COMMERCIALISTA_2026-09-14.md.
//
// Le entrate in banca (accrediti POS e Amex, versamenti di contante, altri
// bonifici) si attribuiscono al punto vendita SENZA chiedere niente a nessuno:
//   1. l'abbinamento con la chiusura di cassa, se il riscontro notturno l'ha
//      già fatto (closing_bank_matches: dal 01/09/2026 copre quasi tutto);
//   2. il codice terminale in causale (MPS "COD.SIA:6181087-00002", Amex
//      "618108700006 American Express", BCC/Numia "... 618108700010 ...")
//      confrontato con outlet_payment_channels.terminal_code, stesso tipo
//      (pos / pos_amex) e, a parità, stesso conto;
//   3. per i versamenti, la parola chiave del canale Contanti dell'outlet
//      (PALMANOVA, FOIANO, ATM 9750, cassa contin…, più parole separate da |).
// Le letture della causale sono la copia fedele delle funzioni SQL
// cash_bank_terminal_code / cash_bank_circuit / cash_bank_ref_date /
// cash_bank_is_deposit / cash_bank_norm_code (migration 188 e 192), così la
// prima nota e il riscontro delle chiusure dicono la stessa cosa. Su agosto
// 2026 NZ: 585 accrediti POS e 35 versamenti, tutti attribuiti.

export type PnChannel = {
  id: string
  outlet_id: string
  kind: string
  label: string
  terminal_code: string | null
  bank_account_id: string | null
  is_active: boolean
}

export type PnOutletInfo = { code: string | null; name: string }

export type PnClosingMatch = { outlet_id: string; closing_date: string; match_type: string }

export type PnIncassoMovement = {
  id: string
  transaction_date: string
  amount: number
  description: string | null
  category: string | null
  bank_account_id: string | null
  /** Nota del movimento: "Outlet: BRB · …" assegna l'outlet a mano. */
  note?: string | null
}

export type IncassiLookups = {
  channels: PnChannel[]
  outlets: Map<string, PnOutletInfo>
  /** Abbinamenti già fatti dal riscontro chiusure ↔ banca, per id movimento. */
  closingMatches: Map<string, PnClosingMatch>
  bankAccounts: Map<string, { bank_name: string; iban: string | null }>
}

export type IncassoKind = 'pos' | 'amex' | 'versamento' | 'bonifico' | 'altro'

export const INCASSO_KIND_LABELS: Record<IncassoKind, string> = {
  pos: 'POS',
  amex: 'Amex',
  versamento: 'Versamento contanti',
  bonifico: 'Bonifico cliente',
  altro: 'Altro incasso',
}

export type Attribuzione = 'nota' | 'chiusura' | 'terminale' | 'parola_chiave' | 'da_attribuire'

export const ATTRIBUZIONE_LABELS: Record<Attribuzione, string> = {
  nota: 'Assegnato a mano (nota)',
  chiusura: 'Chiusura di cassa',
  terminale: 'Codice terminale',
  parola_chiave: 'Parola chiave versamento',
  da_attribuire: 'Da attribuire',
}

/** Valore usato nei filtri a clic per le righe senza outlet. */
export const SENZA_OUTLET = '__senza_outlet__'

const D = (s: string | null | undefined): string => s ?? ''

// --- Parser della causale (copia di cash_bank_terminal_code, 188 + 192) ---

const RE_SIA = /COD\.?\s*SIA\s*:?\s*\d{5,}\s*-\s*(\d{5})/i
const RE_AMEX = /(\d{5})\s+American\s+Express/i
const RE_BCC = /(?:PagoBancomat|Numia\s+S\.?p\.?A\.?\s+\d+)\s+\d{1,2}\.\d{1,2}\.\d{2,4}\s*-?\s*\d{7,}(\d{5})(?!\d)/i

/** Ultime 5 cifre del codice terminale in causale; null se non è un accredito POS. */
export function terminalCodeOf(descr: string | null | undefined): string | null {
  const d = D(descr)
  return RE_SIA.exec(d)?.[1] ?? RE_AMEX.exec(d)?.[1] ?? RE_BCC.exec(d)?.[1] ?? null
}

/** Circuito dell'accredito (copia di cash_bank_circuit). */
export function circuitOf(descr: string | null | undefined): 'amex' | 'pos' | null {
  const d = D(descr)
  if (/American\s+Express/i.test(d)) return 'amex'
  if (/COD\.?\s*SIA/i.test(d)) return 'pos'
  if (/(PagoBancomat|Numia\s+S\.?p\.?A)/i.test(d)) return 'pos'
  return null
}

const iso = (y: string, m: string, d: string): string | null => {
  const yy = y.length === 2 ? 2000 + Number(y) : Number(y)
  const mm = Number(m); const dd = Number(d)
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

/** Giorno di vendita a cui l'accredito si riferisce (copia di cash_bank_ref_date). */
export function refDateOf(descr: string | null | undefined): string | null {
  const d = D(descr)
  let m = /DATA\s*RIF\.?\s*:?\s*(\d{2})\.(\d{2})\.(\d{2,4})/i.exec(d)
  if (m) return iso(m[3], m[2], m[1])
  m = /incassi\s+(\d{2})\.(\d{2})\.(\d{4})/i.exec(d)
  if (m) return iso(m[3], m[2], m[1])
  m = /(?:PagoBancomat|Numia\s+S\.?p\.?A\.?\s+\d+)\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\s*-?\s*\d{7,}/i.exec(d)
  if (m) return iso(m[3], m[2], m[1])
  return null
}

/** Versamento di contante (copia di cash_bank_is_deposit). */
export function isDeposit(descr: string | null | undefined): boolean {
  const d = D(descr)
  return /(VERSAMENTO|VERS\.|CASSA\s+CONTIN|\bATM\b|VERS\.?\s*SPORT)/i.test(d) && !/(BONIFICO|GIROCONTO|GIROC\.|STORNO)/i.test(d)
}

/** "6181087-00002", "00002", "2" → "00002" (copia di cash_bank_norm_code). */
export function normCode(code: string | null | undefined): string | null {
  const digits = D(code).replace(/\D/g, '')
  if (!digits) return null
  return digits.slice(-5).padStart(5, '0')
}

/** Natura dell'entrata, letta dalla causale. Un giroconto non è un incasso: lo esclude chi chiama. */
export function incassoKindOf(m: PnIncassoMovement): IncassoKind {
  const c = circuitOf(m.description)
  if (c === 'amex') return 'amex'
  if (c === 'pos' || terminalCodeOf(m.description)) return 'pos'
  if (isDeposit(m.description)) return 'versamento'
  if (/\bBON\.\s*(IST|SEPA)\b|BONIFICO/i.test(D(m.description))) return 'bonifico'
  return 'altro'
}

/** Outlet scritto a mano nella nota ("Outlet: BRB · …"), risolto per codice. */
export function outletFromNote(note: string | null | undefined, lk: IncassiLookups): string | null {
  const m = /^\s*Outlet:\s*([A-Za-z0-9_-]+)/i.exec(note ?? '')
  if (!m) return null
  const code = m[1].toUpperCase()
  for (const [id, o] of lk.outlets) if ((o.code ?? '').toUpperCase() === code) return id
  return null
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Parole chiave del canale Contanti ("FRANCIACORTA|ATM 01030-2121") → test sulla causale. */
export function depositKeywordMatches(keyword: string | null | undefined, descr: string | null | undefined): boolean {
  const kws = D(keyword).split('|').map(s => s.trim()).filter(Boolean)
  if (kws.length === 0) return false
  const d = D(descr)
  return kws.some(k => new RegExp(escapeRe(k), 'i').test(d))
}

export type IncassoAttribuzione = {
  kind: IncassoKind
  outlet_id: string | null
  channel: PnChannel | null
  attribuzione: Attribuzione
  terminal_code: string | null
  ref_date: string | null
}

/** Attribuisce l'entrata a un outlet nell'ordine: chiusura abbinata, codice terminale, parola chiave. */
export function attribuisciIncasso(m: PnIncassoMovement, lk: IncassiLookups): IncassoAttribuzione {
  const kind = incassoKindOf(m)
  const code = terminalCodeOf(m.description)
  const ref_date = refDateOf(m.description)
  const active = lk.channels.filter(c => c.is_active)

  // Assegnazione a mano nella nota: vince su tutto (è una scelta di una persona)
  const manual = outletFromNote(m.note, lk)
  if (manual) {
    const channel = active.find(c => c.outlet_id === manual && c.kind === (kind === 'bonifico' ? 'bonifico' : kind === 'versamento' ? 'contanti' : kind === 'amex' ? 'pos_amex' : 'pos')) ?? null
    return { kind, outlet_id: manual, channel, attribuzione: 'nota', terminal_code: code, ref_date }
  }

  const matched = lk.closingMatches.get(m.id)
  if (matched) {
    // Il canale serve solo per l'etichetta: si cerca fra quelli dell'outlet abbinato
    const wantKind = kind === 'amex' ? 'pos_amex' : kind === 'pos' ? 'pos' : 'contanti'
    const channel = active.find(c => c.outlet_id === matched.outlet_id && c.kind === wantKind && (wantKind === 'contanti' || normCode(c.terminal_code) === code))
      ?? active.find(c => c.outlet_id === matched.outlet_id && c.kind === wantKind) ?? null
    return { kind, outlet_id: matched.outlet_id, channel, attribuzione: 'chiusura', terminal_code: code, ref_date: matched.closing_date || ref_date }
  }

  if (code && (kind === 'pos' || kind === 'amex')) {
    const wantKind = kind === 'amex' ? 'pos_amex' : 'pos'
    const candidates = active.filter(c => c.kind === wantKind && normCode(c.terminal_code) === code)
    const channel = candidates.find(c => c.bank_account_id && c.bank_account_id === m.bank_account_id) ?? candidates[0] ?? null
    if (channel) return { kind, outlet_id: channel.outlet_id, channel, attribuzione: 'terminale', terminal_code: code, ref_date }
  }

  if (kind === 'versamento') {
    const channel = active.find(c => c.kind === 'contanti' && depositKeywordMatches(c.terminal_code, m.description)) ?? null
    if (channel) return { kind, outlet_id: channel.outlet_id, channel, attribuzione: 'parola_chiave', terminal_code: null, ref_date }
  }

  return { kind, outlet_id: null, channel: null, attribuzione: 'da_attribuire', terminal_code: code, ref_date }
}

export function outletLabel(outletId: string | null, lk: IncassiLookups): string {
  if (!outletId) return ''
  const o = lk.outlets.get(outletId)
  if (!o) return ''
  return o.code ? `${o.code} · ${o.name}` : o.name
}

/** Causale ripulita dal prefisso tecnico A-Cube ("Causale: … Descrizione: "). */
export const causalePulita = (descr: string | null | undefined): string => D(descr).replace(/^Causale:.*?Descrizione:\s*/i, '').trim()

// Colonne del foglio, nell'ordine chiesto da Patrizio (15/09): niente IBAN,
// attribuzione e categoria (stanno in pagina, non servono allo studio).
export type IncassoRow = {
  'Data operazione': string
  'Data riferimento': string
  'Conto Banca': string
  Outlet: string
  Canale: string
  Tipo: string
  Terminale: string
  Importo: number
  Causale: string
}

export function buildIncassoRow(m: PnIncassoMovement, a: IncassoAttribuzione, lk: IncassiLookups, fmtDate: (d: string | null) => string): IncassoRow {
  const acc = m.bank_account_id ? lk.bankAccounts.get(m.bank_account_id) : undefined
  return {
    'Data operazione': fmtDate(m.transaction_date),
    'Data riferimento': a.ref_date ? fmtDate(a.ref_date) : '',
    'Conto Banca': acc?.bank_name ?? '',
    Outlet: outletLabel(a.outlet_id, lk),
    Canale: a.channel?.label ?? '',
    Tipo: INCASSO_KIND_LABELS[a.kind],
    Terminale: a.terminal_code ?? '',
    Importo: Math.round(Number(m.amount) * 100) / 100,
    Causale: causalePulita(m.description),
  }
}

export const INCASSI_COLUMN_WIDTHS = [14, 14, 30, 28, 16, 20, 10, 12, 70]

export type OutletSummary = {
  outlet_id: string | null
  label: string
  n: number
  pos: number
  amex: number
  versamenti: number
  altro: number
  totale: number
}

const r2 = (n: number): number => Math.round(n * 100) / 100

/** Riepilogo per outlet (le righe senza outlet finiscono in «Da attribuire», in fondo). */
export function summarizeByOutlet(items: Array<{ m: PnIncassoMovement; a: IncassoAttribuzione }>, lk: IncassiLookups): OutletSummary[] {
  const map = new Map<string, OutletSummary>()
  for (const { m, a } of items) {
    const key = a.outlet_id ?? SENZA_OUTLET
    let s = map.get(key)
    if (!s) {
      s = { outlet_id: a.outlet_id, label: a.outlet_id ? outletLabel(a.outlet_id, lk) || '—' : 'Da attribuire', n: 0, pos: 0, amex: 0, versamenti: 0, altro: 0, totale: 0 }
      map.set(key, s)
    }
    const v = Number(m.amount) || 0
    s.n += 1
    s.totale += v
    if (a.kind === 'pos') s.pos += v
    else if (a.kind === 'amex') s.amex += v
    else if (a.kind === 'versamento') s.versamenti += v
    else s.altro += v
  }
  const out = Array.from(map.values()).map(s => ({ ...s, pos: r2(s.pos), amex: r2(s.amex), versamenti: r2(s.versamenti), altro: r2(s.altro), totale: r2(s.totale) }))
  out.sort((x, y) => {
    if (x.outlet_id === null) return 1
    if (y.outlet_id === null) return -1
    return x.label.localeCompare(y.label, 'it')
  })
  return out
}
