// ─────────────────────────────────────────────────────────────────────────────
// SIMULAZIONE FABBISOGNO — tre passi: cosa devi pagare, quanto avrai, cosa manca
//
// Il modello NON decide da solo cosa si paga. Chi tiene l'amministrazione spunta
// riga per riga le uscite obbligatorie entro la data; la selezione si salva in
// `cash_must_pay` ed è condivisa fra gli utenti dell'azienda. Fanno eccezione
// gli addebiti automatici (SDD, RID, carte): partono dal conto da soli per
// mandato al creditore, quindi sono obbligatori d'ufficio e NON compaiono nella
// lista delle decisioni: sarebbero righe da scorrere senza poterci fare niente.
// Restano contati nei totali e riassunti in una riga sola, apribile a richiesta.
// Le RiBa NO: si possono lasciare insolute, quindi restano una decisione, solo
// segnalata per quello che comporta.
//
// L'elenco si legge per FORNITORE (la posizione intera, fatture in ordine di
// emissione con la scadenza a fianco) oppure per scadenza: la decisione vera non
// è mai «pago la fattura 236/2», è «cosa faccio con questo fornitore».
//
// Le uscite ricorrenti che non stanno a scadenzario vengono calcolate:
//  - personale: netti in busta + F24 di ritenute e contributi, due date diverse,
//    più tredicesima e quattordicesima sugli orizzonti lunghi
//  - IVA: stessa catena di liquidazione della pagina Liquidazione IVA
//
// Gli incassi attesi non sono una media del passato: i negozi scaricano i ricavi
// ogni sera, quindi il ritmo di questo mese è un dato. L'obiettivo del mese
// (Budget → Inserimento rapido, tabella budget_confronto) dice se si è avanti o
// indietro, non costruisce la previsione.
//
// Fonti, tutte sul tenant attivo:
//  - liquidità   → bank_accounts (conti attivi) + fido opzionale
//  - uscite      → v_payables_operative, fiscal_deadlines
//  - personale   → employee_costs (netti) + personnel_gross_cost (lordo, INPS)
//  - IVA         → v_iva_componenti_mensili + vat_settings + vat_settlements
//  - selezione   → cash_must_pay (scrittura: super_advisor, cfo, contabile)
//  - obiettivo   → budget_confronto (rev_monthly) + IVA da daily_report_settings
//  - realizzato  → daily_revenue del mese in corso
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Wallet, AlertTriangle, Download, Loader2, Info, RefreshCw, CheckCircle2,
  Building2, ExternalLink, Search, X, Target, TrendingUp, TrendingDown, Lock,
  Eraser, Zap, FileWarning, ChevronRight, ChevronDown,
} from 'lucide-react'
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import PageHeader from '../components/PageHeader'
import { Modal } from '../components/ui/Modal'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { todayYMD, lastDayOfMonthYMD } from '../lib/dateLocal'
import {
  buildLiquidazioni, type IvaComponentiMese, type IvaSettings,
  type IvaMeseConfermato, type IvaMesePagato, MESI_IVA,
} from '../lib/ivaLiquidazione'
import {
  calcolaPiano, previsioneIncassiMese, proiezioneGiornaliera, primoGiornoNegativo,
  fasciaDaMacroGroup, isPagamentoAutomatico, isRiba, isObbligatoria, vociPersonale, f24Personale,
  addDaysYMD, diffGiorni, FASCE_ORDINE_DEFAULT, FASCIA_LABEL, raggruppaPerFornitore,
  type FasciaKey, type RigaUscita, type GruppoFornitore,
} from '../lib/fabbisogno'

/* ───── formato ───── */
const fmtEur = (n: number | null | undefined, dec = 0): string => {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n) + ' €'
}
const fmtData = (d: string | null | undefined): string =>
  d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
const fmtDataLunga = (d: string): string =>
  new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
const fmtDataBreve = (d: string): string =>
  new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
const parseNum = (s: string): number => {
  const v = parseFloat(String(s).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

const linkScadenzario = (supplierId: string | null, documento: string | null, fornitore: string): string => {
  const params = new URLSearchParams()
  if (supplierId) params.set('supplier', supplierId)
  const ricerca = (documento || fornitore || '').trim()
  if (ricerca) params.set('search', ricerca)
  const qs = params.toString()
  return qs ? `/scadenzario?${qs}` : '/scadenzario'
}

const FASCIA_COLOR: Record<FasciaKey, string> = {
  stipendi: 'bg-indigo-100 text-indigo-700',
  merci: 'bg-cyan-100 text-cyan-700',
  affitti: 'bg-amber-100 text-amber-700',
  fiscali: 'bg-violet-100 text-violet-700',
  altro: 'bg-slate-100 text-slate-600',
}

const DESTINAZIONE_LABEL: Record<FasciaKey, string> = {
  stipendi: 'Apri i Dipendenti',
  merci: 'Apri nello Scadenzario',
  affitti: 'Apri nello Scadenzario',
  fiscali: 'Apri le Scadenze fiscali',
  altro: 'Apri nello Scadenzario',
}

/** Ruoli che possono mettere e togliere le spunte (allineati alla RLS). */
const RUOLI_SCRITTURA = ['super_advisor', 'contabile', 'cfo']

/** Stati dello scadenzario che NON sono un debito da pagare. */
const STATI_ESCLUSI = new Set(['annullato', 'pagato', 'nota_credito'])

type FiltroFascia = 'tutte' | FasciaKey | 'scadute' | 'riba'

interface ContoRow {
  id: string
  bank_name: string | null
  account_name: string | null
  current_balance: number | null
  credit_line: number | null
  balance_updated_at: string | null
}

interface PayableViewRow {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  supplier_ragione_sociale: string | null
  invoice_number: string | null
  invoice_date: string | null
  due_date: string | null
  amount_remaining: number | null
  macro_group: string | null
  cost_category_name: string | null
  payment_method: string | null
  is_auto_debit: boolean | null
  status: string | null
}

interface FiscalRow {
  id: string
  title: string | null
  deadline_type: string | null
  amount: number | null
  amount_paid: number | null
  due_date: string
}

interface MustPayRow {
  id: string
  item_kind: 'payable' | 'fiscal' | 'payroll' | 'manual'
  payable_id: string | null
  fiscal_deadline_id: string | null
  item_ref: string | null
}

/** Costo del personale letto dall'ultimo mese chiuso. */
interface CostoPersonale {
  netto: number
  lordo: number
  contributiAzienda: number
  mese: string
}

export default function SimulazioneFabbisogno() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const COMPANY_ID = profile?.company_id
  const canEdit = RUOLI_SCRITTURA.includes(profile?.role || '')
  const [searchParams, setSearchParams] = useSearchParams()

  const oggi = useMemo(() => todayYMD(), [])
  const fineMeseCorrente = useMemo(() => {
    const d = new Date(oggi + 'T00:00:00')
    return lastDayOfMonthYMD(d.getFullYear(), d.getMonth() + 1)
  }, [oggi])

  const alParam = searchParams.get('al')
  const orizzonte = alParam && /^\d{4}-\d{2}-\d{2}$/.test(alParam) ? alParam : fineMeseCorrente
  const setOrizzonte = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('al', next)
    setSearchParams(params, { replace: true })
  }

  /* ───── dati ───── */
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [conti, setConti] = useState<ContoRow[]>([])
  const [payables, setPayables] = useState<PayableViewRow[]>([])
  const [fiscali, setFiscali] = useState<FiscalRow[]>([])
  const [costoPersonale, setCostoPersonale] = useState<CostoPersonale | null>(null)
  const [ivaAttese, setIvaAttese] = useState<{ ref: string; etichetta: string; data: string; importo: number }[]>([])
  const [obiettivoMeseLordo, setObiettivoMeseLordo] = useState(0)
  const [realizzatoMese, setRealizzatoMese] = useState(0)
  const [giorniRegistrati, setGiorniRegistrati] = useState(0)
  const [mustPay, setMustPay] = useState<MustPayRow[]>([])
  const [salvando, setSalvando] = useState<string | null>(null)
  const [chiediAzzera, setChiediAzzera] = useState(false)

  /* ───── parametri ───── */
  const [usaFido, setUsaFido] = useState(false)
  const [includiArretrato, setIncludiArretrato] = useState(true)
  const [includiPersonale, setIncludiPersonale] = useState(true)
  const [includiIva, setIncludiIva] = useState(true)
  const [giornoNetti, setGiornoNetti] = useState(10)
  const [giornoF24, setGiornoF24] = useState(16)
  const [nettoOverride, setNettoOverride] = useState('')
  const [ritmoOverride, setRitmoOverride] = useState('')
  const [liquiditaOverride, setLiquiditaOverride] = useState('')
  const [filtro, setFiltro] = useState<FiltroFascia>('tutte')
  const [ricerca, setRicerca] = useState('')
  /** Come si legge l'elenco: per posizione fornitore (default) o per data. */
  const [vista, setVista] = useState<'fornitore' | 'scadenza'>('fornitore')
  const [aperti, setAperti] = useState<Set<string>>(new Set())
  const [mostraAutomatici, setMostraAutomatici] = useState(false)

  /* ───── caricamento ───── */
  const loadData = useCallback(async () => {
    if (!COMPANY_ID) return
    setLoading(true)
    setErrore(null)
    try {
      const inizioMese = oggi.slice(0, 8) + '01'
      const annoCorr = Number(oggi.slice(0, 4))
      const meseCorr = Number(oggi.slice(5, 7))

      const [contiRes, fiscaliRes, budgetRes, ivaRateRes, mustRes, compRes, settRes, confRes, ivaPagateRes] = await Promise.all([
        supabase.from('bank_accounts')
          .select('id, bank_name, account_name, current_balance, credit_line, balance_updated_at')
          .eq('company_id', COMPANY_ID).eq('is_active', true),
        supabase.from('fiscal_deadlines')
          .select('id, title, deadline_type, amount, amount_paid, due_date')
          .eq('company_id', COMPANY_ID).eq('status', 'pending').lte('due_date', orizzonte),
        supabase.from('budget_confronto').select('amount')
          .eq('company_id', COMPANY_ID).eq('year', annoCorr).eq('month', meseCorr).eq('entry_type', 'rev_monthly'),
        supabase.from('daily_report_settings').select('budget_vat_rate').eq('company_id', COMPANY_ID).maybeSingle(),
        supabase.from('cash_must_pay').select('id, item_kind, payable_id, fiscal_deadline_id, item_ref')
          .eq('company_id', COMPANY_ID).eq('horizon_date', orizzonte),
        // ingredienti della liquidazione IVA: gli stessi della pagina dedicata
        supabase.from('v_iva_componenti_mensili').select('*').eq('company_id', COMPANY_ID),
        supabase.from('vat_settings').select('*').eq('company_id', COMPANY_ID).maybeSingle(),
        supabase.from('vat_settlements').select('*').eq('company_id', COMPANY_ID),
        supabase.from('fiscal_deadlines').select('tax_period, amount, due_date, status')
          .eq('company_id', COMPANY_ID).eq('deadline_type', 'iva_periodica'),
      ])
      if (contiRes.error) throw contiRes.error
      if (fiscaliRes.error) throw fiscaliRes.error
      if (mustRes.error) throw mustRes.error

      const payRows = await fetchAllPaged<PayableViewRow>(
        (from, to) => supabase.from('v_payables_operative')
          .select('id, supplier_id, supplier_name, supplier_ragione_sociale, invoice_number, invoice_date, due_date, amount_remaining, macro_group, cost_category_name, payment_method, is_auto_debit, status')
          .eq('company_id', COMPANY_ID).lte('due_date', orizzonte).gt('amount_remaining', 0)
          .order('id', { ascending: true }).range(from, to),
        'v_payables_operative',
      )

      const ricaviRows = await fetchAllPaged<{ id: string; date: string; gross_revenue: number | null }>(
        (from, to) => supabase.from('daily_revenue').select('id, date, gross_revenue')
          .eq('company_id', COMPANY_ID).gte('date', inizioMese).lte('date', oggi)
          .order('id', { ascending: true }).range(from, to),
        'daily_revenue',
      )

      // Personale: i netti stanno nei cedolini, il lordo e i contributi nel
      // prospetto contributivo. Si prende l'ultimo mese presente in entrambi.
      const cedolini = await fetchAllPaged<{ id: string; year: number | null; month: number | null; netto: number | null }>(
        (from, to) => supabase.from('employee_costs').select('id, year, month, netto')
          .eq('company_id', COMPANY_ID).order('id', { ascending: true }).range(from, to),
        'employee_costs',
      )
      const contributivi = await fetchAllPaged<{
        id: string; year: number | null; month: number | null
        totale_retribuzioni: number | null; contr_inps: number | null
        contr_ebinter: number | null; contr_est: number | null; contr_gestione_separata: number | null
      }>(
        (from, to) => supabase.from('personnel_gross_cost')
          .select('id, year, month, totale_retribuzioni, contr_inps, contr_ebinter, contr_est, contr_gestione_separata')
          .eq('company_id', COMPANY_ID).order('id', { ascending: true }).range(from, to),
        'personnel_gross_cost',
      )

      setConti((contiRes.data || []) as ContoRow[])
      setFiscali((fiscaliRes.data || []) as FiscalRow[])
      setPayables(payRows.filter(r => !STATI_ESCLUSI.has((r.status || '').trim())))
      setMustPay((mustRes.data || []) as MustPayRow[])

      const vat = Number((ivaRateRes.data as { budget_vat_rate?: number | string } | null)?.budget_vat_rate)
      const aliquota = Number.isFinite(vat) ? vat : 22
      const obiettivoNetto = (budgetRes.data || []).reduce((s, r) => s + Number((r as { amount: number | null }).amount || 0), 0)
      setObiettivoMeseLordo(obiettivoNetto * (1 + aliquota / 100))

      const giorni = new Set<string>()
      let realizzato = 0
      for (const r of ricaviRows) {
        realizzato += Number(r.gross_revenue || 0)
        if (r.date) giorni.add(String(r.date).slice(0, 10))
      }
      setRealizzatoMese(realizzato)
      setGiorniRegistrati(giorni.size)

      // ultimo mese dei cedolini
      let ultimoCed = { y: 0, m: 0 }
      for (const r of cedolini) {
        const y = Number(r.year || 0), m = Number(r.month || 0)
        if (y > ultimoCed.y || (y === ultimoCed.y && m > ultimoCed.m)) ultimoCed = { y, m }
      }
      const netto = cedolini
        .filter(r => Number(r.year) === ultimoCed.y && Number(r.month) === ultimoCed.m)
        .reduce((s, r) => s + Number(r.netto || 0), 0)
      const contribMese = contributivi.filter(r => Number(r.year) === ultimoCed.y && Number(r.month) === ultimoCed.m)
      const lordo = contribMese.reduce((s, r) => s + Number(r.totale_retribuzioni || 0), 0)
      const contributiAzienda = contribMese.reduce((s, r) =>
        s + Number(r.contr_inps || 0) + Number(r.contr_ebinter || 0) + Number(r.contr_est || 0) + Number(r.contr_gestione_separata || 0), 0)
      setCostoPersonale(ultimoCed.y
        ? { netto, lordo, contributiAzienda, mese: `${String(ultimoCed.m).padStart(2, '0')}/${ultimoCed.y}` }
        : null)

      // IVA: stessa catena della pagina Liquidazione IVA, nessun calcolo nuovo
      const sett = settRes.data as { sales_vat_rate?: number; start_year?: number; start_month?: number; opening_credit?: number } | null
      if (sett) {
        const settings: IvaSettings = {
          salesVatRate: Number(sett.sales_vat_rate ?? 22),
          startYear: Number(sett.start_year ?? annoCorr),
          startMonth: Number(sett.start_month ?? 1),
          openingCredit: Number(sett.opening_credit ?? 0),
        }
        const componenti = ((compRes.data || []) as Record<string, unknown>[]).map(r => ({
          year: Number(r.year), month: Number(r.month),
          chiusure_netto: Number(r.chiusure_netto ?? 0), giorni_chiusura: Number(r.giorni_chiusura ?? 0),
          consuntivo_netto: Number(r.consuntivo_netto ?? 0), preventivo_netto: Number(r.preventivo_netto ?? 0),
          iva_fatture_attive: Number(r.iva_fatture_attive ?? 0), n_fatture_attive: Number(r.n_fatture_attive ?? 0),
          iva_fatture_passive: Number(r.iva_fatture_passive ?? 0), iva_note_credito: Number(r.iva_note_credito ?? 0),
          iva_integrazioni: Number(r.iva_integrazioni ?? 0), n_fatture_passive: Number(r.n_fatture_passive ?? 0),
          n_note_credito: Number(r.n_note_credito ?? 0), n_integrazioni: Number(r.n_integrazioni ?? 0),
        })) as IvaComponentiMese[]
        const confermati = ((confRes.data || []) as Record<string, unknown>[]).map(r => ({
          year: Number(r.year), month: Number(r.month),
          corrispettivi_netti: Number(r.corrispettivi_netti ?? 0),
          iva_debito_corrispettivi: Number(r.iva_debito_corrispettivi ?? 0),
          iva_debito_fatture_attive: Number(r.iva_debito_fatture_attive ?? 0),
          iva_credito: Number(r.iva_credito ?? 0),
        })) as IvaMeseConfermato[]
        const pagati: IvaMesePagato[] = []
        const ivaGiaAScadenzario = new Set<string>()
        for (const r of ((ivaPagateRes.data || []) as { tax_period: string | null; amount: number | null; due_date: string; status: string }[])) {
          const per = String(r.tax_period || '')
          const m = per.match(/^(\d{4})-(\d{2})$/)
          if (!m) continue
          if (r.status === 'paid') pagati.push({ year: Number(m[1]), month: Number(m[2]), amount: Number(r.amount || 0) })
          if (r.status === 'pending') ivaGiaAScadenzario.add(per)
        }
        const fine = new Date(orizzonte + 'T00:00:00')
        const righe = buildLiquidazioni({
          componenti, settings, confermati, pagati,
          toYear: fine.getFullYear(), toMonth: fine.getMonth() + 1,
        })
        setIvaAttese(righe
          .filter(r => r.stato !== 'pagata' && r.importo > 0 && r.dueDate <= orizzonte && r.dueDate >= oggi)
          // se la stessa liquidazione è già una scadenza fiscale aperta, la si
          // lascia a quella: contarla due volte gonfierebbe il fabbisogno
          .filter(r => !ivaGiaAScadenzario.has(r.key))
          .map(r => ({
            ref: `iva-${r.key}`,
            etichetta: `IVA ${MESI_IVA[r.month]} ${r.year}`,
            data: r.dueDate,
            importo: r.importo,
          })))
      } else {
        setIvaAttese([])
      }
    } catch (err: unknown) {
      console.error('[SimulazioneFabbisogno] fetch error:', err)
      setErrore((err as Error).message || 'Errore nel caricamento dei dati')
    } finally {
      setLoading(false)
    }
  }, [COMPANY_ID, orizzonte, oggi])

  useEffect(() => { loadData() }, [loadData])

  /* ───── disponibilità ───── */
  const liquiditaConti = useMemo(() => conti.reduce((s, c) => s + Number(c.current_balance || 0), 0), [conti])
  const fidoTotale = useMemo(() => conti.reduce((s, c) => s + Number(c.credit_line || 0), 0), [conti])
  const saldoAggiornatoAl = useMemo(() => {
    const date = conti.map(c => c.balance_updated_at).filter(Boolean) as string[]
    return date.length ? date.sort()[date.length - 1] : null
  }, [conti])

  /* ───── personale ───── */
  const costoUsato = useMemo(() => {
    if (!costoPersonale) return null
    const netto = nettoOverride.trim() ? parseNum(nettoOverride) : costoPersonale.netto
    // se il netto viene forzato a mano, lordo e contributi si riproporzionano
    const fattore = costoPersonale.netto > 0 ? netto / costoPersonale.netto : 1
    return {
      netto,
      lordo: costoPersonale.lordo * fattore,
      contributiAzienda: costoPersonale.contributiAzienda * fattore,
      mese: costoPersonale.mese,
    }
  }, [costoPersonale, nettoOverride])

  const vociDelPersonale = useMemo(() => {
    if (!includiPersonale || !costoUsato) return []
    return vociPersonale({
      costo: costoUsato,
      dataInizio: oggi,
      dataFine: orizzonte,
      giornoNetti,
      giornoF24,
      meseTredicesima: 12,
      giornoTredicesima: 20,
      meseQuattordicesima: 6,
    })
  }, [includiPersonale, costoUsato, oggi, orizzonte, giornoNetti, giornoF24])

  /* ───── righe ───── */
  const righe: RigaUscita[] = useMemo(() => {
    const out: RigaUscita[] = []

    for (const p of payables) {
      const scaduta = !!p.due_date && p.due_date < oggi
      if (scaduta && !includiArretrato) continue
      const fornitore = p.supplier_ragione_sociale || p.supplier_name || 'Fornitore da attribuire'
      out.push({
        id: `pay-${p.id}`,
        key: fasciaDaMacroGroup(p.macro_group),
        descrizione: p.cost_category_name || 'Senza categoria',
        fornitore,
        documento: p.invoice_number,
        emissione: p.invoice_date,
        scadenza: p.due_date,
        importo: Number(p.amount_remaining || 0),
        automatico: isPagamentoAutomatico(p.payment_method, p.is_auto_debit),
        riba: isRiba(p.payment_method),
        link: linkScadenzario(p.supplier_id, p.invoice_number, fornitore),
      })
    }

    for (const f of fiscali) {
      const residuo = Number(f.amount || 0) - Number(f.amount_paid || 0)
      if (residuo <= 0) continue
      if (f.due_date < oggi && !includiArretrato) continue
      out.push({
        id: `fisc-${f.id}`,
        key: 'fiscali',
        descrizione: f.deadline_type || 'Scadenza fiscale',
        fornitore: f.title || 'Erario',
        documento: null,
        scadenza: f.due_date,
        importo: residuo,
        automatico: false,
        link: '/scadenze-fiscali',
      })
    }

    if (includiIva) {
      for (const i of ivaAttese) {
        out.push({
          id: i.ref,
          key: 'fiscali',
          descrizione: 'Liquidazione IVA',
          fornitore: i.etichetta,
          documento: null,
          scadenza: i.data,
          importo: i.importo,
          automatico: false,
          link: '/liquidazione-iva',
        })
      }
    }

    for (const v of vociDelPersonale) {
      out.push({
        id: v.ref,
        key: 'stipendi',
        descrizione: v.tipo === 'f24' ? 'F24 personale' : v.tipo === 'mensilita_aggiuntiva' ? 'Mensilità aggiuntiva' : 'Netti in busta',
        fornitore: v.etichetta,
        documento: null,
        scadenza: v.data,
        importo: v.importo,
        automatico: false,
        link: '/dipendenti',
      })
    }

    return out.sort((a, b) => ((a.scadenza || '') < (b.scadenza || '') ? -1 : 1))
  }, [payables, fiscali, ivaAttese, includiIva, vociDelPersonale, includiArretrato, oggi])

  /* ───── selezione ───── */
  const selezionati = useMemo(() => {
    const set = new Set<string>()
    for (const m of mustPay) {
      if (m.payable_id) set.add(`pay-${m.payable_id}`)
      else if (m.fiscal_deadline_id) set.add(`fisc-${m.fiscal_deadline_id}`)
      else if (m.item_ref) set.add(m.item_ref)
    }
    return set
  }, [mustPay])

  const trovaMustPay = useCallback((rigaId: string) => mustPay.find(m =>
    (m.payable_id && `pay-${m.payable_id}` === rigaId) ||
    (m.fiscal_deadline_id && `fisc-${m.fiscal_deadline_id}` === rigaId) ||
    m.item_ref === rigaId), [mustPay])

  const toggleRiga = useCallback(async (riga: RigaUscita, attiva: boolean) => {
    if (!COMPANY_ID || !canEdit || riga.automatico) return
    setSalvando(riga.id)
    try {
      if (!attiva) {
        const esistente = trovaMustPay(riga.id)
        if (esistente) {
          const { error } = await supabase.from('cash_must_pay').delete().eq('id', esistente.id)
          if (error) throw error
          setMustPay(prev => prev.filter(m => m.id !== esistente.id))
        }
        return
      }
      if (selezionati.has(riga.id)) return

      const base = { company_id: COMPANY_ID, horizon_date: orizzonte, created_by: profile?.id ?? null }
      const payload = riga.id.startsWith('pay-')
        ? { ...base, item_kind: 'payable', payable_id: riga.id.slice(4) }
        : riga.id.startsWith('fisc-')
          ? { ...base, item_kind: 'fiscal', fiscal_deadline_id: riga.id.slice(5) }
          : { ...base, item_kind: riga.id.startsWith('payroll-') ? 'payroll' : 'manual', item_ref: riga.id, label: riga.fornitore, amount: riga.importo }

      const { data, error } = await supabase.from('cash_must_pay').insert(payload)
        .select('id, item_kind, payable_id, fiscal_deadline_id, item_ref').single()
      if (error) throw error
      setMustPay(prev => [...prev, data as MustPayRow])
    } catch (err: unknown) {
      console.error('[SimulazioneFabbisogno] toggle:', err)
      toast({ type: 'error', message: 'Non sono riuscito a salvare la spunta: ' + ((err as Error).message || '') })
    } finally {
      setSalvando(null)
    }
  }, [COMPANY_ID, canEdit, trovaMustPay, selezionati, orizzonte, profile?.id, toast])

  /** Spunta o toglie in blocco un gruppo di righe (una categoria, o il filtro attivo). */
  const spuntaGruppo = async (gruppo: RigaUscita[], attiva: boolean) => {
    for (const r of gruppo) {
      if (r.automatico) continue
      const gia = selezionati.has(r.id)
      if (attiva && !gia) await toggleRiga(r, true)
      if (!attiva && gia) await toggleRiga(r, false)
    }
  }

  /** Azzera la simulazione: via tutte le spunte di questa data obiettivo. */
  const azzeraSimulazione = async () => {
    if (!COMPANY_ID || !canEdit) return
    setChiediAzzera(false)
    try {
      const { error } = await supabase.from('cash_must_pay').delete()
        .eq('company_id', COMPANY_ID).eq('horizon_date', orizzonte)
      if (error) throw error
      setMustPay([])
      toast({ type: 'success', message: 'Simulazione azzerata: restano solo gli addebiti automatici.' })
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Non sono riuscito ad azzerare: ' + ((err as Error).message || '') })
    }
  }

  /* ───── incassi ───── */
  const giorniResidui = Math.max(0, diffGiorni(oggi, orizzonte))
  const giorniMese = useMemo(() => Number(fineMeseCorrente.slice(8, 10)), [fineMeseCorrente])

  const incassi = useMemo(() => previsioneIncassiMese({
    realizzato: realizzatoMese, giorniRegistrati, giorniResidui,
    obiettivoMensile: obiettivoMeseLordo || null, giorniMese,
  }), [realizzatoMese, giorniRegistrati, giorniResidui, obiettivoMeseLordo, giorniMese])

  const ritmoUsato = ritmoOverride.trim() ? parseNum(ritmoOverride) : incassi.ritmoGiornaliero
  const incassiAttesi = ritmoUsato * giorniResidui
  const liquiditaIniziale = liquiditaOverride.trim() ? parseNum(liquiditaOverride) : liquiditaConti
  const disponibilita = liquiditaIniziale + incassiAttesi + (usaFido ? fidoTotale : 0)

  const piano = useMemo(() => calcolaPiano({ righe, selezionati, disponibilita }), [righe, selezionati, disponibilita])

  const proiezione = useMemo(() => proiezioneGiornaliera({
    dataInizio: oggi,
    dataFine: orizzonte,
    saldoIniziale: liquiditaIniziale + (usaFido ? fidoTotale : 0),
    incassoGiornaliero: ritmoUsato,
    uscite: righe.filter(r => isObbligatoria(r, selezionati))
      .map(r => ({ data: r.scadenza || oggi, importo: r.importo, key: r.key })),
  }), [oggi, orizzonte, liquiditaIniziale, usaFido, fidoTotale, ritmoUsato, righe, selezionati])

  const giornoRottura = primoGiornoNegativo(proiezione)
  const graficoData = useMemo(() => proiezione.map(g => ({ ...g, label: fmtDataBreve(g.data) })), [proiezione])

  /* ───── lista ─────
   * Gli addebiti automatici NON stanno qui: non c'e' niente da decidere, escono
   * dal conto da soli. Restano contati nei totali e riassunti in una riga sola.
   */
  const righeAutomatiche = useMemo(() => righe.filter(r => r.automatico), [righe])
  const totaleAutomatico = useMemo(
    () => righeAutomatiche.reduce((s, r) => s + r.importo, 0), [righeAutomatiche])

  const righeVisibili = useMemo(() => {
    const q = ricerca.trim().toLowerCase()
    return righe.filter(r => {
      if (r.automatico) return false
      if (filtro === 'scadute' && !(r.scadenza && r.scadenza < oggi)) return false
      if (filtro === 'riba' && !r.riba) return false
      if (filtro !== 'tutte' && filtro !== 'scadute' && filtro !== 'riba' && r.key !== filtro) return false
      if (!q) return true
      return `${r.fornitore} ${r.documento || ''} ${r.descrizione}`.toLowerCase().includes(q)
    })
  }, [righe, filtro, ricerca, oggi])

  const gruppiVisibili = useMemo(
    () => raggruppaPerFornitore(righeVisibili, selezionati, oggi),
    [righeVisibili, selezionati, oggi])

  const perFascia = useMemo(() => {
    const m = new Map<FasciaKey, { righe: RigaUscita[]; tot: number; obbl: number; auto: number; riba: number }>()
    for (const k of FASCE_ORDINE_DEFAULT) m.set(k, { righe: [], tot: 0, obbl: 0, auto: 0, riba: 0 })
    for (const r of righe) {
      const acc = m.get(r.key)!
      acc.righe.push(r)
      acc.tot += r.importo
      if (isObbligatoria(r, selezionati)) acc.obbl += r.importo
      if (r.automatico) acc.auto += r.importo
      if (r.riba && !isObbligatoria(r, selezionati)) acc.riba += r.importo
    }
    return m
  }, [righe, selezionati])

  /** RiBa non classificate come obbligatorie: diventerebbero insoluti. */
  const ribaFuori = useMemo(() => {
    const fuori = righe.filter(r => r.riba && !isObbligatoria(r, selezionati))
    return { n: fuori.length, importo: fuori.reduce((s, r) => s + r.importo, 0) }
  }, [righe, selezionati])

  const esportaCsv = () => {
    const rows = [
      ['Obbligatoria', 'Motivo', 'Categoria', 'Voce', 'Documento', 'Scadenza', 'Importo'],
      ...righe.map(r => [
        isObbligatoria(r, selezionati) ? 'si' : 'no',
        r.automatico ? 'addebito automatico' : selezionati.has(r.id) ? 'scelta' : r.riba ? 'RiBa non spuntata: insoluto' : '',
        FASCIA_LABEL[r.key], r.fornitore, r.documento || '', r.scadenza || '', r.importo.toFixed(2),
      ]),
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `fabbisogno_${orizzonte}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ───── righe e gruppi ───── */
  const toggleAperto = (fornitore: string) => {
    setAperti(prev => {
      const next = new Set(prev)
      if (next.has(fornitore)) next.delete(fornitore)
      else next.add(fornitore)
      return next
    })
  }

  const renderRiga = (r: RigaUscita, dentro: boolean) => {
    const obbl = isObbligatoria(r, selezionati)
    return (
      <tr key={r.id} className={`border-t border-slate-100 ${obbl ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}`}>
        <td className={`px-3 py-2 ${dentro ? 'pl-8' : ''}`}>
          <input type="checkbox" checked={obbl} disabled={!canEdit || salvando === r.id}
            onChange={e => toggleRiga(r, e.target.checked)}
            aria-label={`Classifica come obbligatoria: ${r.fornitore} ${r.documento || ''}`}
            className="w-4 h-4 accent-indigo-600" />
        </td>
        <td className={`px-3 py-2 ${dentro ? 'pl-8 text-slate-600' : 'text-slate-900'}`}>
          {dentro ? (r.documento || r.descrizione) : r.fornitore}
          {r.riba && (
            <span className="ml-2 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700"
              title="Ricevuta bancaria: se non la paghi torna insoluta al fornitore">
              <FileWarning size={10} /> RiBa
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-slate-500">{dentro ? fmtData(r.emissione) : (r.documento || r.descrizione)}</td>
        <td className={`px-3 py-2 ${r.scadenza && r.scadenza < oggi ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
          {fmtData(r.scadenza)}
        </td>
        <td className="px-3 py-2">
          {!dentro && <span className={`px-2 py-0.5 rounded text-xs font-medium ${FASCIA_COLOR[r.key]}`}>{FASCIA_LABEL[r.key]}</span>}
        </td>
        <td className="px-3 py-2 text-right font-medium text-slate-900">{fmtEur(r.importo, 2)}</td>
        <td className="px-2 py-2">
          {r.link && (
            <Link to={r.link} title={DESTINAZIONE_LABEL[r.key]} aria-label={`${DESTINAZIONE_LABEL[r.key]}: ${r.fornitore}`}
              className="inline-flex p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50">
              <ExternalLink size={15} />
            </Link>
          )}
        </td>
      </tr>
    )
  }

  const renderGruppo = (g: GruppoFornitore) => {
    const aperto = aperti.has(g.fornitore)
    const tutte = g.nObbligatorie === g.righe.length
    const nessuna = g.nObbligatorie === 0
    const primoLink = g.righe.find(r => r.link)?.link || null
    return (
      <Fragment key={g.fornitore}>
        <tr className={`border-t-2 border-slate-200 ${tutte ? 'bg-indigo-50/60' : 'bg-slate-50/80'}`}>
          <td className="px-3 py-2">
            <input type="checkbox" checked={tutte}
              ref={el => { if (el) el.indeterminate = !tutte && !nessuna }}
              disabled={!canEdit || salvando !== null}
              onChange={e => spuntaGruppo(g.righe, e.target.checked)}
              aria-label={`Classifica come obbligatoria tutta la posizione di ${g.fornitore}`}
              className="w-4 h-4 accent-indigo-600" />
          </td>
          <td className="px-3 py-2">
            <button type="button" onClick={() => toggleAperto(g.fornitore)}
              aria-expanded={aperto}
              className="inline-flex items-center gap-1.5 font-semibold text-slate-900 hover:text-indigo-700">
              {aperto ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              {g.fornitore}
            </button>
            <span className="ml-2 text-xs text-slate-500">
              {g.righe.length} {g.righe.length === 1 ? 'fattura' : 'fatture'}
              {g.nObbligatorie > 0 && !tutte && ` · ${g.nObbligatorie} spuntate`}
            </span>
          </td>
          <td className="px-3 py-2 text-xs text-slate-500">
            {g.righe.length > 1 ? `dal ${fmtData(g.righe[0].emissione)}` : fmtData(g.righe[0]?.emissione)}
          </td>
          <td className="px-3 py-2 text-xs">
            <span className={g.primaScadenza && g.primaScadenza < oggi ? 'text-red-600 font-medium' : 'text-slate-600'}>
              {fmtData(g.primaScadenza)}
            </span>
            {g.scaduto > 0 && <span className="block text-[11px] text-red-600">{fmtEur(g.scaduto)} già scaduti</span>}
          </td>
          <td className="px-3 py-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${FASCIA_COLOR[g.key]}`}>{FASCIA_LABEL[g.key]}</span>
          </td>
          <td className="px-3 py-2 text-right font-bold text-slate-900">{fmtEur(g.totale, 2)}</td>
          <td className="px-2 py-2">
            {primoLink && (
              <Link to={primoLink} title={DESTINAZIONE_LABEL[g.key]} aria-label={`${DESTINAZIONE_LABEL[g.key]}: ${g.fornitore}`}
                className="inline-flex p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50">
                <ExternalLink size={15} />
              </Link>
            )}
          </td>
        </tr>
        {aperto && g.righe.map(r => renderRiga(r, true))}
      </Fragment>
    )
  }

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Simulazione fabbisogno" subtitle="Caricamento dei dati…" />
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={18} /> Un attimo…</div>
      </div>
    )
  }

  const FILTRI: { key: FiltroFascia; label: string }[] = [
    { key: 'tutte', label: 'Tutte' },
    ...FASCE_ORDINE_DEFAULT.map(k => ({ key: k as FiltroFascia, label: FASCIA_LABEL[k] })),
    { key: 'scadute', label: 'Già scadute' },
    { key: 'riba', label: 'RiBa' },
  ]

  const copertura = piano.coperturaObbligatorioPct

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Simulazione fabbisogno"
        subtitle="Fabbisogno finanziario alla data: impegni obbligatori a confronto con le risorse disponibili"
        actions={
          <>
            {canEdit && (
              <button onClick={() => setChiediAzzera(true)}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600">
                <Eraser size={16} /> Azzera
              </button>
            )}
            <button onClick={loadData} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">
              <RefreshCw size={16} /> Ricarica
            </button>
            <button onClick={esportaCsv} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800">
              <Download size={16} /> Esporta
            </button>
          </>
        }
      />

      {errore && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{errore}</div>}

      {/* ─── PROSPETTO DI SINTESI ─── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm mb-6 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Posizione finanziaria al {fmtDataLunga(orizzonte)}</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Elaborazione del {fmtDataLunga(oggi)} su {piano.nTotali} impegni rilevati, di cui {piano.nSelezionate} classificati come obbligatori
            </div>
          </div>
          <label className="shrink-0">
            <span className="block text-xs text-slate-500 mb-1">Data di riferimento</span>
            <input type="date" value={orizzonte} min={oggi} onChange={e => setOrizzonte(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-100">
          <div className="bg-white px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Impegni obbligatori</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{fmtEur(piano.obbligatorio)}</div>
            <div className="text-xs text-slate-500 mt-1">di cui {fmtEur(piano.obbligatorioAutomatico)} ad addebito automatico</div>
          </div>
          <div className="bg-white px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Risorse disponibili</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{fmtEur(disponibilita)}</div>
            <div className="text-xs text-slate-500 mt-1">liquidità {fmtEur(liquiditaIniziale)} più incassi previsti {fmtEur(incassiAttesi)}</div>
          </div>
          <div className={`px-5 py-4 ${piano.fabbisogno > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {piano.fabbisogno > 0 ? 'Fabbisogno da coprire' : 'Margine disponibile'}
            </div>
            <div className={`text-2xl font-bold mt-1 ${piano.fabbisogno > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {fmtEur(piano.fabbisogno > 0 ? piano.fabbisogno : piano.avanzo)}
            </div>
            <div className="text-xs text-slate-600 mt-1">
              grado di copertura {copertura.toFixed(1)}%
              {giornoRottura ? ` · saldo negativo dal ${fmtData(giornoRottura)}` : ''}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-sm text-slate-700">
          {piano.nSelezionate === 0
            ? 'Nessun impegno è ancora classificato come obbligatorio. Procedere alla selezione nel passo 1.'
            : piano.fabbisogno > 0
              ? <>A fronte di impegni obbligatori per {fmtEur(piano.obbligatorio)} le risorse stimate ammontano a {fmtEur(disponibilita)}: il fabbisogno residuo è di <strong className="text-red-700">{fmtEur(piano.fabbisogno)}</strong>, da reperire o da rinviare entro il {fmtData(orizzonte)}.</>
              : <>Le risorse stimate coprono integralmente gli impegni obbligatori, con un margine di <strong className="text-emerald-700">{fmtEur(piano.avanzo)}</strong> a fronte di {fmtEur(piano.rinviabile)} di impegni rinviabili.</>}
        </div>
      </div>

      {!canEdit && (
        <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600 flex items-center gap-2">
          <Lock size={15} className="text-slate-400" />
          Consultazione in sola lettura: la classificazione degli impegni è riservata ad amministrazione, CFO e super advisor.
        </div>
      )}

      {/* ═══ PASSO 1 ═══ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <span className="text-sm font-semibold text-slate-900">Cosa non possiamo non pagare</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 ml-8">
            Gli impegni con scadenza entro il {fmtData(orizzonte)} su cui hai una scelta: fatture, imposte, personale.
            Spunta quelli a cui non vuoi dire di no. Le fatture sono raggruppate per fornitore, in ordine di emissione,
            così apri una posizione e decidi tutta insieme. SDD, RID e carte non compaiono: escono dal conto da soli,
            sono già scalati dalle risorse e li trovi riassunti qui sotto.
          </div>
        </div>

        {/* riepilogo per categoria con tutte / nessuna */}
        <div className="p-4 border-b border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {FASCE_ORDINE_DEFAULT.map(k => {
            const v = perFascia.get(k)!
            const manuali = v.righe.filter(r => !r.automatico)
            return (
              <div key={k} className="rounded-lg border border-slate-200 p-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${FASCIA_COLOR[k]}`}>{FASCIA_LABEL[k]}</span>
                <div className="mt-2 text-sm font-semibold text-slate-900">{fmtEur(v.obbl)}</div>
                <div className="text-xs text-slate-500">su {fmtEur(v.tot)} · {v.righe.length} voci</div>
                {v.auto > 0 && <div className="text-[11px] text-red-600 mt-0.5">{fmtEur(v.auto)} automatici</div>}
                {v.riba > 0 && <div className="text-[11px] text-amber-700 mt-0.5">{fmtEur(v.riba)} RiBa non spuntate</div>}
                {canEdit && manuali.length > 0 && (
                  <div className="flex gap-1 mt-2">
                    <button onClick={() => spuntaGruppo(manuali, true)}
                      className="flex-1 px-2 py-1 rounded text-[11px] font-medium bg-slate-900 text-white hover:bg-slate-800">tutte</button>
                    <button onClick={() => spuntaGruppo(manuali, false)}
                      className="flex-1 px-2 py-1 rounded text-[11px] font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">nessuna</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* filtri */}
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {FILTRI.map(f => (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${filtro === f.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {f.label}
            </button>
          ))}
          <div className="ml-auto inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {([['fornitore', 'Per fornitore'], ['scadenza', 'Per scadenza']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setVista(v)}
                aria-pressed={vista === v}
                className={`px-2.5 py-1 text-xs font-medium ${vista === v ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={ricerca} onChange={e => setRicerca(e.target.value)} placeholder="Cerca fornitore o fattura"
              className="pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-sm w-56" />
            {ricerca && (
              <button onClick={() => setRicerca('')} aria-label="Pulisci la ricerca"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>
            )}
          </div>
        </div>

        {righeAutomatiche.length > 0 && (
          <div className="px-4 py-2.5 border-b border-slate-100 bg-red-50/60 text-sm text-red-800">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Zap size={15} className="shrink-0" />
              <span>
                <strong>{fmtEur(totaleAutomatico, 2)}</strong> di addebiti automatici su {righeAutomatiche.length} voci
                (SDD, RID, carte): già scalati dalle risorse, non c'è niente da decidere.
              </span>
              <button type="button" onClick={() => setMostraAutomatici(v => !v)}
                aria-expanded={mostraAutomatici}
                className="text-xs font-medium underline underline-offset-2 hover:text-red-900">
                {mostraAutomatici ? 'nascondi il dettaglio' : 'vedi il dettaglio'}
              </button>
            </div>
            {mostraAutomatici && (
              <ul className="mt-2 pl-6 space-y-0.5 text-xs text-red-700 max-h-40 overflow-y-auto">
                {righeAutomatiche.map(r => (
                  <li key={r.id} className="flex justify-between gap-3">
                    <span className="truncate">{r.fornitore}{r.documento ? ` · ${r.documento}` : ''} · {fmtData(r.scadenza)}</span>
                    <span className="shrink-0 font-medium">{fmtEur(r.importo, 2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {canEdit && (
          <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2 bg-slate-50">
            <span className="text-xs text-slate-500">Sulle {righeVisibili.length} voci mostrate:</span>
            <button onClick={() => spuntaGruppo(righeVisibili, true)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100">spunta tutte</button>
            <button onClick={() => spuntaGruppo(righeVisibili, false)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100">togli le spunte</button>
          </div>
        )}

        <div className="overflow-x-auto max-h-[34rem]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="text-left px-3 py-2 font-medium">{vista === 'fornitore' ? 'Fornitore e fatture' : 'Voce'}</th>
                <th className="text-left px-3 py-2 font-medium">Emissione</th>
                <th className="text-left px-3 py-2 font-medium">Scadenza</th>
                <th className="text-left px-3 py-2 font-medium">Categoria</th>
                <th className="text-right px-3 py-2 font-medium">Importo</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {vista === 'fornitore'
                ? gruppiVisibili.map(g => renderGruppo(g))
                : righeVisibili.map(r => renderRiga(r, false))}
              {righeVisibili.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">Nessuna voce con questi filtri.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {ribaFuori.importo > 0 && (
          <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-sm text-amber-800 flex items-start gap-2">
            <FileWarning size={16} className="shrink-0 mt-0.5" />
            <span>
              {ribaFuori.n} ricevute bancarie per {fmtEur(ribaFuori.importo)} non sono fra gli obbligatori.
              Si possono lasciare impagate, ma tornano insolute al fornitore, con le commissioni di insoluto e il colpo al rapporto:
              è una scelta, non un risparmio.
            </span>
          </div>
        )}

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold text-slate-900">
            Obbligatori {piano.nSelezionate} su {piano.nTotali}: {fmtEur(piano.obbligatorio)}
          </span>
          <span className="text-slate-500">rinviabili: {fmtEur(piano.rinviabile)}</span>
          {piano.obbligatorioAutomatico > 0 && (
            <span className="text-red-600 inline-flex items-center gap-1">
              <Zap size={12} /> {fmtEur(piano.obbligatorioAutomatico)} inclusi d'ufficio come addebiti automatici
            </span>
          )}
        </div>
      </section>

      {/* ═══ PASSO 2 ═══ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-sm font-semibold text-slate-900">Quanto avrai entro il {fmtData(orizzonte)}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 ml-8">
            Liquidità di oggi più gli incassi dei punti vendita fino alla data. Il ritmo si aggiorna da solo ogni sera,
            quando i negozi caricano i ricavi.
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-slate-100">
          <div className="bg-white p-4">
            <div className="text-xs uppercase text-slate-500 font-medium">In banca oggi</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{fmtEur(liquiditaIniziale)}</div>
            <div className="text-xs text-slate-500 mt-1">
              {conti.length} conti attivi{saldoAggiornatoAl ? `, aggiornati al ${fmtData(saldoAggiornatoAl)}` : ''}
            </div>
            <input type="text" inputMode="decimal" value={liquiditaOverride} placeholder="correggi il saldo"
              onChange={e => setLiquiditaOverride(e.target.value)}
              className="mt-3 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <label className="flex items-center gap-2 text-sm text-slate-700 mt-3">
              <input type="checkbox" checked={usaFido} onChange={e => setUsaFido(e.target.checked)} className="accent-indigo-600" />
              Considera il fido ({fmtEur(fidoTotale)})
            </label>
          </div>

          <div className="bg-white p-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Incassi previsti ({giorniResidui} giorni)</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{fmtEur(incassiAttesi)}</div>
            <div className="text-xs text-slate-500 mt-1">
              {fmtEur(ritmoUsato)} al giorno{ritmoOverride.trim() ? ' (impostato da te)' : ` (ritmo del mese su ${giorniRegistrati} giorni)`}
            </div>
            <input type="text" inputMode="decimal" value={ritmoOverride} placeholder="correggi l'incasso giornaliero"
              onChange={e => setRitmoOverride(e.target.value)}
              className="mt-3 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <div className="text-[11px] text-slate-400 mt-2">
              Il ricavo di oggi si considera già in banca, quindi si contano i giorni da domani.
            </div>
          </div>

          <div className="bg-white p-4">
            <div className="text-xs uppercase text-slate-500 font-medium flex items-center gap-1.5">
              <Target size={13} /> Il mese contro l'obiettivo
            </div>
            {obiettivoMeseLordo > 0 ? (
              <>
                <div className={`text-2xl font-bold mt-1 flex items-center gap-2 ${(incassi.scostamento ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {(incassi.scostamento ?? 0) >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                  {(incassi.scostamento ?? 0) >= 0 ? '+' : ''}{fmtEur(incassi.scostamento)}
                </div>
                <dl className="mt-2 space-y-1 text-xs text-slate-600">
                  <div className="flex justify-between"><dt>obiettivo del mese</dt><dd className="font-medium">{fmtEur(obiettivoMeseLordo)}</dd></div>
                  <div className="flex justify-between"><dt>fatto finora</dt><dd className="font-medium">{fmtEur(realizzatoMese)}</dd></div>
                  <div className="flex justify-between"><dt>chiusura a questo ritmo</dt><dd className="font-medium">{fmtEur(incassi.proiezioneMese)}</dd></div>
                  {incassi.passoRichiesto != null && (
                    <div className="flex justify-between"><dt>servirebbero al giorno</dt><dd className="font-medium">{fmtEur(incassi.passoRichiesto)}</dd></div>
                  )}
                </dl>
                <div className="text-[11px] text-slate-400 mt-2">
                  Obiettivo da Budget → Inserimento rapido, portato a lordo IVA.
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-2">
                Nessun obiettivo inserito per questo mese. Impostalo in Budget → Inserimento rapido.
              </div>
            )}
          </div>
        </div>

        {/* parametri delle uscite calcolate */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Uscite calcolate, non a scadenzario</div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includiPersonale} onChange={e => setIncludiPersonale(e.target.checked)} className="accent-indigo-600" />
              Personale
            </label>
            {costoPersonale ? (
              <>
                <span className="text-xs text-slate-500">
                  ultimo cedolino {costoPersonale.mese}: netti {fmtEur(costoUsato?.netto)} il giorno
                </span>
                <input type="number" min={1} max={28} value={giornoNetti}
                  onChange={e => setGiornoNetti(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-14 px-2 py-1 border border-slate-200 rounded text-sm" />
                <span className="text-xs text-slate-500">
                  F24 di {fmtEur(costoUsato ? f24Personale(costoUsato) : 0)} il giorno
                </span>
                <input type="number" min={1} max={28} value={giornoF24}
                  onChange={e => setGiornoF24(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
                  className="w-14 px-2 py-1 border border-slate-200 rounded text-sm" />
                <input type="text" inputMode="decimal" value={nettoOverride} placeholder="correggi i netti"
                  onChange={e => setNettoOverride(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm w-40" />
              </>
            ) : (
              <span className="text-xs text-amber-700">Nessun cedolino caricato: il personale non entra nel calcolo.</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={includiIva} onChange={e => setIncludiIva(e.target.checked)} className="accent-indigo-600" />
              Liquidazione IVA
            </label>
            <span className="text-xs text-slate-500">
              {ivaAttese.length
                ? `${ivaAttese.length} liquidazioni entro la data, ${fmtEur(ivaAttese.reduce((s, i) => s + i.importo, 0))} in totale`
                : 'nessuna liquidazione a debito entro la data'}
            </span>
            <label className="flex items-center gap-2 ml-auto">
              <input type="checkbox" checked={includiArretrato} onChange={e => setIncludiArretrato(e.target.checked)} className="accent-indigo-600" />
              Includi lo scaduto arretrato
            </label>
          </div>

          {includiPersonale && costoUsato && (
            <div className="text-[11px] text-slate-500">
              Il personale esce in due momenti: i netti in busta il {giornoNetti} e l'F24 di ritenute e contributi il {giornoF24}.
              Su un orizzonte lungo entrano anche la quattordicesima di giugno e la tredicesima del 20 dicembre, entrambe pari a una mensilità.
            </div>
          )}
        </div>
      </section>

      {/* ═══ PASSO 3 ═══ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <span className="text-sm font-semibold text-slate-900">Andamento della cassa</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 ml-8">
            Saldo giorno per giorno con i soli impegni obbligatori, incassi al ritmo corrente e arretrato imputato al primo giorno.
          </div>
        </div>

        <div className="p-4">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={graficoData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="saldoFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="label" {...AXIS_STYLE} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...AXIS_STYLE} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                <Tooltip content={<GlassTooltip formatter={(v: number) => fmtEur(v)} />} />
                <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="saldo" name="Saldo" stroke="#6366f1" strokeWidth={2} fill="url(#saldoFill)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {piano.fabbisogno === 0 && piano.nSelezionate > 0 && (
          <div className="px-4 py-3 bg-emerald-50 border-t border-emerald-100 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            Le risorse coprono tutti gli impegni obbligatori. Il margine di {fmtEur(piano.avanzo)} è disponibile per i {fmtEur(piano.rinviabile)} rinviabili.
          </div>
        )}
      </section>

      {/* nota metodologica */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
        <Info size={16} className="shrink-0 mt-0.5 text-slate-400" />
        <div className="space-y-1">
          <div><strong>Addebiti automatici.</strong> SDD, RID e addebiti su carta sono obbligatori d'ufficio: partono dal conto per mandato dato al creditore, senza che nessuno disponga niente. Restano in elenco con la spunta bloccata.</div>
          <div><strong>Le RiBa sono decidibili.</strong> Una ricevuta bancaria si può lasciare impagata: torna insoluta al fornitore, con commissioni e danno di rapporto, ma resta una scelta. Per questo la spunta è libera e quelle lasciate fuori vengono segnalate.</div>
          <div><strong>Personale e IVA.</strong> Non stanno a scadenzario e vengono calcolati: il personale dall'ultimo cedolino chiuso (netti, più ritenute e contributi in F24), l'IVA dalla stessa catena di liquidazione della pagina dedicata. Se una liquidazione è già a scadenzario come F24, non viene contata due volte.</div>
          <div><strong>La selezione è condivisa e resta.</strong> Le spunte si salvano legate alla data di riferimento: cambiando data si riparte da una selezione nuova. Il pulsante Azzera cancella le spunte di quella data.</div>
          <div><strong>Cosa non entra.</strong> Costi ricorrenti non ancora fatturati, RiBa presentate ma non ancora a scadenzario, insoluti in corso di rientro.</div>
        </div>
      </div>

      {conti.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
          {conti.map(c => (
            <span key={c.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200">
              <Building2 size={12} className="text-slate-400" />
              {c.bank_name?.split(' ')[0] || c.account_name} · {fmtEur(Number(c.current_balance || 0))}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white border border-slate-200">
            <Wallet size={12} className="text-slate-400" /> totale {fmtEur(liquiditaConti)}
          </span>
        </div>
      )}

      <Modal open={chiediAzzera} onClose={() => setChiediAzzera(false)} title="Azzerare la simulazione?">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Vengono tolte tutte le spunte messe per il {fmtData(orizzonte)}: {piano.nSelezionate} voci per {fmtEur(piano.obbligatorio)}.
            Gli addebiti automatici restano, perché non dipendono da una scelta. Nessuna fattura viene toccata.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setChiediAzzera(false)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Annulla</button>
            <button onClick={azzeraSimulazione}
              className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">Azzera la simulazione</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
