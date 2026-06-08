import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

// Vista ConfrontoOutlet — persistita in URL come ?view=
type ConfrontoView = 'budget' | 'actual' | 'variance'
const VALID_CONFRONTO_VIEWS: ConfrontoView[] = ['budget', 'actual', 'variance']
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { usePeriod } from '../hooks/usePeriod'
import { useCompanyLabels } from '../hooks/useCompanyLabels'
import ExportMenu from '../components/ExportMenu'
import PageHeader from '../components/PageHeader'
import {
  Store, TrendingUp, Users, DollarSign, RefreshCw, ChevronDown, ChevronUp,
  ArrowUpRight, ArrowDownRight, BarChart3, Target, Percent, Building2, AlertCircle,
  Download, CheckCircle2, Filter, Calendar
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts'
import { GlassTooltip, ChartGradients, AXIS_STYLE, GRID_STYLE, BAR_RADIUS, ModernLegend, fmtEuro, fmtK } from '../components/ChartTheme'
import { formatOutletName, shortOutletName } from '../lib/formatters'
import {
  RICAVI_SOURCE_LABEL, buildOutletRevenue, outletRevenueMetrics,
  aggregateCostsByMacro, orderedCostCategories, sedeQuota,
  type OutletConfrontoMap, type Provenance, type ConfrontoRow,
  type CoaMeta, type CostCategory,
} from '../lib/outletRevenue'

function fmt(n: number | null | undefined, dec = 0): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

// Scostamento con segno contabile: '-X €' se negativo (rosso a cura del chiamante),
// '+X €' se positivo/zero. Niente colore "verde=buono".
function scostamentoSegno(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n < 0 ? '-' : '+'}${fmt(Math.abs(n))} €`
}

/* ═══════════════════════════════════════
   KPI Badge small
   ═══════════════════════════════════════ */
type BadgeColor = 'blue' | 'green' | 'amber' | 'purple' | 'red'
function KpiBadge({ label, value, sub, color = 'blue' }: { label: string; value: string | number; sub?: string; color?: BadgeColor }) {
  const colors: Record<BadgeColor, string> = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    purple: 'bg-purple-50 text-purple-600 border-purple-100',
    red: 'bg-red-50 text-red-600 border-red-100',
  }
  return (
    <div className={`rounded-lg border p-3 ${colors[color]}`}>
      <div className="text-xs font-medium opacity-80">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      {sub && <div className="text-xs opacity-60">{sub}</div>}
    </div>
  )
}

/* ═══════════════════════════════════════
   CARD OUTLET — Singola colonna confronto
   ═══════════════════════════════════════ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CalcMetricsT = any
function OutletCard({ name, outletData, calculatedMetrics, ranking, onNavigate, onOpenBudget }: {
  name: string
  outletData: { color?: string | null }
  calculatedMetrics: CalcMetricsT | null | undefined
  ranking?: number | null
  onNavigate: () => void
  onOpenBudget: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!calculatedMetrics) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-100" style={{ borderTopWidth: 4, borderTopColor: '#9ca3af' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store size={18} style={{ color: '#9ca3af' }} />
              <div className="font-bold text-slate-900 text-sm">{shortOutletName(name)}</div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500 border border-dashed border-slate-300">
              Nessun dato
            </span>
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{formatOutletName(name)}</div>
        </div>
        <div className="px-4 py-6 text-center">
          <AlertCircle size={24} className="text-slate-300 mx-auto mb-2" />
          <div className="text-sm text-slate-400">Carica i dati dal Budget o dal Bilancio per visualizzare il confronto</div>
        </div>
      </div>
    )
  }

  const { ricavi, margine, marginePct, costoPersonale, affitto, servizi, personaleCount,
    ricavoPerDip, incidenzaPersonale, incidenzaAffitto, breakeven, merci, costiDiretti, costiTotali,
    costiCategorie, isVariance, scostamento, scostamentoPct, mesiPresi, mesiTotali, mediaMensile, provenance,
    quotaSedePro, margineFinale } = calculatedMetrics

  // I1 — badge provenienza dato. Nel caso "misto" il testo dettaglia i mesi:
  // "{mesi reali (consuntivo)} reali + {mesi previsti} previsti" (dai dati, no hardcoded).
  const nReali = mesiPresi || 0
  const nPrev = Math.max(0, (mesiTotali || 0) - nReali)
  const provBadge: Record<Provenance, { label: string; cls: string }> = {
    granitico: { label: 'Granitico', cls: 'bg-emerald-100 text-emerald-700' },
    misto: { label: `${nReali} reali + ${nPrev} previsti`, cls: 'bg-amber-100 text-amber-700' },
    preventivo: { label: 'Preventivo', cls: 'bg-slate-100 text-slate-500' },
  }
  const prov = provBadge[(provenance as Provenance) || 'preventivo']

  const isPositive = margine >= 0
  // null = non calcolabile (0 dipendenti). La UI mostra 'N/D'. Prima
  // ritornava 0 ma costi/ricavi per dipendente con 0 dipendenti non
  // hanno senso di essere '0 €' — sono indeterminati.
  const costoPerDip = personaleCount > 0 ? costoPersonale / personaleCount : null

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden flex flex-col border-slate-200`}>
      {/* Header con colore outlet */}
      <div className="p-4 border-b border-slate-100" style={{ borderTopWidth: 4, borderTopColor: outletData.color || '#6366f1' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Store size={18} style={{ color: outletData.color || '#6366f1' }} />
            <button onClick={onNavigate} className="font-bold text-slate-900 text-sm hover:text-indigo-600 transition cursor-pointer text-left">
              {shortOutletName(name)}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${prov.cls}`} title="Provenienza ricavi (budget_confronto)">
              {prov.label}
            </span>
            {ranking && (
              ranking <= 3 ? (
                <span className="text-base leading-none" title="Posizione per fatturato" aria-label={`Posizione ${ranking} per fatturato`}>
                  {ranking === 1 ? '🥇' : ranking === 2 ? '🥈' : '🥉'}
                </span>
              ) : (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-slate-50 text-slate-400" title="Posizione per fatturato">
                  #{ranking}
                </span>
              )
            )}
          </div>
        </div>
        <div className="text-xs text-slate-400 mt-0.5">{formatOutletName(name)}</div>
      </div>

      {/* Ricavi - Hero KPI + scostamento */}
      <div className="px-4 pt-4 pb-2">
        {/* In modalità Scostamento il valore hero È già lo scostamento sui mesi
            presi (consuntivo − preventivo): convenzione contabile (nero se ≥0,
            rosso col meno se <0), niente verde. */}
        <div className="text-xs text-slate-400">{isVariance ? 'Δ Ricavi (Cons. − Prev., mesi presi)' : RICAVI_SOURCE_LABEL}</div>
        <div className={`text-2xl font-bold ${isVariance ? (ricavi < 0 ? 'text-red-600' : 'text-slate-900') : 'text-slate-900'}`}>
          {isVariance ? scostamentoSegno(scostamento) : `${fmt(ricavi)} €`}
        </div>
        {/* I4 — media mensile (consuntivo ÷ mesi presi): normalizza aperture diverse. */}
        {!isVariance && (
          <div className="text-xs text-slate-400 mt-0.5">
            {mesiPresi > 0
              ? <>Media mensile: <span className="font-medium text-slate-600">{fmt(mediaMensile)} €</span> · {mesiPresi} mes{mesiPresi === 1 ? 'e' : 'i'} presi</>
              : 'Nessun mese consuntivato'}
          </div>
        )}
        {/* I2/R1 — scostamento sui mesi presi (consuntivo − preventivo), € e %,
            segno contabile (rosso col meno se sotto, nero se sopra), niente verde. */}
        {!isVariance && mesiPresi > 0 && (
          <div className="text-xs font-medium mt-0.5 text-slate-700">
            Scostamento: <span className={scostamento < 0 ? 'text-red-600' : 'text-slate-900'}>
              {scostamentoSegno(scostamento)} ({scostamento < 0 ? '' : '+'}{scostamentoPct.toFixed(1)}%)
            </span> <span className="text-slate-400">vs preventivo (stessi mesi)</span>
          </div>
        )}
        {calculatedMetrics.approvalPct > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <CheckCircle2 size={10} className={calculatedMetrics.approvalPct >= 100 ? 'text-emerald-500' : 'text-amber-400'} />
            <span className="text-xs text-slate-400">Approvato: {calculatedMetrics.approvalPct}%</span>
          </div>
        )}
        {/* I3 — apri questo outlet in Budget & Controllo, già filtrato. */}
        <button
          onClick={onOpenBudget}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition"
        >
          <ArrowUpRight size={12} /> Apri in Budget &amp; Controllo
        </button>
      </div>

      {/* KPI Grid — in variance i delta sono colorati per significato:
          ricavi/margini: positivo=verde (meglio); costi: positivo=rosso (peggio).
          Il prefisso '+' viene aggiunto ai delta positivi per leggibilità. */}
      <div className="px-4 py-3 grid grid-cols-2 gap-2">
        <KpiBadge
          label={isVariance ? 'Δ Margine' : 'Margine'}
          value={`${isVariance && margine > 0 ? '+' : ''}${fmt(margine)} €`}
          sub={`${isVariance && marginePct > 0 ? '+' : ''}${marginePct.toFixed(1)}${isVariance ? ' p.p.' : '%'}`}
          color={margine >= 0 ? 'green' : 'red'} />
        <KpiBadge label="Dipendenti" value={personaleCount || 0}
          sub={ricavoPerDip != null ? `${isVariance && ricavoPerDip > 0 ? '+' : ''}${fmt(ricavoPerDip)} €/dip` : 'N/D'} color="blue" />
        <KpiBadge
          label={isVariance ? 'Δ Costo personale' : 'Costo personale'}
          value={`${isVariance && costoPersonale > 0 ? '+' : ''}${fmt(costoPersonale)} €`}
          sub={`${isVariance && incidenzaPersonale > 0 ? '+' : ''}${incidenzaPersonale.toFixed(1)}${isVariance ? ' p.p.' : '% ricavi'}`}
          color={isVariance ? (costoPersonale > 0 ? 'red' : costoPersonale < 0 ? 'green' : 'amber') : 'amber'} />
        <KpiBadge
          label={isVariance ? 'Δ Affitto' : 'Affitto'}
          value={`${isVariance && affitto > 0 ? '+' : ''}${fmt(affitto)} €`}
          sub={`${isVariance && incidenzaAffitto > 0 ? '+' : ''}${incidenzaAffitto.toFixed(1)}${isVariance ? ' p.p.' : '% ricavi'}`}
          color={isVariance ? (affitto > 0 ? 'red' : affitto < 0 ? 'green' : 'purple') : 'purple'} />
      </div>

      {/* Margine outlet → quota sede → margine dopo sede (sempre visibile) */}
      {!isVariance && quotaSedePro != null && (
        <div className="px-4 pb-1 space-y-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Margine outlet</span>
            <span className={`font-medium ${margine < 0 ? 'text-red-600' : 'text-slate-900'}`}>{fmt(margine)} €</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Quota sede</span>
            <span className={`font-medium ${quotaSedePro > 0 ? 'text-red-600' : 'text-slate-900'}`}>{quotaSedePro > 0 ? '-' : ''}{fmt(Math.abs(quotaSedePro))} €</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-slate-100">
            <span className="font-semibold text-slate-700">Margine dopo sede</span>
            <span className={`font-bold ${(margineFinale ?? 0) < 0 ? 'text-red-600' : 'text-slate-900'}`}>{fmt(margineFinale ?? 0)} €</span>
          </div>
        </div>
      )}

      {/* Dettaglio costi espandibile */}
      <div className="px-4 pb-3">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition w-full justify-center py-1"
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {open ? 'Nascondi dettaglio' : 'Mostra dettaglio'}
        </button>
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-1.5 text-sm bg-slate-50/30">
          {[
            // Ricavi in testa, poi UNA riga per categoria di costo nell'ordine di
            // bilancio (sort_order), classificate via chart_of_accounts.macro_group.
            { label: `${RICAVI_SOURCE_LABEL}`, val: ricavi, pct: 100, bold: true },
            ...((costiCategorie || []) as CostCategory[]).map(c => ({
              label: c.ceSection ? `${c.ceSection} ${c.label}` : c.label,
              val: -c.value,
              pct: -(c.value / (ricavi || 1) * 100),
              bold: false,
            })),
          ].map(r => (
            <div key={r.label} className={`flex items-center justify-between ${r.bold ? 'font-semibold text-slate-900 pb-1 border-b border-slate-100' : 'text-slate-600'}`}>
              <span>{r.label}</span>
              <div className="text-right">
                <span className={`font-medium ${r.val < 0 ? 'text-red-600' : r.bold ? 'text-slate-900' : 'text-slate-600'}`}>
                  {r.val < 0 ? '-' : ''}{fmt(Math.abs(r.val))} €
                </span>
                {r.pct !== null && !r.bold && (
                  <span className="text-xs text-slate-400 ml-1">({Math.abs(r.pct).toFixed(1)}%)</span>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200 font-semibold">
            <span className="text-slate-900">Margine outlet</span>
            <span className={isPositive ? 'text-slate-900' : 'text-red-600'}>
              {fmt(margine)} € ({marginePct.toFixed(1)}%)
            </span>
          </div>
          {/* Quota sede (pro-quota sul fatturato, netta dei ricavi sede) e
              margine dopo sede. Nascosti in modalità Scostamento. */}
          {!isVariance && quotaSedePro != null && (
            <>
              <div className="flex items-center justify-between text-slate-600">
                <span>Quota sede</span>
                <span className={quotaSedePro > 0 ? 'text-red-600 font-medium' : 'text-slate-900 font-medium'}>
                  {quotaSedePro > 0 ? '-' : ''}{fmt(Math.abs(quotaSedePro))} €
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 font-bold">
                <span className="text-slate-900">Margine dopo sede</span>
                <span className={(margineFinale ?? 0) < 0 ? 'text-red-600' : 'text-slate-900'}>
                  {fmt(margineFinale ?? 0)} €
                  {ricavi > 0 && ` (${(((margineFinale ?? 0) / ricavi) * 100).toFixed(1)}%)`}
                </span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
            <span>Costo medio per dipendente</span>
            <span>{costoPerDip != null ? `${fmt(costoPerDip)} €/anno` : 'N/D'}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Ricavo per dipendente</span>
            <span className="font-medium text-blue-600">{ricavoPerDip != null ? `${fmt(ricavoPerDip)} €/anno` : 'N/D'}</span>
          </div>
          {/* breakeven nascosto: incoerente col margine, da rivedere
              (lo schema costi fissi/variabili + quota sede non si riconcilia col
              margine reale ricavi − costi totali). Logica lasciata nel codice. */}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════
   TABELLA BENCHMARK COMPARATIVA
   ═══════════════════════════════════════ */
type CalculatedMetrics = {
  ricavi: number
  margine: number
  marginePct: number
  costoPersonale: number
  affitto: number
  servizi: number
  merci: number
  costiDiretti: number
  costiTotali: number
  costiCategorie: CostCategory[]
  quotaSedePro?: number
  margineFinale?: number
  personaleCount: number
  ricavoPerDip: number | null
  incidenzaPersonale: number
  incidenzaAffitto: number
  breakeven: number
  quotaSede: number
  variance: { ricavi: number; margine: number; ricaviPct: number }
  approvalPct: number
  budgetRicavi: number
  actualRicavi: number
  isVariance: boolean
  outletCode: string
  scostamento: number
  scostamentoPct: number
  mesiPresi: number
  mesiTotali: number
  mediaMensile: number
  provenance: Provenance
}
type OutletDataLite = {
  id?: string
  code?: string
  label?: string
  name?: string
  color?: string
}
type OutletMetric = {
  name: string
  outletData: OutletDataLite
  calculatedMetrics: CalculatedMetrics | null
}

function TabellaBenchmark({ outletMetrics }: { outletMetrics: OutletMetric[] }) {
  if (!outletMetrics || outletMetrics.length === 0) return null

  const rows = outletMetrics
    .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
    .sort((a, b) => b.calculatedMetrics.ricavi - a.calculatedMetrics.ricavi)

  const isVariance = rows[0]?.calculatedMetrics?.isVariance || false

  type MetricBest = 'max' | 'min' | null
  type MetricRow = { label: string; key: string; fn: (r: typeof rows[number]) => number; best: MetricBest; pct?: boolean }
  // In variance le metriche di costo sono "delta": un delta positivo significa
  // costo aumentato (peggio), un delta negativo significa costo diminuito (meglio).
  // Per i ricavi/margini è il contrario: positivo è meglio.
  const metrics: MetricRow[] = [
    { label: isVariance ? 'Δ Ricavi' : 'Ricavi', key: 'ricavi', fn: r => r.calculatedMetrics.ricavi || 0, best: 'max' },
    { label: isVariance ? 'Δ Margine €' : 'Margine €', key: 'margine', fn: r => r.calculatedMetrics.margine || 0, best: 'max' },
    { label: isVariance ? 'Δ Margine %' : 'Margine %', key: 'marginePct', fn: r => r.calculatedMetrics.marginePct || 0, best: 'max', pct: true },
    { label: 'Dipendenti', key: 'ndip', fn: r => r.calculatedMetrics.personaleCount || 0, best: null },
    { label: isVariance ? 'Δ €/Dipendente' : '€/Dipendente', key: 'ricPerDip', fn: r => r.calculatedMetrics.ricavoPerDip || 0, best: 'max' },
    { label: isVariance ? 'Δ Costo personale' : 'Costo personale', key: 'costoPers', fn: r => r.calculatedMetrics.costoPersonale || 0, best: 'min' },
    { label: isVariance ? 'Δ Affitto' : 'Affitto', key: 'affitto', fn: r => r.calculatedMetrics.affitto || 0, best: 'min' },
    { label: isVariance ? 'Δ Inc. personale %' : 'Inc. personale %', key: 'incPers', fn: r => r.calculatedMetrics.incidenzaPersonale || 0, best: 'min', pct: true },
    { label: isVariance ? 'Δ Inc. affitto %' : 'Inc. affitto %', key: 'incAff', fn: r => r.calculatedMetrics.incidenzaAffitto || 0, best: 'min', pct: true },
    // breakeven nascosto: incoerente col margine, da rivedere (metrica rimossa dal benchmark).
  ]

  return (
    <div className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
        <Target size={18} className="text-blue-600" />
        <h3 className="font-semibold text-slate-900">Benchmark comparativo</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr className="text-xs text-slate-500 uppercase tracking-wider">
              <th className="py-2.5 px-4 text-left font-medium sticky left-0 bg-slate-50 z-10">Metrica</th>
              {rows.map(r => (
                <th key={r.name} className="py-2.5 px-4 text-right font-medium whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: r.outletData?.color || '#6366f1' }} />
                  {shortOutletName(r.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map(m => {
              const values = rows.map(r => m.fn(r))
              const bestVal = m.best === 'max' ? Math.max(...values) : m.best === 'min' ? Math.min(...values) : null
              return (
                <tr key={m.key} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2.5 px-4 text-sm font-medium text-slate-700 sticky left-0 bg-white z-10">{m.label}</td>
                  {rows.map((r, i) => {
                    const val = values[i]
                    const isBest = bestVal !== null && Math.abs(val - bestVal) < 0.01
                    return (
                      <td key={r.name} className={`py-2.5 px-4 text-sm text-right font-medium ${
                        isBest ? 'text-emerald-600 font-bold' :
                        // In variance: il colore segue il SIGNIFICATO del delta,
                        // non il segno aritmetico. Per ricavi/margini (best='max')
                        // val>0 e' meglio (verde), val<0 e' peggio (rosso).
                        // Per i costi (best='min') e' invertito: val>0 (costo
                        // aumentato) e' peggio, val<0 (costo diminuito) e' meglio.
                        isVariance && m.key !== 'ndip' && val !== 0 && (
                          (m.best === 'max' && val > 0) || (m.best === 'min' && val < 0)
                        ) ? 'text-emerald-600' :
                        isVariance && m.key !== 'ndip' && val !== 0 && (
                          (m.best === 'max' && val < 0) || (m.best === 'min' && val > 0)
                        ) ? 'text-red-600' :
                        'text-slate-600'
                      }`}>
                        {isVariance && m.key !== 'ndip' && val > 0 ? '+' : ''}
                        {m.pct ? `${val.toFixed(1)}%` : fmt(val)}
                        {!m.pct && m.key !== 'ndip' && ' €'}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════
   PAGINA PRINCIPALE — CONFRONTO OUTLET
   ═══════════════════════════════════════ */
const PERIOD_OPTIONS = [
  { value: 'annual', label: 'Annuale' },
  { value: 'q1', label: 'Q1 (Gen-Mar)', months: [1,2,3] },
  { value: 'q2', label: 'Q2 (Apr-Giu)', months: [4,5,6] },
  { value: 'q3', label: 'Q3 (Lug-Set)', months: [7,8,9] },
  { value: 'q4', label: 'Q4 (Ott-Dic)', months: [10,11,12] },
  { value: 'm1', label: 'Gennaio', months: [1] },
  { value: 'm2', label: 'Febbraio', months: [2] },
  { value: 'm3', label: 'Marzo', months: [3] },
  { value: 'm4', label: 'Aprile', months: [4] },
  { value: 'm5', label: 'Maggio', months: [5] },
  { value: 'm6', label: 'Giugno', months: [6] },
  { value: 'm7', label: 'Luglio', months: [7] },
  { value: 'm8', label: 'Agosto', months: [8] },
  { value: 'm9', label: 'Settembre', months: [9] },
  { value: 'm10', label: 'Ottobre', months: [10] },
  { value: 'm11', label: 'Novembre', months: [11] },
  { value: 'm12', label: 'Dicembre', months: [12] },
]

export default function ConfrontoOutlet() {
  const { profile } = useAuth()
  const labels = useCompanyLabels()
  const navigate = useNavigate()
  const COMPANY_ID = profile?.company_id
  const { year, quarter } = usePeriod()
  type CostCenterRow = { id?: string; code?: string; label?: string; name?: string; color?: string; sort_order?: number; is_active?: boolean }
  type BudgetEntryRow = { cost_center?: string | null; account_code?: string | null; account_name?: string | null; macro_group?: string | null; budget_amount?: number | null; actual_amount?: number | null; month?: number | null; is_approved?: boolean | null }
  type EmployeeCostRow = { outlet_code?: string | null; employee_id?: string | null; month?: number | null; totale_allocato?: number | null }
  type BalanceRow = Record<string, unknown>
  const [outlets, setOutlets] = useState<CostCenterRow[]>([])
  const [budgetData, setBudgetData] = useState<BudgetEntryRow[]>([])
  const [employeeCosts, setEmployeeCosts] = useState<EmployeeCostRow[]>([])
  const [balanceData, setBalanceData] = useState<BalanceRow[]>([])
  // Sprint 2: consuntivo + preventivo mensile da budget_confronto (Lilian), aggregati
  // per (cost_center, account_code). Vincono su budget_entries.actual_amount nei calcoli.
  const [consOverlay, setConsOverlay] = useState<Record<string, Record<string, number>>>({})
  const [prevOverlay, setPrevOverlay] = useState<Record<string, Record<string, number>>>({})
  // Ricavi per outlet/mese da budget_confronto (fonte condivisa con B&C, T2/T3).
  const [revenueMap, setRevenueMap] = useState<OutletConfrontoMap>({})
  // Piano dei conti: classificazione costi (macro_group/ce_section/sort_order)
  // per account_code, + meta per macro_group. Mai prefissi/nomi hardcoded.
  const [coaByCode, setCoaByCode] = useState<Record<string, CoaMeta>>({})
  const [macroMeta, setMacroMeta] = useState<Record<string, { ceSection: string | null; sortOrder: number }>>({})
  // Codici cost_center della sede/magazzino (cost_centers.role='hq'), per
  // calcolare il netto sede da ripartire pro-quota sul fatturato.
  const [hqCodes, setHqCodes] = useState<Set<string>>(new Set())
  // Esiste consuntivo di COSTO per l'anno? (I5 empty-state). Oggi vuoto.
  const [hasCostConsuntivo, setHasCostConsuntivo] = useState(false)
  const [loading, setLoading] = useState(true)
  // viewMode persistito in URL come ?view=… (default 'budget')
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const viewMode: ConfrontoView = VALID_CONFRONTO_VIEWS.includes(viewParam as ConfrontoView)
    ? (viewParam as ConfrontoView)
    : 'budget'
  const setViewMode = (next: ConfrontoView) => {
    const params = new URLSearchParams(searchParams)
    params.set('view', next)
    setSearchParams(params)
  }
  const [hasData, setHasData] = useState(false)

  // Mappa quarter globale al period locale per filtrare per mesi
  const period = useMemo(() => {
    if (quarter === 'year' || quarter === 'ytd') return 'annual'
    if (quarter.startsWith('q')) return quarter // q1-q4 match directly
    if (quarter.startsWith('m')) return 'm' + parseInt(quarter.slice(1)) // m01→m1, m12→m12
    return 'annual'
  }, [quarter])

  const selectedMonths = PERIOD_OPTIONS.find(p => p.value === period)?.months || null // null = annuale

  // Fetch outlets, budget, balance_sheet_data, and employee costs
  useEffect(() => {
    if (!COMPANY_ID) return
    const companyId = COMPANY_ID
    async function loadData() {
      setLoading(true)
      try {
        const { data: costCenters } = await supabase
          .from('cost_centers')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('sort_order')

        const { data: budgetEntries } = await supabase
          .from('budget_entries')
          .select('*')
          .eq('company_id', companyId)
          .eq('year', year)
          .range(0, 9999)

        // Anche balance_sheet_data per confronto
        const { data: bsData } = await supabase
          .from('balance_sheet_data')
          .select('*')
          .eq('company_id', companyId)
          .eq('year', year)

        const { data: empCosts } = await supabase
          .from('v_employee_costs_by_outlet')
          .select('*')
          .eq('year', year)

        // Piano dei conti: ricavi (is_revenue) + classificazione costi
        // (macro_group/ce_section/sort_order). Mai prefissi/nomi/sezioni hardcoded.
        const { data: coaData } = await supabase
          .from('chart_of_accounts')
          .select('code, is_revenue, macro_group, ce_section, sort_order')
          .eq('company_id', companyId)
          .eq('is_active', true)
        type CoaFull = { code: string; is_revenue: boolean | null; macro_group: string | null; ce_section: string | null; sort_order: number | null }
        const coaRows = (coaData || []) as unknown as CoaFull[]
        const revenueCodes = new Set(coaRows.filter(c => c.is_revenue).map(c => c.code))
        const coaMap: Record<string, CoaMeta> = {}
        const macroMetaMap: Record<string, { ceSection: string | null; sortOrder: number }> = {}
        for (const c of coaRows) {
          const macro = c.macro_group || 'altro'
          const sort = c.sort_order ?? Number.MAX_SAFE_INTEGER
          coaMap[c.code] = { macroGroup: macro, ceSection: c.ce_section, sortOrder: sort, isRevenue: c.is_revenue === true }
          // meta per macro_group = ce_section + sort_order minimo (ordine bilancio)
          if (c.is_revenue !== true) {
            const prev = macroMetaMap[macro]
            if (!prev || sort < prev.sortOrder) macroMetaMap[macro] = { ceSection: c.ce_section, sortOrder: sort }
          }
        }

        // Outlet = cost_centers.role='outlet'; sede = role='hq' (no hardcoded).
        const ccRows = (costCenters || []) as Array<{ code?: string | null; role?: string | null }>
        const outletCC = new Set(ccRows.filter(c => c.role === 'outlet' && c.code).map(c => c.code as string))
        const hqCC = new Set(ccRows.filter(c => c.role === 'hq' && c.code).map(c => c.code as string))

        // Ricavi mensili da budget_confronto (preventivo rev_monthly + consuntivo
        // granitico cons_monthly). Stessa fonte/regola di B&C (modulo condiviso).
        const { data: cfData } = await supabase
          .from('budget_confronto')
          .select('cost_center, account_code, month, amount, entry_type, stato')
          .eq('company_id', companyId)
          .eq('year', year)
          .in('entry_type', ['cons_monthly', 'rev_monthly'])
          .range(0, 9999)
        // Cast: la colonna `stato` non è ancora nei tipi DB generati.
        const cfRows = (cfData || []) as unknown as ConfrontoRow[]
        const revMap = buildOutletRevenue(cfRows, revenueCodes, outletCC)

        // Overlay legacy per i COSTI (oggi vuoto: Lilian non ha inserito i costi
        // consuntivo). Solo conti NON ricavo, così non interferisce con revMap.
        type CfRow = { cost_center: string; account_code: string; amount: number; entry_type: string }
        const consOverlay: Record<string, Record<string, number>> = {}
        const prevOverlay: Record<string, Record<string, number>> = {}
        let costCons = false
        ;(cfRows as unknown as CfRow[]).forEach(r => {
          if (revenueCodes.has(r.account_code)) return // i ricavi passano da revMap
          if (r.entry_type === 'cons_monthly') costCons = true
          const target = r.entry_type === 'cons_monthly' ? consOverlay : prevOverlay
          if (!target[r.cost_center]) target[r.cost_center] = {}
          target[r.cost_center][r.account_code] = (target[r.cost_center][r.account_code] || 0) + (Number(r.amount) || 0)
        })

        setOutlets((costCenters || []) as CostCenterRow[])
        setBudgetData((budgetEntries || []) as BudgetEntryRow[])
        setBalanceData((bsData || []) as BalanceRow[])
        setEmployeeCosts((empCosts || []) as EmployeeCostRow[])
        setConsOverlay(consOverlay)
        setPrevOverlay(prevOverlay)
        setRevenueMap(revMap)
        setCoaByCode(coaMap)
        setMacroMeta(macroMetaMap)
        setHqCodes(hqCC)
        setHasCostConsuntivo(costCons)
        setHasData((budgetEntries?.length || 0) > 0 || (bsData?.length || 0) > 0 || (cfData?.length || 0) > 0)
      } catch (err: unknown) {
        console.error('Error loading data:', err)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [year, quarter, COMPANY_ID])

  // Helper: somma un campo da righe filtrate
  function sumField<T extends Record<string, unknown>>(rows: T[], field: keyof T): number {
    return rows.reduce((s, b) => s + (Number(b[field]) || 0), 0)
  }

  // Quota sede: calcola costi sede e ripartisci equamente tra outlet attivi
  const quotaSedePerOutlet = useMemo(() => {
    const sedeEntries = budgetData.filter(b => {
      const cc = (b.cost_center || '').toLowerCase()
      return (cc === 'sede' || cc === 'sede_magazzino' || cc === 'all') &&
        (selectedMonths ? (b.month != null && selectedMonths.includes(b.month)) : true)
    })
    const amountField: 'actual_amount' | 'budget_amount' = viewMode === 'actual' ? 'actual_amount' : 'budget_amount'
    const totalSede = sedeEntries.reduce((s, b) => s + Math.abs(Number(b[amountField]) || 0), 0)
    const activeOutlets = outlets.filter(o => (o as { role?: string }).role === 'outlet').length
    return activeOutlets > 0 ? totalSede / activeOutlets : 0
  }, [budgetData, outlets, selectedMonths, viewMode])

  // Netto sede da ripartire: costi − ricavi dei cost_center role='hq'
  // (budget_entries, period-aware), split via chart_of_accounts.is_revenue.
  const nettoSede = useMemo(() => {
    let costi = 0, ricavi = 0
    for (const b of budgetData) {
      if (!hqCodes.has(b.cost_center || '')) continue
      if (selectedMonths && !(b.month != null && selectedMonths.includes(b.month))) continue
      const meta = coaByCode[b.account_code || '']
      if (!meta) continue
      const amt = Number(b.budget_amount) || 0
      if (meta.isRevenue) ricavi += amt
      else costi += amt
    }
    return costi - ricavi
  }, [budgetData, hqCodes, coaByCode, selectedMonths])

  // Calculate metrics for each outlet (pre-sede)
  const outletMetricsBase = useMemo(() => {
    if (!outlets.length) return []

    const amtBudget = 'budget_amount'
    const amtActual = 'actual_amount'

    // Build a lookup: for each cost_center code in budget_entries, match to an outlet
    // cost_centers.code may differ from budget_entries.cost_center (case, naming)
    // We match case-insensitively and also try the outlet label (first word, lowercase)
    const allBudgetCCs = [...new Set(budgetData.map(b => b.cost_center).filter((cc): cc is string => Boolean(cc)))]

    return outlets
      // Solo punti vendita: cost_centers.role='outlet' (esclude hq e
      // non_operational, es. sede_magazzino / spese_non_divise). T3, no hardcoded.
      .filter(o => (o as { role?: string }).role === 'outlet')
      .map(outlet => {
      // Match budget_entries cost_center to this outlet flexibly:
      // Try exact match, then case-insensitive match on code, then on label first word
      const outletCode = (outlet.code || '').toLowerCase()
      const outletLabel = (outlet.label || '').split(' ')[0].toLowerCase()
      const outletName = (outlet.name || '').toLowerCase()

      const matchingCC = allBudgetCCs.find(cc => {
        const ccLower = cc.toLowerCase()
        return ccLower === outletCode || ccLower === outletLabel || ccLower === outletName
      }) || outlet.code // fallback to exact code

      // Filtra per periodo
      const outletBudget = budgetData
        .filter(b => {
          const ccLower = (b.cost_center || '').toLowerCase()
          const matchCode = matchingCC ? ccLower === matchingCC.toLowerCase() : ccLower === outletCode
          return matchCode
        })
        .filter(b => selectedMonths ? (b.month != null && selectedMonths.includes(b.month)) : true)

      // Sprint 2 hotfix (Patrizio 29/05/2026 sera): override AGGREGATO, non per-riga.
      // Bug precedente: ritornavo consMap[code] per OGNI riga budget_entries -> se ci
      // sono 12 righe mensili per stesso codice, il totale era 12 × consuntivo = numero
      // esplosivo. Fix: il calcMetrics somma normalmente budget_entries; poi se l'overlay
      // ha valori per quei codici, SOSTITUISCE il totale aggregato una volta sola.
      // NB: definiti PRIMA del guard sotto: un outlet puo' avere SOLO dati overlay
      // (consuntivo/preventivo Lilian) e nessuna riga in budget_entries (es. Torino),
      // e in quel caso deve comunque comparire nel confronto.
      const consMapOutlet = (matchingCC ? consOverlay[matchingCC] : undefined) || consOverlay[outletCode] || {}
      const prevMapOutlet = (matchingCC ? prevOverlay[matchingCC] : undefined) || prevOverlay[outletCode] || {}

      // Codici presenti nell'overlay (consuntivo + preventivo). Servono a classificare
      // ricavi/costi quando l'outlet NON ha righe budget_entries: senza questo i set di
      // codici per categoria sarebbero vuoti e l'overlay non verrebbe mai applicato.
      // Per gli outlet che hanno gia' budget_entries questi codici sono gia' nei set,
      // quindi l'aggiunta e' un no-op (nessuna regressione sugli outlet esistenti).
      const overlayCodes = [...new Set([...Object.keys(consMapOutlet), ...Object.keys(prevMapOutlet)])]
      const hasOverlayData = overlayCodes.length > 0

      // Ricavi per outlet — STESSA logica di Budget & Controllo (modulo condiviso):
      // granitico-else-preventivo per mese, conti is_revenue, da budget_confronto.
      const revM = outletRevenueMetrics(revenueMap[outlet.code || ''], selectedMonths)
      const hasRevenue = revM.preventivo !== 0 || revM.consuntivoEff !== 0

      // Mostra l'outlet se ha righe budget_entries OPPURE dati overlay/ricavi Lilian.
      // Bug "manca Torino": un outlet con solo consuntivo spariva da card, tabella
      // benchmark, grafici e aggregati perche' qui si tornava sempre null.
      if (!outletBudget.length && !hasOverlayData && !hasRevenue) {
        return { name: outlet.label || '', outletData: outlet, calculatedMetrics: null } as OutletMetric
      }

      const hasConsForCodes = (codes: Set<string>): number | null => {
        const sum = Array.from(codes).reduce((s, c) => s + (consMapOutlet[c] || 0), 0)
        return sum > 0 ? sum : null
      }
      const hasPrevForCodes = (codes: Set<string>): number | null => {
        const sum = Array.from(codes).reduce((s, c) => s + (prevMapOutlet[c] || 0), 0)
        return sum > 0 ? sum : null
      }

      // Calcola sia budget che actual per confronto
      function calcMetrics(field: 'budget_amount' | 'actual_amount') {
        const overlay = field === 'actual_amount' ? hasConsForCodes : hasPrevForCodes

        // Ricavi: SEMPRE da budget_confronto via modulo condiviso (is_revenue,
        // mai macro_group/startsWith). Preventivo per la vista budget,
        // consuntivo effettivo (granitico-else-preventivo per mese) per actual.
        const ricavi = field === 'actual_amount' ? revM.consuntivoEff : revM.preventivo

        // Costi classificati SEMPRE via chart_of_accounts.macro_group (mai
        // prefissi di account_code né nomi). Una riga per macro_group reale:
        // personale=B.9, godimento_beni_terzi=B.8, costi_produzione=B.6,
        // servizi=B.7, ecc. Niente doppio conteggio.
        const costiByMacro = aggregateCostsByMacro(outletBudget, field, coaByCode)
        const costiTotali = Object.values(costiByMacro).reduce((s, v) => s + v, 0)
        // Voci nominate per KPI/benchmark, dal macro_group corretto.
        const costoPersonale = costiByMacro['personale'] || 0
        const affitto = costiByMacro['godimento_beni_terzi'] || 0
        const servizi = costiByMacro['servizi'] || 0
        const merci = costiByMacro['costi_produzione'] || 0

        return { ricavi, costoPersonale, affitto, servizi, merci, costiByMacro, costiTotali }
      }

      const budget = calcMetrics(amtBudget)
      const actual = calcMetrics(amtActual)

      // Scegli i dati in base a viewMode.
      // viewMode === 'variance' → mostra lo SCOSTAMENTO consuntivo - preventivo
      // (delta per ogni voce). Senza questo ramo, il tab Scostamento ricadeva
      // su `budget` mostrando dati identici a Preventivo (bug 8.2).
      const isVariance = viewMode === 'variance'
      // Delta per macro_group (scostamento) su unione delle categorie presenti.
      const varCostiByMacro: Record<string, number> = {}
      for (const k of new Set([...Object.keys(actual.costiByMacro), ...Object.keys(budget.costiByMacro)])) {
        varCostiByMacro[k] = (actual.costiByMacro[k] || 0) - (budget.costiByMacro[k] || 0)
      }
      const data = viewMode === 'actual'
        ? actual
        : isVariance
          ? {
              ricavi: actual.ricavi - budget.ricavi,
              costoPersonale: actual.costoPersonale - budget.costoPersonale,
              affitto: actual.affitto - budget.affitto,
              servizi: actual.servizi - budget.servizi,
              merci: actual.merci - budget.merci,
              costiByMacro: varCostiByMacro,
              costiTotali: actual.costiTotali - budget.costiTotali,
            }
          : budget

      // Dipendenti dalla view (filtro per mesi se necessario)
      const empRows = employeeCosts
        .filter(e => e.outlet_code === outlet.code)
        .filter(e => selectedMonths ? (e.month != null && selectedMonths.includes(e.month)) : true)
      const personaleCount = new Set(empRows.map(e => e.employee_id).filter((id): id is string => Boolean(id))).size
      const costoPersonaleFromDb = empRows.reduce((sum, e) => sum + (e.totale_allocato || 0), 0)

      // Personale = B.9 dal piano dei conti (NON l'allocazione dipendenti, che
      // è un consuntivo a parte): così il preventivo mostra il dato di Lilian.
      const finalCostoPersonale = data.costoPersonale
      const { ricavi, affitto, servizi, merci } = data

      // Margine = ricavi − somma di TUTTE le categorie di costo (una volta sola,
      // via macro_group). NON include la quota sede (allocazione, non costo
      // proprio dell'outlet) né l'override dipendenti: niente doppi conteggi.
      const costiTotali = data.costiTotali
      const costiDiretti = costiTotali
      const quotaSede = isVariance ? 0 : quotaSedePerOutlet
      // Categorie di costo ordinate per sort_order (ordine di bilancio), mai per
      // importo né per stringa ce_section.
      const costiCategorie: CostCategory[] = orderedCostCategories(data.costiByMacro, macroMeta)

      const margine = ricavi - costiTotali
      // In variance le percentuali sono "delta in punti percentuali"
      // (incidenza_actual - incidenza_budget); altrimenti calcolo classico.
      let marginePct: number, incidenzaPersonale: number, incidenzaAffitto: number
      if (isVariance) {
        // Margine = ricavi − TUTTI i costi (macro), senza quota sede né override.
        const aMargine = actual.ricavi - actual.costiTotali
        const bMargine = budget.ricavi - budget.costiTotali
        const aMargPct = actual.ricavi > 0 ? (aMargine / actual.ricavi * 100) : 0
        const bMargPct = budget.ricavi > 0 ? (bMargine / budget.ricavi * 100) : 0
        const aIncP = actual.ricavi > 0 ? (actual.costoPersonale / actual.ricavi * 100) : 0
        const bIncP = budget.ricavi > 0 ? (budget.costoPersonale / budget.ricavi * 100) : 0
        const aIncA = actual.ricavi > 0 ? (actual.affitto / actual.ricavi * 100) : 0
        const bIncA = budget.ricavi > 0 ? (budget.affitto / budget.ricavi * 100) : 0
        marginePct = aMargPct - bMargPct
        incidenzaPersonale = aIncP - bIncP
        incidenzaAffitto = aIncA - bIncA
      } else {
        marginePct = ricavi > 0 ? (margine / ricavi * 100) : 0
        incidenzaPersonale = ricavi > 0 ? (finalCostoPersonale / ricavi * 100) : 0
        incidenzaAffitto = ricavi > 0 ? (affitto / ricavi * 100) : 0
      }
      // null = non calcolabile (0 dipendenti, indeterminato). La UI mostra
      // 'N/D'. Bug segnalato: con 0 dipendenti mostrava il totale ricavi.
      const ricavoPerDip = personaleCount > 0 ? ricavi / personaleCount : null

      const costiFissi = finalCostoPersonale + affitto + servizi + quotaSede
      // In variance il breakeven calcolato sui delta è privo di significato
      // (denominatore può essere negativo o piccolissimo). Lo mettiamo a 0,
      // la card lo nasconderà in modalità scostamento.
      let breakeven: number
      if (isVariance) {
        breakeven = 0
      } else {
        const incidenzaMerci = ricavi > 0 ? (merci / ricavi) : 0.5
        breakeven = incidenzaMerci < 1 ? costiFissi / (1 - incidenzaMerci) : 0
      }

      // Varianza budget vs actual (banner sempre visibile sulla card,
      // indipendente dal viewMode → uso quotaSedePerOutlet originale)
      const variance = {
        ricavi: actual.ricavi - budget.ricavi,
        margine: (actual.ricavi - actual.costiTotali) - (budget.ricavi - budget.costiTotali),
        ricaviPct: budget.ricavi > 0 ? ((actual.ricavi - budget.ricavi) / budget.ricavi * 100) : 0,
      }

      // Tracking approvazione: check quanti mesi sono approvati
      const approvedMonths = outletBudget.filter(b => b.is_approved).length
      const totalMonthEntries = outletBudget.length
      const approvalPct = totalMonthEntries > 0 ? Math.round(approvedMonths / totalMonthEntries * 100) : 0

      return {
        name: outlet.label || '',
        outletData: outlet,
        calculatedMetrics: {
          ricavi, margine, marginePct,
          costoPersonale: finalCostoPersonale,
          affitto, servizi, merci,
          costiDiretti, costiTotali,
          costiCategorie, // costi per macro_group, ordinati per sort_order (bilancio)
          personaleCount, ricavoPerDip,
          incidenzaPersonale, incidenzaAffitto,
          breakeven, quotaSede,
          variance, approvalPct,
          budgetRicavi: budget.ricavi,
          actualRicavi: actual.ricavi,
          isVariance, // 8.2: per la UI distinguere modalità Scostamento
          // Ricavi da budget_confronto (modulo condiviso): scostamento sui mesi
          // presi (R1/I2), media mensile (I4), provenienza per badge (I1).
          outletCode: outlet.code || '',
          scostamento: revM.scostamento,
          scostamentoPct: revM.scostamentoPct,
          mesiPresi: revM.mesiPresi,
          mesiTotali: revM.mesiTotali,
          mediaMensile: revM.mediaMensile,
          provenance: revM.provenance,
        },
      } as OutletMetric
    })
  }, [outlets, budgetData, balanceData, employeeCosts, selectedMonths, viewMode, quotaSedePerOutlet, consOverlay, prevOverlay, revenueMap, coaByCode, macroMeta])

  // Quota sede pro-quota netta: il netto sede ripartito sugli outlet in
  // proporzione al fatturato preventivo (budgetRicavi). Aggiunge alla scheda
  // di ogni outlet quotaSedePro (negativa) e margineFinale = margine − quota.
  const fatturatoTot = useMemo(
    () => outletMetricsBase.reduce((s, o) => s + (o.calculatedMetrics?.budgetRicavi || 0), 0),
    [outletMetricsBase],
  )
  const outletMetrics = useMemo(() => outletMetricsBase.map(o => {
    if (!o.calculatedMetrics) return o
    const quota = sedeQuota(nettoSede, o.calculatedMetrics.budgetRicavi || 0, fatturatoTot)
    return { ...o, calculatedMetrics: { ...o.calculatedMetrics, quotaSedePro: quota, margineFinale: o.calculatedMetrics.margine - quota } }
  }), [outletMetricsBase, nettoSede, fatturatoTot])

  // Rankings
  const rankings = useMemo<Record<string, number>>(() => {
    const withData = outletMetrics.filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
    const sorted = [...withData].sort((a, b) => b.calculatedMetrics.ricavi - a.calculatedMetrics.ricavi)
    const map: Record<string, number> = {}
    sorted.forEach((o, i) => { map[o.name] = i + 1 })
    return map
  }, [outletMetrics])

  // Chart data
  const chartRicavi = useMemo(() => {
    return outletMetrics
      .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => Boolean(o.calculatedMetrics?.ricavi))
      .map(o => ({
        name: shortOutletName(o.name),
        ricavi: o.calculatedMetrics.ricavi,
        color: o.outletData.color || '#6366f1',
      }))
  }, [outletMetrics])

  const chartMargini = useMemo(() => {
    return outletMetrics
      .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
      .map(o => ({
        name: shortOutletName(o.name),
        margine: o.calculatedMetrics.margine,
        marginePct: o.calculatedMetrics.marginePct,
        color: o.outletData.color || '#6366f1',
      }))
  }, [outletMetrics])

  // Aggregates
  const totRicavi = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.ricavi || 0), 0)
  const totPersonale = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.costoPersonale || 0), 0)
  const totDipendenti = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.personaleCount || 0), 0)
  const totAffitti = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.affitto || 0), 0)
  const avgRicavi = outletMetrics.filter(o => o.calculatedMetrics).length > 0
    ? totRicavi / outletMetrics.filter(o => o.calculatedMetrics).length
    : 0
  // I2 — scostamento di catena = somma degli scostamenti dei singoli outlet
  // (consuntivo − preventivo sui mesi presi). Coincide con la somma in card.
  const totScostamento = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.scostamento || 0), 0)
  const totMesiPresi = outletMetrics.reduce((s, o) => s + (o.calculatedMetrics?.mesiPresi || 0), 0)

  // Export Excel (CSV come fallback leggero)
  function exportExcel(): void {
    const rows = outletMetrics.filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
    if (!rows.length) return
    const header = [labels.pointOfSale,'Ricavi','Margine','Margine %','Dipendenti','€/Dipendente','Costo personale','Affitto','Servizi','Merci','Quota sede','Approvazione %']
    const csvRows = [header.join(';')]
    rows.forEach(o => {
      const m = o.calculatedMetrics
      csvRows.push([
        `"${formatOutletName(o.name)}"`,
        m.ricavi.toFixed(2), m.margine.toFixed(2), m.marginePct.toFixed(1),
        m.personaleCount, (m.ricavoPerDip ?? 0).toFixed(2),
        m.costoPersonale.toFixed(2), m.affitto.toFixed(2),
        m.servizi.toFixed(2), m.merci.toFixed(2),
        m.quotaSede.toFixed(2),
        m.approvalPct,
      ].join(';'))
    })
    // Varianza se in modalità scostamento
    if (viewMode === 'variance') {
      csvRows.push('')
      csvRows.push('--- SCOSTAMENTO BUDGET vs CONSUNTIVO ---')
      rows.forEach(o => {
        const v = o.calculatedMetrics.variance
        csvRows.push([`"${formatOutletName(o.name)}"`, `Ricavi: ${v.ricavi.toFixed(2)}`, `(${v.ricaviPct.toFixed(1)}%)`].join(';'))
      })
    }
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Confronto_Outlet_${year}_${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw size={24} className="animate-spin text-blue-600" />
      </div>
    )
  }

  if (!hasData) {
    return (
      <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Confronto {labels.pointOfSalePlural}</h1>
          <p className="text-sm text-slate-500">Comparazione parallela P&L per {labels.pointOfSaleLower}</p>
        </div>

        <div className="rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center bg-slate-50/50">
          <AlertCircle size={48} className="text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">Nessun dato disponibile</h2>
          <p className="text-sm text-slate-500 mb-4">
            Carica i dati dal Budget o dal Bilancio per visualizzare il confronto tra i {labels.pointOfSalePluralLower}
          </p>
          <button
            onClick={() => window.location.href = '/budget'}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
          >
            Vai al Budget
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      <PageHeader
        title={`Confronto ${labels.pointOfSalePlural}`}
        subtitle={`Comparazione parallela P&L per ${labels.pointOfSaleLower} — Anno ${year}`}
      />

      {/* Filtri: anno, periodo, vista, export */}
      <div className="flex flex-wrap gap-3 items-center">
        <span className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-semibold bg-slate-50">
          {year} — {PERIOD_OPTIONS.find(p => p.value === period)?.label || 'Annuale'}
        </span>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          {([
            { value: 'budget', label: 'Preventivo' },
            { value: 'actual', label: 'Consuntivo' },
            { value: 'variance', label: 'Scostamento' },
          ] as const).map(v => (
            <button
              key={v.value}
              onClick={() => setViewMode(v.value)}
              className={`px-3 py-2 text-xs font-medium transition ${
                viewMode === v.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <ExportMenu
            data={outletMetrics
              .filter((o): o is OutletMetric & { calculatedMetrics: CalculatedMetrics } => o.calculatedMetrics !== null)
              .map(o => {
                const m = o.calculatedMetrics;
                return {
                  outlet: formatOutletName(o.name), ricavi: m.ricavi, margine: m.margine,
                  margine_pct: m.marginePct, dipendenti: m.personaleCount,
                  per_dipendente: m.ricavoPerDip ?? 0, costo_personale: m.costoPersonale,
                  affitto: m.affitto, servizi: m.servizi, merci: m.merci,
                  quota_sede: m.quotaSede,
                };
              })}
            columns={[
              { key: 'outlet', label: labels.pointOfSale },
              { key: 'ricavi', label: 'Ricavi', format: 'euro' },
              { key: 'margine', label: 'Margine', format: 'euro' },
              { key: 'margine_pct', label: 'Margine %', format: 'percent' },
              { key: 'dipendenti', label: 'Dipendenti' },
              { key: 'per_dipendente', label: '€/Dipendente', format: 'euro' },
              { key: 'costo_personale', label: 'Costo Personale', format: 'euro' },
              { key: 'affitto', label: 'Affitto', format: 'euro' },
              { key: 'servizi', label: 'Servizi', format: 'euro' },
              { key: 'merci', label: 'Merci', format: 'euro' },
              { key: 'quota_sede', label: 'Quota Sede', format: 'euro' },
            ]}
            filename="confronto_outlet"
            title={`Confronto ${labels.pointOfSalePlural}`}
          />
        </div>
      </div>

      {/* KPI aggregati */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-blue-50 text-blue-600 inline-flex mb-3"><Store size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">{outletMetrics.filter(o => o.calculatedMetrics).length}</div>
          <div className="text-sm text-slate-500">{labels.pointOfSalePlural} con dati</div>
          <div className="text-xs text-slate-400">su {outletMetrics.length} totali</div>
        </div>
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600 inline-flex mb-3"><TrendingUp size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">{fmt(totRicavi)} €</div>
          <div className="text-sm text-slate-500">Ricavi totali {labels.pointOfSalePluralLower}</div>
          {totMesiPresi > 0 ? (
            <div className="text-xs text-slate-400">
              Scostamento catena: <span className={totScostamento < 0 ? 'text-red-600 font-medium' : 'text-slate-700 font-medium'}>{scostamentoSegno(totScostamento)}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-400">Media: {fmt(avgRicavi)} €</div>
          )}
        </div>
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600 inline-flex mb-3"><Users size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">{totDipendenti}</div>
          <div className="text-sm text-slate-500">Dipendenti {labels.pointOfSalePluralLower}</div>
          <div className="text-xs text-slate-400">Media: {(totDipendenti / (outletMetrics.filter(o => o.calculatedMetrics).length || 1)).toFixed(1)} per {labels.pointOfSaleLower}</div>
        </div>
        <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <div className="p-2.5 rounded-lg bg-purple-50 text-purple-600 inline-flex mb-3"><DollarSign size={20} /></div>
          <div className="text-2xl font-bold text-slate-900">
            {totDipendenti > 0 ? `${fmt(totRicavi / totDipendenti)} €` : 'N/D'}
          </div>
          <div className="text-sm text-slate-500">Ricavo per dipendente</div>
          <div className="text-xs text-slate-400">
            {totDipendenti > 0 ? 'KPI produttività media' : 'Nessun dipendente assegnato agli outlet'}
          </div>
        </div>
      </div>

      {/* Grafici comparativi */}
      {chartRicavi.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Ricavi per outlet */}
          <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Ricavi per {labels.pointOfSaleLower}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartRicavi} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  {chartRicavi.map((d, i) => (
                    <linearGradient key={`grad-${i}`} id={`gradient-ricavi-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                      <stop offset="100%" stopColor={d.color} stopOpacity={0.5} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="ricavi" radius={[8, 8, 0, 0]} animationDuration={800}>
                  {chartRicavi.map((d, i) => <Cell key={i} fill={`url(#gradient-ricavi-${i})`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Margine per outlet */}
          <div className="rounded-2xl p-5 shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Margine per {labels.pointOfSaleLower}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartMargini} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  {chartMargini.map((d, i) => {
                    const color = d.margine >= 0 ? '#10b981' : '#ef4444'
                    return (
                      <linearGradient key={`grad-margine-${i}`} id={`gradient-margine-${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={1} />
                        <stop offset="100%" stopColor={color} stopOpacity={0.5} />
                      </linearGradient>
                    )
                  })}
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="margine" radius={[8, 8, 0, 0]} animationDuration={800}>
                  {chartMargini.map((d, i) => (
                    <Cell key={i} fill={`url(#gradient-margine-${i})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tabella benchmark */}
      <TabellaBenchmark outletMetrics={outletMetrics} />

      {/* Cards parallele — confronto diretto */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <BarChart3 size={20} className="text-blue-600" />
          Schede outlet — P&L comparativo
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {outletMetrics.map(o => (
            <OutletCard
              key={o.name}
              name={o.name}
              outletData={o.outletData}
              calculatedMetrics={o.calculatedMetrics}
              ranking={rankings[o.name]}
              onNavigate={() => navigate(`/outlet?id=${o.outletData.id}`)}
              onOpenBudget={() => navigate(`/budget?tab=confronto&outlet=${encodeURIComponent(o.calculatedMetrics?.outletCode || o.outletData.code || '')}&anno=${year}`)}
            />
          ))}
        </div>
      </div>

      {/* Info nota */}
      <div className="flex items-start gap-3 bg-blue-50/50 border border-blue-200 rounded-xl p-4">
        <AlertCircle size={18} className="text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <span className="font-semibold">
            {year} — {PERIOD_OPTIONS.find(p => p.value === period)?.label || 'Annuale'}
            {viewMode === 'budget' && ' (Preventivo)'}
            {viewMode === 'actual' && ' (Consuntivo)'}
            {viewMode === 'variance' && ' (Scostamento)'}
          </span>
          <div className="text-xs text-blue-600 mt-1">
            Ricavi: {RICAVI_SOURCE_LABEL} (budget_confronto — preventivo rev_monthly,
            consuntivo granitico cons_monthly), regola granitico-else-preventivo per mese,
            stessa fonte di Budget &amp; Controllo. Costi: budget_entries + employee_costs_by_outlet.
            Quota sede: netto sede (costi − ricavi, {fmt(nettoSede)} €) ripartito sugli outlet
            in proporzione al fatturato preventivo.
            {viewMode === 'variance' && ' Lo scostamento ricavi è consuntivo − preventivo sui soli mesi presi.'}
          </div>
          {/* I5 — distingue "0 vero" da "non inserito": consuntivo costi assente. */}
          {viewMode !== 'budget' && !hasCostConsuntivo && (
            <div className="text-xs text-amber-700 mt-2 flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>Consuntivo costi non ancora inserito da Lilian: i costi mostrati restano da preventivo, non sono uno «0» reale.</span>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}
