// Importo ANCORA da pagare di una scadenza (payable), con la stessa logica
// dello Scadenzario (vista "Aperte"). Fonte unica per le pagine che mostrano
// un "da pagare" per fornitore (Fornitori), cosi' i due numeri non divergono.
//
// Regole (identiche a ScadenzarioSmart.displayPayables + rowOpenAmount):
// 1. Stato terminale (pagato / annullato / bloccato) → 0.
// 2. Nota di credito gia' CHIUSA A MANO o registrata in partitario
//    (closed_manually oppure payment_date valorizzata) → 0: il credito e' gia'
//    stato consumato e non va piu' scalato dal dovuto. Vale SOLO per le NC:
//    su una fattura positiva `payment_date` e' la data dell'acconto (status
//    'parziale') e il residuo resta aperto.
// 3. Quota gia' DISPOSTA in distinta e non ancora riscontrata in banca
//    (dispostoLordo − pagato) e' "in sospeso": non e' piu' da pagare a mano e
//    viene sottratta dal residuo. dispostoLordo = netti disposti in banca +
//    note di credito compensate nel pagamento (link pending E applied).
//
// Caso reale (NZ, GGZ SRL, 09/2026): la NC 1454/01 di −174,48 € era stata
// chiusa a mano ma la pagina Fornitori continuava a scalarla, mostrando
// 280.510,37 € contro i 280.684,85 € dello Scadenzario.

import { supabase } from './supabase'
import { fetchAllPaged } from './fetchAllPaged'

export const PAYABLE_CLOSED_STATUSES = ['pagato', 'annullato', 'bloccato'] as const

/** Campi minimi di una payable necessari al calcolo del residuo aperto. */
export interface PayableOpenInput {
  status?: string | null
  gross_amount?: number | string | null
  amount_paid?: number | string | null
  amount_remaining?: number | string | null
  closed_manually?: boolean | null
  payment_date?: string | null
}

/** Quote disposte in distinta per una payable (vedi buildDisposizioniMap). */
export interface DisposizioneInfo {
  /** Somma dei NETTI disposti in banca (payable_actions 'disposizione'). */
  disposto: number
  /** Somma |NC| compensate nel pagamento (payable_credit_note_links pending+applied). */
  ncSettled: number
}

export type DisposizioniMap = Map<string, DisposizioneInfo>

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function isCreditNote(p: PayableOpenInput): boolean {
  return p.status === 'nota_credito' || num(p.gross_amount) < 0
}

/**
 * True se la scadenza NON concorre piu' al "da pagare": stato terminale oppure
 * nota di credito gia' chiusa a mano / registrata (closed_manually o payment_date).
 */
export function isPayableClosed(p: PayableOpenInput): boolean {
  const status = String(p.status || '')
  if ((PAYABLE_CLOSED_STATUSES as readonly string[]).includes(status)) return true
  if (isCreditNote(p) && (p.closed_manually || p.payment_date)) return true
  return false
}

/**
 * Quota della scadenza gia' disposta in distinta e NON ancora saldata
 * (= dispostoLordo − pagato, mai negativa). 0 se non c'e' alcuna disposizione.
 */
export function disposizionePending(p: PayableOpenInput, disp?: DisposizioneInfo | null): number {
  if (!disp) return 0
  const lordo = disp.disposto + disp.ncSettled
  return Math.max(0, +(lordo - num(p.amount_paid)).toFixed(2))
}

/**
 * Importo ancora da pagare (a mano) della scadenza: residuo − quota in sospeso,
 * oppure 0 se la scadenza e' chiusa. Per le note di credito aperte resta
 * negativo (scala il dovuto del fornitore), come nello Scadenzario.
 */
export function payableOpenAmount(p: PayableOpenInput, disp?: DisposizioneInfo | null): number {
  if (isPayableClosed(p)) return 0
  const remaining = p.amount_remaining == null ? num(p.gross_amount) : num(p.amount_remaining)
  return +(remaining - disposizionePending(p, disp)).toFixed(2)
}

export interface DisposizioneActionRow { payable_id: string | null; amount: number | string | null }
export interface CreditNoteLinkRow { payable_id: string | null; amount: number | string | null; status: string | null }

/** Costruisce la mappa payable_id → quote disposte, da azioni e link NC grezzi. */
export function buildDisposizioniMap(
  actions: DisposizioneActionRow[],
  ncLinks: CreditNoteLinkRow[],
): DisposizioniMap {
  const map: DisposizioniMap = new Map()
  const get = (id: string): DisposizioneInfo => {
    let d = map.get(id)
    if (!d) { d = { disposto: 0, ncSettled: 0 }; map.set(id, d) }
    return d
  }
  for (const a of actions) {
    if (!a.payable_id) continue
    get(a.payable_id).disposto += num(a.amount)
  }
  for (const l of ncLinks) {
    // Solo pending e applied concorrono al disposto; i 'cancelled' sono annullati.
    if (!l.payable_id || (l.status !== 'pending' && l.status !== 'applied')) continue
    // Le NC compensate contano SOLO su fatture che hanno una disposizione: senza
    // disposizione non c'e' nulla "in sospeso" (stesso criterio dello Scadenzario).
    if (!map.has(l.payable_id)) continue
    get(l.payable_id).ncSettled += Math.abs(num(l.amount))
  }
  return map
}

/**
 * Legge dal DB le disposizioni in distinta e le NC compensate del tenant e
 * restituisce la mappa per payableOpenAmount. Best-effort: in caso di errore
 * (es. tabella link assente) restituisce solo quanto e' riuscito a leggere.
 */
export async function fetchDisposizioniMap(companyId: string): Promise<DisposizioniMap> {
  // Filtro azienda via join embedded (payables!inner): bounded e indipendente
  // dal numero di payables, come nello Scadenzario. Ordine stabile per la paginazione.
  const actions = await fetchAllPaged<DisposizioneActionRow>(
    (from, to) => supabase
      .from('payable_actions')
      .select('payable_id, amount, payables!inner(company_id)')
      .eq('action_type', 'disposizione')
      .eq('payables.company_id', companyId)
      .order('id', { ascending: true })
      .range(from, to),
    'payable_actions disposizione (fornitori)',
  )
  let ncLinks: CreditNoteLinkRow[] = []
  try {
    type LinksSelect = {
      select: (cols: string) => { eq: (c: string, v: unknown) => Promise<{ data: CreditNoteLinkRow[] | null }> }
    }
    // Tabella non presente nei tipi generati: stesso cast usato nello Scadenzario.
    const sel = (supabase.from as unknown as (t: string) => LinksSelect)('payable_credit_note_links')
    const { data } = await sel.select('payable_id, amount, status').eq('company_id', companyId)
    ncLinks = data || []
  } catch { /* tabella assente o errore non bloccante */ }
  return buildDisposizioniMap(actions, ncLinks)
}
