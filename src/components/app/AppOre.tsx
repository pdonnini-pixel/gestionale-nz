// App del dipendente, scheda Ore: ore lavorate (dalle timbrature) contro ore
// di turno pianificate, nel mese scelto, con il dettaglio per settimana e per
// giorno. Le correzioni le fa chi segue il personale: qui si guarda e basta.
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { dataRoma, formatMinuti, oraRoma, type TipoTimbratura } from '../../lib/timbrature'
import {
  aggiungiGiorni, dataItaliana, giornoBreve, giorniTra, lunediDi, meseLungo, minutiTurno, oreDaMinuti, oreDelPeriodo,
  primoDelMese, ultimoDelMese, type GiornoFerieApp, type TurnoApp,
} from '../../lib/appDipendente'
import { useDatiApp } from './useDatiApp'

interface Periodo {
  ore_settimanali: number | null
  margine_uscita_minuti: number
  turni: TurnoApp[]
  timbrature: { tipo: TipoTimbratura; ora: string }[]
  ferie: GiornoFerieApp[]
}

const ore = (min: number) => (min / 60).toLocaleString('it-IT', { maximumFractionDigits: 1 })

export default function AppOre() {
  const oggi = dataRoma(Date.now())
  const [mese, setMese] = useState(primoDelMese(oggi))
  const dal = mese
  const fineMese = ultimoDelMese(mese)
  const al = fineMese > oggi ? oggi : fineMese
  // Si scarica il mese intero: i turni dei giorni che verranno servono per le ore pianificate
  const scarica = useCallback(async () => {
    const { data, error } = await supabase.rpc('app_dipendente_periodo', { p_dal: dal, p_al: fineMese })
    if (error) throw error
    return data as unknown as Periodo
  }, [dal, fineMese])
  const { dati, aggiornatoIl } = useDatiApp<Periodo>(`nz-app-ore2-${mese}`, scarica)

  const settimaneLavorate = useMemo(() => dati
    ? oreDelPeriodo(dal, al, dati.timbrature, dati.turni, dati.ferie, (x) => dataRoma(Date.parse(x)), Date.now(), dati.margine_uscita_minuti)
    : [], [dati, dal, al])

  // Pianificate: minuti di turno per giorno, pausa esclusa
  const pianificatePerGiorno = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of dati?.turni ?? []) {
      if (t.data < dal || t.data > fineMese) continue
      m.set(t.data, (m.get(t.data) ?? 0) + minutiTurno(t.inizio, t.fine, t.pausa_minuti))
    }
    return m
  }, [dati, dal, fineMese])

  const lavorate = settimaneLavorate.reduce((s, w) => s + w.minutiLavorati, 0)
  const pianificateMese = [...pianificatePerGiorno.values()].reduce((s, x) => s + x, 0)
  const pianificateAOggi = [...pianificatePerGiorno.entries()].filter(([d]) => d <= oggi).reduce((s, [, x]) => s + x, 0)
  const restano = Math.max(0, pianificateMese - pianificateAOggi)

  // Settimane del mese: pianificate e lavorate (le lavorate solo fino a oggi)
  const settimane = useMemo(() => {
    const lav = new Map(settimaneLavorate.map((w) => [w.lunedi, w]))
    const lunedi = [...new Set(giorniTra(dal, fineMese).map(lunediDi))]
    return lunedi.map((l) => {
      const giorni = giorniTra(l < dal ? dal : l, aggiungiGiorni(l, 6) > fineMese ? fineMese : aggiungiGiorni(l, 6))
      return {
        lunedi: l,
        pianificate: giorni.reduce((s, d) => s + (pianificatePerGiorno.get(d) ?? 0), 0),
        lavorate: lav.get(l)?.minutiLavorati ?? 0,
        futura: l > oggi,
        dettaglio: lav.get(l),
      }
    })
  }, [settimaneLavorate, pianificatePerGiorno, dal, fineMese, oggi])
  const massimo = Math.max(1, ...settimane.map((w) => Math.max(w.pianificate, w.lavorate)))

  // I due mesi si contano da oggi, non dal mese scelto (se no i pulsanti scorrono)
  const mesePrima = primoDelMese(aggiungiGiorni(primoDelMese(oggi), -1))
  const pct = pianificateMese > 0 ? Math.min(1, lavorate / pianificateMese) : 0
  const pctPrevisto = pianificateMese > 0 ? Math.min(1, pianificateAOggi / pianificateMese) : 0

  return (
    <div className="w-full max-w-sm flex flex-col gap-4">
      <div className="flex rounded-2xl bg-slate-200/70 p-1 text-sm">
        {[mesePrima, primoDelMese(oggi)].map((m) => (
          <button key={m} onClick={() => setMese(m)}
            className={`flex-1 py-2 rounded-xl capitalize transition ${mese === m ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-600'}`}>
            {meseLungo(m)}
          </button>
        ))}
      </div>

      {/* Il mese: anello lavorate su pianificate */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
        <p className="font-semibold text-slate-900 capitalize">{meseLungo(mese)}</p>
        <div className="flex items-center gap-4 mt-3">
          <Anello pct={pct} previsto={pctPrevisto}>
            <p className="text-2xl font-bold text-slate-900 leading-none">{ore(lavorate)}</p>
            <p className="text-[11px] text-slate-500 mt-1">ore lavorate</p>
          </Anello>
          <div className="flex-1 flex flex-col gap-2 text-sm">
            <Voce colore="bg-[#ff0066]" testo="lavorate" valore={`${ore(lavorate)} ore`} />
            <Voce colore="bg-slate-300" testo={fineMese > oggi ? 'previste a oggi' : 'previste'} valore={`${ore(pianificateAOggi)} ore`} />
            {fineMese > oggi && <Voce colore="bg-slate-100 border border-slate-200" testo="nel mese" valore={`${ore(pianificateMese)} ore`} />}
          </div>
        </div>
        {fineMese > oggi && pianificateMese > 0 && (
          <p className="text-sm text-slate-600 mt-4 bg-slate-50 rounded-xl px-3 py-2">
            Ti restano <b>{oreDaMinuti(restano)}</b> di turno da qui a fine mese.
          </p>
        )}
        <p className="text-xs text-slate-400 mt-3">Lavorate: dalle tue timbrature fino al {dataItaliana(al)}. Previste: dai tuoi turni. Pause escluse.</p>
      </div>

      {/* Settimane: barre pianificate e lavorate */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
        <p className="font-semibold text-slate-900">Settimana per settimana</p>
        <ul className="mt-3 flex flex-col gap-3">
          {settimane.filter((w) => w.pianificate > 0 || w.lavorate > 0).map((w) => (
            <li key={w.lunedi}>
              <div className="flex justify-between text-xs">
                <span className="text-slate-600">dal {giornoBreve(w.lunedi < dal ? dal : w.lunedi)}</span>
                <span className="tabular-nums text-slate-900">
                  {w.futura ? <span className="text-slate-500">{oreDaMinuti(w.pianificate)} di turno</span>
                    : <>{ore(w.lavorate)} <span className="text-slate-400">su {ore(w.pianificate)} ore</span></>}
                </span>
              </div>
              <div className="relative h-2.5 mt-1 rounded-full bg-slate-100 overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded-full bg-slate-300" style={{ width: `${(w.pianificate / massimo) * 100}%` }} />
                {!w.futura && <div className="absolute inset-y-0 left-0 rounded-full bg-[#ff0066]" style={{ width: `${(w.lavorate / massimo) * 100}%` }} />}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Giorno per giorno (dalla settimana piu' recente) */}
      {[...settimane].reverse().filter((w) => w.dettaglio).map((w) => {
        const giorni = (w.dettaglio?.giorni ?? []).filter((g) => g.timbrato || g.ferie.length || g.turno)
        if (!giorni.length) return null
        return (
          <div key={`d-${w.lunedi}`} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Settimana dal {giornoBreve(w.lunedi)}</p>
            <ul className="divide-y divide-slate-100">
              {[...giorni].reverse().map((g) => (
                <li key={g.data} className="py-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-800">{giornoBreve(g.data)}</span>
                    <span className="tabular-nums text-slate-900 font-medium">{g.uscitaMancante ? <span className="text-amber-700">{oreDaMinuti(g.minutiLavorati)}, uscita mancante</span> : g.timbrato ? oreDaMinuti(g.minutiLavorati) : g.ferie.length ? (g.ferie[0].voce === 'ferie' ? 'ferie' : 'permesso') : <span className="text-slate-400 font-normal">nessuna timbratura</span>}</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{g.turno ? `turno ${g.turno.inizio.slice(0, 5)} - ${g.turno.fine.slice(0, 5)}` : 'nessun turno'}</span>
                    <span>
                      {g.minutiPausa ? `pausa ${formatMinuti(g.minutiPausa)}` : ''}
                      {g.minutiOltreTurno > 0 ? `${g.minutiPausa ? ' · ' : ''}${formatMinuti(g.minutiOltreTurno)} dopo il turno${g.straordinario ? '' : ', nella tolleranza'}` : ''}
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

function Voce({ colore, testo, valore }: { colore: string; testo: string; valore: string }) {
  return (
    <div className="flex items-center gap-2">
      <i className={`w-2.5 h-2.5 rounded-full shrink-0 ${colore}`} />
      <span className="text-slate-600 flex-1 whitespace-nowrap">{testo}</span>
      <span className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">{valore}</span>
    </div>
  )
}

/** Anello: lavorate (magenta) sopra le ore di turno previste fino a oggi (grigio). */
function Anello({ pct, previsto, children }: { pct: number; previsto: number; children: ReactNode }) {
  const r = 46
  const c = 2 * Math.PI * r
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 110 110" className="w-full h-full -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#f1f5f9" strokeWidth="10" />
        <circle cx="55" cy="55" r={r} fill="none" stroke="#cbd5e1" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${c * previsto} ${c}`} />
        <circle cx="55" cy="55" r={r} fill="none" stroke="#ff0066" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}
