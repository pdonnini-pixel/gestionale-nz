// ─────────────────────────────────────────────────────────────────────────────
// SIMULAZIONE FABBISOGNO — «entro il 30 devo pagare X, ho Y: cosa resta fuori?»
//
// La pagina è un guscio sottile sopra `src/lib/fabbisogno.ts`: qui si leggono i
// dati vivi (conti, scadenzario, scadenze fiscali, costo del personale,
// incassi bancari) e si passano al motore, che applica la cascata a priorità.
// Nessun calcolo di business vive in questo file.
//
// Fonti dei dati, tutte filtrate sul tenant attivo:
//  - liquidità        → bank_accounts (conti attivi) + fido opzionale
//  - uscite fornitori → v_payables_operative (residuo > 0, scadenza <= data)
//  - uscite fiscali   → fiscal_deadlines (pending, scadenza <= data)
//  - stipendi         → employee_costs (ultimo netto mensile noto), pagati il
//                       giorno configurato del mese successivo
//  - incassi          → bank_transactions (incassi POS + versamenti), media
//                       giornaliera degli ultimi 30 giorni
//
// Ogni riga scoperta porta alla pagina dove si gestisce: le fatture allo
// Scadenzario filtrato per fornitore e documento (`?supplier=&search=`, lo
// stesso ingresso della Scheda contabile fornitore), le imposte a Scadenze
// fiscali, gli stipendi a Dipendenti.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Wallet, TrendingDown, AlertTriangle, CalendarClock, Download, Loader2,
  ArrowUp, ArrowDown, Info, RefreshCw, CheckCircle2, Building2, ExternalLink,
} from 'lucide-react'
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import PageHeader from '../components/PageHeader'
import StatKpi from '../components/ui/StatKpi'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { todayYMD, lastDayOfMonthYMD } from '../lib/dateLocal'
import {
  simulaFabbisogno, proiezioneGiornaliera, primoGiornoNegativo, saldoMinimo,
  ripartisciSuRighe, fasciaDaMacroGroup, isPagamentoAutomatico,
  addDaysYMD, diffGiorni, FASCE_ORDINE_DEFAULT, FASCIA_LABEL,
  type FasciaKey, type RigaUscita, type RigaRipartita,
} from '../lib/fabbisogno'

/* ───── helpers di formato ───── */
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

/**
 * Deep link allo Scadenzario, che accetta già `?supplier=<uuid|slug>` e
 * `?search=<testo>` (stesso ingresso usato dalla Scheda contabile fornitore).
 * Il numero fattura come ricerca isola la singola riga; senza numero si
 * ripiega sul nome del fornitore, che almeno restringe alla sua posizione.
 */
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

/** Dove porta il collegamento di una riga scoperta, per fascia. */
const DESTINAZIONE_LABEL: Record<FasciaKey, string> = {
  stipendi: 'Apri i Dipendenti',
  merci: 'Apri nello Scadenzario',
  affitti: 'Apri nello Scadenzario',
  fiscali: 'Apri le Scadenze fiscali',
  altro: 'Apri nello Scadenzario',
}

/** Stati dello scadenzario che NON sono un debito da pagare. */
const STATI_ESCLUSI = new Set(['annullato', 'pagato', 'nota_credito'])

/** Giorni di storico banca usati per la media incassi. */
const GIORNI_STORICO_INCASSI = 30

interface ContoRow {
  id: string
  bank_name: string | null
  account_name: string | null
  current_balance: number | null
  credit_line: number | null
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
  company_id: string | null
}

interface FiscalRow {
  id: string
  title: string | null
  deadline_type: string | null
  amount: number | null
  amount_paid: number | null
  due_date: string
}

export default function SimulazioneFabbisogno() {
  const { profile } = useAuth()
  const COMPANY_ID = profile?.company_id
  const [searchParams, setSearchParams] = useSearchParams()

  const oggi = useMemo(() => todayYMD(), [])
  const fineMeseCorrente = useMemo(() => {
    const d = new Date(oggi + 'T00:00:00')
    return lastDayOfMonthYMD(d.getFullYear(), d.getMonth() + 1)
  }, [oggi])

  // Data orizzonte persistita in URL (?al=YYYY-MM-DD) per condividere lo scenario.
  const alParam = searchParams.get('al')
  const orizzonte = alParam && /^\d{4}-\d{2}-\d{2}$/.test(alParam) ? alParam : fineMeseCorrente
  const setOrizzonte = (next: string) => {
    const params = new URLSearchParams(searchParams)
    params.set('al', next)
    setSearchParams(params, { replace: true })
  }

  /* ───── stato dati ───── */
  const [loading, setLoading] = useState(true)
  const [errore, setErrore] = useState<string | null>(null)
  const [conti, setConti] = useState<ContoRow[]>([])
  const [payables, setPayables] = useState<PayableViewRow[]>([])
  const [fiscali, setFiscali] = useState<FiscalRow[]>([])
  const [incassoMedioGg, setIncassoMedioGg] = useState(0)
  const [nettoMensile, setNettoMensile] = useState(0)
  const [meseStipendi, setMeseStipendi] = useState<string>('')

  /* ───── parametri della simulazione ───── */
  const [scenarioPct, setScenarioPct] = useState(0)          // scostamento % sugli incassi attesi
  const [usaFido, setUsaFido] = useState(false)
  const [includiArretrato, setIncludiArretrato] = useState(true)
  const [includiStipendi, setIncludiStipendi] = useState(true)
  const [giornoStipendi, setGiornoStipendi] = useState(10)
  const [stipendiOverride, setStipendiOverride] = useState('')  // vuoto = usa la stima
  const [incassoOverride, setIncassoOverride] = useState('')    // vuoto = usa la media
  const [liquiditaOverride, setLiquiditaOverride] = useState('')
  const [ordine, setOrdine] = useState<FasciaKey[]>(FASCE_ORDINE_DEFAULT)

  /* ───── caricamento ───── */
  const loadData = useCallback(async () => {
    if (!COMPANY_ID) return
    setLoading(true)
    setErrore(null)
    try {
      const daData = addDaysYMD(oggi, -GIORNI_STORICO_INCASSI)

      const [contiRes, fiscaliRes] = await Promise.all([
        supabase.from('bank_accounts')
          .select('id, bank_name, account_name, current_balance, credit_line')
          .eq('company_id', COMPANY_ID).eq('is_active', true),
        supabase.from('fiscal_deadlines')
          .select('id, title, deadline_type, amount, amount_paid, due_date')
          .eq('company_id', COMPANY_ID).eq('status', 'pending').lte('due_date', orizzonte),
      ])
      if (contiRes.error) throw contiRes.error
      if (fiscaliRes.error) throw fiscaliRes.error

      // Scadenzario: ordine per id (chiave univoca) perché la vista ha un
      // ORDER BY interno non univoco e la paginazione perderebbe righe.
      const payRows = await fetchAllPaged<PayableViewRow>(
        (from, to) => supabase.from('v_payables_operative')
          .select('id, supplier_id, supplier_name, supplier_ragione_sociale, invoice_number, due_date, amount_remaining, macro_group, cost_category_name, payment_method, is_auto_debit, status, company_id')
          .eq('company_id', COMPANY_ID)
          .lte('due_date', orizzonte)
          .gt('amount_remaining', 0)
          .order('id', { ascending: true })
          .range(from, to),
        'v_payables_operative',
      )

      // Incassi realmente entrati in banca negli ultimi 30 giorni: POS + versamenti
      // di contante. Non si usano i corrispettivi, che non coincidono con la data
      // di accredito.
      const incassiRows = await fetchAllPaged<{ id: string; amount: number | null; transaction_date: string }>(
        (from, to) => supabase.from('bank_transactions')
          .select('id, amount, transaction_date')
          .eq('company_id', COMPANY_ID)
          .in('category', ['incassi_pos', 'versamenti'])
          .gt('amount', 0)
          .gte('transaction_date', daData)
          .lt('transaction_date', oggi)
          .order('id', { ascending: true })
          .range(from, to),
        'bank_transactions incassi',
      )

      // Costo del personale: si prende l'ultimo mese caricato (il netto del mese
      // M viene pagato il 10 di M+1, quindi è la miglior stima della prossima
      // mensilità finché il cedolino nuovo non è importato).
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

      const giorniStorico = Math.max(1, GIORNI_STORICO_INCASSI)
      const totIncassi = incassiRows.reduce((s, r) => s + Number(r.amount || 0), 0)
      setIncassoMedioGg(totIncassi / giorniStorico)

      let ultimo = { y: 0, m: 0 }
      for (const r of costiRows) {
        const y = Number(r.year || 0)
        const m = Number(r.month || 0)
        if (y > ultimo.y || (y === ultimo.y && m > ultimo.m)) ultimo = { y, m }
      }
      const netto = costiRows
        .filter(r => Number(r.year) === ultimo.y && Number(r.month) === ultimo.m)
        .reduce((s, r) => s + Number(r.netto || 0), 0)
      setNettoMensile(netto)
      setMeseStipendi(ultimo.y ? `${String(ultimo.m).padStart(2, '0')}/${ultimo.y}` : '')
    } catch (err: unknown) {
      console.error('[SimulazioneFabbisogno] fetch error:', err)
      setErrore((err as Error).message || 'Errore nel caricamento dei dati')
    } finally {
      setLoading(false)
    }
  }, [COMPANY_ID, orizzonte, oggi])

  useEffect(() => { loadData() }, [loadData])

  /* ───── costruzione delle uscite ───── */
  const liquiditaConti = useMemo(
    () => conti.reduce((s, c) => s + Number(c.current_balance || 0), 0),
    [conti],
  )
  const fidoTotale = useMemo(
    () => conti.reduce((s, c) => s + Number(c.credit_line || 0), 0),
    [conti],
  )

  const stipendiMensili = stipendiOverride.trim() ? parseNum(stipendiOverride) : nettoMensile

  /** Date di pagamento stipendi che cadono nel periodo simulato. */
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
      const scaduta = f.due_date < oggi
      if (scaduta && !includiArretrato) continue
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
        fornitore: 'Dipendenti',
        documento: null,
        scadenza: d,
        importo: stipendiMensili,
        automatico: true, // il bonifico stipendi non è rinviabile
        link: '/dipendenti',
      })
    }

    return out
  }, [payables, fiscali, dateStipendi, stipendiMensili, includiArretrato, oggi])

  /* ───── simulazione ───── */
  const giorniResidui = Math.max(0, diffGiorni(oggi, orizzonte)) + 1
  const incassoGiornaliero = (incassoOverride.trim() ? parseNum(incassoOverride) : incassoMedioGg) * (1 + scenarioPct / 100)
  const incassiAttesi = incassoGiornaliero * giorniResidui
  const liquiditaIniziale = liquiditaOverride.trim() ? parseNum(liquiditaOverride) : liquiditaConti

  const esito = useMemo(() => {
    const perFascia = new Map<FasciaKey, { importo: number; automatico: number }>()
    for (const r of righe) {
      const acc = perFascia.get(r.key) || { importo: 0, automatico: 0 }
      acc.importo += r.importo
      if (r.automatico) acc.automatico += r.importo
      perFascia.set(r.key, acc)
    }
    return simulaFabbisogno({
      liquiditaIniziale,
      incassiAttesi,
      fidoDisponibile: usaFido ? fidoTotale : 0,
      ordine,
      fasce: FASCE_ORDINE_DEFAULT.map(key => ({
        key,
        importo: perFascia.get(key)?.importo || 0,
        automatico: perFascia.get(key)?.automatico || 0,
      })),
    })
  }, [righe, liquiditaIniziale, incassiAttesi, usaFido, fidoTotale, ordine])

  /** Righe che restano scoperte, fascia per fascia. */
  const scoperte: RigaRipartita[] = useMemo(() => {
    const out: RigaRipartita[] = []
    for (const f of esito.fasce) {
      const dellaFascia = righe.filter(r => r.key === f.key)
      out.push(...ripartisciSuRighe(dellaFascia, f.pagato).filter(r => r.scoperto > 0))
    }
    return out
  }, [esito, righe])

  const proiezione = useMemo(() => proiezioneGiornaliera({
    dataInizio: oggi,
    dataFine: orizzonte,
    saldoIniziale: liquiditaIniziale + (usaFido ? fidoTotale : 0),
    incassoGiornaliero,
    uscite: righe.map(r => ({ data: r.scadenza || oggi, importo: r.importo, key: r.key })),
  }), [oggi, orizzonte, liquiditaIniziale, usaFido, fidoTotale, incassoGiornaliero, righe])

  const giornoRottura = primoGiornoNegativo(proiezione)
  const minimo = saldoMinimo(proiezione)

  const graficoData = useMemo(
    () => proiezione.map(g => ({ ...g, label: fmtDataBreve(g.data) })),
    [proiezione],
  )

  /* ───── azioni ───── */
  const spostaFascia = (key: FasciaKey, delta: number) => {
    setOrdine(prev => {
      const idx = prev.indexOf(key)
      const next = idx + delta
      if (idx < 0 || next < 0 || next >= prev.length) return prev
      const copia = [...prev]
      copia.splice(idx, 1)
      copia.splice(next, 0, key)
      return copia
    })
  }

  const esportaCsv = () => {
    const righeCsv = [
      ['Priorita', 'Fornitore', 'Documento', 'Categoria', 'Scadenza', 'Importo', 'Coperto', 'Scoperto', 'Addebito automatico'],
      ...scoperte.map(r => [
        FASCIA_LABEL[r.key], r.fornitore, r.documento || '', r.descrizione,
        r.scadenza || '', r.importo.toFixed(2), r.pagato.toFixed(2), r.scoperto.toFixed(2),
        r.automatico ? 'si' : 'no',
      ]),
    ]
    const csv = righeCsv.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `fabbisogno_${orizzonte}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ───── render ───── */
  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Simulazione fabbisogno" subtitle="Caricamento dei dati vivi…" />
        <div className="flex items-center gap-2 text-slate-500"><Loader2 className="animate-spin" size={18} /> Un attimo…</div>
      </div>
    )
  }

  const coperturaTotale = esito.totaleUscite > 0 ? (esito.totalePagato / esito.totaleUscite) * 100 : 100

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Simulazione fabbisogno"
        subtitle={`Cosa riesci a pagare entro il ${fmtData(orizzonte)} e quanto manca`}
        actions={
          <>
            <button
              onClick={loadData}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50"
            >
              <RefreshCw size={16} /> Ricarica
            </button>
            <button
              onClick={esportaCsv}
              disabled={!scoperte.length}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <Download size={16} /> Esporta scoperti
            </button>
          </>
        }
      />

      {errore && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{errore}</div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatKpi icon={Wallet} color="emerald" size="lg" label="Disponibilità stimata"
          value={fmtEur(esito.disponibilita)}
          sub={`${fmtEur(liquiditaIniziale)} in cassa + ${fmtEur(incassiAttesi)} di incassi${usaFido ? ' + fido' : ''}`} />
        <StatKpi icon={TrendingDown} color="amber" size="lg" label="Uscite obbligate"
          value={fmtEur(esito.totaleUscite)}
          sub={`${righe.length} voci entro il ${fmtData(orizzonte)}`} />
        <StatKpi icon={AlertTriangle} color={esito.fabbisogno > 0 ? 'red' : 'emerald'} size="lg"
          label={esito.fabbisogno > 0 ? 'Fabbisogno da coprire' : 'Cassa residua'}
          value={fmtEur(esito.fabbisogno > 0 ? esito.fabbisogno : esito.cassaResidua)}
          sub={esito.fabbisogno > 0 ? `copri il ${coperturaTotale.toFixed(0)}% delle uscite` : 'copri tutte le uscite'} />
        <StatKpi icon={CalendarClock} color={giornoRottura ? 'red' : 'emerald'} size="lg" label="Cassa sotto zero"
          value={giornoRottura ? fmtData(giornoRottura) : 'mai'}
          sub={minimo ? `punto minimo ${fmtEur(minimo.saldo)} il ${fmtData(minimo.data)}` : ''} />
      </div>

      {/* Parametri */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6">
        <div className="text-sm font-semibold text-slate-900 mb-3">Parametri dello scenario</div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <label className="block">
            <span className="text-xs text-slate-500">Simula fino al</span>
            <input type="date" value={orizzonte} min={oggi} onChange={e => setOrizzonte(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <span className="text-xs text-slate-400">{giorniResidui} giorni da oggi</span>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">Liquidità di partenza</span>
            <input type="text" inputMode="decimal" value={liquiditaOverride}
              placeholder={fmtEur(liquiditaConti)}
              onChange={e => setLiquiditaOverride(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <span className="text-xs text-slate-400">{conti.length} conti attivi, saldo di oggi</span>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">Incasso medio giornaliero</span>
            <input type="text" inputMode="decimal" value={incassoOverride}
              placeholder={fmtEur(incassoMedioGg)}
              onChange={e => setIncassoOverride(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <span className="text-xs text-slate-400">media POS + versamenti, ultimi {GIORNI_STORICO_INCASSI} giorni</span>
          </label>

          <label className="block">
            <span className="text-xs text-slate-500">Stipendi netti mensili</span>
            <input type="text" inputMode="decimal" value={stipendiOverride}
              placeholder={fmtEur(nettoMensile)}
              onChange={e => setStipendiOverride(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            <span className="text-xs text-slate-400">
              {meseStipendi ? `ultimo cedolino ${meseStipendi}` : 'nessun cedolino caricato'}
              {dateStipendi.length ? ` · ${dateStipendi.length} mensilità nel periodo` : ' · nessuna mensilità nel periodo'}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-100">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Scenario incassi</span>
              <span className={`font-semibold ${scenarioPct < 0 ? 'text-red-600' : scenarioPct > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                {scenarioPct > 0 ? '+' : ''}{scenarioPct}% · {fmtEur(incassiAttesi)}
              </span>
            </div>
            <input type="range" min={-50} max={50} step={5} value={scenarioPct}
              onChange={e => setScenarioPct(Number(e.target.value))}
              className="w-full mt-2 accent-indigo-600" />
            <div className="flex justify-between text-[11px] text-slate-400"><span>−50% pessimistico</span><span>base</span><span>+50% ottimistico</span></div>
          </div>

          <div className="flex flex-col gap-2 justify-center">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={includiArretrato} onChange={e => setIncludiArretrato(e.target.checked)} className="accent-indigo-600" />
              Includi lo scaduto arretrato (da pagare subito)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={includiStipendi} onChange={e => setIncludiStipendi(e.target.checked)} className="accent-indigo-600" />
              Includi gli stipendi, pagati il giorno
              <input type="number" min={1} max={28} value={giornoStipendi}
                onChange={e => setGiornoStipendi(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
                className="w-14 px-2 py-1 border border-slate-200 rounded text-sm" />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={usaFido} onChange={e => setUsaFido(e.target.checked)} className="accent-indigo-600" />
              Considera il fido disponibile ({fmtEur(fidoTotale)})
            </label>
          </div>
        </div>
      </div>

      {/* Cascata a priorità */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="text-sm font-semibold text-slate-900">Cascata di pagamento</div>
          <div className="text-xs text-slate-500 mt-1">
            La disponibilità viene assorbita dall'alto verso il basso. Usa le frecce per cambiare l'ordine di priorità.
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Priorità</th>
                <th className="text-right px-4 py-2 font-medium">Dovuto</th>
                <th className="text-right px-4 py-2 font-medium">di cui automatico</th>
                <th className="text-right px-4 py-2 font-medium">Riesci a pagare</th>
                <th className="text-right px-4 py-2 font-medium">Resta scoperto</th>
                <th className="text-left px-4 py-2 font-medium w-40">Copertura</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {esito.fasce.map((f, i) => (
                <tr key={f.key} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <span className="text-xs text-slate-400 mr-2">{i + 1}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${FASCIA_COLOR[f.key]}`}>{FASCIA_LABEL[f.key]}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{fmtEur(f.importo)}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{f.automatico > 0 ? fmtEur(f.automatico) : '—'}</td>
                  <td className="px-4 py-3 text-right text-emerald-700 font-medium">{fmtEur(f.pagato)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${f.scoperto > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {f.scoperto > 0 ? fmtEur(f.scoperto) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full ${f.coperturaPct >= 100 ? 'bg-emerald-500' : f.coperturaPct > 0 ? 'bg-amber-500' : 'bg-red-400'}`}
                        style={{ width: `${Math.min(100, f.coperturaPct)}%` }} />
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1">{f.coperturaPct.toFixed(0)}%</div>
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => spostaFascia(f.key, -1)} disabled={i === 0}
                        aria-label={`Alza la priorità di ${FASCIA_LABEL[f.key]}`}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-20"><ArrowUp size={14} /></button>
                      <button onClick={() => spostaFascia(f.key, 1)} disabled={i === esito.fasce.length - 1}
                        aria-label={`Abbassa la priorità di ${FASCIA_LABEL[f.key]}`}
                        className="p-1 rounded hover:bg-slate-100 disabled:opacity-20"><ArrowDown size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold text-slate-900">
              <tr>
                <td className="px-4 py-3">Totale</td>
                <td className="px-4 py-3 text-right">{fmtEur(esito.totaleUscite)}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right text-emerald-700">{fmtEur(esito.totalePagato)}</td>
                <td className="px-4 py-3 text-right text-red-600">{fmtEur(esito.fabbisogno)}</td>
                <td className="px-4 py-3" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
        {esito.scopertoNonRinviabile > 0 && (
          <div className="px-4 py-3 bg-red-50 border-t border-red-100 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>
              {fmtEur(esito.scopertoNonRinviabile)} di scoperto sono addebiti automatici (RiBa, SDD, carte, bonifico stipendi):
              escono dal conto comunque, quindi non basta trattare col fornitore. O si copre, o vanno insoluti.
            </span>
          </div>
        )}
      </div>

      {/* Proiezione */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6">
        <div className="text-sm font-semibold text-slate-900">Saldo giorno per giorno</div>
        <div className="text-xs text-slate-500 mt-1 mb-3">
          Ipotesi: incassi distribuiti in modo uniforme, uscite alla data di scadenza, arretrato tutto sul primo giorno.
        </div>
        <div className="h-72">
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

      {/* Cosa resta fuori */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Cosa resta fuori</div>
            <div className="text-xs text-slate-500 mt-1">
              Dentro ogni priorità si pagano prima gli addebiti automatici, poi le scadenze più vecchie.
              Clicca il fornitore o la freccia per aprire la riga dove si gestisce.
            </div>
          </div>
          <span className="text-xs text-slate-500 shrink-0">{scoperte.length} voci</span>
        </div>
        {scoperte.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
            <CheckCircle2 className="text-emerald-500" size={28} />
            Con questi parametri copri tutte le uscite entro il {fmtData(orizzonte)}.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[32rem]">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Priorità</th>
                  <th className="text-left px-4 py-2 font-medium">Fornitore</th>
                  <th className="text-left px-4 py-2 font-medium">Documento</th>
                  <th className="text-left px-4 py-2 font-medium">Scadenza</th>
                  <th className="text-right px-4 py-2 font-medium">Importo</th>
                  <th className="text-right px-4 py-2 font-medium">Scoperto</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {scoperte.map(r => (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${FASCIA_COLOR[r.key]}`}>{FASCIA_LABEL[r.key]}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-900">
                      {r.link ? (
                        <Link to={r.link} className="text-indigo-700 hover:underline">{r.fornitore}</Link>
                      ) : r.fornitore}
                      {r.automatico && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">automatico</span>}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{r.documento || r.descrizione}</td>
                    <td className={`px-4 py-2 ${r.scadenza && r.scadenza < oggi ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                      {fmtData(r.scadenza)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">{fmtEur(r.importo, 2)}</td>
                    <td className="px-4 py-2 text-right font-semibold text-red-600">{fmtEur(r.scoperto, 2)}</td>
                    <td className="px-2 py-2">
                      {r.link && (
                        <Link
                          to={r.link}
                          title={DESTINAZIONE_LABEL[r.key]}
                          aria-label={`${DESTINAZIONE_LABEL[r.key]}: ${r.fornitore}`}
                          className="inline-flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                        >
                          <ExternalLink size={15} />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Nota metodologica */}
      <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
        <Info size={16} className="shrink-0 mt-0.5 text-slate-400" />
        <div className="space-y-1">
          <div><strong>Come legge i dati.</strong> Le uscite arrivano dallo Scadenzario (residuo ancora da pagare, scadenza entro la data scelta, escluse annullate e note di credito), dalle Scadenze fiscali ancora aperte e dalla stima degli stipendi. La liquidità è il saldo dei conti attivi in Banche.</div>
          <div><strong>Cosa è una stima.</strong> Incassi futuri e mensilità stipendi non sono dati certi: sono proiezioni, e i campi qui sopra servono a correggerle con quello che sai tu.</div>
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
        </div>
      )}
    </div>
  )
}
