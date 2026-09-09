// ─────────────────────────────────────────────────────────────────────────────
// SIMULAZIONE FABBISOGNO — tre passi: cosa devi pagare, quanto avrai, cosa manca
//
// Il modello NON decide da solo cosa si paga. Chi tiene l'amministrazione spunta
// riga per riga le uscite obbligatorie entro la data (fatture, tasse, stipendi);
// la selezione si salva in `cash_must_pay` ed è condivisa fra gli utenti
// dell'azienda. Solo dopo si fa il conto: obbligatorio contro disponibilità.
//
// Gli incassi attesi non sono una media del passato: i negozi scaricano i ricavi
// ogni sera, quindi il ritmo di questo mese è un dato. L'obiettivo del mese
// (Budget → Inserimento rapido, tabella budget_confronto) serve a dire se si è
// avanti o indietro, non a costruire la previsione.
//
// Fonti, tutte sul tenant attivo:
//  - liquidità   → bank_accounts (conti attivi) + fido opzionale
//  - uscite      → v_payables_operative, fiscal_deadlines, employee_costs
//  - selezione   → cash_must_pay (scrittura: super_advisor, cfo, contabile)
//  - obiettivo   → budget_confronto (rev_monthly) + IVA da daily_report_settings
//  - realizzato  → daily_revenue del mese in corso
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Wallet, AlertTriangle, Download, Loader2, Info, RefreshCw, CheckCircle2,
  Building2, ExternalLink, Search, X, Target, TrendingUp, TrendingDown, Lock,
} from 'lucide-react'
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import PageHeader from '../components/PageHeader'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { todayYMD, lastDayOfMonthYMD } from '../lib/dateLocal'
import {
  calcolaPiano, previsioneIncassiMese, proiezioneGiornaliera, primoGiornoNegativo,
  fasciaDaMacroGroup, isPagamentoAutomatico, addDaysYMD, diffGiorni,
  FASCE_ORDINE_DEFAULT, FASCIA_LABEL,
  type FasciaKey, type RigaUscita,
} from '../lib/fabbisogno'

/* ───── formato ───── */
const fmtEur = (n: number | null | undefined, dec = 0): string => {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n) + ' €'
}
const fmtData = (d: string | null | undefined): string =>
  d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
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

type FiltroFascia = 'tutte' | FasciaKey | 'scadute' | 'automatiche'

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

/** Riga di `cash_must_pay` così come la scriviamo. */
interface MustPayRow {
  id: string
  item_kind: 'payable' | 'fiscal' | 'payroll' | 'manual'
  payable_id: string | null
  fiscal_deadline_id: string | null
  item_ref: string | null
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
  const [nettoMensile, setNettoMensile] = useState(0)
  const [meseStipendi, setMeseStipendi] = useState('')
  const [obiettivoMeseLordo, setObiettivoMeseLordo] = useState(0)
  const [realizzatoMese, setRealizzatoMese] = useState(0)
  const [giorniRegistrati, setGiorniRegistrati] = useState(0)
  const [mustPay, setMustPay] = useState<MustPayRow[]>([])
  const [salvando, setSalvando] = useState<string | null>(null)

  /* ───── parametri ───── */
  const [usaFido, setUsaFido] = useState(false)
  const [includiArretrato, setIncludiArretrato] = useState(true)
  const [includiStipendi, setIncludiStipendi] = useState(true)
  const [giornoStipendi, setGiornoStipendi] = useState(10)
  const [stipendiOverride, setStipendiOverride] = useState('')
  const [ritmoOverride, setRitmoOverride] = useState('')
  const [liquiditaOverride, setLiquiditaOverride] = useState('')
  const [filtro, setFiltro] = useState<FiltroFascia>('tutte')
  const [ricerca, setRicerca] = useState('')

  /* ───── caricamento ───── */
  const loadData = useCallback(async () => {
    if (!COMPANY_ID) return
    setLoading(true)
    setErrore(null)
    try {
      const inizioMese = oggi.slice(0, 8) + '01'
      const annoCorr = Number(oggi.slice(0, 4))
      const meseCorr = Number(oggi.slice(5, 7))

      const [contiRes, fiscaliRes, budgetRes, ivaRes, mustRes] = await Promise.all([
        supabase.from('bank_accounts')
          .select('id, bank_name, account_name, current_balance, credit_line, balance_updated_at')
          .eq('company_id', COMPANY_ID).eq('is_active', true),
        supabase.from('fiscal_deadlines')
          .select('id, title, deadline_type, amount, amount_paid, due_date')
          .eq('company_id', COMPANY_ID).eq('status', 'pending').lte('due_date', orizzonte),
        // Obiettivo del mese: il preventivo per punto vendita di Budget →
        // Inserimento rapido. È netto, va portato a lordo per confrontarlo con
        // la cassa.
        supabase.from('budget_confronto')
          .select('amount')
          .eq('company_id', COMPANY_ID).eq('year', annoCorr).eq('month', meseCorr).eq('entry_type', 'rev_monthly'),
        supabase.from('daily_report_settings').select('budget_vat_rate').eq('company_id', COMPANY_ID).maybeSingle(),
        supabase.from('cash_must_pay')
          .select('id, item_kind, payable_id, fiscal_deadline_id, item_ref')
          .eq('company_id', COMPANY_ID).eq('horizon_date', orizzonte),
      ])
      if (contiRes.error) throw contiRes.error
      if (fiscaliRes.error) throw fiscaliRes.error
      if (mustRes.error) throw mustRes.error

      const payRows = await fetchAllPaged<PayableViewRow>(
        (from, to) => supabase.from('v_payables_operative')
          .select('id, supplier_id, supplier_name, supplier_ragione_sociale, invoice_number, due_date, amount_remaining, macro_group, cost_category_name, payment_method, is_auto_debit, status')
          .eq('company_id', COMPANY_ID)
          .lte('due_date', orizzonte)
          .gt('amount_remaining', 0)
          .order('id', { ascending: true })
          .range(from, to),
        'v_payables_operative',
      )

      // Ricavi del mese in corso, quelli che i negozi scaricano ogni sera.
      const ricaviRows = await fetchAllPaged<{ id: string; date: string; gross_revenue: number | null }>(
        (from, to) => supabase.from('daily_revenue')
          .select('id, date, gross_revenue')
          .eq('company_id', COMPANY_ID)
          .gte('date', inizioMese).lte('date', oggi)
          .order('id', { ascending: true })
          .range(from, to),
        'daily_revenue',
      )

      const costiRows = await fetchAllPaged<{ id: string; year: number | null; month: number | null; netto: number | null }>(
        (from, to) => supabase.from('employee_costs')
          .select('id, year, month, netto')
          .eq('company_id', COMPANY_ID)
          .order('id', { ascending: true })
          .range(from, to),
        'employee_costs',
      )

      setConti((contiRes.data || []) as ContoRow[])
      setFiscali((fiscaliRes.data || []) as FiscalRow[])
      setPayables(payRows.filter(r => !STATI_ESCLUSI.has((r.status || '').trim())))
      setMustPay((mustRes.data || []) as MustPayRow[])

      const vat = Number((ivaRes.data as { budget_vat_rate?: number | string } | null)?.budget_vat_rate)
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

      let ultimo = { y: 0, m: 0 }
      for (const r of costiRows) {
        const y = Number(r.year || 0)
        const m = Number(r.month || 0)
        if (y > ultimo.y || (y === ultimo.y && m > ultimo.m)) ultimo = { y, m }
      }
      setNettoMensile(costiRows
        .filter(r => Number(r.year) === ultimo.y && Number(r.month) === ultimo.m)
        .reduce((s, r) => s + Number(r.netto || 0), 0))
      setMeseStipendi(ultimo.y ? `${String(ultimo.m).padStart(2, '0')}/${ultimo.y}` : '')
    } catch (err: unknown) {
      console.error('[SimulazioneFabbisogno] fetch error:', err)
      setErrore((err as Error).message || 'Errore nel caricamento dei dati')
    } finally {
      setLoading(false)
    }
  }, [COMPANY_ID, orizzonte, oggi])

  useEffect(() => { loadData() }, [loadData])

  /* ───── costruzione delle voci ───── */
  const liquiditaConti = useMemo(() => conti.reduce((s, c) => s + Number(c.current_balance || 0), 0), [conti])
  const fidoTotale = useMemo(() => conti.reduce((s, c) => s + Number(c.credit_line || 0), 0), [conti])
  const saldoAggiornatoAl = useMemo(() => {
    const date = conti.map(c => c.balance_updated_at).filter(Boolean) as string[]
    return date.length ? date.sort()[date.length - 1] : null
  }, [conti])

  const stipendiMensili = stipendiOverride.trim() ? parseNum(stipendiOverride) : nettoMensile

  const dateStipendi = useMemo(() => {
    if (!includiStipendi || stipendiMensili <= 0) return []
    const out: string[] = []
    const start = new Date(oggi + 'T00:00:00')
    for (let i = 0; i < 4; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, giornoStipendi)
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      if (ymd >= oggi && ymd <= orizzonte) out.push(ymd)
    }
    return out
  }, [includiStipendi, stipendiMensili, giornoStipendi, oggi, orizzonte])

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
        scadenza: p.due_date,
        importo: Number(p.amount_remaining || 0),
        automatico: isPagamentoAutomatico(p.payment_method, p.is_auto_debit),
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

    for (const d of dateStipendi) {
      out.push({
        id: `stip-${d}`,
        key: 'stipendi',
        descrizione: 'Netti in busta',
        fornitore: 'Stipendi dipendenti',
        documento: null,
        scadenza: d,
        importo: stipendiMensili,
        automatico: true,
        link: '/dipendenti',
      })
    }

    return out.sort((a, b) => (a.scadenza || '') < (b.scadenza || '') ? -1 : 1)
  }, [payables, fiscali, dateStipendi, stipendiMensili, includiArretrato, oggi])

  /* ───── selezione salvata ───── */
  const selezionati = useMemo(() => {
    const set = new Set<string>()
    for (const m of mustPay) {
      if (m.payable_id) set.add(`pay-${m.payable_id}`)
      else if (m.fiscal_deadline_id) set.add(`fisc-${m.fiscal_deadline_id}`)
      else if (m.item_ref) set.add(m.item_ref)
    }
    return set
  }, [mustPay])

  /** Scrive o cancella la spunta di una riga su cash_must_pay. */
  const toggleRiga = useCallback(async (riga: RigaUscita, attiva: boolean) => {
    if (!COMPANY_ID || !canEdit) return
    setSalvando(riga.id)
    try {
      if (!attiva) {
        const esistente = mustPay.find(m =>
          (m.payable_id && `pay-${m.payable_id}` === riga.id) ||
          (m.fiscal_deadline_id && `fisc-${m.fiscal_deadline_id}` === riga.id) ||
          m.item_ref === riga.id)
        if (esistente) {
          const { error } = await supabase.from('cash_must_pay').delete().eq('id', esistente.id)
          if (error) throw error
          setMustPay(prev => prev.filter(m => m.id !== esistente.id))
        }
        return
      }

      const base = { company_id: COMPANY_ID, horizon_date: orizzonte, created_by: profile?.id ?? null }
      const payload = riga.id.startsWith('pay-')
        ? { ...base, item_kind: 'payable', payable_id: riga.id.slice(4) }
        : riga.id.startsWith('fisc-')
          ? { ...base, item_kind: 'fiscal', fiscal_deadline_id: riga.id.slice(5) }
          : { ...base, item_kind: 'payroll', item_ref: riga.id, label: riga.fornitore, amount: riga.importo }

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
  }, [COMPANY_ID, canEdit, mustPay, orizzonte, profile?.id, toast])

  /** Spunta in blocco le righe attualmente visibili non ancora selezionate. */
  const spuntaVisibili = async (visibili: RigaUscita[], attiva: boolean) => {
    for (const r of visibili) {
      const gia = selezionati.has(r.id)
      if (attiva && !gia) await toggleRiga(r, true)
      if (!attiva && gia) await toggleRiga(r, false)
    }
  }

  /* ───── incassi e disponibilità ───── */
  const giorniResidui = Math.max(0, diffGiorni(oggi, orizzonte)) // da domani alla data
  const giorniMese = useMemo(() => Number(fineMeseCorrente.slice(8, 10)), [fineMeseCorrente])

  const incassi = useMemo(() => previsioneIncassiMese({
    realizzato: realizzatoMese,
    giorniRegistrati,
    giorniResidui,
    obiettivoMensile: obiettivoMeseLordo || null,
    giorniMese,
  }), [realizzatoMese, giorniRegistrati, giorniResidui, obiettivoMeseLordo, giorniMese])

  const ritmoUsato = ritmoOverride.trim() ? parseNum(ritmoOverride) : incassi.ritmoGiornaliero
  const incassiAttesi = ritmoUsato * giorniResidui
  const liquiditaIniziale = liquiditaOverride.trim() ? parseNum(liquiditaOverride) : liquiditaConti
  const disponibilita = liquiditaIniziale + incassiAttesi + (usaFido ? fidoTotale : 0)

  const piano = useMemo(
    () => calcolaPiano({ righe, selezionati, disponibilita }),
    [righe, selezionati, disponibilita],
  )

  /* ───── proiezione sulle sole voci obbligatorie ───── */
  const proiezione = useMemo(() => proiezioneGiornaliera({
    dataInizio: oggi,
    dataFine: orizzonte,
    saldoIniziale: liquiditaIniziale + (usaFido ? fidoTotale : 0),
    incassoGiornaliero: ritmoUsato,
    uscite: righe.filter(r => selezionati.has(r.id)).map(r => ({ data: r.scadenza || oggi, importo: r.importo, key: r.key })),
  }), [oggi, orizzonte, liquiditaIniziale, usaFido, fidoTotale, ritmoUsato, righe, selezionati])

  const giornoRottura = primoGiornoNegativo(proiezione)
  const graficoData = useMemo(() => proiezione.map(g => ({ ...g, label: fmtDataBreve(g.data) })), [proiezione])

  /* ───── lista filtrata ───── */
  const righeVisibili = useMemo(() => {
    const q = ricerca.trim().toLowerCase()
    return righe.filter(r => {
      if (filtro === 'scadute' && !(r.scadenza && r.scadenza < oggi)) return false
      if (filtro === 'automatiche' && !r.automatico) return false
      if (filtro !== 'tutte' && filtro !== 'scadute' && filtro !== 'automatiche' && r.key !== filtro) return false
      if (!q) return true
      return `${r.fornitore} ${r.documento || ''} ${r.descrizione}`.toLowerCase().includes(q)
    })
  }, [righe, filtro, ricerca, oggi])

  const totalePerFascia = useMemo(() => {
    const m = new Map<FasciaKey, { tot: number; sel: number }>()
    for (const k of FASCE_ORDINE_DEFAULT) m.set(k, { tot: 0, sel: 0 })
    for (const r of righe) {
      const acc = m.get(r.key)!
      acc.tot += r.importo
      if (selezionati.has(r.id)) acc.sel += r.importo
    }
    return m
  }, [righe, selezionati])

  const esportaCsv = () => {
    const rows = [
      ['Obbligatoria', 'Categoria', 'Fornitore', 'Documento', 'Scadenza', 'Importo', 'Addebito automatico'],
      ...righe.map(r => [
        selezionati.has(r.id) ? 'si' : 'no', FASCIA_LABEL[r.key], r.fornitore, r.documento || '',
        r.scadenza || '', r.importo.toFixed(2), r.automatico ? 'si' : 'no',
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

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Simulazione fabbisogno" subtitle="Caricamento dei dati vivi…" />
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={18} /> Un attimo…</div>
      </div>
    )
  }

  const FILTRI: { key: FiltroFascia; label: string }[] = [
    { key: 'tutte', label: 'Tutte' },
    ...FASCE_ORDINE_DEFAULT.map(k => ({ key: k as FiltroFascia, label: FASCIA_LABEL[k] })),
    { key: 'scadute', label: 'Già scadute' },
    { key: 'automatiche', label: 'Addebiti automatici' },
  ]

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Simulazione fabbisogno"
        subtitle="Spunta quello che non puoi non pagare, il gestionale ti dice quanto manca"
        actions={
          <>
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

      {/* ─── LA RISPOSTA, IN UNA RIGA ─── */}
      <div className={`rounded-2xl p-5 mb-6 border ${piano.fabbisogno > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="text-sm text-slate-600">
              {piano.nSelezionate === 0
                ? 'Nessuna voce ancora spuntata: comincia dal passo 1.'
                : <>Per pagare le <strong>{piano.nSelezionate} voci</strong> che hai segnato come obbligatorie entro il {fmtData(orizzonte)}</>}
            </div>
            <div className={`text-3xl sm:text-4xl font-bold mt-1 ${piano.fabbisogno > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {piano.nSelezionate === 0 ? '—'
                : piano.fabbisogno > 0 ? `ti mancano ${fmtEur(piano.fabbisogno)}` : `ce la fai, avanzano ${fmtEur(piano.avanzo)}`}
            </div>
            {piano.nSelezionate > 0 && (
              <div className="text-sm text-slate-600 mt-1">
                obbligatorio {fmtEur(piano.obbligatorio)} · disponibilità {fmtEur(disponibilita)} · copri il {piano.coperturaObbligatorioPct.toFixed(0)}%
              </div>
            )}
          </div>
          <label className="shrink-0">
            <span className="block text-xs text-slate-500 mb-1">Data obiettivo</span>
            <input type="date" value={orizzonte} min={oggi} onChange={e => setOrizzonte(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white" />
          </label>
        </div>
      </div>

      {!canEdit && (
        <div className="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600 flex items-center gap-2">
          <Lock size={15} className="text-slate-400" />
          Puoi vedere la selezione e il risultato, ma non modificarla: le spunte le mettono amministrazione, CFO e super advisor.
        </div>
      )}

      {/* ═══ PASSO 1 — COSA DEVI PAGARE PER FORZA ═══ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">1</span>
            <span className="text-sm font-semibold text-slate-900">Cosa non possiamo non pagare</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 ml-8">
            Tutte le uscite in scadenza entro il {fmtData(orizzonte)}: fatture, tasse e stipendi insieme.
            Spunta quelle a cui non vuoi dire di no. Ogni spunta si salva subito e la vedono tutti.
          </div>
        </div>

        {/* filtri */}
        <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-2">
          {FILTRI.map(f => (
            <button key={f.key} onClick={() => setFiltro(f.key)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${filtro === f.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              {f.label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={ricerca} onChange={e => setRicerca(e.target.value)} placeholder="Cerca fornitore o fattura"
              className="pl-8 pr-7 py-1.5 border border-slate-200 rounded-lg text-sm w-56" />
            {ricerca && (
              <button onClick={() => setRicerca('')} aria-label="Pulisci la ricerca"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13} /></button>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2 bg-slate-50">
            <span className="text-xs text-slate-500">Su queste {righeVisibili.length} voci:</span>
            <button onClick={() => spuntaVisibili(righeVisibili, true)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100">
              spunta tutte
            </button>
            <button onClick={() => spuntaVisibili(righeVisibili, false)}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 hover:bg-slate-100">
              togli le spunte
            </button>
          </div>
        )}

        <div className="overflow-x-auto max-h-[34rem]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="text-left px-3 py-2 font-medium">Chi</th>
                <th className="text-left px-3 py-2 font-medium">Documento</th>
                <th className="text-left px-3 py-2 font-medium">Scadenza</th>
                <th className="text-left px-3 py-2 font-medium">Tipo</th>
                <th className="text-right px-3 py-2 font-medium">Importo</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {righeVisibili.map(r => {
                const sel = selezionati.has(r.id)
                return (
                  <tr key={r.id} className={`border-t border-slate-100 ${sel ? 'bg-indigo-50/40' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={sel} disabled={!canEdit || salvando === r.id}
                        onChange={e => toggleRiga(r, e.target.checked)}
                        aria-label={`Segna come obbligatoria: ${r.fornitore} ${r.documento || ''}`}
                        className="w-4 h-4 accent-indigo-600" />
                    </td>
                    <td className="px-3 py-2 text-slate-900">
                      {r.fornitore}
                      {r.automatico && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">esce comunque</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.documento || r.descrizione}</td>
                    <td className={`px-3 py-2 ${r.scadenza && r.scadenza < oggi ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                      {fmtData(r.scadenza)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${FASCIA_COLOR[r.key]}`}>{FASCIA_LABEL[r.key]}</span>
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
              })}
              {righeVisibili.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">Nessuna voce con questi filtri.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="font-semibold text-slate-900">
            Spuntate {piano.nSelezionate} voci su {piano.nTotali}: {fmtEur(piano.obbligatorio)}
          </span>
          <span className="text-slate-500">non spuntate: {fmtEur(piano.rinviabile)}</span>
          {FASCE_ORDINE_DEFAULT.map(k => {
            const v = totalePerFascia.get(k)!
            if (v.tot === 0) return null
            return (
              <span key={k} className="text-xs text-slate-500">
                {FASCIA_LABEL[k]}: <strong className="text-slate-700">{fmtEur(v.sel)}</strong> su {fmtEur(v.tot)}
              </span>
            )
          })}
        </div>

        {piano.rinviabileAutomatico > 0 && (
          <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              {fmtEur(piano.rinviabileAutomatico)} che non hai spuntato sono RiBa, SDD o addebiti su carta:
              partono dal conto da soli, che tu li consideri obbligatori o no. Conviene spuntarli.
            </span>
          </div>
        )}
      </section>

      {/* ═══ PASSO 2 — QUANTO AVRAI ═══ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-sm font-semibold text-slate-900">Quanto avrai entro il {fmtData(orizzonte)}</span>
          </div>
          <div className="text-xs text-slate-500 mt-1 ml-8">
            Quello che c'è in banca oggi, più gli incassi dei negozi da qui alla data. Il ritmo si aggiorna da solo
            ogni sera con i ricavi caricati dai punti vendita.
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-slate-100">
          {/* cassa */}
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
              Aggiungi il fido ({fmtEur(fidoTotale)})
            </label>
          </div>

          {/* incassi attesi */}
          <div className="bg-white p-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Incassi attesi ({giorniResidui} giorni)</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{fmtEur(incassiAttesi)}</div>
            <div className="text-xs text-slate-500 mt-1">
              {fmtEur(ritmoUsato)} al giorno{ritmoOverride.trim() ? ' (impostato da te)' : ` (ritmo di questo mese su ${giorniRegistrati} giorni)`}
            </div>
            <input type="text" inputMode="decimal" value={ritmoOverride} placeholder="correggi l'incasso giornaliero"
              onChange={e => setRitmoOverride(e.target.value)}
              className="mt-3 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <div className="text-[11px] text-slate-400 mt-2">
              Il ricavo di oggi si considera già arrivato in banca, quindi si contano i giorni da domani.
            </div>
          </div>

          {/* obiettivo del mese */}
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
                  <div className="flex justify-between"><dt>dove chiudi con questo ritmo</dt><dd className="font-medium">{fmtEur(incassi.proiezioneMese)}</dd></div>
                  {incassi.passoRichiesto != null && (
                    <div className="flex justify-between"><dt>servirebbero al giorno</dt><dd className="font-medium">{fmtEur(incassi.passoRichiesto)}</dd></div>
                  )}
                </dl>
                <div className="text-[11px] text-slate-400 mt-2">
                  Obiettivo da Budget → Inserimento rapido, portato a lordo IVA perché in cassa entra l'incasso pieno.
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-2">
                Nessun obiettivo inserito per questo mese. Impostalo in Budget → Inserimento rapido e comparirà qui il confronto.
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-sm font-semibold text-slate-900">Disponibilità totale: {fmtEur(disponibilita)}</span>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={includiArretrato} onChange={e => setIncludiArretrato(e.target.checked)} className="accent-indigo-600" />
            Mostra anche lo scaduto arretrato
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={includiStipendi} onChange={e => setIncludiStipendi(e.target.checked)} className="accent-indigo-600" />
            Stipendi il giorno
            <input type="number" min={1} max={28} value={giornoStipendi}
              onChange={e => setGiornoStipendi(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
              className="w-14 px-2 py-1 border border-slate-200 rounded text-sm" />
            da {fmtEur(stipendiMensili)}
          </label>
          <input type="text" inputMode="decimal" value={stipendiOverride} placeholder={`stipendi (${meseStipendi || 'nessun cedolino'})`}
            onChange={e => setStipendiOverride(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm w-52" />
        </div>
      </section>

      {/* ═══ PASSO 3 — IL CONTO ═══ */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">3</span>
            <span className="text-sm font-semibold text-slate-900">Il conto</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-slate-100">
          <div className="bg-white p-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Obbligatorio spuntato</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{fmtEur(piano.obbligatorio)}</div>
            <div className="text-xs text-slate-500 mt-1">{piano.nSelezionate} voci</div>
          </div>
          <div className="bg-white p-4">
            <div className="text-xs uppercase text-slate-500 font-medium">Disponibilità</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{fmtEur(disponibilita)}</div>
            <div className="text-xs text-slate-500 mt-1">cassa {fmtEur(liquiditaIniziale)} + incassi {fmtEur(incassiAttesi)}</div>
          </div>
          <div className={`p-4 ${piano.fabbisogno > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
            <div className="text-xs uppercase text-slate-500 font-medium">{piano.fabbisogno > 0 ? 'Fabbisogno' : 'Avanzo'}</div>
            <div className={`text-xl font-bold mt-1 ${piano.fabbisogno > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
              {fmtEur(piano.fabbisogno > 0 ? piano.fabbisogno : piano.avanzo)}
            </div>
            <div className="text-xs text-slate-600 mt-1">
              {piano.fabbisogno > 0
                ? giornoRottura ? `cassa sotto zero il ${fmtData(giornoRottura)}` : 'da coprire entro la data'
                : `copre anche ${fmtEur(piano.rinviabileCoperto)} del resto`}
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 mb-2">
            Saldo giorno per giorno con i soli pagamenti obbligatori, incassi al ritmo attuale e arretrato tutto sul primo giorno.
          </div>
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
            La cassa copre tutto l'obbligatorio. Restano {fmtEur(piano.avanzo)} per il resto, che vale {fmtEur(piano.rinviabile)}.
          </div>
        )}
      </section>

      {/* nota */}
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
        <Info size={16} className="shrink-0 mt-0.5 text-slate-400" />
        <div className="space-y-1">
          <div><strong>La selezione è condivisa e resta.</strong> Le spunte si salvano sul gestionale legate alla data obiettivo: chi apre la pagina dopo di te vede le stesse. Cambiando data si riparte da una selezione nuova.</div>
          <div><strong>Gli importi restano agganciati alla fonte.</strong> Se una fattura viene pagata o cambia importo nello Scadenzario, qui il numero si aggiorna da solo: la spunta dice «questa è obbligatoria», non congela la cifra.</div>
          <div><strong>Cosa non entra.</strong> Costi ricorrenti non ancora fatturati, RiBa presentate ma non ancora a scadenzario e insoluti in corso di rientro.</div>
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
    </div>
  )
}
