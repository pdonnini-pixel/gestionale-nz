import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useRole } from '../hooks/useRole'
import { getCurrentTenant } from '../lib/tenants'
import {
  Building2, Store, Settings, ChevronRight, ChevronLeft, Check, Loader,
  AlertCircle, MapPin, Mail, FileText, Phone, Hash, Trash2, Plus, BookOpen, Users, Lock, Tag,
} from 'lucide-react'

// ============================================================================
// VALIDATION HELPERS
// ============================================================================
// Validazioni inline (no Zod, no nuove dependencies). Ogni helper ritorna
// `null` se valido, oppure il messaggio di errore in italiano.
//
// Pattern usati:
//   P.IVA italiana       11 cifre numeriche
//   Codice fiscale       11 cifre (PG) oppure 16 alfanum (PF)
//   Codice SDI           7 alfanumerici (default suggerito "0000000")
//   Codice POS           3 lettere maiuscole (es. "VDC", "BRG")
//   Provincia            2 lettere maiuscole (es. "MI", "AR")
//   CAP                  5 cifre numeriche
//   Email                regex semplice (sufficiente, non RFC-completa)
const RE_VAT = /^\d{11}$/
const RE_FISCAL = /^(\d{11}|[A-Z0-9]{16})$/
const RE_SDI = /^[A-Z0-9]{7}$/
const RE_POS_CODE = /^[A-Z]{3}$/
const RE_PROVINCE = /^[A-Z]{2}$/
const RE_CAP = /^\d{5}$/
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function vCompanyName(v: string): string | null {
  const t = v.trim()
  if (t.length < 2) return 'Min 2 caratteri'
  if (t.length > 200) return 'Max 200 caratteri'
  return null
}
function vVat(v: string, required: boolean): string | null {
  const t = v.trim()
  if (!t) return required ? 'Obbligatoria' : null
  if (!RE_VAT.test(t)) return 'P.IVA: 11 cifre numeriche'
  return null
}
function vFiscalCode(v: string): string | null {
  const t = v.trim().toUpperCase()
  if (!t) return null
  if (!RE_FISCAL.test(t)) return 'CF: 11 cifre (società) o 16 caratteri (persona)'
  return null
}
function vEmail(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  if (!RE_EMAIL.test(t)) return 'Email non valida'
  return null
}
function vSdi(v: string): string | null {
  const t = v.trim().toUpperCase()
  if (!t) return null
  if (!RE_SDI.test(t)) return 'Codice SDI: 7 caratteri alfanumerici'
  return null
}
function vPhone(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  if (t.length < 9) return 'Telefono: minimo 9 caratteri'
  return null
}
function vPosCode(v: string): string | null {
  const t = v.trim().toUpperCase()
  if (!t) return 'Obbligatorio'
  if (!RE_POS_CODE.test(t)) return 'Codice: 3 lettere maiuscole (es. VDC)'
  return null
}
function vPosName(v: string): string | null {
  const t = v.trim()
  if (t.length < 2) return 'Min 2 caratteri'
  return null
}
function vProvince(v: string): string | null {
  const t = v.trim().toUpperCase()
  if (!t) return null
  if (!RE_PROVINCE.test(t)) return '2 lettere (es. MI)'
  return null
}
function vCap(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  if (!RE_CAP.test(t)) return '5 cifre'
  return null
}

// ─── Step definitions ──────────────────────────────────────────
// Le label sono dinamiche per lo step 2 (usa `pointOfSaleLabel` del wizard).
const BASE_STEPS = [
  { id: 1, label: 'Azienda', icon: Building2 },
  { id: 2, label: 'Punti vendita', icon: Store }, // sostituita dinamicamente
  { id: 3, label: 'Piano dei conti', icon: BookOpen },
  { id: 4, label: 'Fornitori', icon: Users },
  { id: 5, label: 'Conferma', icon: Settings },
] as const

const POS_LABEL_SUGGESTIONS = ['Outlet', 'Negozio', 'Boutique', 'Store', 'Punto vendita'] as const

interface CompanyForm {
  name: string; vat_number: string; fiscal_code: string; legal_address: string; pec: string; sdi_code: string; phone: string
}
interface OutletForm {
  name: string; code: string; address: string; city: string; province: string; cap: string; phone: string; email: string
}
interface SupplierForm {
  name: string; vat_number: string
}

type ChartTemplate = 'standard' | 'minimal'

function emptyOutlet(): OutletForm {
  return { name: '', code: '', address: '', city: '', province: '', cap: '', phone: '', email: '' }
}
function emptySupplier(): SupplierForm {
  return { name: '', vat_number: '' }
}

// I ruoli che possono completare il wizard. La RPC server-side fa la check
// autoritativa; questo è solo gating UI per evitare di mostrare un wizard a
// chi non potrebbe comunque salvare.
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

  const [pointOfSaleLabel, setPointOfSaleLabel] = useState<string>('Punto vendita')
  const [company, setCompany] = useState<CompanyForm>({
    name: '', vat_number: '', fiscal_code: '', legal_address: '', pec: '', sdi_code: '', phone: '',
  })
  const [outlets, setOutlets] = useState<OutletForm[]>([emptyOutlet()])
  const [chartTemplate, setChartTemplate] = useState<ChartTemplate>('standard')
  const [suppliers, setSuppliers] = useState<SupplierForm[]>([])

  // Validazione step 1 — anagrafica + label POS
  const isStep1Valid =
    pointOfSaleLabel.trim().length >= 2 &&
    vCompanyName(company.name) === null &&
    vVat(company.vat_number, true) === null &&
    vFiscalCode(company.fiscal_code) === null &&
    vEmail(company.pec) === null &&
    vSdi(company.sdi_code) === null &&
    vPhone(company.phone) === null

  // Validazione step 2 — almeno un outlet, tutti validi
  const isStep2Valid =
    outlets.length >= 1 &&
    outlets.every(
      (o) =>
        vPosName(o.name) === null &&
        vPosCode(o.code) === null &&
        vProvince(o.province) === null &&
        vCap(o.cap) === null &&
        vEmail(o.email) === null,
    )

  // Validazione step 4 — fornitori opzionali ma se compilati corretti
  const isStep4Valid = suppliers.every((s) => {
    const nameTrim = s.name.trim()
    if (!nameTrim) return s.vat_number.trim() === '' // riga vuota = ok (verrà filtrata)
    return vVat(s.vat_number, false) === null
  })

  const canSubmit = isStep1Valid && isStep2Valid && isStep4Valid

  const stepsForRender = [...BASE_STEPS].map((s) =>
    s.id === 2 ? { ...s, label: pluralizePosLabel(pointOfSaleLabel) } : s,
  )

  // Placeholder per utenti non autorizzati. Sicuro: l'isolamento di tenant
  // copre il caso, e la RPC server-side è la barriera autoritativa.
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
            azienda, punti vendita, piano dei conti) deve essere fatta da un
            referente autorizzato.
          </p>
          <p className="text-sm text-slate-500 mt-3">
            Contatta il tuo referente per completare il setup. Una volta
            fatto, potrai accedere al gestionale normalmente.
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit() {
    if (!canSubmit) {
      setError('Compila tutti i campi obbligatori prima di completare.')
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
      // dentro un'unica transazione PL/pgSQL con SECURITY DEFINER.
      const filledSuppliers = suppliers.filter((s) => s.name.trim().length > 0)

      const payloadCompany = {
        name: company.name.trim(),
        vat_number: company.vat_number.trim() || null,
        fiscal_code: company.fiscal_code.trim().toUpperCase() || null,
        legal_address: company.legal_address.trim() || null,
        pec: company.pec.trim() || null,
        sdi_code: company.sdi_code.trim().toUpperCase() || null,
      }
      const payloadOutlets = outlets.map((o) => ({
        name: o.name.trim(),
        code: o.code.trim().toUpperCase(),
        address: o.address.trim() || null,
        city: o.city.trim() || null,
        province: o.province.trim().toUpperCase() || null,
        cap: o.cap.trim() || null,
        phone: o.phone.trim() || null,
        email: o.email.trim() || null,
      }))
      const payloadSuppliers = filledSuppliers.map((s) => ({
        name: s.name.trim(),
        vat_number: s.vat_number.trim() || null,
      }))

      // BUG-FIX storico: chiamare supabase.rpc() direttamente. Estrarlo come
      // variabile (`const rpc = supabase.rpc`) PERDE il binding del `this` →
      // TypeError a runtime "Cannot read properties of undefined (reading 'rest')".
      // Cast minimo perché i tipi DB auto-generati non includono ancora la
      // signature della RPC con 5 parametri (rigenerare richiederebbe la CLI
      // con Docker; cast equivalente alla pratica corrente del codebase).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpcCall = (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { message: string } | null }>).bind(supabase)
      const { data: newCompanyId, error: rpcErr } = await rpcCall('onboard_tenant', {
        p_company: payloadCompany,
        p_outlets: payloadOutlets,
        p_chart_template: chartTemplate === 'standard' ? 'nz' : 'minimal',
        p_suppliers: payloadSuppliers,
        p_point_of_sale_label: pointOfSaleLabel.trim() || 'Punto vendita',
      })

      if (rpcErr) throw new Error(rpcErr.message)
      if (!newCompanyId) throw new Error('Onboarding non completato (nessun company_id restituito)')

      await refreshProfile()
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
    if (step === 4 && !isStep4Valid) return
    if (step < BASE_STEPS.length) setStep(step + 1)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Banda tenant — mostra il displayName del tenant (NZ/Made/Zago) come
          identificatore tecnico per l'utente seed che sta facendo il setup.
          Dopo l'onboarding sparisce (l'utente vedrà companies.name nel topbar). */}
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
            <p className="text-slate-500 mt-2">5 passi, tempo stimato 5-10 minuti.</p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-1 mb-8 flex-wrap">
            {stepsForRender.map((s, i) => (
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
                {i < stepsForRender.length - 1 && <ChevronRight size={14} className="text-slate-300 mx-0.5" />}
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-8">
              {step === 1 && (
                <StepCompany
                  company={company}
                  setCompany={setCompany}
                  pointOfSaleLabel={pointOfSaleLabel}
                  setPointOfSaleLabel={setPointOfSaleLabel}
                />
              )}
              {step === 2 && (
                <StepOutlets
                  outlets={outlets}
                  setOutlets={setOutlets}
                  pointOfSaleLabel={pointOfSaleLabel}
                />
              )}
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
                  pointOfSaleLabel={pointOfSaleLabel}
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

              {step < BASE_STEPS.length ? (
                <button
                  onClick={goNext}
                  disabled={
                    (step === 1 && !isStep1Valid) ||
                    (step === 2 && !isStep2Valid) ||
                    (step === 4 && !isStep4Valid)
                  }
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
// HELPERS UI
// ============================================================================
function FieldError({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <p className="mt-1 text-xs text-red-600">{msg}</p>
}

function inputClass(invalid: boolean): string {
  return `w-full px-3 py-2.5 text-sm border rounded-lg focus:ring-2 ${
    invalid
      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
      : 'border-slate-200 focus:ring-blue-500 focus:border-blue-500'
  }`
}
function inputClassWithIcon(invalid: boolean): string {
  return `w-full pl-10 pr-3 py-2.5 text-sm border rounded-lg focus:ring-2 ${
    invalid
      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
      : 'border-slate-200 focus:ring-blue-500 focus:border-blue-500'
  }`
}

// Pluralizzazione minimale italiana per la label POS (vedi useCompanyLabels).
function pluralizePosLabel(singular: string): string {
  const t = singular.trim()
  if (!t) return t
  const parts = t.split(/\s+/)
  const last = parts[parts.length - 1]
  const lower = last.toLowerCase()
  let pluralLast: string
  if (lower.endsWith('o') && lower.length > 2) {
    pluralLast = last.slice(0, -1) + (last.slice(-1) === last.slice(-1).toUpperCase() ? 'I' : 'i')
  } else if (lower.endsWith('a') && lower.length > 2) {
    pluralLast = last.slice(0, -1) + (last.slice(-1) === last.slice(-1).toUpperCase() ? 'E' : 'e')
  } else {
    pluralLast = last
  }
  parts[parts.length - 1] = pluralLast
  return parts.join(' ')
}

// ============================================================================
// STEP 1 — Anagrafica azienda + label POS
// ============================================================================
function StepCompany({
  company,
  setCompany,
  pointOfSaleLabel,
  setPointOfSaleLabel,
}: {
  company: CompanyForm
  setCompany: React.Dispatch<React.SetStateAction<CompanyForm>>
  pointOfSaleLabel: string
  setPointOfSaleLabel: React.Dispatch<React.SetStateAction<string>>
}) {
  const up = (field: keyof CompanyForm, val: string) =>
    setCompany((p) => ({ ...p, [field]: val }))

  // Errori derivati (mostriamo solo se il campo è non vuoto, oppure se è
  // obbligatorio: vuoto = errore visibile per guidare l'utente)
  const errName = vCompanyName(company.name)
  const errVat = vVat(company.vat_number, true)
  const errFiscal = vFiscalCode(company.fiscal_code)
  const errPec = vEmail(company.pec)
  const errSdi = vSdi(company.sdi_code)
  const errPhone = vPhone(company.phone)
  const errPos = pointOfSaleLabel.trim().length < 2 ? 'Min 2 caratteri' : null

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
              placeholder="es. Acme S.r.l."
              className={inputClassWithIcon(!!errName && company.name.length > 0)}
            />
          </div>
          {company.name.length > 0 && <FieldError msg={errName} />}
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
              className={inputClassWithIcon(!!errVat && company.vat_number.length > 0)}
            />
          </div>
          {company.vat_number.length > 0 && <FieldError msg={errVat} />}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Codice Fiscale</label>
          <input
            value={company.fiscal_code}
            onChange={(e) => up('fiscal_code', e.target.value.toUpperCase().slice(0, 16))}
            placeholder="Opzionale"
            className={inputClass(!!errFiscal)}
          />
          <FieldError msg={errFiscal} />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Sede legale</label>
          <div className="relative">
            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.legal_address}
              onChange={(e) => up('legal_address', e.target.value)}
              placeholder="Via Roma 1, 20100 Milano MI"
              className={inputClassWithIcon(false)}
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
              className={inputClassWithIcon(!!errPec)}
            />
          </div>
          <FieldError msg={errPec} />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Codice SDI</label>
          <div className="relative">
            <FileText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.sdi_code}
              onChange={(e) => up('sdi_code', e.target.value.toUpperCase().slice(0, 7))}
              placeholder="0000000"
              maxLength={7}
              className={inputClassWithIcon(!!errSdi)}
            />
          </div>
          <FieldError msg={errSdi} />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Telefono</label>
          <div className="relative">
            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.phone}
              onChange={(e) => up('phone', e.target.value)}
              placeholder="+39…"
              className={inputClassWithIcon(!!errPhone)}
            />
          </div>
          <FieldError msg={errPhone} />
        </div>
      </div>

      {/* Terminologia POS — separata visivamente per richiamare attenzione */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 space-y-3">
        <div className="flex items-start gap-2">
          <Tag size={16} className="text-blue-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-slate-800">
              Come chiami i tuoi punti vendita?
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Il termine apparirà ovunque nell'app (menu, titoli, report). Puoi modificarlo dopo.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {POS_LABEL_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setPointOfSaleLabel(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition border ${
                pointOfSaleLabel === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          value={pointOfSaleLabel}
          onChange={(e) => setPointOfSaleLabel(e.target.value.slice(0, 40))}
          placeholder="Es. Outlet"
          className={inputClass(!!errPos && pointOfSaleLabel.length > 0)}
        />
        {pointOfSaleLabel.length > 0 && <FieldError msg={errPos} />}
      </div>
    </div>
  )
}

// ============================================================================
// STEP 2 — Punti vendita (lista) — usa pointOfSaleLabel dinamica
// ============================================================================
function StepOutlets({
  outlets,
  setOutlets,
  pointOfSaleLabel,
}: {
  outlets: OutletForm[]
  setOutlets: React.Dispatch<React.SetStateAction<OutletForm[]>>
  pointOfSaleLabel: string
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

  const labelSingular = pointOfSaleLabel.trim() || 'Punto vendita'
  const labelPlural = pluralizePosLabel(labelSingular)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{labelPlural}</h2>
        <p className="text-sm text-slate-500 mt-1">
          Almeno uno è obbligatorio. Potrai aggiungerne altri in seguito da Impostazioni.
        </p>
      </div>

      <div className="space-y-4">
        {outlets.map((o, i) => {
          const errName = vPosName(o.name)
          const errCode = vPosCode(o.code)
          const errProv = vProvince(o.province)
          const errCap = vCap(o.cap)
          const errEmail = vEmail(o.email)
          return (
            <div key={i} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Store size={14} className="text-blue-600" />
                  {labelSingular} #{i + 1}
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
                    placeholder={`Es. ${labelSingular} Centro`}
                    className={inputClass(!!errName && o.name.length > 0)}
                  />
                  {o.name.length > 0 && <FieldError msg={errName} />}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Codice * (3 lettere)</label>
                  <input
                    value={o.code}
                    onChange={(e) =>
                      update(i, 'code', e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3))
                    }
                    placeholder="VDC"
                    maxLength={3}
                    className={`${inputClass(!!errCode && o.code.length > 0)} uppercase tracking-widest`}
                  />
                  {o.code.length > 0 && <FieldError msg={errCode} />}
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Indirizzo</label>
                  <input
                    value={o.address}
                    onChange={(e) => update(i, 'address', e.target.value)}
                    placeholder="Via/Piazza…"
                    className={inputClass(false)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Città</label>
                  <input
                    value={o.city}
                    onChange={(e) => update(i, 'city', e.target.value)}
                    className={inputClass(false)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Prov.</label>
                    <input
                      value={o.province}
                      onChange={(e) =>
                        update(i, 'province', e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2))
                      }
                      maxLength={2}
                      placeholder="MI"
                      className={`${inputClass(!!errProv && o.province.length > 0)} uppercase`}
                    />
                    {o.province.length > 0 && <FieldError msg={errProv} />}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">CAP</label>
                    <input
                      value={o.cap}
                      onChange={(e) => update(i, 'cap', e.target.value.replace(/\D/g, '').slice(0, 5))}
                      maxLength={5}
                      placeholder="20100"
                      className={inputClass(!!errCap && o.cap.length > 0)}
                    />
                    {o.cap.length > 0 && <FieldError msg={errCap} />}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Telefono</label>
                  <input
                    value={o.phone}
                    onChange={(e) => update(i, 'phone', e.target.value)}
                    placeholder="+39…"
                    className={inputClass(false)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={o.email}
                    onChange={(e) => update(i, 'email', e.target.value)}
                    placeholder="info@…"
                    className={inputClass(!!errEmail)}
                  />
                  <FieldError msg={errEmail} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={addOutlet}
        className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-blue-600 border-2 border-dashed border-blue-200 rounded-lg hover:bg-blue-50 transition"
      >
        <Plus size={16} /> Aggiungi {labelSingular.toLowerCase()}
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
          Scegli il punto di partenza. Potrai sempre modificare e aggiungere conti dopo.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => setTemplate('standard')}
          className={`text-left p-4 rounded-xl border-2 transition ${
            template === 'standard'
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-semibold text-slate-900">Template standard (consigliato)</span>
            {template === 'standard' && <Check size={16} className="text-blue-600" />}
          </div>
          <p className="text-xs text-slate-500">
            ~26 categorie costo + 20 conti standard, adatto a retail multi-negozio.
            Copre costo del venduto, locazioni, personale, utenze, marketing, finanziarie.
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
            5 categorie base, niente piano dei conti. Costruirai il resto a mano in seguito.
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
        <div className="space-y-3">
          {suppliers.map((s, i) => {
            const errVat = vVat(s.vat_number, false)
            const errName =
              s.name.trim().length === 0 && s.vat_number.trim().length > 0
                ? 'Nome obbligatorio se inserisci P.IVA'
                : null
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    value={s.name}
                    onChange={(e) => update(i, 'name', e.target.value)}
                    placeholder="Ragione sociale fornitore"
                    className={`flex-1 ${inputClass(!!errName)}`}
                  />
                  <input
                    value={s.vat_number}
                    onChange={(e) => update(i, 'vat_number', e.target.value.replace(/\D/g, '').slice(0, 11))}
                    placeholder="P.IVA"
                    maxLength={11}
                    className={`w-36 ${inputClass(!!errVat && s.vat_number.length > 0)}`}
                  />
                  <button
                    onClick={() => removeRow(i)}
                    className="p-2 text-slate-400 hover:text-red-600 transition"
                    title="Rimuovi"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                {(errName || (errVat && s.vat_number.length > 0)) && (
                  <FieldError msg={errName ?? errVat} />
                )}
              </div>
            )
          })}
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
  pointOfSaleLabel,
}: {
  company: CompanyForm
  outlets: OutletForm[]
  template: ChartTemplate
  suppliers: SupplierForm[]
  pointOfSaleLabel: string
}) {
  const filledSuppliers = suppliers.filter((s) => s.name.trim().length > 0)
  const labelSingular = pointOfSaleLabel.trim() || 'Punto vendita'
  const labelPlural = pluralizePosLabel(labelSingular)
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
            <dt className="text-slate-500">Terminologia POS</dt>
            <dd className="font-medium text-slate-900">{labelSingular} / {labelPlural}</dd>
          </dl>
        </div>

        <div className="bg-slate-50 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">
            {labelPlural} ({outlets.length})
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
            {template === 'standard'
              ? 'Template standard — ~26 categorie costo + 20 conti standard'
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
