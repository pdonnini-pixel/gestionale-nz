import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  Receipt, Search, Filter, RefreshCw, CheckCircle2, PauseCircle,
  CalendarClock, RotateCcw, XCircle, ChevronDown, X, Landmark,
  AlertTriangle, Clock, CreditCard, Upload, FileText, Split,
  Building2, Edit3, Trash2, Plus, FileCode, ArrowLeftRight
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

// RIBA maturity days lookup
const RIBA_DAYS = { riba_30: 30, riba_60: 60, riba_90: 90, riba_120: 120 }

// --- Componente Pill ---
function StatusPill({ status }) {
  const cfg = statusConfig[status] || { label: status, bg: 'bg-gray-100 text-gray-600' }
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg}`}>{cfg.label}</span>
}

// --- Modal Base ---
function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} mx-4 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={20} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// --- Modal SALDA (con logica RIBA) ---
function ModalSalda({ open, onClose, payable, bankAccounts, onConfirm }) {
  const [bankId, setBankId] = useState('')
  const [method, setMethod] = useState(payable?.payment_method || 'bonifico_ordinario')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  // RIBA specific
  const [ribaBancaAppoggio, setRibaBancaAppoggio] = useState('')
  const [ribaSiaCode, setRibaSiaCode] = useState('')
  const [ribaPresentationDate, setRibaPresentationDate] = useState('')

  const isRiba = method?.startsWith('riba_')

  useEffect(() => {
    if (payable) {
      setAmount(payable.amount_remaining?.toFixed(2) || '')
      setMethod(payable.payment_method || 'bonifico_ordinario')
    }
  }, [payable])

  // Auto-calculate RIBA maturity date
  useEffect(() => {
    if (isRiba && ribaPresentationDate) {
      const days = RIBA_DAYS[method] || 30
      const d = new Date(ribaPresentationDate)
      d.setDate(d.getDate() + days)
      setDate(d.toISOString().slice(0, 10))
    }
  }, [isRiba, method, ribaPresentationDate])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onConfirm({
      bankId, method, amount: parseFloat(amount), date, note,
      ...(isRiba ? { ribaBancaAppoggio, ribaSiaCode, ribaPresentationDate } : {})
    })
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

        {/* RIBA-specific fields */}
        {isRiba && (
          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200 space-y-3">
            <p className="text-xs font-medium text-blue-700 flex items-center gap-1">
              <Landmark size={13} /> Dati specifici RiBa — Scadenza a {RIBA_DAYS[method]} giorni
            </p>
            <div>
              <label className="block text-xs text-blue-800 mb-1">Banca d'appoggio debitore</label>
              <input type="text" value={ribaBancaAppoggio} onChange={e => setRibaBancaAppoggio(e.target.value)}
                placeholder="Nome banca / IBAN debitore"
                className="w-full px-3 py-1.5 rounded border border-blue-300 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-blue-800 mb-1">Codice SIA</label>
                <input type="text" value={ribaSiaCode} onChange={e => setRibaSiaCode(e.target.value)}
                  placeholder="Es. A1234" maxLength={5}
                  className="w-full px-3 py-1.5 rounded border border-blue-300 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-blue-800 mb-1">Data presentazione</label>
                <input type="date" value={ribaPresentationDate} onChange={e => setRibaPresentationDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded border border-blue-300 text-sm" />
              </div>
            </div>
            {ribaPresentationDate && (
              <p className="text-xs text-blue-600">
                Data scadenza calcolata: <strong>{fmtDate(date)}</strong> ({RIBA_DAYS[method]} gg da presentazione)
              </p>
            )}
          </div>
        )}

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
          <div className="text-xs text-amber-600 mt-1">Già rimandata {payable.postpone_count} volta/e</div>
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

// --- Modal RATEIZZA (Rate multiple) ---
function ModalRateizza({ open, onClose, payable, onConfirm }) {
  const [numRate, setNumRate] = useState(2)
  const [frequency, setFrequency] = useState(30) // days between installments
  const [saving, setSaving] = useState(false)

  if (!payable) return null

  const totalAmount = payable.amount_remaining || 0
  const rataAmount = totalAmount / numRate
  const startDate = payable.due_date || new Date().toISOString().slice(0, 10)

  const rate = Array.from({ length: numRate }, (_, i) => {
    const d = new Date(startDate)
    d.setDate(d.getDate() + (i * frequency))
    return {
      num: i + 1,
      amount: i === numRate - 1 ? totalAmount - rataAmount * (numRate - 1) : Math.round(rataAmount * 100) / 100,
      date: d.toISOString().slice(0, 10),
    }
  })

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onConfirm({ rate, originalPayable: payable })
    setSaving(false)
  }

  return (
    <Modal open={open} onClose={onClose} title="Rateizza scadenza" wide>
      <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm">
        <div className="font-medium">{payable.supplier_name}</div>
        <div className="text-slate-500">Fatt. {payable.invoice_number} — {fmt(totalAmount)} €</div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Numero rate</label>
            <select value={numRate} onChange={e => setNumRate(parseInt(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
              {[2, 3, 4, 5, 6, 8, 10, 12].map(n => <option key={n} value={n}>{n} rate</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Frequenza (giorni)</label>
            <select value={frequency} onChange={e => setFrequency(parseInt(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm">
              <option value={30}>Mensile (30 gg)</option>
              <option value={60}>Bimestrale (60 gg)</option>
              <option value={90}>Trimestrale (90 gg)</option>
              <option value={15}>Quindicinale (15 gg)</option>
            </select>
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500">
                <th className="py-2 px-3 text-left">Rata</th>
                <th className="py-2 px-3 text-right">Importo</th>
                <th className="py-2 px-3 text-center">Scadenza</th>
              </tr>
            </thead>
            <tbody>
              {rate.map(r => (
                <tr key={r.num} className="border-t border-slate-100">
                  <td className="py-2 px-3 font-medium">{r.num}/{numRate}</td>
                  <td className="py-2 px-3 text-right">{fmt(r.amount)} €</td>
                  <td className="py-2 px-3 text-center">{fmtDate(r.date)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="py-2 px-3">Totale</td>
                <td className="py-2 px-3 text-right">{fmt(totalAmount)} €</td>
                <td className="py-2 px-3 text-center text-xs text-slate-500">
                  {fmtDate(rate[0]?.date)} → {fmtDate(rate[rate.length - 1]?.date)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 transition">Annulla</button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Split size={16} />}
            Crea {numRate} rate
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --- Modal FORNITORE (edit/create) ---
function ModalFornitore({ open, onClose, supplier, onSave }) {
  const [form, setForm] = useState({
    ragione_sociale: '', partita_iva: '', codice_fiscale: '',
    iban: '', email: '', telefono: '', indirizzo: '', note: ''
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (supplier) {
      setForm({
        ragione_sociale: supplier.ragione_sociale || '',
        partita_iva: supplier.partita_iva || '',
        codice_fiscale: supplier.codice_fiscale || '',
        iban: supplier.iban || '',
        email: supplier.email || '',
        telefono: supplier.telefono || '',
        indirizzo: supplier.indirizzo || '',
        note: supplier.note || '',
      })
    } else {
      setForm({ ragione_sociale: '', partita_iva: '', codice_fiscale: '', iban: '', email: '', telefono: '', indirizzo: '', note: '' })
    }
  }, [supplier, open])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    await onSave(form, supplier?.id)
    setSaving(false)
  }

  return (
    <Modal open={open} onClose={onClose} title={supplier ? 'Modifica fornitore' : 'Nuovo fornitore'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Ragione sociale *</label>
          <input type="text" value={form.ragione_sociale} onChange={e => setForm({ ...form, ragione_sociale: e.target.value })} required
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">P.IVA</label>
            <input type="text" value={form.partita_iva} onChange={e => setForm({ ...form, partita_iva: e.target.value })}
              placeholder="IT01234567890" maxLength={16}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Codice Fiscale</label>
            <input type="text" value={form.codice_fiscale} onChange={e => setForm({ ...form, codice_fiscale: e.target.value })}
              maxLength={16}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">IBAN</label>
          <input type="text" value={form.iban} onChange={e => setForm({ ...form, iban: e.target.value })}
            placeholder="IT60X0542811101000000123456" maxLength={34}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Telefono</label>
            <input type="text" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Indirizzo</label>
          <input type="text" value={form.indirizzo} onChange={e => setForm({ ...form, indirizzo: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Note</label>
          <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm resize-none" />
        </div>
        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 transition">Annulla</button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            {supplier ? 'Aggiorna' : 'Crea fornitore'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// --- XML FatturaPA Parser ---
function parseFatturaPA(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'text/xml')

  // Helper to get text content from a tag name
  const getText = (parent, tag) => {
    const el = parent?.getElementsByTagName(tag)?.[0]
    return el?.textContent?.trim() || ''
  }

  const results = []

  try {
    // FatturaPA can contain multiple FatturaElettronicaBody elements
    const bodies = doc.getElementsByTagName('FatturaElettronicaBody')
    const header = doc.getElementsByTagName('FatturaElettronicaHeader')?.[0]

    // Supplier info from header
    const cedente = header?.getElementsByTagName('CedentePrestatore')?.[0]
    const datiAnag = cedente?.getElementsByTagName('DatiAnagrafici')?.[0]
    const supplierName = getText(datiAnag, 'Denominazione') || getText(datiAnag, 'Nome') + ' ' + getText(datiAnag, 'Cognome')
    const piva = getText(datiAnag, 'IdCodice')
    const cf = getText(datiAnag, 'CodiceFiscale')

    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]
      const datiGen = body.getElementsByTagName('DatiGeneraliDocumento')?.[0]
      const numero = getText(datiGen, 'Numero')
      const data = getText(datiGen, 'Data')
      const importoTotale = parseFloat(getText(datiGen, 'ImportoTotaleDocumento')) || 0

      // Payment terms
      const datiPag = body.getElementsByTagName('DatiPagamento')?.[0]
      const detPag = datiPag?.getElementsByTagName('DettaglioPagamento') || []

      const payments = []
      for (let j = 0; j < detPag.length; j++) {
        const dp = detPag[j]
        payments.push({
          amount: parseFloat(getText(dp, 'ImportoPagamento')) || importoTotale,
          dueDate: getText(dp, 'DataScadenzaPagamento') || data,
          method: getText(dp, 'ModalitaPagamento'),
          iban: getText(dp, 'IBAN'),
        })
      }

      // If no payment details, create one with total
      if (payments.length === 0) {
        payments.push({ amount: importoTotale, dueDate: data, method: '', iban: '' })
      }

      results.push({
        supplier: { name: supplierName.trim(), piva, cf },
        invoiceNumber: numero,
        invoiceDate: data,
        totalAmount: importoTotale,
        payments,
      })
    }
  } catch (err) {
    console.error('Error parsing FatturaPA XML:', err)
  }

  return results
}

// Map FatturaPA payment codes to our methods
const FATTURAPA_METHODS = {
  MP01: 'contanti', MP02: 'assegno', MP03: 'assegno',
  MP05: 'bonifico_ordinario', MP06: 'assegno',
  MP08: 'carta_credito', MP09: 'rid', MP10: 'rid',
  MP12: 'riba_30', MP13: 'riba_60',
  MP14: 'riba_90', MP15: 'riba_120',
  MP16: 'sdd_core', MP17: 'sdd_b2b',
  MP19: 'sdd_core', MP20: 'sdd_b2b',
  MP21: 'bollettino_postale', MP22: 'f24',
}

// --- Pagina principale ---
export default function Scadenzario() {
  const [payables, setPayables] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('attive')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState(null) // 'salda', 'sospendi', 'rimanda', 'rateizza', 'fornitore', 'importXml'
  const [tab, setTab] = useState('scadenze') // 'scadenze', 'fornitori', 'riconciliazione'

  // Fornitore edit state
  const [editSupplier, setEditSupplier] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // XML import state
  const [xmlParsed, setXmlParsed] = useState(null)
  const [xmlImporting, setXmlImporting] = useState(false)
  const xmlInputRef = useRef(null)

  // Riconciliazione
  const [reconPayments, setReconPayments] = useState([])

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [payRes, bankRes, supRes] = await Promise.all([
      supabase.from('v_payables_operative').select('*'),
      supabase.from('v_bank_accounts_detail').select('*'),
      supabase.from('suppliers').select('*').or('is_deleted.is.null,is_deleted.eq.false').order('ragione_sociale'),
    ])
    if (payRes.data) setPayables(payRes.data)
    if (bankRes.data) setBankAccounts(bankRes.data)
    if (supRes.data) setSuppliers(supRes.data)

    // Load recent payments for reconciliation
    const { data: actions } = await supabase
      .from('payable_actions')
      .select('*')
      .in('action_type', ['pagamento', 'pagamento_parziale'])
      .order('created_at', { ascending: false })
      .limit(50)
    setReconPayments(actions || [])

    setLoading(false)
  }

  // Filtri scadenze
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
  async function handleSalda({ bankId, method, amount, date, note, ribaBancaAppoggio, ribaSiaCode, ribaPresentationDate }) {
    const p = selected
    await supabase.from('payables').update({
      amount_paid: (p.amount_paid || 0) + amount,
      payment_date: date,
      payment_bank_account_id: bankId,
      payment_method: method,
      status: amount >= p.amount_remaining ? 'pagato' : 'parziale',
    }).eq('id', p.id)

    await supabase.from('payable_actions').insert({
      payable_id: p.id,
      action_type: amount >= p.amount_remaining ? 'pagamento' : 'pagamento_parziale',
      old_status: p.status,
      new_status: amount >= p.amount_remaining ? 'pagato' : 'parziale',
      amount,
      bank_account_id: bankId,
      payment_method: method,
      note: [note, ribaBancaAppoggio ? `RIBA: ${ribaBancaAppoggio}` : '', ribaSiaCode ? `SIA: ${ribaSiaCode}` : ''].filter(Boolean).join(' | '),
    })

    setModal(null)
    setSelected(null)
    loadData()
  }

  async function handleSospendi({ reason, note }) {
    const p = selected
    await supabase.from('payables').update({
      status: 'sospeso', suspend_reason: reason,
      suspend_date: new Date().toISOString().slice(0, 10),
    }).eq('id', p.id)

    await supabase.from('payable_actions').insert({
      payable_id: p.id, action_type: 'sospensione',
      old_status: p.status, new_status: 'sospeso',
      note: `${reason}: ${note}`,
    })

    setModal(null); setSelected(null); loadData()
  }

  async function handleRimanda({ newDate, note }) {
    const p = selected
    await supabase.from('payables').update({
      postponed_to: newDate, postpone_count: (p.postpone_count || 0) + 1, status: 'rimandato',
    }).eq('id', p.id)

    await supabase.from('payable_actions').insert({
      payable_id: p.id, action_type: 'rimando',
      old_status: p.status, new_status: 'rimandato',
      old_due_date: p.due_date, new_due_date: newDate, note,
    })

    setModal(null); setSelected(null); loadData()
  }

  async function handleRiattiva(p) {
    await supabase.from('payables').update({
      status: 'da_pagare', suspend_reason: null, suspend_date: null,
    }).eq('id', p.id)

    await supabase.from('payable_actions').insert({
      payable_id: p.id, action_type: 'riattivazione',
      old_status: p.status, new_status: 'da_pagare',
    })
    loadData()
  }

  // Rate multiple
  async function handleRateizza({ rate, originalPayable }) {
    try {
      // Mark original as "annullato" and create N new payables
      await supabase.from('payables').update({ status: 'annullato' }).eq('id', originalPayable.id)

      await supabase.from('payable_actions').insert({
        payable_id: originalPayable.id, action_type: 'rateizzazione',
        old_status: originalPayable.status, new_status: 'annullato',
        note: `Rateizzata in ${rate.length} rate`,
      })

      // Create new payables for each installment
      for (const r of rate) {
        await supabase.from('payables').insert({
          supplier_id: originalPayable.supplier_id,
          invoice_number: `${originalPayable.invoice_number}/R${r.num}`,
          invoice_date: originalPayable.invoice_date,
          amount: r.amount,
          amount_paid: 0,
          due_date: r.date,
          status: 'da_pagare',
          payment_method: originalPayable.payment_method,
          outlet_id: originalPayable.outlet_id,
          company_id: originalPayable.company_id,
          parent_payable_id: originalPayable.id,
        })
      }

      setModal(null); setSelected(null); loadData()
    } catch (err) {
      console.error('Error creating installments:', err)
      alert('Errore nella creazione delle rate')
    }
  }

  // Fornitori CRUD
  async function handleSaveSupplier(form, existingId) {
    try {
      if (existingId) {
        await supabase.from('suppliers').update(form).eq('id', existingId)
      } else {
        await supabase.from('suppliers').insert(form)
      }
      setModal(null); setEditSupplier(null); loadData()
    } catch (err) {
      console.error('Error saving supplier:', err)
      alert('Errore nel salvataggio del fornitore')
    }
  }

  async function handleDeleteSupplier(id) {
    try {
      await supabase.from('suppliers').update({ is_deleted: true }).eq('id', id)
      setDeleteConfirm(null); loadData()
    } catch (err) {
      console.error('Error deleting supplier:', err)
    }
  }

  // XML Import
  async function handleXmlUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const parsed = parseFatturaPA(text)
      if (parsed.length === 0) {
        alert('Nessuna fattura trovata nel file XML')
        return
      }
      setXmlParsed(parsed)
      setModal('importXml')
    } catch (err) {
      console.error('Error reading XML:', err)
      alert('Errore nella lettura del file XML')
    }
    if (xmlInputRef.current) xmlInputRef.current.value = ''
  }

  async function handleConfirmXmlImport() {
    if (!xmlParsed) return
    setXmlImporting(true)
    try {
      for (const invoice of xmlParsed) {
        // Find or create supplier
        let supplierId = null
        if (invoice.supplier.piva) {
          const { data: existing } = await supabase.from('suppliers')
            .select('id').eq('partita_iva', invoice.supplier.piva).maybeSingle()
          if (existing) {
            supplierId = existing.id
          } else {
            const { data: newSup } = await supabase.from('suppliers').insert({
              ragione_sociale: invoice.supplier.name,
              partita_iva: invoice.supplier.piva,
              codice_fiscale: invoice.supplier.cf,
            }).select('id').single()
            supplierId = newSup?.id
          }
        }

        // Create payables for each payment term
        for (const pay of invoice.payments) {
          await supabase.from('payables').insert({
            supplier_id: supplierId,
            invoice_number: invoice.invoiceNumber,
            invoice_date: invoice.invoiceDate,
            amount: pay.amount,
            amount_paid: 0,
            due_date: pay.dueDate,
            status: 'da_pagare',
            payment_method: FATTURAPA_METHODS[pay.method] || 'bonifico_ordinario',
          })
        }
      }

      setXmlParsed(null); setModal(null); loadData()
    } catch (err) {
      console.error('Error importing XML:', err)
      alert('Errore nell\'importazione')
    } finally {
      setXmlImporting(false)
    }
  }

  const filterTabs = [
    { key: 'attive', label: 'Attive', count: totals.count },
    { key: 'tutte', label: 'Tutte', count: payables.length },
    { key: 'pagate', label: 'Pagate', count: payables.filter(p => p.status === 'pagato').length },
    { key: 'sospese', label: 'Sospese', count: payables.filter(p => ['sospeso', 'rimandato'].includes(p.status)).length },
  ]

  const filteredSuppliers = useMemo(() => {
    if (!search) return suppliers.filter(s => !s.is_deleted)
    const q = search.toLowerCase()
    return suppliers.filter(s => !s.is_deleted && (
      (s.ragione_sociale || '').toLowerCase().includes(q) ||
      (s.partita_iva || '').toLowerCase().includes(q)
    ))
  }, [suppliers, search])

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Scadenzario</h1>
          <p className="text-sm text-slate-500">Gestione scadenze fornitori</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 cursor-pointer transition">
            <FileCode size={15} /> Importa XML SDI
            <input ref={xmlInputRef} type="file" accept=".xml" onChange={handleXmlUpload} className="hidden" />
          </label>
          <button onClick={loadData}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-white transition">
            <RefreshCw size={16} /> Aggiorna
          </button>
        </div>
      </div>

      {/* Top tabs: Scadenze / Fornitori / Riconciliazione */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {[
          { key: 'scadenze', label: 'Scadenze', icon: Receipt },
          { key: 'fornitori', label: 'Fornitori', icon: Building2 },
          { key: 'riconciliazione', label: 'Riconciliazione', icon: ArrowLeftRight },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* ===== TAB: SCADENZE ===== */}
      {tab === 'scadenze' && (
        <>
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
                {payables.length === 0 ? 'Nessuna scadenza presente. Importare fatture XML o creare manualmente.' : 'Nessun risultato per i filtri selezionati.'}
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
                                <button onClick={() => { setSelected(p); setModal('rateizza') }}
                                  className="px-2 py-1 rounded text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition" title="Rateizza">
                                  Rate
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
        </>
      )}

      {/* ===== TAB: FORNITORI ===== */}
      {tab === 'fornitori' && (
        <>
          <div className="flex items-center justify-between">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Cerca fornitore..."
                className="pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm w-72" />
            </div>
            <button onClick={() => { setEditSupplier(null); setModal('fornitore') }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              <Plus size={15} /> Nuovo fornitore
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {filteredSuppliers.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-sm">Nessun fornitore trovato</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4 text-left font-medium">Ragione sociale</th>
                      <th className="py-3 px-4 text-left font-medium">P.IVA</th>
                      <th className="py-3 px-4 text-left font-medium">CF</th>
                      <th className="py-3 px-4 text-left font-medium">IBAN</th>
                      <th className="py-3 px-4 text-left font-medium">Email</th>
                      <th className="py-3 px-4 text-right font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSuppliers.map(s => (
                      <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition">
                        <td className="py-3 px-4 text-sm font-medium text-slate-900">{s.ragione_sociale}</td>
                        <td className="py-3 px-4 text-sm text-slate-600 font-mono">{s.partita_iva || '—'}</td>
                        <td className="py-3 px-4 text-sm text-slate-500 font-mono">{s.codice_fiscale || '—'}</td>
                        <td className="py-3 px-4 text-xs text-slate-500 font-mono">{s.iban ? `${s.iban.slice(0, 4)}...${s.iban.slice(-4)}` : '—'}</td>
                        <td className="py-3 px-4 text-sm text-slate-500">{s.email || '—'}</td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { setEditSupplier(s); setModal('fornitore') }}
                              className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="Modifica">
                              <Edit3 size={14} />
                            </button>
                            <button onClick={() => setDeleteConfirm(s)}
                              className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition" title="Elimina">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== TAB: RICONCILIAZIONE ===== */}
      {tab === 'riconciliazione' && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-1 flex items-center gap-2">
              <ArrowLeftRight size={16} /> Riconciliazione pagamenti — estratti conto
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Confronta i pagamenti registrati nello scadenzario con le operazioni bancarie.
              I pagamenti senza corrispondenza sono evidenziati.
            </p>

            {reconPayments.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                Nessun pagamento registrato. I pagamenti appariranno qui dopo il saldo delle scadenze.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                      <th className="py-2 px-3 text-left">Data</th>
                      <th className="py-2 px-3 text-left">Tipo</th>
                      <th className="py-2 px-3 text-right">Importo</th>
                      <th className="py-2 px-3 text-left">Metodo</th>
                      <th className="py-2 px-3 text-left">Conto</th>
                      <th className="py-2 px-3 text-left">Note</th>
                      <th className="py-2 px-3 text-center">Riconciliato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconPayments.map(a => {
                      const bank = bankAccounts.find(b => b.bank_account_id === a.bank_account_id)
                      const isReconciled = !!a.bank_account_id && !!a.amount
                      return (
                        <tr key={a.id} className={`border-b border-slate-50 ${!isReconciled ? 'bg-amber-50/30' : ''}`}>
                          <td className="py-2 px-3">{fmtDate(a.created_at)}</td>
                          <td className="py-2 px-3 capitalize">{a.action_type?.replace('_', ' ')}</td>
                          <td className="py-2 px-3 text-right font-medium">{fmt(a.amount)} €</td>
                          <td className="py-2 px-3 text-xs">{paymentMethodLabels[a.payment_method] || '—'}</td>
                          <td className="py-2 px-3 text-xs">{bank?.bank_name || '—'}</td>
                          <td className="py-2 px-3 text-xs text-slate-500 max-w-48 truncate">{a.note || '—'}</td>
                          <td className="py-2 px-3 text-center">
                            {isReconciled
                              ? <CheckCircle2 size={16} className="text-green-600 mx-auto" />
                              : <AlertTriangle size={16} className="text-amber-500 mx-auto" />
                            }
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Modals */}
      <ModalSalda open={modal === 'salda'} onClose={() => setModal(null)} payable={selected} bankAccounts={bankAccounts} onConfirm={handleSalda} />
      <ModalSospendi open={modal === 'sospendi'} onClose={() => setModal(null)} payable={selected} onConfirm={handleSospendi} />
      <ModalRimanda open={modal === 'rimanda'} onClose={() => setModal(null)} payable={selected} onConfirm={handleRimanda} />
      <ModalRateizza open={modal === 'rateizza'} onClose={() => setModal(null)} payable={selected} onConfirm={handleRateizza} />
      <ModalFornitore open={modal === 'fornitore'} onClose={() => { setModal(null); setEditSupplier(null) }} supplier={editSupplier} onSave={handleSaveSupplier} />

      {/* XML Import confirmation modal */}
      {modal === 'importXml' && xmlParsed && (
        <Modal open={true} onClose={() => { setModal(null); setXmlParsed(null) }} title="Importa fatture da XML SDI" wide>
          <div className="space-y-3 mb-4">
            {xmlParsed.map((inv, i) => (
              <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{inv.supplier.name}</p>
                    <p className="text-xs text-slate-500">P.IVA: {inv.supplier.piva || '—'} • Fatt. {inv.invoiceNumber} del {fmtDate(inv.invoiceDate)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold">{fmt(inv.totalAmount)} €</p>
                    <p className="text-xs text-slate-500">{inv.payments.length} scadenz{inv.payments.length === 1 ? 'a' : 'e'}</p>
                  </div>
                </div>
                {inv.payments.length > 1 && (
                  <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                    {inv.payments.map((p, j) => (
                      <div key={j} className="flex justify-between text-xs text-slate-600">
                        <span>Rata {j + 1}: {fmtDate(p.dueDate)}</span>
                        <span>{fmt(p.amount)} €</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => { setModal(null); setXmlParsed(null) }}
              className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50 transition">
              Annulla
            </button>
            <button onClick={handleConfirmXmlImport} disabled={xmlImporting}
              className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 flex items-center justify-center gap-2">
              {xmlImporting ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
              Importa {xmlParsed.length} fattur{xmlParsed.length === 1 ? 'a' : 'e'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete supplier confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Conferma eliminazione</h3>
            <p className="text-sm text-slate-600 mb-4">
              Eliminare il fornitore <strong>{deleteConfirm.ragione_sociale}</strong>? L'operazione è reversibile.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 rounded-lg text-sm border border-slate-300 text-slate-700 hover:bg-slate-50">Annulla</button>
              <button onClick={() => handleDeleteSupplier(deleteConfirm.id)}
                className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 font-medium flex items-center gap-1">
                <Trash2 size={14} /> Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
