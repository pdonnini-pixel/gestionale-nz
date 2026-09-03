import { supabase } from './supabase'

// Impegni "in distinta" non ancora usciti dal conto, aggregati per conto bancario.
// Servono a mostrare un SALDO PREVISIONALE (saldo reale − impegni) ACCANTO al
// saldo reale in Tesoreria e a partire da lì quando si crea una nuova distinta.
// Questo modulo NON scrive nulla sul DB: è puro calcolo di visualizzazione. Il
// saldo reale (bank_accounts.current_balance) resta la fonte di verità.
//
// Cosa conta come impegno ancora aperto (da sottrarre dal saldo reale):
//   1. Distinte fornitori → payable_actions (action_type = 'disposizione') la cui
//      fattura NON è ancora 'pagato' / 'annullato'. Quei soldi devono ancora
//      uscire dal conto (sono le righe che si vedono in Storico Distinte).
//   2. Scadenze fiscali / F24 → fiscal_deadlines con disposizione_date valorizzata
//      e status ≠ 'paid'.
//
// IMPORTANTE — niente doppio conteggio sui pagamenti parziali.
// L'impegno da sottrarre è il RESIDUO della disposizione, non il disposto pieno:
//     residuo = max(0, disposto + note di credito compensate − già pagato)
// La parte già pagata è infatti uscita davvero dal conto ed è quindi già dentro
// il saldo reale: contarla di nuovo gonfiava il previsionale (caso reale NZ:
// una fattura disposta 39.445,90 € e già pagata continuava a pesare per intero,
// facendo sembrare il conto scoperto di ~39 k€ che invece erano già usciti).
// È la stessa formula che lo Scadenzario usa per `disposizione_amount_pending`.
//
// Le note di credito compensate si sommano al disposto perché `payable_actions.amount`
// è il NETTO bonificato, mentre `amount_paid` è lordo: senza riallinearli il residuo
// resterebbe positivo per l'importo della NC.

export type CommittedByAccount = Record<string, number>

type DispRow = {
  amount: number | null
  bank_account_id: string | null
  payables: { id: string | null; status: string | null; amount_paid: number | null } | null
}
type FiscalRow = {
  disposizione_amount: number | null
  amount: number | null
  amount_paid: number | null
  disposizione_bank_account_id: string | null
  status: string | null
}
type NcLinkRow = { payable_id: string | null; amount: number | null; status: string | null }

// Stati fattura per cui l'uscita è già avvenuta (o non avverrà): niente da sottrarre.
const SETTLED_PAYABLE = new Set(['pagato', 'annullato'])

// Somma degli impegni ancora aperti per ogni conto bancario del tenant.
// Ritorna una mappa { bank_account_id: importo_impegnato }. In caso di errore su
// una delle sorgenti, quella sorgente viene ignorata (best-effort): il
// previsionale è un aiuto, non deve mai rompere la pagina.
export async function fetchCommittedByAccount(companyId: string): Promise<CommittedByAccount> {
  if (!companyId) return {}
  const committed: CommittedByAccount = {}

  // payable_credit_note_links non è nei tipi generati: accesso via cast, come altrove.
  type PcnlSelect = { select: (cols: string) => { eq: (c: string, v: unknown) => Promise<{ data: NcLinkRow[] | null }> } }
  const pcnlSel = (supabase.from as unknown as (t: string) => PcnlSelect)('payable_credit_note_links')

  const [dispRes, fiscalRes, ncRes] = await Promise.all([
    supabase
      .from('payable_actions')
      .select('amount, bank_account_id, payables!inner(id, status, amount_paid, company_id)')
      .eq('action_type', 'disposizione')
      .eq('payables.company_id', companyId),
    supabase
      .from('fiscal_deadlines')
      .select('disposizione_amount, amount, amount_paid, disposizione_bank_account_id, status')
      .eq('company_id', companyId)
      .not('disposizione_date', 'is', null),
    pcnlSel.select('payable_id, amount, status').eq('company_id', companyId).catch(() => ({ data: null })),
  ])

  // Note di credito compensate per fattura (pending + applied, mai i cancelled).
  const ncByPayable = new Map<string, number>()
  for (const l of (ncRes as { data: NcLinkRow[] | null }).data ?? []) {
    if (l.status !== 'pending' && l.status !== 'applied') continue
    if (!l.payable_id) continue
    ncByPayable.set(l.payable_id, (ncByPayable.get(l.payable_id) || 0) + (Math.abs(Number(l.amount)) || 0))
  }

  // 1) Distinte fornitori (payable_actions type 'disposizione').
  for (const r of (dispRes.data as unknown as DispRow[] | null) ?? []) {
    const status = r.payables?.status ?? null
    if (status && SETTLED_PAYABLE.has(status)) continue
    const bid = r.bank_account_id
    if (!bid) continue
    const disposto = Math.abs(Number(r.amount) || 0)
    const nc = r.payables?.id ? (ncByPayable.get(r.payables.id) || 0) : 0
    const pagato = Math.abs(Number(r.payables?.amount_paid) || 0)
    const residuo = Math.max(0, +(disposto + nc - pagato).toFixed(2))
    if (residuo <= 0) continue
    committed[bid] = (committed[bid] || 0) + residuo
  }

  // 2) Scadenze fiscali / F24 disposte (fiscal_deadlines.disposizione_*).
  for (const fd of (fiscalRes.data as unknown as FiscalRow[] | null) ?? []) {
    if ((fd.status ?? null) === 'paid') continue
    const bid = fd.disposizione_bank_account_id
    if (!bid) continue
    const disposto = Math.abs(fd.disposizione_amount != null ? Number(fd.disposizione_amount) : (Number(fd.amount) || 0))
    const pagato = Math.abs(Number(fd.amount_paid) || 0)
    const residuo = Math.max(0, +(disposto - pagato).toFixed(2))
    if (residuo <= 0) continue
    committed[bid] = (committed[bid] || 0) + residuo
  }

  return committed
}
