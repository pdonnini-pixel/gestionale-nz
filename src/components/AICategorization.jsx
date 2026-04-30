import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Brain, Sparkles, CheckCircle2, AlertTriangle, Tag, ChevronDown, ChevronUp,
  RefreshCw, Search, Filter, Check, X, Eye, Zap, BarChart3, Clock,
  TrendingUp, AlertCircle, Copy, ArrowRight
} from 'lucide-react'
import { supabase } from '../lib/supabase'

/* ───── helpers ───── */
function fmt(n, dec = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('it-IT') : '—'

async function callEdgeFunction(fnName, method = 'GET', body = null, params = null) {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://xfvfxsvqpnpvibgeqpqp.supabase.co'
  let url = `${baseUrl}/functions/v1/${fnName}`
  if (params) {
    url += '?' + new URLSearchParams(params).toString()
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Non autenticato')

  const headers = {
    'Authorization': `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }

  const opts = { method, headers }
  if (body && (method === 'POST' || method === 'PUT')) {
    opts.body = JSON.stringify(body)
  }

  const res = await fetch(url, opts)
  if (res.status === 401) {
    // Refresh e retry
    const { data: refreshData } = await supabase.auth.refreshSession()
    if (refreshData?.session) {
      headers['Authorization'] = `Bearer ${refreshData.session.access_token}`
      const retry = await fetch(url, { ...opts, headers })
      if (!retry.ok) throw new Error(`Edge Function error: ${retry.status}`)
      return retry.json()
    }
    throw new Error('Sessione scaduta')
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error(errBody.error || `Errore ${res.status}`)
  }
  return res.json()
}

/* ───── confidence badge ───── */
function ConfidenceBadge({ confidence }) {
  if (confidence == null) return null
  const pct = Math.round(confidence * 100)
  const color = pct >= 85 ? 'bg-emerald-100 text-emerald-700'
    : pct >= 65 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {pct}%
    </span>
  )
}

/* ───── method badge ───── */
function MethodBadge({ method }) {
  const config = {
    learned_rule: { label: 'Regola appresa', color: 'bg-blue-50 text-blue-600', icon: Brain },
    keyword: { label: 'Keyword', color: 'bg-purple-50 text-purple-600', icon: Tag },
    pattern: { label: 'Pattern', color: 'bg-cyan-50 text-cyan-600', icon: Zap },
    manual: { label: 'Manuale', color: 'bg-slate-100 text-slate-600', icon: Check },
  }
  const cfg = config[method] || { label: method || '?', color: 'bg-slate-100 text-slate-500', icon: Tag }
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>
      <Icon size={10} /> {cfg.label}
    </span>
  )
}

/* ═══════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════ */
export default function AICategorization({ companyId }) {
  // Data
  const [movements, setMovements] = useState([])
  const [categories, setCategories] = useState([])
  const [anomalies, setAnomalies] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  // UI state
  const [filter, setFilter] = useState('da_verificare') // da_verificare, categorizzati, tutti, non_categorizzati
  const [search, setSearch] = useState('')
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchResult, setBatchResult] = useState(null)
  const [anomalyRunning, setAnomalyRunning] = useState(false)
  const [confirmingId, setConfirmingId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editCategory, setEditCategory] = useState('')
  const [showAnomalies, setShowAnomalies] = useState(false)

  // Load data
  const loadData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const [movRes, catRes, anomRes] = await Promise.all([
        supabase
          .from('cash_movements')
          .select('id, date, description, counterpart, amount, type, cost_category_id, ai_category_id, ai_confidence, ai_method, ai_categorized_at, verified, bank_account_id')
          .eq('company_id', companyId)
          .order('date', { ascending: false })
          .limit(500),
        supabase
          .from('cost_categories')
          .select('id, name')
          .eq('company_id', companyId)
          .order('name'),
        supabase
          .from('ai_anomaly_log')
          .select('*')
          .eq('company_id', companyId)
          .eq('resolved', false)
          .order('detected_at', { ascending: false })
          .limit(50),
      ])
      if (movRes.data) setMovements(movRes.data)
      if (catRes.data) setCategories(catRes.data)
      if (anomRes.data) setAnomalies(anomRes.data)

      // Compute stats
      const all = movRes.data || []
      const categorized = all.filter(m => m.cost_category_id || m.ai_category_id)
      const aiCat = all.filter(m => m.ai_category_id && !m.cost_category_id)
      const confirmed = all.filter(m => m.cost_category_id)
      const uncategorized = all.filter(m => !m.cost_category_id && !m.ai_category_id)
      setStats({
        total: all.length,
        categorized: categorized.length,
        aiPending: aiCat.length,
        confirmed: confirmed.length,
        uncategorized: uncategorized.length,
        anomalies: (anomRes.data || []).length,
      })
    } catch (e) {
      console.error('AICategorization load error:', e)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { loadData() }, [loadData])

  // Filtered movements
  const filtered = useMemo(() => {
    let list = movements
    if (filter === 'da_verificare') list = list.filter(m => m.ai_category_id && !m.cost_category_id)
    else if (filter === 'categorizzati') list = list.filter(m => m.cost_category_id)
    else if (filter === 'non_categorizzati') list = list.filter(m => !m.cost_category_id && !m.ai_category_id)

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        (m.description || '').toLowerCase().includes(q) ||
        (m.counterpart || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [movements, filter, search])

  // Get category name
  const getCategoryName = (id) => {
    if (!id) return null
    const cat = categories.find(c => c.id === id)
    return cat?.name || '?'
  }

  // ─── Batch categorization ───
  const runBatch = async () => {
    setBatchRunning(true)
    setBatchResult(null)
    try {
      const result = await callEdgeFunction('ai-categorize', 'POST', { mode: 'batch' })
      setBatchResult(result)
      await loadData()
    } catch (e) {
      setBatchResult({ error: e.message })
    } finally {
      setBatchRunning(false)
    }
  }

  // ─── Confirm AI suggestion ───
  const confirmCategory = async (movementId, categoryId) => {
    setConfirmingId(movementId)
    try {
      await callEdgeFunction('ai-categorize', 'POST', {
        mode: 'confirm',
        movementId,
        categoryId,
        confirmed: true,
      })
      // Update local state
      setMovements(prev => prev.map(m =>
        m.id === movementId
          ? { ...m, cost_category_id: categoryId, ai_method: 'manual' }
          : m
      ))
    } catch (e) {
      console.error('Confirm error:', e)
      alert('Errore nella conferma: ' + e.message)
    } finally {
      setConfirmingId(null)
    }
  }

  // ─── Correct category ───
  const correctCategory = async (movementId, newCategoryId) => {
    setConfirmingId(movementId)
    try {
      await callEdgeFunction('ai-categorize', 'POST', {
        mode: 'confirm',
        movementId,
        categoryId: newCategoryId,
        confirmed: true,
      })
      setMovements(prev => prev.map(m =>
        m.id === movementId
          ? { ...m, cost_category_id: newCategoryId, ai_category_id: newCategoryId, ai_method: 'manual' }
          : m
      ))
      setEditingId(null)
      setEditCategory('')
    } catch (e) {
      console.error('Correct error:', e)
      alert('Errore nella correzione: ' + e.message)
    } finally {
      setConfirmingId(null)
    }
  }

  // ─── Run anomaly detection ───
  const runAnomalies = async () => {
    setAnomalyRunning(true)
    try {
      await callEdgeFunction('ai-categorize', 'POST', { mode: 'anomalies' })
      await loadData()
    } catch (e) {
      console.error('Anomaly detection error:', e)
      alert('Errore: ' + e.message)
    } finally {
      setAnomalyRunning(false)
    }
  }

  // ─── Resolve anomaly ───
  const resolveAnomaly = async (anomalyId) => {
    try {
      await supabase
        .from('ai_anomaly_log')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', anomalyId)
      setAnomalies(prev => prev.filter(a => a.id !== anomalyId))
    } catch (e) {
      console.error('Resolve anomaly error:', e)
    }
  }

  // ─── Confirm all high-confidence suggestions ───
  const confirmAllHighConfidence = async () => {
    const highConf = movements.filter(m =>
      m.ai_category_id && !m.cost_category_id && m.ai_confidence >= 0.85
    )
    if (highConf.length === 0) return

    if (!confirm(`Confermare ${highConf.length} categorizzazioni con confidenza ≥85%?`)) return

    setBatchRunning(true)
    try {
      for (const m of highConf) {
        await supabase
          .from('cash_movements')
          .update({
            cost_category_id: m.ai_category_id,
            ai_method: 'auto_confirmed',
          })
          .eq('id', m.id)
      }
      await loadData()
    } catch (e) {
      console.error('Batch confirm error:', e)
    } finally {
      setBatchRunning(false)
    }
  }

  const filterTabs = [
    { key: 'da_verificare', label: 'Da verificare', count: stats?.aiPending || 0, icon: Eye },
    { key: 'non_categorizzati', label: 'Non categorizzati', count: stats?.uncategorized || 0, icon: AlertCircle },
    { key: 'categorizzati', label: 'Confermati', count: stats?.confirmed || 0, icon: CheckCircle2 },
    { key: 'tutti', label: 'Tutti', count: stats?.total || 0, icon: BarChart3 },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw size={20} className="animate-spin text-blue-500 mr-2" />
        <span className="text-sm text-slate-500">Caricamento categorizzazione AI...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600"><BarChart3 size={16} /></div>
            <span className="text-xs text-slate-400">Totale</span>
          </div>
          <div className="text-xl font-bold text-slate-900">{stats?.total || 0}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">movimenti caricati</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 size={16} /></div>
            <span className="text-xs text-slate-400">Confermati</span>
          </div>
          <div className="text-xl font-bold text-emerald-600">{stats?.confirmed || 0}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {stats?.total ? `${Math.round((stats.confirmed / stats.total) * 100)}%` : '0%'} del totale
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600"><Eye size={16} /></div>
            <span className="text-xs text-slate-400">Da verificare</span>
          </div>
          <div className="text-xl font-bold text-amber-600">{stats?.aiPending || 0}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">suggerimenti AI in attesa</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-red-50 text-red-500"><AlertCircle size={16} /></div>
            <span className="text-xs text-slate-400">Non categorizzati</span>
          </div>
          <div className="text-xl font-bold text-red-500">{stats?.uncategorized || 0}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">nessun suggerimento</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600"><AlertTriangle size={16} /></div>
            <span className="text-xs text-slate-400">Anomalie</span>
          </div>
          <div className="text-xl font-bold text-purple-600">{stats?.anomalies || 0}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">da investigare</div>
        </div>
      </div>

      {/* ─── Action Bar ─── */}
      <div className="flex items-center flex-wrap gap-3">
        <button
          onClick={runBatch}
          disabled={batchRunning}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
        >
          {batchRunning ? <RefreshCw size={15} className="animate-spin" /> : <Brain size={15} />}
          {batchRunning ? 'Categorizzazione in corso...' : 'Avvia categorizzazione AI'}
        </button>

        {stats?.aiPending > 0 && (
          <button
            onClick={confirmAllHighConfidence}
            disabled={batchRunning}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm"
          >
            <Sparkles size={15} />
            Conferma tutti ≥85%
          </button>
        )}

        <button
          onClick={runAnomalies}
          disabled={anomalyRunning}
          className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
        >
          {anomalyRunning ? <RefreshCw size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
          Rileva anomalie
        </button>

        <button
          onClick={() => setShowAnomalies(!showAnomalies)}
          className={`inline-flex items-center gap-2 px-3 py-2 border text-sm font-medium rounded-lg transition ${
            showAnomalies ? 'border-purple-300 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          <AlertTriangle size={14} />
          Anomalie ({anomalies.length})
          {showAnomalies ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* ─── Batch result message ─── */}
      {batchResult && (
        <div className={`p-3 rounded-lg text-sm ${batchResult.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {batchResult.error
            ? `Errore: ${batchResult.error}`
            : `Categorizzati ${batchResult.categorized || 0} movimenti su ${batchResult.total || 0} analizzati (${batchResult.skipped || 0} già categorizzati)`
          }
        </div>
      )}

      {/* ─── Anomalies panel ─── */}
      {showAnomalies && anomalies.length > 0 && (
        <div className="bg-white rounded-xl border border-purple-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-purple-50 border-b border-purple-100 flex items-center gap-2">
            <AlertTriangle size={16} className="text-purple-600" />
            <span className="text-sm font-semibold text-purple-800">Anomalie rilevate</span>
          </div>
          <div className="divide-y divide-slate-100">
            {anomalies.map(a => (
              <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition">
                <div className={`p-1.5 rounded-lg ${
                  a.anomaly_type === 'duplicate' ? 'bg-red-50 text-red-500'
                  : a.anomaly_type === 'unusual_amount' ? 'bg-amber-50 text-amber-600'
                  : 'bg-purple-50 text-purple-600'
                }`}>
                  <AlertTriangle size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">
                    {a.anomaly_type === 'duplicate' ? 'Possibile duplicato'
                    : a.anomaly_type === 'unusual_amount' ? 'Importo anomalo'
                    : a.anomaly_type === 'overdue_payable' ? 'Scadenza non pagata'
                    : a.anomaly_type}
                  </div>
                  <div className="text-xs text-slate-500 truncate" title={a.description}>{a.description}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtDate(a.detected_at)}</div>
                </div>
                {a.amount && (
                  <div className="text-sm font-medium text-slate-700">{fmt(a.amount)} €</div>
                )}
                <button
                  onClick={() => resolveAnomaly(a.id)}
                  className="px-2.5 py-1 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-100 transition"
                >
                  Risolvi
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Filter tabs + search ─── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-slate-100/80 rounded-lg p-0.5">
          {filterTabs.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                filter === t.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <t.icon size={12} />
              {t.label}
              <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded-full ${
                filter === t.key ? 'bg-slate-100 text-slate-600' : 'bg-transparent text-slate-400'
              }`}>{t.count}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            type="text"
            placeholder="Cerca..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400/40 bg-white w-56"
          />
        </div>
      </div>

      {/* ─── Movements table ─── */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            {filter === 'da_verificare'
              ? 'Nessun suggerimento AI in attesa di verifica. Avvia la categorizzazione per analizzare i movimenti.'
              : filter === 'non_categorizzati'
                ? 'Tutti i movimenti hanno una categoria assegnata o suggerita.'
                : 'Nessun movimento trovato.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="border-b border-slate-100 text-[11px] text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-4 text-left font-medium">Data</th>
                  <th className="py-2.5 px-4 text-left font-medium">Descrizione</th>
                  <th className="py-2.5 px-4 text-left font-medium">Controparte</th>
                  <th className="py-2.5 px-4 text-right font-medium">Importo</th>
                  <th className="py-2.5 px-4 text-left font-medium">Categoria</th>
                  <th className="py-2.5 px-4 text-center font-medium">Confidenza</th>
                  <th className="py-2.5 px-4 text-center font-medium">Metodo</th>
                  <th className="py-2.5 px-4 text-center font-medium w-40">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map(m => {
                  const isEntrata = m.type === 'entrata'
                  const catName = getCategoryName(m.cost_category_id || m.ai_category_id)
                  const isConfirmed = !!m.cost_category_id
                  const isEditing = editingId === m.id

                  return (
                    <tr key={m.id} className={`border-b border-slate-50 hover:bg-blue-50/30 transition ${
                      isConfirmed ? '' : m.ai_category_id ? 'bg-amber-50/20' : 'bg-red-50/10'
                    }`}>
                      <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap text-xs">
                        {fmtDate(m.date)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-800 max-w-[240px]">
                        <span className="block truncate text-[13px]" title={m.description || ''}>
                          {m.description || '—'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-500 max-w-[150px] truncate" title={m.counterpart || ''}>
                        {m.counterpart || '—'}
                      </td>
                      <td className={`py-2.5 px-4 text-right font-medium whitespace-nowrap text-[13px] ${isEntrata ? 'text-emerald-600' : 'text-red-500'}`}>
                        {isEntrata ? '+' : '-'}{fmt(Math.abs(m.amount))} €
                      </td>
                      <td className="py-2.5 px-4">
                        {isEditing ? (
                          <select
                            value={editCategory}
                            onChange={e => setEditCategory(e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-blue-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                            autoFocus
                          >
                            <option value="">Seleziona categoria...</option>
                            {categories.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        ) : catName ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            isConfirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                          }`}>
                            <Tag size={10} />
                            {catName}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">Non categorizzato</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <ConfidenceBadge confidence={m.ai_confidence} />
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {m.ai_method && <MethodBadge method={m.ai_method} />}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {isEditing ? (
                          <div className="flex items-center gap-1 justify-center">
                            <button
                              onClick={() => editCategory && correctCategory(m.id, editCategory)}
                              disabled={!editCategory || confirmingId === m.id}
                              className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition"
                            >
                              <Check size={10} /> Salva
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditCategory('') }}
                              className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium text-slate-500 border border-slate-200 rounded-md hover:bg-slate-50 transition"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ) : isConfirmed ? (
                          <button
                            onClick={() => { setEditingId(m.id); setEditCategory(m.cost_category_id || '') }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-100 rounded-md transition"
                          >
                            Modifica
                          </button>
                        ) : m.ai_category_id ? (
                          <div className="flex items-center gap-1 justify-center">
                            <button
                              onClick={() => confirmCategory(m.id, m.ai_category_id)}
                              disabled={confirmingId === m.id}
                              className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition"
                            >
                              {confirmingId === m.id ? <Clock size={10} className="animate-spin" /> : <Check size={10} />}
                              Conferma
                            </button>
                            <button
                              onClick={() => { setEditingId(m.id); setEditCategory('') }}
                              className="inline-flex items-center gap-0.5 px-2 py-1 text-[10px] font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition"
                            >
                              Correggi
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingId(m.id); setEditCategory('') }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition"
                          >
                            <Tag size={10} /> Assegna
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filtered.length > 100 && (
              <div className="p-3 text-center border-t border-slate-100 text-xs text-slate-400">
                Mostrati 100 di {filtered.length} movimenti. Usa la ricerca per trovare movimenti specifici.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
