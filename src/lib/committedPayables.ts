import { supabase } from './supabase'

// Scadenze già "impegnate in banca": il pagamento è stato disposto, ma i soldi
// dal conto non sono ancora usciti. Servono a distinguere, nelle liste di
// scadenze, ciò che richiede un'azione da ciò che parte da solo.
//
// Il caso reale che ha fatto nascere questo modulo: le distinte RI.BA MPS del
// 31/08/2026 contenevano quattro effetti con scadenza 10/09. Presentati alla
// banca, quindi nulla da fare, ma nel widget «Scadenze prossimi 30 giorni»
// comparivano identici a una fattura da pagare a mano.
//
// Due sorgenti, due significati diversi per chi legge:
//   'riba'         effetto in una distinta RI.BA già consegnata alla banca:
//                  l'addebito arriva da solo alla scadenza
//   'disposizione' fattura inserita in una distinta di pagamento (bonifico):
//                  la disposizione è partita, si veda Storico Distinte
//
// Come `committedBalance`, questo modulo NON scrive nulla: è puro calcolo di
// visualizzazione, ed è best-effort. Se una delle due sorgenti non risponde si
// perde il badge su quelle righe, non la pagina.

export type CommittedKind = 'riba' | 'disposizione'
export type CommittedPayables = Record<string, CommittedKind>

// Stati per cui l'uscita è già avvenuta (o non avverrà): nessun impegno aperto.
const SETTLED_PAYABLE = new Set(['pagato', 'annullato'])

type ActionRow = { payable_id: string | null; payables: { status: string | null } | null }
type DistintaRow = { id: string | null }
type LineRow = { matched_payable_id: string | null; matched_payable_ids: string[] | null }

// Le tabelle riba_* non sono nei tipi generati: accesso via cast sul builder,
// come in committedBalance.ts per payable_credit_note_links.
type QueryBuilder = {
  select: (cols: string) => QueryBuilder
  eq: (col: string, val: unknown) => QueryBuilder
  neq: (col: string, val: unknown) => QueryBuilder
  in: (col: string, vals: unknown[]) => QueryBuilder
  then: (ok: (r: { data: unknown }) => void, err: (e: unknown) => void) => void
}
const table = (name: string) => (supabase.from as unknown as (t: string) => QueryBuilder)(name)

async function rows<T>(qb: QueryBuilder): Promise<T[]> {
  try {
    const res = await (qb as unknown as Promise<{ data: unknown }>)
    return (res.data as T[] | null) ?? []
  } catch {
    return []
  }
}

export async function fetchCommittedPayables(companyId: string): Promise<CommittedPayables> {
  if (!companyId) return {}
  const out: CommittedPayables = {}

  // 1) Distinte di pagamento (bonifici): la disposizione è già partita.
  try {
    const { data } = await supabase
      .from('payable_actions')
      .select('payable_id, payables!inner(status, company_id)')
      .eq('action_type', 'disposizione')
      .eq('payables.company_id', companyId)
    for (const r of ((data as unknown as ActionRow[] | null) ?? [])) {
      const status = r.payables?.status ?? null
      if (status && SETTLED_PAYABLE.has(status)) continue
      if (r.payable_id) out[r.payable_id] = 'disposizione'
    }
  } catch { /* sorgente saltata: niente badge, nessun errore in pagina */ }

  // 2) Effetti RI.BA in distinte già consegnate alla banca. Una riga di distinta
  //    può coprire più scadenze (effetto cumulativo su N fatture dello stesso
  //    fornitore), quindi si leggono sia il match singolo sia l'array.
  const distinte = await rows<DistintaRow>(
    table('riba_distinte').select('id').eq('company_id', companyId).neq('status', 'bozza')
  )
  const ids = distinte.map(d => d.id).filter((v): v is string => Boolean(v))
  if (ids.length > 0) {
    const lines = await rows<LineRow>(
      table('riba_distinta_lines').select('matched_payable_id, matched_payable_ids').in('distinta_id', ids)
    )
    for (const l of lines) {
      for (const id of [l.matched_payable_id, ...(l.matched_payable_ids ?? [])]) {
        if (id) out[id] = 'riba'
      }
    }
  }

  return out
}

// Etichetta e spiegazione mostrate accanto alla scadenza.
export const COMMITTED_LABEL: Record<CommittedKind, { label: string; title: string }> = {
  riba: {
    label: 'in distinta',
    title: 'Effetto RI.BA già presentato in banca: alla scadenza l’addebito arriva da solo, non serve disporre il pagamento.',
  },
  disposizione: {
    label: 'in distinta',
    title: 'Fattura inserita in una distinta di pagamento: il bonifico è già disposto, si vede in Storico Distinte.',
  },
}
