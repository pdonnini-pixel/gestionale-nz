// @ts-nocheck
// TODO: tighten types
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  Building2, Store, Settings, ChevronRight, ChevronLeft, Check, Loader,
  AlertCircle, MapPin, Mail, FileText, Phone, Hash
} from 'lucide-react'

// ========================
// STEP DEFINITIONS
// ========================
const STEPS = [
  { id: 1, label: 'Azienda', icon: Building2, description: 'Dati della tua azienda' },
  { id: 2, label: 'Primo Outlet', icon: Store, description: 'Crea il tuo primo punto vendita' },
  { id: 3, label: 'Configurazione', icon: Settings, description: 'Impostazioni iniziali' },
]

const DEFAULT_COST_CATEGORIES = [
  { name: 'Costo del venduto', macro_group: 'Costo del venduto', sort_order: 1 },
  { name: 'Affitto', macro_group: 'Locazione', sort_order: 2 },
  { name: 'Stipendi', macro_group: 'Personale', sort_order: 3 },
  { name: 'Contributi', macro_group: 'Personale', sort_order: 4 },
  { name: 'TFR', macro_group: 'Personale', sort_order: 5 },
  { name: 'Utenze', macro_group: 'Utenze & Servizi', sort_order: 6 },
  { name: 'Commercialista', macro_group: 'Generali & Amministrative', sort_order: 7 },
  { name: 'Assicurazioni', macro_group: 'Generali & Amministrative', sort_order: 8 },
  { name: 'Marketing', macro_group: 'Marketing', sort_order: 9 },
  { name: 'Manutenzione', macro_group: 'Manutenzione', sort_order: 10 },
]

const DEFAULT_COST_CENTERS = [
  { code: 'sede', label: 'Sede / Magazzino', sort_order: 1 },
]

// ========================
// MAIN COMPONENT
// ========================
export default function Onboarding() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [company, setCompany] = useState({
    name: '', vat_number: '', fiscal_code: '', legal_address: '', pec: '', sdi_code: '', phone: ''
  })
  const [outlet, setOutlet] = useState({
    name: '', code: '', address: '', city: '', province: '', cap: '', phone: '', email: ''
  })
  const [config, setConfig] = useState({
    createDefaultCategories: true,
    createDefaultCostCenter: true,
    currency: 'EUR',
    fiscalYearStart: '01',
  })

  // Validazione per step
  const isStep1Valid = company.name.trim().length > 0 && company.vat_number.trim().length > 0
  const isStep2Valid = outlet.name.trim().length > 0 && outlet.code.trim().length > 0
  const canSubmit = isStep1Valid && isStep2Valid

  // ========================
  // SUBMIT — crea azienda + outlet + config
  // ========================
  const handleSubmit = async () => {
    if (!canSubmit || saving) return

    try {
      setSaving(true)
      setError(null)

      // 1. Crea azienda
      const { data: newCompany, error: companyError } = await supabase
        .from('companies')
        .insert([{
          name: company.name.trim(),
          vat_number: company.vat_number.trim(),
          fiscal_code: company.fiscal_code.trim() || null,
          legal_address: company.legal_address.trim() || null,
          pec: company.pec.trim() || null,
          sdi_code: company.sdi_code.trim() || null,
          settings: { currency: config.currency, fiscal_year_start: config.fiscalYearStart }
        }])
        .select()
        .single()

      if (companyError) throw companyError
      const companyId = newCompany.id

      // 2. Aggiorna profilo utente con la nuova azienda
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({ company_id: companyId })
        .eq('id', profile.id)

      if (profileError) throw profileError

      // 3. Crea primo outlet
      const { error: outletError } = await supabase
        .from('outlets')
        .insert([{
          company_id: companyId,
          name: outlet.name.trim(),
          code: outlet.code.trim().toUpperCase(),
          address: outlet.address.trim() || null,
          city: outlet.city.trim() || null,
          province: outlet.province.trim().toUpperCase() || null,
          cap: outlet.cap.trim() || null,
          phone: outlet.phone.trim() || null,
          email: outlet.email.trim() || null,
          is_active: true,
        }])

      if (outletError) throw outletError

      // 4. Crea company_settings
      const { error: settingsError } = await supabase
        .from('company_settings')
        .insert([{
          company_id: companyId,
          settings_key: 'general',
          settings_value: {
            currency: config.currency,
            fiscal_year_start: config.fiscalYearStart,
            onboarding_completed: true,
            onboarding_date: new Date().toISOString(),
          }
        }])

      if (settingsError) throw settingsError

      // 5. Categorie costo di default
      if (config.createDefaultCategories) {
        const categories = DEFAULT_COST_CATEGORIES.map(c => ({
          ...c, company_id: companyId
        }))
        const { error: catError } = await supabase
          .from('cost_categories')
          .insert(categories)

        if (catError) console.error('Errore categorie:', catError)
      }

      // 6. Centro di costo di default
      if (config.createDefaultCostCenter) {
        const centers = DEFAULT_COST_CENTERS.map(c => ({
          ...c, company_id: companyId
        }))

        // Aggiungi anche l'outlet appena creato come centro di costo
        centers.push({
          code: outlet.code.trim().toLowerCase(),
          label: outlet.name.trim(),
          company_id: companyId,
          sort_order: 2,
        })

        const { error: ccError } = await supabase
          .from('cost_centers')
          .insert(centers)

        if (ccError) console.error('Errore centri costo:', ccError)
      }

      // Successo — redirect alla dashboard (con reload per aggiornare il contesto)
      window.location.href = '/'

    } catch (err: unknown) {
      console.error('Errore onboarding:', err)
      setError((err as Error).message || 'Errore durante la configurazione. Riprova.')
    } finally {
      setSaving(false)
    }
  }

  // ========================
  // RENDER
  // ========================
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Configura il tuo gestionale</h1>
          <p className="text-slate-500 mt-2">Imposta la tua azienda in pochi minuti</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <button
                onClick={() => s.id < step && setStep(s.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition ${
                  s.id === step
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                    : s.id < step
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {s.id < step ? <Check size={16} /> : <s.icon size={16} />}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <ChevronRight size={16} className="text-slate-300 mx-1" />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          {/* Step content */}
          <div className="p-8">
            {step === 1 && (
              <StepCompany company={company} setCompany={setCompany} />
            )}
            {step === 2 && (
              <StepOutlet outlet={outlet} setOutlet={setOutlet} />
            )}
            {step === 3 && (
              <StepConfig config={config} setConfig={setConfig} company={company} outlet={outlet} />
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mx-8 mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-8 py-5 bg-slate-50 border-t border-slate-100">
            {step > 1 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 transition"
              >
                <ChevronLeft size={16} /> Indietro
              </button>
            ) : <div />}

            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && !isStep1Valid || step === 2 && !isStep2Valid}
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
                {saving ? 'Configurazione in corso...' : 'Completa configurazione'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ========================
// STEP 1: AZIENDA
// ========================
interface CompanyForm {
  name: string; vat_number: string; fiscal_code: string; legal_address: string; pec: string; sdi_code: string; phone: string
}
interface OutletForm {
  name: string; code: string; address: string; city: string; province: string; cap: string; phone: string; email: string
}
interface ConfigForm {
  createDefaultCategories: boolean; createDefaultCostCenter: boolean; currency: string; fiscalYearStart: string
}

function StepCompany({ company, setCompany }: { company: CompanyForm; setCompany: React.Dispatch<React.SetStateAction<CompanyForm>> }) {
  const up = (field: string, val: string) => setCompany(p => ({ ...p, [field]: val }))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Dati azienda</h2>
        <p className="text-sm text-slate-500 mt-1">Inserisci i dati principali della tua azienda</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Ragione Sociale *
          </label>
          <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.name}
              onChange={e => up('name', e.target.value)}
              placeholder="es. New Zago S.r.l."
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
              onChange={e => up('vat_number', e.target.value.replace(/\D/g, '').slice(0, 11))}
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
            onChange={e => up('fiscal_code', e.target.value.toUpperCase().slice(0, 16))}
            placeholder="Opzionale"
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Sede Legale</label>
          <div className="relative">
            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={company.legal_address}
              onChange={e => up('legal_address', e.target.value)}
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
              onChange={e => up('pec', e.target.value)}
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
              onChange={e => up('sdi_code', e.target.value.toUpperCase().slice(0, 7))}
              placeholder="XXXXXXX"
              maxLength={7}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ========================
// STEP 2: OUTLET
// ========================
function StepOutlet({ outlet, setOutlet }: { outlet: OutletForm; setOutlet: React.Dispatch<React.SetStateAction<OutletForm>> }) {
  const up = (field: string, val: string) => setOutlet(p => ({ ...p, [field]: val }))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Primo punto vendita</h2>
        <p className="text-sm text-slate-500 mt-1">Potrai aggiungerne altri in seguito dalle Impostazioni</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Nome Outlet *</label>
          <div className="relative">
            <Store size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={outlet.name}
              onChange={e => up('name', e.target.value)}
              placeholder="es. Valdichiana Village"
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Codice *</label>
          <input
            value={outlet.code}
            onChange={e => up('code', e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20))}
            placeholder="es. valdichiana"
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase"
          />
          <p className="text-[11px] text-slate-400 mt-1">Identificativo unico, usato nelle importazioni e report</p>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Indirizzo</label>
          <div className="relative">
            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={outlet.address}
              onChange={e => up('address', e.target.value)}
              placeholder="Via/Piazza..."
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Città</label>
          <input value={outlet.city} onChange={e => up('city', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Prov.</label>
            <input value={outlet.province} onChange={e => up('province', e.target.value.slice(0, 2))}
              maxLength={2} placeholder="MI"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 uppercase" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CAP</label>
            <input value={outlet.cap} onChange={e => up('cap', e.target.value.replace(/\D/g, '').slice(0, 5))}
              maxLength={5} placeholder="20100"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Telefono</label>
          <div className="relative">
            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={outlet.phone} onChange={e => up('phone', e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <div className="relative">
            <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="email" value={outlet.email} onChange={e => up('email', e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ========================
// STEP 3: CONFIG
// ========================
function StepConfig({ config, setConfig, company, outlet }: { config: ConfigForm; setConfig: React.Dispatch<React.SetStateAction<ConfigForm>>; company: CompanyForm; outlet: OutletForm }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Configurazione iniziale</h2>
        <p className="text-sm text-slate-500 mt-1">Personalizza le impostazioni di base</p>
      </div>

      {/* Riepilogo */}
      <div className="bg-slate-50 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-medium text-slate-700">Riepilogo</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div className="text-slate-500">Azienda:</div>
          <div className="font-medium">{company.name}</div>
          <div className="text-slate-500">P.IVA:</div>
          <div className="font-medium">{company.vat_number}</div>
          <div className="text-slate-500">Primo outlet:</div>
          <div className="font-medium">{outlet.name} ({outlet.code.toUpperCase()})</div>
        </div>
      </div>

      {/* Opzioni */}
      <div className="space-y-4">
        <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition">
          <input
            type="checkbox"
            checked={config.createDefaultCategories}
            onChange={e => setConfig(p => ({ ...p, createDefaultCategories: e.target.checked }))}
            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="text-sm font-medium text-slate-800">Crea categorie costo di default</div>
            <div className="text-xs text-slate-500 mt-0.5">
              10 categorie standard (Costo venduto, Affitto, Stipendi, Utenze, ecc.)
            </div>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition">
          <input
            type="checkbox"
            checked={config.createDefaultCostCenter}
            onChange={e => setConfig(p => ({ ...p, createDefaultCostCenter: e.target.checked }))}
            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <div className="text-sm font-medium text-slate-800">Crea centri di costo di default</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Sede/Magazzino + il tuo primo outlet come centri di costo
            </div>
          </div>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Valuta</label>
            <select
              value={config.currency}
              onChange={e => setConfig(p => ({ ...p, currency: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="EUR">EUR — Euro</option>
              <option value="USD">USD — Dollaro US</option>
              <option value="GBP">GBP — Sterlina</option>
              <option value="CHF">CHF — Franco svizzero</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Inizio anno fiscale</label>
            <select
              value={config.fiscalYearStart}
              onChange={e => setConfig(p => ({ ...p, fiscalYearStart: e.target.value }))}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="01">Gennaio</option>
              <option value="04">Aprile</option>
              <option value="07">Luglio</option>
              <option value="10">Ottobre</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
