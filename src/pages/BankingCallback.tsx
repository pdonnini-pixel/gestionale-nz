import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useYapily } from '../hooks/useYapily'
import { CheckCircle2, XCircle, Loader2, Building2 } from 'lucide-react'

/**
 * Pagina callback per il flusso di autorizzazione Yapily.
 * Yapily reindirizza qui dopo che l'utente autorizza l'accesso alla banca.
 *
 * URL tipico: /banking/callback?consent=xxx&application-user-id=yyy&institution=zzz
 * oppure con errore: /banking/callback?error=access_denied&error-source=...
 */
export default function BankingCallback() {
  const [status, setStatus] = useState<'processing' | 'syncing' | 'success' | 'error'>('processing')
  const [message, setMessage] = useState('Collegamento banca in corso...')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const yapily = useYapily()
  const processedRef = useRef(false)

  useEffect(() => {
    // Evita doppia esecuzione in StrictMode
    if (processedRef.current) return
    processedRef.current = true
    handleCallback()
  }, [])

  const handleCallback = async () => {
    try {
      // Leggi parametri dal callback URL di Yapily
      const consentToken = searchParams.get('consent') || searchParams.get('consent-token')
      const applicationUserId = searchParams.get('application-user-id')
      const institution = searchParams.get('institution')
      const errorParam = searchParams.get('error')
      const errorSource = searchParams.get('error-source')

      // Se Yapily ha restituito un errore (es. utente ha annullato)
      if (errorParam) {
        // Aggiorna il consent a REJECTED se possibile
        if (consentToken) {
          await supabase
            .from('yapily_consents')
            .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
            .eq('consent_token', consentToken)
        }
        setStatus('error')
        setError(errorParam === 'access_denied'
          ? 'Hai annullato l\'autorizzazione bancaria.'
          : `Errore dalla banca: ${errorParam}${errorSource ? ` (${errorSource})` : ''}`)
        setMessage('Autorizzazione non riuscita')
        return
      }

      if (!consentToken) {
        setStatus('error')
        setError('Token di consenso mancante nella risposta della banca. Riprova il collegamento.')
        setMessage('Parametri mancanti')
        return
      }

      // Step 1: Aggiorna il consent a AUTHORIZED nel database
      setMessage('Salvataggio autorizzazione...')
      const { data: consent, error: updateErr } = await supabase
        .from('yapily_consents')
        .update({
          status: 'AUTHORIZED',
          updated_at: new Date().toISOString(),
        })
        .eq('consent_token', consentToken)
        .select()
        .single()

      if (updateErr) {
        console.error('[BankingCallback] Errore aggiornamento consent:', updateErr)
        // Non blocchiamo — il consent potrebbe essere già stato aggiornato dall'Edge Function
      }

      // Step 2: Sincronizza i conti bancari dalla banca appena collegata
      setStatus('syncing')
      setMessage('Importazione conti bancari...')

      if (consent?.id) {
        try {
          const accounts = await yapily.syncAccounts(consent.id)
          if (accounts && accounts.length > 0) {
            setMessage(`${accounts.length} conto/i importati! Caricamento saldi...`)
            // Step 3: Aggiorna saldi per ogni conto
            await yapily.refreshBalances()
          }
        } catch (syncErr) {
          console.warn('[BankingCallback] Sync conti non riuscita (non bloccante):', syncErr)
          // Non blocchiamo — l'utente può fare sync manuale dalla Tesoreria
        }
      }

      // Successo!
      setStatus('success')
      setMessage('Banca collegata con successo!')

      // Redirect a Tesoreria dopo 3 secondi
      setTimeout(() => {
        navigate('/banche', { replace: true })
      }, 3000)

    } catch (err) {
      console.error('[BankingCallback] Error:', err)
      setStatus('error')
      setError(err.message || 'Errore sconosciuto durante il collegamento')
      setMessage('Errore durante il collegamento')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 max-w-md w-full text-center space-y-6">
        {/* Icona stato */}
        <div className="flex justify-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
            status === 'success' ? 'bg-green-100' :
            status === 'error' ? 'bg-red-100' :
            'bg-blue-100'
          }`}>
            {(status === 'processing' || status === 'syncing') && <Loader2 size={32} className="text-blue-600 animate-spin" />}
            {status === 'success' && <CheckCircle2 size={32} className="text-green-600" />}
            {status === 'error' && <XCircle size={32} className="text-red-600" />}
          </div>
        </div>

        {/* Messaggio */}
        <div>
          <h1 className={`text-xl font-bold ${
            status === 'success' ? 'text-green-800' :
            status === 'error' ? 'text-red-800' :
            'text-slate-900'
          }`}>
            {message}
          </h1>

          {(status === 'processing' || status === 'syncing') && (
            <p className="text-sm text-slate-500 mt-2">
              {status === 'processing'
                ? 'Stiamo verificando l\'autorizzazione con la tua banca...'
                : 'Importazione conti e saldi dalla banca...'}
            </p>
          )}

          {status === 'success' && (
            <p className="text-sm text-slate-500 mt-2">
              I tuoi conti bancari sono ora visibili nella sezione Banche.
              <br />
              <span className="text-xs text-slate-400">Reindirizzamento automatico tra 3 secondi...</span>
            </p>
          )}

          {status === 'error' && error && (
            <p className="text-sm text-red-600 mt-2 bg-red-50 rounded-lg p-3">
              {error}
            </p>
          )}
        </div>

        {/* Azioni */}
        <div className="flex justify-center gap-3">
          {status === 'error' && (
            <>
              <button
                onClick={() => navigate('/banche', { replace: true })}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg hover:bg-slate-50 transition"
              >
                Torna a Banche
              </button>
              <button
                onClick={() => navigate('/banche', { replace: true })}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                Riprova collegamento
              </button>
            </>
          )}
          {status === 'success' && (
            <button
              onClick={() => navigate('/banche', { replace: true })}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition flex items-center gap-2"
            >
              <Building2 size={14} />
              Vai a Banche
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="text-xs text-slate-300 pt-2 border-t border-slate-100">
          Gestionale NZ — Open Banking powered by Yapily
        </div>
      </div>
    </div>
  )
}
