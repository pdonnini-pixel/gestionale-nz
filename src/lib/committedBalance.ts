import { supabase } from './supabase'

// Impegni "in distinta" non ancora pagati, aggregati per conto bancario.
// Servono a mostrare un SALDO PREVISIONALE (saldo reale − impegni) ACCANTO al
// saldo reale in Tesoreria. Questo modulo NON scrive nulla sul DB: è puro
// calcolo di visualizzazione. Il saldo reale (bank_accounts.current_balance)
// resta la fonte di verità e non viene mai toccato.
//
// Cosa conta come impegno ancora aperto (da sottrarre dal saldo reale):
//   1. Distinte fornitori → payable_actions (action_type = 'disposizione') la cui
//      fattura NON è ancora 'pagato' / 'annullato'. Quei soldi devono ancora
//      uscire dal conto.
//   2. Scadenze fiscali / F24 → fiscal_deadlines con disposizione_date valorizzata
//      e status ≠ 'paid'.
//
// Le voci già pagate NON si sottraggono: il pagamento reale è già dentro il
// saldo (arriva via movimento bancario riconciliato da A-Cube). Una scadenza
// 'parziale' resta prudenzialmente conteggiata come impegno pieno: il
// previsionale mostra così la disponibilità nel caso peggiore.

export type CommittedByAccount = Record<string, number>

type DispRow = { amount: number | null; bank_account_id: string | null; payables: { status: string | null } | null }
type FiscalRow = { disposizione_amount: number | null; amount: number | null; disposizione_bank_account_id: string | null; status: string | null }

// Stati fattura per cui l'uscita è già avvenuta (o non avverrà): niente da sottrarre.
const SETTLED_PAYABLE = new Set(['pagato', 'annullato'])

// Somma degli impegni ancora aperti per ogni conto bancario del tenant.
// Ritorna una mappa { bank_account_id: importo_impegnato }. In caso di errore su
// una delle due sorgenti, quella sorgente viene ignorata (best-effort): il
// previsionale è un aiuto, non deve mai rompere la pagina.
export async function fetchCommittedByAccount(companyId: string): Promise<CommittedByAccount> {
  if (!companyId) return {}
  const committed: CommittedByAccount = {}

  const [dispRes, fiscalRes] = await Promise.all([
    supabase
      .from('payable_actions')
      .select('amount, bank_account_id, payables!inner(status, company_id)')
      .eq('action_type', 'disposizione')
      .eq('payables.company_id', companyId),
    supabase
      .from('fiscal_deadlines')
      .select('disposizione_amount, amount, disposizione_bank_account_id, status')
      .eq('company_id', companyId)
      .not('disposizione_date', 'is', null),
  ])

  // 1) Distinte fornitori (payable_actions type 'disposizione').
  for (const r of (dispRes.data as unknown as DispRow[] | null) ?? []) {
    const status = r.payables?.status ?? null
    if (status && SETTLED_PAYABLE.has(status)) continue
    const bid = r.bank_account_id
    if (!bid) continue
    committed[bid] = (committed[bid] || 0) + Math.abs(Number(r.amount) || 0)
  }

  // 2) Scadenze fiscali / F24 disposte (fiscal_deadlines.disposizione_*).
  for (const fd of (fiscalRes.data as unknown as FiscalRow[] | null) ?? []) {
    if ((fd.status ?? null) === 'paid') continue
    const bid = fd.disposizione_bank_account_id
    if (!bid) continue
    const amt = fd.disposizione_amount != null ? Number(fd.disposizione_amount) : (Number(fd.amount) || 0)
    committed[bid] = (committed[bid] || 0) + Math.abs(amt)
  }

  return committed
}
