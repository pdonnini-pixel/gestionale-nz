import { useState, useEffect, useMemo, useRef } from 'react'
import {
  Landmark, Building2, Wallet, CreditCard, TrendingUp,
  Search, ChevronDown, ChevronUp, Banknote, Store,
  PiggyBank, HandCoins, Info, Calculator, FileUp, Percent, Calendar,
  Plus, Edit2, Trash2, Check, X, AlertCircle, Download,
  ArrowLeftRight, Upload, Clock, ListOrdered, Link2, RefreshCw
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { GlassTooltip, AXIS_STYLE, GRID_STYLE } from '../components/ChartTheme'
import { useAuth } from '../hooks/useAuth'
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
        <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Building2 size={20} className="text-blue-600" />
          Conti Bancari
        </h2>
        <button
          onClick={() => onAddEdit(null)}
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
        >
          <Plus size={16} /> Nuovo
        </button>
      </div>

      {Object.entries(perBanca).map(([banca, conti]) => {
        const totBanca = conti.reduce((s, c) => s + c.current_balance, 0)
        return (
          <div key={banca} className="rounded-2xl overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <div
              className="p-4 cursor-pointer hover:bg-slate-50/50 transition flex items-center justify-between"
              onClick={() => setExpanded(expanded === banca ? null : banca)}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <Landmark size={18} />
                </div>
                <div>
                  <div className="font-semibold text-slate-900">{banca}</div>
                  <div className="text-xs text-slate-400">{conti.length} {conti.length === 1 ? 'conto' : 'conti'}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-lg font-bold text-slate-900">{fmt(totBanca)} €</div>
                  <div className="text-xs text-slate-400">{totalBanks > 0 ? ((totBanca / totalBanks) * 100).toFixed(1) : 0}% del totale</div>
                </div>
                {expanded === banca ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
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
    <div className="rounded-2xl overflow-hidden shadow-lg p-5" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
      <h3 className="text-sm font-semibold text-slate-700 mb-4">Composizione liquidità</h3>
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
   Sezione: Movimenti Bancari
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
   Sezione: Riconciliazione bancaria
   ──────────────────────────────────────── */
function SezioneRiconciliazione({ transactions, payableActions }) {
  // Match bank transactions with payable actions by amount and date proximity
  const matches = useMemo(() => {
    if (!transactions.length || !payableActions.length) return []

    return transactions.slice(0, 50).map(t => {
      // Find matching payable action (same amount, within 3 days)
      const matchedAction = payableActions.find(a => {
        if (!a.amount) return false
        const amountMatch = Math.abs(Math.abs(t.amount) - a.amount) < 0.02
        if (!amountMatch) return false
        const tDate = new Date(t.transaction_date)
        const aDate = new Date(a.created_at)
        const daysDiff = Math.abs((tDate - aDate) / (1000 * 60 * 60 * 24))
        return daysDiff <= 3
      })

      return { transaction: t, match: matchedAction }
    })
  }, [transactions, payableActions])

  const matched = matches.filter(m => m.match)
  const unmatched = matches.filter(m => !m.match)

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
        <ArrowLeftRight size={20} className="text-cyan-600" />
        Riconciliazione bancaria
        <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">{matched.length} riconciliati</span>
        {unmatched.length > 0 && (
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{unmatched.length} da verificare</span>
        )}
      </h2>

      {matches.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          Importare movimenti bancari e registrare pagamenti nello Scadenzario per attivare la riconciliazione automatica.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase">
                  <th className="py-2.5 px-4 text-left">Data</th>
                  <th className="py-2.5 px-4 text-left">Descrizione movimento</th>
                  <th className="py-2.5 px-4 text-right">Importo</th>
                  <th className="py-2.5 px-4 text-center">Stato</th>
                  <th className="py-2.5 px-4 text-left">Pagamento collegato</th>
                </tr>
              </thead>
              <tbody>
                {matches.map(({ transaction: t, match }, i) => (
                  <tr key={t.id || i} className={`border-b border-slate-50 ${!match ? 'bg-amber-50/30' : ''}`}>
                    <td className="py-2 px-4">{t.transaction_date ? new Date(t.transaction_date).toLocaleDateString('it-IT') : '—'}</td>
                    <td className="py-2 px-4 max-w-64 truncate">{t.description || '—'}</td>
                    <td className={`py-2 px-4 text-right font-medium ${t.amount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmt(Math.abs(t.amount))} €
                    </td>
                    <td className="py-2 px-4 text-center">
                      {match
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700"><Check size={10} /> OK</span>
                        : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700"><AlertCircle size={10} /> ?</span>
                      }
                    </td>
                    <td className="py-2 px-4 text-xs text-slate-500">
                      {match ? `${match.action_type} — ${fmt(match.amount)} € (${new Date(match.created_at).toLocaleDateString('it-IT')})` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
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
    <div className="p-6 space-y-8 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Banche & Tesoreria</h1>
          <p className="text-sm text-slate-500">Posizione finanziaria aggiornata in tempo reale</p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {[
            { key: 'panoramica', label: 'Panoramica', icon: Landmark },
            { key: 'movimenti', label: 'Movimenti', icon: ListOrdered },
            { key: 'riconciliazione', label: 'Riconciliazione', icon: ArrowLeftRight },
          ].map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
                activeTab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <t.icon size={14} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards - always visible */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard icon={Landmark} title="Totale banche" value={`${fmt(totalBancari)} €`} subtitle={`${accounts.filter(a => a.account_type !== 'cassa').length} conti`} color="blue" />
        <KpiCard icon={Store} title="Totale casse" value={`${fmt(totalCashes)} €`} subtitle={`${accounts.filter(a => a.account_type === 'cassa').length} outlet`} color="green" />
        <KpiCard icon={Wallet} title="Liquidità totale" value={`${fmt(totalBanks)} €`} subtitle="Banche + casse" color="cyan" />
        <KpiCard icon={HandCoins} title="Debiti finanziari" value={`${fmt(totalDebiti)} €`} subtitle={`${loans.filter(l => l.is_active).length} finanziamenti`} color="amber" />
        <KpiCard icon={PiggyBank} title="Posizione fin. netta" value={`${fmt(posizioneNetta)} €`}
          subtitle={posizioneNetta < 0 ? 'Indebitamento' : 'Liquidità netta'}
          color={posizioneNetta >= 0 ? 'green' : 'red'} />
      </div>

      {/* Tab: Movimenti */}
      {activeTab === 'movimenti' && (
        <>
          <SezioneImport accounts={accounts} onImportComplete={loadData} />
          <SezioneMovimenti transactions={transactions} accounts={accounts} suppliers={[]} search={search} />
        </>
      )}

      {/* Tab: Riconciliazione */}
      {activeTab === 'riconciliazione' && (
        <SezioneRiconciliazione transactions={transactions} payableActions={payableActions} />
      )}

      {/* Tab: Panoramica */}
      {activeTab === 'panoramica' && <>

      {/* Composizione + Riepilogo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SezioneComposizione accounts={accounts} totalLiquidity={totalBanks} />
        <div className="lg:col-span-2 rounded-2xl overflow-hidden shadow-lg p-5" style={{ background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Riepilogo finanziario</h3>
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
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Cerca per banca o conto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
