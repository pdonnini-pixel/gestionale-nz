import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getCurrentTenant } from '../lib/tenants'
import { LogIn, Eye, EyeOff, AlertCircle, Mail } from 'lucide-react'

function tenantInitials(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export default function Login() {
  const { signIn, resetPassword } = useAuth()
  const tenant = getCurrentTenant()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Modalità "password dimenticata": mostra solo il campo email + invia il reset.
  const [mode, setMode] = useState<'login' | 'recover'>('login')
  const [recoverSent, setRecoverSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) setError((error as { message: string }).message)
    setLoading(false)
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await resetPassword(email)
    setLoading(false)
    // Non riveliamo se l'email esiste o meno (buona pratica di sicurezza):
    // mostriamo comunque la conferma "controlla la tua email".
    if (error) setError((error as { message: string }).message)
    else setRecoverSent(true)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Banda tenant — coerente con Layout, evita confusione su quale tenant si sta loggando */}
      <div
        className="h-7 shrink-0 flex items-center justify-center px-4 text-white text-xs font-semibold gap-2"
        style={{ background: tenant.accentBg }}
        title={`Login per il tenant ${tenant.displayName}.`}
      >
        <span className="opacity-90">Tenant:</span>
        <span className="font-bold tracking-wide">{tenant.displayName}</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Logo area */}
        <div className="text-center mb-8">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl backdrop-blur-sm mb-4"
            style={{ background: tenant.accentBg }}
          >
            <span className="text-2xl font-bold text-white">{tenantInitials(tenant.displayName)}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Gestionale {tenant.displayName}</h1>
          <p className="text-blue-200 mt-1">Accedi al tuo pannello di controllo</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm mb-4">
              <AlertCircle size={16} />
              <span>{error === 'Invalid login credentials' ? 'Email o password non validi' : error}</span>
            </div>
          )}

          {mode === 'recover' ? (
            recoverSent ? (
              // Conferma invio email di recupero
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50">
                  <Mail size={22} className="text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Controlla la tua email</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    Se <b>{email}</b> è un indirizzo registrato, ti abbiamo inviato un link per
                    reimpostare la password. Apri la mail e segui il link.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setRecoverSent(false); setError(null) }}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  ← Torna al login
                </button>
              </div>
            ) : (
              // Form: inserisci email per ricevere il link di reset
              <form onSubmit={handleRecover} className="space-y-5">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 mb-1">Password dimenticata</h2>
                  <p className="text-sm text-slate-500">Inserisci la tua email: ti invieremo un link per reimpostare la password.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="nome@azienda.it"
                    required
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Mail size={18} /> Invia link di reset</>}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(null) }}
                  className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
                >
                  ← Torna al login
                </button>
              </form>
            )
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="nome@azienda.it"
                  required
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="La tua password"
                    required
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    title={showPw ? 'Nascondi password' : 'Mostra password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <div className="text-right mt-1.5">
                  <button
                    type="button"
                    onClick={() => { setMode('recover'); setError(null) }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Password dimenticata?
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <LogIn size={18} />
                    Accedi
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-blue-300/60 text-xs mt-6">
          {tenant.displayName} · Gestionale v1.0
        </p>
      </div>
      </div>
    </div>
  )
}
