// Helper puri per il foglio «Pagamenti fornitori» della Prima Nota.
// Passo B dell'audit AUDIT_PRIMA_NOTA_COMMERCIALISTA_2026-09-14.md.
//
// Il foglio Banca ha una riga per movimento: una RiBa da 31 effetti è UNA riga
// con 31 numeri di fattura in causale. Qui invece una riga per FATTURA pagata
// nel mese, che è quello che serve allo studio per chiudere le partite
// fornitori: quando, da dove e per quanto è stata pagata ogni fattura. Entrano
// anche le fatture pagate in contanti o con carta (non passano dal conto) e le
// note di credito compensate. Su agosto 2026 NZ: 141 righe da banca, 12 da
// cassa e carta, 4 note di credito.

import { PAYMENT_METHOD_LABELS } from './paymentMethods'

export type PnPagamento = {
  id: string
  payment_date: string | null
  invoice_number: string | null
  invoice_date: string | null
  supplier_name: string | null
  supplier_vat: string | null
  net_amount: number | null
  vat_amount: number | null
  gross_amount: number | null
  amount_paid: number | null
  withholding_amount: number | null
  payment_method: string | null
  payment_method_label: string | null
  status: string | null
  closed_manually: boolean | null
  manual_close_reason: string | null
  is_provisional_paid: boolean | null
  installment_number: number | null
  installment_total: number | null
  bank_transaction_id: string | null
  payment_bank_account_id: string | null
  cost_category_id: string | null
  outlet_id: string | null
}

export type PnLookups = {
  bankAccounts: Map<string, { bank_name: string; iban: string | null }>
  bankTx: Map<string, { transaction_date: string; bank_account_id: string | null; description: string | null }>
  categories: Map<string, { name: string; ce_account_code: string | null }>
  outlets: Map<string, { code: string | null; name: string }>
}

export type PagamentoFonte = 'banca' | 'contanti' | 'carta' | 'nota_credito' | 'provvisoria' | 'chiusa_a_mano' | 'senza_riscontro'

export const FONTE_LABELS: Record<PagamentoFonte, string> = {
  banca: 'Banca',
  contanti: 'Contanti',
  carta: 'Carta',
  nota_credito: 'Nota di credito',
  provvisoria: 'Provvisoria (senza riscontro)',
  chiusa_a_mano: 'Chiusa a mano',
  senza_riscontro: 'Senza riscontro',
}

const num = (v: number | null | undefined): number => Number(v) || 0
const r2 = (n: number): number => Math.round(n * 100) / 100

// Da dove risulta pagata la fattura. Prima il documento (una nota di credito
// è una nota di credito qualunque sia il metodo), poi il riscontro in banca,
// poi il metodo dichiarato, infine come è stata chiusa.
export function fonteOf(p: PnPagamento): PagamentoFonte {
  if (p.status === 'nota_credito' || num(p.gross_amount) < 0) return 'nota_credito'
  if (p.bank_transaction_id) return 'banca'
  if (p.payment_method === 'contanti') return 'contanti'
  if (p.payment_method === 'carta_credito' || p.payment_method === 'carta_debito') return 'carta'
  if (p.is_provisional_paid) return 'provvisoria'
  if (p.closed_manually) return 'chiusa_a_mano'
  return 'senza_riscontro'
}

export function metodoLabel(p: PnPagamento): string {
  if (p.payment_method && PAYMENT_METHOD_LABELS[p.payment_method]) return PAYMENT_METHOD_LABELS[p.payment_method]
  if (p.payment_method_label) return p.payment_method_label
  return p.payment_method ?? ''
}

// Importo effettivamente uscito per quella fattura nel mese. Per una nota di
// credito compensata amount_paid è 0: conta il suo lordo (negativo).
export function importoPagato(p: PnPagamento): number {
  if (fonteOf(p) === 'nota_credito') return r2(num(p.gross_amount))
  const paid = p.amount_paid
  return r2(paid != null && paid !== 0 ? num(paid) : num(p.gross_amount))
}

export const rataOf = (p: PnPagamento): string =>
  p.installment_total && p.installment_total > 1 ? `${p.installment_number ?? '?'}/${p.installment_total}` : ''

export type PagamentoRow = {
  'Data pagamento': string
  Fonte: string
  'Conto Banca': string
  IBAN: string
  'Data movimento': string
  Fornitore: string
  'P.IVA': string
  'N. fattura': string
  'Data fattura': string
  Rata: string
  Imponibile: number | ''
  IVA: number | ''
  Ritenuta: number | ''
  Lordo: number
  Pagato: number
  Metodo: string
  Categoria: string
  'Conto CE': string
  Outlet: string
  Note: string
}

export function buildPagamentoRow(p: PnPagamento, lk: PnLookups, fmtDate: (d: string) => string): PagamentoRow {
  const tx = p.bank_transaction_id ? lk.bankTx.get(p.bank_transaction_id) : undefined
  const accountId = tx?.bank_account_id ?? p.payment_bank_account_id ?? null
  const acc = accountId ? lk.bankAccounts.get(accountId) : undefined
  const cat = p.cost_category_id ? lk.categories.get(p.cost_category_id) : undefined
  const out = p.outlet_id ? lk.outlets.get(p.outlet_id) : undefined
  const fonte = fonteOf(p)
  const note: string[] = []
  if (p.manual_close_reason) note.push(p.manual_close_reason)
  else if (fonte === 'chiusa_a_mano') note.push('Segnata pagata a mano, senza movimento bancario collegato')
  else if (fonte === 'provvisoria') note.push('Pagamento dichiarato, in attesa del riscontro')
  return {
    'Data pagamento': p.payment_date ? fmtDate(p.payment_date) : '',
    Fonte: FONTE_LABELS[fonte],
    'Conto Banca': fonte === 'banca' || p.payment_bank_account_id ? (acc?.bank_name ?? '') : '',
    IBAN: fonte === 'banca' || p.payment_bank_account_id ? (acc?.iban ?? '') : '',
    'Data movimento': tx?.transaction_date ? fmtDate(tx.transaction_date) : '',
    Fornitore: p.supplier_name ?? '',
    'P.IVA': p.supplier_vat ?? '',
    'N. fattura': p.invoice_number ?? '',
    'Data fattura': p.invoice_date ? fmtDate(p.invoice_date) : '',
    Rata: rataOf(p),
    Imponibile: p.net_amount != null ? r2(num(p.net_amount)) : '',
    IVA: p.vat_amount != null ? r2(num(p.vat_amount)) : '',
    Ritenuta: p.withholding_amount ? r2(num(p.withholding_amount)) : '',
    Lordo: r2(num(p.gross_amount)),
    Pagato: importoPagato(p),
    Metodo: metodoLabel(p),
    Categoria: cat?.name ?? '',
    'Conto CE': cat?.ce_account_code ?? '',
    Outlet: out ? (out.code ? `${out.code} · ${out.name}` : out.name) : '',
    Note: note.join(' · '),
  }
}

export const PAGAMENTI_COLUMN_WIDTHS = [12, 24, 26, 30, 12, 34, 14, 18, 12, 6, 12, 10, 10, 12, 12, 16, 26, 10, 22, 40]

// Vero se la fattura va nel foglio: pagata nel periodo, non segnaposto, non
// previsione. Il filtro conto tiene le fatture riscontrate su quel conto (o
// disposte su quel conto); senza filtro conto entrano anche contanti e carta.
export function includePagamento(
  p: PnPagamento & { is_placeholder?: boolean | null; is_forecast?: boolean | null },
  lk: PnLookups,
  bankAccountId: string | 'all',
): boolean {
  if (p.is_placeholder || p.is_forecast) return false
  if (!p.payment_date) return false
  if (bankAccountId === 'all') return true
  const tx = p.bank_transaction_id ? lk.bankTx.get(p.bank_transaction_id) : undefined
  return (tx?.bank_account_id ?? p.payment_bank_account_id) === bankAccountId
}

// Ordine: data pagamento, poi fornitore, poi numero fattura (stabile per l'export).
export function sortPagamenti<T extends PnPagamento>(ps: T[]): T[] {
  return [...ps].sort((a, b) =>
    String(a.payment_date ?? '').localeCompare(String(b.payment_date ?? ''))
    || String(a.supplier_name ?? '').localeCompare(String(b.supplier_name ?? ''), 'it')
    || String(a.invoice_number ?? '').localeCompare(String(b.invoice_number ?? ''), 'it', { numeric: true }))
}

export function summarizePagamenti(ps: PnPagamento[]): Array<{ fonte: PagamentoFonte; label: string; n: number; importo: number }> {
  const acc = new Map<PagamentoFonte, { n: number; importo: number }>()
  for (const p of ps) {
    const f = fonteOf(p)
    const cur = acc.get(f) ?? { n: 0, importo: 0 }
    cur.n += 1
    cur.importo += importoPagato(p)
    acc.set(f, cur)
  }
  return (Object.keys(FONTE_LABELS) as PagamentoFonte[])
    .filter((f) => acc.has(f))
    .map((f) => ({ fonte: f, label: FONTE_LABELS[f], n: acc.get(f)!.n, importo: r2(acc.get(f)!.importo) }))
}
