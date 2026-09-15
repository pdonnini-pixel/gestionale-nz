// Pagina /prima-nota
// Riepilogo movimenti banca per periodo, formato export per la commercialista.
// Sorgente: bank_transactions (single source A-Cube post-15/05).
// Filtri: anno + mese + conto. Export CSV + XLSX.
//
// Ogni movimento porta TUTTE le fatture che salda (non una sola: una RiBa da 31
// effetti ne mostrava una a caso), il tipo di movimento (fornitore, F24, stipendi,
// POS, versamento, carta, spese bancarie, finanziamento, giroconto, da chiarire)
// e per gli F24 il codice tributo e il periodo letti da Scadenze fiscali.
// La logica è in src/lib/primaNotaExport.ts (testata), qui solo dati e UI.
//
// Seconda vista «Pagamenti fornitori» (passo B dell'audit): una riga per FATTURA
// pagata nel periodo, contanti, carta e note di credito compresi, con conto,
// data del movimento, imponibile/IVA, metodo, categoria e conto CE. È il foglio
// che serve allo studio per chiudere le partite fornitori. Logica in
// src/lib/primaNotaPagamenti.ts (testata).
//
// Terza vista «Incassi per outlet» (passo C): le entrate (POS, Amex, versamenti
// di contante, altri incassi) attribuite al punto vendita dall'abbinamento con
// la chiusura di cassa, dal codice terminale in causale (outlet_payment_channels)
// o dalla parola chiave del versamento. Logica in src/lib/primaNotaIncassi.ts
// (testata, copia fedele delle funzioni SQL del riscontro chiusure ↔ banca).
//
// Quadratura con l'estratto conto (idea di Patrizio, 15/09): per ogni conto
// saldo iniziale della banca + movimenti nostri = saldo finale della banca. I
// saldi vengono da raw_data (accountBalanceSnapshot allo scarico A-Cube), quindi
// sono indipendenti dai movimenti: se quadra, l'export è completo. Più il
// contante: versamenti e prelievi dal lato banca, fondo cassa, incassi, spese e
// versamenti dichiarati dalle chiusure di cassa. Logica in
// src/lib/primaNotaQuadratura.ts (testata).
//
// Quarta vista «Dipendenti» (richiesta di Patrizio, 15/09): per il mese la
// lista con nome e cognome e il netto pagato, riconducibile alla disposizione
// per emolumenti in banca (ID flusso CBI), così lo studio fa il collegamento.
// Le buste paga vengono da employee_cost_slips (mese prima e mese del
// pagamento), i flussi dai movimenti classificati «stipendi». Logica in
// src/lib/primaNotaStipendi.ts (testata).
//
// Quinta vista «Carte» (richiesta di Patrizio, 15/09): un foglio per carta,
// come per le banche. Gli estratti carta (CartaBCC/Numia, Carta Montepaschi,
// prepagata Tasca) si importano qui dal PDF o dall'Excel del portale (o si
// leggono dal file già archiviato in Banche → Archivio): le righe finiscono
// in card_transactions, legate al loro bank_statements (doc_kind carta).
// Per ogni estratto: righe, totale letto e dichiarato, addebito ritrovato in
// banca (carte di credito) o ricariche ritrovate (prepagata), fatture dello
// Scadenzario pagate con quella riga. Logica in src/lib/cartaEstratto.ts
// (testata sui documenti veri).

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Download, FileSpreadsheet, Calendar, Filter, RefreshCw, Loader2, Landmark, Receipt, Store, Scale, Users, CreditCard, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import { lastDayOfMonthYMD } from '../lib/dateLocal'
import {
  buildRow, classifyMovement, counterpartOf, causaleOf, pivaOf, invoiceCountOf, invoicesTotalOf,
  summarizeByKind, KIND_LABELS, PN_COLUMN_WIDTHS,
  type PnPayable, type PnFiscalDeadline, type PnMovement, type MovementKind,
} from '../lib/primaNotaExport'
import {
  buildPagamentoRow, fonteOf, includePagamento, sortPagamenti, summarizePagamenti, importoPagato, metodoLabel, rataOf,
  FONTE_LABELS, PAGAMENTI_COLUMN_WIDTHS, type PnPagamento, type PnLookups, type PagamentoFonte,
} from '../lib/primaNotaPagamenti'
import {
  attribuisciIncasso, buildIncassoRow, summarizeByOutlet, outletLabel,
  ATTRIBUZIONE_LABELS, INCASSI_COLUMN_WIDTHS, SENZA_OUTLET,
  type IncassiLookups, type IncassoKind, type Attribuzione,
} from '../lib/primaNotaIncassi'
import {
  quadraturaConti, quadraturaContante, saldiProgressivi, prevDay,
  type PnTxSnapshot, type PnClosingLite, type QuadraturaConto, type QuadraturaContante,
} from '../lib/primaNotaQuadratura'
import {
  abbinaStipendi, buildStipendioRow, nomeDipendente, competenzaLabel, competenzeCandidate, STIPENDI_COLUMN_WIDTHS,
  type PnSlip, type PnFlusso,
} from '../lib/primaNotaStipendi'
import {
  parseCardStatementLines, parseTascaAoa, matchStatementDebit, matchRicariche, matchPayables, buildCartaRow, totaliCarta, sourceLabelOf,
  ISSUER_LABELS, CARTE_COLUMN_WIDTHS, type CardStatementParsed, type CardLine, type PayableLite, type BankMovLite, type AoaCell,
} from '../lib/cartaEstratto'
import { archiviaFile } from '../lib/archivioFile'
import { useToast } from '../components/Toast'
import { Modal } from '../components/ui/Modal'
import { useCompany } from '../hooks/useCompany'
import Tooltip from '../components/Tooltip'
import TableScroll from '../components/ui/TableScroll'

type BankAccount = { id: string; bank_name: string; account_name: string | null; iban: string | null }
type Supplier = { id: string; ragione_sociale: string | null; name: string | null; partita_iva: string | null }
type MovementRaw = {
  id: string
  transaction_date: string
  amount: number
  currency: string | null
  description: string | null
  reference: string | null
  category: string | null
  note: string | null
  counterpart: string | null
  counterpart_name: string | null
  merchant_name: string | null
  supplier_id: string | null
  bank_account_id: string | null
  bank_accounts?: BankAccount | null
  suppliers?: Supplier | null
  /** raw_data.fetchedAt, raw_data.extra.accountBalanceSnapshot e raw_data.extra.postingDate (select con JSON path) */
  fetched_at?: string | null
  snapshot?: string | number | null
  posting_date?: string | null
}
type Movement = MovementRaw & PnMovement
/** Data su cui si ragiona: quella dell'operazione (A-Cube madeOn) o quella contabile della banca (postingDate, come sull'estratto conto). */
type DateBasis = 'contabile' | 'operazione'
type WinRow = { id: string; bank_account_id: string | null; transaction_date: string; posting_date: string | null; amount: number; fetched_at: string | null; snapshot: number | null }
const addDays = (ymd: string, n: number): string => { const d = new Date(`${ymd}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** Nome foglio Excel valido (max 31 caratteri, senza : \ / ? * [ ]) e unico. */
const sheetName = (name: string, used: Set<string>): string => {
  const base = name.replace(/[:\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Conto'
  let n = base; let i = 2
  while (used.has(n)) { n = `${base.slice(0, 25)} ${i}`; i += 1 }
  used.add(n)
  return n
}
type Pagamento = PnPagamento & { is_placeholder: boolean | null; is_forecast: boolean | null }
type View = 'banca' | 'pagamenti' | 'incassi' | 'dipendenti' | 'carte'
type CardStmt = { id: string; filename: string; file_type: string; source_label: string | null; card_last4: string | null; statement_total: number | null; settled_bank_transaction_id: string | null; period_year: number | null; period_month: number | null; transaction_count: number | null; file_path: string | null }
type CardTx = CardLine & { id: string; statement_id: string; row_no: number; payable_id: string | null }
type CardImportItem = { file: File | null; fileName: string; parsed: CardStatementParsed; existing: CardStmt | null; existingLines: number; label: string }
const r2 = (n: number): number => Math.round(n * 100) / 100
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** Movimenti bancari che possono saldare o ricaricare una carta (addebito estratto, SDD carta, ricarica prepagata). */
const RE_BANCA_CARTA = /CARTA DEL CREDITO COOPERATIVO|RICARICA CARTA|ADD\.?\s*DIRETTO CARTA|ADDEBITO DIRETTO CARTA|BANCA MONTE DEI PASCHI|CARTA DI CREDITO|ESTRATTO CONTO CARTA/i

const MONTHS = [
  { v: 1, l: 'Gennaio' }, { v: 2, l: 'Febbraio' }, { v: 3, l: 'Marzo' }, { v: 4, l: 'Aprile' },
  { v: 5, l: 'Maggio' }, { v: 6, l: 'Giugno' }, { v: 7, l: 'Luglio' }, { v: 8, l: 'Agosto' },
  { v: 9, l: 'Settembre' }, { v: 10, l: 'Ottobre' }, { v: 11, l: 'Novembre' }, { v: 12, l: 'Dicembre' },
]

const fmt = (n: number) => Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('it-IT') : '—'

// Colori dei badge «Tipo movimento»: verde incassi, rosso fornitori, ambra
// imposte, grigio banca, arancio da chiarire (quello che Sabrina deve guardare).
const KIND_BADGE: Record<MovementKind, string> = {
  fornitore: 'bg-red-50 text-red-700',
  f24: 'bg-amber-100 text-amber-800',
  stipendi: 'bg-violet-100 text-violet-700',
  pos: 'bg-emerald-100 text-emerald-700',
  versamento: 'bg-emerald-50 text-emerald-700',
  carta: 'bg-sky-100 text-sky-700',
  finanziamento: 'bg-slate-200 text-slate-700',
  spese_banca: 'bg-slate-100 text-slate-600',
  giroconto: 'bg-slate-100 text-slate-600',
  incasso_cliente: 'bg-emerald-100 text-emerald-700',
  rimborso: 'bg-teal-100 text-teal-700',
  da_chiarire: 'bg-orange-100 text-orange-800',
}

const FONTE_BADGE: Record<PagamentoFonte, string> = {
  banca: 'bg-emerald-100 text-emerald-700',
  contanti: 'bg-amber-100 text-amber-800',
  carta: 'bg-sky-100 text-sky-700',
  nota_credito: 'bg-violet-100 text-violet-700',
  provvisoria: 'bg-orange-100 text-orange-800',
  chiusa_a_mano: 'bg-slate-200 text-slate-700',
  senza_riscontro: 'bg-red-100 text-red-700',
}

const INCASSO_BADGE: Record<IncassoKind, string> = {
  pos: 'bg-emerald-100 text-emerald-700',
  amex: 'bg-sky-100 text-sky-700',
  versamento: 'bg-amber-100 text-amber-800',
  bonifico: 'bg-teal-100 text-teal-700',
  altro: 'bg-slate-100 text-slate-600',
}
const ATTRIBUZIONE_BADGE: Record<Attribuzione, string> = {
  nota: 'bg-violet-100 text-violet-700',
  chiusura: 'bg-emerald-50 text-emerald-700',
  terminale: 'bg-slate-100 text-slate-600',
  parola_chiave: 'bg-slate-100 text-slate-600',
  da_attribuire: 'bg-orange-100 text-orange-800',
}

// PostgREST IN() ha un limite di URL (~16KB): si spacchetta in blocchi da 200 UUID.
const chunk = <T,>(xs: T[], size = 200): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

export default function PrimaNota() {
  const { company } = useCompany()
  const today = new Date()
  const [year, setYear] = useState<number>(today.getFullYear())
  const [month, setMonth] = useState<number | null>(today.getMonth() + 1)
  const [bankAccountId, setBankAccountId] = useState<string>('all')
  const [view, setView] = useState<View>('banca')
  const [rawMovements, setRawMovements] = useState<Movement[]>([])
  const [dateBasis, setDateBasis] = useState<DateBasis>('contabile')
  const [pagamenti, setPagamenti] = useState<Pagamento[]>([])
  const [lookups, setLookups] = useState<PnLookups>({ bankAccounts: new Map(), bankTx: new Map(), categories: new Map(), outlets: new Map() })
  const [loadingPag, setLoadingPag] = useState(false)
  // Filtro a clic dalle card e dalle etichette: «Da chiarire» deve portare
  // SUBITO alle righe da sistemare, non a un numero da interpretare.
  const [kindFilter, setKindFilter] = useState<MovementKind | null>(null)
  const [fonteFilter, setFonteFilter] = useState<PagamentoFonte[] | null>(null)
  // Incassi per outlet: dizionari (canali, outlet, abbinamenti chiusure) e filtro a clic per outlet
  const [incassiLk, setIncassiLk] = useState<IncassiLookups>({ channels: [], outlets: new Map(), closingMatches: new Map(), bankAccounts: new Map() })
  // Quadratura: movimenti di una finestra larga intorno al periodo (per i saldi della banca) e chiusure di cassa del periodo
  const [winRaw, setWinRaw] = useState<WinRow[]>([])
  const [closings, setClosings] = useState<PnClosingLite[]>([])
  // Dipendenti: buste paga dei mesi candidati (mese prima e mese del pagamento)
  const [slips, setSlips] = useState<PnSlip[]>([])
  // Carte: estratti del periodo (bank_statements doc_kind carta), righe importate, fatture pagate con carta, movimenti banca che le saldano
  const [cardStmts, setCardStmts] = useState<CardStmt[]>([])
  const [cardTx, setCardTx] = useState<CardTx[]>([])
  const [cardPayables, setCardPayables] = useState<PayableLite[]>([])
  const [cardBankMovs, setCardBankMovs] = useState<BankMovLite[]>([])
  const [cardImport, setCardImport] = useState<{ items: CardImportItem[]; busy: boolean } | null>(null)
  const [cardParsing, setCardParsing] = useState(false)
  const cardFileRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const [outletFilter, setOutletFilter] = useState<string | null>(null)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const companyId = company?.id
  const dateStart = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
  // Ultimo giorno del mese in LOCALE (lastDayOfMonthYMD): `.toISOString()` lo spostava a UTC.
  const dateEnd = month ? lastDayOfMonthYMD(year, month) : `${year}-12-31`
  const basisDate = useCallback((m: { transaction_date: string; posting_date?: string | null }) =>
    (dateBasis === 'contabile' && m.posting_date ? m.posting_date : m.transaction_date), [dateBasis])
  // I movimenti del periodo secondo la data scelta: si scarica una finestra di
  // ±15 giorni per data operazione e si filtra qui, così cambiare base non
  // richiede un nuovo scarico. Ordine: conto, data, id (stabile).
  const movements = useMemo<Movement[]>(
    () => rawMovements
      .filter(m => { const d = basisDate(m); return d >= dateStart && d <= dateEnd })
      .sort((a, b) => (a.bank_accounts?.bank_name ?? '').localeCompare(b.bank_accounts?.bank_name ?? '', 'it') || basisDate(a).localeCompare(basisDate(b)) || a.id.localeCompare(b.id)),
    [rawMovements, basisDate, dateStart, dateEnd],
  )

  const loadBankAccounts = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase
      .from('bank_accounts')
      .select('id, bank_name, account_name, iban')
      .eq('company_id', companyId)
      .order('bank_name')
    setBankAccounts((data ?? []) as BankAccount[])
  }, [companyId])

  const loadMovements = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setError(null)
    try {
      // Finestra di ±15 giorni per data operazione: la data contabile della banca
      // può cadere qualche giorno dopo (fino a 7 visti finora), il filtro per
      // data scelta è lato client.
      const winStart = addDays(dateStart, -15)
      const winEnd = addDays(dateEnd, 15)

      // Paginato: prima un `.limit(5000)` troncava SILENZIOSAMENTE l'estratto (su piu'
      // conti "Tutto l'anno" e' realistico superare 5.000 movimenti): KPI ed export
      // CSV/XLSX per la commercialista risultavano incompleti senza alcun avviso. Ora
      // si scarica tutto in blocchi da 1000. Ordine stabile (data + id) per non
      // perdere/duplicare righe al confine tra le pagine.
      const baseMovs = await fetchAllPaged<MovementRaw>(
        (from, to) => {
          let q = supabase
            .from('bank_transactions')
            .select(`
              id, transaction_date, amount, currency, description, reference, category, note,
              counterpart, counterpart_name, merchant_name, supplier_id, bank_account_id,
              fetched_at:raw_data->>fetchedAt, snapshot:raw_data->extra->>accountBalanceSnapshot, posting_date:raw_data->extra->>postingDate,
              bank_accounts!inner(id, bank_name, account_name, iban),
              suppliers(id, ragione_sociale, name, partita_iva)
            `)
            .eq('company_id', companyId)
            .gte('transaction_date', winStart)
            .lte('transaction_date', winEnd)
            .order('transaction_date', { ascending: true })
            .order('id', { ascending: true })
          if (bankAccountId !== 'all') q = q.eq('bank_account_id', bankAccountId)
          return q.range(from, to)
        },
        'bank_transactions',
      ) as unknown as MovementRaw[]

      // Fatture e scadenze fiscali agganciate al movimento (FK bank_transaction_id,
      // che PostgREST non risolve in embed): fetch separato e join lato client.
      // TUTTE le fatture per movimento: una RiBa o una distinta CBI ne salda decine.
      // Più gli agganci del registro di riconciliazione (reconciliation_log,
      // stato applied): un acconto agganciato «solo aggancio» (Wolf 07/08, fattura
      // 218) non porta il bank_transaction_id sulla fattura, ma è un pagamento
      // fornitore a tutti gli effetti e deve uscire come tale.
      const btIds = baseMovs.map(m => m.id).filter(Boolean)
      const payMap = new Map<string, PnPayable[]>()
      const fdMap = new Map<string, PnFiscalDeadline[]>()
      if (btIds.length > 0) {
        const chunks = chunk(btIds)
        const [payResults, fdResults, logResults] = await Promise.all([
          Promise.all(chunks.map(ids => supabase
            .from('payables')
            .select('id, bank_transaction_id, invoice_number, supplier_name, supplier_vat, gross_amount, invoice_date, amount_paid, installment_number, installment_total')
            .in('bank_transaction_id', ids)
            .order('invoice_number', { ascending: true }))),
          Promise.all(chunks.map(ids => supabase
            .from('fiscal_deadlines')
            .select('bank_transaction_id, title, f24_code, tax_period, deadline_type')
            .in('bank_transaction_id', ids))),
          Promise.all(chunks.map(ids => supabase
            .from('reconciliation_log')
            .select('bank_transaction_id, payable_id, status, payables(id, invoice_number, supplier_name, supplier_vat, gross_amount, invoice_date, amount_paid, installment_number, installment_total)')
            .in('bank_transaction_id', ids)
            .eq('status', 'applied'))),
        ])
        const seen = new Set<string>()
        for (const p of payResults.flatMap(r => r.data ?? [])) {
          if (!p.bank_transaction_id) continue
          seen.add(`${p.bank_transaction_id}:${p.id}`)
          const list = payMap.get(p.bank_transaction_id) ?? []
          list.push({ invoice_number: p.invoice_number, supplier_name: p.supplier_name, supplier_vat: p.supplier_vat, gross_amount: p.gross_amount, invoice_date: p.invoice_date, amount_paid: p.amount_paid, installment_number: p.installment_number, installment_total: p.installment_total })
          payMap.set(p.bank_transaction_id, list)
        }
        type LogRow = { bank_transaction_id: string | null; payable_id: string | null; payables: { id: string; invoice_number: string | null; supplier_name: string | null; supplier_vat: string | null; gross_amount: number | null; invoice_date: string | null; amount_paid: number | null; installment_number: number | null; installment_total: number | null } | null }
        for (const l of logResults.flatMap(r => (r.data ?? []) as unknown as LogRow[])) {
          const p = l.payables
          if (!l.bank_transaction_id || !p || seen.has(`${l.bank_transaction_id}:${p.id}`)) continue
          seen.add(`${l.bank_transaction_id}:${p.id}`)
          const list = payMap.get(l.bank_transaction_id) ?? []
          list.push({ invoice_number: p.invoice_number, supplier_name: p.supplier_name, supplier_vat: p.supplier_vat, gross_amount: p.gross_amount, invoice_date: p.invoice_date, amount_paid: p.amount_paid, installment_number: p.installment_number, installment_total: p.installment_total })
          payMap.set(l.bank_transaction_id, list)
        }
        for (const f of fdResults.flatMap(r => r.data ?? [])) {
          if (!f.bank_transaction_id) continue
          const list = fdMap.get(f.bank_transaction_id) ?? []
          list.push({ title: f.title, f24_code: f.f24_code, tax_period: f.tax_period, deadline_type: f.deadline_type })
          fdMap.set(f.bank_transaction_id, list)
        }
      }
      setRawMovements(baseMovs.map(m => ({
        ...m,
        supplier: m.suppliers ? { name: m.suppliers.ragione_sociale ?? m.suppliers.name, partita_iva: m.suppliers.partita_iva } : null,
        payables: payMap.get(m.id) ?? [],
        fiscal_deadlines: fdMap.get(m.id) ?? [],
      })))
    } catch (e) {
      // Estrae messaggio leggibile da Error, oggetti Supabase ({message,details,code}), o stringifica
      let msg: string
      if (e instanceof Error) msg = e.message
      else if (e && typeof e === 'object' && 'message' in e) msg = String((e as { message: unknown }).message)
      else { try { msg = JSON.stringify(e) } catch { msg = String(e) } }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [companyId, dateStart, dateEnd, bankAccountId])

  // Fatture pagate nel periodo (passo B): payables per payment_date, con i
  // dizionari per conto, movimento riscontrato, categoria e outlet. Il filtro
  // conto e l'esclusione di segnaposto/previsioni sono lato client
  // (includePagamento), così la regola sta in un posto solo e testato.
  const loadPagamenti = useCallback(async () => {
    if (!companyId) return
    setLoadingPag(true)
    try {
      const dateStart = month ? `${year}-${String(month).padStart(2, '0')}-01` : `${year}-01-01`
      const dateEnd = month ? lastDayOfMonthYMD(year, month) : `${year}-12-31`
      const rows = await fetchAllPaged<Pagamento>(
        (from, to) => supabase
          .from('payables')
          .select(`
            id, payment_date, invoice_number, invoice_date, supplier_name, supplier_vat,
            net_amount, vat_amount, gross_amount, amount_paid, withholding_amount,
            payment_method, payment_method_label, status, closed_manually, manual_close_reason,
            is_provisional_paid, installment_number, installment_total,
            bank_transaction_id, payment_bank_account_id, cost_category_id, outlet_id,
            is_placeholder, is_forecast
          `)
          .eq('company_id', companyId)
          .gte('payment_date', dateStart)
          .lte('payment_date', dateEnd)
          .order('payment_date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
        'payables',
      ) as unknown as Pagamento[]

      const txIds = Array.from(new Set(rows.map(r => r.bank_transaction_id).filter((x): x is string => !!x)))
      const [txResults, catRes, outRes, accRes] = await Promise.all([
        Promise.all(chunk(txIds).map(ids => supabase
          .from('bank_transactions')
          .select('id, transaction_date, bank_account_id, description')
          .in('id', ids))),
        supabase.from('cost_categories').select('id, name, ce_account_code').eq('company_id', companyId),
        supabase.from('outlets').select('id, code, name').eq('company_id', companyId),
        supabase.from('bank_accounts').select('id, bank_name, iban').eq('company_id', companyId),
      ])
      const lk: PnLookups = { bankAccounts: new Map(), bankTx: new Map(), categories: new Map(), outlets: new Map() }
      for (const t of txResults.flatMap(r => r.data ?? [])) lk.bankTx.set(t.id, { transaction_date: t.transaction_date, bank_account_id: t.bank_account_id, description: t.description })
      for (const c of catRes.data ?? []) lk.categories.set(c.id, { name: c.name, ce_account_code: c.ce_account_code })
      for (const o of outRes.data ?? []) lk.outlets.set(o.id, { code: o.code, name: o.name })
      for (const a of accRes.data ?? []) lk.bankAccounts.set(a.id, { bank_name: a.bank_name, iban: a.iban })
      setLookups(lk)
      setPagamenti(sortPagamenti(rows))
    } catch (e) {
      console.error('[PrimaNota] pagamenti:', e)
      setPagamenti([])
    } finally {
      setLoadingPag(false)
    }
  }, [companyId, year, month])

  // Dizionari per gli incassi (passo C): canali con codice terminale e parola
  // chiave, outlet, conti e gli abbinamenti già fatti dal riscontro notturno
  // chiusure ↔ banca per i movimenti del periodo. Le entrate stesse sono già
  // in `movements`: qui si carica solo ciò che serve ad attribuirle.
  const loadIncassiLookups = useCallback(async (movementIds: string[]) => {
    if (!companyId) return
    try {
      const [chRes, outRes, accRes, matchResults] = await Promise.all([
        supabase.from('outlet_payment_channels').select('id, outlet_id, kind, label, terminal_code, bank_account_id, is_active').eq('company_id', companyId),
        supabase.from('outlets').select('id, code, name').eq('company_id', companyId),
        supabase.from('bank_accounts').select('id, bank_name, iban').eq('company_id', companyId),
        Promise.all(chunk(movementIds).map(ids => supabase
          .from('closing_bank_matches')
          .select('bank_transaction_id, match_type, reference_date, outlet_daily_closings!inner(outlet_id, closing_date)')
          .in('bank_transaction_id', ids))),
      ])
      const lk: IncassiLookups = { channels: [], outlets: new Map(), closingMatches: new Map(), bankAccounts: new Map() }
      lk.channels = (chRes.data ?? []).map(c => ({ id: c.id, outlet_id: c.outlet_id, kind: c.kind, label: c.label, terminal_code: c.terminal_code, bank_account_id: c.bank_account_id, is_active: c.is_active }))
      for (const o of outRes.data ?? []) lk.outlets.set(o.id, { code: o.code, name: o.name })
      for (const a of accRes.data ?? []) lk.bankAccounts.set(a.id, { bank_name: a.bank_name, iban: a.iban })
      type MatchRow = { bank_transaction_id: string; match_type: string; reference_date: string | null; outlet_daily_closings: { outlet_id: string; closing_date: string } | null }
      for (const m of matchResults.flatMap(r => (r.data ?? []) as unknown as MatchRow[])) {
        const c = m.outlet_daily_closings
        if (!c) continue
        lk.closingMatches.set(m.bank_transaction_id, { outlet_id: c.outlet_id, closing_date: m.reference_date ?? c.closing_date, match_type: m.match_type })
      }
      setIncassiLk(lk)
    } catch (e) {
      console.error('[PrimaNota] incassi:', e)
    }
  }, [companyId])

  // Dati per la quadratura: i movimenti di una finestra larga (45 giorni prima,
  // 15 dopo) con solo data, importo, scarico e saldo allo scarico, per ricavare
  // i saldi della banca ai confini del periodo; le chiusure di cassa del
  // periodo, con la somma delle righe «Contanti», per il lato cassa.
  const loadQuadraturaData = useCallback(async () => {
    if (!companyId) return
    try {
      let winQ = supabase
        .from('bank_transactions')
        .select('id, bank_account_id, transaction_date, amount, fetched_at:raw_data->>fetchedAt, snapshot:raw_data->extra->>accountBalanceSnapshot, posting_date:raw_data->extra->>postingDate')
        .eq('company_id', companyId)
        .gte('transaction_date', addDays(dateStart, -45))
        .lte('transaction_date', addDays(dateEnd, 15))
      if (bankAccountId !== 'all') winQ = winQ.eq('bank_account_id', bankAccountId)
      const [preRes, clRes] = await Promise.all([
        winQ.limit(10000),
        supabase
          .from('outlet_daily_closings')
          .select('id, outlet_id, closing_date, status, cash_deposit, deposit_bank_amount, deposit_bank_status, cash_expenses, customer_refunds, cash_float_opening, cash_pending_opening, cash_float_declared, cash_pending_declared')
          .eq('company_id', companyId)
          .gte('closing_date', dateStart)
          .lte('closing_date', dateEnd)
          .neq('status', 'bozza')
          .limit(5000),
      ])
      type PreRow = { id: string; bank_account_id: string | null; transaction_date: string; posting_date: string | null; amount: number; fetched_at: string | null; snapshot: string | number | null }
      setWinRaw(((preRes.data ?? []) as unknown as PreRow[]).map(r => ({
        id: r.id, bank_account_id: r.bank_account_id, transaction_date: r.transaction_date, posting_date: r.posting_date || null, amount: Number(r.amount),
        fetched_at: r.fetched_at, snapshot: r.snapshot == null || r.snapshot === '' ? null : Number(r.snapshot),
      })))
      const cls = clRes.data ?? []
      const cashByClosing = new Map<string, number>()
      if (cls.length > 0) {
        const lineResults = await Promise.all(chunk(cls.map(c => c.id)).map(ids => supabase
          .from('outlet_daily_closing_lines')
          .select('closing_id, amount, outlet_payment_channels!inner(kind)')
          .in('closing_id', ids)
          .eq('outlet_payment_channels.kind', 'contanti')))
        for (const l of lineResults.flatMap(r => (r.data ?? []) as unknown as Array<{ closing_id: string; amount: number }>)) {
          cashByClosing.set(l.closing_id, (cashByClosing.get(l.closing_id) ?? 0) + Number(l.amount))
        }
      }
      setClosings(cls.map(c => ({
        outlet_id: c.outlet_id, closing_date: c.closing_date, status: c.status,
        cash_deposit: c.cash_deposit, deposit_bank_amount: c.deposit_bank_amount, deposit_bank_status: c.deposit_bank_status,
        cash_expenses: c.cash_expenses, customer_refunds: c.customer_refunds,
        cash_float_opening: c.cash_float_opening, cash_pending_opening: c.cash_pending_opening,
        cash_float_declared: c.cash_float_declared, cash_pending_declared: c.cash_pending_declared,
        contanti: cashByClosing.get(c.id) ?? 0,
      })))
    } catch (e) {
      console.error('[PrimaNota] quadratura:', e)
      setWinRaw([]); setClosings([])
    }
  }, [companyId, dateStart, dateEnd, bankAccountId])

  // Buste paga dei mesi che un pagamento del periodo può saldare: per ogni
  // mese del periodo, il mese stesso e quello prima (a gennaio, dicembre
  // dell'anno prima). Nome e cognome dall'anagrafica dipendenti.
  const loadSlips = useCallback(async () => {
    if (!companyId) return
    try {
      const months = month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1)
      const pairs = new Map<string, { year: number; month: number }>()
      for (const mm of months) for (const c of competenzeCandidate(`${year}-${String(mm).padStart(2, '0')}-01`)) pairs.set(`${c.year}-${c.month}`, c)
      const orExpr = [...pairs.values()].map(c => `and(year.eq.${c.year},month.eq.${c.month})`).join(',')
      const { data, error: err } = await supabase
        .from('employee_cost_slips')
        .select('id, employee_id, year, month, tipo, netto, outlet_code, employees(cognome, nome, last_name, first_name)')
        .eq('company_id', companyId)
        .or(orExpr)
        .limit(5000)
      if (err) throw err
      type SlipRow = { id: string; employee_id: string | null; year: number; month: number; tipo: string | null; netto: number | null; outlet_code: string | null; employees: { cognome: string | null; nome: string | null; last_name: string | null; first_name: string | null } | null }
      setSlips(((data ?? []) as unknown as SlipRow[]).map(r => ({
        id: r.id, employee_id: r.employee_id, year: r.year, month: r.month, tipo: r.tipo, netto: r.netto == null ? null : Number(r.netto), outlet_code: r.outlet_code,
        cognome: r.employees?.cognome || r.employees?.last_name || null, nome: r.employees?.nome || r.employees?.first_name || null,
      })))
    } catch (e) {
      console.error('[PrimaNota] buste paga:', e)
      setSlips([])
    }
  }, [companyId, year, month])

  type PayRow = { id: string; payment_date: string | null; invoice_date: string | null; gross_amount: number | string; invoice_number: string | null; suppliers: { ragione_sociale: string | null; name: string | null } | null }
  const payLite = (rows: PayRow[]): PayableLite[] => rows.map(p => ({ id: p.id, payment_date: p.payment_date, invoice_date: p.invoice_date, gross_amount: Number(p.gross_amount), invoice_number: p.invoice_number, supplier_name: p.suppliers?.ragione_sociale ?? p.suppliers?.name ?? null }))
  const PAY_SELECT = 'id, payment_date, invoice_date, gross_amount, invoice_number, suppliers(ragione_sociale, name)'
  const loadCardPayables = useCallback(async (from: string, to: string): Promise<PayableLite[]> => {
    if (!companyId) return []
    const { data } = await supabase.from('payables').select(PAY_SELECT).eq('company_id', companyId)
      .in('payment_method', ['carta_credito', 'carta_debito']).gte('payment_date', addDays(from, -45)).lte('payment_date', addDays(to, 45)).limit(2000)
    return payLite((data ?? []) as unknown as PayRow[])
  }, [companyId])
  const loadCardBankMovs = useCallback(async (from: string, to: string): Promise<BankMovLite[]> => {
    if (!companyId) return []
    const { data } = await supabase.from('bank_transactions').select('id, transaction_date, amount, description').eq('company_id', companyId)
      .lt('amount', 0).gte('transaction_date', from).lte('transaction_date', addDays(to, 75)).limit(10000)
    return ((data ?? []) as BankMovLite[]).filter(m => RE_BANCA_CARTA.test(m.description ?? '')).map(m => ({ ...m, amount: Number(m.amount) }))
  }, [companyId])

  // Carte: gli estratti del periodo con le righe importate, il file archiviato
  // (per leggerlo da qui), le fatture pagate con carta intorno al periodo e i
  // movimenti banca che possono saldare gli estratti (fino a 75 giorni dopo).
  const loadCarte = useCallback(async () => {
    if (!companyId) return
    try {
      let q = supabase.from('bank_statements')
        .select('id, filename, file_type, source_label, card_last4, statement_total, settled_bank_transaction_id, period_year, period_month, transaction_count, file_url')
        .eq('company_id', companyId).eq('doc_kind', 'carta').eq('period_year', year)
      if (month) q = q.eq('period_month', month)
      const { data: st, error: e1 } = await q.order('source_label').order('period_month').limit(500)
      if (e1) throw e1
      type StRow = Omit<CardStmt, 'file_path'> & { file_url: string | null }
      const stmts = (st ?? []) as unknown as StRow[]
      const ids = stmts.map(x => x.id)
      const names = stmts.map(x => x.filename)
      const [txRes, impRes, pays, movs] = await Promise.all([
        ids.length > 0 ? supabase.from('card_transactions').select('id, statement_id, row_no, card_last4, purchase_date, posting_date, description, amount, fee, currency, original_amount, payable_id').in('statement_id', ids).order('purchase_date').order('row_no').limit(10000) : Promise.resolve({ data: [], error: null }),
        names.length > 0 ? supabase.from('bank_imports').select('file_name, file_path').eq('company_id', companyId).in('file_name', names).limit(500) : Promise.resolve({ data: [], error: null }),
        loadCardPayables(dateStart, dateEnd),
        loadCardBankMovs(dateStart, dateEnd),
      ])
      if (txRes.error) throw txRes.error
      const pathByName = new Map<string, string>()
      for (const i of (impRes.data ?? []) as Array<{ file_name: string | null; file_path: string | null }>) if (i.file_name && i.file_path) pathByName.set(i.file_name, i.file_path)
      setCardStmts(stmts.map(x => ({ ...x, statement_total: x.statement_total == null ? null : Number(x.statement_total), file_path: x.file_url ?? pathByName.get(x.filename) ?? null })))
      const tx = ((txRes.data ?? []) as unknown as CardTx[]).map(t => ({ ...t, amount: Number(t.amount), fee: Number(t.fee), original_amount: t.original_amount == null ? null : Number(t.original_amount) }))
      setCardTx(tx)
      // Fatture agganciate all'import ma fuori dalla finestra: si caricano per id
      const missing = [...new Set(tx.map(t => t.payable_id).filter((x): x is string => !!x && !pays.some(p => p.id === x)))]
      let extra: PayableLite[] = []
      if (missing.length > 0) {
        const res = await Promise.all(chunk(missing).map(idsChunk => supabase.from('payables').select(PAY_SELECT).in('id', idsChunk)))
        extra = payLite(res.flatMap(r => (r.data ?? []) as unknown as PayRow[]))
      }
      setCardPayables([...pays, ...extra])
      setCardBankMovs(movs)
    } catch (e) {
      console.error('[PrimaNota] carte:', e)
      setCardStmts([]); setCardTx([])
    }
  }, [companyId, year, month, dateStart, dateEnd, loadCardPayables, loadCardBankMovs])

  useEffect(() => { loadBankAccounts() }, [loadBankAccounts])
  useEffect(() => { loadQuadraturaData() }, [loadQuadraturaData])
  useEffect(() => { loadSlips() }, [loadSlips])
  useEffect(() => { loadCarte() }, [loadCarte])
  useEffect(() => { loadMovements() }, [loadMovements])
  useEffect(() => { loadPagamenti() }, [loadPagamenti])
  useEffect(() => { loadIncassiLookups(movements.filter(m => m.amount > 0).map(m => m.id)) }, [movements, loadIncassiLookups])

  // Fatture pagate visibili con il filtro conto corrente
  const pagamentiVisibili = useMemo(
    () => pagamenti.filter(p => includePagamento(p, lookups, bankAccountId)),
    [pagamenti, lookups, bankAccountId],
  )
  const pagRows = useMemo(() => pagamentiVisibili.map(p => buildPagamentoRow(p, lookups, fmtDate)), [pagamentiVisibili, lookups])
  const pagByFonte = useMemo(() => summarizePagamenti(pagamentiVisibili), [pagamentiVisibili])
  const pagTotale = useMemo(() => pagamentiVisibili.reduce((s, p) => s + importoPagato(p), 0), [pagamentiVisibili])
  const senzaRiscontro = useMemo(
    () => pagamentiVisibili.filter(p => { const f = fonteOf(p); return f === 'senza_riscontro' || f === 'provvisoria' }).length,
    [pagamentiVisibili],
  )

  // Righe mostrate in tabella: quelle del filtro a clic, se attivo. Gli export
  // restano sempre completi (la commercialista riceve tutto il periodo).
  const movementsShown = useMemo(
    () => kindFilter ? movements.filter(m => classifyMovement(m) === kindFilter) : movements,
    [movements, kindFilter],
  )
  const pagamentiShown = useMemo(
    () => fonteFilter ? pagamentiVisibili.filter(p => fonteFilter.includes(fonteOf(p))) : pagamentiVisibili,
    [pagamentiVisibili, fonteFilter],
  )
  const pagRowsShown = useMemo(() => pagamentiShown.map(p => buildPagamentoRow(p, lookups, fmtDate)), [pagamentiShown, lookups])
  const toggleKind = (k: MovementKind) => setKindFilter(cur => (cur === k ? null : k))
  const toggleFonte = (fs: PagamentoFonte[]) => setFonteFilter(cur => (cur && cur.join() === fs.join() ? null : fs))

  // Incassi per outlet: le entrate del periodo (giroconti esclusi: non sono
  // incassi) attribuite al punto vendita. Stessa fonte della vista banca.
  const incassi = useMemo(
    () => movements
      .filter(m => m.amount > 0 && classifyMovement(m) !== 'giroconto')
      .map(m => ({ m, a: attribuisciIncasso(m, incassiLk) })),
    [movements, incassiLk],
  )
  const incassiRows = useMemo(() => incassi.map(({ m, a }) => buildIncassoRow(m, a, incassiLk, fmtDate)), [incassi, incassiLk])
  // Contropartita per la Prima Nota: per POS, Amex e versamenti è l'outlet di
  // riferimento (con il canale), non il testo della banca; per il resto quella
  // del movimento (fornitore, F24, beneficiario in causale).
  const contropartitaOf = useMemo(() => {
    const byId = new Map<string, string>()
    for (const { m, a } of incassi) {
      if (!a.outlet_id) continue
      const label = outletLabel(a.outlet_id, incassiLk)
      if (label) byId.set(m.id, a.channel?.label ? `${label}, ${a.channel.label}` : label)
    }
    return (m: Movement): string => byId.get(m.id) ?? counterpartOf(m)
  }, [incassi, incassiLk])
  const byOutlet = useMemo(() => summarizeByOutlet(incassi, incassiLk), [incassi, incassiLk])
  const incassiTot = useMemo(() => {
    const sum = (k: IncassoKind | null) => Math.round(incassi.filter(x => k === null || x.a.kind === k).reduce((s, x) => s + x.m.amount, 0) * 100) / 100
    return { totale: sum(null), pos: sum('pos'), amex: sum('amex'), versamenti: sum('versamento'), altro: sum('altro'), daAttribuire: incassi.filter(x => !x.a.outlet_id).length }
  }, [incassi])
  const incassiShown = useMemo(
    () => outletFilter ? incassi.filter(x => (outletFilter === SENZA_OUTLET ? !x.a.outlet_id : x.a.outlet_id === outletFilter)) : incassi,
    [incassi, outletFilter],
  )
  const incassiRowsShown = useMemo(() => incassiShown.map(({ m, a }) => buildIncassoRow(m, a, incassiLk, fmtDate)), [incassiShown, incassiLk])

  // Dipendenti ed emolumenti: le disposizioni «stipendi» del periodo abbinate
  // alle buste paga, una riga per dipendente con il collegamento al flusso.
  const stipendiFlussi = useMemo<PnFlusso[]>(
    () => movements.filter(m => classifyMovement(m) === 'stipendi').map(m => ({ id: m.id, transaction_date: basisDate(m), amount: Number(m.amount), description: m.description, bank_account_id: m.bank_account_id })),
    [movements, basisDate],
  )
  const stipendi = useMemo(() => abbinaStipendi(stipendiFlussi, slips), [stipendiFlussi, slips])
  const bankNameOf = useCallback((id: string | null) => (id ? bankAccounts.find(b => b.id === id)?.bank_name ?? '—' : ''), [bankAccounts])
  const stipendiRows = useMemo(() => stipendi.rows.map(r => buildStipendioRow(r, bankNameOf, fmtDate)), [stipendi, bankNameOf])
  const movementById = useMemo(() => new Map(movements.map(m => [m.id, m])), [movements])

  // Carte: per ogni estratto le righe, i totali, l'addebito in banca (carta di
  // credito) o le ricariche ritrovate (prepagata) e le fatture pagate.
  // Le carte di credito dello stesso emittente e mese (BCC *3145 e *5388) sono
  // addebitate in banca con un movimento solo, piu' le commissioni: l'addebito
  // si cerca sulla somma del gruppo e vale per tutti gli estratti del gruppo.
  const carte = useMemo(() => {
    const base = cardStmts.map(st => {
      const lines = cardTx.filter(t => t.statement_id === st.id)
      const tot = totaliCarta(lines)
      const computed = r2(lines.reduce((a, l) => a + l.amount + l.fee, 0))
      const isPrepagata = /prepagat/i.test(st.source_label ?? '') || lines.some(l => l.amount > 0 && /RICARICA/i.test(l.description))
      const period = st.period_year && st.period_month ? { year: st.period_year, month: st.period_month } : null
      const groupKey = `${(st.source_label ?? st.filename).replace(/\s*\*\d{4}$/, '')}|${period ? `${period.year}-${period.month}` : st.id}`
      const ricariche = isPrepagata ? matchRicariche(lines, cardBankMovs) : new Map<number, BankMovLite>()
      const nRicariche = lines.filter(l => l.amount > 0 && /RICARICA/i.test(l.description)).length
      return { stmt: st, lines, tot, computed, isPrepagata, period, groupKey, ricariche, nRicariche, label: st.source_label ?? st.filename }
    })
    const groups = new Map<string, typeof base>()
    for (const c of base) if (!c.isPrepagata && c.lines.length > 0) groups.set(c.groupKey, [...(groups.get(c.groupKey) ?? []), c])
    const debitByGroup = new Map<string, { movement: BankMovLite | null; differenza: number; n: number }>()
    for (const [k, g] of groups) {
      const stored = g.map(c => c.stmt.settled_bank_transaction_id).find(Boolean)
      const mov = stored ? cardBankMovs.find(m => m.id === stored) ?? null : null
      const total = r2(g.reduce((a, c) => a + (c.stmt.statement_total ?? c.computed), 0))
      const d = mov ? { movement: mov, differenza: r2(total - mov.amount) } : matchStatementDebit({ total_declared: total, total_computed: total, period: g[0].period, debit_date: null }, cardBankMovs)
      debitByGroup.set(k, { ...d, n: g.length })
    }
    return base.map(c => ({ ...c, debit: debitByGroup.get(c.groupKey) ?? { movement: null, differenza: 0, n: 1 } }))
  }, [cardStmts, cardTx, cardBankMovs])
  const cartePay = useMemo(() => {
    const byId = new Map(cardPayables.map(p => [p.id, p]))
    const stored = new Set(cardTx.map(t => t.payable_id).filter(Boolean) as string[])
    return carte.map(c => {
      const m = matchPayables(c.lines, cardPayables.filter(p => !stored.has(p.id)))
      c.lines.forEach((l, i) => { if (l.payable_id && byId.has(l.payable_id)) m.set(i, byId.get(l.payable_id)!) })
      return m
    })
  }, [carte, cardPayables, cardTx])
  const riscontroOf = useCallback((ci: number, li: number): string => {
    const c = carte[ci]; const l = c.lines[li]
    if (c.isPrepagata) { const r = c.ricariche.get(li); return l.amount > 0 && /RICARICA/i.test(l.description) ? (r ? `addebito in banca il ${fmtDate(r.transaction_date)}` : 'ricarica non trovata in banca') : '' }
    return c.debit.movement ? `estratto addebitato il ${fmtDate(c.debit.movement.transaction_date)}` : 'addebito estratto non trovato'
  }, [carte])
  const carteRows = useMemo(() => carte.flatMap((c, ci) => c.lines.map((l, li) => buildCartaRow(c.label, l, cartePay[ci].get(li), riscontroOf(ci, li), fmtDate))), [carte, cartePay, riscontroOf])
  const carteTot = useMemo(() => ({
    n: carte.length, spese: r2(carte.reduce((a, c) => a + c.tot.spese, 0)), accrediti: r2(carte.reduce((a, c) => a + c.tot.accrediti, 0)),
    righe: cardTx.length, senzaRighe: carte.filter(c => c.lines.length === 0).length,
    addebitiTrovati: carte.filter(c => !c.isPrepagata && c.lines.length > 0 && c.debit.movement).length, addebitiAttesi: carte.filter(c => !c.isPrepagata && c.lines.length > 0).length,
    fattureAgganciate: cartePay.reduce((a, m) => a + m.size, 0), speseN: cardTx.filter(t => t.amount < 0).length,
  }), [carte, cartePay, cardTx])

  // Import: legge il file (PDF via pdf.js, Excel via SheetJS) e propone l'anteprima
  const parseCardFile = useCallback(async (file: File): Promise<CardStatementParsed> => {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (ext === 'pdf') {
      const { extractPdfLines } = await import('../lib/pdfText')
      return parseCardStatementLines(await extractPdfLines(file))
    }
    const XLSX = await import('xlsx')
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true })
    let best: CardStatementParsed | null = null
    for (const name of wb.SheetNames) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) as AoaCell[][]
      const parsed = parseTascaAoa(aoa)
      if (!best || parsed.lines.length > best.lines.length) best = parsed
    }
    return best ?? parseTascaAoa([])
  }, [])
  const findExistingStatement = useCallback(async (label: string, last4: string | null, period: { year: number; month: number } | null): Promise<{ stmt: CardStmt | null; lines: number }> => {
    if (!companyId || !period) return { stmt: null, lines: 0 }
    const { data } = await supabase.from('bank_statements').select('id, filename, file_type, source_label, card_last4, statement_total, settled_bank_transaction_id, period_year, period_month, transaction_count, file_url')
      .eq('company_id', companyId).eq('doc_kind', 'carta').eq('period_year', period.year).eq('period_month', period.month).limit(50)
    const prefix = label.replace(/\s*\*\d{4}$/, '')
    const hit = ((data ?? []) as unknown as Array<Omit<CardStmt, 'file_path'> & { file_url: string | null }>).find(x =>
      (last4 && (x.card_last4 === last4 || (x.source_label ?? '').includes(last4))) || (!last4 && (x.source_label ?? '').startsWith(prefix)))
    if (!hit) return { stmt: null, lines: 0 }
    const { count } = await supabase.from('card_transactions').select('id', { count: 'exact', head: true }).eq('statement_id', hit.id)
    return { stmt: { ...hit, statement_total: hit.statement_total == null ? null : Number(hit.statement_total), file_path: hit.file_url }, lines: count ?? 0 }
  }, [companyId])
  const onCardFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setCardParsing(true)
    try {
      const items: CardImportItem[] = []
      for (const file of Array.from(files)) {
        const parsed = await parseCardFile(file)
        const last4 = parsed.cards[0]?.card_last4 ?? null
        const label = sourceLabelOf(parsed.issuer, last4)
        const ex = await findExistingStatement(label, last4, parsed.period)
        items.push({ file, fileName: file.name, parsed, existing: ex.stmt, existingLines: ex.lines, label: ex.stmt?.source_label ?? label })
      }
      setCardImport({ items, busy: false })
    } catch (e) {
      toast({ type: 'error', message: `Lettura del file fallita: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setCardParsing(false)
      if (cardFileRef.current) cardFileRef.current.value = ''
    }
  }
  const readCardFromArchive = async (st: CardStmt) => {
    if (!st.file_path) return
    setCardParsing(true)
    try {
      const { data, error: dErr } = await supabase.storage.from('bank-statements').download(st.file_path)
      if (dErr || !data) throw dErr ?? new Error('file non trovato nel bucket')
      const file = new File([data], st.filename.split('/').pop() ?? st.filename, { type: data.type })
      const parsed = await parseCardFile(file)
      setCardImport({ items: [{ file: null, fileName: st.filename, parsed, existing: st, existingLines: cardTx.filter(t => t.statement_id === st.id).length, label: st.source_label ?? sourceLabelOf(parsed.issuer, parsed.cards[0]?.card_last4 ?? null) }], busy: false })
    } catch (e) {
      toast({ type: 'error', message: `Lettura dall'archivio fallita: ${e instanceof Error ? e.message : String(e)}` })
    } finally { setCardParsing(false) }
  }
  const saveCardImport = async () => {
    if (!cardImport || !companyId) return
    setCardImport(c => (c ? { ...c, busy: true } : c))
    let ok = 0
    const errs: string[] = []
    for (const it of cardImport.items) {
      if (it.parsed.lines.length === 0 || it.existingLines > 0) continue
      try {
        const period = it.parsed.period
        const last4 = it.parsed.cards[0]?.card_last4 ?? it.existing?.card_last4 ?? null
        const total = it.parsed.total_declared ?? it.parsed.total_computed
        let stmtId = it.existing?.id ?? null
        if (!stmtId) {
          if (!it.file) throw new Error('file mancante')
          const arch = await archiviaFile({ file: it.file, companyId, userId: null, modulo: 'Banche', funzione: `Estratto carta · ${it.label}`, bucket: 'bank-statements', year: period?.year ?? null, month: period?.month ?? null, referenceTable: 'bank_statements' })
          if (arch.errore) throw new Error(arch.errore)
          const ext = (it.file.name.split('.').pop() ?? '').toLowerCase()
          const { data: ins, error: iErr } = await supabase.from('bank_statements').insert({
            company_id: companyId, bank_account_id: null, filename: it.file.name, file_type: ext === 'pdf' ? 'pdf' : ext === 'csv' ? 'csv' : 'xlsx', status: 'completed',
            doc_kind: 'carta', source_label: it.label, period_year: period?.year ?? null, period_month: period?.month ?? null,
            card_last4: last4, statement_total: total, transaction_count: it.parsed.lines.length, import_document_id: arch.id, file_url: arch.path,
          }).select('id').single()
          if (iErr) throw iErr
          stmtId = ins.id
        } else {
          const { error: uErr } = await supabase.from('bank_statements').update({ card_last4: last4, statement_total: total, transaction_count: it.parsed.lines.length }).eq('id', stmtId)
          if (uErr) throw uErr
        }
        const pStart = period ? `${period.year}-${pad2(period.month)}-01` : dateStart
        const pEnd = period ? lastDayOfMonthYMD(period.year, period.month) : dateEnd
        const pm = matchPayables(it.parsed.lines, await loadCardPayables(pStart, pEnd))
        const rows = it.parsed.lines.map((l, i) => ({
          company_id: companyId, statement_id: stmtId!, row_no: i + 1, card_last4: l.card_last4 ?? last4, purchase_date: l.purchase_date, posting_date: l.posting_date,
          description: l.description, amount: l.amount, fee: l.fee, currency: l.currency, original_amount: l.original_amount, payable_id: pm.get(i)?.id ?? null,
        }))
        for (const part of chunk(rows, 500)) { const { error: tErr } = await supabase.from('card_transactions').insert(part); if (tErr) throw tErr }
        // L'addebito in banca si cerca a video sulla somma degli estratti dello stesso emittente e mese (vedi carte)
        ok++
      } catch (e) {
        errs.push(`${it.fileName}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setCardImport(null)
    if (errs.length > 0) toast({ type: 'error', message: `${ok} estratti importati, ${errs.length} falliti: ${errs.join('; ')}`, duration: 12000 })
    else toast({ type: 'success', message: `${ok} estratti carta importati` })
    loadCarte()
  }
  const toggleOutlet = (id: string) => setOutletFilter(cur => (cur === id ? null : id))
  // Cambiando periodo, conto o vista il filtro a clic si azzera
  useEffect(() => { setKindFilter(null); setFonteFilter(null); setOutletFilter(null) }, [year, month, bankAccountId, view])

  const totals = useMemo(() => {
    const dare = movements.filter(m => m.amount > 0).reduce((s, m) => s + m.amount, 0)
    const avere = movements.filter(m => m.amount < 0).reduce((s, m) => s + Math.abs(m.amount), 0)
    const daChiarire = movements.filter(m => classifyMovement(m) === 'da_chiarire').length
    return { dare, avere, netto: dare - avere, count: movements.length, daChiarire }
  }, [movements])

  const byKind = useMemo(() => summarizeByKind(movements), [movements])

  // Quadratura con l'estratto conto, per conto, e del contante
  const quadratura = useMemo<QuadraturaConto[]>(() => {
    const rows: PnTxSnapshot[] = winRaw.map(r => ({ id: r.id, bank_account_id: r.bank_account_id, date: basisDate(r), amount: r.amount, fetched_at: r.fetched_at, snapshot: r.snapshot }))
    return quadraturaConti(rows, dateStart, dateEnd)
      .sort((a, b) => (bankAccounts.find(x => x.id === a.bank_account_id)?.bank_name ?? '').localeCompare(bankAccounts.find(x => x.id === b.bank_account_id)?.bank_name ?? '', 'it'))
  }, [winRaw, basisDate, dateStart, dateEnd, bankAccounts])
  // Saldo progressivo dopo ogni movimento, per conto, dal saldo iniziale alla data (null se la banca non l'ha fornito)
  const saldoById = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const q of quadratura) {
      const saldi = saldiProgressivi(q.movimenti, q.saldo_iniziale)
      q.movimenti.forEach((m, i) => map.set(m.id, saldi[i]))
    }
    return map
  }, [quadratura])
  const quadContante = useMemo<QuadraturaContante>(
    () => quadraturaContante(movements.map(m => ({ amount: Number(m.amount), description: m.description, isVersamento: classifyMovement(m) === 'versamento' })), closings),
    [movements, closings],
  )
  const accountName = (id: string) => bankAccounts.find(b => b.id === id)?.bank_name ?? '—'
  const fmtDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
  // Confini del periodo per data operazione: il saldo iniziale è al giorno prima, quello finale all'ultimo giorno
  const quadPeriodo = useMemo(() => ({ giornoPrima: fmtDate(prevDay(dateStart)), ultimoGiorno: fmtDate(dateEnd) }), [dateStart, dateEnd])
  const sumRows = (rows: PnTxSnapshot[]) => rows.reduce((s, r) => s + r.amount, 0)
  const rettificaLabel = (r: { piu: PnTxSnapshot[]; meno: PnTxSnapshot[] }) =>
    [r.piu.length ? `+ ${r.piu.length} mov. arrivati dopo lo scarico (${fmt(sumRows(r.piu))})` : '', r.meno.length ? `− ${r.meno.length} mov. già nello scarico ma datati dopo (${fmt(sumRows(r.meno))})` : ''].filter(Boolean).join('; ')

  // Righe formato Prima Nota standardizzato (una per movimento, fatture in causale)
  const rows = useMemo(() => movements.map(m => ({ ...buildRow(m, fmtDate, contropartitaOf(m)), 'Saldo progressivo': saldoById.get(m.id) ?? '' })), [movements, saldoById, contropartitaOf])

  const exportCsv = () => {
    const src: Array<Record<string, unknown>> = view === 'banca' ? rows : view === 'pagamenti' ? pagRows : view === 'incassi' ? incassiRows : view === 'dipendenti' ? stipendiRows : carteRows
    if (src.length === 0) return
    const headers = Object.keys(src[0])
    const csvRows = [
      headers.join(';'),
      ...src.map(r => headers.map(h => {
        const v = (r as Record<string, unknown>)[h]
        const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : String(v ?? '')
        return s.includes(';') || s.includes('\n') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(';')),
    ]
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${view === 'banca' ? 'prima_nota' : view === 'pagamenti' ? 'pagamenti_fornitori' : view === 'incassi' ? 'incassi_outlet' : view === 'dipendenti' ? 'dipendenti_emolumenti' : 'carte'}_${year}${month ? '-' + String(month).padStart(2, '0') : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportXlsx = async () => {
    if (rows.length === 0) return
    // xlsx caricata on-demand: ~140KB gzip che non devono pesare sull'apertura pagina
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const periodoLabel = month ? `${MONTHS.find(m => m.v === month)?.l} ${year}` : `Anno ${year}`
    // Un foglio per conto, come un estratto conto: saldo iniziale, movimenti con
    // saldo progressivo, saldo finale calcolato e della banca, differenza.
    const used = new Set<string>(['Tutti i movimenti', 'Pagamenti fornitori', 'Incassi per outlet', 'Dipendenti ed emolumenti', 'Riepilogo'])
    for (const q of quadratura) {
      const acc = bankAccounts.find(b => b.id === q.bank_account_id)
      const ms = movements.filter(m => m.bank_account_id === q.bank_account_id)
      if (ms.length === 0 && q.saldo_iniziale == null) continue
      const aoa: Array<Array<string | number>> = [
        ['Estratto conto', acc?.bank_name ?? '—'],
        ['IBAN', acc?.iban ?? ''],
        ['Periodo', `${periodoLabel} (dal ${fmtDate(dateStart)} al ${fmtDate(dateEnd)}, per ${dateBasis === 'contabile' ? 'data contabile' : 'data operazione'})`],
        [],
        ['Data operazione', 'Data contabile', 'Tipo movimento', 'Contropartita', 'P.IVA', 'N. fatture', 'Causale', 'Categoria', 'Entrate', 'Uscite', 'Saldo', 'Di cui fattura'],
        [`Saldo iniziale al ${quadPeriodo.giornoPrima}`, q.saldo_scarico_iniziale != null ? `banca al ${fmtDateTime(q.scaricato_iniziale)}: ${fmt(q.saldo_scarico_iniziale)}${rettificaLabel(q.rettifica_iniziale) ? ' ' + rettificaLabel(q.rettifica_iniziale) : ''}` : 'saldo banca non disponibile', '', '', '', '', '', '', '', '', q.saldo_iniziale ?? ''],
        ...ms.flatMap(m => {
          const r = buildRow(m, fmtDate, contropartitaOf(m))
          const rows: Array<Array<string | number>> = [[r['Data operazione'], r['Data contabile'], r['Tipo movimento'], r.Contropartita, r['P.IVA Contropartita'], r['N. fatture'], r.Causale, r.Categoria,
            m.amount > 0 ? Math.round(m.amount * 100) / 100 : '', m.amount < 0 ? Math.round(-m.amount * 100) / 100 : '', saldoById.get(m.id) ?? '', '']]
          // Movimento che salda piu' fatture (RiBa, distinta CBI): sotto, una riga per
          // fattura con il suo importo nella colonna «Di cui fattura», cosi' lo studio
          // verifica ogni fattura e ogni importo; la somma delle righe e' l'uscita, e
          // l'eventuale resto (commissioni, acconto, nota di credito) ha la sua riga.
          if (m.payables.length > 1) {
            let somma = 0
            for (const p of m.payables) {
              const imp = Math.round(Number(p.amount_paid ?? p.gross_amount ?? 0) * 100) / 100
              somma += imp
              const rata = p.installment_total && p.installment_total > 1 ? ` · rata ${p.installment_number ?? '?'}/${p.installment_total}` : ''
              rows.push(['', '', '↳ di cui fattura', p.supplier_name ?? '', p.supplier_vat ?? '', '', `Fatt. ${p.invoice_number ?? '?'}${p.invoice_date ? ` del ${fmtDate(p.invoice_date)}` : ''}${rata}`, '', '', '', '', imp])
            }
            const resto = Math.round((Math.abs(m.amount) - somma) * 100) / 100
            if (Math.abs(resto) >= 0.005) rows.push(['', '', '↳ resto', resto > 0 ? 'commissioni o acconto non in fattura' : 'nota di credito o sconto', '', '', '', '', '', '', '', resto])
            rows.push(['', '', '↳ totale fatture', `${m.payables.length} fatture`, '', '', '', '', '', '', '', Math.round(Math.abs(m.amount) * 100) / 100])
          }
          return rows
        }),
        [`Saldo finale al ${quadPeriodo.ultimoGiorno} (calcolato)`, `${ms.length} movimenti`, '', '', '', '', '', '', q.entrate, q.uscite, q.saldo_finale_calcolato ?? ''],
        [`Saldo finale al ${quadPeriodo.ultimoGiorno} (banca)`, q.saldo_scarico_finale != null ? `banca al ${fmtDateTime(q.scaricato_finale)}: ${fmt(q.saldo_scarico_finale)}${rettificaLabel(q.rettifica_finale) ? ' ' + rettificaLabel(q.rettifica_finale) : ''}` : 'saldo banca non disponibile', '', '', '', '', '', '', '', '', q.saldo_finale ?? ''],
        ['Differenza', q.stato === 'quadra' ? 'quadra' : q.stato === 'non_quadra' ? 'NON QUADRA' : 'saldi banca non disponibili', '', '', '', '', '', '', '', '', q.differenza ?? ''],
      ]
      const wsAcc = XLSX.utils.aoa_to_sheet(aoa)
      wsAcc['!cols'] = [30, 14, 22, 35, 16, 8, 60, 18, 14, 14, 14, 14].map(wch => ({ wch }))
      XLSX.utils.book_append_sheet(wb, wsAcc, sheetName(acc?.bank_name ?? 'Conto', used))
    }
    // Tutti i movimenti in un foglio piatto (per filtri e pivot), con IBAN in chiaro e saldo progressivo
    const ws = XLSX.utils.json_to_sheet(rows.length > 0 ? rows : [{ Nota: 'Nessun movimento nel periodo' }])
    ws['!cols'] = [...PN_COLUMN_WIDTHS, 14].map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, 'Tutti i movimenti')
    // Foglio Pagamenti fornitori: una riga per fattura pagata nel periodo
    const wsPag = XLSX.utils.json_to_sheet(pagRows.length > 0 ? pagRows : [{ Nota: 'Nessuna fattura pagata nel periodo' }])
    wsPag['!cols'] = PAGAMENTI_COLUMN_WIDTHS.map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, wsPag, 'Pagamenti fornitori')
    // Foglio Incassi per outlet: una riga per entrata, con outlet, canale e come è stato attribuito
    const wsInc = XLSX.utils.json_to_sheet(incassiRows.length > 0 ? incassiRows : [{ Nota: 'Nessun incasso nel periodo' }])
    wsInc['!cols'] = INCASSI_COLUMN_WIDTHS.map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, wsInc, 'Incassi per outlet')
    // Foglio Dipendenti ed emolumenti: una riga per busta paga con il netto e la disposizione che l'ha pagata; in coda i flussi senza buste
    const wsDip = XLSX.utils.json_to_sheet(stipendiRows.length > 0 ? stipendiRows : [{ Nota: 'Nessuna busta paga né disposizione per emolumenti nel periodo' }])
    wsDip['!cols'] = STIPENDI_COLUMN_WIDTHS.map(wch => ({ wch }))
    if (stipendi.flussi_non_abbinati.length > 0) {
      XLSX.utils.sheet_add_aoa(wsDip, [
        [],
        ['Disposizioni senza buste paga che le spieghino', 'Pagato il', 'Conto Banca', 'ID flusso', 'Bonifici nel flusso (banca)', 'Importo flusso', 'Commissioni flusso', 'Causale'],
        ...stipendi.flussi_non_abbinati.map(x => [
          '', fmtDate(x.flusso.transaction_date), bankNameOf(x.flusso.bank_account_id), x.info.id_flusso ?? '', x.info.n_pagamenti ?? '',
          x.info.importo_bonifici ?? Math.round(-x.flusso.amount * 100) / 100, x.info.commissioni ?? '', x.flusso.description ?? '',
        ]),
      ], { origin: -1 })
    }
    XLSX.utils.book_append_sheet(wb, wsDip, 'Dipendenti ed emolumenti')
    // Un foglio per carta, come per i conti: intestazione, righe, totale letto e dichiarato, addebito in banca, differenza
    carte.forEach((c, ci) => {
      if (c.lines.length === 0) return
      const pm = cartePay[ci]
      const aoaC: Array<Array<string | number>> = [
        ['Estratto carta', c.label],
        ['Carta', c.stmt.card_last4 ? `**** ${c.stmt.card_last4}` : ''],
        ['Periodo', c.stmt.period_year && c.stmt.period_month ? `${MONTHS.find(m => m.v === c.stmt.period_month)?.l} ${c.stmt.period_year}` : periodoLabel],
        ['File', c.stmt.filename],
        [],
        ['Data acquisto', 'Data registrazione', 'Descrizione', 'Importo', 'Commissioni', 'Valuta', 'Fornitore', 'Fattura', 'Pagata il', 'Riscontro banca'],
        ...c.lines.map((l, li) => {
          const r = buildCartaRow(c.label, l, pm.get(li), riscontroOf(ci, li), fmtDate)
          return [r['Data acquisto'], r['Data registrazione'], r.Descrizione, r.Importo, r.Commissioni, r.Valuta, r.Fornitore, r.Fattura, r['Pagata il'], r['Riscontro banca']] as Array<string | number>
        }),
        ['Totale operazioni (righe lette)', `${c.lines.length} operazioni: spese ${fmt(c.tot.spese)}, accrediti ${fmt(c.tot.accrediti)}, commissioni ${fmt(c.tot.commissioni)}`, '', c.computed],
        ['Totale dichiarato dal documento', '', '', c.stmt.statement_total ?? 'n.d.'],
        ...(c.isPrepagata
          ? [['Ricariche ritrovate in banca', `${c.ricariche.size} su ${c.nRicariche}`, '', '']]
          : [
            ['Addebito in banca', c.debit.movement ? `${fmtDate(c.debit.movement.transaction_date)}: ${c.debit.movement.description ?? ''}` : 'non trovato', '', c.debit.movement?.amount ?? ''],
            ['Differenza (commissioni della banca)', c.debit.movement ? (Math.abs(c.debit.differenza) < 0.005 ? 'quadra' : `quadra: l'addebito copre ${c.debit.n} estratti piu' ${fmt(c.debit.differenza)} di commissioni`) : 'addebito non trovato', '', c.debit.movement ? c.debit.differenza : ''],
          ]),
      ]
      const wsC = XLSX.utils.aoa_to_sheet(aoaC)
      wsC['!cols'] = [30, 16, 50, 12, 11, 7, 30, 18, 12, 30].map(wch => ({ wch }))
      XLSX.utils.book_append_sheet(wb, wsC, sheetName(c.label, used))
    })
    // Sheet riepilogo: totali del periodo + righe e importi per tipo di movimento
    const summaryData: Array<Array<string | number>> = [
      ['Periodo', `${periodoLabel} (per ${dateBasis === 'contabile' ? 'data contabile' : 'data operazione'})`],
      ['Conto', bankAccountId === 'all' ? 'Tutti i conti' : bankAccounts.find(b => b.id === bankAccountId)?.bank_name ?? '—'],
      ['Movimenti', totals.count],
      ['Totale Dare (entrate)', totals.dare],
      ['Totale Avere (uscite)', totals.avere],
      ['Saldo netto', totals.netto],
      ['Generato il', new Date().toLocaleString('it-IT')],
      [],
      ['Tipo movimento', 'Movimenti', 'Entrate', 'Uscite'],
      ...byKind.map(k => [k.label, k.n, k.entrate, k.uscite]),
      [],
      ['Pagamenti fornitori (per fonte)', 'Fatture', 'Importo pagato'],
      ...pagByFonte.map(f => [f.label, f.n, f.importo]),
      ['Totale fatture pagate', pagamentiVisibili.length, Math.round(pagTotale * 100) / 100],
      [],
      ['Incassi per outlet', 'Movimenti', 'POS', 'Amex', 'Versamenti contanti', 'Altri incassi', 'Totale'],
      ...byOutlet.map(o => [o.label, o.n, o.pos, o.amex, o.versamenti, o.altro, o.totale]),
      ['Totale incassi', incassi.length, incassiTot.pos, incassiTot.amex, incassiTot.versamenti, incassiTot.altro, incassiTot.totale],
      [],
      ['Dipendenti ed emolumenti', 'N.', 'Importo'],
      ['Disposizioni per emolumenti nel periodo', stipendi.n_flussi, stipendi.totale_bonifici],
      ['Commissioni sulle disposizioni', '', stipendi.totale_commissioni],
      ['Buste paga abbinate a una disposizione', stipendi.n_buste_abbinate, stipendi.totale_netti_abbinati],
      ['Buste paga del mese prima senza pagamento nel periodo', stipendi.n_buste_non_abbinate, ''],
      ['Disposizioni senza buste che le spieghino', stipendi.flussi_non_abbinati.length, Math.round(stipendi.flussi_non_abbinati.reduce((s, x) => s + (x.info.importo_bonifici ?? -x.flusso.amount), 0) * 100) / 100],
      [],
      ['Carte', 'Operazioni', 'Spese', 'Accrediti', 'Commissioni', 'Totale dichiarato', 'Addebito in banca', 'Fatture agganciate'],
      ...carte.map((c, ci) => [c.label, c.lines.length, c.tot.spese, c.tot.accrediti, c.tot.commissioni, c.stmt.statement_total ?? 'n.d.',
        c.isPrepagata ? `ricariche ${c.ricariche.size}/${c.nRicariche}` : c.lines.length === 0 ? 'righe non importate' : c.debit.movement ? `${fmtDate(c.debit.movement.transaction_date)} ${fmt(c.debit.movement.amount)}${c.debit.n > 1 ? ` per ${c.debit.n} estratti` : ''}${Math.abs(c.debit.differenza) < 0.005 ? '' : ` (commissioni ${fmt(c.debit.differenza)})`}` : 'non trovato',
        cartePay[ci].size]),
      ['Totale carte', carteTot.righe, carteTot.spese, carteTot.accrediti, '', '', `${carteTot.addebitiTrovati} su ${carteTot.addebitiAttesi}`, carteTot.fattureAgganciate],
      [],
      ['Quadratura con l\'estratto conto', `Saldo al ${quadPeriodo.giornoPrima}`, 'di cui letto dalla banca il', 'Entrate', 'Uscite', `Saldo al ${quadPeriodo.ultimoGiorno} calcolato`, `Saldo al ${quadPeriodo.ultimoGiorno} (banca)`, 'di cui letto dalla banca il', 'Differenza', 'Esito'],
      ...quadratura.map(q => [
        accountName(q.bank_account_id), q.saldo_iniziale ?? '',
        q.saldo_scarico_iniziale != null ? `${fmtDateTime(q.scaricato_iniziale)}: ${fmt(q.saldo_scarico_iniziale)} ${rettificaLabel(q.rettifica_iniziale)}`.trim() : 'n.d.',
        q.entrate, q.uscite, q.saldo_finale_calcolato ?? '', q.saldo_finale ?? '',
        q.saldo_scarico_finale != null ? `${fmtDateTime(q.scaricato_finale)}: ${fmt(q.saldo_scarico_finale)} ${rettificaLabel(q.rettifica_finale)}`.trim() : 'n.d.',
        q.differenza ?? '',
        q.stato === 'quadra' ? 'quadra' : q.stato === 'non_quadra' ? 'NON QUADRA' : 'saldi banca non disponibili',
      ]),
      [],
      ['Contante', 'Importo', 'N.'],
      ['Versamenti di contante in banca', quadContante.versamenti_banca, quadContante.n_versamenti_banca],
      ['Prelievi di contante dalla banca', quadContante.prelievi_banca, quadContante.n_prelievi_banca],
      ...(quadContante.cassa ? [
        ['Chiusure di cassa nel periodo', quadContante.cassa.n_chiusure, quadContante.cassa.outlets],
        ['Fondo cassa e da versare a inizio periodo', quadContante.cassa.fondo_iniziale ?? 'non noto', ''],
        ['Contanti incassati nei negozi', quadContante.cassa.contanti_incassati, ''],
        ['Spese di cassa', quadContante.cassa.spese, ''],
        ['Rimborsi in contanti', quadContante.cassa.rimborsi, ''],
        ['Versamenti dichiarati nelle chiusure', quadContante.cassa.versamenti_dichiarati, quadContante.cassa.n_versamenti_dichiarati],
        ['di cui ritrovati in banca', quadContante.cassa.versamenti_trovati_in_banca, quadContante.cassa.n_versamenti_trovati],
        ['Fondo cassa e da versare a fine periodo (contato)', quadContante.cassa.fondo_finale ?? 'non noto', ''],
        ['Fondo cassa e da versare a fine periodo (calcolato)', quadContante.cassa.fondo_finale_calcolato ?? 'non noto', ''],
        ['Differenza cassa', quadContante.cassa.differenza ?? '', ''],
      ] : [['Chiusure di cassa nel periodo', 'nessuna: il contante si legge solo dal lato banca', '']]),
    ]
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)
    wsSummary['!cols'] = [{ wch: 34 }, { wch: 25 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 22 }]
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Riepilogo')
    XLSX.writeFile(wb, `prima_nota_${year}${month ? '-' + String(month).padStart(2, '0') : ''}.xlsx`)
  }

  const KindBadge = ({ m }: { m: Movement }) => {
    const k = classifyMovement(m)
    return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${KIND_BADGE[k]}`}>{KIND_LABELS[k]}</span>
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-600">
          Riepilogo movimenti bancari per periodo, formato pronto per la commercialista.
          Sorgente: <strong>banche A-Cube</strong>. Ogni riga dice che tipo di movimento è e
          quali fatture o F24 salda.
        </p>
      </div>

      {/* Filtri */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-slate-600 flex items-center gap-1"><Calendar size={12} /> Anno</span>
          <select value={year} onChange={e => setYear(parseInt(e.target.value))}
            className="mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            {[today.getFullYear() - 2, today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Mese</span>
          <select value={month ?? ''} onChange={e => setMonth(e.target.value ? parseInt(e.target.value) : null)}
            className="mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="">Tutto l'anno</option>
            {MONTHS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
          </select>
        </label>
        <label className="block flex-1 min-w-[200px]">
          <span className="text-xs text-slate-600 flex items-center gap-1"><Filter size={12} /> Conto</span>
          <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="all">Tutti i conti</option>
            {bankAccounts.map(b => (
              <option key={b.id} value={b.id}>
                {b.bank_name}{b.account_name ? ` — ${b.account_name}` : ''}{b.iban ? ` (***${b.iban.slice(-6)})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Periodo per</span>
          <select value={dateBasis} onChange={e => setDateBasis(e.target.value as DateBasis)} title="Data contabile: quella stampata dalla banca sull'estratto conto. Data operazione: quella in cui è avvenuto il movimento."
            className="mt-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
            <option value="contabile">Data contabile (banca)</option>
            <option value="operazione">Data operazione</option>
          </select>
        </label>
        <button onClick={loadMovements} disabled={loading} title="Aggiorna"
          className="px-3 py-2 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
        <div className="flex-1" />
        <button onClick={exportCsv} disabled={(view === 'banca' ? rows : view === 'pagamenti' ? pagRows : view === 'incassi' ? incassiRows : view === 'dipendenti' ? stipendiRows : carteRows).length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg text-sm font-medium">
          <Download size={14} /> CSV
        </button>
        <button onClick={exportXlsx} disabled={rows.length === 0 && pagRows.length === 0}
          className="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
          <FileSpreadsheet size={14} /> Excel
        </button>
      </div>

      {/* Vista: movimenti banca (una riga per movimento) o pagamenti fornitori (una riga per fattura) */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 mb-4" role="tablist" aria-label="Vista prima nota">
        <button role="tab" aria-selected={view === 'banca'} onClick={() => setView('banca')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view === 'banca' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Landmark size={14} /> Movimenti banca <span className="text-xs opacity-70">{totals.count}</span>
        </button>
        <button role="tab" aria-selected={view === 'pagamenti'} onClick={() => setView('pagamenti')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view === 'pagamenti' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Receipt size={14} /> Pagamenti fornitori <span className="text-xs opacity-70">{pagamentiVisibili.length}</span>
        </button>
        <button role="tab" aria-selected={view === 'incassi'} onClick={() => setView('incassi')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view === 'incassi' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Store size={14} /> Incassi per outlet <span className="text-xs opacity-70">{incassi.length}</span>
        </button>
        <button role="tab" aria-selected={view === 'dipendenti'} onClick={() => setView('dipendenti')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view === 'dipendenti' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <Users size={14} /> Dipendenti <span className="text-xs opacity-70">{stipendi.rows.length}</span>
        </button>
        <button role="tab" aria-selected={view === 'carte'} onClick={() => setView('carte')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${view === 'carte' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          <CreditCard size={14} /> Carte <span className="text-xs opacity-70">{carte.length}</span>
        </button>
      </div>

      {view === 'banca' && (<>
      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <KpiBox label="Movimenti" value={totals.count.toString()} color="slate" />
        <KpiBox label="Entrate (Dare)" value={`€ ${fmt(totals.dare)}`} color="emerald" />
        <KpiBox label="Uscite (Avere)" value={`€ ${fmt(totals.avere)}`} color="red" />
        <KpiBox label="Saldo netto" value={`€ ${fmt(totals.netto)}`} color={totals.netto >= 0 ? 'emerald' : 'red'} />
        <KpiBox label="Da chiarire" value={totals.daChiarire.toString()} color={totals.daChiarire > 0 ? 'orange' : 'slate'}
          hint={totals.daChiarire > 0 ? 'Clicca per vedere solo questi movimenti e agganciarli in Riconciliazione o in Scadenze fiscali' : 'Nessun movimento senza spiegazione nel periodo'}
          active={kindFilter === 'da_chiarire'} onClick={totals.daChiarire > 0 ? () => toggleKind('da_chiarire') : undefined} />
      </div>

      {/* Riepilogo per tipo di movimento: stesso contenuto del foglio Riepilogo dell'Excel */}
      {byKind.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {byKind.map(k => (
            <button key={k.kind} type="button" onClick={() => toggleKind(k.kind)} aria-pressed={kindFilter === k.kind}
              title={kindFilter === k.kind ? 'Togli il filtro' : `Mostra solo: ${k.label}`}
              className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 hover:bg-slate-100 ${kindFilter === k.kind ? 'ring-2 ring-slate-900 bg-slate-100' : ''}`}>
              <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${KIND_BADGE[k.kind]}`}>{k.label}</span>
              <span className="tabular-nums">{k.n}</span>
              {k.entrate > 0 && <span className="text-emerald-700 tabular-nums">+{fmt(k.entrate)}</span>}
              {k.uscite > 0 && <span className="text-red-700 tabular-nums">−{fmt(k.uscite)}</span>}
            </button>
          ))}
        </div>
      )}
      {kindFilter && (
        <div className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4 text-sm text-orange-900">
          <span>
            Filtro attivo: <strong>{KIND_LABELS[kindFilter]}</strong> · {movementsShown.length} movimenti su {movements.length}.
            {kindFilter === 'da_chiarire' && ' Per ognuno: se è un pagamento a fornitore agganciarlo in Riconciliazione, se è un F24 in Scadenze fiscali; il resto va spiegato a mano alla commercialista.'}
            {' '}Gli export restano completi.
          </span>
          <button type="button" onClick={() => setKindFilter(null)} className="shrink-0 px-2 py-1 rounded bg-white border border-orange-200 hover:bg-orange-100 text-xs font-medium">Togli filtro</button>
        </div>
      )}

      {/* Quadratura con l'estratto conto: saldo iniziale banca + movimenti nostri = saldo finale banca.
          I saldi vengono dallo scarico A-Cube, non dai movimenti: se quadra, l'export è completo. */}
      {!loading && movements.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Scale size={14} /> Quadratura con l'estratto conto
            {quadratura.every(q => q.stato === 'quadra') && <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">tutti i conti quadrano</span>}
            {quadratura.some(q => q.stato === 'non_quadra') && <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">c'è una differenza</span>}
          </div>
          <TableScroll>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Conto</th>
                  <th className="px-3 py-2 text-right">Saldo al {quadPeriodo.giornoPrima}</th>
                  <th className="px-3 py-2 text-right">Entrate</th>
                  <th className="px-3 py-2 text-right">Uscite</th>
                  <th className="px-3 py-2 text-right">Saldo al {quadPeriodo.ultimoGiorno} calcolato</th>
                  <th className="px-3 py-2 text-right">Saldo al {quadPeriodo.ultimoGiorno} (banca)</th>
                  <th className="px-3 py-2 text-right">Differenza</th>
                </tr>
              </thead>
              <tbody>
                {quadratura.map(q => (
                  <tr key={q.bank_account_id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 text-slate-800">
                      {accountName(q.bank_account_id)}
                      <span className="block text-slate-400">{q.n_movimenti} movimenti</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {q.saldo_iniziale != null ? fmt(q.saldo_iniziale) : <span className="text-slate-400">n.d.</span>}
                      {q.saldo_scarico_iniziale != null && (
                        <Tooltip content={`Saldo letto dalla banca allo scarico del ${fmtDateTime(q.scaricato_iniziale)}: ${fmt(q.saldo_scarico_iniziale)}. ${rettificaLabel(q.rettifica_iniziale) || 'Nessuna rettifica.'}`}>
                          <span className="block text-slate-400 cursor-help">banca al {fmtDateTime(q.scaricato_iniziale)}{(q.rettifica_iniziale.piu.length + q.rettifica_iniziale.meno.length) > 0 && ` · ${q.rettifica_iniziale.piu.length + q.rettifica_iniziale.meno.length} rettifiche`}</span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">+{fmt(q.entrate)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-red-700">−{fmt(q.uscite)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {q.saldo_finale_calcolato != null ? fmt(q.saldo_finale_calcolato) : <span className="text-slate-400">n.d.</span>}
                      <span className="block text-slate-400">saldo iniziale + movimenti</span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {q.saldo_finale != null ? fmt(q.saldo_finale) : <span className="text-slate-400">n.d.</span>}
                      {q.saldo_scarico_finale != null && (
                        <Tooltip content={`Saldo letto dalla banca allo scarico del ${fmtDateTime(q.scaricato_finale)}: ${fmt(q.saldo_scarico_finale)}. ${rettificaLabel(q.rettifica_finale) || 'Nessuna rettifica.'}`}>
                          <span className="block text-slate-400 cursor-help">banca al {fmtDateTime(q.scaricato_finale)}{(q.rettifica_finale.piu.length + q.rettifica_finale.meno.length) > 0 && ` · ${q.rettifica_finale.piu.length + q.rettifica_finale.meno.length} rettifiche`}</span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {q.stato === 'quadra' && <span className="inline-block px-2 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">0,00 · quadra</span>}
                      {q.stato === 'non_quadra' && <span className="inline-block px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">{fmt(q.differenza ?? 0)}</span>}
                      {q.stato === 'senza_saldi' && <Tooltip content="La banca non ha fornito il saldo allo scarico per questo periodo (movimenti importati prima di marzo 2026 o senza dati A-Cube)"><span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-500 cursor-help">saldi n.d.</span></Tooltip>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {/* Contante: la banca vede solo versamenti e prelievi; il resto sta nelle chiusure di cassa */}
          <div className="px-3 py-2 border-t border-slate-100 text-xs text-slate-600 flex flex-wrap gap-x-5 gap-y-1">
            <span className="font-semibold text-slate-800">Contante</span>
            <span>Versamenti in banca <strong className="tabular-nums text-emerald-700">{fmt(quadContante.versamenti_banca)}</strong> ({quadContante.n_versamenti_banca})</span>
            <span>Prelievi dalla banca <strong className="tabular-nums text-red-700">{fmt(quadContante.prelievi_banca)}</strong> ({quadContante.n_prelievi_banca})</span>
            {quadContante.cassa ? (<>
              <span>Chiusure di cassa <strong>{quadContante.cassa.n_chiusure}</strong> su {quadContante.cassa.outlets} outlet ({fmtDate(quadContante.cassa.dal)} → {fmtDate(quadContante.cassa.al)})</span>
              <span>Contanti incassati <strong className="tabular-nums">{fmt(quadContante.cassa.contanti_incassati)}</strong></span>
              <span>Spese di cassa <strong className="tabular-nums">{fmt(quadContante.cassa.spese)}</strong>{quadContante.cassa.rimborsi > 0 && <> · rimborsi <strong className="tabular-nums">{fmt(quadContante.cassa.rimborsi)}</strong></>}</span>
              <span>Versamenti dichiarati <strong className="tabular-nums">{fmt(quadContante.cassa.versamenti_dichiarati)}</strong> ({quadContante.cassa.n_versamenti_dichiarati}), ritrovati in banca <strong className="tabular-nums">{fmt(quadContante.cassa.versamenti_trovati_in_banca)}</strong> ({quadContante.cassa.n_versamenti_trovati})</span>
              <span>Fondo + da versare: inizio <strong className="tabular-nums">{quadContante.cassa.fondo_iniziale != null ? fmt(quadContante.cassa.fondo_iniziale) : 'n.d.'}</strong>, fine contato <strong className="tabular-nums">{quadContante.cassa.fondo_finale != null ? fmt(quadContante.cassa.fondo_finale) : 'n.d.'}</strong>, fine calcolato <strong className="tabular-nums">{quadContante.cassa.fondo_finale_calcolato != null ? fmt(quadContante.cassa.fondo_finale_calcolato) : 'n.d.'}</strong>
                {quadContante.cassa.differenza != null && <> · differenza <strong className={`tabular-nums ${Math.abs(quadContante.cassa.differenza) < 0.005 ? 'text-emerald-700' : 'text-red-700'}`}>{fmt(quadContante.cassa.differenza)}</strong></>}
                {quadContante.cassa.fondo_iniziale == null && <span className="text-slate-400"> (il primo giorno di almeno un outlet parte senza fondo noto: la quadratura cassa comincia dal periodo successivo)</span>}
              </span>
            </>) : (
              <span className="text-slate-400">Nessuna chiusura di cassa nel periodo: il contante si legge solo dal lato banca (le chiusure partono dal 01/09/2026).</span>
            )}
          </div>
        </div>
      )}

      </>)}

      {view === 'pagamenti' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiBox label="Fatture pagate" value={pagamentiVisibili.length.toString()} color="slate" />
          <KpiBox label="Importo pagato" value={`€ ${fmt(pagTotale)}`} color="red" />
          <KpiBox label="Fornitori" value={new Set(pagamentiVisibili.map(p => p.supplier_vat || p.supplier_name || '')).size.toString()} color="slate" />
          <KpiBox label="Senza riscontro" value={senzaRiscontro.toString()} color={senzaRiscontro > 0 ? 'orange' : 'slate'}
            hint={senzaRiscontro > 0 ? 'Clicca per vedere solo le fatture dichiarate pagate senza movimento né contanti/carta' : 'Tutte le fatture pagate hanno un riscontro'}
            active={!!fonteFilter && fonteFilter.includes('senza_riscontro')}
            onClick={senzaRiscontro > 0 ? () => toggleFonte(['senza_riscontro', 'provvisoria']) : undefined} />
        </div>
      )}
      {view === 'pagamenti' && pagByFonte.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {pagByFonte.map(f => (
            <button key={f.fonte} type="button" onClick={() => toggleFonte([f.fonte])} aria-pressed={!!fonteFilter && fonteFilter.length === 1 && fonteFilter[0] === f.fonte}
              title={fonteFilter?.[0] === f.fonte && fonteFilter.length === 1 ? 'Togli il filtro' : `Mostra solo: ${f.label}`}
              className={`inline-flex items-center gap-1.5 rounded px-1 py-0.5 -mx-1 hover:bg-slate-100 ${fonteFilter && fonteFilter.length === 1 && fonteFilter[0] === f.fonte ? 'ring-2 ring-slate-900 bg-slate-100' : ''}`}>
              <span className={`inline-block px-1.5 py-0.5 rounded font-medium ${FONTE_BADGE[f.fonte]}`}>{f.label}</span>
              <span className="tabular-nums">{f.n}</span>
              <span className={`tabular-nums ${f.importo < 0 ? 'text-violet-700' : 'text-red-700'}`}>{f.importo < 0 ? '+' : '−'}{fmt(Math.abs(f.importo))}</span>
            </button>
          ))}
        </div>
      )}
      {view === 'pagamenti' && fonteFilter && (
        <div className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4 text-sm text-orange-900">
          <span>
            Filtro attivo: <strong>{fonteFilter.map(f => FONTE_LABELS[f]).join(' + ')}</strong> · {pagamentiShown.length} fatture su {pagamentiVisibili.length}.
            {fonteFilter.includes('senza_riscontro') && ' Sono fatture segnate pagate senza un movimento collegato: si agganciano in Banche → Riconciliazione (anche se già chiuse a mano).'}
            {' '}Gli export restano completi.
          </span>
          <button type="button" onClick={() => setFonteFilter(null)} className="shrink-0 px-2 py-1 rounded bg-white border border-orange-200 hover:bg-orange-100 text-xs font-medium">Togli filtro</button>
        </div>
      )}

      {view === 'incassi' && (<>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <KpiBox label="Incassi in banca" value={`€ ${fmt(incassiTot.totale)}`} color="emerald" hint={`${incassi.length} movimenti in entrata`} />
        <KpiBox label="POS e Amex" value={`€ ${fmt(incassiTot.pos + incassiTot.amex)}`} color="emerald" />
        <KpiBox label="Versamenti contanti" value={`€ ${fmt(incassiTot.versamenti)}`} color="slate" />
        <KpiBox label="Altri incassi" value={`€ ${fmt(incassiTot.altro)}`} color="slate" hint="Bonifici di clienti, rimborsi: senza outlet" />
        <KpiBox label="Da attribuire" value={incassiTot.daAttribuire.toString()} color={incassiTot.daAttribuire > 0 ? 'orange' : 'slate'}
          hint={incassiTot.daAttribuire > 0 ? 'Clicca per vedere le entrate senza outlet: POS con terminale non censito o versamenti senza parola chiave si sistemano in Incassi giornalieri → Canali' : 'Ogni entrata ha il suo outlet'}
          active={outletFilter === SENZA_OUTLET} onClick={incassiTot.daAttribuire > 0 ? () => toggleOutlet(SENZA_OUTLET) : undefined} />
      </div>
      {/* Riepilogo per outlet: stesso contenuto della sezione Incassi del foglio Riepilogo */}
      {byOutlet.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
          <TableScroll>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 uppercase text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left">Outlet</th>
                  <th className="px-3 py-2 text-right">Mov.</th>
                  <th className="px-3 py-2 text-right">POS</th>
                  <th className="px-3 py-2 text-right">Amex</th>
                  <th className="px-3 py-2 text-right">Versamenti</th>
                  <th className="px-3 py-2 text-right">Altro</th>
                  <th className="px-3 py-2 text-right">Totale</th>
                </tr>
              </thead>
              <tbody>
                {byOutlet.map(o => {
                  const key = o.outlet_id ?? SENZA_OUTLET
                  const active = outletFilter === key
                  return (
                    <tr key={key} className={`border-t border-slate-100 ${active ? 'bg-slate-100' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-3 py-1.5">
                        <button type="button" onClick={() => toggleOutlet(key)} aria-pressed={active} title={active ? 'Togli il filtro' : `Mostra solo: ${o.label}`}
                          className={`inline-block px-1.5 py-0.5 rounded font-medium hover:bg-slate-200 ${o.outlet_id ? 'text-slate-800' : 'bg-orange-100 text-orange-800'} ${active ? 'ring-2 ring-slate-900' : ''}`}>
                          {o.label}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{o.n}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{o.pos ? fmt(o.pos) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{o.amex ? fmt(o.amex) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{o.versamenti ? fmt(o.versamenti) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{o.altro ? fmt(o.altro) : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{fmt(o.totale)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
      {outletFilter && (
        <div className="flex items-center justify-between gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4 text-sm text-orange-900">
          <span>
            Filtro attivo: <strong>{outletFilter === SENZA_OUTLET ? 'Da attribuire' : outletLabel(outletFilter, incassiLk)}</strong> · {incassiShown.length} entrate su {incassi.length}.
            {outletFilter === SENZA_OUTLET && ' Un accredito POS senza outlet ha un codice terminale non censito nei canali dell\'outlet; un versamento senza outlet non contiene la parola chiave del canale Contanti. Si sistemano in Incassi giornalieri → Canali. I bonifici di clienti restano senza outlet.'}
            {' '}Gli export restano completi.
          </span>
          <button type="button" onClick={() => setOutletFilter(null)} className="shrink-0 px-2 py-1 rounded bg-white border border-orange-200 hover:bg-orange-100 text-xs font-medium">Togli filtro</button>
        </div>
      )}
      </>)}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
          Errore caricamento: {error}
        </div>
      )}

      {view === 'pagamenti' && (<>
      {/* Pagamenti fornitori, mobile: una card per fattura */}
      <div className="md:hidden space-y-2">
        {loadingPag ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
          </div>
        ) : pagamentiShown.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            {fonteFilter ? 'Nessuna fattura con questo filtro' : 'Nessuna fattura pagata nel periodo selezionato'}
          </div>
        ) : pagamentiShown.map(p => {
          const f = fonteOf(p)
          const tx = p.bank_transaction_id ? lookups.bankTx.get(p.bank_transaction_id) : undefined
          const acc = (tx?.bank_account_id ?? p.payment_bank_account_id) ? lookups.bankAccounts.get((tx?.bank_account_id ?? p.payment_bank_account_id) as string) : undefined
          const cat = p.cost_category_id ? lookups.categories.get(p.cost_category_id) : undefined
          const paid = importoPagato(p)
          return (
            <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">
                  {p.payment_date ? fmtDate(p.payment_date) : '—'}
                  {acc && f === 'banca' && <><span className="mx-1 text-slate-300">·</span>{acc.bank_name}</>}
                </div>
                <span className={`shrink-0 inline-block px-2 py-0.5 rounded text-xs font-medium ${FONTE_BADGE[f]}`}>{FONTE_LABELS[f]}</span>
              </div>
              <div className={`text-lg font-bold mt-1 ${paid < 0 ? 'text-violet-700' : 'text-red-700'}`}>€ {fmt(Math.abs(paid))}</div>
              <div className="text-sm font-medium text-slate-800 mt-0.5 break-words">{p.supplier_name ?? '—'}</div>
              <div className="text-xs text-slate-600 mt-0.5">
                Fatt. {p.invoice_number ?? '?'}{p.invoice_date ? ` del ${fmtDate(p.invoice_date)}` : ''}{rataOf(p) ? ` · rata ${rataOf(p)}` : ''}
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-slate-500">
                {metodoLabel(p) && <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{metodoLabel(p)}</span>}
                {cat && <span>{cat.name}{cat.ce_account_code ? ` (${cat.ce_account_code})` : ''}</span>}
                {p.supplier_vat && <span className="font-mono">P.IVA {p.supplier_vat}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagamenti fornitori, desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <TableScroll className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left">Pagata il</th>
                <th className="px-3 py-2 text-center">Fonte</th>
                <th className="px-3 py-2 text-left">Conto</th>
                <th className="px-3 py-2 text-left">Fornitore</th>
                <th className="px-3 py-2 text-left">P.IVA</th>
                <th className="px-3 py-2 text-left">Fattura</th>
                <th className="px-3 py-2 text-right">Imponibile</th>
                <th className="px-3 py-2 text-right">IVA</th>
                <th className="px-3 py-2 text-right">Pagato</th>
                <th className="px-3 py-2 text-left">Metodo</th>
                <th className="px-3 py-2 text-left">Categoria</th>
              </tr>
            </thead>
            <tbody>
              {loadingPag ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
                </td></tr>
              ) : pagRowsShown.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                  {fonteFilter ? 'Nessuna fattura con questo filtro' : 'Nessuna fattura pagata nel periodo selezionato'}
                </td></tr>
              ) : pagamentiShown.map((p, i) => {
                const r = pagRowsShown[i]
                const f = fonteOf(p)
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{r['Data pagamento'] || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <Tooltip content={r.Note}>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${r.Note ? 'cursor-help' : ''} ${FONTE_BADGE[f]}`}>{r.Fonte}</span>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs max-w-[160px]">
                      <Tooltip content={r.IBAN ? `${r['Conto Banca']} · ${r.IBAN}${r['Data movimento'] ? ` · movimento del ${r['Data movimento']}` : ''}` : ''}>
                        <div className="truncate cursor-help">{r['Conto Banca'] || '—'}{r['Data movimento'] && <span className="block text-slate-400">mov. {r['Data movimento']}</span>}</div>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2 text-slate-700 max-w-[200px]">
                      <Tooltip content={r.Fornitore}><div className="truncate cursor-help">{r.Fornitore || '—'}</div></Tooltip>
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs font-mono">{r['P.IVA'] || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">
                      {r['N. fattura'] || '?'}{r['Data fattura'] && <span className="block text-slate-400">{r['Data fattura']}{r.Rata ? ` · rata ${r.Rata}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600 tabular-nums whitespace-nowrap">{r.Imponibile !== '' ? fmt(r.Imponibile) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-600 tabular-nums whitespace-nowrap">{r.IVA !== '' ? fmt(r.IVA) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${r.Pagato < 0 ? 'text-violet-700' : 'text-red-700'}`}>
                      {r.Pagato < 0 ? '+' : '−'} € {fmt(Math.abs(r.Pagato))}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs whitespace-nowrap">{r.Metodo || '—'}</td>
                    <td className="px-3 py-2 text-slate-500 text-xs max-w-[180px]">
                      <Tooltip content={r.Categoria ? `${r.Categoria}${r['Conto CE'] ? ` · conto ${r['Conto CE']}` : ''}${r.Outlet ? ` · ${r.Outlet}` : ''}` : ''}>
                        <div className="truncate cursor-help">{r.Categoria || '—'}{r['Conto CE'] && <span className="text-slate-400"> {r['Conto CE']}</span>}</div>
                      </Tooltip>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
      </>)}

      {view === 'incassi' && (<>
      {/* Incassi, mobile: una card per entrata */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
          </div>
        ) : incassiShown.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            {outletFilter ? 'Nessuna entrata con questo filtro' : 'Nessun incasso nel periodo selezionato'}
          </div>
        ) : incassiShown.map(({ m, a }, i) => {
          const r = incassiRowsShown[i]
          return (
            <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">
                  {r['Data operazione']}{r['Data riferimento'] && <span className="text-slate-400"> · vendite del {r['Data riferimento']}</span>}
                  <span className="mx-1 text-slate-300">·</span>{r['Conto Banca'] || '—'}
                </div>
                <span className={`shrink-0 inline-block px-2 py-0.5 rounded text-xs font-medium ${INCASSO_BADGE[a.kind]}`}>{r.Tipo}</span>
              </div>
              <div className="text-lg font-bold mt-1 text-emerald-700">€ {fmt(r.Importo)}</div>
              <div className={`text-sm font-medium mt-0.5 ${a.outlet_id ? 'text-slate-800' : 'text-orange-800'}`}>
                {r.Outlet || 'Da attribuire'}{r.Canale && <span className="text-slate-500 font-normal"> · {r.Canale}</span>}
              </div>
              <div className="text-xs text-slate-600 mt-0.5 break-words">{r.Causale}</div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
                <span className={`inline-block px-1.5 py-0.5 rounded ${ATTRIBUZIONE_BADGE[a.attribuzione]}`}>{ATTRIBUZIONE_LABELS[a.attribuzione]}</span>
                {r.Terminale && <span className="font-mono text-slate-500">term. {r.Terminale}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Incassi, desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <TableScroll className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left">Data</th>
                <th className="px-3 py-2 text-left">Conto Banca</th>
                <th className="px-3 py-2 text-left">Outlet</th>
                <th className="px-3 py-2 text-center">Tipo</th>
                <th className="px-3 py-2 text-right">Importo</th>
                <th className="px-3 py-2 text-left">Attribuzione</th>
                <th className="px-3 py-2 text-left">Causale</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
                </td></tr>
              ) : incassiShown.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                  {outletFilter ? 'Nessuna entrata con questo filtro' : 'Nessun incasso nel periodo selezionato'}
                </td></tr>
              ) : incassiShown.map(({ m, a }, i) => {
                const r = incassiRowsShown[i]
                return (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                      {r['Data operazione']}{r['Data riferimento'] && <span className="block text-xs text-slate-400">vendite del {r['Data riferimento']}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600 text-xs max-w-[160px]">
                      <Tooltip content={m.bank_accounts?.iban ? `${r['Conto Banca']} · ${m.bank_accounts.iban}` : ''}><div className="truncate cursor-help">{r['Conto Banca'] || '—'}</div></Tooltip>
                    </td>
                    <td className={`px-3 py-2 ${a.outlet_id ? 'text-slate-800' : 'text-orange-800'}`}>
                      {r.Outlet || 'Da attribuire'}{r.Canale && <span className="block text-xs text-slate-400">{r.Canale}{r.Terminale ? ` · ${r.Terminale}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-center"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${INCASSO_BADGE[a.kind]}`}>{r.Tipo}</span></td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap text-emerald-700">+ € {fmt(r.Importo)}</td>
                    <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded text-xs whitespace-nowrap ${ATTRIBUZIONE_BADGE[a.attribuzione]}`}>{ATTRIBUZIONE_LABELS[a.attribuzione]}</span></td>
                    <td className="px-3 py-2 text-slate-600 text-xs max-w-md">
                      <Tooltip content={r.Causale}><div className="truncate cursor-help">{r.Causale || '—'}</div></Tooltip>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
      </>)}

      {view === 'carte' && (<>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <KpiBox label="Estratti carta nel periodo" value={carteTot.n.toString()} color="slate" hint={carteTot.senzaRighe > 0 ? `${carteTot.senzaRighe} archiviati senza righe: leggili dal file` : carteTot.n > 0 ? 'tutti con le righe importate' : 'importa il PDF o l\'Excel dell\'estratto'} />
        <KpiBox label="Spese con carta" value={`€ ${fmt(carteTot.spese)}`} color="red" hint={`${carteTot.speseN} operazioni`} />
        <KpiBox label="Ricariche e storni" value={`€ ${fmt(carteTot.accrediti)}`} color="emerald" />
        <KpiBox label="Addebiti trovati in banca" value={`${carteTot.addebitiTrovati} / ${carteTot.addebitiAttesi}`} color={carteTot.addebitiAttesi > 0 && carteTot.addebitiTrovati < carteTot.addebitiAttesi ? 'orange' : 'slate'} hint="carte di credito: l'addebito unico dell'estratto sul conto" />
        <KpiBox label="Fatture agganciate" value={`${carteTot.fattureAgganciate} / ${carteTot.speseN}`} color="slate" hint="spese che pagano una fattura dello Scadenzario (carta)" />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-4 flex flex-wrap items-center gap-3 text-sm">
        <input ref={cardFileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" multiple className="hidden" onChange={e => onCardFiles(e.target.files)} />
        <button type="button" onClick={() => cardFileRef.current?.click()} disabled={cardParsing}
          className="inline-flex items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
          {cardParsing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Importa estratto carta
        </button>
        <span className="text-slate-600">PDF di CartaBCC (Numia) e Carta Montepaschi, Excel o PDF della prepagata Tasca. La carta, il mese e le righe si leggono dal documento; il file finisce in Archivio.</span>
      </div>

      {carte.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Nessun estratto carta per il periodo selezionato</div>
      ) : carte.map((c, ci) => {
        const pm = cartePay[ci]
        return (
          <div key={c.stmt.id} className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold text-slate-800 inline-flex items-center gap-1.5"><CreditCard size={14} /> {c.label}</span>
              <span className="text-xs text-slate-500">{c.stmt.period_year && c.stmt.period_month ? `${MONTHS.find(m => m.v === c.stmt.period_month)?.l} ${c.stmt.period_year}` : ''} · <Tooltip content={c.stmt.filename}><span className="cursor-help">{c.stmt.filename.split('/').pop()}</span></Tooltip></span>
              <span className="text-xs text-slate-600">{c.lines.length} operazioni · spese <strong className="tabular-nums text-red-700">{fmt(c.tot.spese)}</strong>{c.tot.accrediti > 0 && <> · accrediti <strong className="tabular-nums text-emerald-700">{fmt(c.tot.accrediti)}</strong></>}{c.tot.commissioni !== 0 && <> · commissioni <strong className="tabular-nums">{fmt(c.tot.commissioni)}</strong></>}</span>
              {c.stmt.statement_total != null && <span className="text-xs text-slate-600">dichiarato <strong className="tabular-nums">{fmt(c.stmt.statement_total)}</strong>{Math.abs(c.stmt.statement_total - c.computed) > 0.005 && <span className="text-red-700"> (letto {fmt(c.computed)})</span>}</span>}
              {c.lines.length > 0 && (c.isPrepagata
                ? <span className={`text-xs px-2 py-0.5 rounded ${c.ricariche.size === c.nRicariche ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-100 text-orange-800'}`}>ricariche in banca {c.ricariche.size}/{c.nRicariche}</span>
                : c.debit.movement
                  ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">addebito in banca {fmtDate(c.debit.movement.transaction_date)} {fmt(c.debit.movement.amount)}{c.debit.n > 1 && ` (${c.debit.n} estratti)`}{Math.abs(c.debit.differenza) >= 0.005 && ` · commissioni ${fmt(c.debit.differenza)}`}</span>
                  : <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-800">addebito non ancora in banca</span>)}
              <span className="flex-1" />
              {c.lines.length === 0 && (c.stmt.file_path
                ? <button type="button" onClick={() => readCardFromArchive(c.stmt)} disabled={cardParsing} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"><Upload size={12} /> Leggi le righe dal file archiviato</button>
                : <span className="text-xs text-orange-800">file archiviato non trovato: importa di nuovo il documento</span>)}
            </div>
            {c.lines.length > 0 && (
              <TableScroll>
                <table className="w-full text-sm">
                  <thead className="bg-white text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Data acquisto</th>
                      <th className="px-3 py-2 text-left">Registr.</th>
                      <th className="px-3 py-2 text-left">Descrizione</th>
                      <th className="px-3 py-2 text-right">Importo</th>
                      <th className="px-3 py-2 text-right">Comm.</th>
                      <th className="px-3 py-2 text-left">Fattura pagata</th>
                      <th className="px-3 py-2 text-left">Riscontro banca</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.lines.map((l, li) => {
                      const p = pm.get(li)
                      const risc = riscontroOf(ci, li)
                      return (
                        <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                          <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">{fmtDate(l.purchase_date)}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap text-xs text-slate-500">{l.posting_date ? fmtDate(l.posting_date) : '—'}</td>
                          <td className="px-3 py-1.5 text-slate-700 text-xs max-w-md"><Tooltip content={l.description}><div className="truncate cursor-help">{l.description}</div></Tooltip>{l.currency !== 'EUR' && l.original_amount != null && <span className="text-slate-400">{fmt(l.original_amount)} {l.currency}</span>}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap font-medium ${l.amount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmt(l.amount)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-xs text-slate-500">{l.fee ? fmt(l.fee) : ''}</td>
                          <td className="px-3 py-1.5 text-xs">{p ? <span className="text-slate-700">{p.supplier_name ?? '—'}<span className="block text-slate-400">fatt. {p.invoice_number ?? '?'}{p.payment_date ? ` · pagata il ${fmtDate(p.payment_date)}` : ''}</span></span> : l.amount < 0 ? <span className="text-slate-400">nessuna fattura con carta per questo importo</span> : ''}</td>
                          <td className="px-3 py-1.5 text-xs">{risc && <span className={`inline-block px-1.5 py-0.5 rounded ${/non /.test(risc) ? 'bg-orange-100 text-orange-800' : 'bg-emerald-50 text-emerald-700'}`}>{risc}</span>}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableScroll>
            )}
          </div>
        )
      })}

      <Modal open={cardImport !== null} onClose={() => { if (!cardImport?.busy) setCardImport(null) }} title="Importa estratti carta" maxWidthClass="max-w-3xl" closeOnBackdrop={false}>
        {cardImport && (
          <div className="space-y-3 text-sm">
            {cardImport.items.map((it, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3">
                <div className="font-medium text-slate-800">{it.fileName}</div>
                <div className="text-xs text-slate-600 mt-1">
                  {ISSUER_LABELS[it.parsed.issuer]}{it.parsed.cards.length > 0 && <> · carta {it.parsed.cards.map(cc => `**** ${cc.card_last4 ?? '?'}${cc.holder ? ` (${cc.holder})` : ''}`).join(', ')}</>}
                  {it.parsed.period && <> · {MONTHS.find(m => m.v === it.parsed.period!.month)?.l} {it.parsed.period.year}</>}
                </div>
                <div className="text-xs text-slate-600">
                  {it.parsed.lines.length} operazioni · totale letto <strong className="tabular-nums">{fmt(it.parsed.total_computed)}</strong>
                  {it.parsed.total_declared != null && <> · dichiarato dal documento <strong className="tabular-nums">{fmt(it.parsed.total_declared)}</strong></>}
                  {it.parsed.debit_date && <> · addebito annunciato il {fmtDate(it.parsed.debit_date)}</>}
                </div>
                {it.parsed.warnings.map((w, k) => <div key={k} className="text-xs text-orange-800 mt-1">⚠ {w}</div>)}
                <div className="text-xs mt-1">
                  {it.parsed.lines.length === 0 ? <span className="text-red-700">niente da importare</span>
                    : it.existingLines > 0 ? <span className="text-orange-800">già importato in «{it.label}» con {it.existingLines} righe: questo file viene saltato (le righe esistenti non si toccano)</span>
                    : it.existing ? <span className="text-emerald-700">aggiorna «{it.label}» già in Archivio senza righe: le {it.parsed.lines.length} operazioni vengono salvate</span>
                    : <span className="text-emerald-700">nuovo estratto «{it.label}»: il file va in Archivio e le {it.parsed.lines.length} operazioni vengono salvate</span>}
                </div>
              </div>
            ))}
            <div className="text-xs text-slate-500">Ogni spesa viene agganciata alla fattura dello Scadenzario pagata con carta con lo stesso importo (entro 10 giorni); per le carte di credito si cerca in banca l'addebito con lo stesso totale.</div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCardImport(null)} disabled={cardImport.busy} className="px-3 py-2 rounded-lg border border-slate-200 text-sm hover:bg-slate-50 disabled:opacity-50">Annulla</button>
              <button type="button" onClick={saveCardImport} disabled={cardImport.busy || !cardImport.items.some(it => it.parsed.lines.length > 0 && it.existingLines === 0)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50">
                {cardImport.busy && <Loader2 size={14} className="animate-spin" />} Importa {cardImport.items.filter(it => it.parsed.lines.length > 0 && it.existingLines === 0).length} estratti
              </button>
            </div>
          </div>
        )}
      </Modal>
      </>)}

      {view === 'dipendenti' && (<>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <KpiBox label="Disposizioni per emolumenti" value={stipendi.n_flussi.toString()} color="slate" hint={`bonifici € ${fmt(stipendi.totale_bonifici)} · commissioni € ${fmt(stipendi.totale_commissioni)}`} />
        <KpiBox label="Netti pagati" value={`€ ${fmt(stipendi.totale_netti_abbinati)}`} color="emerald" hint={`${stipendi.n_buste_abbinate} buste paga abbinate a una disposizione`} />
        <KpiBox label="Buste paga nel foglio" value={stipendi.rows.length.toString()} color="slate" hint="una riga per dipendente, con la disposizione che l'ha pagato" />
        <KpiBox label="Buste senza pagamento" value={stipendi.n_buste_non_abbinate.toString()} color={stipendi.n_buste_non_abbinate > 0 ? 'orange' : 'slate'}
          hint={stipendi.n_buste_non_abbinate > 0 ? 'Netti del mese prima che nessuna disposizione del periodo paga: pagati altrove (contanti, altro conto, altro mese) o busta da controllare' : 'Ogni busta del mese prima ha il suo pagamento'} />
        <KpiBox label="Disposizioni senza buste" value={stipendi.flussi_non_abbinati.length.toString()} color={stipendi.flussi_non_abbinati.length > 0 ? 'orange' : 'slate'}
          hint={stipendi.flussi_non_abbinati.length > 0 ? 'Flussi che nessun gruppo di buste spiega al centesimo: buste non ancora importate in Costo del personale, o importo diverso' : 'Ogni disposizione è spiegata dalle buste paga'} />
      </div>
      {stipendi.flussi_non_abbinati.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 mb-4 text-sm text-orange-900">
          <div className="font-medium mb-1">Disposizioni senza buste paga che le spieghino</div>
          <ul className="text-xs space-y-0.5">
            {stipendi.flussi_non_abbinati.map(x => (
              <li key={x.flusso.id}>
                {fmtDate(x.flusso.transaction_date)} · {bankNameOf(x.flusso.bank_account_id)} · flusso {x.info.id_flusso ?? '—'}{x.info.n_pagamenti != null && ` (${x.info.n_pagamenti} pagamenti)`} · bonifici <strong className="tabular-nums">{fmt(x.info.importo_bonifici ?? -x.flusso.amount)}</strong>
                {x.info.commissioni != null && <> · commissioni {fmt(x.info.commissioni)}</>}
              </li>
            ))}
          </ul>
          <div className="text-xs mt-1">Se le buste del mese sono già importate in Costo del personale, l'importo del flusso non coincide con nessun gruppo di netti: da guardare con lo studio paghe.</div>
        </div>
      )}

      {/* Dipendenti, mobile: una card per busta paga */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
          </div>
        ) : stipendi.rows.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            Nessuna busta paga né disposizione per emolumenti nel periodo selezionato
          </div>
        ) : stipendi.rows.map((r, i) => {
          const x = stipendiRows[i]
          return (
            <div key={r.slip.id} className="bg-white rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-slate-800">{x.Dipendente}</div>
                <div className="text-lg font-bold tabular-nums text-slate-900">{x.Netto === '' ? '—' : `€ ${fmt(x.Netto)}`}</div>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{x.Outlet || '—'} · competenza {x.Competenza}</div>
              <div className={`text-xs mt-1 ${r.flusso ? 'text-slate-600' : 'text-orange-800'}`}>
                {r.flusso ? <>Pagato il {x['Pagato il']} · {x['Conto Banca']} · flusso {x['Disposizione (ID flusso)'] || '—'} ({x['Bonifici nel flusso (banca)'] || '?'} bonifici per {x['Buste nel flusso'] || '?'} buste, € {x['Importo flusso'] === '' ? '—' : fmt(x['Importo flusso'])})</> : x.Esito}
              </div>
            </div>
          )
        })}
      </div>

      {/* Dipendenti, desktop */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <TableScroll className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left">Dipendente</th>
                <th className="px-3 py-2 text-left">Outlet</th>
                <th className="px-3 py-2 text-left">Competenza</th>
                <th className="px-3 py-2 text-right">Netto</th>
                <th className="px-3 py-2 text-left">Pagato il</th>
                <th className="px-3 py-2 text-left">Conto Banca</th>
                <th className="px-3 py-2 text-left">Disposizione</th>
                <th className="px-3 py-2 text-right">Importo flusso</th>
                <th className="px-3 py-2 text-left">Esito</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
                </td></tr>
              ) : stipendi.rows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">
                  Nessuna busta paga né disposizione per emolumenti nel periodo selezionato
                </td></tr>
              ) : stipendi.rows.map((r, i) => {
                const x = stipendiRows[i]
                const mv = r.flusso ? movementById.get(r.flusso.id) : undefined
                return (
                  <tr key={r.slip.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-800 whitespace-nowrap">{nomeDipendente(r.slip)}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs">{x.Outlet || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs whitespace-nowrap">{competenzaLabel(r.slip)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{x.Netto === '' ? '—' : `€ ${fmt(x.Netto)}`}</td>
                    <td className="px-3 py-2 text-slate-700 whitespace-nowrap">{x['Pagato il'] || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 text-xs max-w-[160px]"><div className="truncate">{x['Conto Banca'] || '—'}</div></td>
                    <td className="px-3 py-2 text-xs">
                      {r.flusso ? (
                        <Tooltip content={mv?.description ?? ''}>
                          <span className="cursor-help font-mono text-slate-700">{x['Disposizione (ID flusso)'] || '—'}</span>
                        </Tooltip>
                      ) : '—'}
                      {x['Bonifici nel flusso (banca)'] !== '' && <span className={`block ${x['Bonifici nel flusso (banca)'] !== x['Buste nel flusso'] ? 'text-orange-700' : 'text-slate-400'}`}>{x['Bonifici nel flusso (banca)']} bonifici per {x['Buste nel flusso']} buste{x['Commissioni flusso'] !== '' && `, comm. ${fmt(x['Commissioni flusso'])}`}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-700">{x['Importo flusso'] === '' ? '—' : fmt(x['Importo flusso'])}</td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`inline-block px-2 py-0.5 rounded whitespace-nowrap ${r.flusso ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-100 text-orange-800'}`}>{x.Esito}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
      </>)}

      {view === 'banca' && (<>

      {/* Lista mobile a schede (sotto md): stessa fonte dati della tabella,
          una card per movimento con i dati chiave. La tabella resta su desktop. */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
          </div>
        ) : movementsShown.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
            {kindFilter ? 'Nessun movimento con questo filtro' : 'Nessun movimento nel periodo selezionato'}
          </div>
        ) : movementsShown.map(m => (
          <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                {fmtDate(basisDate(m))}{m.posting_date && m.posting_date !== m.transaction_date && <span className="text-slate-400"> (op. {fmtDate(m.transaction_date)}, cont. {fmtDate(m.posting_date)})</span>}
                <span className="mx-1 text-slate-300">·</span>
                {m.bank_accounts?.bank_name ?? '—'}
                {m.bank_accounts?.iban && <span className="text-slate-400"> ***{m.bank_accounts.iban.slice(-6)}</span>}
              </div>
              <KindBadge m={m} />
            </div>
            <div className={`text-lg font-bold mt-1 ${m.amount > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
              € {fmt(Math.abs(m.amount))}
              {!kindFilter && saldoById.get(m.id) != null && <span className="ml-2 text-xs font-normal text-slate-400">saldo {fmt(saldoById.get(m.id) as number)}</span>}
            </div>
            <div className="text-sm font-medium text-slate-800 mt-0.5 break-words">{contropartitaOf(m) || '—'}</div>
            {causaleOf(m) && (
              <div className="text-xs text-slate-600 mt-0.5 break-words">{causaleOf(m)}</div>
            )}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {m.category && (
                <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs">{m.category}</span>
              )}
              {invoiceCountOf(m) > 1 && (
                <span className="text-xs text-slate-500">{invoiceCountOf(m)} fatture · tot. {fmt(invoicesTotalOf(m) ?? 0)}</span>
              )}
              {pivaOf(m) && (
                <span className="text-xs text-slate-500 font-mono">P.IVA {pivaOf(m)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Tabella desktop — max-height 70vh + sticky header per gestire bene 200+ movimenti */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 overflow-hidden">
        <TableScroll className="max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-600 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left">{dateBasis === 'contabile' ? 'Data contabile' : 'Data operazione'}</th>
                <th className="px-3 py-2 text-left">Conto Banca</th>
                <th className="px-3 py-2 text-center">Tipo movimento</th>
                <th className="px-3 py-2 text-right">Importo</th>
                <th className="px-3 py-2 text-right">Saldo</th>
                <th className="px-3 py-2 text-left">Contropartita</th>
                <th className="px-3 py-2 text-left">P.IVA</th>
                <th className="px-3 py-2 text-right">Fatt.</th>
                <th className="px-3 py-2 text-left">Causale</th>
                <th className="px-3 py-2 text-left">Categoria</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  <Loader2 size={20} className="inline animate-spin mr-2" /> Caricamento…
                </td></tr>
              ) : movementsShown.length === 0 ? (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                  {kindFilter ? 'Nessun movimento con questo filtro' : 'Nessun movimento nel periodo selezionato'}
                </td></tr>
              ) : quadratura.filter(q => movementsShown.some(m => m.bank_account_id === q.bank_account_id)).flatMap(q => {
                // Estratto conto per conto: riga di apertura, movimenti con saldo progressivo, riga di chiusura.
                // Con un filtro per tipo attivo l'elenco è parziale: niente saldi, solo le righe.
                const ms = movementsShown.filter(m => m.bank_account_id === q.bank_account_id)
                const open = !kindFilter ? [(
                  <tr key={`open-${q.bank_account_id}`} className="border-t-2 border-slate-200 bg-slate-50/80">
                    <td colSpan={4} className="px-3 py-2 font-semibold text-slate-800">{accountName(q.bank_account_id)} · saldo iniziale al {quadPeriodo.giornoPrima}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{q.saldo_iniziale != null ? fmt(q.saldo_iniziale) : <span className="text-slate-400 font-normal">n.d.</span>}</td>
                    <td colSpan={5} className="px-3 py-2 text-xs text-slate-400">{q.saldo_scarico_iniziale != null ? `banca al ${fmtDateTime(q.scaricato_iniziale)}: ${fmt(q.saldo_scarico_iniziale)}${rettificaLabel(q.rettifica_iniziale) ? ' · ' + rettificaLabel(q.rettifica_iniziale) : ''}` : 'la banca non ha fornito il saldo per questo periodo'}</td>
                  </tr>
                )] : [(
                  <tr key={`open-${q.bank_account_id}`} className="border-t-2 border-slate-200 bg-slate-50/80">
                    <td colSpan={10} className="px-3 py-2 font-semibold text-slate-800">{accountName(q.bank_account_id)} <span className="font-normal text-slate-400">· {ms.length} movimenti con il filtro attivo</span></td>
                  </tr>
                )]
                const close = !kindFilter ? [(
                  <tr key={`close-${q.bank_account_id}`} className={`border-t border-slate-200 ${q.stato === 'non_quadra' ? 'bg-red-50' : 'bg-slate-50/80'}`}>
                    <td colSpan={4} className="px-3 py-2 font-semibold text-slate-800">
                      Saldo finale al {quadPeriodo.ultimoGiorno}
                      <span className="font-normal text-slate-500"> · {ms.length} movimenti, entrate +{fmt(q.entrate)}, uscite −{fmt(q.uscite)}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap">{q.saldo_finale_calcolato != null ? fmt(q.saldo_finale_calcolato) : <span className="text-slate-400 font-normal">n.d.</span>}</td>
                    <td colSpan={5} className="px-3 py-2 text-xs">
                      {q.saldo_finale != null ? (<>
                        <span className="text-slate-600">banca: <strong className="tabular-nums">{fmt(q.saldo_finale)}</strong></span>
                        <span className="text-slate-400"> (al {fmtDateTime(q.scaricato_finale)}: {fmt(q.saldo_scarico_finale ?? 0)}{rettificaLabel(q.rettifica_finale) ? ' · ' + rettificaLabel(q.rettifica_finale) : ''})</span>
                        {q.stato === 'quadra' && <span className="ml-2 inline-block px-2 py-0.5 rounded font-medium bg-emerald-100 text-emerald-700">quadra</span>}
                        {q.stato === 'non_quadra' && <span className="ml-2 inline-block px-2 py-0.5 rounded font-medium bg-red-100 text-red-700">differenza {fmt(q.differenza ?? 0)}</span>}
                      </>) : <span className="text-slate-400">saldo banca non disponibile</span>}
                    </td>
                  </tr>
                )] : []
                return [...open, ...ms.map(m => {
                const nFatt = invoiceCountOf(m)
                const totFatt = invoicesTotalOf(m)
                const saldo = kindFilter ? null : saldoById.get(m.id)
                return (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                    {fmtDate(basisDate(m))}
                    {m.posting_date && m.posting_date !== m.transaction_date && <span className="block text-xs text-slate-400">{dateBasis === 'contabile' ? `op. ${fmtDate(m.transaction_date)}` : `cont. ${fmtDate(m.posting_date)}`}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs">
                    <Tooltip content={`${m.bank_accounts?.bank_name ?? ''}${m.bank_accounts?.account_name ? ' — ' + m.bank_accounts.account_name : ''}${m.bank_accounts?.iban ? ' · ' + m.bank_accounts.iban : ''}`}>
                      <div>
                        {m.bank_accounts?.bank_name ?? '—'}
                        {m.bank_accounts?.iban && <span className="block text-slate-400">***{m.bank_accounts.iban.slice(-6)}</span>}
                      </div>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 text-center"><KindBadge m={m} /></td>
                  <td className={`px-3 py-2 text-right font-semibold whitespace-nowrap ${m.amount > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {m.amount > 0 ? '+' : '−'} € {fmt(Math.abs(m.amount))}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600 tabular-nums whitespace-nowrap text-xs">{saldo != null ? fmt(saldo) : '—'}</td>
                  <td className="px-3 py-2 text-slate-700 max-w-[200px]">
                    <Tooltip content={contropartitaOf(m)}>
                      <div className="truncate cursor-help">{contropartitaOf(m) || '—'}</div>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs font-mono">{pivaOf(m) || '—'}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-600 whitespace-nowrap">
                    {nFatt > 0 ? (
                      <Tooltip content={totFatt != null ? `Totale fatture € ${fmt(totFatt)}${Math.abs(totFatt - Math.abs(m.amount)) >= 0.01 ? ` (differenza € ${fmt(Math.abs(m.amount) - totFatt)}: acconto, commissioni o note di credito)` : ''}` : ''}>
                        <span className="cursor-help">{nFatt}</span>
                      </Tooltip>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-600 text-xs max-w-md">
                    <Tooltip content={causaleOf(m)}>
                      <div className="truncate cursor-help">{causaleOf(m) || '—'}</div>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-2 text-slate-500 text-xs max-w-[160px]">
                    <Tooltip content={m.category ?? ''}>
                      <div className="truncate cursor-help">{m.category ?? '—'}</div>
                    </Tooltip>
                  </td>
                </tr>
                )
                }), ...close]
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>
      </>)}
    </div>
  )
}

type KpiColor = 'slate' | 'emerald' | 'red' | 'orange'
function KpiBox({ label, value, color, hint, onClick, active }: { label: string; value: string; color: KpiColor; hint?: string; onClick?: () => void; active?: boolean }) {
  const colors: Record<KpiColor, string> = {
    slate: 'text-slate-900',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
    orange: 'text-orange-700',
  }
  const inner = (
    <>
      <div className="text-xs text-slate-500 flex items-center justify-between gap-2">
        <span>{label}</span>
        {onClick && <span className="text-[10px] uppercase tracking-wide text-slate-400">{active ? 'filtro attivo' : 'clicca'}</span>}
      </div>
      <div className={`text-2xl font-bold mt-1 ${colors[color]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-1 leading-tight">{hint}</div>}
    </>
  )
  // Una card cliccabile è un bottone vero: tastiera e screen reader la usano come tale.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={!!active}
        className={`text-left w-full bg-white rounded-xl border p-4 cursor-pointer hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${active ? 'border-orange-400 ring-2 ring-orange-300' : 'border-slate-200'}`}>
        {inner}
      </button>
    )
  }
  return <div className="bg-white rounded-xl border border-slate-200 p-4">{inner}</div>
}
