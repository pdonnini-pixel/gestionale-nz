import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  eErroreDiVersione,
  TITOLO_NUOVA_VERSIONE,
  TESTO_NUOVA_VERSIONE,
} from '../lib/nuovaVersione'

interface Props {
  children: ReactNode
  /** Cambiando questo valore (il percorso) l'errore si azzera e si riprova. */
  resetKey?: string
}

interface State {
  errore: unknown
}

/**
 * Il paracadute delle pagine caricate al volo.
 *
 * Senza di lui un errore dentro una pagina non veniva preso da nessuno e React
 * smontava tutto: schermo bianco, nessun messaggio, nessuna via d'uscita. Il
 * caso piu' frequente non e' nemmeno un difetto del codice: e' la versione
 * pubblicata mentre la persona lavora, che fa sparire dal server il file della
 * schermata appena richiesta. Li' la soluzione e' una sola, ricaricare, e va
 * detta invece che lasciata indovinare.
 *
 * Cambiando pagina l'errore si azzera: se riguardava una schermata sola, il
 * resto del gestionale continua a funzionare.
 */
export default class ConfinePagina extends Component<Props, State> {
  state: State = { errore: null }

  static getDerivedStateFromError(errore: unknown): State {
    return { errore }
  }

  componentDidCatch(errore: unknown, info: ErrorInfo) {
    console.error('[ConfinePagina]', errore, info?.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.errore && prev.resetKey !== this.props.resetKey) {
      this.setState({ errore: null })
    }
  }

  render() {
    const { errore } = this.state
    if (!errore) return this.props.children

    const versione = eErroreDiVersione(errore)

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <RefreshCw className="h-6 w-6 text-amber-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">
            {versione ? TITOLO_NUOVA_VERSIONE : 'Questa schermata non si e’ aperta'}
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            {versione
              ? TESTO_NUOVA_VERSIONE
              : 'Prova a ricaricare. Se succede di nuovo, aprine un ticket dal punto interrogativo in alto: il messaggio tecnico e’ gia’ nel registro del browser.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Ricarica la pagina
          </button>
        </div>
      </div>
    )
  }
}
