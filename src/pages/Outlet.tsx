import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import TextTooltip from '../components/Tooltip'
import { PlaceholderDot, PlaceholderLegend } from '../components/PlaceholderMark'
import { useToast } from '../components/Toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import { usePeriod } from '../hooks/usePeriod'
import {
  Store, RefreshCw, MapPin, Calendar, Target, TrendingUp,
  ChevronRight, ArrowLeft, DollarSign, Users, FileText, Search, Plus,
  Upload, CheckCircle2, Clock, Trash2, Bell,
} from 'lucide-react'
import OutletWizard from '../components/OutletWizard'
import OutletValutazione from '../components/OutletValutazione'
import DocumentiNegozio from '../components/DocumentiNegozio'
import ContractUploader from '../components/ContractUploader'
import { Modal } from '../components/ui/Modal'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { formatOutletName } from '../lib/formatters'
import { segmentoOutlet, trovaOutlet } from '../lib/outletSlug'
import {
  getOutletLifecycle, daysToOpening, outletLifecycleCaption, safePct,
  OUTLET_LIFECYCLE_LABEL, OUTLET_LIFECYCLE_STYLE, type OutletLifecycleFields,
} from '../lib/outletLifecycle'
// Organico granitico: chi è in forza lo dicono i cedolini (src/lib/headcount.ts).
import {
  headcountCountByOutlet, lastGranitedPeriod, paidEmployeeIds, periodLabel,
  type HeadcountCost, type HeadcountEmployee, type HeadcountAllocation,
} from '../lib/headcount'

// Sezioni della scheda di un punto vendita, nell'ordine delle linguette.
const SCHEDE_OUTLET = ['overview', 'corrispettivi', 'budget', 'staff', 'documenti']
const MONTHS = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

// Default 2 decimali perché tutte le chiamate in questo file formatano importi €.
// Per i contatori passare esplicitamente 0 (es. fmt(count, 0)).
function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(n)
}

// Stato del punto vendita (in apertura / attivo / chiuso) calcolato da
// opening_date / closing_date: fonte unica in src/lib/outletLifecycle.ts,
// condivisa con Dashboard, Confronto, Margini, Produttività e Cashflow.
function StatusBadge({ isActive, outlet }: { isActive?: boolean; outlet?: OutletLifecycleFields | null }) {
  // Se viene passato l'outlet completo, usa il calcolo dinamico
  if (outlet && (outlet.opening_date !== undefined || outlet.closing_date !== undefined)) {
    const status = getOutletLifecycle(outlet)
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${OUTLET_LIFECYCLE_STYLE[status]}`} title={outletLifecycleCaption(outlet)}>
        {OUTLET_LIFECYCLE_LABEL[status]}
      </span>
    )
  }
  // Fallback: comportamento originale (per usi su Dipendenti, ecc.)
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
      isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {isActive ? 'Attivo' : 'Chiuso'}
    </span>
  )
}

// ====== GRIGLIA OUTLET ======
// TODO: tighten type
function OutletGrid({ outlets, revenue, year, onSelect }: { outlets: any[]; revenue: Record<string, any>; year: number; onSelect: (outlet: any) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {outlets.map(outlet => {
        const outletRev = revenue[outlet.id] || {}
        const ytd = Object.values(outletRev).reduce((s: number, v: any) => s + v, 0)
        // "Mesi presi" = mesi distinti con dato di ricavo (consuntivo granitico
        // per gli anni con budget_confronto; mesi presenti nel fallback 2025).
        const months = Object.keys(outletRev).length

        return (
          <div
            key={outlet.id}
            onClick={() => onSelect(outlet)}
            className="rounded-2xl p-5 shadow-lg hover:shadow-xl cursor-pointer transition group"
            style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600">
                  <Store size={20} />
                </div>
                <div>
                  <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition">
                    {formatOutletName(outlet.name)}
                  </div>
                  <div className="text-xs text-slate-400">{outlet.code}</div>
                </div>
              </div>
              <StatusBadge outlet={outlet} isActive={outlet.is_active ?? undefined} />
            </div>

            <div className="space-y-2 text-sm">
              {outlet.mall_name && (
                <div className="flex items-center gap-2 text-slate-500">
                  <MapPin size={14} />
                  <span>{outlet.mall_name}</span>
                </div>
              )}
              {outlet.opening_date && (
                <div className="flex items-center gap-2 text-slate-500">
                  <Calendar size={14} />
                  <span>Apertura: {new Date(outlet.opening_date).toLocaleDateString('it-IT')}</span>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">Ricavi {year}</div>
                <div className="text-lg font-bold text-slate-900">{ytd > 0 ? `${fmt(ytd)} €` : '—'}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">Mesi presi</div>
                <div className="text-lg font-bold text-slate-600">{fmt(months, 0)}</div>
              </div>
              <ChevronRight size={20} className="text-slate-300 group-hover:text-blue-400 transition" />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// La scheda «Documenti» (archivio e documenti del contratto in un elenco solo) sta in
// src/components/DocumentiNegozio.tsx.

// ====== EXTRACTED CONTRACT DATA ======
// TODO: tighten type
function ExtractedContractData({ outlet }: { outlet: any }) {
  const hasContractData = outlet.contract_start || outlet.rent_annual || outlet.deposit_guarantee
    || outlet.contract_duration_months || outlet.contract_end

  if (!hasContractData) return null

  const calculateEndDate = () => {
    if (outlet.contract_end) return new Date(outlet.contract_end)
    if (outlet.contract_start && outlet.contract_duration_months) {
      const d = new Date(outlet.contract_start)
      d.setMonth(d.getMonth() + parseInt(outlet.contract_duration_months))
      return d
    }
    return null
  }

  const endDate = calculateEndDate()
  const daysToEnd = endDate ? Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null
  const isExpiring = daysToEnd && daysToEnd > 0 && daysToEnd < 180

  return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <h3 className="text-sm font-semibold text-slate-900 mb-4">Dati estratti dal contratto</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Key Dates Section */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date Chiave</div>
          {outlet.contract_start && (
            <div className="flex items-start gap-3">
              <Calendar size={16} className="mt-0.5 text-blue-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Inizio contratto</div>
                <div className="text-sm font-medium text-slate-900">{new Date(outlet.contract_start).toLocaleDateString('it-IT')}</div>
              </div>
            </div>
          )}
          {endDate && (
            <div className="flex items-start gap-3">
              <Calendar size={16} className={`mt-0.5 shrink-0 ${isExpiring ? 'text-amber-600' : 'text-slate-400'}`} />
              <div>
                <div className="text-xs text-slate-500">Fine contratto</div>
                <div className={`text-sm font-medium ${isExpiring ? 'text-amber-600' : 'text-slate-900'}`}>
                  {endDate.toLocaleDateString('it-IT')}
                  {isExpiring && <span className="ml-2 text-xs bg-amber-100 px-2 py-0.5 rounded text-amber-700">Scade tra {daysToEnd} gg</span>}
                </div>
              </div>
            </div>
          )}
          {outlet.exit_clause_month && (
            <div className="flex items-start gap-3">
              <Clock size={16} className="mt-0.5 text-purple-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Clausola uscita</div>
                <div className="text-sm font-medium text-slate-900">Mese {outlet.exit_clause_month}</div>
              </div>
            </div>
          )}
        </div>

        {/* Key Amounts Section */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Importi</div>
          {outlet.rent_annual && (
            <div className="flex items-start gap-3">
              <DollarSign size={16} className="mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Canone annuo</div>
                <div className="text-sm font-medium text-slate-900">{fmt(outlet.rent_annual)} €</div>
              </div>
            </div>
          )}
          {outlet.rent_per_sqm && outlet.sqm && (
            <div className="flex items-start gap-3">
              <Target size={16} className="mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Canone €/mq</div>
                <div className="text-sm font-medium text-slate-900">{fmt(outlet.rent_per_sqm, 2)} € ({outlet.sqm} mq)</div>
              </div>
            </div>
          )}
          {outlet.deposit_guarantee && (
            <div className="flex items-start gap-3">
              <DollarSign size={16} className="mt-0.5 text-red-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Fideiussione</div>
                <div className="text-sm font-medium text-slate-900">{fmt(outlet.deposit_guarantee)} €</div>
              </div>
            </div>
          )}
        </div>

        {/* Key Clauses Section */}
        <div className="space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Condizioni</div>
          {outlet.variable_rent_pct && (
            <div className="flex items-start gap-3">
              <TrendingUp size={16} className="mt-0.5 text-blue-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Canone variabile</div>
                <div className="text-sm font-medium text-slate-900">{outlet.variable_rent_pct}% Volume Affari</div>
              </div>
            </div>
          )}
          {outlet.rent_free_days && outlet.rent_free_days > 0 && (
            <div className="flex items-start gap-3">
              <CheckCircle2 size={16} className="mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Giorni gratuiti</div>
                <div className="text-sm font-medium text-slate-900">{outlet.rent_free_days} giorni</div>
              </div>
            </div>
          )}
          {outlet.contract_min_months && (
            <div className="flex items-start gap-3">
              <Clock size={16} className="mt-0.5 text-slate-600 shrink-0" />
              <div>
                <div className="text-xs text-slate-500">Durata minima</div>
                <div className="text-sm font-medium text-slate-900">{outlet.contract_min_months} mesi</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contract Duration Summary */}
      {outlet.contract_duration_months && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div className="text-xs font-semibold text-slate-600 mb-1">Durata contratto</div>
          <div className="text-sm text-slate-900">{outlet.contract_duration_months} mesi</div>
        </div>
      )}
    </div>
  )
}

// ====== ALERT SCADENZE CONTRATTI ======
type AlertItem = { type: 'critical' | 'warning' | 'info'; icon: string; title: string; detail: string; daysLeft: number }
// Legge le colonne REALI di `outlets` (contract_start, contract_end,
// exit_clause_month, guarantee_expiry): la versione precedente leggeva
// quattro campi inesistenti e non mostrava mai nulla.
function ContractAlerts({ outlet }: { outlet: Record<string, unknown> }) {
  const alerts: AlertItem[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const asDate = (v: unknown): Date | null => {
    if (!v) return null
    const d = new Date(String(v))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const daysFromToday = (d: Date) => Math.ceil((d.getTime() - today.getTime()) / 86_400_000)
  const fmtDate = (d: Date) => d.toLocaleDateString('it-IT')

  // Apertura programmata (outlet in pre-apertura)
  const opening = asDate(outlet.opening_date)
  if (opening && opening > today) {
    const daysLeft = daysFromToday(opening)
    alerts.push({
      type: 'info',
      icon: '🔵',
      title: `Apertura tra ${daysLeft} giorni`,
      detail: `Data prevista: ${fmtDate(opening)}${outlet.opening_confirmed ? '' : ' (non ancora confermata dal concedente)'}`,
      daysLeft,
    })
  }

  // Scadenza contratto: data esplicita, oppure decorrenza + durata in mesi
  const contractStart = asDate(outlet.contract_start)
  let contractEnd = asDate(outlet.contract_end)
  const durationMonths = Number(outlet.contract_duration_months) || 0
  if (!contractEnd && contractStart && durationMonths > 0) {
    contractEnd = new Date(contractStart)
    contractEnd.setMonth(contractEnd.getMonth() + durationMonths)
  }
  if (contractEnd) {
    const daysLeft = daysFromToday(contractEnd)
    if (daysLeft <= 365) {
      alerts.push({
        type: daysLeft <= 90 ? 'critical' : daysLeft <= 180 ? 'warning' : 'info',
        icon: daysLeft <= 90 ? '🔴' : daysLeft <= 180 ? '🟡' : '🔵',
        title: daysLeft <= 0 ? 'Contratto SCADUTO' : `Contratto scade tra ${daysLeft} giorni`,
        detail: `Scadenza: ${fmtDate(contractEnd)}`,
        daysLeft,
      })
    }
  }

  // Finestra di recesso: exit_clause_month = mesi dall'apertura (o dalla decorrenza)
  const exitBase = opening || contractStart
  const exitMonth = Number(outlet.exit_clause_month) || 0
  if (exitBase && exitMonth > 0) {
    const exit = new Date(exitBase)
    exit.setMonth(exit.getMonth() + exitMonth)
    const daysLeft = daysFromToday(exit)
    if (daysLeft > 0 && daysLeft <= 180) {
      const threshold = Number(outlet.exit_revenue_threshold) || 0
      alerts.push({
        type: daysLeft <= 60 ? 'critical' : 'warning',
        icon: daysLeft <= 60 ? '🔴' : '🟡',
        title: `Finestra di recesso tra ${daysLeft} giorni (mese ${exitMonth})`,
        detail: `Data: ${fmtDate(exit)}${threshold > 0 ? ` · possibile se il fatturato dei 12 mesi precedenti è sotto ${fmt(threshold, 0)} €` : ''}`,
        daysLeft,
      })
    }
  }

  // Scadenza fideiussione / garanzia bancaria
  const guarantee = asDate(outlet.guarantee_expiry)
  if (guarantee) {
    const daysLeft = daysFromToday(guarantee)
    if (daysLeft <= 90) {
      alerts.push({
        type: daysLeft <= 30 ? 'critical' : 'warning',
        icon: daysLeft <= 30 ? '🔴' : '🟡',
        title: daysLeft <= 0 ? 'Fideiussione SCADUTA' : `Fideiussione scade tra ${daysLeft} giorni`,
        detail: `Scadenza: ${fmtDate(guarantee)}${Number(outlet.deposit_guarantee) > 0 ? ` · importo ${fmt(Number(outlet.deposit_guarantee), 0)} €` : ''}`,
        daysLeft,
      })
    }
  }

  if (alerts.length === 0) return null

  // Ordina per urgenza
  alerts.sort((a, b) => a.daysLeft - b.daysLeft)

  const bgColors = {
    critical: 'bg-red-50 border-red-200',
    warning: 'bg-amber-50 border-amber-200',
    info: 'bg-blue-50 border-blue-200',
  }

  return (
    <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-3">
        <Bell size={16} className="text-amber-500" />
        Alert scadenze
      </h3>
      <div className="space-y-2">
        {alerts.map((alert, i) => (
          <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border ${bgColors[alert.type]}`}>
            <span className="text-lg">{alert.icon}</span>
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-900">{alert.title}</div>
              <div className="text-xs text-slate-500">{alert.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ====== OUTLET IN PRE-APERTURA ======
// Card mostrata solo quando la data di apertura è nel futuro: riassume ciò che
// è già uscito (caparra), ciò che è garantito (fideiussione) e ciò che parte
// dall'apertura (canone, spese), così l'assenza di ricavi non viene letta
// come un negozio che va male.
function PreAperturaCard({ outlet }: { outlet: OutletEntity }) {
  const labels = useCompanyLabels()
  const o = outlet as Record<string, unknown>
  const lc = o as OutletLifecycleFields
  if (getOutletLifecycle(lc) !== 'programmato') return null
  const days = daysToOpening(lc)
  const num = (k: string) => Number(o[k]) || 0
  const date = (k: string) => (o[k] ? new Date(String(o[k])).toLocaleDateString('it-IT') : '—')
  const euro = (n: number, suffix = ' €') => (n > 0 ? `${fmt(n, 0)}${suffix}` : '—')
  const rows: Array<[string, string]> = [
    ['Consegna immobile', date('delivery_date')],
    ['Decorrenza canone', date('rent_start_date')],
    ['Caparra / acconto già versato', euro(num('deposit_amount'))],
    ['Anticipo canone', euro(num('advance_payment'))],
    ['Fideiussione', num('deposit_guarantee') > 0 ? `${fmt(num('deposit_guarantee'), 0)} €${o.guarantee_expiry ? ` · scade ${date('guarantee_expiry')}` : ''}` : '—'],
    ['Allestimento / costi iniziali', euro(num('setup_cost'))],
    ['Canone dall\'apertura', euro(num('rent_monthly'), ' €/mese')],
    ['Spese gestione e promozione', euro(num('condo_marketing_monthly'), ' €/mese')],
  ]
  return (
    <div className="bg-blue-50/60 rounded-xl border border-blue-200 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
          <Clock size={15} />
          {days != null ? `In apertura tra ${days} giorni` : 'In apertura'} · {date('opening_date')}
          {!o.opening_confirmed && <span className="text-xs font-normal text-blue-700">(data da confermare)</span>}
        </h3>
      </div>
      <p className="text-xs text-blue-800 mb-3">
        I ricavi partono dalla data di apertura. I costi già sostenuti e quelli in arrivo (canone, spese, allestimento) sono nello Scadenzario e nel Cashflow; nelle pagine di confronto questo {labels.pointOfSaleLower} resta fuori da medie e classifiche finché non apre.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-1 border-b border-blue-100"><span className="text-slate-600">{k}</span><span className="font-medium text-slate-900">{v}</span></div>
        ))}
      </div>
    </div>
  )
}

// ====== CONTRATTO REGISTRATO (tabella contracts) ======
type ContractRow = {
  id: string; name: string; contract_type: string; counterpart: string | null; contract_number: string | null
  monthly_amount: number | null; annual_amount: number | null; vat_rate: number | null; deposit_amount: number | null
  start_date: string; end_date: string | null; notice_days: number | null; notice_deadline: string | null
  escalation_type: string | null; escalation_rate: number | null; escalation_date: string | null; escalation_frequency_months: number | null
  variable_rent_pct: number | null; variable_rent_threshold: number | null; min_revenue_clause: number | null; min_revenue_period: string | null
  sqm: number | null; status: string; notes: string | null
}
type ContractDeadlineRow = { id: string; contract_id: string; deadline_date: string; description: string; is_completed: boolean | null; notes: string | null }

function OutletContrattoCard({ outletId, companyId }: { outletId: string; companyId: string }) {
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [deadlines, setDeadlines] = useState<ContractDeadlineRow[]>([])
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data: rows } = await supabase
        .from('contracts')
        .select('id, name, contract_type, counterpart, contract_number, monthly_amount, annual_amount, vat_rate, deposit_amount, start_date, end_date, notice_days, notice_deadline, escalation_type, escalation_rate, escalation_date, escalation_frequency_months, variable_rent_pct, variable_rent_threshold, min_revenue_clause, min_revenue_period, sqm, status, notes')
        .eq('outlet_id', outletId)
        .eq('company_id', companyId)
        .order('start_date', { ascending: false })
      if (cancelled) return
      const list = (rows || []) as ContractRow[]
      setContracts(list)
      if (list.length === 0) { setDeadlines([]); return }
      const { data: dl } = await supabase
        .from('contract_deadlines')
        .select('id, contract_id, deadline_date, description, is_completed, notes')
        .in('contract_id', list.map(c => c.id))
        .order('deadline_date', { ascending: true })
      if (!cancelled) setDeadlines((dl || []) as ContractDeadlineRow[])
    }
    load()
    return () => { cancelled = true }
  }, [outletId, companyId])

  if (contracts.length === 0) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = (v: string | null) => (v ? new Date(v).toLocaleDateString('it-IT') : '—')
  const STATUS_LABEL: Record<string, string> = { attivo: 'Attivo', in_scadenza: 'In scadenza', scaduto: 'Scaduto', disdettato: 'Disdettato' }
  // In `contracts` le percentuali sono frazioni a 4 decimali (0.10 = 10%),
  // diversamente da outlets.variable_rent_pct che è già in punti percentuali.
  const pctFraction = (v: number) => `${Number.isInteger(v * 100) ? v * 100 : (v * 100).toFixed(2)}%`
  const ESC_LABEL: Record<string, string> = { istat: 'ISTAT', istat_min_1pct: 'ISTAT (min +1%)', fisso: 'Fisso', nessuna: 'Nessuna' }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><FileText size={15} /> Contratto</h3>
      {contracts.map(c => {
        const open = deadlines.filter(x => x.contract_id === c.id && !x.is_completed)
        const next = open.filter(x => new Date(x.deadline_date) >= today)
        return (
          <div key={c.id} className="space-y-3">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <div className="font-medium text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-500">{c.contract_type}{c.counterpart ? ` · ${c.counterpart}` : ''}{c.contract_number ? ` · n. ${c.contract_number}` : ''}</div>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.status === 'attivo' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{STATUS_LABEL[c.status] || c.status}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-slate-500">Decorrenza → scadenza</span><span className="font-medium">{d(c.start_date)} → {d(c.end_date)}</span></div>
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-slate-500">Canone</span><span className="font-medium">{c.monthly_amount != null ? `${fmt(c.monthly_amount)} €/mese` : '—'}{c.annual_amount != null ? ` · ${fmt(c.annual_amount, 0)} €/anno` : ''}</span></div>
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-slate-500">Canone variabile</span><span className="font-medium">{c.variable_rent_pct != null ? `${pctFraction(c.variable_rent_pct)} del fatturato${c.variable_rent_threshold ? ` oltre ${fmt(c.variable_rent_threshold, 0)} €` : ''}` : '—'}</span></div>
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-slate-500">Rivalutazione</span><span className="font-medium">{c.escalation_type ? `${ESC_LABEL[c.escalation_type] || c.escalation_type}${c.escalation_rate != null ? ` min. ${pctFraction(c.escalation_rate)}` : ''}${c.escalation_date ? ` dal ${d(c.escalation_date)}` : ''}${c.escalation_frequency_months ? ` ogni ${c.escalation_frequency_months} mesi` : ''}` : '—'}</span></div>
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-slate-500">Soglia di recesso</span><span className="font-medium">{c.min_revenue_clause != null ? `${fmt(c.min_revenue_clause, 0)} €${c.min_revenue_period ? ` (${c.min_revenue_period})` : ''}` : '—'}</span></div>
              <div className="flex justify-between py-1 border-b border-slate-50"><span className="text-slate-500">Preavviso</span><span className="font-medium">{c.notice_days != null ? `${c.notice_days} giorni` : '—'}{c.notice_deadline ? ` · entro ${d(c.notice_deadline)}` : ''}</span></div>
            </div>
            {c.notes && <p className="text-xs text-slate-500 whitespace-pre-line">{c.notes}</p>}
            {next.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Prossime scadenze contrattuali</div>
                <ul className="divide-y divide-slate-50">
                  {next.slice(0, 8).map(x => {
                    const days = Math.ceil((new Date(x.deadline_date).getTime() - today.getTime()) / 86_400_000)
                    return (
                      <li key={x.id} className="flex items-center justify-between py-1.5 text-sm">
                        <span className="text-slate-700">{x.description}</span>
                        <span className={`text-xs font-medium ${days <= 30 ? 'text-red-600' : days <= 90 ? 'text-amber-600' : 'text-slate-500'}`}>{d(x.deadline_date)} · tra {days} gg</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ====== CORRISPETTIVI TAB ======
type DailyRevenueRow ={ date: string; gross_revenue: number | null; transactions_count: number | null; avg_ticket: number | null }
function CorrispettiviTab({ outletId, companyId }: { outletId: string; companyId: string }) {
  const [daily, setDaily] = useState<DailyRevenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('30') // 7, 30, 90

  useEffect(() => {
    loadDaily()
  }, [outletId, period])

  async function loadDaily() {
    setLoading(true)
    try {
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - parseInt(period))
      const fromDate = daysAgo.toISOString().split('T')[0]

      const { data } = await supabase
        .from('daily_revenue')
        .select('date, gross_revenue, transactions_count, avg_ticket')
        .eq('outlet_id', outletId)
        .eq('company_id', companyId)
        .gte('date', fromDate)
        .order('date', { ascending: true })

      setDaily(data || [])
    } catch (e) {
      console.error('Corrispettivi load error:', e)
    } finally {
      setLoading(false)
    }
  }

  const totalRev = daily.reduce((s, d) => s + (d.gross_revenue || 0), 0)
  const avgDaily = daily.length > 0 ? totalRev / daily.length : 0
  const totalTx = daily.reduce((s, d) => s + (d.transactions_count || 0), 0)
  const avgTicket = totalTx > 0 ? totalRev / totalTx : 0
  const bestDay = daily.reduce<{ date: string; value: number }>((best, d) => (d.gross_revenue || 0) > best.value ? { date: d.date, value: d.gross_revenue || 0 } : best, { date: '', value: 0 })

  const chartData = daily.map(d => ({
    ...d,
    label: new Date(d.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
    weekday: new Date(d.date).toLocaleDateString('it-IT', { weekday: 'short' }),
  }))

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Corrispettivi giornalieri</h3>
        <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {[
            { key: '7', label: '7 gg' },
            { key: '30', label: '30 gg' },
            { key: '90', label: '90 gg' },
          ].map(t => (
            <button key={t.key} onClick={() => setPeriod(t.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                period === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI corrispettivi */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Totale periodo</div>
          <div className="text-xl font-bold text-slate-900">{fmt(totalRev)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Media giornaliera</div>
          <div className="text-xl font-bold text-blue-600">{fmt(avgDaily)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Scontrino medio</div>
          <div className="text-xl font-bold text-emerald-600">{fmt(avgTicket, 2)} €</div>
          <div className="text-[11px] text-slate-400">{fmt(totalTx)} transazioni</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Giorno migliore</div>
          <div className="text-xl font-bold text-amber-600">{fmt(bestDay.value)} €</div>
          <div className="text-[11px] text-slate-400">{bestDay.date ? new Date(bestDay.date).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' }) : '—'}</div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={20} className="animate-spin text-slate-400" />
        </div>
      ) : daily.length === 0 ? (
        <div className="bg-slate-50 rounded-xl p-8 text-center">
          <Calendar size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 mb-2">Nessun corrispettivo registrato</p>
          <p className="text-xs text-slate-400">Importa i dati POS da <a href="/import-hub" className="text-blue-500 hover:underline">ImportHub</a></p>
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id="grad-corr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="label" {...AXIS_STYLE} interval={period === '7' ? 0 : 'preserveStartEnd'} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                <Bar dataKey="gross_revenue" name="Incasso" fill="url(#grad-corr)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Daily table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto scroll-shadow-x">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                    <th className="py-2 px-4 text-left font-medium">Data</th>
                    <th className="py-2 px-4 text-left font-medium">Giorno</th>
                    <th className="py-2 px-4 text-right font-medium">Incasso</th>
                    <th className="py-2 px-4 text-right font-medium">Scontrini</th>
                    <th className="py-2 px-4 text-right font-medium">Ticket medio</th>
                  </tr>
                </thead>
                <tbody>
                  {[...daily].reverse().map(d => (
                    <tr key={d.date} className="border-t border-slate-50 hover:bg-slate-50/50">
                      <td className="py-2 px-4 font-medium text-slate-900">{new Date(d.date).toLocaleDateString('it-IT')}</td>
                      <td className="py-2 px-4 text-slate-500">{new Date(d.date).toLocaleDateString('it-IT', { weekday: 'long' })}</td>
                      <td className="py-2 px-4 text-right font-semibold text-slate-900">{fmt(d.gross_revenue)} €</td>
                      <td className="py-2 px-4 text-right text-slate-600">{d.transactions_count || '—'}</td>
                      <td className="py-2 px-4 text-right text-blue-600">{d.transactions_count ? fmt((d.gross_revenue || 0) / d.transactions_count, 2) + ' €' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ====== STAFF TAB ======
// ORGANICO GRANITICO: chi è "in forza" in questo punto vendita lo dicono i
// cedolini dell'ultimo mese caricato, non `employees.outlet_id` (che diverge
// dalle allocazioni su metà degli outlet). L'anagrafica serve per l'elenco e i
// dati di contratto; il NUMERO viene dal payroll.
type StaffRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  nome?: string | null
  cognome?: string | null
  codice_fiscale?: string | null
  fiscal_code?: string | null
  role_description?: string | null
  contratto_tipo?: string | null
  contract_type?: string | null
  gross_annual_cost?: number | null
  net_monthly_salary?: number | null
  hire_date?: string | null
  is_active?: boolean | null
}
function StaffTab({ outletId, outletName, companyId }: { outletId: string; outletName: string; companyId: string }) {
  const labels = useCompanyLabels()
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [costs, setCosts] = useState<HeadcountCost[]>([])
  const [allocs, setAllocs] = useState<HeadcountAllocation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStaff()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId, outletName])

  async function loadStaff() {
    setLoading(true)
    try {
      // Allocazioni di QUESTO outlet (outlet_code = nome dell'outlet).
      const { data: allocData, error: allocErr } = await supabase
        .from('employee_outlet_allocations')
        .select('employee_id, outlet_code')
        .eq('company_id', companyId)
        .eq('outlet_code', outletName)
      if (allocErr) console.error('Staff: errore allocazioni', allocErr)
      const allocRows = ((allocData || []) as unknown) as HeadcountAllocation[]
      setAllocs(allocRows)

      const ids = allocRows.map(a => a.employee_id).filter((x): x is string => Boolean(x))
      if (ids.length === 0) { setStaff([]); setCosts([]); return }

      // Nomi delle colonne allineati allo schema reale di `employees`
      // (gross_annual_cost / net_monthly_salary / role_description): con i nomi
      // sbagliati la select falliva e la scheda restava vuota su ogni outlet.
      const [empRes, costRes] = await Promise.all([
        supabase
          .from('employees')
          .select('id, first_name, last_name, nome, cognome, codice_fiscale, fiscal_code, role_description, contratto_tipo, contract_type, gross_annual_cost, net_monthly_salary, hire_date, is_active')
          .eq('company_id', companyId)
          .in('id', ids)
          .order('last_name'),
        supabase
          .from('employee_costs')
          .select('employee_id, year, month, netto, outlet_code')
          .eq('company_id', companyId)
          .in('employee_id', ids)
          .not('netto', 'is', null),
      ])
      if (empRes.error) console.error('Staff: errore anagrafica', empRes.error)
      if (costRes.error) console.error('Staff: errore cedolini', costRes.error)
      setStaff(((empRes.data || []) as unknown) as StaffRow[])
      setCosts(((costRes.data || []) as unknown) as HeadcountCost[])
    } catch (e) {
      console.error('Staff load error:', e)
    } finally {
      setLoading(false)
    }
  }

  const period = useMemo(() => lastGranitedPeriod(costs), [costs])
  const inForza = useMemo(
    () => paidEmployeeIds(costs, staff as unknown as HeadcountEmployee[], period),
    [costs, staff, period],
  )
  const headcount = useMemo(
    () => (headcountCountByOutlet(costs, staff as unknown as HeadcountEmployee[], allocs, period)[outletName] || 0),
    [costs, staff, allocs, period, outletName],
  )

  const anagrafica = staff.filter(e => e.is_active !== false).length
  const ralRows = staff.filter(e => e.gross_annual_cost != null)
  const totalCost = ralRows.reduce((s, e) => s + (e.gross_annual_cost || 0), 0)
  const empLabel = (e: StaffRow) => `${e.nome || e.first_name || ''} ${e.cognome || e.last_name || ''}`.trim() || '—'

  if (loading) return <div className="flex items-center justify-center py-12"><RefreshCw size={20} className="animate-spin text-slate-400" /></div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Dipendenti in forza</div>
          <div className="text-xl font-bold text-slate-900">{period ? headcount : 'N/D'}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {period ? `dai cedolini di ${periodLabel(period)}` : 'nessun cedolino caricato'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">In anagrafica</div>
          <div className="text-xl font-bold text-slate-900">{anagrafica}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">persone assegnate a questo {labels.pointOfSaleLower}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-400">Costo annuo lordo</div>
          <div className="text-xl font-bold text-amber-600">{ralRows.length > 0 ? `${fmt(totalCost)} €` : '—'}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {ralRows.length > 0 ? `su ${ralRows.length} schede con RAL` : 'RAL non compilata in anagrafica'}
          </div>
        </div>
      </div>

      {staff.length === 0 ? (
        <div className="bg-slate-50 rounded-xl p-8 text-center">
          <Users size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500">Nessun dipendente assegnato a questo {labels.pointOfSaleLower}</p>
          <p className="text-xs text-slate-400 mt-1">Assegna dipendenti dalla pagina <a href="/dipendenti" className="text-blue-500 hover:underline">Dipendenti</a></p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto scroll-shadow-x">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50">
              <tr className="text-[11px] text-slate-500 uppercase tracking-wider">
                <th className="py-2 px-4 text-left font-medium">Nome</th>
                <th className="py-2 px-4 text-left font-medium">Ruolo</th>
                <th className="py-2 px-4 text-left font-medium">Contratto</th>
                <th className="py-2 px-4 text-right font-medium">RAL</th>
                <th className="py-2 px-4 text-center font-medium">Stato</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(e => {
                const pagato = inForza.has(e.id)
                const stato = e.is_active === false
                  ? { label: 'Cessato', cls: 'bg-slate-100 text-slate-500' }
                  : pagato
                    ? { label: 'In forza', cls: 'bg-emerald-50 text-emerald-700' }
                    : { label: period ? `Nessun cedolino ${periodLabel(period)}` : 'Nessun cedolino', cls: 'bg-amber-50 text-amber-700' }
                return (
                  <tr key={e.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                    <td className="py-2 px-4 font-medium text-slate-900">{empLabel(e)}</td>
                    <td className="py-2 px-4 text-slate-600">{e.role_description || '—'}</td>
                    <td className="py-2 px-4 text-slate-500 text-xs">{e.contratto_tipo || e.contract_type || '—'}</td>
                    <td className="py-2 px-4 text-right font-medium text-slate-900">{e.gross_annual_cost != null ? `${fmt(e.gross_annual_cost)} €` : '—'}</td>
                    <td className="py-2 px-4 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${stato.cls}`}>{stato.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ====== DETTAGLIO OUTLET — HUB CON TAB ======
// TODO: tighten type
type OutletEntity = Record<string, unknown> & { id: string; company_id?: string; name?: string | null; code?: string | null; mall_name?: string | null; rent_monthly?: number | null; condo_marketing_monthly?: number | null; is_active?: boolean | null }
function OutletDetail({ outlet, revenue, confronto, revPlaceholder, year, detailTab, setDetailTab, onBack, onEdit, onDelete }: { outlet: OutletEntity; detailTab: string; setDetailTab: (key: string) => void; revenue: Record<string, Record<number, number>>; confronto: Record<string, { prev: Record<number, number>; cons: Record<number, number> }>; revPlaceholder?: Record<string, boolean>; year: number; onBack: () => void; onEdit: (o: OutletEntity) => void; onDelete: (o: OutletEntity) => void }) {
  const { profile: _profile } = useAuth()
  const labels = useCompanyLabels()
  const yearData: Record<number, number> = revenue[outlet.id] || {}

  // Corrispettivi sparkline (last 7 days for overview)
  type RecentDailyRow = { date: string; gross_revenue: number | null }
  const [recentDaily, setRecentDaily] = useState<RecentDailyRow[]>([])
  useEffect(() => {
    async function loadRecent() {
      const daysAgo = new Date()
      daysAgo.setDate(daysAgo.getDate() - 7)
      const { data } = await supabase
        .from('daily_revenue')
        .select('date, gross_revenue')
        .eq('outlet_id', outlet.id)
        .eq('company_id', outlet.company_id || '')
        .gte('date', daysAgo.toISOString().split('T')[0])
        .order('date', { ascending: true })
      setRecentDaily((data || []) as RecentDailyRow[])
    }
    loadRecent()
  }, [outlet.id, outlet.company_id])

  const chartData = MONTHS.map((name, i) => ({
    month: name,
    ricavi: yearData[i + 1] || 0,
  }))

  // ─── Grafico preventivo (rosso) vs consuntivo (verde), mese per mese ───
  // Preventivo = budget_confronto.rev_monthly; consuntivo = cons_monthly.
  // Per gli anni senza budget_confronto (fallback budget_entries) non c'è
  // preventivo: mostro il granito disponibile (yearData) come consuntivo.
  const conf = confronto[outlet.id] || { prev: {}, cons: {} }
  const confEmpty = Object.keys(conf.prev).length === 0 && Object.keys(conf.cons).length === 0
  const confrontoChart = MONTHS
    .map((name, i) => {
      const m = i + 1
      const preventivo = conf.prev[m] ?? null
      const consuntivo = conf.cons[m] ?? (confEmpty ? (yearData[m] ?? null) : null)
      return { month: name, preventivo, consuntivo }
    })
    // Mostra solo i mesi che hanno almeno un dato (gen→dic / dall'apertura).
    .filter(d => d.preventivo != null || d.consuntivo != null)
  const totPreventivo = confrontoChart.reduce((s, d) => s + (d.preventivo || 0), 0)
  const totConsuntivo = confrontoChart.reduce((s, d) => s + (d.consuntivo || 0), 0)

  const ytd = Object.values(yearData).reduce<number>((s, v) => s + (Number(v) || 0), 0)
  const avgMonth = Object.keys(yearData).length > 0 ? ytd / Object.keys(yearData).length : 0
  const bestMonth = Object.entries(yearData).reduce<{ month: number; value: number }>(
    (best, [m, v]) => Number(v) > best.value ? { month: parseInt(m), value: Number(v) } : best,
    { month: 0, value: 0 }
  )

  const rentAnnual = (Number(outlet.rent_monthly) || 0) * 12
  const condoAnnual = (Number(outlet.condo_marketing_monthly) || 0) * 12
  const occupancyCost = rentAnnual + condoAnnual
  // null (mostrato «—») quando non ci sono ricavi: un outlet in apertura non
  // deve leggere «0,0%» come se non pagasse l'affitto.
  const occupancyRatio = safePct(occupancyCost, ytd)
  const lifecycle = getOutletLifecycle(outlet as OutletLifecycleFields)
  const yesterdayRev = recentDaily.length > 0 ? recentDaily[recentDaily.length - 1]?.gross_revenue || 0 : null

  const DETAIL_TABS = [
    { key: 'overview', label: 'Overview', icon: Store },
    { key: 'corrispettivi', label: 'Corrispettivi', icon: DollarSign },
    { key: 'budget', label: 'Budget', icon: Target },
    { key: 'staff', label: 'Staff', icon: Users },
    { key: 'documenti', label: 'Documenti', icon: FileText },
  ]

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 transition text-slate-600" title="Torna indietro">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <TextTooltip content={formatOutletName(outlet.name)}><h2 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{formatOutletName(outlet.name)}</h2></TextTooltip>
            <StatusBadge outlet={outlet} isActive={outlet.is_active ?? undefined} />
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            {outlet.mall_name} — {outlet.code}
            {yesterdayRev != null && yesterdayRev > 0 && (
              <span className="text-emerald-600 font-medium ml-2">· Ieri: {fmt(yesterdayRev)} €</span>
            )}
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <button onClick={() => onEdit(outlet)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition text-slate-700">
            <FileText size={15} /> Modifica
          </button>
          <button onClick={() => onDelete(outlet)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-red-200 hover:bg-red-50 transition text-red-600">
            <Trash2 size={15} /> Elimina
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5 overflow-x-auto">
        {DETAIL_TABS.map(t => (
          <button key={t.key} onClick={() => setDetailTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition whitespace-nowrap ${
              detailTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Overview ─── */}
      {detailTab === 'overview' && (
        <div className="space-y-4">
          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-600 inline-flex mb-2"><DollarSign size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{ytd > 0 ? `${fmt(ytd)} €` : '—'}</div>
              <div className="text-xs text-slate-500">Ricavi {year}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600 inline-flex mb-2"><TrendingUp size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{Object.keys(yearData).length > 0 ? `${fmt(avgMonth)} €` : '—'}</div>
              <div className="text-xs text-slate-500">Media mensile</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 inline-flex mb-2"><Target size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{bestMonth.month > 0 ? MONTHS[bestMonth.month - 1] : '—'}</div>
              <div className="text-xs text-slate-500">Mese migliore ({fmt(bestMonth.value)} €)</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="p-2 rounded-lg bg-purple-50 text-purple-600 inline-flex mb-2"><Store size={18} /></div>
              <div className="text-xl font-bold text-slate-900">{occupancyRatio == null ? '—' : `${occupancyRatio.toFixed(1)}%`}</div>
              <div className="text-xs text-slate-500">Incidenza locazione ({fmt(occupancyCost)} €/a){occupancyRatio == null && lifecycle === 'programmato' ? ' · dall\'apertura' : ''}</div>
            </div>
          </div>

          {/* Outlet in pre-apertura: costi già in corso, ricavi dall'apertura */}
          <PreAperturaCard outlet={outlet} />

          {/* Corrispettivi sparkline — last 7 days */}
          {recentDaily.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-900">Incassi ultimi 7 giorni</h3>
                <button onClick={() => setDetailTab('corrispettivi')} className="text-xs text-blue-500 font-medium flex items-center gap-1 hover:text-blue-700">
                  Dettaglio <ChevronRight size={12} />
                </button>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <BarChart data={recentDaily.map(d => ({ ...d, label: new Date(d.date).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit' }) }))}>
                  <XAxis dataKey="label" {...AXIS_STYLE} />
                  <YAxis hide />
                  <Tooltip formatter={(v: unknown) => [`${fmt(Number(v) || 0)} €`, 'Incasso']} />
                  <Bar dataKey="gross_revenue" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Contract alerts */}
          <ContractAlerts outlet={outlet} />

          {/* Preventivo (rosso) vs Consuntivo (verde) — mese per mese */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Preventivo vs Consuntivo — {year}</h3>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-slate-500 inline-flex items-center">Preventivo: <span className="font-semibold text-rose-600 ml-1">{fmt(totPreventivo)} €</span><PlaceholderDot show={!!revPlaceholder?.[outlet.id]} tip={`Ricavi a budget di questo ${labels.pointOfSaleLower} ancora segnaposto (clone 2025) non granito in Budget & Controllo.`} /></span>
                <span className="text-slate-500">Consuntivo: <span className="font-semibold text-emerald-600">{fmt(totConsuntivo)} €</span></span>
              </div>
            </div>
            {revPlaceholder?.[outlet.id] && <PlaceholderLegend className="mb-2" />}
            {confrontoChart.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-10">
                Nessun dato di preventivo/consuntivo per il {year}.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={confrontoChart} barGap={2} barCategoryGap="22%">
                  <CartesianGrid {...GRID_STYLE} />
                  <XAxis dataKey="month" {...AXIS_STYLE} />
                  <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="preventivo" name="Preventivo" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="consuntivo" name="Consuntivo" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Anagrafica compatta */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Anagrafica</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Centro commerciale</span><span className="font-medium">{outlet.mall_name || '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Tipo</span><span className="font-medium">{(outlet.outlet_type as string | null) || '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Apertura</span><span className="font-medium">{outlet.opening_date ? new Date(String(outlet.opening_date)).toLocaleDateString('it-IT') : '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Superficie</span><span className="font-medium">{(outlet.sqm as string | number | null) || '—'} mq</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Canone mensile</span><span className="font-medium">{fmt(Number(outlet.rent_monthly) || 0, 2)} €</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Spese cond.</span><span className="font-medium">{fmt(Number(outlet.condo_marketing_monthly) || 0, 2)} €</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Concedente</span><span className="font-medium">{(outlet.concedente as string | null) || '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Decorrenza canone</span><span className="font-medium">{outlet.rent_start_date ? new Date(String(outlet.rent_start_date)).toLocaleDateString('it-IT') : '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Fideiussione</span><span className="font-medium">{Number(outlet.deposit_guarantee) > 0 ? `${fmt(Number(outlet.deposit_guarantee), 0)} €${outlet.guarantee_expiry ? ` · scade ${new Date(String(outlet.guarantee_expiry)).toLocaleDateString('it-IT')}` : ''}` : '—'}</span></div>
              <div className="flex justify-between py-1.5 border-b border-slate-50"><span className="text-slate-500">Caparra / acconto</span><span className="font-medium">{Number(outlet.deposit_amount) > 0 ? `${fmt(Number(outlet.deposit_amount), 0)} €` : '—'}</span></div>
            </div>
          </div>

          {/* Contratto registrato (tabella contracts) e prossime scadenze contrattuali */}
          <OutletContrattoCard outletId={outlet.id} companyId={outlet.company_id || ''} />

          {/* Extracted Contract Data */}
          <ExtractedContractData outlet={outlet} />
        </div>
      )}

      {/* ─── Tab: Corrispettivi ─── */}
      {detailTab === 'corrispettivi' && (
        <CorrispettiviTab outletId={outlet.id} companyId={outlet.company_id || ''} />
      )}

      {/* ─── Tab: Budget ─── */}
      {detailTab === 'budget' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Budget vs Consuntivo</h3>
          <p className="text-sm text-slate-500">
            Vai alla pagina <a href="/budget" className="text-blue-500 hover:underline">Budget & Controllo</a> per il dettaglio budget vs actual di questo {labels.pointOfSaleLower}.
          </p>
          {/* Revenue chart as proxy */}
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData}>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="month" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
                <Bar dataKey="ricavi" name="Ricavi (budget)" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── Tab: Staff ─── */}
      {detailTab === 'staff' && (
        <StaffTab outletId={outlet.id} outletName={String(outlet.name || '')} companyId={outlet.company_id || ''} />
      )}

      {/* ─── Tab: Documenti ─── */}
      {detailTab === 'documenti' && (
        <DocumentiNegozio outletId={outlet.id} companyId={outlet.company_id || ''} />
      )}
    </div>
  )
}

// ====== MAIN PAGE ======
export default function Outlet() {
  const { toast } = useToast()
  const { profile } = useAuth()
  const labels = useCompanyLabels()
  // Anno selezionato dal selettore globale (Layout → usePeriod, salvato in ?anno=).
  // Stessa fonte di verità di "Budget e Controllo": cambiando anno qui la pagina
  // si ricarica per lo stesso anno e i numeri coincidono con quella pagina.
  const { year } = usePeriod()
  const [loading, setLoading] = useState(true)
  // TODO: tighten type — Supabase rows
  const [outlets, setOutlets] = useState<OutletEntity[]>([])
  const [revenue, setRevenue] = useState<Record<string, Record<number, number>>>({})
  // Preventivo (rev_monthly) e consuntivo (cons_monthly) per outlet/mese, da
  // budget_confronto — usati dal grafico di dettaglio preventivo vs consuntivo.
  type ConfrontoMap = Record<string, { prev: Record<number, number>; cons: Record<number, number> }>
  const [confronto, setConfronto] = useState<ConfrontoMap>({})
  // Per outletId: true se i ricavi a budget contengono righe segnaposto (clone non granito).
  const [revPlaceholder, setRevPlaceholder] = useState<Record<string, boolean>>({})
  // Outlet selezionato pilotato dall'URL (/outlet/:outletId), così il dettaglio
  // ha una sua URL diretta e linkabile (es. dal ranking in Dashboard), invece di
  // essere solo stato interno sotto la pagina principale /outlet. L'identificatore
  // è risolto in ordine: id esatto → nome (case-insensitive) → code, per accettare
  // sia link per id (griglia) sia link per nome provenienti da altre pagine.
  // Nell'indirizzo va il nome leggibile (/outlet/roma-soratte): chi arriva con
  // l'id, il nome o il codice viene portato lì senza aggiungere un passo alla cronologia.
  const { outletId, scheda } = useParams()
  const navigate = useNavigate()
  const selectedOutlet: OutletEntity | null = trovaOutlet(outletId, outlets)
  const [search, setSearch] = useState('')
  const [showWizard, setShowWizard] = useState(false)
  const [showContractUploader, setShowContractUploader] = useState(false)
  // TODO: tighten type
  const [wizardInitialData, setWizardInitialData] = useState<any>(null)
  const [wizardAllegati, setWizardAllegati] = useState<any>(null)
  const [wizardContractFile, setWizardContractFile] = useState<any>(null)
  const [wizardUploadedFiles, setWizardUploadedFiles] = useState<any>(null)
  const [editOutlet, setEditOutlet] = useState<OutletEntity | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<OutletEntity | null>(null)
  const [deleting, setDeleting] = useState(false)
  // Il tab attivo è pilotato dall'URL (/outlet/operativi · /outlet/valutazione),
  // così cambio tab = cambio URL e refresh/back del browser lo mantengono.
  const location = useLocation()
  const tab = location.pathname.startsWith('/outlet/valutazione') ? 'valutazione' : 'operativi'
  const goTab = (key: string) => navigate(key === 'valutazione' ? '/outlet/valutazione' : '/outlet/operativi')
  const segmentoGiusto = selectedOutlet ? segmentoOutlet(selectedOutlet, outlets) : null
  // Anche la sezione della scheda sta nell'indirizzo (/outlet/roma-soratte/documenti):
  // si può aprire direttamente, e ricaricando la pagina si resta dove si era.
  // La prima sezione (overview) non ha suffisso; un suffisso sconosciuto torna lì.
  const schedaAttiva = SCHEDE_OUTLET.includes(scheda || '') ? String(scheda) : 'overview'
  const percorsoScheda = (segmento: string, key: string) => `/outlet/${segmento}${key === 'overview' ? '' : `/${key}`}`
  useEffect(() => {
    if (!segmentoGiusto || !outletId) return
    const giusto = percorsoScheda(segmentoGiusto, schedaAttiva)
    const attuale = percorsoScheda(outletId, scheda || 'overview')
    if (giusto === attuale) return
    navigate({ pathname: giusto, search: location.search, hash: location.hash }, { replace: true })
  }, [segmentoGiusto, outletId, scheda, schedaAttiva])
  const canWrite = profile?.role === 'super_advisor'

  // Ricarica i ricavi ad ogni cambio anno (selettore globale) o di azienda.
  useEffect(() => { loadData() }, [profile?.company_id, year])

  async function loadData() {
    setLoading(true)
    try {
      if (!profile?.company_id) return
      const companyId = profile.company_id
      // Carica outlets
      const { data: outData, error: outErr } = await supabase
        .from('outlets')
        .select('*')
        .eq('company_id', companyId)
        .order('name')

      if (outErr) {
        console.error('Outlets error:', outErr)
      } else {
        setOutlets((outData || []) as OutletEntity[])
      }

      // ─── Ricavi per outlet ──────────────────────────────────────────────
      // Il ricavo mostrato è il CONSUNTIVO GRANITICO (mesi chiusi reali) che
      // Lilian gestisce in budget_confronto.cons_monthly. Per gli anni senza
      // budget_confronto (es. 2025, chiuso) si ripiega su budget_entries.
      // Classificazione ricavo SEMPRE via join account_code →
      // chart_of_accounts.is_revenue (mai via macro_group, che nel 2026 vale
      // 'CE' su tutte le righe). Importi letti per mese così come stanno nel DB:
      // nessuna divisione per 12, nessuna spalmatura lato frontend.
      // Quali cost_center sono punti vendita lo decide cost_centers.role
      // (fonte di verità, come BudgetControl — Sprint 3 29/05/2026): solo
      // role='outlet'. Così hq (sede_magazzino), non_operational
      // (spese_non_divise), rettifica e qualsiasi bucket non-outlet restano
      // automaticamente fuori da card e totale, senza liste hardcoded.

      // Mappa code/nome cost_center → outlet id. I code dei cost_center
      // role='outlet' coincidono col nome outlet in minuscolo (valdichiana…);
      // codeToId resta come fallback.
      const codeToId: Record<string, string> = {}
      const nameToId: Record<string, string> = {}
      ;(outData || []).forEach(o => {
        if (o.code) codeToId[o.code] = o.id
        nameToId[(o.name || '').toLowerCase()] = o.id
      })

      // 0) Cost center che sono punti vendita (cost_centers.role = 'outlet').
      // select('*') + cast come BudgetControl: la colonna `role` non è ancora
      // nei tipi DB generati (aggiunta Sprint 3, tipi non rigenerati).
      const { data: ccData, error: ccErr } = await supabase
        .from('cost_centers')
        .select('*')
        .eq('company_id', companyId)
        .eq('is_active', true)
      if (ccErr) console.error('cost_centers error:', ccErr)
      const outletCostCenters = new Set(
        ((ccData || []) as Array<{ code?: string | null; role?: string | null }>)
          .filter(c => c.role === 'outlet')
          .map(c => c.code)
          .filter((code): code is string => !!code)
      )

      // 1) Codici conto che sono RICAVI (piano dei conti dell'azienda)
      const { data: coaData, error: coaErr } = await supabase
        .from('chart_of_accounts')
        .select('code')
        .eq('company_id', companyId)
        .eq('is_active', true)
        .eq('is_revenue', true)
      if (coaErr) console.error('chart_of_accounts error:', coaErr)
      const revenueCodes = new Set((coaData || []).map(c => c.code))

      // Match cost_center → outlet: nome in minuscolo, code come fallback
      const matchOutletId = (cc: string): string | undefined =>
        nameToId[cc.toLowerCase()] || codeToId[cc]

      // 2) Preventivo/consuntivo da budget_confronto (la fonte che gestisce
      //    Lilian). rev_monthly = preventivo rivisto; cons_monthly = consuntivo
      //    GRANITICO (mesi chiusi reali). Solo conti is_revenue e cost_center
      //    role='outlet'.
      const { data: confData, error: confErr } = await supabase
        .from('budget_confronto')
        .select('cost_center, account_code, month, entry_type, amount')
        .eq('company_id', companyId)
        .eq('year', year)
        .in('entry_type', ['rev_monthly', 'cons_monthly'])
        .range(0, 9999)
      if (confErr) console.error('budget_confronto error:', confErr)

      const confronto: ConfrontoMap = {}
      let hasConsuntivo = false
      ;((confData || []) as Array<{ cost_center?: string | null; account_code?: string | null; month?: number | null; entry_type?: string | null; amount?: number | null }>).forEach(r => {
        const cc = r.cost_center || ''
        if (!outletCostCenters.has(cc)) return
        if (!r.account_code || !revenueCodes.has(r.account_code)) return
        const outletId = matchOutletId(cc)
        if (!outletId) return
        const m = r.month ?? 0
        if (m < 1) return
        const amt = Number(r.amount) || 0
        if (!confronto[outletId]) confronto[outletId] = { prev: {}, cons: {} }
        if (r.entry_type === 'rev_monthly') {
          confronto[outletId].prev[m] = (confronto[outletId].prev[m] || 0) + amt
        } else if (r.entry_type === 'cons_monthly') {
          confronto[outletId].cons[m] = (confronto[outletId].cons[m] || 0) + amt
          hasConsuntivo = true
        }
      })
      setConfronto(confronto)

      // 3) budget_entries dell'anno — fallback per anni senza budget_confronto
      const { data: budgetData, error: budgetErr } = await supabase
        .from('budget_entries')
        .select('cost_center, month, budget_amount, account_code, is_placeholder')
        .eq('company_id', companyId)
        .eq('year', year)
        .range(0, 9999) // override default Supabase limit 1000 — piano dei conti completo (~1212 righe/anno)
      if (budgetErr) console.error('budget_entries error:', budgetErr)

      // Marcatore segnaposto: per outlet, true se i RICAVI a budget (budget_entries
      // con is_revenue) contengono righe is_placeholder=true (clone 2025 non granito).
      type BERowOut = { cost_center?: string | null; account_code?: string | null; budget_amount?: number | null; month?: number | null; is_placeholder?: boolean | null }
      const budgetRows = (budgetData || []) as unknown as BERowOut[]
      const revPh: Record<string, boolean> = {}
      budgetRows.forEach(r => {
        if (r.is_placeholder !== true) return
        if (!r.account_code || !revenueCodes.has(r.account_code)) return
        const oid = matchOutletId(r.cost_center || '')
        if (oid) revPh[oid] = true
      })
      setRevPlaceholder(revPh)

      // Ricavo card per outlet/mese:
      //  - anni con budget_confronto → CONSUNTIVO GRANITICO (cons_monthly)
      //  - anni senza (es. 2025, chiuso) → fallback budget_entries.budget_amount
      const grouped: Record<string, Record<number, number>> = {}
      if (hasConsuntivo) {
        for (const [oid, c] of Object.entries(confronto)) {
          for (const [m, v] of Object.entries(c.cons)) {
            if (!v) continue
            if (!grouped[oid]) grouped[oid] = {}
            grouped[oid][Number(m)] = v
          }
        }
      } else {
        budgetRows.forEach(r => {
          const cc = r.cost_center || ''
          if (!outletCostCenters.has(cc)) return
          if (!r.account_code || !revenueCodes.has(r.account_code)) return
          const outletId = matchOutletId(cc)
          if (!outletId) return
          const amount = Number(r.budget_amount) || 0
          if (amount === 0) return
          if (!grouped[outletId]) grouped[outletId] = {}
          const m = r.month ?? 0
          grouped[outletId][m] = (grouped[outletId][m] || 0) + amount
        })
      }
      setRevenue(grouped)
    } catch (err) {
      console.error('Errore caricamento dati:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleEdit(outletIn: OutletEntity) {
    const o = outletIn as Record<string, unknown>
    const str = (k: string) => String(o[k] || '')
    const num = (k: string) => o[k] != null ? String(o[k]) : ''
    const formData = {
      name: str('name'), code: str('code'), brand: str('brand'),
      outlet_type: str('outlet_type') || 'outlet',
      sqm: num('sqm'), sell_sqm: num('sell_sqm'),
      unit_code: str('unit_code'),
      mall_name: str('mall_name'), concedente: str('concedente'),
      address: str('address'), city: str('city'),
      province: str('province'), region: str('region'),
      delivery_date: str('delivery_date'), opening_date: str('opening_date'),
      opening_confirmed: Boolean(o.opening_confirmed),
      contract_start: str('contract_start'), contract_end: str('contract_end'),
      contract_duration_months: num('contract_duration_months'),
      contract_min_months: num('contract_min_months'),
      rent_free_days: num('rent_free_days'),
      exit_clause_month: num('exit_clause_month'),
      rent_annual: num('rent_annual'),
      rent_monthly: num('rent_monthly'),
      rent_per_sqm: num('rent_per_sqm'),
      variable_rent_pct: num('variable_rent_pct'),
      rent_year2_annual: num('rent_year2_annual'),
      rent_year3_annual: num('rent_year3_annual'),
      condo_marketing_monthly: num('condo_marketing_monthly'),
      staff_budget_monthly: num('staff_budget_monthly'),
      deposit_guarantee: num('deposit_guarantee'),
      guarantee_expiry: str('guarantee_expiry'),
      deposit_amount: num('deposit_amount'),
      rent_start_date: str('rent_start_date'),
      landlord_supplier_id: str('landlord_supplier_id'),
      cost_center_key: str('cost_center_key'),
      advance_payment: num('advance_payment'),
      setup_cost: num('setup_cost'),
      target_margin_pct: num('target_margin_pct') || '60',
      target_cogs_pct: num('target_cogs_pct') || '40',
      exit_revenue_threshold: num('exit_revenue_threshold') || num('min_revenue_target'),
      min_revenue_period: str('min_revenue_period'),
      notes: str('notes'),
    }
    setEditOutlet(outletIn)
    setWizardInitialData(formData)
    setWizardAllegati(null)
    setWizardContractFile(null)
    setWizardUploadedFiles(null)
    setShowWizard(true)
  }

  async function handleDelete(outlet: OutletEntity) {
    setShowDeleteConfirm(outlet)
  }

  async function confirmDelete() {
    if (!showDeleteConfirm) return
    setDeleting(true)
    const outletId = showDeleteConfirm.id

    const { error: attErr } = await supabase.from('outlet_attachments').delete().eq('outlet_id', outletId)
    if (attErr) console.warn('Allegati delete warning:', attErr)

    await supabase.from('employees').update({ outlet_id: null }).eq('outlet_id', outletId)

    const { data: delData, error: err } = await supabase
      .from('outlets')
      .delete()
      .eq('id', outletId)
      .select()

    if (err) {
      console.error('Delete error:', err)
      toast({ type: 'error', message: 'Errore eliminazione: ' + err.message })
      setDeleting(false)
      setShowDeleteConfirm(null)
      return
    }

    if (!delData || delData.length === 0) {
      toast({ type: 'error', message: `Non e' stato possibile eliminare ${labels.art.il}. Potrebbe essere un problema di permessi (RLS).` })
      setDeleting(false)
      setShowDeleteConfirm(null)
      return
    }

    navigate('/outlet')
    setShowDeleteConfirm(null)
    setDeleting(false)
    loadData()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  const filtered = outlets.filter(o =>
    !search ||
    (o.name || '').toLowerCase().includes(search.toLowerCase()) ||
    o.code?.toLowerCase().includes(search.toLowerCase()) ||
    o.mall_name?.toLowerCase().includes(search.toLowerCase())
  )

  const totalRevenue = Object.values(revenue).reduce(
    (sum, outletRev) => sum + Object.values(outletRev).reduce((s, v) => s + v, 0), 0
  )

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* ── Tab bar (hide when viewing outlet detail) ── */}
      {!selectedOutlet && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {[
            { key: 'operativi', label: `${labels.pointOfSalePlural} operativi` },
            { key: 'valutazione', label: `${labels.pointOfSalePlural} in valutazione` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => goTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition ${
                tab === t.key
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab: Outlet in valutazione ── */}
      {tab === 'valutazione' && !selectedOutlet && (
        <OutletValutazione />
      )}

      {/* ── Tab: Outlet operativi ── */}
      {(tab === 'operativi' || selectedOutlet) && (
        <>
          {selectedOutlet ? (
            <OutletDetail
              outlet={selectedOutlet}
              revenue={revenue}
              confronto={confronto}
              revPlaceholder={revPlaceholder}
              year={year}
              detailTab={schedaAttiva}
              setDetailTab={(key) => navigate(percorsoScheda(segmentoGiusto || selectedOutlet.id, key))}
              onBack={() => navigate('/outlet')}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ) : (
            <>
              <PageHeader
                title={labels.pointOfSalePlural}
                subtitle={`${outlets.length} ${labels.pointOfSalePluralLower} — Ricavi catena ${year}: ${fmt(totalRevenue)} €`}
                noDivider
                actions={
                  <>
                    <button
                      onClick={loadData}
                      className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-white transition"
                    >
                      <RefreshCw size={16} />
                      Aggiorna
                    </button>
                    {canWrite && (
                      <>
                        <button
                          onClick={() => setShowContractUploader(true)}
                          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition"
                        >
                          <Upload size={16} />
                          Crea da contratto
                        </button>
                        <button
                          onClick={() => { setWizardInitialData(null); setWizardAllegati(null); setShowWizard(true) }}
                          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                        >
                          <Plus size={16} />
                          Nuovo {labels.pointOfSaleLower}
                        </button>
                      </>
                    )}
                  </>
                }
              />

              <div className="relative">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Cerca per nome, codice o centro commerciale..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
              </div>

              {filtered.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <Store size={40} className="mx-auto mb-3 opacity-50" />
                  <p className="text-sm">{search ? `Nessun ${labels.pointOfSaleLower} trovato per la ricerca.` : `Nessun ${labels.pointOfSaleLower} disponibile.`}</p>
                  {!search && outlets.length === 0 && (
                    <p className="text-xs mt-1">Verifica le policy RLS e i permessi del tuo utente.</p>
                  )}
                </div>
              ) : (
                <OutletGrid
                  outlets={filtered}
                  revenue={revenue}
                  year={year}
                  onSelect={(o) => navigate(`/outlet/${segmentoOutlet(o, outlets)}`)}
                />
              )}
            </>
          )}
        </>
      )}

      {showContractUploader && (
        <ContractUploader
          onCancel={() => setShowContractUploader(false)}
          onDataExtracted={(data, allegati, fileName, uploadedFiles) => {
            setShowContractUploader(false)
            setWizardInitialData(data)
            setWizardAllegati(allegati)
            setWizardContractFile(fileName)
            setWizardUploadedFiles(uploadedFiles || {})
            setShowWizard(true)
          }}
        />
      )}

      {showWizard && (
        <OutletWizard
          onClose={() => { setShowWizard(false); setWizardInitialData(null); setWizardAllegati(null); setWizardUploadedFiles(null); setEditOutlet(null) }}
          onSaved={() => { setShowWizard(false); setWizardInitialData(null); setWizardAllegati(null); setWizardUploadedFiles(null); setEditOutlet(null); navigate('/outlet'); loadData() }}
          initialData={wizardInitialData}
          allegati={wizardAllegati}
          contractFileName={wizardContractFile}
          uploadedFiles={wizardUploadedFiles}
          editId={editOutlet?.id || null}
        />
      )}

      {showDeleteConfirm && (
        <Modal open onClose={() => setShowDeleteConfirm(null)} bare ariaLabel="Conferma eliminazione"
          containerClassName="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          panelClassName="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-full bg-red-50">
                <Trash2 size={22} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Elimina {labels.pointOfSaleLower}</h3>
                <p className="text-sm text-slate-500">Questa azione non puo' essere annullata</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 mb-6">
              Sei sicuro di voler eliminare <strong>{formatOutletName(showDeleteConfirm.name)}</strong> ({showDeleteConfirm.code})?
              Verranno eliminati anche tutti gli allegati collegati.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition"
              >
                Annulla
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
              >
                {deleting ? 'Eliminazione...' : `Elimina ${labels.pointOfSaleLower}`}
              </button>
            </div>
        </Modal>
      )}
      </div>
    </div>
  )
}
