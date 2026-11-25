// App del dipendente, scheda Turni: questa settimana e la prossima, dal piano
// scelto del mese (stessa regola della timbratrice). Si vede anche senza rete.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { mieiAvvisiTurni, novitaDaMostrare, segnaAvvisiLetti, testoAvviso, type AvvisoApp } from '../../lib/avvisiTurni'
import { oreInParole } from '../../lib/ferieRichiesta'
import { supabase } from '../../lib/supabase'
import { dataRoma, oraRoma } from '../../lib/timbrature'
import {
  aggiungiGiorni, giornoBreve, giorniConTurni, lunediDi, oreDaMinuti, type GiornoFerieApp, type TurnoApp,
} from '../../lib/appDipendente'
import { useDatiApp } from './useDatiApp'

interface Periodo { turni: TurnoApp[]; ferie: GiornoFerieApp[] }

export default function AppTurni({ onLetti, versione = 0 }: { onLetti?: () => void; versione?: number } = {}) {
  const oggi = dataRoma(Date.now())
  const dal = lunediDi(oggi)
  const al = aggiungiGiorni(dal, 13)
  const scarica = useCallback(async () => {
    const { data, error } = await supabase.rpc('app_dipendente_periodo', { p_dal: dal, p_al: al })
    if (error) throw error
    return data as unknown as Periodo
  }, [dal, al])
  const { dati, aggiornatoIl } = useDatiApp<Periodo>(`nz-app-turni-${dal}`, scarica)

  // Novità sul mio orario (migration 466): ogni turno pubblicato arrivato, cambiato o tolto.
  // Dove la funzione non c'e' il riquadro non si vede.
  const [avvisi, setAvvisi] = useState<AvvisoApp[] | null>(null)
  // senza rete resta l'ultima lettura (null = funzione assente o errore: non si cancella niente)
  const leggiAvvisi = useCallback(() => { void mieiAvvisiTurni().then((a) => { if (a) setAvvisi(a) }).catch(() => {}) }, [])
  // si rilegge quando l'app trova novita' (versione = quante ne conta l'app)
  useEffect(() => { leggiAvvisi() }, [leggiAvvisi, versione])
  const novita = useMemo(() => novitaDaMostrare(avvisi ?? []), [avvisi])
  const daMostrare = novita.flatMap((n) => (n.avviso ? [n.avviso] : []))
  const recenti = (avvisi ?? []).filter((a) => a.letto).slice(0, 5)
  const hoVisto = async () => {
    try { await segnaAvvisiLetti(novita.flatMap((n) => n.ids)); leggiAvvisi(); onLetti?.() } catch { /* senza rete: resta da leggere */ }
  }

  const settimane = useMemo(() => {
    const giorni = giorniConTurni(dal, al, dati?.turni ?? [], dati?.ferie ?? [])
    return [giorni.slice(0, 7), giorni.slice(7, 14)]
  }, [dati, dal, al])

  return (
    <div className="w-full max-w-sm flex flex-col gap-4">
      {novita.length > 0 && (
        <div className="bg-white rounded-2xl shadow p-4 border-2 border-[#ff0066]">
          <p className="text-xs uppercase tracking-wide text-[#ff0066] font-semibold mb-2">Novità sul tuo orario</p>
          <ul className="space-y-1.5 text-sm text-slate-800">
            {daMostrare.map((a) => <li key={a.id}>{testoAvviso(a)}{a.negozio ? <span className="text-slate-400"> · {a.negozio}</span> : null}</li>)}
            {daMostrare.length === 0 && <li className="text-slate-500">Il tuo orario è tornato com'era: nessun cambio.</li>}
          </ul>
          <button type="button" onClick={hoVisto} className="mt-3 w-full min-h-[44px] rounded-xl bg-[#ff0066] text-white font-semibold">Ho visto</button>
        </div>
      )}
      {settimane.map((sett, i) => (
        <div key={i} className="bg-white rounded-2xl shadow p-4">
          <div className="flex justify-between items-baseline mb-2">
            <p className="text-xs uppercase tracking-wide text-slate-400">{i === 0 ? 'Questa settimana' : 'Prossima settimana'}</p>
            <p className="text-xs text-slate-500">in turno {oreDaMinuti(sett.reduce((s, g) => s + g.minutiInTurno, 0))}</p>
          </div>
          <ul className="divide-y divide-slate-100">
            {sett.map((g) => (
              <li key={g.data} className={`py-2 flex justify-between gap-3 text-sm ${g.data === oggi ? 'font-semibold' : ''}`}>
                <span className={g.data < oggi ? 'text-slate-400' : 'text-slate-700'}>{giornoBreve(g.data)}{g.data === oggi ? ' (oggi)' : ''}</span>
                <span className="text-right">
                  {g.ferie.length > 0 && (
                    <span className="block text-emerald-700">
                      {g.ferie.map((f) => `${f.voce === 'ferie' ? 'Ferie' : 'Permesso'}${f.tipo === 'ore' ? ` ${oreInParole(Number(f.ore))}` : f.tipo === 'mezza_giornata' ? ' mezza giornata' : ''}${f.stato === 'richiesto' ? ' (in attesa)' : ''}`).join(', ')}
                    </span>
                  )}
                  {g.turni.length > 0
                    ? <span className="tabular-nums text-slate-900">{g.turni.map((t) => `${t.inizio.slice(0, 5)} - ${t.fine.slice(0, 5)}`).join(' e ')}</span>
                    : g.ferie.length === 0 && <span className="text-slate-400">riposo</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {recenti.length > 0 && (
        <details className="bg-white rounded-2xl shadow p-4 text-sm text-slate-600">
          <summary className="text-xs uppercase tracking-wide text-slate-400 cursor-pointer">Ultimi cambi già visti</summary>
          <ul className="mt-2 space-y-1">{recenti.map((a) => <li key={a.id}>{testoAvviso(a)}</li>)}</ul>
        </details>
      )}
      <p className="text-xs text-slate-400 text-center">
        {dati ? 'I turni possono ancora cambiare: guarda qui prima di ogni settimana.' : 'Turni non ancora scaricati: serve la rete la prima volta.'}
        {aggiornatoIl ? ` Aggiornati alle ${oraRoma(aggiornatoIl)}.` : ''}
      </p>
    </div>
  )
}
