import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import {
  eErroreDiVersione,
  TITOLO_NUOVA_VERSIONE,
  TESTO_NUOVA_VERSIONE,
} from '../lib/nuovaVersione'

/**
 * La striscia che compare a chi ha il gestionale aperto mentre ne viene
 * pubblicata una versione nuova.
 *
 * Non parte da sola e non chiede niente al server: aspetta il primo segnale
 * vero, cioe' un pezzo di codice che il browser non riesce piu' a scaricare.
 * Vite avvisa con l'evento `vite:preloadError`; se il caricamento parte lo
 * stesso e fallisce dopo, l'errore arriva come `error` o come promessa
 * rifiutata. Tutte e tre le strade portano qui.
 *
 * Restare sulla schermata in cui si e' non fa perdere niente, quindi la
 * striscia si puo' chiudere: chi sta finendo di scrivere qualcosa lo finisce,
 * e ricarica quando ha salvato.
 */
export default function AvvisoNuovaVersione() {
  const [visibile, setVisibile] = useState(false)
  const [chiuso, setChiuso] = useState(false)

  useEffect(() => {
    const segnala = (errore: unknown) => {
      if (eErroreDiVersione(errore)) setVisibile(true)
    }

    const suPreload = (e: Event) => {
      // Vite passa l'errore vero in `payload`; senza di quello vale l'evento.
      const payload = (e as Event & { payload?: unknown }).payload
      setVisibile(true)
      void payload
    }
    const suErrore = (e: ErrorEvent) => segnala(e.error ?? e.message)
    const suRifiuto = (e: PromiseRejectionEvent) => segnala(e.reason)

    window.addEventListener('vite:preloadError', suPreload)
    window.addEventListener('error', suErrore)
    window.addEventListener('unhandledrejection', suRifiuto)
    return () => {
      window.removeEventListener('vite:preloadError', suPreload)
      window.removeEventListener('error', suErrore)
      window.removeEventListener('unhandledrejection', suRifiuto)
    }
  }, [])

  if (!visibile || chiuso) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 pointer-events-none"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="pointer-events-auto mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg">
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">{TITOLO_NUOVA_VERSIONE}</p>
          <p className="mt-0.5 text-sm text-amber-800">{TESTO_NUOVA_VERSIONE}</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
        >
          Ricarica
        </button>
        <button
          type="button"
          onClick={() => setChiuso(true)}
          aria-label="Chiudi l&rsquo;avviso"
          className="shrink-0 rounded-lg p-2 text-amber-700 hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
