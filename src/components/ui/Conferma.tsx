// Conferme e domande dentro il gestionale, al posto di window.confirm / window.prompt / window.alert
// (Patrizio, 26/11/2026: «questo pop-up non deve essere di sistema, ma deve essere centrale e in
// linea con il messaggio»). Una sola finestra per tutta l'app, montata da <ConfermaProvider> in
// App.tsx (come i toast): ogni pagina la chiama con una riga. Usa il Modal condiviso: centrata,
// Esc, X e clic fuori annullano, focus dentro la finestra.
//
//   const { conferma, chiedi, avvisa } = useConferma();
//   if (!(await conferma({ titolo: 'Togliere il piano?', testo: '…', ok: 'Togli', pericolo: true }))) return;
//   const motivo = await chiedi({ titolo: 'Annulla la timbratura', testo: 'Perché?', obbligatorio: true }); // null = annullato
//   await avvisa({ titolo: 'Impossibile unire', testo: '…' });
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'

export interface OpzioniConferma {
  titolo: string
  testo: ReactNode
  /** testo del pulsante che conferma (default «Conferma») */
  ok?: string
  /** testo del pulsante che annulla (default «Annulla») */
  annulla?: string
  /** azione che toglie o cancella: pulsante rosso */
  pericolo?: boolean
}

export interface OpzioniDomanda extends OpzioniConferma {
  /** etichetta del campo di testo */
  etichetta?: string
  placeholder?: string
  /** senza testo il pulsante resta spento */
  obbligatorio?: boolean
  valoreIniziale?: string
}

type Richiesta =
  | { tipo: 'conferma'; o: OpzioniConferma; risolvi: (v: boolean) => void }
  | { tipo: 'domanda'; o: OpzioniDomanda; risolvi: (v: string | null) => void }
  | { tipo: 'avviso'; o: OpzioniConferma; risolvi: () => void }

interface ApiConferma {
  conferma: (o: OpzioniConferma) => Promise<boolean>
  chiedi: (o: OpzioniDomanda) => Promise<string | null>
  avvisa: (o: Omit<OpzioniConferma, 'annulla' | 'pericolo'>) => Promise<void>
}

const Contesto = createContext<ApiConferma | null>(null)

const testoSemplice = (t: ReactNode) => (typeof t === 'string' ? t : '')

export function ConfermaProvider({ children }: { children: ReactNode }) {
  const [r, setR] = useState<Richiesta | null>(null)
  const [testo, setTesto] = useState('')
  const corrente = useRef<Richiesta | null>(null)

  // una richiesta ancora aperta vale come annullata
  const chiudiAperta = () => {
    const a = corrente.current
    if (!a) return
    if (a.tipo === 'conferma') a.risolvi(false)
    else if (a.tipo === 'domanda') a.risolvi(null)
    else a.risolvi()
  }
  const apri = (n: Richiesta) => { chiudiAperta(); corrente.current = n; setR(n) }

  const api = useRef<ApiConferma>({
    conferma: (o) => new Promise<boolean>((risolvi) => apri({ tipo: 'conferma', o, risolvi })),
    chiedi: (o) => new Promise<string | null>((risolvi) => { setTesto(o.valoreIniziale ?? ''); apri({ tipo: 'domanda', o, risolvi }) }),
    avvisa: (o) => new Promise<void>((risolvi) => apri({ tipo: 'avviso', o, risolvi })),
  }).current

  const fine = useCallback((ok: boolean) => {
    const a = corrente.current
    corrente.current = null
    setR(null)
    if (!a) return
    if (a.tipo === 'conferma') a.risolvi(ok)
    else if (a.tipo === 'domanda') a.risolvi(ok ? testo.trim() : null)
    else a.risolvi()
  }, [testo])

  const o = r?.o
  const spento = r?.tipo === 'domanda' && !!r.o.obbligatorio && !testo.trim()
  return (
    <Contesto.Provider value={api}>
      {children}
      <Modal open={!!r} onClose={() => fine(false)} title={o?.titolo ?? ''} zClass="z-[200]">
        <div className="text-sm text-slate-700 whitespace-pre-line">{o?.testo}</div>
        {r?.tipo === 'domanda' && (
          <label className="block mt-3 text-xs text-slate-600">{r.o.etichetta ?? ''}
            <textarea autoFocus rows={3} maxLength={500} value={testo} placeholder={r.o.placeholder}
              onChange={(e) => setTesto(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900" />
          </label>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {r?.tipo !== 'avviso' && (
            <button type="button" onClick={() => fine(false)}
              className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">{o?.annulla ?? 'Annulla'}</button>
          )}
          <button type="button" disabled={spento} onClick={() => fine(true)}
            className={`min-h-[40px] px-3.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50 ${o?.pericolo ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{o?.ok ?? (r?.tipo === 'avviso' ? 'Ho capito' : 'Conferma')}</button>
        </div>
      </Modal>
    </Contesto.Provider>
  )
}

/**
 * Le conferme del gestionale. Fuori dal provider (test isolati) ripiega sulle finestre del
 * browser, così niente si rompe. `dialogo` resta per compatibilità: la finestra la monta il provider.
 */
export function useConferma(): ApiConferma & { dialogo: ReactNode } {
  const ctx = useContext(Contesto)
  if (ctx) return { ...ctx, dialogo: null }
  return {
    conferma: async (o) => window.confirm(`${o.titolo}\n\n${testoSemplice(o.testo)}`),
    chiedi: async (o) => { const v = window.prompt(`${o.titolo}\n\n${testoSemplice(o.testo)}`, o.valoreIniziale ?? ''); return v == null || (o.obbligatorio && !v.trim()) ? null : v.trim() },
    avvisa: async (o) => { window.alert(`${o.titolo}\n\n${testoSemplice(o.testo)}`) },
    dialogo: null,
  }
}
