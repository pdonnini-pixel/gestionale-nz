import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Landmark, Building2, Wallet, CreditCard, TrendingUp,
  Search, ChevronDown, ChevronUp, Banknote, Store,
  PiggyBank, HandCoins, Info, Calculator, FileUp, Percent, Calendar,
  Plus, Edit2, Trash2, Check, X, AlertCircle, Download,
  ArrowLeftRight, Upload, Clock, ListOrdered, Link2, RefreshCw,
  Unlink, History, CheckCircle2, Eye, EyeOff, ArrowUpRight, ArrowDownLeft,
  Filter, CircleDot
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { useAuth } from '../hooks/useAuth'

/* ───── reconciliation engine ───── */
import { runAutoReconciliation, applyReconciliation, undoReconciliation, getReconciliationLog } from '../lib/reconciliationEngine'
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899']

/* ───── helpers ───── */
function fmt(n, dec = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

function KpiCard({ title, value, subtitle, icon: Icon, color = 'blue' }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
    cyan: 'bg-cyan-50 text-cyan-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className={`p-2.5 rounded-lg ${colorMap[color]} inline-flex mb-3`}>
        <Icon size={20} />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-sm text-slate-500 mt-0.5">{title}</div>
      {subtitle && <div className="text-xs text-slate-400 mt-1">{subtitle}</div>}
    </div>
  )
}

/* ────────────────────────────────────────
   Modal Aggiungi/Modifica Conto Bancario
   ──────────────────────────────────────── */
function ModalBankAccount({ isOpen, isEdit, account, onClose, onSave }) {
  const [formData, setFormData] = useState({
    bank_name: '',
    account_name: '',
    iban: '',
    account_type: 'conto_corrente',
    current_balance: 0,
    outlet_code: '',
    note: ''
  })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isEdit && account) {
      setFormData(account)
    } else {
      setFormData({
        bank_name: '',
        account_name: '',
        iban: '',
        account_type: 'conto_corrente',
        current_balance: 0,
        outlet_code: '',
        note: ''
      })
    }
  }, [isOpen, isEdit, account])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(formData)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          {isEdit ? 'Modifica Conto' : 'Nuovo Conto Bancario'}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Banca</label>
            <input
              type="text"
              value={formData.bank_name}
              onChange={e => setFormData({ ...formData, bank_name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="es. MPS, BCC..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome Conto</label>
            <input
              type="text"
              value={formData.account_name}
              onChange={e => setFormData({ ...formData, account_name: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="es. C/C 621460"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">IBAN</label>
            <input
              type="text"
              value={formData.iban}
              onChange={e => setFormData({ ...formData, iban: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="IT..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
              <select
                value={formData.account_type}
                onChange={e => setFormData({ ...formData, account_type: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="conto_corrente">C/C</option>
                <option value="deposito">Deposito</option>
                <option value="cassa">Cassa</option>
                <option value="pos">POS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Saldo</label>
              <input
                type="number"
                step="0.01"
                value={formData.current_balance}
                onChange={e => setFormData({ ...formData, current_balance: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Note</label>
            <textarea
              value={formData.note}
              onChange={e => setFormData({ ...formData, note: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows="2"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Annulla
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {isSaving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────
   Modal Aggiungi/Modifica Prestito
   ──────────────────────────────────────── */
function ModalLoan({ isOpen, isEdit, loan, onClose, onSave }) {
  const [formData, setFormData] = useState({
    description: '',
    total_amount: 0,
    interest_rate: 0,
    start_date: '',
    end_date: ''
  })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isEdit && loan) {
      setFormData({
        description: loan.description || '',
        total_amount: loan.total_amount || 0,
        interest_rate: loan.interest_rate || 0,
        start_date: loan.start_date ? loan.start_date.split('T')[0] : '',
        end_date: loan.end_date ? loan.end_date.split('T')[0] : ''
      })
    } else {
      setFormData({
        description: '',
        total_amount: 0,
        interest_rate: 0,
        start_date: '',
        end_date: ''
      })
    }
  }, [isOpen, isEdit, loan])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(formData)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-lg font-bold text-slate-900">
          {isEdit ? 'Modifica Prestito' : 'Nuovo Prestito'}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Descrizione</label>
            <input
              type="text"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="es. Mutuo bancario, Finanziamento soci..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Importo Totale</label>
            <input
              type="number"
              step="0.01"
              value={formData.total_amount}
              onChange={e => setFormData({ ...formData, total_amount: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tasso d'interesse (%)</label>
            <input
              type="number"
              step="0.01"
              value={formData.interest_rate}
              onChange={e => setFormData({ ...formData, interest_rate: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="0.00"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Data Inizio</label>
              <input
                type="date"
                value={formData.start_date}
                onChange={e => setFormData({ ...formData, start_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Data Scadenza</label>
              <input
                type="date"
                value={formData.end_date}
                onChange={e => setFormData({ ...formData, end_date: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Annulla
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {isSaving ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Conti Bancari
   ──────────────────────────────────────── */
function SezioneBanche({ accounts, totalBanks, search, onAddEdit, onDelete, loading }) {
  const [expanded, setExpanded] = useState(null)

  const filtered = accounts.filter(c =>
    !search ||
    c.bank_name.toLowerCase().includes(search.toLowerCase()) ||
    c.account_name.toLowerCase().includes(search.toLowerCase())
  )

  const perBanca = {}
  filtered.forEach(c => {
    if (!perBanca[c.bank_name]) perBanca[c.bank_name] = []
    perBanca[c.bank_name].push(c)
  })

  if (loading) return <div className="text-center py-8 text-slate-400">Caricamento...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-500 flex items-center gap-2">
          <Building2 size={15} className="text-slate-400" />
          Conti Bancari
        </h2>
        <button
          onClick={() => onAddEdit(null)}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition"
        >
          <Plus size={14} /> Nuovo
        </button>
      </div>

      {Object.entries(perBanca).map(([banca, conti]) => {
        const totBanca = conti.reduce((s, c) => s + c.current_balance, 0)
        return (
          <div key={banca} className="bg-white rounded-xl border border-slate-200/80 overflow-hidden">
            <div
              className="px-4 py-3 cursor-pointer hover:bg-slate-50/30 transition flex items-center justify-between"
              onClick={() => setExpanded(expanded === banca ? null : banca)}
            >
              <div className="flex items-center gap-3">
                <Landmark size={16} className="text-blue-500" />
                <div>
                  <div className="font-medium text-slate-800 text-sm">{banca}</div>
                  <div className="text-[10px] text-slate-400">{conti.length} {conti.length === 1 ? 'conto' : 'conti'}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-base font-semibold text-slate-900">{fmt(totBanca)} €</div>
                </div>
                {expanded === banca ? <ChevronUp size={14} className="text-slate-300" /> : <ChevronDown size={14} className="text-slate-300" />}
              </div>
            </div>

            {expanded === banca && (
              <div className="border-t border-slate-100">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr className="text-xs text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-4 text-left font-medium">Conto</th>
                      <th className="py-2.5 px-4 text-left font-medium">Tipo</th>
                      <th className="py-2.5 px-4 text-right font-medium">Saldo</th>
                      <th className="py-2.5 px-4 text-right font-medium">% Totale</th>
                      <th className="py-2.5 px-4 text-center font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conti.map(c => (
                      <tr key={c.id} className="border-t border-slate-50 hover:bg-slate-50/50 transition text-sm">
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">{c.account_name}</div>
                          {c.last_update && (
                            <div className="text-[10px] text-slate-400 flex items-center gap-0.5 mt-0.5">
                              <Clock size={9} /> Agg. {new Date(c.last_update).toLocaleDateString('it-IT')} {new Date(c.last_update).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            c.account_type === 'conto_corrente' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                          }`}>
                            {c.account_type === 'conto_corrente' ? 'C/C' : c.account_type === 'deposito' ? 'Dep.' : c.account_type.toUpperCase()}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-slate-900">{fmt(c.current_balance)} €</td>
                        <td className="py-3 px-4 text-right text-slate-500">{totalBanks > 0 ? ((c.current_balance / totalBanks) * 100).toFixed(1) : 0}%</td>
                        <td className="py-3 px-4 text-center flex items-center justify-center gap-2">
                          <button
                            onClick={() => onAddEdit(c)}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded transition"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => onDelete(c.id)}
                            className="p-1 text-red-600 hover:bg-red-50 rounded transition"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}

      {filtered.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-sm">Nessun conto trovato</div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Casse Outlet
   ──────────────────────────────────────── */
function SezioneCasse({ accounts, totalCashes }) {
  const casse = accounts.filter(a => a.account_type === 'cassa')
  const chartData = casse.map(c => ({ name: c.outlet_code || 'N/A', saldo: c.current_balance }))

  if (casse.length === 0) return null

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
        <Store size={20} className="text-emerald-600" />
        Casse Outlet
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr className="text-xs text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-4 text-left font-medium">Outlet</th>
                <th className="py-2.5 px-4 text-right font-medium">Saldo</th>
                <th className="py-2.5 px-4 text-right font-medium">%</th>
              </tr>
            </thead>
            <tbody>
              {casse.map(c => (
                <tr key={c.id} className="border-t border-slate-50 hover:bg-slate-50/50 transition text-sm">
                  <td className="py-3 px-4 font-medium text-slate-900">{c.outlet_code}</td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-900">{fmt(c.current_balance)} €</td>
                  <td className="py-3 px-4 text-right text-slate-500">{totalCashes > 0 ? ((c.current_balance / totalCashes) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 border-t border-slate-200">
                <td className="py-3 px-4 text-sm font-semibold text-slate-700">Totale casse</td>
                <td className="py-3 px-4 text-right font-bold text-slate-900">{fmt(totalCashes)} €</td>
                <td className="py-3 px-4 text-right font-medium text-slate-700">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="rounded-2xl overflow-hidden shadow-lg p-5" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          {chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <defs>
                  {COLORS.slice(0, chartData.length).map((color, i) => (
                    <linearGradient key={i} id={`grad-casse-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={1} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.5} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="name" {...AXIS_STYLE} />
                <YAxis {...AXIS_STYLE} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} cursor={{ fill: 'rgba(99,102,241,0.04)', radius: 8 }} />
                <Bar dataKey="saldo" radius={[8, 8, 0, 0]} animationDuration={800}>
                  {chartData.map((_, i) => <Cell key={i} fill={`url(#grad-casse-${i})`} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Finanziamenti & Debiti
   ──────────────────────────────────────── */
function SezioneFinanziamenti({ loans, onAddEdit, onDelete }) {
  const [tassoSoci, setTassoSoci] = useState(3.5)
  const [tassoMps, setTassoMps] = useState(4.0)

  const loansActive = loans.filter(l => l.is_active)
  const loansSoci = loansActive.filter(l => l.loan_type === 'soci')
  const loansBancari = loansActive.filter(l => l.loan_type === 'bancario_breve' || l.loan_type === 'bancario_lungo')

  const totSoci = loansSoci.reduce((s, l) => s + l.remaining_amount, 0)
  const totBancari = loansBancari.reduce((s, l) => s + l.remaining_amount, 0)
  const totDebiti = totSoci + totBancari

  const intSociAnnuo = totSoci * (tassoSoci / 100)
  const intBancariAnnuo = totBancari * (tassoMps / 100)

  if (loansActive.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <HandCoins size={20} className="text-amber-600" />
          Finanziamenti & Debiti finanziari
        </h2>
        <button
          onClick={() => onAddEdit(null)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Plus size={16} />
          Aggiungi Prestito
        </button>
      </div>

      <div className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr className="text-xs text-slate-500 uppercase tracking-wider">
              <th className="py-2.5 px-4 text-left font-medium">Tipo</th>
              <th className="py-2.5 px-4 text-left font-medium">Mutuante</th>
              <th className="py-2.5 px-4 text-left font-medium">Importo residuo</th>
              <th className="py-2.5 px-4 text-left font-medium">Scadenza</th>
              <th className="py-2.5 px-4 text-right font-medium">Int. annui</th>
              <th className="py-2.5 px-4 text-center font-medium">Azioni</th>
            </tr>
          </thead>
          <tbody>
            {loansActive.map(l => {
              const isSoci = l.loan_type === 'soci'
              const intAnnuo = isSoci ? (l.remaining_amount * tassoSoci / 100) : (l.remaining_amount * tassoMps / 100)
              return (
                <tr key={l.id} className="border-t border-slate-50 hover:bg-slate-50/50 transition text-sm">
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      isSoci ? 'bg-purple-50 text-purple-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {l.loan_type === 'soci' ? 'Soci' : 'Bancario'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-slate-600">{l.lender}</td>
                  <td className="py-3 px-4 text-slate-900 font-medium">{fmt(l.remaining_amount)} €</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      new Date(l.end_date) < new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {new Date(l.end_date).toLocaleDateString('it-IT')}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-amber-600">{fmt(intAnnuo)} €</td>
                  <td className="py-3 px-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => onAddEdit(l)}
                        className="p-1.5 hover:bg-blue-100 text-blue-600 rounded transition"
                        title="Modifica"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button
                        onClick={() => onDelete(l.id)}
                        className="p-1.5 hover:bg-red-100 text-red-600 rounded transition"
                        title="Elimina"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-amber-50/50 border-t border-slate-200">
              <td colSpan={2} className="py-3 px-4 text-sm font-semibold text-slate-700">Totale debiti</td>
              <td className="py-3 px-4 text-right font-bold text-red-600">{fmt(totDebiti)} €</td>
              <td colSpan={3} className="py-3 px-4 text-right font-bold text-amber-600">{fmt(intSociAnnuo + intBancariAnnuo)} €/anno</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Simulatore Interessi */}
      <div className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <div className="px-5 py-4 bg-purple-50/50 border-b border-purple-100 flex items-center gap-2">
          <Calculator size={18} className="text-purple-600" />
          <h3 className="font-semibold text-purple-900">Calcolo interessi finanziamenti</h3>
        </div>
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Soci */}
          <div className="space-y-3">
            <h4 className="font-medium text-slate-700">Finanziamenti soci</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Capitale residuo</label>
                <div className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-900">
                  {fmt(totSoci)} €
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-slate-500 mb-1">
                  <Percent size={12} /> Tasso annuo (%)
                </label>
                <input
                  type="number" step="0.1" min="0" max="20"
                  value={tassoSoci}
                  onChange={e => setTassoSoci(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div className="bg-purple-50 rounded-lg p-3">
                <div className="text-xs text-purple-600">Interesse annuo</div>
                <div className="text-lg font-bold text-purple-900">{fmt(intSociAnnuo)} €</div>
              </div>
            </div>
          </div>

          {/* Bancari */}
          <div className="space-y-3">
            <h4 className="font-medium text-slate-700">Finanziamenti bancari</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Capitale residuo</label>
                <div className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-900">
                  {fmt(totBancari)} €
                </div>
              </div>
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-slate-500 mb-1">
                  <Percent size={12} /> Tasso annuo (%)
                </label>
                <input
                  type="number" step="0.1" min="0" max="20"
                  value={tassoMps}
                  onChange={e => setTassoMps(parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <div className="text-xs text-amber-600">Interesse annuo</div>
                <div className="text-lg font-bold text-amber-900">{fmt(intBancariAnnuo)} €</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-3 bg-red-50/50 border border-red-100 rounded-xl p-4">
        <Info size={18} className="text-red-600 mt-0.5 shrink-0" />
        <div className="text-sm text-red-800">
          <span className="font-semibold">Totale oneri finanziari stimati: {fmt(intSociAnnuo + intBancariAnnuo)} €/anno</span>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Composizione liquidità (Pie)
   ──────────────────────────────────────── */
function SezioneComposizione({ accounts, totalLiquidity }) {
  const contiCorr = accounts.filter(c => c.account_type === 'conto_corrente').reduce((s, c) => s + c.current_balance, 0)
  const depositi = accounts.filter(c => c.account_type === 'deposito').reduce((s, c) => s + c.current_balance, 0)
  const casse = accounts.filter(c => c.account_type === 'cassa').reduce((s, c) => s + c.current_balance, 0)

  const pieData = [
    { name: 'C/C', value: contiCorr, color: '#3b82f6' },
    { name: 'Depositi', value: depositi, color: '#8b5cf6' },
    { name: 'Casse', value: casse, color: '#10b981' },
  ]

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-5">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Composizione liquidità</h3>
      <div className="flex items-center gap-6">
        <ResponsiveContainer width={180} height={180}>
          <PieChart>
            <defs>
              {pieData.map((d, i) => (
                <linearGradient key={i} id={`pie-grad-compo-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={d.color} stopOpacity={1} />
                  <stop offset="100%" stopColor={d.color} stopOpacity={0.6} />
                </linearGradient>
              ))}
            </defs>
            <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} strokeWidth={0}>
              {pieData.map((d, i) => <Cell key={i} fill={`url(#pie-grad-compo-${i})`} stroke="white" strokeWidth={2} />)}
            </Pie>
            <Tooltip content={<GlassTooltip formatter={v => `${fmt(v)} €`} suffix="" />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-3">
          {pieData.filter(d => d.value > 0).map(d => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
              <div>
                <div className="text-sm font-medium text-slate-700">{d.name}</div>
                <div className="text-xs text-slate-400">{fmt(d.value)} € ({totalLiquidity > 0 ? ((d.value / totalLiquidity) * 100).toFixed(1) : 0}%)</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Movimenti Reali (cash_movements)
   ──────────────────────────────────────── */
function SezioneMovimentiReali({ movements, setMovements, accounts, search, loading, onLoadMore, hasMore, selectedAccountId, onSelectAccount }) {
  const [subTab, setSubTab] = useState('tutti') // tutti, entrate, uscite, da_verificare
  const [togglingId, setTogglingId] = useState(null)

  const filtered = useMemo(() => {
    let list = movements || []
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        (m.description || '').toLowerCase().includes(q) ||
        (m.counterpart || '').toLowerCase().includes(q)
      )
    }
    // Sub-tab filter
    if (subTab === 'entrate') list = list.filter(m => m.type === 'entrata')
    else if (subTab === 'uscite') list = list.filter(m => m.type === 'uscita')
    else if (subTab === 'da_verificare') list = list.filter(m => !m.verified)
    return list
  }, [movements, search, subTab])

  // KPI calcolati sui movimenti caricati (non solo quelli filtrati per sub-tab)
  const kpi = useMemo(() => {
    const all = movements || []
    const entrate = all.filter(m => m.type === 'entrata').reduce((s, m) => s + Number(m.amount || 0), 0)
    const uscite = all.filter(m => m.type === 'uscita').reduce((s, m) => s + Number(m.amount || 0), 0)
    const nonVerificati = all.filter(m => !m.verified).length
    return { count: all.length, entrate, uscite, netto: entrate - uscite, nonVerificati }
  }, [movements])

  const getAccountName = (id) => {
    const acc = accounts.find(a => a.id === id)
    return acc ? `${acc.bank_name} — ${acc.account_name}` : '—'
  }

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('it-IT') : '—'

  const handleToggleVerified = async (movement) => {
    setTogglingId(movement.id)
    try {
      const newVal = !movement.verified
      const { error } = await supabase
        .from('cash_movements')
        .update({
          verified: newVal,
          verified_at: newVal ? new Date().toISOString() : null,
        })
        .eq('id', movement.id)
      if (!error && setMovements) {
        setMovements(prev => prev.map(m =>
          m.id === movement.id
            ? { ...m, verified: newVal, verified_at: newVal ? new Date().toISOString() : null }
            : m
        ))
      }
    } catch (e) {
      console.error('Toggle verified error:', e)
    } finally {
      setTogglingId(null)
    }
  }

  const subTabs = [
    { key: 'tutti', label: 'Tutti', count: movements?.length || 0 },
    { key: 'entrate', label: 'Entrate', count: (movements || []).filter(m => m.type === 'entrata').length },
    { key: 'uscite', label: 'Uscite', count: (movements || []).filter(m => m.type === 'uscita').length },
    { key: 'da_verificare', label: 'Da verificare', count: kpi.nonVerificati },
  ]

  return (
    <div className="space-y-4">
      {/* KPI barra leggera stile Sibill */}
      <div className="flex items-center gap-6 px-1 text-sm">
        <span className="text-slate-400">{kpi.count} movimenti</span>
        <span className="text-slate-300">|</span>
        <span className="text-emerald-600 font-medium flex items-center gap-1">
          <ArrowDownLeft size={13} /> +{fmt(kpi.entrate)} €
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-red-500 font-medium flex items-center gap-1">
          <ArrowUpRight size={13} /> -{fmt(kpi.uscite)} €
        </span>
        <span className="text-slate-300">|</span>
        <span className={`font-semibold ${kpi.netto >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
          Netto {kpi.netto >= 0 ? '+' : ''}{fmt(kpi.netto)} €
        </span>
      </div>

      {/* Sub-tab + filtro conto */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-slate-100/80 rounded-lg p-0.5">
          {subTabs.map(t => (
            <button key={t.key} onClick={() => setSubTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
                subTab === t.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label}
              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${
                subTab === t.key ? 'bg-slate-100 text-slate-600' : 'bg-transparent text-slate-400'
              }`}>{t.count}</span>
            </button>
          ))}
        </div>
        <select
          value={selectedAccountId || ''}
          onChange={e => onSelectAccount(e.target.value || null)}
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 bg-white text-slate-600"
        >
          <option value="">Tutti i conti</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>
          ))}
        </select>
      </div>

      {/* Tabella movimenti */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">Caricamento movimenti...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            {subTab === 'da_verificare'
              ? 'Tutti i movimenti sono stati verificati.'
              : 'Nessun movimento trovato. Importare un estratto conto per visualizzare i movimenti.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] text-slate-400 uppercase tracking-wider">
                    <th className="py-2.5 px-4 text-left font-medium">Data</th>
                    <th className="py-2.5 px-4 text-left font-medium">Descrizione</th>
                    <th className="py-2.5 px-4 text-left font-medium">Controparte</th>
                    <th className="py-2.5 px-4 text-right font-medium">Importo</th>
                    <th className="py-2.5 px-4 text-right font-medium">Saldo</th>
                    <th className="py-2.5 px-4 text-center font-medium w-20">Verificato</th>
                    <th className="py-2.5 px-4 text-center font-medium w-16">Riconc.</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => {
                    const isEntrata = m.type === 'entrata'
                    return (
                      <tr key={m.id} className="border-b border-slate-50 hover:bg-blue-50/30 transition group">
                        <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap text-xs">
                          {fmtDate(m.date)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-800 max-w-[280px]">
                          <span className="block truncate text-[13px]" title={m.description || ''}>
                            {m.description || '—'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs text-slate-500 max-w-[180px] truncate" title={m.counterpart || ''}>
                          {m.counterpart || '—'}
                        </td>
                        <td className={`py-2.5 px-4 text-right font-medium whitespace-nowrap text-[13px] ${isEntrata ? 'text-emerald-600' : 'text-red-500'}`}>
                          {isEntrata ? '+' : '-'}{fmt(Math.abs(m.amount))} €
                        </td>
                        <td className="py-2.5 px-4 text-right text-xs text-slate-400 whitespace-nowrap">
                          {m.balance_after != null ? `${fmt(m.balance_after)} €` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <button
                            onClick={() => handleToggleVerified(m)}
                            disabled={togglingId === m.id}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition cursor-pointer ${
                              m.verified
                                ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                : 'bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                            }`}
                          >
                            {togglingId === m.id ? (
                              <Clock size={11} className="animate-spin" />
                            ) : m.verified ? (
                              <><CheckCircle2 size={11} /> Sì</>
                            ) : (
                              <><CircleDot size={11} /> No</>
                            )}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {m.is_reconciled ? (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 font-medium">
                              <Link2 size={11} /> Sì
                            </span>
                          ) : (
                            <span className="text-slate-300 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <div className="p-3 text-center border-t border-slate-100">
                <button
                  onClick={onLoadMore}
                  className="px-4 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition"
                >
                  Carica altri movimenti...
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Movimenti Bancari (legacy bank_transactions)
   ──────────────────────────────────────── */
function SezioneMovimenti({ transactions, accounts, suppliers, search }) {
  const filtered = useMemo(() => {
    let list = transactions || []
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.counterpart || '').toLowerCase().includes(q) ||
        (t.reference || '').toLowerCase().includes(q)
      )
    }
    return list.slice(0, 100)
  }, [transactions, search])

  const getAccountName = (id) => {
    const acc = accounts.find(a => a.id === id)
    return acc ? `${acc.bank_name} — ${acc.account_name}` : '—'
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
        <ListOrdered size={20} className="text-indigo-600" />
        Movimenti bancari
        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{transactions.length} operazioni</span>
      </h2>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            Nessun movimento trovato. Importare un estratto conto per visualizzare i movimenti.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-4 text-left font-medium">Data</th>
                  <th className="py-2.5 px-4 text-left font-medium">Conto</th>
                  <th className="py-2.5 px-4 text-left font-medium">Descrizione</th>
                  <th className="py-2.5 px-4 text-left font-medium">Controparte</th>
                  <th className="py-2.5 px-4 text-right font-medium">Dare</th>
                  <th className="py-2.5 px-4 text-right font-medium">Avere</th>
                  <th className="py-2.5 px-4 text-right font-medium">Saldo</th>
                  <th className="py-2.5 px-4 text-center font-medium">Collegato</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                    <td className="py-2 px-4 text-slate-600">
                      {t.transaction_date ? new Date(t.transaction_date).toLocaleDateString('it-IT') : '—'}
                    </td>
                    <td className="py-2 px-4 text-xs text-slate-500">{getAccountName(t.bank_account_id)}</td>
                    <td className="py-2 px-4 text-slate-900 max-w-64 truncate">{t.description || '—'}</td>
                    <td className="py-2 px-4 text-slate-500 text-xs">{t.counterpart || '—'}</td>
                    <td className="py-2 px-4 text-right text-red-600 font-medium">
                      {t.amount < 0 ? fmt(Math.abs(t.amount)) : ''}
                    </td>
                    <td className="py-2 px-4 text-right text-emerald-600 font-medium">
                      {t.amount >= 0 ? fmt(t.amount) : ''}
                    </td>
                    <td className="py-2 px-4 text-right font-medium">{t.running_balance != null ? fmt(t.running_balance) : '—'}</td>
                    <td className="py-2 px-4 text-center">
                      {t.payable_id || t.supplier_id ? (
                        <Link2 size={14} className="text-blue-500 mx-auto" />
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Import Estratto Conto
   ──────────────────────────────────────── */
function SezioneImport({ accounts, onImportComplete }) {
  const [selectedAccount, setSelectedAccount] = useState('')
  const [format, setFormat] = useState('standard')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef(null)

  const formats = [
    { key: 'standard', label: 'Standard (CSV semicolon)', desc: 'Data;Descrizione;Dare;Avere;Saldo' },
    { key: 'mensile', label: 'Mensile banca', desc: 'Formato mensile con data valuta' },
    { key: 'trimestrale', label: 'Trimestrale', desc: 'Estratto conto trimestrale' },
    { key: 'pos', label: 'POS / Carte', desc: 'Movimenti POS e carte di credito' },
  ]

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selectedAccount) return

    setImporting(true)
    setImportResult(null)
    try {
      const text = await file.text()
      const lines = text.split('\n').filter(l => l.trim())

      // Skip header row
      const dataLines = lines.slice(1)
      let imported = 0
      let errors = 0

      for (const line of dataLines) {
        try {
          let parts
          if (format === 'pos') {
            // POS format: Date,Reference,Amount,Card
            parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
            if (parts.length < 3) continue
            const amount = parseFloat(parts[2]?.replace('.', '').replace(',', '.')) || 0
            await supabase.from('bank_transactions').insert({
              bank_account_id: selectedAccount,
              transaction_date: parts[0] || new Date().toISOString().slice(0, 10),
              description: parts[1] || 'POS',
              amount: -Math.abs(amount), // POS are always outgoing
              reference: parts[3] || '',
              source_format: 'pos',
            })
          } else {
            // Standard/mensile/trimestrale: semicolon separated
            parts = line.split(';').map(s => s.trim().replace(/^"|"$/g, ''))
            if (parts.length < 4) continue
            const dare = parseFloat(parts[2]?.replace('.', '').replace(',', '.')) || 0
            const avere = parseFloat(parts[3]?.replace('.', '').replace(',', '.')) || 0
            const saldo = parts[4] ? parseFloat(parts[4]?.replace('.', '').replace(',', '.')) : null

            await supabase.from('bank_transactions').insert({
              bank_account_id: selectedAccount,
              transaction_date: parts[0] || new Date().toISOString().slice(0, 10),
              description: parts[1] || '',
              amount: avere > 0 ? avere : -dare,
              running_balance: saldo,
              source_format: format,
            })
          }
          imported++
        } catch {
          errors++
        }
      }

      // Update account last_update
      await supabase.from('bank_accounts')
        .update({ last_update: new Date().toISOString() })
        .eq('id', selectedAccount)

      setImportResult({ imported, errors, total: dataLines.length })
      onImportComplete()
    } catch (err) {
      console.error('Import error:', err)
      setImportResult({ imported: 0, errors: 1, total: 0, error: err.message })
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
        <Upload size={16} /> Import estratto conto
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Conto destinazione</label>
          <select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
            <option value="">Seleziona conto...</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Formato file</label>
          <select value={format} onChange={e => setFormat(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
            {formats.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <p className="text-[10px] text-slate-400 mt-0.5">{formats.find(f => f.key === format)?.desc}</p>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">File</label>
          <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition ${
            !selectedAccount ? 'border-slate-200 text-slate-300 cursor-not-allowed' : 'border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100'
          }`}>
            <FileUp size={14} /> {importing ? 'Importazione...' : 'Carica CSV'}
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" disabled={!selectedAccount || importing} />
          </label>
        </div>
      </div>
      {importResult && (
        <div className={`p-3 rounded-lg text-sm ${importResult.errors > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-emerald-50 border border-emerald-200'}`}>
          {importResult.error
            ? <p className="text-red-700">Errore: {importResult.error}</p>
            : <p className={importResult.errors > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                Importate {importResult.imported}/{importResult.total} operazioni
                {importResult.errors > 0 && ` (${importResult.errors} errori)`}
              </p>
          }
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────
   Sezione: Riconciliazione bancaria (v2)
   ──────────────────────────────────────── */
function SezioneRiconciliazione({ companyId, accounts }) {
  const [reconData, setReconData] = useState({ reconciled: [], suggested: [], unmatched: [] })
  const [reconLog, setReconLog] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [stats, setStats] = useState({ reconciled: 0, suggested: 0, unmatched: 0 })
  const [openSection, setOpenSection] = useState('suggested') // reconciled | suggested | unmatched
  const [logOpen, setLogOpen] = useState(false)
  const [filterAccountId, setFilterAccountId] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')
  const [actionLoading, setActionLoading] = useState(null) // id of item being acted upon
  const [manualSearchOpen, setManualSearchOpen] = useState(null) // movementId for manual search
  const [manualSearchQuery, setManualSearchQuery] = useState('')
  const [unpaidPayables, setUnpaidPayables] = useState([])
  const [payablesLoading, setPayablesLoading] = useState(false)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [hasRunThisSession, setHasRunThisSession] = useState(false)
  const [expandedMovement, setExpandedMovement] = useState(null) // movementId expanded to show candidates
  // Pagination
  const PAGE_SIZE = 20
  const [reconciledPage, setReconciledPage] = useState(1)
  const [suggestedPage, setSuggestedPage] = useState(1)
  const [unmatchedPage, setUnmatchedPage] = useState(1)
  const [logPage, setLogPage] = useState(1)

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('it-IT') : '—'
  const fmtEuro = (n) => n != null ? `€${fmt(n)}` : '—'

  // ── Load persisted reconciliation state from DB on mount ──
  useEffect(() => {
    if (!companyId || initialLoaded) return
    const loadPersistedState = async () => {
      try {
        // 1. Fetch already-reconciled movements
        const { data: reconMovements } = await supabase
          .from('cash_movements')
          .select('*')
          .eq('company_id', companyId)
          .eq('type', 'uscita')
          .eq('is_reconciled', true)
          .order('date', { ascending: true })

        // 2. Fetch payables linked to movements
        const { data: linkedPayables } = await supabase
          .from('payables')
          .select('*, suppliers(id, ragione_sociale, name)')
          .eq('company_id', companyId)
          .not('cash_movement_id', 'is', null)

        // 3. Build reconciled pairs
        const payableByMovId = {}
        for (const p of (linkedPayables || [])) {
          payableByMovId[p.cash_movement_id] = p
        }
        const reconciledItems = (reconMovements || []).map(m => ({
          movement: m,
          payable: payableByMovId[m.id] || null,
          matchType: 'confermato',
          score: 100,
        })).filter(item => item.payable)

        if (reconciledItems.length > 0) {
          setReconData(prev => ({ ...prev, reconciled: reconciledItems }))
          setStats(prev => ({ ...prev, reconciled: reconciledItems.length }))
        }
        setInitialLoaded(true)
      } catch (err) {
        console.error('Error loading persisted reconciliation state:', err)
        setInitialLoaded(true)
      }
    }
    loadPersistedState()
  }, [companyId, initialLoaded])

  const handleRunAutoReconciliation = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await runAutoReconciliation(companyId, filterAccountId || null)

      // Merge: keep previously-saved reconciled items + add new ones from this run
      setReconData(prev => {
        const existingReconIds = new Set(prev.reconciled.map(r => r.movement?.id))
        const newReconciled = (result.reconciled || []).filter(r => !existingReconIds.has(r.movement?.id))
        return {
          reconciled: [...prev.reconciled, ...newReconciled],
          suggested: result.suggested || [],
          unmatched: result.unmatched || [],
        }
      })
      setStats(prev => ({
        reconciled: prev.reconciled + (result.reconciled || []).length,
        suggested: (result.suggested || []).length,
        unmatched: (result.unmatched || []).length,
      }))
      setHasRunThisSession(true)

      if (result.errors && result.errors.length > 0) {
        const errMsgs = result.errors.map(e => e.message || JSON.stringify(e)).join('; ')
        setError(`Completato con ${result.errors.length} errori: ${errMsgs}`)
        console.error('Reconciliation errors:', result.errors)
      }
      // Reset pagination
      setReconciledPage(1)
      setSuggestedPage(1)
      setUnmatchedPage(1)
    } catch (err) {
      console.error('Reconciliation error:', err)
      setError(err.message || 'Errore durante la riconciliazione')
    } finally {
      setLoading(false)
    }
  }, [companyId, filterAccountId])

  const loadLog = useCallback(async () => {
    try {
      const filters = {}
      if (filterAccountId) filters.bankAccountId = filterAccountId
      if (filterDateFrom) filters.dateFrom = filterDateFrom
      if (filterDateTo) filters.dateTo = filterDateTo
      const result = await getReconciliationLog(companyId, filters)
      setReconLog(result?.data || [])
      setLogPage(1)
    } catch (err) {
      console.error('Log load error:', err)
      setReconLog([])
    }
  }, [companyId, filterAccountId, filterDateFrom, filterDateTo])

  const handleConfirm = async (movementId, payableId) => {
    setActionLoading(movementId)
    try {
      await applyReconciliation(movementId, payableId, 'confermato', '')
      // Move from suggested to reconciled — use the CHOSEN payable (not necessarily the "best")
      setReconData(prev => {
        const suggestedItem = prev.suggested.find(s => s.movement?.id === movementId)
        if (!suggestedItem) return prev
        // Find the chosen candidate's payable from the candidates list
        const chosenCandidate = suggestedItem.candidates?.find(c => c.payable?.id === payableId)
        const chosenPayable = chosenCandidate?.payable || suggestedItem.payable
        return {
          ...prev,
          suggested: prev.suggested.filter(s => s.movement?.id !== movementId),
          reconciled: [...prev.reconciled, {
            movement: suggestedItem.movement,
            payable: chosenPayable,
            matchType: 'confermato',
            score: chosenCandidate?.score || suggestedItem.score,
          }],
        }
      })
      setExpandedMovement(null)
      setStats(prev => ({ ...prev, suggested: prev.suggested - 1, reconciled: prev.reconciled + 1 }))
    } catch (err) {
      alert('Errore: ' + (err.message || 'Impossibile confermare'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (movementId, payableId) => {
    // Confirm with operator
    const ok = window.confirm(
      'Rifiuti questo abbinamento?\n\n' +
      'Il movimento tornerà tra quelli senza match e questa coppia non verrà più proposta in futuro.\n' +
      'La fattura resta invariata nel suo stato attuale.'
    )
    if (!ok) return

    setActionLoading(movementId)
    try {
      // 1. Remove suggestion log entry
      if (payableId) {
        await supabase
          .from('reconciliation_log')
          .delete()
          .eq('cash_movement_id', movementId)
          .eq('payable_id', payableId)
          .eq('match_type', 'auto_fuzzy')
      }
      // 2. Save rejected pair so engine won't re-suggest it
      if (payableId) {
        await supabase
          .from('reconciliation_rejected_pairs')
          .upsert({
            company_id: companyId,
            cash_movement_id: movementId,
            payable_id: payableId,
          }, { onConflict: 'cash_movement_id,payable_id' })
      }
      // 3. Move from suggested to unmatched
      setReconData(prev => {
        const item = prev.suggested.find(s => s.movement?.id === movementId)
        return {
          ...prev,
          suggested: prev.suggested.filter(s => s.movement?.id !== movementId),
          unmatched: item ? [...prev.unmatched, { movement: item.movement }] : prev.unmatched,
        }
      })
      setStats(prev => ({ ...prev, suggested: prev.suggested - 1, unmatched: prev.unmatched + 1 }))
    } catch (err) {
      alert('Errore: ' + (err.message || 'Impossibile rifiutare'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleUnlink = async (movementId, payableId) => {
    // Find the item to show details in the confirmation
    const item = reconData.reconciled.find(r => r.movement?.id === movementId)
    const supplierName = item?.payable?.suppliers?.ragione_sociale || item?.payable?.suppliers?.name || 'fornitore'
    const invoiceNum = item?.payable?.invoice_number || ''
    const amount = item?.movement?.amount ? `€${Math.abs(item.movement.amount).toFixed(2)}` : ''

    const ok = window.confirm(
      `Stai scollegando questo movimento dalla fattura ${invoiceNum} di ${supplierName} per ${amount}.\n\n` +
      `La fattura tornerà allo stato precedente la riconciliazione e il movimento dovrà essere riabbinato.\n` +
      `L'operazione verrà registrata nel log di audit.\n\n` +
      `Continuare?`
    )
    if (!ok) return

    setActionLoading(movementId)
    try {
      await undoReconciliation(movementId, payableId)
      // Scollega → move to "Da Confermare" (not Senza Match)
      // The movement exists and was already matched — operator just says "wrong match"
      setReconData(prev => {
        const item = prev.reconciled.find(r => r.movement?.id === movementId)
        return {
          ...prev,
          reconciled: prev.reconciled.filter(r => r.movement?.id !== movementId),
          suggested: item ? [...prev.suggested, { ...item, matchType: 'da_rivedere', score: 0 }] : prev.suggested,
        }
      })
      setStats(prev => ({ ...prev, reconciled: prev.reconciled - 1, suggested: prev.suggested + 1 }))
    } catch (err) {
      alert('Errore: ' + (err.message || 'Impossibile scollegare'))
    } finally {
      setActionLoading(null)
    }
  }

  const handleManualMatch = async (movementId, payableId) => {
    setActionLoading(movementId)
    try {
      await applyReconciliation(movementId, payableId, 'manuale', '')
      setReconData(prev => {
        const item = prev.unmatched.find(u => u.movement?.id === movementId)
        const payable = unpaidPayables.find(p => p.id === payableId)
        return {
          ...prev,
          unmatched: prev.unmatched.filter(u => u.movement?.id !== movementId),
          reconciled: item ? [...prev.reconciled, { ...item, payable, matchType: 'manuale', confidence: 100 }] : prev.reconciled,
        }
      })
      setStats(prev => ({ ...prev, unmatched: prev.unmatched - 1, reconciled: prev.reconciled + 1 }))
      setManualSearchOpen(null)
      setManualSearchQuery('')
    } catch (err) {
      alert('Errore: ' + (err.message || 'Impossibile collegare'))
    } finally {
      setActionLoading(null)
    }
  }

  const loadUnpaidPayables = async () => {
    if (unpaidPayables.length > 0) return
    setPayablesLoading(true)
    try {
      const { data } = await supabase
        .from('payables')
        .select('id, invoice_number, gross_amount, due_date, supplier_id, suppliers(ragione_sociale, name)')
        .eq('company_id', companyId)
        .is('cash_movement_id', null)
        .order('due_date', { ascending: false })
        .limit(200)
      setUnpaidPayables(data || [])
    } catch (err) {
      console.error('Error loading payables:', err)
    } finally {
      setPayablesLoading(false)
    }
  }

  const openManualSearch = (movementId) => {
    setManualSearchOpen(movementId)
    setManualSearchQuery('')
    loadUnpaidPayables()
  }

  const filteredPayables = useMemo(() => {
    if (!manualSearchQuery) return unpaidPayables.slice(0, 20)
    const q = manualSearchQuery.toLowerCase()
    return unpaidPayables.filter(p =>
      (p.suppliers?.ragione_sociale || '').toLowerCase().includes(q) ||
      (p.suppliers?.name || '').toLowerCase().includes(q) ||
      (p.invoice_number || '').toLowerCase().includes(q) ||
      String(p.gross_amount).includes(q)
    ).slice(0, 20)
  }, [unpaidPayables, manualSearchQuery])

  const confidenceColor = (score) => {
    if (score >= 65) return 'bg-yellow-400'
    return 'bg-amber-500'
  }

  const confidenceTextColor = (score) => {
    if (score >= 65) return 'text-yellow-700'
    return 'text-amber-700'
  }

  const paginate = (arr, page) => arr.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = (arr) => Math.max(1, Math.ceil(arr.length / PAGE_SIZE))

  const PaginationControls = ({ page, setPage, total }) => {
    const tp = totalPages(total)
    if (tp <= 1) return null
    return (
      <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
        <span>Pagina {page} di {tp} ({total.length} elementi)</span>
        <div className="flex gap-1">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30 transition">Prec.</button>
          <button disabled={page >= tp} onClick={() => setPage(p => p + 1)}
            className="px-2 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-30 transition">Succ.</button>
        </div>
      </div>
    )
  }

  const SectionHeader = ({ sectionKey, label, count, borderColor, icon: SIcon }) => (
    <button
      onClick={() => setOpenSection(openSection === sectionKey ? null : sectionKey)}
      className="w-full flex items-center justify-between p-4 hover:bg-slate-50/50 transition"
    >
      <div className="flex items-center gap-3">
        <div className={`w-1 h-8 rounded-full ${borderColor}`} />
        <SIcon size={18} className="text-slate-500" />
        <span className="font-semibold text-slate-900">{label}</span>
        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{count}</span>
      </div>
      {openSection === sectionKey ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* ── Action Bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <button
            onClick={handleRunAutoReconciliation}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition shadow-sm"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Riconciliazione in corso...' : 'Avvia Riconciliazione Automatica'}
          </button>

          <div className="flex items-center gap-4 text-sm flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span className="font-medium text-slate-700">{stats.reconciled}</span>
              <span className="text-slate-400">riconciliati</span>
            </span>
            <span className="text-slate-300">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="font-medium text-slate-700">{stats.suggested}</span>
              <span className="text-slate-400">da confermare</span>
            </span>
            <span className="text-slate-300">|</span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
              <span className="font-medium text-slate-700">{stats.unmatched}</span>
              <span className="text-slate-400">senza match</span>
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Conto bancario</label>
            <select value={filterAccountId} onChange={e => setFilterAccountId(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Tutti i conti</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Data da</label>
            <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Data a</label>
            <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Info per l'operatore — diverso se prima o dopo aver avviato */}
        {!hasRunThisSession ? (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50/60 border border-blue-100 text-xs text-blue-700 leading-relaxed">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Clicca "Avvia Riconciliazione Automatica"</strong> per abbinare i movimenti bancari alle fatture fornitori.
              Il sistema analizza importi, nomi e date per trovare le corrispondenze.
              {stats.reconciled > 0 && (
                <> Gli <strong>{stats.reconciled} abbinamenti già confermati</strong> in precedenza sono visibili nella sezione Riconciliati.</>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50/60 border border-emerald-100 text-xs text-emerald-700 leading-relaxed">
            <Info size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Riconciliazione completata.</strong>{' '}
              I <strong>riconciliati</strong> (in verde) sono confermati e salvati in modo permanente.{' '}
              I <strong>da confermare</strong> (in arancione) mostrano i movimenti con le fatture candidate per importo — clicca su un movimento per vedere le opzioni e scegli la fattura corretta.{' '}
              I <strong>senza match</strong> possono essere collegati manualmente cercando la fattura.{' '}
              Tutte le operazioni sono registrate nella <strong>Cronologia</strong>.
            </div>
          </div>
        )}
      </div>

      {/* ── Section: Riconciliati ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <SectionHeader sectionKey="reconciled" label="Riconciliati" count={stats.reconciled} borderColor="bg-emerald-500" icon={Link2} />
        {openSection === 'reconciled' && (
          <>
            {reconData.reconciled.length === 0 ? (
              <div className="p-8 text-center border-t border-slate-100">
                <p className="text-slate-400 text-sm">Nessun movimento riconciliato al momento.</p>
                <p className="text-slate-300 text-xs mt-1">Quando confermi un abbinamento, lo troverai qui. I dati riconciliati sono salvati e non si perdono.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-4 text-left font-medium">Data Mov.</th>
                      <th className="py-2.5 px-4 text-left font-medium">Descrizione Banca</th>
                      <th className="py-2.5 px-4 text-right font-medium">Importo</th>
                      <th className="py-2.5 px-4 text-center font-medium"><ArrowLeftRight size={12} className="inline" /></th>
                      <th className="py-2.5 px-4 text-left font-medium">Fornitore</th>
                      <th className="py-2.5 px-4 text-left font-medium">N. Fattura</th>
                      <th className="py-2.5 px-4 text-right font-medium">Imp. Fattura</th>
                      <th className="py-2.5 px-4 text-center font-medium">Tipo</th>
                      <th className="py-2.5 px-4 text-center font-medium">Conf. %</th>
                      <th className="py-2.5 px-4 text-center font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginate(reconData.reconciled, reconciledPage).map((item, i) => (
                      <tr key={item.movement?.id || i} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                        <td className="py-2 px-4 text-slate-600 whitespace-nowrap border-l-4 border-l-emerald-500">
                          {fmtDate(item.movement?.date || item.movement?.transaction_date)}
                        </td>
                        <td className="py-2 px-4 text-slate-900 max-w-[280px] relative group">
                          <span className="block truncate cursor-help">{item.movement?.description || '—'}</span>
                          {item.movement?.description && (
                            <div className="hidden group-hover:block absolute z-50 left-0 top-full mt-1 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl max-w-md whitespace-pre-wrap leading-relaxed border border-slate-600">
                              <div className="font-semibold text-slate-300 mb-1">Descrizione completa:</div>
                              {item.movement.description}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-4 text-right font-medium text-red-600 whitespace-nowrap">
                          {fmtEuro(item.movement?.amount)}
                        </td>
                        <td className="py-2 px-4 text-center"><Link2 size={14} className="text-emerald-500 mx-auto" /></td>
                        <td className="py-2 px-4 text-slate-700">{item.payable?.suppliers?.ragione_sociale || item.payable?.suppliers?.name || item.payable?.supplier_name || '—'}</td>
                        <td className="py-2 px-4 text-slate-500 text-xs">{item.payable?.invoice_number || '—'}</td>
                        <td className="py-2 px-4 text-right font-medium text-slate-700 whitespace-nowrap">
                          {fmtEuro(item.payable?.gross_amount || item.payable?.total_amount)}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.matchType === 'auto' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
                          }`}>
                            {item.matchType === 'auto' ? 'Auto' : item.matchType === 'manuale' ? 'Manuale' : 'Confermato'}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-center">
                          <span className="text-xs font-medium text-emerald-700">{(item.score || item.confidence) != null ? `${item.score || item.confidence}%` : '—'}</span>
                        </td>
                        <td className="py-2 px-4 text-center">
                          <button
                            onClick={() => handleUnlink(item.movement?.id, item.payable?.id)}
                            disabled={actionLoading === item.movement?.id}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                            title="Scollega"
                          >
                            <Unlink size={12} /> Scollega
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PaginationControls page={reconciledPage} setPage={setReconciledPage} total={reconData.reconciled} />
          </>
        )}
      </div>

      {/* ── Section: Da Confermare (NEW: candidate list per movement) ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <SectionHeader sectionKey="suggested" label="Da Confermare" count={stats.suggested} borderColor="bg-amber-500" icon={AlertCircle} />
        {openSection === 'suggested' && (
          <>
            {reconData.suggested.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm border-t border-slate-100">
                <div className="mb-2">Nessun movimento da abbinare.</div>
                <div>Clicca <strong>"Avvia Riconciliazione Automatica"</strong> per analizzare i movimenti bancari e trovare le corrispondenze con le fatture fornitori.</div>
              </div>
            ) : (
              <div className="border-t border-slate-100">
                {/* Info banner for operator */}
                <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 flex items-start gap-2">
                  <Info size={14} className="text-amber-500 mt-0.5 shrink-0" />
                  <div>
                    <strong>Come funziona:</strong> Per ogni movimento bancario sono elencate le fatture con importo corrispondente.
                    Clicca sulla riga del movimento per vedere tutte le fatture candidate, poi scegli quella corretta con il pulsante <strong>"Assegna"</strong>.
                    Se nessuna fattura corrisponde, clicca <strong>"Nessuna corrispondenza"</strong>.
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {paginate(reconData.suggested, suggestedPage).map((item, i) => {
                    const movId = item.movement?.id
                    const isExpanded = expandedMovement === movId
                    const candidateCount = item.candidates?.length || 1
                    const exactCount = (item.candidates || []).filter(c => c.details?.amountLabel === 'esatto').length
                    const bestCandidate = item.candidates?.[0] || { payable: item.payable, score: item.score, details: item.details }

                    return (
                      <div key={movId || i}>
                        {/* ── Movement row (clickable to expand candidates) ── */}
                        <div
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition ${isExpanded ? 'bg-amber-50/50' : ''}`}
                          onClick={() => setExpandedMovement(isExpanded ? null : movId)}
                        >
                          {/* Expand arrow */}
                          <div className="shrink-0 text-slate-400">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </div>

                          {/* Date */}
                          <div className="shrink-0 text-xs text-slate-500 w-20">
                            {fmtDate(item.movement?.date || item.movement?.transaction_date)}
                          </div>

                          {/* Description with tooltip */}
                          <div className="flex-1 min-w-0 relative group">
                            <div className="text-sm font-medium text-slate-900 truncate">{item.movement?.description || '—'}</div>
                            {item.movement?.description && (
                              <div className="hidden group-hover:block absolute z-50 left-0 top-full mt-1 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl max-w-md whitespace-pre-wrap leading-relaxed border border-slate-600">
                                <div className="font-semibold text-slate-300 mb-1">Descrizione completa:</div>
                                {item.movement.description}
                              </div>
                            )}
                          </div>

                          {/* Amount */}
                          <div className="shrink-0 text-sm font-bold text-red-600 w-28 text-right">
                            {fmtEuro(item.movement?.amount)}
                          </div>

                          {/* Candidate count badge */}
                          <div className="shrink-0 flex items-center gap-1.5">
                            {exactCount > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium">
                                {exactCount} {exactCount === 1 ? 'importo esatto' : 'importi esatti'}
                              </span>
                            )}
                            {candidateCount > exactCount && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                                +{candidateCount - exactCount} {candidateCount - exactCount === 1 ? 'simile' : 'simili'}
                              </span>
                            )}
                            {candidateCount === 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 text-xs">
                                nessuna corrispondenza
                              </span>
                            )}
                          </div>

                          {/* Quick action: if only 1 exact match, show quick-assign */}
                          <div className="shrink-0">
                            {!isExpanded && exactCount === 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const exactCandidate = (item.candidates || []).find(c => c.details?.amountLabel === 'esatto')
                                  if (exactCandidate) handleConfirm(movId, exactCandidate.payable?.id)
                                }}
                                disabled={actionLoading === movId}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition disabled:opacity-50"
                                title="Assegna il match esatto"
                              >
                                <Check size={12} /> Assegna
                              </button>
                            )}
                          </div>
                        </div>

                        {/* ── Expanded: Candidate list ── */}
                        {isExpanded && (
                          <div className="bg-slate-50/80 border-t border-slate-100">
                            <div className="px-4 py-2 text-xs text-slate-500 font-medium uppercase tracking-wider flex items-center gap-2 border-b border-slate-100">
                              <ListOrdered size={12} />
                              Fatture candidate per questo movimento — seleziona quella corretta
                            </div>

                            {(item.candidates && item.candidates.length > 0 ? item.candidates : [{ payable: item.payable, score: item.score, details: item.details }]).map((candidate, ci) => {
                              const cPayable = candidate.payable
                              const cDetails = candidate.details || {}
                              const isExact = cDetails.amountLabel === 'esatto'
                              const supplierName = cPayable?.suppliers?.ragione_sociale || cPayable?.suppliers?.name || '—'

                              return (
                                <div
                                  key={cPayable?.id || ci}
                                  className={`flex items-center gap-3 px-4 py-2.5 border-b border-slate-100 last:border-b-0 hover:bg-white transition ${isExact ? 'bg-emerald-50/40' : ''}`}
                                >
                                  {/* Rank indicator */}
                                  <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isExact ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                    {ci + 1}
                                  </div>

                                  {/* Amount match indicator */}
                                  <div className="shrink-0 w-24">
                                    {isExact ? (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                                        <Check size={10} /> 100%
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs">
                                        Δ €{cDetails.amountDiff || '?'} ({cDetails.pctDiff || '?'}%)
                                      </span>
                                    )}
                                  </div>

                                  {/* Supplier */}
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-800 truncate">{supplierName}</div>
                                    <div className="text-xs text-slate-500 flex items-center gap-2">
                                      <span>Fatt. {cPayable?.invoice_number || '—'}</span>
                                      <span>·</span>
                                      <span>{fmtEuro(cPayable?.gross_amount)}</span>
                                      {cPayable?.due_date && (
                                        <>
                                          <span>·</span>
                                          <span>Scad. {fmtDate(cPayable.due_date)}</span>
                                        </>
                                      )}
                                    </div>
                                  </div>

                                  {/* Name match badge */}
                                  <div className="shrink-0 w-28">
                                    {cDetails.nameScore >= 20 ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs">
                                        Nome ✓
                                      </span>
                                    ) : cDetails.nameScore >= 10 ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 text-xs">
                                        Nome ~
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 text-xs">
                                        Nome ?
                                      </span>
                                    )}
                                  </div>

                                  {/* Date proximity badge */}
                                  <div className="shrink-0 w-20">
                                    {cDetails.daysDiff != null && cDetails.daysDiff <= 30 ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-xs">
                                        {cDetails.daysDiff}gg
                                      </span>
                                    ) : cDetails.daysDiff != null ? (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-400 text-xs">
                                        {cDetails.daysDiff}gg
                                      </span>
                                    ) : null}
                                  </div>

                                  {/* Assign button */}
                                  <div className="shrink-0">
                                    <button
                                      onClick={() => handleConfirm(movId, cPayable?.id)}
                                      disabled={actionLoading === movId}
                                      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition disabled:opacity-50 ${
                                        isExact
                                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                                          : 'text-emerald-600 border border-emerald-200 hover:bg-emerald-50'
                                      }`}
                                    >
                                      <Check size={12} /> Assegna
                                    </button>
                                  </div>
                                </div>
                              )
                            })}

                            {/* "Nessuna corrispondenza" footer */}
                            <div className="px-4 py-2.5 bg-slate-50 flex items-center justify-between border-t border-slate-200">
                              <span className="text-xs text-slate-500">Nessuna di queste fatture corrisponde a questo movimento?</span>
                              <button
                                onClick={() => handleReject(movId, item.payable?.id)}
                                disabled={actionLoading === movId}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-300 hover:bg-slate-100 rounded-lg transition disabled:opacity-50"
                              >
                                <X size={12} /> Nessuna corrispondenza
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <PaginationControls page={suggestedPage} setPage={setSuggestedPage} total={reconData.suggested} />
          </>
        )}
      </div>

      {/* ── Section: Senza Match ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <SectionHeader sectionKey="unmatched" label="Senza Match" count={stats.unmatched} borderColor="bg-slate-400" icon={Unlink} />
        {openSection === 'unmatched' && (
          <>
            {reconData.unmatched.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm border-t border-slate-100">
                Nessun movimento senza match. Avvia la riconciliazione per vedere i movimenti non abbinati.
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-4 text-left font-medium">Data Mov.</th>
                      <th className="py-2.5 px-4 text-left font-medium">Descrizione Banca</th>
                      <th className="py-2.5 px-4 text-left font-medium">Controparte</th>
                      <th className="py-2.5 px-4 text-right font-medium">Importo</th>
                      <th className="py-2.5 px-4 text-center font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginate(reconData.unmatched, unmatchedPage).map((item, i) => (
                      <tr key={item.movement?.id || i} className="border-b border-slate-50 hover:bg-slate-50/50 transition relative">
                        <td className="py-2 px-4 text-slate-600 whitespace-nowrap border-l-4 border-l-slate-400">
                          {fmtDate(item.movement?.date || item.movement?.transaction_date)}
                        </td>
                        <td className="py-2 px-4 text-slate-900 max-w-[280px] relative group">
                          <span className="block truncate cursor-help">{item.movement?.description || '—'}</span>
                          {item.movement?.description && (
                            <div className="hidden group-hover:block absolute z-50 left-0 top-full mt-1 p-3 bg-slate-800 text-white text-xs rounded-lg shadow-xl max-w-md whitespace-pre-wrap leading-relaxed border border-slate-600">
                              <div className="font-semibold text-slate-300 mb-1">Descrizione completa:</div>
                              {item.movement.description}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-4 text-slate-500 text-xs">{item.movement?.counterpart || '—'}</td>
                        <td className="py-2 px-4 text-right font-medium text-red-600 whitespace-nowrap">
                          {fmtEuro(item.movement?.amount)}
                        </td>
                        <td className="py-2 px-4 text-center">
                          <div className="relative">
                            <button
                              onClick={() => openManualSearch(item.movement?.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition"
                              title="Cerca fattura"
                            >
                              <Search size={12} /> Cerca fattura
                            </button>
                            {/* Manual search dropdown */}
                            {manualSearchOpen === item.movement?.id && (
                              <div className="absolute right-0 top-full mt-1 w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-semibold text-slate-700">Cerca fattura da collegare</span>
                                  <button onClick={() => setManualSearchOpen(null)} className="p-1 hover:bg-slate-100 rounded transition">
                                    <X size={14} className="text-slate-400" />
                                  </button>
                                </div>
                                <div className="relative">
                                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                  <input
                                    type="text"
                                    placeholder="Fornitore, n. fattura, importo..."
                                    value={manualSearchQuery}
                                    onChange={e => setManualSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    autoFocus
                                  />
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                  {payablesLoading ? (
                                    <div className="text-center py-4 text-xs text-slate-400">Caricamento fatture...</div>
                                  ) : filteredPayables.length === 0 ? (
                                    <div className="text-center py-4 text-xs text-slate-400">Nessuna fattura trovata</div>
                                  ) : (
                                    filteredPayables.map(p => (
                                      <button
                                        key={p.id}
                                        onClick={() => handleManualMatch(item.movement?.id, p.id)}
                                        disabled={actionLoading === item.movement?.id}
                                        className="w-full flex items-center justify-between p-2 rounded-lg text-left hover:bg-blue-50 transition text-xs disabled:opacity-50"
                                      >
                                        <div>
                                          <div className="font-medium text-slate-900">{p.suppliers?.ragione_sociale || p.suppliers?.name || '—'}</div>
                                          <div className="text-slate-400">Fatt. {p.invoice_number || '—'} — Scad. {fmtDate(p.due_date)}</div>
                                        </div>
                                        <div className="font-medium text-slate-700 whitespace-nowrap ml-2">{fmtEuro(p.gross_amount)}</div>
                                      </button>
                                    ))
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PaginationControls page={unmatchedPage} setPage={setUnmatchedPage} total={reconData.unmatched} />
          </>
        )}
      </div>

      {/* ── Cronologia Riconciliazioni (log) ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => { setLogOpen(!logOpen); if (!logOpen) loadLog() }}
          className="w-full flex items-center justify-between p-4 hover:bg-slate-50/50 transition"
        >
          <div className="flex items-center gap-3">
            <History size={18} className="text-slate-500" />
            <span className="font-semibold text-slate-900">Cronologia Riconciliazioni</span>
            {reconLog.length > 0 && (
              <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{reconLog.length}</span>
            )}
          </div>
          {logOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {logOpen && (
          <>
            {reconLog.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm border-t border-slate-100">
                Nessuna operazione di riconciliazione registrata.
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-4 text-left font-medium">Data</th>
                      <th className="py-2.5 px-4 text-left font-medium">Azione</th>
                      <th className="py-2.5 px-4 text-left font-medium">Movimento</th>
                      <th className="py-2.5 px-4 text-left font-medium">Fattura</th>
                      <th className="py-2.5 px-4 text-center font-medium">Tipo</th>
                      <th className="py-2.5 px-4 text-left font-medium">Utente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginate(reconLog, logPage).map((entry, i) => (
                      <tr key={entry.id || i} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                        <td className="py-2 px-4 text-slate-600 whitespace-nowrap">{fmtDate(entry.performed_at || entry.created_at)}</td>
                        <td className="py-2 px-4">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            entry.match_type === 'auto_exact' ? 'bg-emerald-50 text-emerald-700' :
                            entry.match_type === 'unlinked' ? 'bg-red-50 text-red-700' :
                            entry.match_type === 'auto_fuzzy' ? 'bg-amber-50 text-amber-700' :
                            entry.match_type === 'manual' || entry.match_type === 'confermato' ? 'bg-blue-50 text-blue-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {entry.match_type === 'auto_exact' ? 'Auto' :
                             entry.match_type === 'auto_fuzzy' ? 'Proposta' :
                             entry.match_type === 'manual' ? 'Manuale' :
                             entry.match_type === 'confermato' ? 'Confermato' :
                             entry.match_type === 'unlinked' ? 'Scollegato' :
                             entry.match_type || '—'}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-slate-900 text-xs max-w-xs truncate" title={entry.cash_movements?.description || ''}>
                          {entry.cash_movements?.description
                            ? `${fmtDate(entry.cash_movements.date)} — ${entry.cash_movements.description.substring(0, 50)}…`
                            : entry.cash_movement_id?.substring(0, 8) || '—'}
                        </td>
                        <td className="py-2 px-4 text-slate-500 text-xs">
                          {entry.payables?.invoice_number || entry.payable_id?.substring(0, 8) || '—'}
                          {entry.payables?.suppliers?.ragione_sociale ? ` (${entry.payables.suppliers.ragione_sociale})` : ''}
                        </td>
                        <td className="py-2 px-4 text-center">
                          {entry.confidence != null && (
                            <span className="text-xs font-medium text-slate-600">{entry.confidence}%</span>
                          )}
                        </td>
                        <td className="py-2 px-4 text-slate-500 text-xs">{entry.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <PaginationControls page={logPage} setPage={setLogPage} total={reconLog} />
          </>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   PAGINA PRINCIPALE BANCHE
   ══════════════════════════════════════════ */
export default function Banche() {
  const { profile } = useAuth();
  const COMPANY_ID = profile?.company_id;

  const [accounts, setAccounts] = useState([])
  const [loans, setLoans] = useState([])
  const [transactions, setTransactions] = useState([])
  const [cashMovements, setCashMovements] = useState([])
  const [cashMovementsLoading, setCashMovementsLoading] = useState(false)
  const [cashMovementsHasMore, setCashMovementsHasMore] = useState(true)
  const [cashMovementsLimit, setCashMovementsLimit] = useState(50)
  const [cashMovementsAccountFilter, setCashMovementsAccountFilter] = useState(null)
  const [payableActions, setPayableActions] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [loanModalOpen, setLoanModalOpen] = useState(false)
  const [editingLoan, setEditingLoan] = useState(null)
  const [activeTab, setActiveTab] = useState('panoramica') // panoramica, movimenti, riconciliazione

  useEffect(() => {
    if (!COMPANY_ID) return;
    loadData()
  }, [COMPANY_ID])

  const loadCashMovements = async (limit = 50, accountId = null) => {
    try {
      setCashMovementsLoading(true)
      let query = supabase
        .from('cash_movements')
        .select('*')
        .eq('company_id', COMPANY_ID)
        .order('date', { ascending: false })
        .limit(limit)

      if (accountId) {
        query = query.eq('bank_account_id', accountId)
      }

      const { data, error } = await query
      if (error) {
        console.error('Error loading cash_movements:', error)
      } else {
        setCashMovements(data || [])
        setCashMovementsHasMore((data || []).length >= limit)
      }
    } catch (error) {
      console.error('Error loading cash_movements:', error)
    } finally {
      setCashMovementsLoading(false)
    }
  }

  const loadData = async () => {
    try {
      setLoading(true)
      const [accountsRes, loansRes, txRes, actionsRes] = await Promise.all([
        supabase.from('bank_accounts').select('*').eq('company_id', COMPANY_ID).eq('is_active', true),
        supabase.from('loans').select('*').eq('company_id', COMPANY_ID),
        supabase.from('bank_transactions').select('*').order('transaction_date', { ascending: false }).limit(200),
        supabase.from('payable_actions').select('*').in('action_type', ['pagamento', 'pagamento_parziale']).order('created_at', { ascending: false }).limit(100),
      ])

      if (accountsRes.data) setAccounts(accountsRes.data)
      if (loansRes.data) setLoans(loansRes.data)
      if (txRes.data) setTransactions(txRes.data)
      if (actionsRes.data) setPayableActions(actionsRes.data)

      // Also load cash_movements (real bank data)
      await loadCashMovements(cashMovementsLimit, cashMovementsAccountFilter)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Reload cash_movements when filter or limit changes
  useEffect(() => {
    if (!COMPANY_ID) return
    loadCashMovements(cashMovementsLimit, cashMovementsAccountFilter)
  }, [cashMovementsLimit, cashMovementsAccountFilter])

  const handleCashMovementsLoadMore = () => {
    setCashMovementsLimit(prev => prev + 50)
  }

  const handleCashMovementsAccountFilter = (accountId) => {
    setCashMovementsAccountFilter(accountId)
    setCashMovementsLimit(50) // reset pagination on filter change
  }

  const handleAddEditAccount = (account) => {
    setEditingAccount(account)
    setModalOpen(true)
  }

  const handleSaveAccount = async (formData) => {
    try {
      if (editingAccount?.id) {
        await supabase
          .from('bank_accounts')
          .update({ ...formData, last_update: new Date().toISOString() })
          .eq('id', editingAccount.id)
      } else {
        await supabase
          .from('bank_accounts')
          .insert([{
            ...formData,
            company_id: COMPANY_ID,
            is_active: true,
            last_update: new Date().toISOString()
          }])
      }
      await loadData()
    } catch (error) {
      console.error('Error saving account:', error)
      alert('Errore nel salvataggio')
    }
  }

  const handleDeleteAccount = async (id) => {
    if (confirm('Sei sicuro di voler eliminare questo conto?')) {
      try {
        await supabase
          .from('bank_accounts')
          .update({ is_active: false })
          .eq('id', id)
        await loadData()
      } catch (error) {
        console.error('Error deleting account:', error)
      }
    }
  }

  const handleAddEditLoan = (loan) => {
    setEditingLoan(loan)
    setLoanModalOpen(true)
  }

  const handleSaveLoan = async (formData) => {
    try {
      if (editingLoan?.id) {
        await supabase
          .from('loans')
          .update({
            description: formData.description,
            total_amount: formData.total_amount,
            interest_rate: formData.interest_rate,
            start_date: formData.start_date,
            end_date: formData.end_date
          })
          .eq('id', editingLoan.id)
      } else {
        await supabase
          .from('loans')
          .insert([{
            description: formData.description,
            total_amount: formData.total_amount,
            interest_rate: formData.interest_rate,
            start_date: formData.start_date,
            end_date: formData.end_date,
            company_id: COMPANY_ID,
            is_active: true
          }])
      }
      await loadData()
    } catch (error) {
      console.error('Error saving loan:', error)
      alert('Errore nel salvataggio del prestito')
    }
  }

  const handleDeleteLoan = async (id) => {
    if (confirm('Sei sicuro di voler eliminare questo prestito?')) {
      try {
        await supabase
          .from('loans')
          .update({ is_active: false })
          .eq('id', id)
        await loadData()
      } catch (error) {
        console.error('Error deleting loan:', error)
      }
    }
  }

  const totalBanks = accounts.reduce((s, a) => s + a.current_balance, 0)
  const totalCashes = accounts.filter(a => a.account_type === 'cassa').reduce((s, a) => s + a.current_balance, 0)
  const totalBancari = accounts.filter(a => a.account_type !== 'cassa').reduce((s, a) => s + a.current_balance, 0)
  const totalDebiti = loans.filter(l => l.is_active).reduce((s, l) => s + l.remaining_amount, 0)
  const posizioneLorda = totalBancari
  const posizioneNetta = totalBanks - totalDebiti

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Sticky header — stile leggero Sibill */}
      <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-slate-200/60 px-6 py-3">
        <div className="max-w-[1400px] mx-auto">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h1 className="text-lg font-semibold text-slate-800">Banche & Tesoreria</h1>
            <div className="flex gap-0.5 bg-slate-100/80 rounded-lg p-0.5">
              {[
                { key: 'panoramica', label: 'Panoramica', icon: Landmark },
                { key: 'movimenti', label: 'Movimenti', icon: ListOrdered },
                { key: 'riconciliazione', label: 'Riconciliazione', icon: ArrowLeftRight },
              ].map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${
                    activeTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}>
                  <t.icon size={13} /> {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* KPI barra orizzontale leggera — stile Sibill */}
          <div className="flex items-center gap-6 mt-3 text-sm">
            <div className="flex items-center gap-1.5">
              <Landmark size={13} className="text-blue-500" />
              <span className="text-slate-400 text-xs">Banche</span>
              <span className="font-semibold text-slate-800">{fmt(totalBancari)} €</span>
            </div>
            <div className="text-slate-200">|</div>
            <div className="flex items-center gap-1.5">
              <Store size={13} className="text-emerald-500" />
              <span className="text-slate-400 text-xs">Casse</span>
              <span className="font-semibold text-slate-800">{fmt(totalCashes)} €</span>
            </div>
            <div className="text-slate-200">|</div>
            <div className="flex items-center gap-1.5">
              <Wallet size={13} className="text-cyan-500" />
              <span className="text-slate-400 text-xs">Liquidità</span>
              <span className="font-bold text-slate-900">{fmt(totalBanks)} €</span>
            </div>
            <div className="text-slate-200">|</div>
            <div className="flex items-center gap-1.5">
              <HandCoins size={13} className="text-amber-500" />
              <span className="text-slate-400 text-xs">Debiti</span>
              <span className="font-semibold text-amber-600">{fmt(totalDebiti)} €</span>
            </div>
            <div className="text-slate-200">|</div>
            <div className="flex items-center gap-1.5">
              <PiggyBank size={13} className={posizioneNetta >= 0 ? 'text-emerald-500' : 'text-red-500'} />
              <span className="text-slate-400 text-xs">Netta</span>
              <span className={`font-bold ${posizioneNetta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(posizioneNetta)} €</span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 max-w-[1400px] mx-auto">

      {/* Tab: Movimenti */}
      {activeTab === 'movimenti' && (
        <>
          {/* Barra di ricerca movimenti — leggera */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              placeholder="Cerca per descrizione o controparte..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200/80 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400/40 focus:border-blue-300 bg-white placeholder:text-slate-300"
            />
          </div>
          <SezioneImport accounts={accounts} onImportComplete={loadData} />
          <SezioneMovimentiReali
            movements={cashMovements}
            setMovements={setCashMovements}
            accounts={accounts}
            search={search}
            loading={cashMovementsLoading}
            onLoadMore={handleCashMovementsLoadMore}
            hasMore={cashMovementsHasMore}
            selectedAccountId={cashMovementsAccountFilter}
            onSelectAccount={handleCashMovementsAccountFilter}
          />
          {/* Legacy bank_transactions — shown only if cash_movements is empty and bank_transactions has data */}
          {cashMovements.length === 0 && transactions.length > 0 && (
            <SezioneMovimenti transactions={transactions} accounts={accounts} suppliers={[]} search={search} />
          )}
        </>
      )}

      {/* Tab: Riconciliazione */}
      {activeTab === 'riconciliazione' && (
        <SezioneRiconciliazione companyId={COMPANY_ID} accounts={accounts} />
      )}

      {/* Tab: Panoramica */}
      {activeTab === 'panoramica' && <>

      {/* Composizione + Riepilogo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SezioneComposizione accounts={accounts} totalLiquidity={totalBanks} />
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200/80 p-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Riepilogo finanziario</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Conti correnti</span><span className="font-medium">{fmt(accounts.filter(c => c.account_type === 'conto_corrente').reduce((s,c)=>s+c.current_balance,0))} €</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Conti deposito</span><span className="font-medium">{fmt(accounts.filter(c => c.account_type === 'deposito').reduce((s,c)=>s+c.current_balance,0))} €</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Casse outlet</span><span className="font-medium">{fmt(totalCashes)} €</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Liquidità totale</span><span className="font-bold text-blue-600">{fmt(totalBanks)} €</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Debiti finanziari</span><span className="font-medium text-red-500">{fmt(totalDebiti)} €</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Fin. attive</span><span className="font-medium text-slate-900">{loans.filter(l => l.is_active).length}</span></div>
            <div className="col-span-2 border-t border-slate-100 pt-2 flex justify-between">
              <span className="text-slate-700 font-semibold">Posizione finanziaria netta</span>
              <span className={`font-bold ${posizioneNetta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(posizioneNetta)} €</span>
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
        <input
          type="text"
          placeholder="Cerca per banca o conto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200/80 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400/40 focus:border-blue-300 bg-white placeholder:text-slate-300"
        />
      </div>

      {/* Conti bancari */}
      <SezioneBanche
        accounts={accounts}
        totalBanks={totalBancari}
        search={search}
        onAddEdit={handleAddEditAccount}
        onDelete={handleDeleteAccount}
        loading={loading}
      />

      {/* Casse */}
      <SezioneCasse accounts={accounts} totalCashes={totalCashes} />

      {/* Finanziamenti */}
      <SezioneFinanziamenti
        loans={loans}
        onAddEdit={handleAddEditLoan}
        onDelete={handleDeleteLoan}
      />

      </>}
      {/* end panoramica tab */}

      </div>
      {/* end scrollable content */}

      {/* Modals */}
      <ModalBankAccount
        isOpen={modalOpen}
        isEdit={!!editingAccount}
        account={editingAccount}
        onClose={() => {
          setModalOpen(false)
          setEditingAccount(null)
        }}
        onSave={handleSaveAccount}
      />

      <ModalLoan
        isOpen={loanModalOpen}
        isEdit={!!editingLoan}
        loan={editingLoan}
        onClose={() => {
          setLoanModalOpen(false)
          setEditingLoan(null)
        }}
        onSave={handleSaveLoan}
      />
    </div>
  )
}
