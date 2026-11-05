// Dati di una scheda dell'app del dipendente: si mostrano subito quelli
// salvati sul telefono (anche senza rete), poi si aggiornano quando c'e' rete.
import { useCallback, useEffect, useState } from 'react'

export function useDatiApp<T>(chiave: string, scarica: () => Promise<T | null>) {
  const [dati, setDati] = useState<{ valore: T; il: string } | null>(() => {
    try { const s = localStorage.getItem(chiave); return s ? JSON.parse(s) as { valore: T; il: string } : null } catch { return null }
  })
  const [carico, setCarico] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)

  const aggiorna = useCallback(async () => {
    if (!navigator.onLine) return
    setCarico(true)
    try {
      const v = await scarica()
      if (v !== null) {
        const pacco = { valore: v, il: new Date().toISOString() }
        localStorage.setItem(chiave, JSON.stringify(pacco))
        setDati(pacco)
        setErrore(null)
      }
    } catch (e) {
      setErrore((e as Error).message)
    } finally {
      setCarico(false)
    }
  }, [chiave, scarica])

  useEffect(() => {
    try { const s = localStorage.getItem(chiave); setDati(s ? JSON.parse(s) as { valore: T; il: string } : null) } catch { setDati(null) }
    void aggiorna()
  }, [chiave, aggiorna])

  return { dati: dati?.valore ?? null, aggiornatoIl: dati?.il ?? null, carico, errore, aggiorna }
}
