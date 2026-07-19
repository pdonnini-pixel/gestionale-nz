import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Banknote, Plus, Edit2, X, Check, RefreshCw, Upload, FileText,
  Download, Trash2, Calculator, AlertCircle, Eye, EyeOff,
  PauseCircle, PlayCircle, FileWarning,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import CellTooltip from './Tooltip'
import { fmtEuro } from './ChartTheme'
import {
  computeAmortization, normalizeFrequency, isValidAmortizationParams,
  type AmortizationFrequency, type AmortizationParams,
} from '../lib/amortization'
import { Modal } from './ui/Modal'

// ─── Tipi locali ───────────────────────────────────────────────
interface BankAccountLite {
  id: string
  bank_name: string | null
  account_name: string | null
  iban: string | null
  is_active: boolean | null
}

interface LoanRow {
  id: string
  company_id: string
  description: string | null
  total_amount: number | null
  original_amount: number | null
  remaining_amount: number | null
  interest_rate: number | null
  start_date: string | null
  end_date: string | null
  lender: string | null
  loan_type: string | null
  installment_amount: number | null
  installment_frequency: string | null
  bank_account_id: string | null
  note: string | null
  is_active: boolean | null
  created_at: string | null
  updated_at: string | null
}

interface LoanDoc {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  storage_bucket: string | null
  created_at: string | null
  uploaded_by_name: string | null
}

// Allegati finanziamento → tabella `documents` (stesso pattern Archivio/Outlet).
// Bucket `media`: unico presente su tutti e 3 i tenant (NZ/Made/Zago), niente
// nuovo bucket, niente migration. reference_type='loan' lega il doc al loan.
const LOAN_BUCKET = 'media'
const LOAN_DOC_CATEGORY = 'finanziamento'
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

const LOAN_TYPES = [
  { value: 'mutuo', label: 'Mutuo' },
  { value: 'finanziamento', label: 'Finanziamento' },
  { value: 'leasing', label: 'Leasing' },
  { value: 'fido', label: 'Fido / Apertura di credito' },
  { value: 'anticipo', label: 'Anticipo fatture' },
  { value: 'altro', label: 'Altro' },
]

const FREQUENCY_OPTIONS: { value: AmortizationFrequency; label: string }[] = [
  { value: 'monthly', label: 'Mensile' },
  { value: 'quarterly', label: 'Trimestrale' },
  { value: 'semiannual', label: 'Semestrale' },
  { value: 'annual', label: 'Annuale' },
]

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}
function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}
function loanTypeLabel(v: string | null | undefined): string {
  return LOAN_TYPES.find(t => t.value === v)?.label || v || '—'
}
function freqLabel(v: string | null | undefined): string {
  const n = normalizeFrequency(v)
  return FREQUENCY_OPTIONS.find(f => f.value === n)?.label || v || '—'
}

// ─── Form state (tutto stringa: campi non noti = VUOTI) ─────────
interface LoanFormState {
  description: string
  lender: string
  loan_type: string
  bank_account_id: string
  total_amount: string
  interest_rate: string
  start_date: string
  installment_frequency: string
  installment_amount: string
  note: string
}

const EMPTY_FORM: LoanFormState = {
  description: '', lender: '', loan_type: '', bank_account_id: '',
  total_amount: '', interest_rate: '', start_date: '',
  installment_frequency: '', installment_amount: '', note: '',
}

function loanToForm(l: LoanRow): LoanFormState {
  return {
    description: l.description ?? '',
    lender: l.lender ?? '',
    loan_type: l.loan_type ?? '',
    bank_account_id: l.bank_account_id ?? '',
    total_amount: l.total_amount != null ? String(l.total_amount) : '',
    interest_rate: l.interest_rate != null ? String(l.interest_rate) : '',
    start_date: l.start_date ?? '',
    installment_frequency: normalizeFrequency(l.installment_frequency) ?? '',
    installment_amount: l.installment_amount != null ? String(l.installment_amount) : '',
    note: l.note ?? '',
  }
}

// numero da input (vuoto/non numerico → null, mai 0 inventato)
function numOrNull(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return isFinite(n) ? n : null
}

// ═══════════════════════════════════════════════════════════════
export default function FinanziamentiTab({ accounts, companyId, uploadedByName }: {
  accounts: BankAccountLite[]
  companyId: string
  uploadedByName?: string | null
}) {
  const { toast } = useToast()
  const [loans, setLoans] = useState<LoanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // form / modale
  const [editing, setEditing] = useState<LoanRow | null>(null) // null = chiuso
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<LoanFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // numero rate (parametro del piano: NON è su loans, lo conferma l'operatore)
  const [numInstallments, setNumInstallments] = useState('')

  // documenti del loan in editing
  const [docs, setDocs] = useState<LoanDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deleteDoc, setDeleteDoc] = useState<LoanDoc | null>(null)

  const activeAccounts = useMemo(
    () => accounts.filter(a => a.is_active !== false),
    [accounts],
  )

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('loans')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
        if (error) throw error
        if (!cancelled) setLoans((data || []) as unknown as LoanRow[])
      } catch (err: unknown) {
        console.error('load loans:', err)
        if (!cancelled) { setLoans([]); toast({ type: 'error', message: 'Errore caricamento finanziamenti: ' + ((err as Error)?.message || '') }) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [companyId, refreshKey, toast])

  // ─── account label ─────────────────────────────────────────
  const accountLabel = useCallback((id: string | null | undefined) => {
    if (!id) return '—'
    const a = accounts.find(x => x.id === id)
    if (!a) return '—'
    return `${a.bank_name || 'Banca'}${a.account_name ? ` · ${a.account_name}` : ''}`
  }, [accounts])

  const visibleLoans = useMemo(
    () => loans.filter(l => showInactive ? true : l.is_active !== false),
    [loans, showInactive],
  )

  // ─── apertura form ─────────────────────────────────────────
  function openNew() {
    setIsNew(true)
    setEditing({ id: '', company_id: companyId } as LoanRow)
    setForm(EMPTY_FORM)
    setNumInstallments('')
    setDocs([])
  }
  function openEdit(l: LoanRow) {
    setIsNew(false)
    setEditing(l)
    setForm(loanToForm(l))
    setNumInstallments('')
    loadDocs(l.id)
  }
  function closeForm() {
    setEditing(null)
    setIsNew(false)
    setForm(EMPTY_FORM)
    setNumInstallments('')
    setDocs([])
  }

  // ─── documenti (pattern `documents`) ───────────────────────
  async function loadDocs(loanId: string) {
    if (!loanId) { setDocs([]); return }
    setDocsLoading(true)
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('id, file_name, file_path, file_size, storage_bucket, created_at, uploaded_by_name')
        .eq('company_id', companyId)
        .eq('reference_type', 'loan')
        .eq('reference_id', loanId)
        .order('created_at', { ascending: false })
      if (error) throw error
      setDocs((data || []) as unknown as LoanDoc[])
    } catch (err: unknown) {
      console.warn('load loan docs:', err)
      setDocs([])
    } finally {
      setDocsLoading(false)
    }
  }

  async function handleUpload(file: File | undefined, loanId: string) {
    if (!file || !loanId) return
    if (file.size > MAX_FILE_SIZE) {
      toast({ type: 'error', message: `${file.name}: troppo grande (max 50 MB)` })
      return
    }
    setUploading(true)
    try {
      const ts = Date.now()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const filePath = `loans/${companyId}/${loanId}/${ts}_${safeName}`
      const { error: upErr } = await supabase.storage
        .from(LOAN_BUCKET)
        .upload(filePath, file, { upsert: false })
      if (upErr) throw upErr

      const { error: dbErr } = await supabase.from('documents').insert({
        company_id: companyId,
        reference_type: 'loan',
        reference_id: loanId,
        category: LOAN_DOC_CATEGORY,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type || null,
        storage_bucket: LOAN_BUCKET,
        uploaded_by_name: uploadedByName || null,
      } as never)
      if (dbErr) {
        // rollback file orfano
        await supabase.storage.from(LOAN_BUCKET).remove([filePath])
        throw dbErr
      }
      toast({ type: 'success', message: 'Documento caricato' })
      await loadDocs(loanId)
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore upload: ' + ((err as Error)?.message || '') })
    } finally {
      setUploading(false)
    }
  }

  async function downloadDoc(doc: LoanDoc) {
    try {
      const bucket = doc.storage_bucket || LOAN_BUCKET
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(doc.file_path, 3600)
      if (error) throw error
      window.open(data.signedUrl, '_blank')
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore apertura documento: ' + ((err as Error)?.message || '') })
    }
  }

  async function confirmDeleteDoc() {
    if (!deleteDoc || !editing) return
    try {
      await supabase.from('documents').delete().eq('id', deleteDoc.id)
      const bucket = deleteDoc.storage_bucket || LOAN_BUCKET
      await supabase.storage.from(bucket).remove([deleteDoc.file_path])
      setDeleteDoc(null)
      await loadDocs(editing.id)
      toast({ type: 'success', message: 'Documento eliminato' })
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore eliminazione: ' + ((err as Error)?.message || '') })
    }
  }

  // ─── salvataggio loan ──────────────────────────────────────
  async function handleSave() {
    if (!companyId) return
    // descrizione obbligatoria solo come etichetta minima; tutto il resto opzionale
    const payload = {
      company_id: companyId,
      description: form.description.trim() || null,
      lender: form.lender.trim() || null,
      loan_type: form.loan_type || null,
      bank_account_id: form.bank_account_id || null,
      total_amount: numOrNull(form.total_amount),
      interest_rate: numOrNull(form.interest_rate),
      start_date: form.start_date || null,
      installment_frequency: form.installment_frequency || null,
      installment_amount: numOrNull(form.installment_amount),
      note: form.note.trim() || null,
    }
    if (!payload.description && !payload.lender) {
      toast({ type: 'warning', message: 'Inserisci almeno una descrizione o il finanziatore' })
      return
    }
    setSaving(true)
    try {
      if (isNew) {
        // nuovo = bozza modificabile (is_active=true)
        const { data, error } = await supabase
          .from('loans')
          .insert({ ...payload, is_active: true } as never)
          .select()
          .single()
        if (error) throw error
        toast({ type: 'success', message: 'Finanziamento creato' })
        const created = data as unknown as LoanRow
        // resta aperto in edit per consentire upload documento
        setIsNew(false)
        setEditing(created)
        loadDocs(created.id)
      } else if (editing) {
        const { error } = await supabase
          .from('loans')
          .update({ ...payload, updated_at: new Date().toISOString() } as never)
          .eq('id', editing.id)
          .eq('company_id', companyId)
        if (error) throw error
        toast({ type: 'success', message: 'Finanziamento aggiornato' })
      }
      refresh()
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore salvataggio: ' + ((err as Error)?.message || '') })
    } finally {
      setSaving(false)
    }
  }

  // disattiva / riattiva (mai DELETE: no data loss)
  async function toggleActive(l: LoanRow) {
    const next = !(l.is_active !== false)
    try {
      const { error } = await supabase
        .from('loans')
        .update({ is_active: next, updated_at: new Date().toISOString() } as never)
        .eq('id', l.id)
        .eq('company_id', companyId)
      if (error) throw error
      toast({ type: 'success', message: next ? 'Finanziamento riattivato' : 'Finanziamento disattivato' })
      refresh()
    } catch (err: unknown) {
      toast({ type: 'error', message: 'Errore: ' + ((err as Error)?.message || '') })
    }
  }

  // ─── parametri piano (dal form CONFERMATO) ─────────────────
  const planParams: Partial<AmortizationParams> = useMemo(() => ({
    principal: numOrNull(form.total_amount) ?? undefined as unknown as number,
    annualRatePct: numOrNull(form.interest_rate) ?? undefined as unknown as number,
    numberOfInstallments: (() => { const n = numOrNull(numInstallments); return n != null && Number.isInteger(n) ? n : (undefined as unknown as number) })(),
    frequency: (normalizeFrequency(form.installment_frequency) ?? undefined) as AmortizationFrequency,
    firstPaymentDate: form.start_date || (undefined as unknown as string),
  }), [form.total_amount, form.interest_rate, numInstallments, form.installment_frequency, form.start_date])

  const plan = useMemo(() => computeAmortization(planParams), [planParams])
  const planValid = isValidAmortizationParams(planParams)

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">
      {/* Header sezione */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-emerald-50 rounded-lg"><Banknote size={18} className="text-emerald-600" /></div>
          <div>
            <h2 className="font-semibold text-slate-900">Finanziamenti</h2>
            <p className="text-xs text-slate-500">Mutui, finanziamenti e leasing collegati ai conti bancari</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowInactive(s => !s)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1.5"
            title={showInactive ? 'Nascondi i finanziamenti disattivati' : 'Mostra anche i disattivati'}
          >
            {showInactive ? <EyeOff size={14} /> : <Eye size={14} />}
            {showInactive ? 'Nascondi disattivati' : 'Mostra disattivati'}
          </button>
          <button
            onClick={openNew}
            disabled={!companyId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus size={15} /> Nuovo finanziamento
          </button>
        </div>
      </div>

      {/* Empty-state account: senza conti non si può collegare nulla */}
      {activeAccounts.length === 0 && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>Non ci sono conti bancari attivi. Aggiungi un conto dal tab <strong>Conti Bancari</strong> per poter collegare un finanziamento. Il finanziamento si lega sempre a un conto esistente.</span>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="text-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Caricamento finanziamenti...</p>
        </div>
      ) : visibleLoans.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
          <Banknote size={32} className="text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Nessun finanziamento registrato</p>
          <p className="text-xs text-slate-400 mt-1">Crea il primo con "Nuovo finanziamento" — i dati nascono come bozza modificabile.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="text-[10px] uppercase text-slate-500 bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-2.5 text-left font-semibold">Descrizione</th>
                <th className="px-4 py-2.5 text-left font-semibold">Tipo</th>
                <th className="px-4 py-2.5 text-left font-semibold">Conto</th>
                <th className="px-4 py-2.5 text-right font-semibold">Importo</th>
                <th className="px-4 py-2.5 text-right font-semibold">Tasso</th>
                <th className="px-4 py-2.5 text-left font-semibold">Periodicità</th>
                <th className="px-4 py-2.5 text-right font-semibold">Rata</th>
                <th className="px-4 py-2.5 text-right font-semibold">Azioni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleLoans.map(l => {
                const inactive = l.is_active === false
                return (
                  <tr key={l.id} className={`hover:bg-slate-50 ${inactive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">
                      <CellTooltip content={l.description || l.lender || ''}>
                        <span className="block max-w-[220px] truncate">{l.description || l.lender || '—'}</span>
                      </CellTooltip>
                      {inactive && <span className="ml-1 text-[10px] text-slate-400">(disattivato)</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{loanTypeLabel(l.loan_type)}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      <CellTooltip content={accountLabel(l.bank_account_id)}>
                        <span className="block max-w-[160px] truncate">{accountLabel(l.bank_account_id)}</span>
                      </CellTooltip>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-slate-900">{l.total_amount != null ? fmtEuro(l.total_amount) : '—'}</td>
                    <td className="px-4 py-3 text-sm text-right text-slate-600">{l.interest_rate != null ? `${l.interest_rate}%` : '—'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{freqLabel(l.installment_frequency)}</td>
                    <td className="px-4 py-3 text-sm text-right text-slate-600">{l.installment_amount != null ? fmtEuro(l.installment_amount) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button onClick={() => openEdit(l)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Modifica / documenti / piano">
                          <Edit2 size={15} />
                        </button>
                        <button onClick={() => toggleActive(l)} className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title={inactive ? 'Riattiva' : 'Disattiva'}>
                          {inactive ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── MODALE FORM ──────────────────────────────────────── */}
      {editing && (
        <Modal
          open
          onClose={closeForm}
          bare
          ariaLabel={isNew ? 'Nuovo finanziamento' : 'Modifica finanziamento'}
          containerClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          panelClassName="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92dvh] flex flex-col"
        >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 rounded-lg"><Banknote size={18} className="text-emerald-600" /></div>
                <h3 className="font-semibold text-slate-900">{isNew ? 'Nuovo finanziamento' : 'Modifica finanziamento'}</h3>
              </div>
              <button onClick={closeForm} className="p-1.5 hover:bg-slate-100 rounded-lg" title="Chiudi"><X size={18} className="text-slate-500" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Campi form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Descrizione">
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="form-inp" placeholder="Es. Mutuo ristrutturazione sede" />
                </Field>
                <Field label="Finanziatore / Banca erogante">
                  <input value={form.lender} onChange={e => setForm(f => ({ ...f, lender: e.target.value }))} className="form-inp" placeholder="Es. MPS" />
                </Field>
                <Field label="Tipo">
                  <select value={form.loan_type} onChange={e => setForm(f => ({ ...f, loan_type: e.target.value }))} className="form-inp">
                    <option value="">—</option>
                    {LOAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Field>
                <Field label="Conto bancario collegato" hint="Solo conti esistenti — non si creano nuovi conti">
                  <select value={form.bank_account_id} onChange={e => setForm(f => ({ ...f, bank_account_id: e.target.value }))} className="form-inp">
                    <option value="">— Nessun conto —</option>
                    {activeAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.bank_name || 'Banca'}{a.account_name ? ` · ${a.account_name}` : ''}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Importo finanziato (€)">
                  <input value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} className="form-inp" inputMode="decimal" placeholder="Vuoto se non noto" />
                </Field>
                <Field label="Tasso annuo (%)">
                  <input value={form.interest_rate} onChange={e => setForm(f => ({ ...f, interest_rate: e.target.value }))} className="form-inp" inputMode="decimal" placeholder="Vuoto se non noto" />
                </Field>
                <Field label="Data inizio / prima rata">
                  <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="form-inp" />
                </Field>
                <Field label="Periodicità">
                  <select value={form.installment_frequency} onChange={e => setForm(f => ({ ...f, installment_frequency: e.target.value }))} className="form-inp">
                    <option value="">—</option>
                    {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Importo rata (€)" hint="Da contratto banca, se noto">
                  <input value={form.installment_amount} onChange={e => setForm(f => ({ ...f, installment_amount: e.target.value }))} className="form-inp" inputMode="decimal" placeholder="Vuoto se non noto" />
                </Field>
                <Field label="Note">
                  <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} className="form-inp" placeholder="" />
                </Field>
              </div>

              {/* ── DOCUMENTI (solo dopo che il loan esiste) ── */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FileText size={15} className="text-slate-500" />
                    <span className="text-sm font-semibold text-slate-700">Documenti (piano di ammortamento PDF della banca)</span>
                  </div>
                </div>
                {isNew || !editing.id ? (
                  <p className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">Salva prima il finanziamento per poter allegare il PDF della banca.</p>
                ) : (
                  <>
                    <label className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-xl p-4 cursor-pointer transition text-sm ${uploading ? 'border-blue-300 bg-blue-50/50 text-blue-600' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50 text-slate-600'}`}>
                      <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx,.doc,.docx"
                        onChange={e => { handleUpload(e.target.files?.[0], editing.id); e.currentTarget.value = '' }} disabled={uploading} />
                      {uploading ? <><RefreshCw size={15} className="animate-spin" /> Caricamento...</> : <><Upload size={15} /> Carica documento (PDF, max 50 MB)</>}
                    </label>
                    <div className="mt-2 space-y-1.5">
                      {docsLoading ? (
                        <p className="text-xs text-slate-400 py-2">Caricamento documenti...</p>
                      ) : docs.length === 0 ? (
                        <p className="text-xs text-slate-400 py-2 flex items-center gap-1.5"><FileWarning size={13} /> Nessun documento allegato</p>
                      ) : docs.map(d => (
                        <div key={d.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                          <FileText size={15} className="text-red-500 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-slate-700 truncate" title={d.file_name}>{d.file_name}</div>
                            <div className="text-[11px] text-slate-400">{fmtSize(d.file_size)} · {fmtDate(d.created_at)}{d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ''}</div>
                          </div>
                          <button onClick={() => downloadDoc(d)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Apri / scarica"><Download size={14} /></button>
                          <button onClick={() => setDeleteDoc(d)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg" title="Elimina documento"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* ── PIANO DI AMMORTAMENTO CALCOLATO ── */}
              <div className="border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calculator size={15} className="text-slate-500" />
                  <span className="text-sm font-semibold text-slate-700">Piano di ammortamento calcolato (alla francese)</span>
                  <CellTooltip content="Piano stimato dai parametri qui sopra (importo, tasso, periodicità, data prima rata) più il numero di rate. È un calcolo deterministico, NON l'estrazione del PDF della banca: il PDF resta la prova archiviata.">
                    <span className="text-slate-300 cursor-help"><AlertCircle size={13} /></span>
                  </CellTooltip>
                </div>
                <div className="flex items-end gap-3 mb-3">
                  <Field label="Numero rate totali">
                    <input value={numInstallments} onChange={e => setNumInstallments(e.target.value)} className="form-inp w-40" inputMode="numeric" placeholder="Es. 60" />
                  </Field>
                </div>
                {!planValid ? (
                  <p className="text-xs text-slate-400 bg-slate-50 rounded-lg p-3">
                    Compila importo, tasso, periodicità, data prima rata e numero rate per generare il piano. Nessun valore viene inventato finché i parametri non sono completi.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <Kpi label="Rata costante" value={fmtEuro(plan.installment)} />
                      <Kpi label="Totale interessi" value={fmtEuro(plan.totalInterest)} />
                      <Kpi label="Totale pagato" value={fmtEuro(plan.totalPaid)} />
                    </div>
                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr className="text-[10px] uppercase text-slate-500">
                            <th className="px-3 py-2 text-left font-semibold">N.</th>
                            <th className="px-3 py-2 text-left font-semibold">Data</th>
                            <th className="px-3 py-2 text-right font-semibold">Capitale</th>
                            <th className="px-3 py-2 text-right font-semibold">Interessi</th>
                            <th className="px-3 py-2 text-right font-semibold">Rata</th>
                            <th className="px-3 py-2 text-right font-semibold">Residuo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {plan.rows.map(r => (
                            <tr key={r.number} className="hover:bg-slate-50">
                              <td className="px-3 py-1.5 text-slate-500">{r.number}</td>
                              <td className="px-3 py-1.5 text-slate-600">{fmtDate(r.date)}</td>
                              <td className="px-3 py-1.5 text-right text-slate-700">{fmtEuro(r.principal)}</td>
                              <td className="px-3 py-1.5 text-right text-slate-500">{fmtEuro(r.interest)}</td>
                              <td className="px-3 py-1.5 text-right font-medium text-slate-900">{fmtEuro(r.installment)}</td>
                              <td className="px-3 py-1.5 text-right text-slate-500">{fmtEuro(r.remaining)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between shrink-0">
              <button onClick={closeForm} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Chiudi</button>
              <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 inline-flex items-center gap-1.5 disabled:opacity-50">
                {saving ? <RefreshCw size={15} className="animate-spin" /> : <Check size={15} />}
                {isNew ? 'Crea finanziamento' : 'Salva modifiche'}
              </button>
            </div>
        </Modal>
      )}

      {/* Conferma elimina documento */}
      {deleteDoc && (
        <Modal
          open
          onClose={() => setDeleteDoc(null)}
          bare
          ariaLabel="Eliminare il documento?"
          containerClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          panelClassName="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-5"
        >
            <h4 className="font-semibold text-slate-900 mb-1">Eliminare il documento?</h4>
            <p className="text-sm text-slate-500 mb-4 truncate" title={deleteDoc.file_name}>{deleteDoc.file_name}</p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDeleteDoc(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50">Annulla</button>
              <button onClick={confirmDeleteDoc} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700">Elimina</button>
            </div>
        </Modal>
      )}

      <style>{`.form-inp{width:100%;padding:0.5rem 0.625rem;border:1px solid rgb(226 232 240);border-radius:0.5rem;font-size:0.875rem}.form-inp:focus{outline:none;border-color:rgb(59 130 246);box-shadow:0 0 0 1px rgb(59 130 246)}`}</style>
    </div>
  )
}

// ─── piccoli helper di layout ──────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">
        {label}
        {hint && <span className="ml-1 text-[10px] font-normal text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-[10px] uppercase text-slate-400 font-semibold">{label}</div>
      <div className="text-sm font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  )
}
