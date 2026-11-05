// App del dipendente, scheda Ore: ore lavorate (dalle timbrature) giorno per
// giorno e per settimana, nel mese scelto. Le correzioni le fa chi segue il
// personale: qui si guarda e basta.
import { useCallback, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { dataRoma, formatMinuti, oraRoma, type TipoTimbratura } from '../../lib/timbrature'
import {
  aggiungiGiorni, dataItaliana, giornoBreve, meseLungo, oreDaMinuti, oreDelPeriodo, primoDelMese, ultimoDelMese,
  type GiornoFerieApp, type TurnoApp,
} from '../../lib/appDipendente'
import { useDatiApp } from './useDatiApp'

interface Periodo {
  ore_settimanali: number | null
  margine_uscita_minuti: number
  turni: TurnoApp[]
  timbrature: { tipo: TipoTimbratura; ora: string }[]
  ferie: GiornoFerieApp[]
}

export default function AppOre() {
  const oggi = dataRoma(Date.now())
  const [mese, setMese] = useState(primoDelMese(oggi))
  const dal = mese
  const finePeriodo = ultimoDelMese(mese)
  const al = finePeriodo > oggi ? oggi : finePeriodo
  const scarica = useCallback(async () => {
    const { data, error } = await supabase.rpc('app_dipendente_periodo', { p_dal: dal, p_al: al })
    if (error) throw error
    return data as unknown as Periodo
  }, [dal, al])
  const { dati, aggiornatoIl } = useDatiApp<Periodo>(`nz-app-ore-${mese}`, scarica)

  const settimane = useMemo(() => dati
    ? oreDelPeriodo(dal, al, dati.timbrature, dati.turni, dati.ferie, (x) => dataRoma(Date.parse(x)), Date.now(), dati.margine_uscita_minuti)
    : [], [dati, dal, al])
  const totale = settimane.reduce((s, w) => s + w.minutiLavorati, 0)
  const contratto = dati?.ore_settimanali ? Number(dati.ore_settimanali) * 60 : null
  const mesePrima = primoDelMese(aggiungiGiorni(mese, -1))

  return (
    <div className="w-full max-w-sm flex flex-col gap-4">
      <div className="flex rounded-xl bg-slate-200 p-1 text-sm">
        {[mesePrima, primoDelMese(oggi)].map((m) => (
          <button key={m} onClick={() => setMese(m)}
            className={`flex-1 py-2 rounded-lg capitalize ${mese === m ? 'bg-white shadow font-semibold text-slate-900' : 'text-slate-600'}`}>
            {meseLungo(m)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Ore lavorate a {meseLungo(mese)}</p>
        <p className="text-3xl font-bold text-slate-900 mt-1">{oreDaMinuti(totale)}</p>
        <p className="text-xs text-slate-500 mt-1">fino al {dataItaliana(al)}, dalle tue timbrature, pause escluse</p>
      </div>

      {[...settimane].reverse().map((w) => {
        const conTimbrature = w.giorni.filter((g) => g.timbrato || g.ferie.length || g.turno)
        if (!conTimbrature.length) return null
        return (
          <div key={w.lunedi} className="bg-white rounded-2xl shadow p-4">
            <div className="flex justify-between items-baseline mb-2">
              <p className="text-xs uppercase tracking-wide text-slate-400">Settimana dal {giornoBreve(w.lunedi)}</p>
              <p className="text-sm font-semibold text-slate-900">
                {oreDaMinuti(w.minutiLavorati)}
                {contratto && w.intera ? <span className="font-normal text-slate-500"> su {oreDaMinuti(contratto)}</span> : null}
              </p>
            </div>
            <ul className="divide-y divide-slate-100">
              {conTimbrature.map((g) => (
                <li key={g.data} className="py-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-700">{giornoBreve(g.data)}</span>
                    <span className="tabular-nums text-slate-900">{g.timbrato ? oreDaMinuti(g.minutiLavorati) : g.ferie.length ? (g.ferie[0].voce === 'ferie' ? 'ferie' : 'permesso') : 'nessuna timbratura'}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{g.turno ? `turno ${g.turno.inizio.slice(0, 5)} - ${g.turno.fine.slice(0, 5)}` : 'nessun turno'}</span>
                    <span>
                      {g.minutiPausa ? `pausa ${formatMinuti(g.minutiPausa)}` : ''}
                      {g.minutiOltreTurno > 0 ? `${g.minutiPausa ? ' · ' : ''}${formatMinuti(g.minutiOltreTurno)} dopo il turno${g.straordinario ? '' : ', nel margine'}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      <p className="text-xs text-slate-400 text-center">
        Se un'ora non torna, parlane con chi segue il personale, che può correggerla.
        {aggiornatoIl ? ` Aggiornate alle ${oraRoma(aggiornatoIl)}.` : ''}
      </p>
    </div>
  )
}
