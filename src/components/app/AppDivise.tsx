// App della dipendente, sezione «Le mie divise e acquisti» (Patrizio, 16/11/2026; migration 422).
// Per ogni capo: data, voce, divisa, codice, prezzo outlet, sconto e quanto paga. Le divise
// fornite dall'azienda valgono 0. Vede solo i suoi (app_dipendente_divise). Qui si guarda e basta.
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ETICHETTA_VOCE, NOME_VOCE, centesimi, euro, percento } from '../../lib/divise'
import { mieiCapi, type MioCapo } from '../../lib/diviseDb'

export default function AppDivise() {
  const [capi, setCapi] = useState<MioCapo[] | null>(null)
  const [errore, setErrore] = useState(false)
  useEffect(() => { mieiCapi().then((c) => { if (c) setCapi(c); else setErrore(true) }).catch(() => setErrore(true)) }, [])
  // i capi annullati (registrati per sbaglio) restano in elenco barrati e non contano
  const totale = useMemo(() => centesimi((capi ?? []).filter((c) => !c.annullato).reduce((a, c) => a + c.prezzo, 0)), [capi])

  if (errore) return <p className="w-full max-w-sm text-slate-500 text-sm">Non riesco a leggere le tue divise: riprova con la rete.</p>
  if (!capi) return <RefreshCw className="animate-spin text-slate-400" />
  return (
    <div className="w-full max-w-sm flex flex-col gap-3">
      <p className="text-lg font-semibold text-slate-900">Le mie divise e acquisti</p>
      {capi.length === 0 ? (
        <p className="text-slate-500 text-sm">Nessun capo registrato. In negozio, dopo l’entrata, avvicina il tuo QR alla timbratrice e tocca «Divise e acquisti».</p>
      ) : (
        <>
          <div className="rounded-2xl bg-white border border-slate-200 p-4">
            <p className="text-xs text-slate-500">Quanto paghi in tutto</p>
            <p className="text-2xl font-bold text-slate-900">{euro(totale)}</p>
            <p className="text-xs text-slate-500">Le divise fornite dall’azienda non si pagano.</p>
          </div>
          <ul className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
            {capi.map((c) => (
              <li key={c.id} className={`px-4 py-3 ${c.annullato ? 'text-slate-400' : ''}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm font-medium ${c.annullato ? 'line-through' : 'text-slate-900'}`}>{c.divisa ? `Divisa ${c.divisa}, ${ETICHETTA_VOCE[c.voce]}` : NOME_VOCE[c.voce]}</span>
                  <span className={c.annullato ? 'text-xs' : 'font-semibold text-slate-900'}>{c.annullato ? 'annullato' : euro(c.prezzo)}</span>
                </div>
                {c.annullato && c.annullato_motivo && <p className="text-xs">Motivo: {c.annullato_motivo}</p>}
                <p className="text-xs text-slate-500">
                  {new Date(c.registrato_il).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })} · <span className="font-mono">{c.codice}</span>
                  {c.voce !== 'divisa_fornita' && <> · prezzo outlet {euro(c.prezzo_outlet)} · sconto {percento(c.sconto_pct)}</>}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
