import { useState, useEffect, useMemo, useCallback } from 'react'
import { CalendarClock, CheckCircle2, RefreshCw, Save, X, AlertTriangle, Info, Settings2, Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import TableScroll from '../components/ui/TableScroll'
import { todayYMD } from '../lib/dateLocal'
import {
  buildLiquidazioni, parseTaxPeriod, taxPeriod, titoloScadenzaIva, MESI_IVA, FONTE_LABEL, STATO_LABEL,
  type IvaComponentiMese, type IvaSettings, type IvaMeseConfermato, type IvaMesePagato, type IvaLiquidazioneRow,
} from '../lib/ivaLiquidazione'

/* ───── helpers ───── */
function fmt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
const fmtDate = (d: string | null | undefined) => d ? new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const parseNum = (s: string): number => {
  const v = parseFloat(String(s).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const EDIT_ROLES = ['super_advisor', 'contabile', 'cfo']

interface FiscalIvaRow {
  id: string
  tax_period: string | null
  status: string
  amount: number | null
  amount_paid: number | null
  due_date: string
  paid_date: string | null
}

interface SettlementRow extends IvaMeseConfermato {
  id: string
}

const STATO_STYLE: Record<IvaLiquidazioneRow['stato'], string> = {
  pagata: 'bg-emerald-100 text-emerald-700',
  confermata: 'bg-indigo-100 text-indigo-700',
  stima: 'bg-amber-100 text-amber-700',
  in_corso: 'bg-sky-100 text-sky-700',
  futura: 'bg-slate-100 text-slate-600',
}

const FONTE_STYLE: Record<IvaLiquidazioneRow['fonteCorrispettivi'], string> = {
  chiusure: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  chiusure_parziali: 'bg-sky-50 text-sky-700 border-sky-200',
  consuntivo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  preventivo: 'bg-amber-50 text-amber-700 border-amber-200',
  confermata: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  nessuna: 'bg-slate-50 text-slate-500 border-slate-200',
}

/* ───── pagina ───── */
export default function LiquidazioneIva() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const COMPANY_ID = profile?.company_id
  const canEdit = EDIT_ROLES.includes(profile?.role || '')

  const today = useMemo(() => new Date(), [])
  const [year, setYear] = useState(today.getFullYear())
  const [loading, setLoading] = useState(true)
  const [componenti, setComponenti] = useState<IvaComponentiMese[]>([])
  const [confermati, setConfermati] = useState<SettlementRow[]>([])
  const [fiscalRows, setFiscalRows] = useState<FiscalIvaRow[]>([])
  const [settings, setSettings] = useState<IvaSettings | null>(null)

  // Parametri: form
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sForm, setSForm] = useState({ rate: '22', startYear: String(today.getFullYear()), startMonth: String(today.getMonth() + 1), openingCredit: '0' })
  const [savingSettings, setSavingSettings] = useState(false)

  // Conferma mese: form inline
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [cForm, setCForm] = useState({ corr: '', ivaAtt: '', ivaCred: '', note: '' })
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [removeArm, setRemoveArm] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!COMPANY_ID) return
    setLoading(true)
    try {
      const [comp, sett, conf, fisc] = await Promise.all([
        supabase.from('v_iva_componenti_mensili').select('*').eq('company_id', COMPANY_ID),
        supabase.from('vat_settings').select('*').eq('company_id', COMPANY_ID).maybeSingle(),
        supabase.from('vat_settlements').select('*').eq('company_id', COMPANY_ID),
        supabase.from('fiscal_deadlines').select('id, tax_period, status, amount, amount_paid, due_date, paid_date')
          .eq('company_id', COMPANY_ID).eq('deadline_type', 'iva_periodica'),
      ])
      if (comp.error) throw comp.error
      setComponenti((comp.data || []).map(r => ({
        year: Number(r.year), month: Number(r.month),
        chiusure_netto: Number(r.chiusure_netto ?? 0), giorni_chiusura: Number(r.giorni_chiusura ?? 0),
        consuntivo_netto: Number(r.consuntivo_netto ?? 0), preventivo_netto: Number(r.preventivo_netto ?? 0),
        iva_fatture_attive: Number(r.iva_fatture_attive ?? 0), n_fatture_attive: Number(r.n_fatture_attive ?? 0),
        iva_fatture_passive: Number(r.iva_fatture_passive ?? 0), iva_note_credito: Number(r.iva_note_credito ?? 0),
        iva_integrazioni: Number(r.iva_integrazioni ?? 0), n_fatture_passive: Number(r.n_fatture_passive ?? 0),
        n_note_credito: Number(r.n_note_credito ?? 0), n_integrazioni: Number(r.n_integrazioni ?? 0),
      })))
      if (sett.data) {
        const s = sett.data
        const st: IvaSettings = {
          salesVatRate: Number(s.sales_vat_rate ?? 22),
          startYear: Number(s.start_year ?? today.getFullYear()),
          startMonth: Number(s.start_month ?? today.getMonth() + 1),
          openingCredit: Number(s.opening_credit ?? 0),
        }
        setSettings(st)
        setSForm({ rate: String(st.salesVatRate), startYear: String(st.startYear), startMonth: String(st.startMonth), openingCredit: String(st.openingCredit) })
      } else {
        setSettings(null)
      }
      setConfermati((conf.data || []).map(r => ({
        id: r.id, year: Number(r.year), month: Number(r.month),
        corrispettivi_netti: Number(r.corrispettivi_netti ?? 0),
        iva_debito_corrispettivi: Number(r.iva_debito_corrispettivi ?? 0),
        iva_debito_fatture_attive: Number(r.iva_debito_fatture_attive ?? 0),
        iva_credito: Number(r.iva_credito ?? 0),
        note: r.note,
      })))
      setFiscalRows((fisc.data || []) as FiscalIvaRow[])
    } catch (e) {
      console.error('Load liquidazione IVA error:', e)
      toast({ type: 'error', message: 'Errore nel caricamento della liquidazione IVA' })
    } finally {
      setLoading(false)
    }
  }, [COMPANY_ID, today, toast])

  useEffect(() => { loadData() }, [loadData])

  // Senza parametri salvati si parte dal mese corrente con credito zero (e lo si dice).
  const effSettings: IvaSettings = settings ?? {
    salesVatRate: 22, startYear: today.getFullYear(), startMonth: today.getMonth() + 1, openingCredit: 0,
  }

  const fiscalByPeriod = useMemo(() => {
    const m = new Map<string, FiscalIvaRow>()
    fiscalRows.forEach(f => {
      if (f.status === 'cancelled') return
      const p = parseTaxPeriod(f.tax_period)
      if (!p) return
      const k = `${p.year}-${String(p.month).padStart(2, '0')}`
      const prev = m.get(k)
      // se ci sono piu' righe per lo stesso periodo vince quella pagata
      if (!prev || (f.status === 'paid' && prev.status !== 'paid')) m.set(k, f)
    })
    return m
  }, [fiscalRows])

  const pagati: IvaMesePagato[] = useMemo(() => {
    const out: IvaMesePagato[] = []
    fiscalByPeriod.forEach((f, k) => {
      if (f.status !== 'paid') return
      const [y, mth] = k.split('-').map(Number)
      const amt = Number(f.amount_paid) > 0 ? Number(f.amount_paid) : Number(f.amount || 0)
      out.push({ year: y, month: mth, amount: amt })
    })
    return out
  }, [fiscalByPeriod])

  const rows = useMemo(() => buildLiquidazioni({
    componenti, settings: effSettings, confermati, pagati, toYear: year, toMonth: 12, today,
  }).filter(r => r.year === year), [componenti, effSettings, confermati, pagati, year, today])

  const kpi = useMemo(() => {
    const todayStr = todayYMD()
    const prossima = rows.find(r => r.stato !== 'pagata' && r.dueDate >= todayStr && r.importo > 0)
    const daVersare = rows.filter(r => r.importo > 0 && r.stato !== 'pagata').reduce((s, r) => s + r.importo, 0)
    const last = rows[rows.length - 1]
    const creditoAperto = last && last.importo < 0 ? -last.importo : 0
    const versato = rows.filter(r => r.stato === 'pagata').reduce((s, r) => s + r.importo, 0)
    return { prossima, daVersare, creditoAperto, versato }
  }, [rows])

  /* ── parametri ── */
  const saveSettings = async () => {
    if (!COMPANY_ID) return
    const rate = parseNum(sForm.rate)
    const sy = Number(sForm.startYear); const sm = Number(sForm.startMonth)
    if (rate < 0 || rate > 100) { toast({ type: 'error', message: 'Aliquota non valida (0-100)' }); return }
    if (!(sy >= 2000 && sy <= 2100) || !(sm >= 1 && sm <= 12)) { toast({ type: 'error', message: 'Mese di partenza non valido' }); return }
    setSavingSettings(true)
    try {
      const { error } = await supabase.from('vat_settings').upsert({
        company_id: COMPANY_ID, sales_vat_rate: rate, start_year: sy, start_month: sm,
        opening_credit: Math.abs(parseNum(sForm.openingCredit)),
      }, { onConflict: 'company_id' })
      if (error) throw error
      toast({ type: 'success', message: 'Parametri IVA salvati' })
      setSettingsOpen(false)
      await loadData()
    } catch (e) {
      console.error('Save vat_settings error:', e)
      toast({ type: 'error', message: 'Errore nel salvataggio dei parametri' })
    } finally {
      setSavingSettings(false)
    }
  }

  /* ── conferma mese ── */
  const openConfirm = (r: IvaLiquidazioneRow) => {
    setConfirmKey(r.key)
    setCForm({
      corr: String(r.corrispettiviNetti), ivaAtt: String(r.ivaFattureAttive), ivaCred: String(r.ivaCredito),
      note: r.note || '',
    })
  }

  const saveConfirm = async (r: IvaLiquidazioneRow) => {
    if (!COMPANY_ID) return
    const corr = parseNum(cForm.corr); const ivaAtt = parseNum(cForm.ivaAtt); const ivaCred = parseNum(cForm.ivaCred)
    const ivaDeb = round2(corr * effSettings.salesVatRate / 100)
    const importo = round2(ivaDeb + ivaAtt - ivaCred - r.riportoPrecedente)
    setBusyKey(r.key)
    try {
      const { error } = await supabase.from('vat_settlements').upsert({
        company_id: COMPANY_ID, year: r.year, month: r.month,
        corrispettivi_netti: corr, iva_debito_corrispettivi: ivaDeb, iva_debito_fatture_attive: ivaAtt,
        iva_credito: ivaCred, iva_riporto_precedente: r.riportoPrecedente, importo,
        fonte_corrispettivi: 'manuale', note: cForm.note.trim() || null,
        confirmed_by: profile?.id ?? null, confirmed_at: new Date().toISOString(),
      }, { onConflict: 'company_id,year,month' })
      if (error) throw error
      toast({ type: 'success', message: `${MESI_IVA[r.month]} ${r.year} confermato: ${importo >= 0 ? 'da versare' : 'a credito'} € ${fmt(Math.abs(importo))}` })
      setConfirmKey(null)
      await loadData()
    } catch (e) {
      console.error('Save vat_settlements error:', e)
      toast({ type: 'error', message: 'Errore nel salvataggio della conferma' })
    } finally {
      setBusyKey(null)
    }
  }

  const removeConfirm = async (r: IvaLiquidazioneRow) => {
    const row = confermati.find(c => c.year === r.year && c.month === r.month)
    if (!row) return
    if (removeArm !== r.key) { setRemoveArm(r.key); return }
    setBusyKey(r.key)
    try {
      const { error } = await supabase.from('vat_settlements').delete().eq('id', row.id)
      if (error) throw error
      toast({ type: 'info', message: `${MESI_IVA[r.month]} ${r.year}: conferma rimossa, torna la stima` })
      setRemoveArm(null)
      await loadData()
    } catch (e) {
      console.error('Delete vat_settlements error:', e)
      toast({ type: 'error', message: 'Errore nella rimozione della conferma' })
    } finally {
      setBusyKey(null)
    }
  }

  /* ── scadenza in fiscal_deadlines ── */
  const upsertScadenza = async (r: IvaLiquidazioneRow) => {
    if (!COMPANY_ID) return
    const existing = fiscalByPeriod.get(r.key)
    if (existing?.status === 'paid') { toast({ type: 'info', message: 'Questa scadenza risulta già pagata: non la tocco.' }); return }
    setBusyKey(r.key)
    try {
      const noteStima = r.stato === 'confermata'
        ? `Liquidazione IVA ${MESI_IVA[r.month]} ${r.year} confermata dalla pagina Liquidazione IVA.`
        : `Stima automatica (${FONTE_LABEL[r.fonteCorrispettivi]}) dalla pagina Liquidazione IVA del ${fmtDate(todayYMD())}: si aggiorna al prossimo ricalcolo.`
      if (r.importo <= 0) {
        if (existing) {
          const { error } = await supabase.from('fiscal_deadlines').update({ status: 'cancelled', amount: 0, notes: `A credito (€ ${fmt(-r.importo)} riportato al mese dopo). ${noteStima}` }).eq('id', existing.id)
          if (error) throw error
          toast({ type: 'info', message: 'Mese a credito: la scadenza esistente è stata annullata.' })
        } else {
          toast({ type: 'info', message: 'Mese a credito: nessuna scadenza da creare, il credito passa al mese dopo.' })
        }
      } else if (existing) {
        const { error } = await supabase.from('fiscal_deadlines').update({
          amount: r.importo, due_date: r.dueDate, f24_code: r.f24Code, notes: noteStima,
        }).eq('id', existing.id)
        if (error) throw error
        toast({ type: 'success', message: `Scadenza ${MESI_IVA[r.month]} aggiornata a € ${fmt(r.importo)}` })
      } else {
        const { error } = await supabase.from('fiscal_deadlines').insert({
          company_id: COMPANY_ID, deadline_type: 'iva_periodica', title: titoloScadenzaIva(r.year, r.month),
          description: 'Liquidazione IVA periodica (F24, codice tributo ' + r.f24Code + ')',
          amount: r.importo, due_date: r.dueDate, f24_code: r.f24Code, tax_period: taxPeriod(r.year, r.month),
          payment_method: 'f24', is_recurring: true, recurrence_rule: 'monthly', status: 'pending',
          notes: noteStima, created_by: profile?.id ?? null,
        })
        if (error) throw error
        toast({ type: 'success', message: `Scadenza ${MESI_IVA[r.month]} creata: € ${fmt(r.importo)} entro il ${fmtDate(r.dueDate)}` })
      }
      await loadData()
    } catch (e) {
      console.error('Upsert fiscal_deadlines IVA error:', e)
      toast({ type: 'error', message: 'Errore nella scrittura della scadenza' })
    } finally {
      setBusyKey(null)
    }
  }

  const years = useMemo(() => {
    const ys = new Set<number>([today.getFullYear(), effSettings.startYear])
    componenti.forEach(c => ys.add(c.year))
    return Array.from(ys).filter(y => y >= effSettings.startYear).sort()
  }, [componenti, effSettings.startYear, today])

  const inputCls = 'w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-200'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Liquidazione IVA"
        subtitle="Stima mensile dell'IVA da versare: corrispettivi netti × aliquota + fatture attive − fatture passive ricevute nel mese − credito riportato"
        actions={(
          <div className="flex items-center gap-2">
            <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={() => loadData()} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50" title="Ricalcola con i dati aggiornati">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            {canEdit && (
              <button onClick={() => setSettingsOpen(o => !o)} className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">
                <Settings2 size={16} /> Parametri
              </button>
            )}
          </div>
        )}
      />

      {!settings && !loading && (
        <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <b>Parametri non ancora impostati.</b> Il calcolo parte dal mese corrente con aliquota 22% e credito iniziale zero.
            {canEdit ? ' Apri «Parametri» per indicare il mese di partenza e il credito IVA da riportare.' : ' Chiedi a un super advisor o al contabile di impostarli.'}
          </div>
        </div>
      )}

      {settingsOpen && canEdit && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-sm font-semibold text-slate-800 mb-3">Parametri della liquidazione</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="text-xs text-slate-600">Aliquota vendite (%)
              <input value={sForm.rate} onChange={e => setSForm({ ...sForm, rate: e.target.value })} className={inputCls + ' mt-1'} inputMode="decimal" />
            </label>
            <label className="text-xs text-slate-600">Mese di partenza
              <select value={sForm.startMonth} onChange={e => setSForm({ ...sForm, startMonth: e.target.value })} className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                {MESI_IVA.slice(1).map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Anno di partenza
              <input value={sForm.startYear} onChange={e => setSForm({ ...sForm, startYear: e.target.value })} className={inputCls + ' mt-1'} inputMode="numeric" />
            </label>
            <label className="text-xs text-slate-600">Credito IVA iniziale (€)
              <input value={sForm.openingCredit} onChange={e => setSForm({ ...sForm, openingCredit: e.target.value })} className={inputCls + ' mt-1'} inputMode="decimal" />
            </label>
          </div>
          <p className="text-xs text-slate-500 mt-2">Il mese di partenza è il primo mese calcolato: il credito iniziale è quello da riportare in quel mese (zero se il mese precedente era a debito). I mesi prima non vengono ricostruiti.</p>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setSettingsOpen(false)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">Annulla</button>
            <button onClick={saveSettings} disabled={savingSettings} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              <Save size={14} /> Salva
            </button>
          </div>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 flex items-center gap-1"><CalendarClock size={13} /> Prossimo versamento</div>
          {kpi.prossima ? (
            <>
              <div className="text-xl font-semibold text-slate-800 mt-1 tabular-nums">€ {fmt(kpi.prossima.importo)}</div>
              <div className="text-xs text-slate-500">{MESI_IVA[kpi.prossima.month]} {kpi.prossima.year} · entro il {fmtDate(kpi.prossima.dueDate)} · {STATO_LABEL[kpi.prossima.stato]}</div>
            </>
          ) : <div className="text-xl font-semibold text-slate-400 mt-1">—</div>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Da versare nell'anno</div>
          <div className="text-xl font-semibold text-slate-800 mt-1 tabular-nums">€ {fmt(kpi.daVersare)}</div>
          <div className="text-xs text-slate-500">mesi non ancora pagati, stime comprese</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Già versato</div>
          <div className="text-xl font-semibold text-emerald-700 mt-1 tabular-nums">€ {fmt(kpi.versato)}</div>
          <div className="text-xs text-slate-500">da Scadenze Fiscali (IVA periodica pagata)</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Credito a fine anno</div>
          <div className="text-xl font-semibold text-slate-800 mt-1 tabular-nums">€ {fmt(kpi.creditoAperto)}</div>
          <div className="text-xs text-slate-500">riportato all'anno successivo, se resta</div>
        </div>
      </div>

      {/* Tabella */}
      <div className="bg-white border border-slate-200 rounded-xl">
        <TableScroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">Mese</th>
                <th className="px-4 py-3">Corrispettivi netti</th>
                <th className="px-4 py-3 text-right">IVA vendite</th>
                <th className="px-4 py-3 text-right">IVA acquisti</th>
                <th className="px-4 py-3 text-right">Riporto</th>
                <th className="px-4 py-3 text-right">Liquidazione</th>
                <th className="px-4 py-3">Scadenza</th>
                <th className="px-4 py-3">Stato</th>
                {canEdit && <th className="px-4 py-3 text-right">Azioni</th>}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Caricamento…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Nessun mese da calcolare per il {year}: controlla il mese di partenza nei parametri.</td></tr>
              )}
              {rows.map(r => {
                const fisc = fiscalByPeriod.get(r.key)
                const isConfirm = confirmKey === r.key
                const isBusy = busyKey === r.key
                const aCredito = r.importo < 0
                return (
                  <tr key={r.key} className={`border-b border-slate-100 align-top ${r.stato === 'in_corso' ? 'bg-sky-50/40' : ''}`}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium text-slate-800">{MESI_IVA[r.month]} {r.year}</div>
                      <div className="text-xs text-slate-400">F24 {r.f24Code}</div>
                    </td>
                    <td className="px-4 py-3">
                      {isConfirm ? (
                        <input value={cForm.corr} onChange={e => setCForm({ ...cForm, corr: e.target.value })} className={inputCls} inputMode="decimal" aria-label="Corrispettivi netti" />
                      ) : (
                        <>
                          <div className="tabular-nums text-slate-800">€ {fmt(r.corrispettiviNetti)}</div>
                          <span className={`inline-block mt-1 text-[11px] px-1.5 py-0.5 rounded border ${FONTE_STYLE[r.fonteCorrispettivi]}`}>
                            {FONTE_LABEL[r.fonteCorrispettivi]}{r.giorniChiusura > 0 ? ` · ${r.giorniChiusura} gg` : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div className="text-slate-800">€ {fmt(r.ivaDebitoCorrispettivi + r.ivaFattureAttive)}</div>
                      {isConfirm ? (
                        <label className="block text-[11px] text-slate-500 mt-1">fatture attive
                          <input value={cForm.ivaAtt} onChange={e => setCForm({ ...cForm, ivaAtt: e.target.value })} className={inputCls + ' mt-0.5'} inputMode="decimal" />
                        </label>
                      ) : (
                        <div className="text-[11px] text-slate-400">{effSettings.salesVatRate}% su corrisp. + € {fmt(r.ivaFattureAttive)} fatture attive</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {isConfirm ? (
                        <input value={cForm.ivaCred} onChange={e => setCForm({ ...cForm, ivaCred: e.target.value })} className={inputCls} inputMode="decimal" aria-label="IVA acquisti" />
                      ) : (
                        <>
                          <div className="text-slate-800">{r.ivaCreditoStimato ? '≈ ' : ''}€ {fmt(r.ivaCredito)}</div>
                          <div className="text-[11px] text-slate-400">
                            {r.ivaCreditoStimato
                              ? 'media dei mesi chiusi'
                              : `${r.nFatturePassive} fatture ricevute${r.nNoteCredito ? `, ${r.nNoteCredito} NC` : ''}${r.ivaIntegrazioni ? ` · RC neutro € ${fmt(r.ivaIntegrazioni)}` : ''}`}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.riportoPrecedente > 0 ? `− € ${fmt(r.riportoPrecedente)}` : '—'}</td>
                    <td className={`px-4 py-3 text-right tabular-nums font-semibold ${aCredito ? 'text-emerald-700' : 'text-slate-900'}`}>
                      {aCredito ? `a credito € ${fmt(-r.importo)}` : `€ ${fmt(r.importo)}`}
                      {isConfirm && (
                        <div className="text-[11px] font-normal text-slate-400">si ricalcola al salvataggio</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="text-slate-800">{fmtDate(r.dueDate)}</div>
                      {fisc ? (
                        <div className={`text-[11px] ${fisc.status === 'paid' ? 'text-emerald-600' : 'text-indigo-600'}`}>
                          {fisc.status === 'paid' ? `pagata € ${fmt(Number(fisc.amount_paid) > 0 ? Number(fisc.amount_paid) : Number(fisc.amount || 0))}${fisc.paid_date ? ` il ${fmtDate(fisc.paid_date)}` : ''}` : `in Scadenze Fiscali: € ${fmt(Number(fisc.amount || 0))}`}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400">non ancora nello scadenzario</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${STATO_STYLE[r.stato]}`}>{STATO_LABEL[r.stato]}</span>
                      {r.note && <div className="text-[11px] text-slate-400 mt-1 max-w-[180px] line-clamp-2" title={r.note}>{r.note}</div>}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isConfirm ? (
                          <div className="flex flex-col gap-1 items-end">
                            <input value={cForm.note} onChange={e => setCForm({ ...cForm, note: e.target.value })} placeholder="nota (facoltativa)" className="w-40 px-2 py-1 border border-slate-200 rounded-lg text-xs" />
                            <div className="flex gap-1">
                              <button onClick={() => setConfirmKey(null)} className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50" title="Annulla"><X size={14} /></button>
                              <button onClick={() => saveConfirm(r)} disabled={isBusy} className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 disabled:opacity-50">
                                <CheckCircle2 size={14} /> Salva conferma
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            {r.stato !== 'pagata' && r.stato !== 'futura' && (
                              <button onClick={() => openConfirm(r)} disabled={isBusy} className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs hover:bg-slate-50 disabled:opacity-50" title="Inserisci i numeri definitivi del mese">
                                {r.stato === 'confermata' ? 'Modifica' : 'Conferma'}
                              </button>
                            )}
                            {r.stato === 'confermata' && (
                              <button onClick={() => removeConfirm(r)} disabled={isBusy} className={`px-2.5 py-1.5 border rounded-lg text-xs disabled:opacity-50 ${removeArm === r.key ? 'border-red-300 text-red-700 bg-red-50' : 'border-slate-200 hover:bg-slate-50'}`} title="Torna alla stima automatica">
                                <Undo2 size={13} className="inline mr-1" />{removeArm === r.key ? 'Confermi?' : 'Rimuovi'}
                              </button>
                            )}
                            {fisc?.status !== 'paid' && r.stato !== 'futura' && (
                              <button onClick={() => upsertScadenza(r)} disabled={isBusy} className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 text-white rounded-lg text-xs hover:bg-slate-900 disabled:opacity-50" title="Crea o aggiorna la scadenza in Scadenze Fiscali (e quindi in Scadenzario e Cashflow)">
                                <CalendarClock size={13} /> {fisc ? 'Aggiorna scadenza' : 'Crea scadenza'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableScroll>
      </div>

      <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
        <Info size={16} className="shrink-0 mt-0.5 text-slate-400" />
        <div className="space-y-1">
          <div><b>Corrispettivi netti</b>: chiusure di cassa confermate quando ci sono (mese in corso: chiusure fino a oggi più preventivo per i giorni restanti), altrimenti il consuntivo e poi il preventivo di Budget &amp; Controllo. Sono imponibili: l'IVA vendite è corrispettivi × aliquota.</div>
          <div><b>IVA acquisti</b>: fatture passive per <b>mese di ricezione SDI</b> (non data fattura), meno le note di credito. Le integrazioni reverse charge (TD16/17/18/19) sono neutre e non entrano. Per i mesi futuri si usa la media dei mesi chiusi (≈). Tutta l'IVA è considerata detraibile.</div>
          <div><b>Riporto</b>: se un mese chiude a credito, il credito riduce la liquidazione del mese dopo. Un mese <b>confermato</b> usa i numeri inseriti a mano; un mese <b>pagato</b> usa l'importo versato registrato in Scadenze Fiscali.</div>
          <div><b>Scadenza</b>: il 16 del mese successivo (20 agosto per luglio, giorno lavorativo successivo se cade nel weekend), codice tributo 60 + mese. «Crea scadenza» la scrive in Scadenze Fiscali: da lì entra in Scadenzario e Cashflow Prospettico.</div>
        </div>
      </div>
    </div>
  )
}
