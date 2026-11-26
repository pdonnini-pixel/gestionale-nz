// Conferma dentro il gestionale, al posto di window.confirm (Patrizio, 26/11/2026: «questo
// pop-up non deve essere di sistema, ma deve essere centrale e in linea con il messaggio»).
// Usa il Modal condiviso: centrata, Esc e clic fuori annullano, focus dentro la finestra.
//
//   const { conferma, dialogo } = useConferma();
//   if (!(await conferma({ titolo: 'Togliere il piano?', testo: '…', ok: 'Togli il piano', pericolo: true }))) return;
//   …
//   return <>{…}{dialogo}</>;
import { useCallback, useRef, useState, type ReactNode } from 'react'
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

export function useConferma(): { conferma: (o: OpzioniConferma) => Promise<boolean>; dialogo: ReactNode } {
  const [aperta, setAperta] = useState<OpzioniConferma | null>(null)
  const risolvi = useRef<((v: boolean) => void) | null>(null)

  const conferma = useCallback((o: OpzioniConferma) => new Promise<boolean>((res) => {
    // una conferma ancora aperta vale come annullata
    risolvi.current?.(false)
    risolvi.current = res
    setAperta(o)
  }), [])

  const chiudi = useCallback((v: boolean) => {
    risolvi.current?.(v)
    risolvi.current = null
    setAperta(null)
  }, [])

  const dialogo = (
    <Modal open={!!aperta} onClose={() => chiudi(false)} title={aperta?.titolo ?? ''}>
      <div className="text-sm text-slate-700">{aperta?.testo}</div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => chiudi(false)}
          className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">{aperta?.annulla ?? 'Annulla'}</button>
        <button type="button" onClick={() => chiudi(true)}
          className={`min-h-[40px] px-3.5 rounded-lg text-white text-sm font-semibold ${aperta?.pericolo ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>{aperta?.ok ?? 'Conferma'}</button>
      </div>
    </Modal>
  )
  return { conferma, dialogo }
}
