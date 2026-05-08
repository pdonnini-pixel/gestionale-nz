import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useRole } from '../hooks/useRole'
import { getCurrentTenant } from '../lib/tenants'
import {
  Building2, Store, Settings, ChevronRight, ChevronLeft, Check, Loader,
  AlertCircle, MapPin, Mail, FileText, Phone, Hash, Trash2, Plus, BookOpen, Users, Lock
} from 'lucide-react'

// ─── Step definitions ──────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Azienda', icon: Building2 },
  { id: 2, label: 'Outlet', icon: Store },
  { id: 3, label: 'Piano dei conti', icon: BookOpen },
  { id: 4, label: 'Fornitori', icon: Users },
  { id: 5, label: 'Conferma', icon: Settings },
] as const

// Il template applicato lato server è scelto via parametro `chartTemplate`
// alla RPC `onboard_tenant`. I valori sono `'nz'` (~26 categorie + 20 conti
// allineati allo schema NZ reale) o `'minimal'` (5 categorie, no chart).
//
// I dettagli del template vivono in `frontend/supabase/migrations/20260506_009_onboard_tenant_rpc.sql`
// — qui basta passare la scelta dell'utente.

interface CompanyForm {
  name: string; vat_number: string; fiscal_code: string; legal_address: string; pec: string; sdi_code: string; phone: string
}

interface OutletForm {
  name: string; code: string; address: string; city: string; province: string; cap: string; phone: string; email: string
}

interface SupplierForm {
  name: string; vat_number: string
}

type ChartTemplate = 'nz' | 'minimal'

function emptyOutlet(): OutletForm {
  return { name: '', code: '', address: '', city: '', province: '', cap: '', phone: '', email: '' }
}
function emptySupplier(): SupplierForm {
  return { name: '', vat_number: '' }
}

function isOutletValid(o: OutletForm): boolean {
  return o.name.trim().length > 0 && o.code.trim().length > 0
}

// Le RLS write su companies/outlets/cost_categories/etc. richiedono role
// super_advisor o contabile (vedi 20260417_001*). Lilian (budget_approver)
// va aggiunta come role autorizzato. Per coerenza con CLAUDE.md, qui
// il check UI è permissivo: l'autorità è la RLS lato server.
const ALLOWED_ROLES = ['super_advisor', 'budget_approver'] as const

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function Onboarding() {
  const { profile, refreshProfile } = useAuth()
  const { roles } = useRole()
  const navigate = useNavigate()
  const tenant = getCurrentTenant()

  const canCompile = roles.some((r) => (ALLOWED_ROLES as readonly string[]).includes(r))

  const [step, setStep] = useState<number>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [company, setCompany] = useState<CompanyForm>({
    name: '', vat_number: '', fiscal_code: '', legal_address: '', pec: '', sdi_code: '', phone: '',
  })
  const [outlets, setOutlets] = useState<OutletForm[]>([emptyOutlet()])
  const [chartTemplate, setChartTemplate] = useState<ChartTemplate>('nz')
  const [suppliers, setSuppliers] = useState<SupplierForm[]>([])

  const isStep1Valid = company.name.trim().length > 0 && company.vat_number.trim().length > 0
  const isStep2Valid = outlets.length >= 1 && outlets.every(isOutletValid)
  const canSubmit = isStep1Valid && isStep2Valid

  // Placeholder bloccante per utenti che NON sono autorizzati a compilare.
  // L'isolamento di tenant rende sicuro questo stato: Sabrina non può
  // creare la company per errore, Lilian deve farlo prima.
  if (profile && !canCompile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8 text-center">
          <div
            className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center text-white"
            style={{ background: tenant.accentBg }}
          >
            <Lock size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Tenant non ancora configurato</h1>
          <p className="text-sm text-slate-500 mt-3">
            Il tenant <span className="font-semibold">{tenant.displayName}</span> non è
            ancora stato inizializzato. La configurazione iniziale (anagrafica
            azienda, outlet, piano dei conti) deve essere fatta da Lilian
            (o da Patrizio).
          </p>
          <p className="text-sm text-slate-500 mt-3">
            Per favore contatta il tuo referente per completare il setup. Una
            volta fatto, potrai accedere al gestionale normalmente.
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit() {
    // Diagnostica esplicita: niente early-return silenzioso (era BUG-A nel
    // primo test E2E — handleSubmit usciva senza messaggio se profile = null).
    if (!canSubmit) {
      setError('Compila almeno azienda e un outlet prima di completare.')
      return
    }
    if (saving) return
    if (!profile) {
      setError('Profilo utente non caricato. Effettua logout e login di nuovo, poi riprova.')
      return
    }

    try {
      setSaving(true)
      setError(null)

      // L'onboarding è atomico server-side: la RPC `onboard_tenant` esegue
      // companies + outlets + cost_centers + cost_categories + chart_of_accounts
      // + suppliers + company_settings + UPDATE user_profiles.company_id
      // dentro un'unica transazione PL/pgSQL con SECURITY DEFINER. Se
      // qualcosa fallisce, ROLLBACK automatico — niente stato parziale.
      const filledSuppliers = suppliers.filter((s) => s.name.trim().length > 0)

      const payloadCompany = {
        name: company.name.trim(),
        vat_number: company.vat_number.trim() || null,
        fiscal_code: company.fiscal_code.trim() || null,
        legal_address: company.legal_address.trim() || null,
        pec: company.pec.trim() || null,
        sdi_code: company.sdi_code.trim() || null,
      }
      const payloadOutlets = outlets.map((o) => ({
        name: o.name.trim(),
        code: o.code.trim(),
        address: o.address.trim() || null,
        city: o.city.trim() || null,
        province: o.province.trim() || null,
        cap: o.cap.trim() || null,
        phone: o.phone.trim() || null,
        email: o.email.trim() || null,
      }))
      const payloadSuppliers = filledSuppliers.map((s) => ({
        name: s.name.trim(),
        vat_number: s.vat_number.trim() || null,
      }))

      // supabase-js types per la RPC sono generici; usiamo cast minimo qui.
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { message: string } | null }>

      const { data: newCompanyId, error: rpcErr } = await rpc('onboard_tenant', {
        p_company: payloadCompany,
        p_outlets: payloadOutlets,
        p_chart_template: chartTemplate,
        p_suppliers: payloadSuppliers,
      })

      if (rpcErr) throw new Error(rpcErr.message)
      if (!newCompanyId) throw new Error('Onboarding non completato (nessun company_id restituito)')

      // user_profiles.company_id è già stato aggiornato dalla RPC.
      // Ricarichiamo il profilo locale così che useAuth.profile mostri
      // subito il nuovo company_id e l'OnboardingGate smetta di redirigere.
      await refreshProfile()

      // Hard reload per essere sicuri che ogni store/cache locale che ha
      // letto company_id=null venga ripopolato. Usato anche prima — manteniamo.
      window.location.href = '/'
    } catch (err) {
      console.error('Errore onboarding:', err)
      setError(
        (err as Error).message ||
          'Errore durante la configurazione. Riprova o contatta il supporto.',
      )
    } finally {
      setSaving(false)
    }
  }

  function goNext() {
    if (step === 1 && !isStep1Valid) return
    if (step === 2 && !isStep2Valid) return
    if (step < STEPS.length) setStep(step + 1)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Banda tenant */}
      <div
        className="h-7 flex items-center justify-center px-4 text-white text-xs font-semibold gap-2"
        style={{ background: tenant.accentBg }}
      >
        <span className="opacity-90">Configurazione iniziale tenant:</span>
        <span className="font-bold tracking-wide">{tenant.displayName}</span>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900">Configura il tuo gestionale</h1>
            <p className="text-slate-500 mt-2">
              Imposta {tenant.displayName} in 5 passi. Tempo stimato: 5-10 minuti.
            </p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-1 mb-8 flex-wrap">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <button
                  onClick={() => s.id < step && setStep(s.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium transition ${
                    s.id === step
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                      : s.id < step
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {s.id < step ? <Check size={14} /> : <s.icon size={14} />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <ChevronRight size={14} className="text-slate-300 mx-0.5" />}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-8">
              {step === 1 && <StepCompany company={company} setCompany={setCompany} />}
              {step === 2 && <StepOutlets outlets={outlets} setOutlets={setOutlets} />}
              {step === 3 && (
                <StepChartOfAccounts template={chartTemplate} setTemplate={setChartTemplate} />
              )}
              {step === 4 && <StepSuppliers suppliers={suppliers} setSuppliers={setSuppliers} />}
              {step === 5 && (
                <StepReview
                  company={company}
                  outlets={outlets}
                  template={chartTemplate}
                  suppliers={suppliers}
                />
              )}
            </div>

            {error && (
              <div className="mx-8 mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-between px-8 py-5 bg-slate-50 border-t border-slate-100">
              {step > 1 ? (
                <button
                  onClick={() => setStep(step - 1)}
                  className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition"
                >
                  <ChevronLeft size={16} /> Indietro
                </button>
              ) : (
                <button
                  onClick={() => navigate('/login')}
                  className="text-xs text-slate-400 hover:text-slate-600 transition"
                >
                  Esci
                </button>
              )}

              {step < STEPS.length ? (
                <button
                  onClick={goNext}
                  disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)}
                  className="flex items-center gap-1.5 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                >
                  Avanti <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || saving}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                >
                  {saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />}
                  {saving ? 'Configurazione in corso…' : 'Completa configurazione'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// STEP 1 — Anagrafica azienda
// ============================================================================
function StepCompany({
  company,
  setCompany,
}: {
  company: CompanyForm
  setCompany: React.Dispatch<React.SetStateAction<CompanyForm>>
}) {
  const up = (field: keyof CompanyForm, val: string) =>
    setCompany((p) => ({ ...p, [field]: val }))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Dati azienda</h2>
        <p className="text-sm text-slate-500 mt-1">Inserisci i dati principali della società.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Ragione Sociale *</label>
          <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.name}
              onChange={(e) => up('name', e.target.value)}
              placeholder="es. Made Retail S.r.l."
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Partita IVA *</label>
          <div className="relative">
            <Hash size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.vat_number}
              onChange={(e) => up('vat_number', e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="12345678901"
              maxLength={11}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Codice Fiscale</label>
          <input
            value={company.fiscal_code}
            onChange={(e) => up('fiscal_code', e.target.value.toUpperCase().slice(0, 16))}
            placeholder="Opzionale"
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Sede legale</label>
          <div className="relative">
            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.legal_address}
              onChange={(e) => up('legal_address', e.target.value)}
              placeholder="Via Roma 1, 20100 Milano MI"
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">PEC</label>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="email"
              value={company.pec}
              onChange={(e) => up('pec', e.target.value)}
              placeholder="azienda@pec.it"
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Codice SDI</label>
          <div className="relative">
            <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.sdi_code}
              onChange={(e) => up('sdi_code', e.target.value.toUpperCase().slice(0, 7))}
              placeholder="XXXXXXX"
              maxLength={7}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Telefono</label>
          <div className="relative">
            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.phone}
              onChange={(e) => up('phone', e.target.value)}
              placeholder="+39…"
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// STEP 2 — Outlet (lista)
// ============================================================================
function StepOutlets({
  outlets,
  setOutlets,
}: {
  outlets: OutletForm[]
  setOutlets: React.Dispatch<React.SetStateAction<OutletForm[]>>
}) {
  function update(index: number, field: keyof OutletForm, value: string) {
    setOutlets((arr) => arr.map((o, i) => (i === index ? { ...o, [field]: value } : o)))
  }
  function addOutlet() {
    setOutlets((arr) => [...arr, emptyOutlet()])
  }
  function removeOutlet(index: number) {
    setOutlets((arr) => (arr.length === 1 ? arr : arr.filter((_, i) => i !== index)))
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Outlet / punti vendita</h2>
        <p className="text-sm text-slate-500 mt-1">
          Almeno uno è obbligatorio. Potrai aggiungerne altri in seguito da Impostazioni.
        </p>
      </div>

      <div className="space-y-4">
        {outlets.map((o, i) => (
          <div key={i} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Store size={14} className="text-blue-600" />
                Outlet #{i + 1}
              </div>
              {outlets.length > 1 && (
                <button
                  onClick={() => removeOutlet(i)}
                  className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <Trash2 size={12} /> Rimuovi
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nome *</label>
                <input
                  value={o.name}
                  onChange={(e) => update(i, 'name', e.target.value)}
                  placeholder="es. Outlet Valdichiana"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Codice *</label>
                <input
                  value={o.code}
                  onChange={(e) => update(i, 'code', e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
                  placeholder="VDC"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Indirizzo</label>
                <input
                  value={o.address}
                  onChange={(e) => update(i, 'address', e.target.value)}
                  placeholder="Via/Piazza…"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Città</label>
                <input
                  value={o.city}
                  onChange={(e) => update(i, 'city', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Prov.</label>
                  <input
                    value={o.province}
                    onChange={(e) => update(i, 'province', e.target.value.slice(0, 2))}
                    maxLength={2}
                    placeholder="MI"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">CAP</label>
                  <input
                    value={o.cap}
                    onChange={(e) => update(i, 'cap', e.target.value.replace(/\D/g, '').slice(0, 5))}
                    maxLength={5}
                    placeholder="20100"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addOutlet}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition"
      >
        <Plus size={16} /> Aggiungi outlet
      </button>
    </div>
  )
}

// ============================================================================
// STEP 3 — Piano dei conti
// ============================================================================
function StepChartOfAccounts({
  template,
  setTemplate,
}: {
  template: ChartTemplate
  setTemplate: (t: ChartTemplate) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Piano dei conti</h2>
        <p className="text-sm text-slate-500 mt-1">
          Scegli il punto di partenza. Potrai sempre modificare/aggiungere conti dopo.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => setTemplate('nz')}
          className={`text-left p-4 rounded-xl border-2 transition ${
            template === 'nz'
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-slate-900">Template NZ (consigliato)</span>
            {template === 'nz' && <Check size={16} className="text-blue-600" />}
          </div>
          <p className="text-xs text-slate-500">
            25 categorie costo + 20 conti standard, allineati al modello già rodato su New Zago.
            Adatto per retail multi-outlet.
          </p>
        </button>

        <button
          onClick={() => setTemplate('minimal')}
          className={`text-left p-4 rounded-xl border-2 transition ${
            template === 'minimal'
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-slate-900">Minimo</span>
            {template === 'minimal' && <Check size={16} className="text-blue-600" />}
          </div>
          <p className="text-xs text-slate-500">
            5 categorie base. Niente piano dei conti. Lo costruirai a mano in seguito.
          </p>
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// STEP 4 — Fornitori (opzionale)
// ============================================================================
function StepSuppliers({
  suppliers,
  setSuppliers,
}: {
  suppliers: SupplierForm[]
  setSuppliers: React.Dispatch<React.SetStateAction<SupplierForm[]>>
}) {
  function update(index: number, field: keyof SupplierForm, value: string) {
    setSuppliers((arr) => arr.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }
  function addRow() {
    setSuppliers((arr) => [...arr, emptySupplier()])
  }
  function removeRow(index: number) {
    setSuppliers((arr) => arr.filter((_, i) => i !== index))
  }
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Fornitori principali (opzionale)</h2>
        <p className="text-sm text-slate-500 mt-1">
          Puoi aggiungere qui qualche fornitore per partire. Tutti gli altri verranno
          riconosciuti automaticamente all'arrivo delle prime fatture elettroniche.
        </p>
      </div>

      {suppliers.length === 0 ? (
        <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl text-center text-sm text-slate-500">
          Nessun fornitore. Puoi saltare questo passo o aggiungerne qualcuno ora.
        </div>
      ) : (
        <div className="space-y-2">
          {suppliers.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={s.name}
                onChange={(e) => update(i, 'name', e.target.value)}
                placeholder="Ragione sociale fornitore"
                className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <input
                value={s.vat_number}
                onChange={(e) => update(i, 'vat_number', e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="P.IVA"
                maxLength={11}
                className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={() => removeRow(i)}
                className="p-2 text-slate-400 hover:text-red-600 transition"
                title="Rimuovi"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={addRow}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition"
      >
        <Plus size={16} /> Aggiungi fornitore
      </button>
    </div>
  )
}

// ============================================================================
// STEP 5 — Riepilogo
// ============================================================================
function StepReview({
  company,
  outlets,
  template,
  suppliers,
}: {
  company: CompanyForm
  outlets: OutletForm[]
  template: ChartTemplate
  suppliers: SupplierForm[]
}) {
  const filledSuppliers = suppliers.filter((s) => s.name.trim().length > 0)
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Riepilogo</h2>
        <p className="text-sm text-slate-500 mt-1">
          Verifica i dati. Premi <span className="font-medium">Completa configurazione</span> per
          creare la struttura nel database.
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-slate-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Azienda</h3>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-slate-500">Ragione sociale</dt>
            <dd className="font-medium text-slate-900">{company.name}</dd>
            <dt className="text-slate-500">P. IVA</dt>
            <dd className="font-medium text-slate-900">{company.vat_number}</dd>
            {company.fiscal_code && (
              <>
                <dt className="text-slate-500">Codice fiscale</dt>
                <dd className="font-medium text-slate-900">{company.fiscal_code}</dd>
              </>
            )}
            {company.legal_address && (
              <>
                <dt className="text-slate-500">Sede legale</dt>
                <dd className="font-medium text-slate-900">{company.legal_address}</dd>
              </>
            )}
            {company.pec && (
              <>
                <dt className="text-slate-500">PEC</dt>
                <dd className="font-medium text-slate-900">{company.pec}</dd>
              </>
            )}
            {company.sdi_code && (
              <>
                <dt className="text-slate-500">Codice SDI</dt>
                <dd className="font-medium text-slate-900">{company.sdi_code}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            Outlet ({outlets.length})
          </h3>
          <ul className="text-sm text-slate-700 space-y-1">
            {outlets.map((o, i) => (
              <li key={i}>
                <span className="font-medium">{o.name}</span>
                <span className="text-slate-500"> · {o.code.toUpperCase()}</span>
                {o.city && <span className="text-slate-500"> · {o.city}</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Piano dei conti</h3>
          <p className="text-sm text-slate-700">
            {template === 'nz'
              ? 'Template NZ — 25 categorie costo + 20 conti standard'
              : 'Minimo — 5 categorie costo, niente piano dei conti'}
          </p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            Fornitori ({filledSuppliers.length})
          </h3>
          {filledSuppliers.length === 0 ? (
            <p className="text-sm text-slate-500">Nessun fornitore inserito (li aggiungerai poi).</p>
          ) : (
            <ul className="text-sm text-slate-700 space-y-1">
              {filledSuppliers.map((s, i) => (
                <li key={i}>
                  <span className="font-medium">{s.name}</span>
                  {s.vat_number && <span className="text-slate-500"> · {s.vat_number}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
