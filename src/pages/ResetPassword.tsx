// Pagina /reset-password — atterraggio del link "password dimenticata".
//
// Flusso: l'utente clicca il link nella mail di reset → Supabase riporta qui con
// un token di recupero nell'URL. Il client Supabase (detectSessionInUrl) crea una
// sessione temporanea di recupero ed emette l'evento PASSWORD_RECOVERY. Qui
// l'utente imposta la nuova password (updateUser), poi lo rimandiamo al login.
//
// NB: questa route NON è sotto PublicRoute (che rimbalzerebbe via la sessione di
// recupero): è pubblica e gestisce da sé i vari stati.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentTenant } from '../lib/tenants'
import { Eye, EyeOff, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react'

export default function ResetPassword() {
  const navigate = useNavigate()
  const tenant = getCurrentTenant()
  const [ready, setReady] = useState(false)       // sessione di recupero pronta?
  const [linkValid, setLinkValid] = useState(true) // link valido/non scaduto?
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let settled = false
    // Se il token di recupero è nell'URL, Supabase emette PASSWORD_RECOVERY.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        settled = true
        setReady(true)
      }
    })
    // Fallback: se una sessione (di recupero) esiste già, procedi.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { settled = true; setReady(true) }
    })
    // Dopo un attimo, se non è arrivata nessuna sessione, il link è scaduto/non valido.
    const t = setTimeout(() => { if (!settled) setLinkValid(false) }, 4000)
    return () => { subscription.unsubscribe(); clearTimeout(t) }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError('La password deve essere di almeno 8 caratteri.'); return }
    if (password !== confirm) { setError('Le due password non coincidono.'); return }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { setError(error.message); return }
    setDone(true)
    // Chiudi la sessione di recupero e torna al login dopo un attimo.
    await supabase.auth.signOut()
    setTimeout(() => navigate('/login', { replace: true }), 2500)
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      <div
        className="h-7 shrink-0 flex items-center justify-center px-4 text-white text-xs font-semibold gap-2"
        style={{ background: tenant.accentBg }}
      >
        <span className="opacity-90">Tenant:</span>
        <span className="font-bold tracking-wide">{tenant.displayName}</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: tenant.accentBg }}>
              <KeyRound size={28} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Reimposta la password</h1>
          </div>

          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {done ? (
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-50">
                  <CheckCircle2 size={24} className="text-emerald-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-900">Password aggiornata</h2>
                <p className="text-sm text-slate-500">Ti riportiamo al login…</p>
              </div>
            ) : !linkValid ? (
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50">
                  <AlertCircle size={24} className="text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Link non valido o scaduto</h2>
                  <p className="text-sm text-slate-500 mt-1">Richiedi un nuovo link dalla schermata di login.</p>
                </div>
                <button onClick={() => navigate('/login', { replace: true })} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                  ← Torna al login
                </button>
              </div>
            ) : !ready ? (
              <div className="text-center py-6">
                <div className="w-8 h-8 mx-auto border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-sm text-slate-500 mt-3">Verifica del link in corso…</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                    <AlertCircle size={16} /><span>{error}</span>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Nuova password</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Almeno 8 caratteri"
                      required
                      className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-sm pr-10"
                    />
                    <button type="button" onClick={() => setShowPw(!showPw)} title={showPw ? 'Nascondi password' : 'Mostra password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Conferma password</label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Ripeti la password"
                    required
                    className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition text-sm"
                  />
                </div>
                <button type="submit" disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition disabled:opacity-50 disabled:cursor-not-allowed">
                  {saving ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><KeyRound size={18} /> Imposta nuova password</>}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
