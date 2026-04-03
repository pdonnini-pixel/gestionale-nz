import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  Receipt, Search, Filter, RefreshCw, CheckCircle2, PauseCircle,
  CalendarClock, RotateCcw, XCircle, ChevronDown, X, Landmark,
  AlertTriangle, Clock, CreditCard
} from 'lucide-react'

// --- Utilità ---
function fmt(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const statusConfig = {
  scaduto:      { label: 'Scaduto',      bg: 'bg-red-100 text-red-700' },
  in_scadenza:  { label: 'In scadenza',  bg: 'bg-amber-100 text-amber-700' },
  da_pagare:    { label: 'Da pagare',    bg: 'bg-blue-100 text-blue-700' },
  parziale:     { label: 'Parziale',     bg: 'bg-orange-100 text-orange-700' },
  sospeso:      { label: 'Sospeso',      bg: 'bg-slate-100 text-slate-600' },
  rimandato:    { label: 'Rimandato',    bg: 'bg-purple-100 text-purple-700' },
  pagato:       { label: 'Pagato',       bg: 'bg-emerald-100 text-emerald-700' },
  annullato:    { label: 'Annullato',    bg: 'bg-gray-100 text-gray-500' },
}

const paymentMethodLabels = {
  bonifico_ordinario: 'Bonifico ordinario',
  bonifico_urgente: 'Bonifico urgente',
  bonifico_sepa: 'Bonifico SEPA',
  riba_30: 'RiBa 30 gg',
  riba_60: 'RiBa 60 gg',
  riba_90: 'RiBa 90 gg',
  riba_120: 'RiBa 120 gg',
  rid: 'RID',
  sdd_core: 'SDD Core',
  sdd_b2b: 'SDD B2B',
  rimessa_diretta: 'Rimessa diretta',
  carta_credito: 'Carta di credito',
  carta_debito: 'Carta di debito',
  assegno: 'Assegno',
  contanti: 'Contanti',
  compensazione: 'Compensazione',
  f24: 'F24',
  mav: 'MAV',
  rav: 'RAV',
  bollettino_postale: 'Bollettino postale',
  altro: 'Altro',
}

const paymentGroups = [
  { label: 'Bonifici', methods: ['bonifico_ordinario', 'bonifico_urgente', 'bonifico_sepa'] },
  { label: 'RiBa', methods: ['riba_30', 'riba_60', 'riba_90', 'riba_120'] },
  { label: 'Addebito diretto', methods: ['rid', 'sdd_core', 'sdd_b2b'] },
  { label: 'Altro', methods: ['rimessa_diretta', 'carta_credito', 'carta_debito', 'assegno', 'contanti', 'compensazione', 'f24', 'mav', 'rav', 'bollettino_postale', 'altro'] },
]

// --- Componente Pill ---
function StatusPill({ status }) {
  const cfg = statusConfig[status] || { label: status, bg: 'bg-gray-100 text-gray-600' }
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg}`}>{cfg.label}</span>
}

// --- Modal Base ---
function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// --- Modal SALDA ---
function ModalSalda({ open, onClose, payable, bankAccounts, onConfirm }) {
  const [bankId, setBankId] = useState('')
  const [method, setMethod] = useState(payable?.payment_method || 'bonifico_ordinario')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (payable) {
      setAmount(payable.amount_remaining?.toFixed(2) || '')
      setMethod(payable.payment_method || 'bonifico_ordinario')
    }
  }, [payable])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onConfirm({ bankId, method, amount: parseFloat(amount), date, note })
    setSaving(false)
  }

  if (!payable) return null

  return (
    <Modal open={open} onClose={onClose} title="Salda scadenza">
      <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
        <div className="font-medium">{payable.supplier_name}</div>
        <div className="text-slate-500">Fatt. {payable.invoice_number} — Scadenza {fmtDate(payable.due_date)}</div>
        <div className="text-lg font-bold mt-1">{fmt(payable.amount_remaining)} €</div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Conto bancario</label>
          <select value={bankId} onChange={e => setBankId(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
            <option value="">Seleziona conto...</option>
            {bankAccounts.map(ba => (
              <option key={ba.bank_account_id} value={ba.bank_account_id}>
                {ba.bank_name} — Disp. {fmt(ba.total_available)} €
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Metodo di pagamento</label>
          <select value={method} onChange={e => setMethod(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
            {paymentGroups.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.methods.map(m => <option key={m} value={m}>{paymentMethodLabels[m]}</option>)}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Importo</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Data pagamento</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Note (opzionale)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Riferimento pagamento..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 transition">Annulla</button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Conferma pagamento
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --- Modal SOSPENDI ---
function ModalSospendi({ open, onClose, payable, onConfirm }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const reasons = ['Contestazione fattura', 'In attesa nota credito', 'Verifica importo', 'Merce non conforme', 'Altro']

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onConfirm({ reason, note })
    setSaving(false)
  }

  if (!payable) return null

  return (
    <Modal open={open} onClose={onClose} title="Sospendi scadenza">
      <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
        <div className="font-medium">{payable.supplier_name}</div>
        <div className="text-slate-500">Fatt. {payable.invoice_number} — {fmt(payable.amount_remaining)} €</div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Motivo sospensione</label>
          <select value={reason} onChange={e => setReason(e.target.value)} required
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
            <option value="">Seleziona motivo...</option>
            {reasons.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nota obbligatoria</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} required rows={3} placeholder="Descrivi il motivo della sospensione..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none resize-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 transition">Annulla</button>
          <button type="submit" disabled={saving || !note.trim()}
            className="flex-1 py-2.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <PauseCircle size={16} />}
            Sospendi
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --- Modal RIMANDA ---
function ModalRimanda({ open, onClose, payable, onConfirm }) {
  const [newDate, setNewDate] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onConfirm({ newDate, note })
    setSaving(false)
  }

  if (!payable) return null

  return (
    <Modal open={open} onClose={onClose} title="Rimanda scadenza">
      <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
        <div className="font-medium">{payable.supplier_name}</div>
        <div className="text-slate-500">Fatt. {payable.invoice_number} — Scadenza attuale: {fmtDate(payable.due_date)}</div>
        <div className="text-lg font-bold mt-1">{fmt(payable.amount_remaining)} €</div>
        {payable.postpone_count > 0 && (
          <div className="text-xs text-amber-600 mt-1">Gia rimandata {payable.postpone_count} volta/e</div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nuova data scadenza</label>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} required
            min={new Date().toISOString().slice(0, 10)}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Motivo (opzionale)</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Accordo con fornitore..."
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 transition">Annulla</button>
          <button type="submit" disabled={saving || !newDate}
            className="flex-1 py-2.5 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <CalendarClock size={16} />}
            Rimanda
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --- Pagina principale ---
export default function Scadenzario() {
  const [payables, setPayables] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('attive') // attive, tutte, pagate, sospese
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null) // 'salda', 'sospendi', 'rimanda'

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [payRes, bankRes] = await Promise.all([
      supabase.from('v_payables_operative').select('*'),
      supabase.from('v_bank_accounts_detail').select('*'),
    ])
    if (payRes.data) setPayables(payRes.data)
    if (bankRes.data) setBankAccounts(bankRes.data)
    setLoading(false)
  }

  // Filtri
  const filtered = useMemo(() => {
    let list = payables
    if (filter === 'attive') list = list.filter(p => ['da_pagare', 'in_scadenza', 'scaduto', 'parziale'].includes(p.status))
    else if (filter === 'pagate') list = list.filter(p => p.status === 'pagato')
    else if (filter === 'sospese') list = list.filter(p => ['sospeso', 'rimandato'].includes(p.status))
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        (p.supplier_name || '').toLowerCase().includes(q) ||
        (p.invoice_number || '').toLowerCase().includes(q) ||
        (p.outlet_name || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [payables, filter, search])

  // Totali header
  const totals = useMemo(() => {
    const active = payables.filter(p => ['da_pagare', 'in_scadenza', 'scaduto', 'parziale'].includes(p.status))
    return {
      count: active.length,
      total: active.reduce((s, p) => s + (p.amount_remaining || 0), 0),
      overdue: active.filter(p => p.status === 'scaduto').reduce((s, p) => s + (p.amount_remaining || 0), 0),
      next7: active.filter(p => p.days_to_due >= 0 && p.days_to_due <= 7).reduce((s, p) => s + (p.amount_remaining || 0), 0),
      suspended: payables.filter(p => p.status === 'sospeso').length,
    }
  }, [payables])

  // --- Azioni ---
  async function handleSalda({ bankId, method, amount, date, note }) {
    const p = selected
    // Aggiorna payable
    await supabase.from('payables').update({
      amount_paid: (p.amount_paid || 0) + amount,
      payment_date: date,
      payment_bank_account_id: bankId,
      payment_method: method,
      status: amount >= p.amount_remaining ? 'pagato' : 'parziale',
    }).eq('id', p.id)

    // Log azione
    await supabase.from('payable_actions').insert({
      payable_id: p.id,
      action_type: amount >= p.amount_remaining ? 'pagamento' : 'pagamento_parziale',
      old_status: p.status,
      new_status: amount >= p.amount_remaining ? 'pagato' : 'parziale',
      amount,
      bank_account_id: bankId,
      payment_method: method,
      note,
    })

    setModal(null)
    setSelected(null)
    loadData()
  }

  async function handleSospendi({ reason, note }) {
    const p = selected
    await supabase.from('payables').update({
      status: 'sospeso',
      suspend_reason: reason,
      suspend_date: new Date().toISOString().slice(0, 10),
    }).eq('id', p.id)

    await supabase.from('payable_actions').insert({
      payable_id: p.id,
      action_type: 'sospensione',
      old_status: p.status,
      new_status: 'sospeso',
      note: `${reason}: ${note}`,
    })

    setModal(null)
    setSelected(null)
    loadData()
  }

  async function handleRimanda({ newDate, note }) {
    const p = selected
    await supabase.from('payables').update({
      postponed_to: newDate,
      postpone_count: (p.postpone_count || 0) + 1,
      status: 'rimandato',
    }).eq('id', p.id)

    await supabase.from('payable_actions').insert({
      payable_id: p.id,
      action_type: 'rimando',
      old_status: p.status,
      new_status: 'rimandato',
      old_due_date: p.due_date,
      new_due_date: newDate,
      note,
    })

    setModal(null)
    setSelected(null)
    loadData()
  }

  async function handleRiattiva(p) {
    await supabase.from('payables').update({
      status: 'da_pagare',
      suspend_reason: null,
      suspend_date: null,
    }).eq('id', p.id)

    await supabase.from('payable_actions').insert({
      payable_id: p.id,
      action_type: 'riattivazione',
      old_status: p.status,
      new_status: 'da_pagare',
    })

    loadData()
  }

  const filterTabs = [
    { key: 'attive', label: 'Attive', count: totals.count },
    { key: 'tutte', label: 'Tutte', count: payables.length },
    { key: 'pagate', label: 'Pagate', count: payables.filter(p => p.status === 'pagato').length },
    { key: 'sospese', label: 'Sospese', count: payables.filter(p => ['sospeso', 'rimandato'].includes(p.status)).length },
  ]

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Scadenzario</h1>
          <p className="text-sm text-slate-500">Gestione scadenze fornitori</p>
        </div>
        <button onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-white transition">
          <RefreshCw size={16} /> Aggiorna
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-1">Totale da pagare</div>
          <div className="text-xl font-bold">{fmt(totals.total)} €</div>
          <div className="text-xs text-slate-400">{totals.count} scadenze</div>
        </div>
        <div className="bg-white rounded-xl border border-red-200 p-4">
          <div className="flex items-center gap-1 text-xs text-red-600 mb-1"><AlertTriangle size={12} /> Scadute</div>
          <div className="text-xl font-bold text-red-700">{fmt(totals.overdue)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-amber-200 p-4">
          <div className="flex items-center gap-1 text-xs text-amber-600 mb-1"><Clock size={12} /> Prossimi 7 gg</div>
          <div className="text-xl font-bold text-amber-700">{fmt(totals.next7)} €</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-1 text-xs text-slate-500 mb-1"><PauseCircle size={12} /> Sospese</div>
          <div className="text-xl font-bold">{totals.suspended}</div>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {filterTabs.map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
                filter === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {t.label} <span className="text-xs text-slate-400 ml-1">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Cerca fornitore, fattura, outlet..."
            className="pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm w-72 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <RefreshCw size={24} className="animate-spin text-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            {payables.length === 0 ? 'Nessuna scadenza presente. Le scadenze appariranno quando verranno caricate le fatture.' : 'Nessun risultato per i filtri selezionati.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4 text-left font-medium">Fornitore</th>
                  <th className="py-3 px-4 text-left font-medium">Fattura</th>
                  <th className="py-3 px-4 text-left font-medium">Outlet</th>
                  <th className="py-3 px-4 text-right font-medium">Importo</th>
                  <th className="py-3 px-4 text-center font-medium">Scadenza</th>
                  <th className="py-3 px-4 text-center font-medium">Stato</th>
                  <th className="py-3 px-4 text-center font-medium">Metodo</th>
                  <th className="py-3 px-4 text-right font-medium">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                    <td className="py-3 px-4 text-sm font-medium text-slate-900">{p.supplier_name || '—'}</td>
                    <td className="py-3 px-4 text-sm text-slate-600">{p.invoice_number}</td>
                    <td className="py-3 px-4 text-sm text-slate-500">{p.outlet_name || 'Aziendale'}</td>
                    <td className="py-3 px-4 text-sm text-right font-medium">{fmt(p.amount_remaining)} €</td>
                    <td className="py-3 px-4 text-sm text-center">
                      <span className={p.days_to_due < 0 ? 'text-red-600 font-medium' : p.days_to_due <= 7 ? 'text-amber-600' : ''}>
                        {fmtDate(p.due_date)}
                      </span>
                      {p.days_to_due != null && (
                        <div className="text-xs text-slate-400">
                          {p.days_to_due < 0 ? `${Math.abs(p.days_to_due)}gg fa` : p.days_to_due === 0 ? 'Oggi' : `tra ${p.days_to_due}gg`}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center"><StatusPill status={p.status} /></td>
                    <td className="py-3 px-4 text-xs text-center text-slate-500">
                      {paymentMethodLabels[p.payment_method] || '—'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {['da_pagare', 'in_scadenza', 'scaduto', 'parziale'].includes(p.status) && (
                          <>
                            <button onClick={() => { setSelected(p); setModal('salda') }}
                              className="px-2 py-1 rounded text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition" title="Salda">
                              Salda
                            </button>
                            <button onClick={() => { setSelected(p); setModal('sospendi') }}
                              className="px-2 py-1 rounded text-xs font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 transition" title="Sospendi">
                              Sospendi
                            </button>
                            <button onClick={() => { setSelected(p); setModal('rimanda') }}
                              className="px-2 py-1 rounded text-xs font-medium bg-purple-50 text-purple-700 hover:bg-purple-100 transition" title="Rimanda">
                              Rimanda
                            </button>
                          </>
                        )}
                        {p.status === 'sospeso' && (
                          <button onClick={() => handleRiattiva(p)}
                            className="px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition">
                            Riattiva
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      <ModalSalda open={modal === 'salda'} onClose={() => setModal(null)} payable={selected} bankAccounts={bankAccounts} onConfirm={handleSalda} />
      <ModalSospendi open={modal === 'sospendi'} onClose={() => setModal(null)} payable={selected} onConfirm={handleSospendi} />
      <ModalRimanda open={modal === 'rimanda'} onClose={() => setModal(null)} payable={selected} onConfirm={handleRimanda} />
    </div>
  )
}
