// @ts-nocheck
// TODO: tighten types
import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import {
  X, ChevronRight, ChevronLeft, Check, AlertCircle,
  Store, MapPin, FileText, DollarSign, Shield, Save, Paperclip, Upload, Sparkles
} from 'lucide-react'

const BASE_STEPS = [
  { id: 'anagrafica', label: 'Anagrafica', icon: Store },
  { id: 'location', label: 'Ubicazione', icon: MapPin },
  { id: 'contratto', label: 'Contratto', icon: FileText },
  { id: 'canone', label: 'Canone e Costi', icon: DollarSign },
  { id: 'garanzie', label: 'Garanzie e Target', icon: Shield },
  { id: 'riepilogo', label: 'Riepilogo', icon: Check },
]

const ALLEGATI_STEP = { id: 'allegati', label: 'Allegati', icon: Paperclip }

function fmt(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

// TODO: tighten type
type OutletForm = Record<string, any>

interface StepDef {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number }>
}

interface AllegatoEntry {
  code: string
  description?: string
}

function StepIndicator({ currentStep, steps }: { currentStep: number; steps: StepDef[] }) {
  return (
    <div className="flex items-center gap-1 px-5 py-4 border-b border-slate-100 overflow-x-auto">
      {steps.map((step, i) => {
        const isActive = i === currentStep
        const isDone = i < currentStep
        const Icon = step.icon
        return (
          <div key={step.id} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition ${
              isActive ? 'bg-blue-600 text-white' :
              isDone ? 'bg-emerald-50 text-emerald-700' :
              'bg-slate-100 text-slate-400'
            }`}>
              {isDone ? <Check size={12} /> : <Icon size={12} />}
              <span className="whitespace-nowrap">{step.label}</span>
            </div>
            {i < steps.length - 1 && (
              <ChevronRight size={14} className="mx-1 text-slate-300 shrink-0" />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <div className="text-xs text-slate-400 mt-0.5">{hint}</div>}
    </div>
  )
}

function Input({ value, onChange, type = 'text', placeholder, ...props }: { value: string | number | undefined; onChange: (v: string) => void; type?: string; placeholder?: string; [key: string]: unknown }) {
  return (
    <input
      type={type} value={value || ''} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      {...props}
    />
  )
}

function Select({ value, onChange, children }: { value: string | undefined; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
      {children}
    </select>
  )
}

// ====== STEP 1: ANAGRAFICA ======
function StepAnagrafica({ form, set }: { form: OutletForm; set: (k: string, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">Anagrafica punto vendita</h3>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Nome outlet" required>
          <Input value={form.name} onChange={v => set('name', v)} placeholder="es. TORINO" />
        </Field>
        <Field label="Codice" required>
          <Input value={form.code} onChange={v => set('code', v.toUpperCase())} placeholder="es. TRN" style={{maxWidth: 120}} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Insegna / Brand">
          <Input value={form.brand} onChange={v => set('brand', v)} placeholder="es. VICOLO" />
        </Field>
        <Field label="Tipo">
          <Select value={form.outlet_type} onChange={v => set('outlet_type', v)}>
            <option value="outlet">Outlet</option>
            <option value="retail">Retail</option>
            <option value="corner">Corner</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Superficie lorda (mq)" hint="Comprensiva di muri, vetrina, pilastri">
          <Input type="number" value={form.sqm} onChange={v => set('sqm', v)} placeholder="170" />
        </Field>
        <Field label="Superficie di vendita (mq)">
          <Input type="number" value={form.sell_sqm} onChange={v => set('sell_sqm', v)} placeholder="116" />
        </Field>
      </div>
      <Field label="Codice unita nel centro" hint="es. E10, B05">
        <Input value={form.unit_code} onChange={v => set('unit_code', v)} placeholder="E10" />
      </Field>
    </div>
  )
}

// ====== STEP 2: UBICAZIONE ======
function StepLocation({ form, set }: { form: OutletForm; set: (k: string, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">Ubicazione e centro commerciale</h3>
      <Field label="Centro commerciale" required>
        <Input value={form.mall_name} onChange={v => set('mall_name', v)} placeholder="es. Torino Outlet Village" />
      </Field>
      <Field label="Societa concedente">
        <Input value={form.concedente} onChange={v => set('concedente', v)} placeholder="es. Torino Fashion Village Srl" />
      </Field>
      <Field label="Indirizzo">
        <Input value={form.address} onChange={v => set('address', v)} placeholder="Via Torino 162" />
      </Field>
      <div className="grid grid-cols-3 gap-4">
        <Field label="Citta">
          <Input value={form.city} onChange={v => set('city', v)} placeholder="Settimo Torinese" />
        </Field>
        <Field label="Provincia">
          <Input value={form.province} onChange={v => set('province', v.toUpperCase())} placeholder="TO" style={{maxWidth: 80}} />
        </Field>
        <Field label="Regione">
          <Input value={form.region} onChange={v => set('region', v)} placeholder="Piemonte" />
        </Field>
      </div>
    </div>
  )
}

// ====== STEP 3: CONTRATTO ======
function StepContratto({ form, set }: { form: OutletForm; set: (k: string, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">Date e durata contratto</h3>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Data consegna immobile">
          <Input type="date" value={form.delivery_date} onChange={v => set('delivery_date', v)} />
        </Field>
        <Field label="Data apertura" required hint="Confermare quando effettiva">
          <Input type="date" value={form.opening_date} onChange={v => set('opening_date', v)} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={form.opening_confirmed || false}
          onChange={e => set('opening_confirmed', e.target.checked)}
          className="rounded border-slate-300" />
        Data di apertura confermata (attiva il Business Plan)
      </label>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Data inizio contratto (decorrenza)">
          <Input type="date" value={form.contract_start} onChange={v => set('contract_start', v)} />
        </Field>
        <Field label="Data fine contratto">
          <Input type="date" value={form.contract_end} onChange={v => set('contract_end', v)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Durata (mesi)">
          <Input type="number" value={form.contract_duration_months} onChange={v => set('contract_duration_months', v)} placeholder="96" />
        </Field>
        <Field label="Durata minima (mesi)">
          <Input type="number" value={form.contract_min_months} onChange={v => set('contract_min_months', v)} placeholder="48" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Giorni gratuiti iniziali">
          <Input type="number" value={form.rent_free_days} onChange={v => set('rent_free_days', v)} placeholder="30" />
        </Field>
        <Field label="Clausola recesso al mese" hint="Mese dal quale e possibile recedere">
          <Input type="number" value={form.exit_clause_month} onChange={v => set('exit_clause_month', v)} placeholder="42" />
        </Field>
      </div>
    </div>
  )
}

// ====== STEP 4: CANONE E COSTI ======
function StepCanone({ form, set }: { form: OutletForm; set: (k: string, v: unknown) => void }) {
  const monthlyCalc = form.rent_annual ? (form.rent_annual / 12).toFixed(2) : ''

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">Canone e costi ricorrenti</h3>

      <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
        Il canone mensile viene calcolato automaticamente dal canone annuo.
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Canone annuo garantito anno 1 (€)" required>
          <Input type="number" value={form.rent_annual} onChange={v => {
            set('rent_annual', v)
            if (v) set('rent_monthly', (v / 12).toFixed(2))
          }} placeholder="68000" />
        </Field>
        <Field label="Canone mensile (calc.)" hint="= annuo / 12">
          <div className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium">
            {monthlyCalc ? `${fmt(monthlyCalc)} €` : '—'}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="€/mq (canone per mq SLP)">
          <Input type="number" value={form.rent_per_sqm} onChange={v => set('rent_per_sqm', v)} placeholder="400" />
        </Field>
        <Field label="% canone variabile su Volume Affari">
          <Input type="number" value={form.variable_rent_pct} onChange={v => set('variable_rent_pct', v)} placeholder="10" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Canone annuo anno 2 (€)" hint="Se diverso da anno 1">
          <Input type="number" value={form.rent_year2_annual} onChange={v => set('rent_year2_annual', v)} placeholder="68000" />
        </Field>
        <Field label="Canone annuo anno 3+ (€)" hint="Se diverso">
          <Input type="number" value={form.rent_year3_annual} onChange={v => set('rent_year3_annual', v)} placeholder="76500" />
        </Field>
      </div>

      <hr className="border-slate-100" />

      <div className="grid grid-cols-2 gap-4">
        <Field label="Spese condominiali + marketing (€/mese)" hint="Da Condizioni Generali">
          <Input type="number" value={form.condo_marketing_monthly} onChange={v => set('condo_marketing_monthly', v)} placeholder="2000" />
        </Field>
        <Field label="Budget personale mensile (€)">
          <Input type="number" value={form.staff_budget_monthly} onChange={v => set('staff_budget_monthly', v)} />
        </Field>
      </div>
    </div>
  )
}

// ====== STEP 5: GARANZIE E TARGET ======
function StepGaranzie({ form, set }: { form: OutletForm; set: (k: string, v: unknown) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">Garanzie, depositi e target</h3>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Fideiussione / deposito cauzionale (€)">
          <Input type="number" value={form.deposit_guarantee} onChange={v => set('deposit_guarantee', v)} placeholder="58650" />
        </Field>
        <Field label="Anticipo canone versato (€)">
          <Input type="number" value={form.advance_payment} onChange={v => set('advance_payment', v)} placeholder="20000" />
        </Field>
      </div>

      <Field label="Costi di allestimento / setup (€)">
        <Input type="number" value={form.setup_cost} onChange={v => set('setup_cost', v)} />
      </Field>

      <hr className="border-slate-100" />

      <div className="grid grid-cols-2 gap-4">
        <Field label="Target margine %" hint="Margine obiettivo">
          <Input type="number" value={form.target_margin_pct} onChange={v => set('target_margin_pct', v)} placeholder="60" />
        </Field>
        <Field label="Target COGS %">
          <Input type="number" value={form.target_cogs_pct} onChange={v => set('target_cogs_pct', v)} placeholder="40" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Soglia fatturato minimo per recesso (€/anno)" hint="Sotto questa soglia puoi recedere">
          <Input type="number" value={form.exit_revenue_threshold} onChange={v => set('exit_revenue_threshold', v)} placeholder="595000" />
        </Field>
        <Field label="Periodo target minimo">
          <Input value={form.min_revenue_period} onChange={v => set('min_revenue_period', v)} placeholder="42 mesi" />
        </Field>
      </div>

      <Field label="Note">
        <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={3}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder="Informazioni aggiuntive dal contratto..." />
      </Field>
    </div>
  )
}

// ====== STEP 6: RIEPILOGO ======
function StepRiepilogo({ form }: { form: OutletForm }) {
  const sections = [
    { title: 'Anagrafica', items: [
      ['Nome', form.name], ['Codice', form.code], ['Brand', form.brand],
      ['SLP', form.sqm ? `${form.sqm} mq` : '—'], ['Sup. vendita', form.sell_sqm ? `${form.sell_sqm} mq` : '—'],
      ['Unita', form.unit_code],
    ]},
    { title: 'Ubicazione', items: [
      ['Centro', form.mall_name], ['Concedente', form.concedente],
      ['Indirizzo', form.address], ['Citta', `${form.city || ''} (${form.province || ''})`],
    ]},
    { title: 'Contratto', items: [
      ['Apertura', form.opening_date], ['Confermata', form.opening_confirmed ? 'Si' : 'No'],
      ['Consegna', form.delivery_date], ['Decorrenza', form.contract_start],
      ['Fine', form.contract_end], ['Durata', form.contract_duration_months ? `${form.contract_duration_months} mesi` : '—'],
      ['Giorni gratis', form.rent_free_days || '0'],
    ]},
    { title: 'Canone e Costi', items: [
      ['Canone annuo', form.rent_annual ? `${fmt(form.rent_annual)} €` : '—'],
      ['Canone mensile', form.rent_monthly ? `${fmt(form.rent_monthly)} €` : '—'],
      ['€/mq', form.rent_per_sqm], ['% variabile', form.variable_rent_pct ? `${form.variable_rent_pct}%` : '—'],
      ['Anno 2', form.rent_year2_annual ? `${fmt(form.rent_year2_annual)} €` : '= anno 1'],
      ['Anno 3+', form.rent_year3_annual ? `${fmt(form.rent_year3_annual)} €` : '= anno 2'],
      ['Spese cond./mkt', form.condo_marketing_monthly ? `${fmt(form.condo_marketing_monthly)} €/mese` : '—'],
    ]},
    { title: 'Garanzie e Target', items: [
      ['Fideiussione', form.deposit_guarantee ? `${fmt(form.deposit_guarantee)} €` : '—'],
      ['Anticipo', form.advance_payment ? `${fmt(form.advance_payment)} €` : '—'],
      ['Target margine', form.target_margin_pct ? `${form.target_margin_pct}%` : '60%'],
      ['Soglia recesso', form.exit_revenue_threshold ? `${fmt(form.exit_revenue_threshold)} €/anno` : '—'],
    ]},
  ]

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">Riepilogo — Verifica prima di salvare</h3>
      {sections.map(s => (
        <div key={s.title} className="bg-slate-50 rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{s.title}</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-sm">
            {s.items.map(([label, value]) => (
              <div key={label} className="flex justify-between py-0.5">
                <span className="text-slate-500">{label}</span>
                <span className="font-medium text-slate-900">{value || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {form.notes && (
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Note</div>
          <div className="text-sm text-slate-700">{form.notes}</div>
        </div>
      )}
    </div>
  )
}

// ====== STEP 7: ALLEGATI (solo se da contratto) ======
function StepAllegati({ allegati, contractFileName, uploadedFiles, onFileUpload }: { allegati: AllegatoEntry[]; contractFileName?: string; uploadedFiles: Record<string, File>; onFileUpload?: (code: string, file: File) => void }) {
  const defaultLabels = {
    'A': 'Planimetria Outlet',
    'B': 'Condizioni Generali',
    'C': 'Planimetria Porzione Immobiliare',
    'D': 'Elenco Impianti e Cespiti',
    'E': 'Progetto layout',
    'F': 'Bozza fideiussione bancaria',
    'CG': 'Condizioni Generali',
    'REG': 'Regolamento immobiliare',
  }

  const uploaded = uploadedFiles || {}
  const uploadedCount = Object.keys(uploaded).length

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-slate-900">Allegati del contratto</h3>

      <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800 flex items-start gap-2">
        <Sparkles size={16} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">Documento analizzato: {contractFileName}</div>
          <div className="text-xs mt-0.5 text-blue-600">
            Clicca su ogni allegato per caricarlo ora. Puoi anche farlo dopo dalla scheda outlet.
          </div>
        </div>
      </div>

      {uploadedCount > 0 && (
        <div className="flex items-center gap-2 p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
          <Check size={14} />
          <span className="font-medium">{uploadedCount}/{allegati.length} allegati caricati</span>
        </div>
      )}

      {allegati && allegati.length > 0 ? (
        <div className="space-y-2">
          {allegati.map(a => {
            const file = uploaded[a.code]
            return (
              <label key={a.code} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                file ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200 hover:bg-amber-100/80'
              }`}>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                  onChange={e => {
                    if (e.target.files[0] && onFileUpload) {
                      onFileUpload(a.code, e.target.files[0])
                    }
                  }}
                />
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  file ? 'bg-emerald-500 text-white' : 'border-2 border-amber-300 bg-white'
                }`}>
                  {file ? <Check size={16} /> : <span className="text-xs font-bold text-amber-600">{a.code}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${file ? 'text-emerald-900' : 'text-amber-900'}`}>
                    Allegato {a.code} — {a.description || defaultLabels[a.code] || 'Documento'}
                  </div>
                  {file ? (
                    <div className="text-xs text-emerald-600 truncate">{file.name} ({(file.size / 1024).toFixed(0)} KB)</div>
                  ) : (
                    <div className="text-xs text-amber-600 mt-0.5">Clicca per caricare</div>
                  )}
                </div>
                {file ? (
                  <Check size={16} className="text-emerald-500 shrink-0" />
                ) : (
                  <Upload size={16} className="text-amber-400 shrink-0" />
                )}
              </label>
            )
          })}
        </div>
      ) : (
        <div className="text-sm text-slate-500 py-4 text-center">
          Nessun allegato rilevato nel contratto.
        </div>
      )}
    </div>
  )
}

// ====== WIZARD PRINCIPALE ======
interface OutletWizardProps {
  onClose: () => void
  onSaved: () => void
  initialData?: OutletForm | null
  allegati?: AllegatoEntry[] | null
  contractFileName?: string
  uploadedFiles?: Record<string, File>
  editId?: string | null
}

export default function OutletWizard({ onClose, onSaved, initialData, allegati, contractFileName, uploadedFiles: initialUploadedFiles, editId }: OutletWizardProps) {
  const hasAllegati = allegati && allegati.length > 0
  const STEPS = hasAllegati ? [...BASE_STEPS.slice(0, 5), ALLEGATI_STEP, BASE_STEPS[5]] : BASE_STEPS
  const riepilogoIndex = hasAllegati ? 6 : 5

  const defaultForm = {
    name: '', code: '', brand: '', outlet_type: 'outlet',
    sqm: '', sell_sqm: '', unit_code: '',
    mall_name: '', concedente: '', address: '', city: '', province: '', region: '',
    delivery_date: '', opening_date: '', opening_confirmed: false,
    contract_start: '', contract_end: '', contract_duration_months: '', contract_min_months: '',
    rent_free_days: '30', exit_clause_month: '',
    rent_annual: '', rent_monthly: '', rent_per_sqm: '', variable_rent_pct: '',
    rent_year2_annual: '', rent_year3_annual: '',
    condo_marketing_monthly: '', staff_budget_monthly: '',
    deposit_guarantee: '', advance_payment: '', setup_cost: '',
    target_margin_pct: '60', target_cogs_pct: '40',
    exit_revenue_threshold: '', min_revenue_period: '', notes: ''
  }

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(initialData ? { ...defaultForm, ...initialData } : defaultForm)
  const [wizardUploadedFiles, setWizardUploadedFiles] = useState(initialUploadedFiles || {})

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))
  const handleFileUpload = (code, file) => setWizardUploadedFiles(prev => ({ ...prev, [code]: file }))

  function canNext() {
    if (step === 0) return form.name && form.code
    if (step === 2) return form.opening_date
    return true
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    const numOrNull = v => v ? parseFloat(v) : null
    const strOrNull = v => v || null

    const payload = {
      company_id: '00000000-0000-0000-0000-000000000001',
      name: form.name, code: form.code,
      brand: strOrNull(form.brand), outlet_type: form.outlet_type,
      sqm: numOrNull(form.sqm), sell_sqm: numOrNull(form.sell_sqm), unit_code: strOrNull(form.unit_code),
      mall_name: strOrNull(form.mall_name), concedente: strOrNull(form.concedente), mall_manager: strOrNull(form.concedente),
      address: strOrNull(form.address), city: strOrNull(form.city), province: strOrNull(form.province), region: strOrNull(form.region),
      delivery_date: strOrNull(form.delivery_date), opening_date: strOrNull(form.opening_date), opening_confirmed: form.opening_confirmed,
      contract_start: strOrNull(form.contract_start), contract_end: strOrNull(form.contract_end),
      contract_duration_months: numOrNull(form.contract_duration_months), contract_min_months: numOrNull(form.contract_min_months),
      rent_free_days: numOrNull(form.rent_free_days), exit_clause_month: numOrNull(form.exit_clause_month),
      rent_annual: numOrNull(form.rent_annual), rent_monthly: numOrNull(form.rent_monthly),
      rent_per_sqm: numOrNull(form.rent_per_sqm), variable_rent_pct: numOrNull(form.variable_rent_pct),
      rent_year2_annual: numOrNull(form.rent_year2_annual), rent_year3_annual: numOrNull(form.rent_year3_annual),
      condo_marketing_monthly: numOrNull(form.condo_marketing_monthly), staff_budget_monthly: numOrNull(form.staff_budget_monthly),
      deposit_guarantee: numOrNull(form.deposit_guarantee), deposit_amount: numOrNull(form.deposit_guarantee),
      advance_payment: numOrNull(form.advance_payment), setup_cost: numOrNull(form.setup_cost),
      target_margin_pct: numOrNull(form.target_margin_pct), target_cogs_pct: numOrNull(form.target_cogs_pct),
      min_revenue_target: numOrNull(form.exit_revenue_threshold), min_revenue_period: strOrNull(form.min_revenue_period),
      exit_revenue_threshold: numOrNull(form.exit_revenue_threshold),
      bp_status: form.opening_confirmed ? 'attivo' : 'bozza',
      is_active: true, notes: strOrNull(form.notes),
    }

    let inserted, err

    if (editId) {
      // Modalita' modifica
      const res = await supabase.from('outlets').update(payload).eq('id', editId).select('id').single()
      inserted = res.data
      err = res.error
    } else {
      // Modalita' creazione
      const res = await supabase.from('outlets').insert(payload).select('id').single()
      inserted = res.data
      err = res.error
    }

    if (err) {
      setError(err.message)
      setSaving(false)
      return
    }

    // Crea record allegati se presenti
    if (inserted && allegati && allegati.length > 0) {
      const defaultLabels = {
        'A': 'Planimetria Outlet', 'B': 'Condizioni Generali', 'C': 'Planimetria Porzione Immobiliare',
        'D': 'Elenco Impianti e Cespiti', 'E': 'Progetto layout', 'F': 'Bozza fideiussione bancaria',
        'CG': 'Condizioni Generali', 'REG': 'Regolamento immobiliare',
      }

      const outletId = inserted.id
      const storagePath = `${payload.company_id}/${outletId}`

      // Upload dei file caricati su Supabase Storage
      const uploadResults = {}
      for (const [code, file] of Object.entries(wizardUploadedFiles)) {
        const ext = file.name.split('.').pop()
        const filePath = `${storagePath}/allegato_${code.toLowerCase()}.${ext}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('outlet-attachments')
          .upload(filePath, file, { upsert: true })
        if (!uploadErr && uploadData) {
          uploadResults[code] = filePath
        }
      }

      const attachmentRows = [
        // Il contratto stesso
        {
          company_id: payload.company_id,
          outlet_id: outletId,
          attachment_type: 'contratto',
          label: `Contratto di affitto — ${contractFileName || 'Documento'}`,
          file_name: contractFileName || null,
          is_required: true,
          is_uploaded: false,
        },
        // Ogni allegato menzionato
        ...allegati.map(a => {
          const filePath = uploadResults[a.code]
          return {
            company_id: payload.company_id,
            outlet_id: outletId,
            attachment_type: `allegato_${a.code.toLowerCase()}`,
            label: `Allegato ${a.code} — ${a.description || defaultLabels[a.code] || 'Documento'}`,
            file_name: wizardUploadedFiles[a.code]?.name || null,
            file_path: filePath || null,
            is_required: true,
            is_uploaded: !!filePath,
          }
        }),
      ]

      await supabase.from('outlet_attachments').insert(attachmentRows)
    }

    onSaved()
  }

  const baseSteps = [
    <StepAnagrafica form={form} set={set} />,
    <StepLocation form={form} set={set} />,
    <StepContratto form={form} set={set} />,
    <StepCanone form={form} set={set} />,
    <StepGaranzie form={form} set={set} />,
  ]

  const stepComponents = hasAllegati
    ? [...baseSteps, <StepAllegati allegati={allegati} contractFileName={contractFileName} uploadedFiles={wizardUploadedFiles} onFileUpload={handleFileUpload} />, <StepRiepilogo form={form} />]
    : [...baseSteps, <StepRiepilogo form={form} />]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {editId ? 'Modifica outlet' : initialData ? 'Nuovo outlet da contratto' : 'Nuovo outlet'}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
        </div>

        {/* Step indicator */}
        <StepIndicator currentStep={step} steps={STEPS} />

        {/* Pre-fill banner */}
        {initialData && step === 0 && (
          <div className="mx-5 mt-3 flex items-center gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
            <Sparkles size={14} />
            <span>Dati pre-compilati dal contratto <strong>{contractFileName}</strong>. Verifica e completa i campi mancanti.</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 text-red-700 rounded-lg text-sm">
              <AlertCircle size={16} />{error}
            </div>
          )}
          {stepComponents[step]}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-slate-100">
          <button
            onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} /> Indietro
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={!canNext()}
              className="flex items-center gap-1 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
            >
              Avanti <ChevronRight size={16} />
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-5 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
            >
              <Save size={16} />
              {saving ? 'Salvataggio...' : editId ? 'Salva modifiche' : 'Crea outlet'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
