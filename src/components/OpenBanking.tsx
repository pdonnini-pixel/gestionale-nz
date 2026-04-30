import React, { useState, useEffect, useCallback } from 'react'
import {
  Landmark, Building2, Search, Plus, RefreshCw, Link2, Unlink,
  ChevronRight, Clock, CheckCircle2, AlertCircle, XCircle,
  ArrowDownLeft, ArrowUpRight, Wallet, ExternalLink, Loader2, Download,
  CreditCard, Globe, Shield, ChevronDown, ChevronUp, X
} from 'lucide-react'
import { useYapily } from '../hooks/useYapily'
import AccountDetail from './AccountDetail'

function fmt(n, dec = 2) {
  if (n == null) return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(n)
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Mai'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now - d) / 1000)
  if (diff < 60) return 'Ora'
  if (diff < 3600) return `${Math.floor(diff / 60)} min fa`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`
  return `${Math.floor(diff / 86400)}g fa`
}

const statusConfig = {
  AUTHORIZED: { label: 'Attivo', color: 'text-emerald-600 bg-emerald-50', icon: CheckCircle2 },
  PENDING: { label: 'In attesa', color: 'text-amber-600 bg-amber-50', icon: Clock },
  EXPIRED: { label: 'Scaduto', color: 'text-slate-500 bg-slate-100', icon: AlertCircle },
  REVOKED: { label: 'Revocato', color: 'text-red-600 bg-red-50', icon: XCircle },
  REJECTED: { label: 'Rifiutato', color: 'text-red-600 bg-red-50', icon: XCircle },
}

/* ═══════════════════════════════════════════
   Modal: Seleziona Banca per collegamento
   ═══════════════════════════════════════════ */
// TODO: tighten type
interface BankInstitution {
  id: string
  name: string
  fullName?: string
  media?: Array<{ source: string }>
}

// TODO: tighten type
interface BankAccount {
  id: string
  account_name?: string
  iban?: string
  yapily_account_id?: string
  balance?: number
  balance_updated_at?: string
  last_synced_at?: string
  institution_id?: string
  currency?: string
  yapily_consents?: { status: string }
}

// TODO: tighten type
interface BankConsent {
  id: string
  status: string
  institution_name: string
  consent_type: string
  created_at: string
  expires_at?: string
}

interface SyncResult {
  synced: number
  imported: number
  skipped?: number
}

interface CallbackStatus {
  status: string
  error: string | null
  institution: string | null
}

function ModalSelezionaBanca({ isOpen, onClose, onSelect }: { isOpen: boolean; onClose: () => void; onSelect: (inst: BankInstitution) => void }) {
  const { fetchInstitutions, loading } = useYapily()
  const [institutions, setInstitutions] = useState<BankInstitution[]>([])
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [debugInfo, setDebugInfo] = useState<unknown>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [sandboxMode, setSandboxMode] = useState(true)

  useEffect(() => {
    if (isOpen && !loaded) {
      setFetchError(null)
      fetchInstitutions('IT', sandboxMode).then(result => {
        // result is { data, _debug } from updated hook
        if (result && typeof result === 'object' && 'data' in result) {
          setInstitutions(result.data || [])
          setDebugInfo(result._debug || null)
        } else if (Array.isArray(result)) {
          setInstitutions(result)
        } else {
          setInstitutions([])
        }
        setLoaded(true)
      }).catch(err => {
        setFetchError(err.message)
        setLoaded(true)
      })
    }
  }, [isOpen, loaded, sandboxMode, fetchInstitutions])

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset when closed
  useEffect(() => {
    if (!isOpen) {
      setSearch('')
      setDebouncedSearch('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const filtered = institutions.filter(i =>
    (i.name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
    (i.fullName || '').toLowerCase().includes(debouncedSearch.toLowerCase())
  )

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Collega una banca</h2>
              <p className="text-xs text-slate-400 mt-0.5">Seleziona la tua banca per collegare i conti via PSD2</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
              <X size={18} className="text-slate-400" />
            </button>
          </div>
          {/* Sandbox / Produzione toggle */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-slate-500">Ambiente:</span>
            <button
              onClick={() => { setSandboxMode(true); if (!sandboxMode) setLoaded(false) }}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition ${
                sandboxMode
                  ? 'bg-amber-100 text-amber-700 border border-amber-300'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200'
              }`}
            >
              Sandbox
            </button>
            <button
              onClick={() => { setSandboxMode(false); if (sandboxMode) setLoaded(false) }}
              className={`px-2.5 py-1 text-xs font-medium rounded-full transition ${
                !sandboxMode
                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200'
              }`}
            >
              Produzione
            </button>
          </div>

          {sandboxMode && (
            <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
              <AlertCircle size={14} className="text-amber-500 shrink-0" />
              <span className="text-xs text-amber-700">Ambiente di test — Le banche sandbox usano dati fittizi</span>
            </div>
          )}

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              placeholder="Cerca banca..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              autoFocus
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading && !loaded ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-blue-500" />
              <span className="ml-2 text-sm text-slate-500">Caricamento banche...</span>
            </div>
          ) : fetchError ? (
            <div className="text-center py-8 px-4">
              <AlertCircle size={28} className="text-red-400 mx-auto mb-2" />
              <div className="text-sm font-medium text-red-700 mb-1">Errore di connessione</div>
              <div className="text-xs text-red-500">{fetchError}</div>
            </div>
          ) : loaded && institutions.length === 0 && !search ? (
            <div className="text-center py-6 px-4">
              <AlertCircle size={28} className="text-amber-400 mx-auto mb-3" />
              <div className="text-sm font-medium text-slate-700 mb-2">Applicazione Yapily da configurare</div>
              <div className="text-xs text-slate-500 leading-relaxed mb-4">
                L'API Yapily risponde correttamente ma non restituisce banche.
                Questo significa che l'applicazione deve essere attivata sulla console Yapily.
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-left">
                <div className="text-xs font-semibold text-amber-800 mb-2">Cosa fare:</div>
                <ol className="text-xs text-amber-700 space-y-1.5 list-decimal list-inside">
                  <li>Accedi a <span className="font-mono bg-amber-100 px-1 rounded">console.yapily.com</span></li>
                  <li>Vai su Applications e seleziona l'app "Gestionale NZ"</li>
                  <li>Verifica che lo status sia <strong>Active</strong> (non Sandbox/Draft)</li>
                  <li>Controlla che le Institution siano abilitate per il paese IT</li>
                  <li>Torna qui e riprova</li>
                </ol>
              </div>
              <button
                onClick={() => { setLoaded(false); setDebugInfo(null) }}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition"
              >
                <RefreshCw size={12} />
                Riprova
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-400">
              Nessuna banca trovata per "{search}"
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => onSelect(inst)}
                  className="flex items-center gap-3 w-full px-3 py-3 rounded-xl hover:bg-blue-50/70 transition text-left group"
                >
                  {/* Logo */}
                  <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 overflow-hidden">
                    {inst.media?.[0]?.source ? (
                      <img
                        src={inst.media[0].source}
                        alt={inst.name}
                        className="w-8 h-8 object-contain"
                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
                      />
                    ) : null}
                    <div className={`items-center justify-center ${inst.media?.[0]?.source ? 'hidden' : 'flex'}`}>
                      <Landmark size={18} className="text-slate-400" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">{inst.name}</div>
                    {inst.fullName && inst.fullName !== inst.name && (
                      <div className="text-xs text-slate-400 truncate">{inst.fullName}</div>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 shrink-0 transition" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
          <Shield size={12} />
          <span>Connessione sicura PSD2 — i tuoi dati restano protetti</span>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   Card: Conto Collegato
   ═══════════════════════════════════════════ */
function AccountCard({ account, onSync, syncing, onClick }: { account: BankAccount; onSync: (id: string) => void; syncing: boolean; onClick?: (account: BankAccount) => void }) {
  const consentStatus = account.yapily_consents?.status || 'AUTHORIZED'
  const cfg = statusConfig[consentStatus] || statusConfig.AUTHORIZED
  const StatusIcon = cfg.icon

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition group cursor-pointer" onClick={() => onClick?.(account)}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Landmark size={18} className="text-blue-500" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {account.account_name || 'Conto'}
            </div>
            <div className="text-xs text-slate-400 font-mono mt-0.5">
              {account.iban || account.yapily_account_id?.slice(0, 12)}
            </div>
          </div>
        </div>
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>
          <StatusIcon size={10} />
          {cfg.label}
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-xs text-slate-400">Saldo</div>
          <div className={`text-xl font-bold ${account.balance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
            {account.balance != null ? `${fmt(account.balance)} €` : '—'}
          </div>
          {account.balance_updated_at && (
            <div className="text-[10px] text-slate-300 mt-0.5">
              Aggiornato {timeAgo(account.balance_updated_at)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onSync(account.id) }}
            disabled={syncing}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-blue-600 transition disabled:opacity-50"
            title="Sincronizza movimenti"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Dettagli extra */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-1">
          <Building2 size={11} />
          <span>{account.institution_id}</span>
        </div>
        <div className="flex items-center gap-1">
          <CreditCard size={11} />
          <span>{account.currency || 'EUR'}</span>
        </div>
        {account.last_synced_at && (
          <div className="flex items-center gap-1">
            <Clock size={11} />
            <span>Sync {timeAgo(account.last_synced_at)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   Main Component: Open Banking Tab
   ═══════════════════════════════════════════ */
export default function OpenBanking() {
  const yapily = useYapily()
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [consents, setConsents] = useState<BankConsent[]>([])
  const [showBankModal, setShowBankModal] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [syncingAccount, setSyncingAccount] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [callbackStatus, setCallbackStatus] = useState<CallbackStatus | null>(null)
  const [showConsents, setShowConsents] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null)

  // Load data
  const loadData = useCallback(async () => {
    const [accs, cons] = await Promise.all([
      yapily.fetchAccounts(),
      yapily.fetchConsents(),
    ])
    setAccounts(accs)
    setConsents(cons)
  }, [yapily.fetchAccounts, yapily.fetchConsents])

  useEffect(() => {
    loadData()

    // Check URL for callback status
    const params = new URLSearchParams(window.location.search)
    const status = params.get('status')
    if (status) {
      setCallbackStatus({
        status,
        error: params.get('error'),
        institution: params.get('institution'),
      })
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  // Handle bank selection → create consent → redirect
  const handleSelectBank = async (institution) => {
    setShowBankModal(false)
    setConnecting(true)
    try {
      const result = await yapily.createConsent(institution.id, institution.name, 'AIS')
      if (result?.authorisationUrl) {
        // Redirect to bank for authorization
        window.location.href = result.authorisationUrl
      } else {
        console.error('Consent creato ma authorisationUrl mancante:', result)
        alert('Errore: la banca non ha restituito un URL di autorizzazione. Riprova.')
      }
    } catch (err) {
      console.error('Consent creation failed:', err)
      alert('Errore collegamento banca: ' + (err.message || 'Riprova più tardi'))
    } finally {
      setConnecting(false)
    }
  }

  // Full sync: Yapily API → yapily_transactions → cash_movements
  const handleSync = async (accountId) => {
    setSyncingAccount(accountId)
    setSyncResult(null)
    try {
      const result = await yapily.fullSync(accountId)
      if (result) setSyncResult(result)
      await loadData()
    } catch (err) {
      console.error('Sync failed:', err)
    } finally {
      setSyncingAccount(null)
    }
  }

  // Sync all accounts
  const handleSyncAll = async () => {
    setSyncingAccount('all')
    setSyncResult(null)
    let totalImported = 0, totalSynced = 0
    try {
      for (const acc of accounts) {
        const result = await yapily.fullSync(acc.id)
        if (result) {
          totalSynced += result.synced || 0
          totalImported += result.imported || 0
        }
      }
      setSyncResult({ synced: totalSynced, imported: totalImported })
      await loadData()
    } catch (err) {
      console.error('Sync all failed:', err)
    } finally {
      setSyncingAccount(null)
    }
  }

  const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0)
  const activeConsents = consents.filter(c => c.status === 'AUTHORIZED')

  return (
    <div className="space-y-6">

      {/* Callback notification */}
      {callbackStatus && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${
          callbackStatus.status === 'success'
            ? 'bg-emerald-50 border border-emerald-200'
            : 'bg-red-50 border border-red-200'
        }`}>
          {callbackStatus.status === 'success' ? (
            <>
              <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />
              <div>
                <div className="text-sm font-medium text-emerald-800">Banca collegata con successo!</div>
                <div className="text-xs text-emerald-600 mt-0.5">
                  {callbackStatus.institution && `${callbackStatus.institution} — `}
                  I conti sono stati sincronizzati automaticamente.
                </div>
              </div>
            </>
          ) : (
            <>
              <XCircle size={20} className="text-red-500 shrink-0" />
              <div>
                <div className="text-sm font-medium text-red-800">Collegamento non riuscito</div>
                <div className="text-xs text-red-600 mt-0.5">
                  {callbackStatus.error || 'L\'autorizzazione bancaria non e stata completata.'}
                </div>
              </div>
            </>
          )}
          <button
            onClick={() => setCallbackStatus(null)}
            className="ml-auto p-1 hover:bg-white/50 rounded-lg transition"
          >
            <X size={14} className={callbackStatus.status === 'success' ? 'text-emerald-400' : 'text-red-400'} />
          </button>
        </div>
      )}

      {/* Sync result notification */}
      {syncResult && (
        <div className="rounded-xl p-4 flex items-center gap-3 bg-blue-50 border border-blue-200">
          <CheckCircle2 size={20} className="text-blue-500 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium text-blue-800">Sincronizzazione completata</div>
            <div className="text-xs text-blue-600 mt-0.5">
              {syncResult.synced || 0} transazioni sincronizzate · {syncResult.imported || 0} nuovi movimenti importati
            </div>
          </div>
          <button
            onClick={() => setSyncResult(null)}
            className="p-1 hover:bg-blue-100 rounded-lg transition"
          >
            <X size={14} className="text-blue-400" />
          </button>
        </div>
      )}

      {/* Header + actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Conti collegati via Open Banking</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {accounts.length > 0
              ? `${accounts.length} cont${accounts.length === 1 ? 'o' : 'i'} · ${activeConsents.length} consent attiv${activeConsents.length === 1 ? 'o' : 'i'}`
              : 'Collega la tua banca per sincronizzare conti e movimenti automaticamente'
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.length > 0 && (
            <button
              onClick={handleSyncAll}
              disabled={syncingAccount !== null}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
            >
              <RefreshCw size={13} className={syncingAccount === 'all' ? 'animate-spin' : ''} />
              Sincronizza tutti
            </button>
          )}
          <button
            onClick={() => setShowBankModal(true)}
            disabled={connecting}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {connecting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Plus size={13} />
            )}
            Collega banca
          </button>
        </div>
      </div>

      {/* Empty state */}
      {accounts.length === 0 && !yapily.loading && (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <Globe size={28} className="text-blue-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1">Nessuna banca collegata</h3>
          <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
            Collega i tuoi conti bancari via PSD2 per avere saldi aggiornati e movimenti sincronizzati automaticamente.
          </p>
          <button
            onClick={() => setShowBankModal(true)}
            disabled={connecting}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition"
          >
            <Landmark size={16} />
            Collega la tua prima banca
          </button>
          <div className="flex items-center justify-center gap-4 mt-6 text-xs text-slate-300">
            <div className="flex items-center gap-1"><Shield size={12} /> Connessione sicura PSD2</div>
            <div className="flex items-center gap-1"><Clock size={12} /> Sync automatica</div>
            <div className="flex items-center gap-1"><Link2 size={12} /> 322+ banche italiane</div>
          </div>
        </div>
      )}

      {/* Account cards grid */}
      {accounts.length > 0 && (
        <>
          {/* Summary bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xs text-slate-400">Saldo totale Open Banking</div>
                <div className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                  {fmt(totalBalance)} €
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-500" />
                {activeConsents.length} consent attivi
              </div>
              <div className="flex items-center gap-1">
                <CreditCard size={12} className="text-blue-500" />
                {accounts.length} conti
              </div>
            </div>
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {accounts.map(acc => (
              <AccountCard
                key={acc.id}
                account={acc}
                onSync={handleSync}
                syncing={syncingAccount === acc.id || syncingAccount === 'all'}
                onClick={(account) => setSelectedAccount(account)}
              />
            ))}
          </div>
        </>
      )}

      {/* Consents section — collapsible */}
      {consents.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <button
            onClick={() => setShowConsents(!showConsents)}
            className="flex items-center justify-between w-full px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-slate-400" />
              <span className="text-sm font-medium text-slate-700">Consensi bancari</span>
              <span className="text-xs text-slate-400">({consents.length})</span>
            </div>
            {showConsents ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
          </button>
          {showConsents && (
            <div className="px-4 pb-4">
              <div className="divide-y divide-slate-100">
                {consents.map(consent => {
                  const cfg = statusConfig[consent.status] || statusConfig.PENDING
                  const StatusIcon = cfg.icon
                  return (
                    <div key={consent.id} className="flex items-center justify-between py-2.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                          <Landmark size={14} className="text-slate-400" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-700">{consent.institution_name}</div>
                          <div className="text-xs text-slate-400">
                            {consent.consent_type} · Creato {new Date(consent.created_at).toLocaleDateString('it-IT')}
                            {consent.expires_at && ` · Scade ${new Date(consent.expires_at).toLocaleDateString('it-IT')}`}
                          </div>
                        </div>
                      </div>
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>
                        <StatusIcon size={10} />
                        {cfg.label}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {yapily.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-red-500 shrink-0" />
          <div className="flex-1 text-sm text-red-700">{yapily.error}</div>
          <button onClick={() => yapily.setError(null)} className="p-1 hover:bg-red-100 rounded-lg transition">
            <X size={14} className="text-red-400" />
          </button>
        </div>
      )}

      {/* Bank selection modal */}
      <ModalSelezionaBanca
        isOpen={showBankModal}
        onClose={() => setShowBankModal(false)}
        onSelect={handleSelectBank}
      />

      {/* Account detail drawer */}
      <AccountDetail
        isOpen={!!selectedAccount}
        onClose={() => setSelectedAccount(null)}
        account={selectedAccount}
        onSync={async (accountId) => {
          await handleSync(accountId)
          // Refresh account data after sync
          const accs = await yapily.fetchAccounts()
          setAccounts(accs)
          const updated = accs.find(a => a.id === accountId)
          if (updated) setSelectedAccount(updated)
        }}
      />
    </div>
  )
}
