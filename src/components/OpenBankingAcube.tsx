// Componente Open Banking via A-Cube (sostituisce OpenBanking.tsx legacy Yapily).
// Flow onboarding banca: br-upsert → br-enable → connect-request (URL) → utente apre
// in nuova tab → consenso PSD2 banca vera → ritorno → bottone "Sincronizza conti"
// (accounts-sync) → bottone "Aggiorna movimenti" (tx-sync).
//
// Mostra:
//   - Pannello "Apri Banking attivo" con BR + ultimo consent stato
//   - Lista conti collegati (bank_accounts con acube_account_uuid IS NOT NULL)
//   - Bottoni: Collega banca (nuovo onboarding) / Sincronizza conti / Aggiorna movimenti
//   - Selettore Sandbox/Production (visibile solo a super_advisor)

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Landmark, RefreshCw, Link2, Plus, Loader2, CheckCircle2, AlertCircle, Clock, ExternalLink, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { useAuth } from '../hooks/useAuth'
import { useAcubeOB, AcubeStage } from '../hooks/useAcubeOB'

interface BusinessRegistry {
  uuid: string
  fiscal_id: string
  business_name: string
  email: string
  stage: AcubeStage
  enabled: boolean
}

interface BankAccountRow {
  id: string
  bank_name: string
  iban: string | null
  account_name: string | null
  current_balance: number | null
  currency: string | null
  balance_updated_at: string | null
  acube_account_uuid: string | null
  is_active: boolean | null
}

interface ConsentRow {
  id: string
  status: string
  connect_url: string | null
  granted_at: string | null
  expires_at: string | null
  created_at: string | null
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Mai'
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (diff < 60) return 'Ora'
  if (diff < 3600) return `${Math.floor(diff / 60)} min fa`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`
  return `${Math.floor(diff / 86400)}g fa`
}

function fmt(n: number | null | undefined, ccy = 'EUR'): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: ccy, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default function OpenBankingAcube() {
  const { toast } = useToast()
  const { profile } = useAuth()
  const acube = useAcubeOB()

  const companyId = profile?.company_id ?? ''
  const isSuperAdvisor = profile?.role === 'super_advisor'

  // Stage hardcoded a 'production' — sandbox rimosso per evitare confusione
  const stage: AcubeStage = 'production'
  const setStage = (_: AcubeStage) => { /* no-op, sandbox disabilitato */ }
  const [br, setBr] = useState<BusinessRegistry | null>(null)
  const [accounts, setAccounts] = useState<BankAccountRow[]>([])
  const [consents, setConsents] = useState<ConsentRow[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [pendingConnectUrl, setPendingConnectUrl] = useState<string | null>(null)
  const [showOnboardModal, setShowOnboardModal] = useState(false)
  const [onboardForm, setOnboardForm] = useState({ fiscalId: '', businessName: '', email: '' })

  // ────────── Caricamento dati ──────────
  const loadData = useCallback(async () => {
    if (!companyId) return
    setLoadingData(true)
    try {
      const { data: brData } = await supabase
        .from('acube_business_registries' as never)
        .select('uuid, fiscal_id, business_name, email, stage, enabled')
        .eq('stage', stage)
        .limit(1)
        .maybeSingle()
      setBr(((brData as unknown) as BusinessRegistry | null) ?? null)

      const { data: accs } = await supabase
        .from('bank_accounts')
        .select('id, bank_name, iban, account_name, current_balance, currency, balance_updated_at, acube_account_uuid, is_active')
        .eq('company_id', companyId)
        .not('acube_account_uuid', 'is', null)
        .order('account_name')
      setAccounts((accs as BankAccountRow[] | null) ?? [])

      const brUuid = (brData as { uuid?: string } | null)?.uuid
      if (brUuid) {
        const { data: cons } = await supabase
          .from('acube_consents' as never)
          .select('id, status, connect_url, granted_at, expires_at, created_at')
          .eq('business_registry_uuid' as never, brUuid as never)
          .order('created_at', { ascending: false })
          .limit(5)
        setConsents(((cons as unknown) as ConsentRow[] | null) ?? [])
      } else {
        setConsents([])
      }
    } finally {
      setLoadingData(false)
    }
  }, [companyId, stage])

  useEffect(() => { void loadData() }, [loadData])

  // ────────── Onboarding: avvia consent flow ──────────
  const openOnboardModal = () => {
    setOnboardForm({
      fiscalId: br?.fiscal_id ?? '',
      businessName: br?.business_name ?? '',
      email: br?.email ?? profile?.email ?? '',
    })
    setShowOnboardModal(true)
  }

  const handleStartConnect = async () => {
    if (!onboardForm.fiscalId || !onboardForm.businessName || !onboardForm.email) {
      toast({ type: 'warning', message: 'Compila P.IVA, ragione sociale e email.' })
      return
    }
    try {
      const result = await acube.startConnect({
        stage,
        fiscalId: onboardForm.fiscalId.trim(),
        businessName: onboardForm.businessName.trim(),
        email: onboardForm.email.trim(),
        companyId,
      })
      setShowOnboardModal(false)
      setPendingConnectUrl(result.connectUrl)
      window.open(result.connectUrl, '_blank', 'noopener,noreferrer,width=600,height=800')
      toast({ type: 'info', message: 'Si è aperta una nuova finestra per il consenso PSD2. Completa il consenso e poi clicca "Ho completato il consenso".' })
      await loadData()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Errore avvio collegamento'
      toast({ type: 'error', message: msg })
    }
  }

  const handleSyncAccounts = async () => {
    if (!br?.fiscal_id) return toast({ type: 'warning', message: 'Nessun Business Registry attivo.' })
    try {
      const r = await acube.syncAccounts(stage, br.fiscal_id, companyId)
      toast({ type: 'success', message: `Sincronizzati ${r.bank_upserted ?? 0} conti dalla banca.` })
      setPendingConnectUrl(null)
      await loadData()
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Errore sync conti' })
    }
  }

  const handleSyncTx = async () => {
    if (!br?.fiscal_id) return toast({ type: 'warning', message: 'Nessun Business Registry attivo.' })
    try {
      // Step 1: aggiorna saldi (current_balance + balance_updated_at)
      // Step 2: aggiorna movimenti (bank_transactions + ri-update balance_updated_at)
      // In questo modo "Agg. ora" mostrato in UI rappresenta dati realmente freschi
      // (saldo + movimenti), non solo timestamp.
      await acube.syncAccounts(stage, br.fiscal_id, companyId)
      const r = await acube.syncTransactions(stage, br.fiscal_id, companyId)
      toast({ type: 'success', message: `Aggiornati saldi e ${r.bank_inserted ?? 0} nuovi movimenti${r.duplicates ? ` (${r.duplicates} già presenti)` : ''}.` })
      await loadData()
    } catch (err) {
      toast({ type: 'error', message: err instanceof Error ? err.message : 'Errore sync banche' })
    }
  }

  const latestConsent = consents[0]
  const consentBadge = useMemo(() => {
    if (!latestConsent) return null
    if (latestConsent.status === 'granted' || latestConsent.status === 'active') return { label: 'Consenso attivo', color: 'text-emerald-700 bg-emerald-50 border-emerald-200', icon: CheckCircle2 }
    if (latestConsent.status === 'pending') return { label: 'Consenso in attesa', color: 'text-amber-700 bg-amber-50 border-amber-200', icon: Clock }
    if (latestConsent.status === 'expired' || latestConsent.status === 'reconnect_required') return { label: 'Consenso scaduto — rinnova', color: 'text-orange-700 bg-orange-50 border-orange-200', icon: AlertCircle }
    if (latestConsent.status === 'revoked') return { label: 'Consenso revocato', color: 'text-red-700 bg-red-50 border-red-200', icon: AlertCircle }
    return { label: latestConsent.status, color: 'text-slate-600 bg-slate-50 border-slate-200', icon: AlertCircle }
  }, [latestConsent])

  return (
    <div className="bg-white rounded-xl border border-slate-200/80 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Landmark size={16} className="text-blue-600" />
            Open Banking — collegamento banche via PSD2
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Collega in modo sicuro i conti correnti reali: A-Cube gestisce il consenso PSD2.
            I movimenti vengono importati automaticamente nel gestionale.
          </p>
        </div>
        {/* Dropdown stage rimosso — production hardcoded */}
      </div>

      {/* Stato BR + Consent */}
      <div className="bg-slate-50/50 border border-slate-200/60 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs">
            <span className="text-slate-500">Azienda registrata su A-Cube:</span>{' '}
            {br ? (
              <span className="font-medium text-slate-900">{br.business_name} <span className="text-slate-400">({br.fiscal_id})</span></span>
            ) : (
              <span className="text-slate-400 italic">nessuna in stage {stage}</span>
            )}
          </div>
          {consentBadge && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded border flex items-center gap-1 ${consentBadge.color}`}>
              <consentBadge.icon size={11} />{consentBadge.label}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={openOnboardModal}
            disabled={acube.loading}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 disabled:opacity-50"
          >
            <Plus size={13} />{br ? 'Collega altra banca' : 'Collega prima banca'}
          </button>
          {pendingConnectUrl && (
            <>
              <a
                href={pendingConnectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 flex items-center gap-1.5"
              >
                <ExternalLink size={13} />Riapri pagina consenso
              </a>
              <button
                onClick={handleSyncAccounts}
                disabled={acube.loading}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 disabled:opacity-50"
              >
                {acube.loading ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} />}
                Ho completato il consenso — Importa conti
              </button>
            </>
          )}
          {br && accounts.length > 0 && (
            <button
              onClick={handleSyncTx}
              disabled={acube.loading}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1.5 disabled:opacity-50"
            >
              {acube.loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Aggiorna conti e movimenti
            </button>
          )}
        </div>
      </div>

      {/* Lista conti collegati */}
      {loadingData ? (
        <div className="text-center py-6 text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />Caricamento…
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-slate-200 rounded-lg">
          <Landmark size={28} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">Nessuna banca ancora collegata.</p>
          <p className="text-xs text-slate-400 mt-1">Clicca "Collega prima banca" per iniziare.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {accounts.map((a) => (
            <div key={a.id} className="border border-slate-200/80 rounded-lg p-3 bg-white hover:shadow-sm transition">
              <div className="flex items-start justify-between mb-2">
                <div className="min-w-0 flex-1 pr-2">
                  {/* Titolo principale = nome banca (sempre presente, parlante).
                      L'IBAN va sotto come riferimento, non in alto. */}
                  <div className="text-sm font-semibold text-slate-900 truncate" title={a.bank_name || ''}>
                    {a.bank_name || 'Banca'}
                  </div>
                  {/* Sottotitolo solo se account_name e' un alias significativo,
                      non l'IBAN (fallback A-Cube) o lo stesso bank_name */}
                  {a.account_name && a.account_name !== a.bank_name && a.account_name !== a.iban ? (
                    <div className="text-xs text-slate-500 truncate" title={a.account_name}>{a.account_name}</div>
                  ) : null}
                </div>
                <div className={`text-sm font-bold ${(a.current_balance ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmt(a.current_balance, a.currency || 'EUR')}
                </div>
              </div>
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span className="truncate" title={a.iban || ''}>{a.iban || '—'}</span>
                <span
                  className="flex items-center gap-1"
                  title={a.balance_updated_at ? `Ultima sincronizzazione da A-Cube: ${new Date(a.balance_updated_at).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Mai sincronizzato'}
                >
                  <Clock size={10} />{timeAgo(a.balance_updated_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal onboarding */}
      {showOnboardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !acube.loading && setShowOnboardModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-900 mb-1">Collega banca via A-Cube</h2>
            <p className="text-xs text-slate-500 mb-4">
              Compila i dati dell'azienda. Successivamente si aprirà una pagina sicura A-Cube dove sceglierai la banca e darai il consenso PSD2.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">P.IVA / Codice Fiscale</label>
                <input
                  type="text"
                  value={onboardForm.fiscalId}
                  onChange={(e) => setOnboardForm((s) => ({ ...s, fiscalId: e.target.value }))}
                  placeholder="07362100484"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Ragione sociale</label>
                <input
                  type="text"
                  value={onboardForm.businessName}
                  onChange={(e) => setOnboardForm((s) => ({ ...s, businessName: e.target.value }))}
                  placeholder="New Zago Srl"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Email contatto (per notifiche A-Cube)</label>
                <input
                  type="email"
                  value={onboardForm.email}
                  onChange={(e) => setOnboardForm((s) => ({ ...s, email: e.target.value }))}
                  placeholder="contatti@aziendamia.it"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowOnboardModal(false)}
                disabled={acube.loading}
                className="flex-1 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={handleStartConnect}
                disabled={acube.loading}
                className="flex-1 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {acube.loading ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                Avvia consenso
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
