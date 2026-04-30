import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { UserCircle, Lock, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'

/**
 * Pagina Profilo Utente — distinta da Impostazioni (profilo società).
 * Permette all'utente loggato di:
 *  - aggiornare i propri dati anagrafici (nome, cognome)
 *  - cambiare la password (richiede conferma)
 *
 * L'email NON è modificabile da qui: il cambio email su Supabase richiede
 * un flusso di verifica via mail di conferma e link cliccabile, troppo
 * complesso per Sabrina/Veronica al day 1. Se serve, lo apriamo via supporto.
 */
export default function Profilo() {
  const { session, profile, refreshProfile } = useAuth()

  // ─── Toast inline ────────────────────────────────────────────
  const [toast, setToast] = useState(null) // { type: 'success'|'error', msg: string }
  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4500)
  }

  // ─── Form dati personali ─────────────────────────────────────
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [savingPersonal, setSavingPersonal] = useState(false)

  useEffect(() => {
    setFirstName(profile?.first_name || '')
    setLastName(profile?.last_name || '')
  }, [profile?.first_name, profile?.last_name])

  const personalDirty =
    firstName !== (profile?.first_name || '') ||
    lastName !== (profile?.last_name || '')

  async function handleSavePersonal(e) {
    e.preventDefault()
    if (!profile?.id) return
    if (!firstName.trim() || !lastName.trim()) {
      showToast('error', 'Nome e cognome sono obbligatori')
      return
    }
    setSavingPersonal(true)
    const { error } = await supabase
      .from('user_profiles')
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })
      .eq('id', profile.id)

    setSavingPersonal(false)
    if (error) {
      showToast('error', `Errore nel salvataggio: ${error.message}`)
      return
    }
    await refreshProfile?.()
    showToast('success', 'Dati personali aggiornati')
  }

  // ─── Form cambio password ────────────────────────────────────
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  async function handleChangePassword(e) {
    e.preventDefault()
    if (newPassword.length < 8) {
      showToast('error', 'La password deve essere di almeno 8 caratteri')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('error', 'Le due password non coincidono')
      return
    }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      showToast('error', `Errore: ${error.message}`)
      return
    }
    setNewPassword('')
    setConfirmPassword('')
    showToast('success', 'Password aggiornata. Al prossimo accesso usa la nuova password.')
  }

  // ─── UI ──────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[70] px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={16} className="text-emerald-600" />
          ) : (
            <AlertCircle size={16} className="text-red-600" />
          )}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Il tuo profilo</h1>
        <p className="text-sm text-slate-500">
          Gestisci i tuoi dati personali e la tua password. Per modificare i dati
          dell'azienda vai su{' '}
          <a href="/impostazioni" className="text-blue-600 hover:underline">
            Impostazioni
          </a>
          .
        </p>
      </div>

      {/* ─── DATI PERSONALI ─── */}
      <form
        onSubmit={handleSavePersonal}
        className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <UserCircle size={20} className="text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-900">Dati personali</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Cognome <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={session?.user?.email || ''}
              readOnly
              disabled
              className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm text-slate-500 cursor-not-allowed"
            />
            <p className="text-xs text-slate-400 mt-1">
              L'email non è modificabile da qui. Per cambiarla contatta il supporto.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={!personalDirty || savingPersonal}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
          >
            {savingPersonal ? 'Salvataggio...' : 'Salva modifiche'}
          </button>
        </div>
      </form>

      {/* ─── CAMBIO PASSWORD ─── */}
      <form
        onSubmit={handleChangePassword}
        className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <Lock size={20} className="text-blue-600" />
          <h2 className="text-lg font-semibold text-slate-900">Cambia password</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nuova password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Almeno 8 caratteri"
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowNew((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Conferma nuova password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ripeti la password"
                autoComplete="new-password"
                className="w-full px-3 py-2 pr-10 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle size={12} />
              Le due password non coincidono
            </p>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={
              savingPassword ||
              !newPassword ||
              !confirmPassword ||
              newPassword !== confirmPassword
            }
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition"
          >
            {savingPassword ? 'Salvataggio...' : 'Aggiorna password'}
          </button>
        </div>
      </form>
    </div>
  )
}
