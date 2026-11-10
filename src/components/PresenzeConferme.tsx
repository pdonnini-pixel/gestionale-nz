// Dipendenti → Presenze (migration 373): i casi da confermare (ritardi oltre
// la tolleranza, uscite prima del turno, straordinari), il riepilogo del mese
// per lo studio paghe, chi conferma negozio per negozio e le eccezioni alle
// regole per persona. Permessi e straordinari contano solo dopo la conferma:
// la conferma di un permesso crea da sola la richiesta approvata in Ferie e
// permessi. Sul sito di un'azienda senza la migration (Made) la scheda lo dice.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Download, RefreshCw, RotateCcw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOutlets } from '../hooks/useOutlets'
import { useToast } from './Toast'
import { Modal } from './ui/Modal'
import { CAUSALI_STRAORDINARIO, CAUSALI_USCITA, dataRoma, formatMinuti, oraRoma } from '../lib/timbrature'
import {
  ETICHETTA_CAUSALE, ETICHETTA_ESITO_EVENTO, confermaDiretta, esitoEntrataDichiarata, etichettaTipo, riepilogoMese, type EventoPresenze,
} from '../lib/presenzeConferme'

export type SezioneConferme = 'conferme' | 'riepilogo' | 'regole'

const COLORE_TIPO: Record<string, string> = {
  Ritardo: 'bg-amber-100 text-amber-800', 'Uscita prima': 'bg-rose-100 text-rose-800',
  'Sto male': 'bg-indigo-100 text-indigo-800', Straordinario: 'bg-emerald-100 text-emerald-800',
  'Entrata dichiarata': 'bg-sky-100 text-sky-800',
}
const STATO: Record<string, string> = {
  da_confermare: 'bg-orange-50 text-orange-700', confermato: 'bg-emerald-50 text-emerald-700', respinto: 'bg-slate-100 text-slate-600',
}

const aggiungiGiorni = (d: string, n: number) => { const [y, m, g] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, g + n)).toISOString().slice(0, 10) }
const giornoBreve = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Rome' })
const nonDisponibile = (msg: string) => /does not exist|could not find|schema cache/i.test(msg)

/** Proposta del caso in parole. */
function proposta(e: EventoPresenze): string {
  const min = formatMinuti(e.minuti_confermati ?? e.minuti_proposti)
  if (e.tipo === 'entrata_dichiarata') return `entrata alle ${e.ora ? oraRoma(e.ora) : ''}`
  if (e.tipo === 'ritardo') return `${min} di permesso`
  if (e.tipo === 'straordinario') return `${min} di straordinario`
  if (e.causale === 'malattia') return `${min} di permesso`
  if (e.causale === 'accordo') return `${min}, d'accordo`
  return `${min} di permesso`
}
function dettaglioTurno(e: EventoPresenze): string {
  const ora = e.ora ? oraRoma(e.ora) : ''
  if (e.tipo === 'entrata_dichiarata') {
    const dove = e.canale === 'negozio' ? 'dal telefono del negozio' : e.canale === 'app' ? "dall'app" : ''
    return `turno ${e.turno_inizio?.slice(0, 5) ?? ''} · segnata${e.segnata_il ? ` alle ${oraRoma(e.segnata_il)}` : ''} ${dove}`.trim()
  }
  if (e.tipo === 'ritardo') return `turno ${e.turno_inizio?.slice(0, 5) ?? ''} · entrata ${ora}${e.tolleranza != null ? ` · tolleranza ${e.tolleranza}'` : ''}`
  if (e.tipo === 'straordinario') return `turno fino alle ${e.turno_fine?.slice(0, 5) ?? ''} · uscita ${ora}${e.margine != null ? ` · margine ${e.margine}'` : ''}`
  return `turno fino alle ${e.turno_fine?.slice(0, 5) ?? ''} · uscita ${ora}`
}

export default function PresenzeConferme({ sezione }: { sezione: SezioneConferme }) {
  if (sezione === 'riepilogo') return <Riepilogo />
  if (sezione === 'regole') return <ChiConfermaERegole />
  return <DaConfermare />
}

// ─── Da confermare ───────────────────────────────────────────────────────

export function DaConfermare() {
  const { toast } = useToast()
  const oggi = dataRoma(Date.now())
  const [giorni, setGiorni] = useState(30)
  const [outletId, setOutletId] = useState('')
  const [tutti, setTutti] = useState(false)
  const [eventi, setEventi] = useState<EventoPresenze[] | null>(null)
  const [assente, setAssente] = useState(false)
  const [carico, setCarico] = useState(false)
  const [aperto, setAperto] = useState<EventoPresenze | null>(null)
  const [occupato, setOccupato] = useState(false)

  const carica = useCallback(async () => {
    setCarico(true)
    const { data, error } = await supabase.rpc('presenze_eventi_elenco', { p_dal: aggiungiGiorni(oggi, -giorni), p_al: oggi, p_solo_da_confermare: !tutti })
    setCarico(false)
    if (error) { if (nonDisponibile(error.message)) setAssente(true); else toast({ type: 'error', message: error.message }); return }
    setEventi(data as unknown as EventoPresenze[])
  }, [oggi, giorni, tutti, toast])
  useEffect(() => { void carica() }, [carica])

  const negozi = useMemo(() => [...new Map((eventi ?? []).map((e) => [e.outlet_id, e.negozio])).entries()], [eventi])
  const righe = (eventi ?? []).filter((e) => !outletId || e.outlet_id === outletId)
  const ritardiAperti = righe.filter((e) => e.tipo === 'ritardo' && e.stato === 'da_confermare')

  const decidi = async (e: EventoPresenze, conferma: boolean, extra: { minuti?: number; scala?: boolean; nota?: string } = {}) => {
    const { error } = await supabase.rpc('presenze_decidi_evento', {
      p_evento: e.id, p_conferma: conferma, p_minuti: extra.minuti, p_scala_permesso: extra.scala, p_nota: extra.nota,
    })
    if (error) { toast({ type: 'error', message: error.message }); return false }
    return true
  }
  const confermaUno = async (e: EventoPresenze) => {
    if (occupato) return
    setOccupato(true)
    try {
      if (await decidi(e, true)) toast({ type: 'success', message: `${e.persona}: confermato.` })
    } finally { setOccupato(false); void carica() }
  }
  const confermaRitardi = async () => {
    if (occupato) return
    if (!window.confirm(`Confermare ${ritardiAperti.length} ritardi? Per ognuno nasce un permesso approvato che si scala dal saldo.`)) return
    setOccupato(true)
    let ok = 0
    try {
      for (const e of ritardiAperti) if (await decidi(e, true)) ok++
    } finally { setOccupato(false); void carica() }
    toast({ type: ok === ritardiAperti.length ? 'success' : 'warning', message: `Confermati ${ok} ritardi su ${ritardiAperti.length}: i permessi sono in Ferie e permessi.` })
  }

  if (assente) return <p className="text-slate-500 py-12 text-center">La conferma dei casi non è ancora attiva per questa azienda.</p>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Tutti i miei negozi</option>
          {negozi.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </select>
        <select value={giorni} onChange={(e) => setGiorni(Number(e.target.value))} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value={7}>Ultimi 7 giorni</option><option value={30}>Ultimi 30 giorni</option><option value={90}>Ultimi 90 giorni</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={tutti} onChange={(e) => setTutti(e.target.checked)} />anche quelli già decisi
        </label>
        <button onClick={() => void carica()} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <RefreshCw size={14} className={carico ? 'animate-spin' : ''} />Aggiorna
        </button>
        {ritardiAperti.length > 1 && (
          <button onClick={() => void confermaRitardi()} disabled={occupato} className="ml-auto disabled:opacity-40 text-sm border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50">
            Conferma tutti i ritardi ({ritardiAperti.length})
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Ritardi oltre la tolleranza, uscite prima del turno, straordinari ed entrate dimenticate e segnate dopo, dei negozi che confermi. Contano solo dopo la conferma: il permesso confermato
        compare da solo in Ferie e permessi, approvato, e si scala dal saldo.
      </p>

      <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Giorno</th><th className="text-left px-3 py-2">Persona</th><th className="text-left px-3 py-2">Cosa</th>
              <th className="text-left px-3 py-2">Turno e timbratura</th><th className="text-left px-3 py-2">Proposta</th>
              <th className="text-left px-3 py-2">Motivo</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {eventi && righe.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">{tutti ? 'Nessun caso nel periodo.' : 'Niente da confermare.'}</td></tr>
            )}
            {righe.map((e) => {
              const tipo = etichettaTipo(e)
              return (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2.5 whitespace-nowrap">{giornoBreve(e.data)}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-slate-900">{e.persona}</span>
                    {e.prova && <span className="ml-1.5 text-[11px] px-1.5 rounded bg-violet-100 text-violet-700">prova</span>}
                    <div className="text-xs text-slate-500">{e.negozio}</div>
                  </td>
                  <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${COLORE_TIPO[tipo]}`}>{tipo}</span></td>
                  <td className="px-3 py-2.5 text-slate-600 text-xs">{dettaglioTurno(e)}</td>
                  <td className="px-3 py-2.5"><span className="font-medium">{proposta(e)}</span>
                    {e.tipo === 'ritardo' && e.minuti_confermati == null && <div className="text-xs text-slate-500">{e.minuti}' arrotondati a blocchi di 15</div>}
                    {e.tipo === 'entrata_dichiarata' && e.stato === 'da_confermare' && (() => {
                      const x = esitoEntrataDichiarata(e.minuti, e.tolleranza)
                      return <div className={`text-xs ${x.ritardo ? 'text-amber-700' : 'text-slate-500'}`}>{x.testo}</div>
                    })()}
                  </td>
                  <td className="px-3 py-2.5 max-w-xs">
                    {e.causale ? <div>{ETICHETTA_CAUSALE[e.causale] ?? e.causale}</div>
                      : e.tipo === 'uscita_anticipata' || e.tipo === 'straordinario' ? <div className="text-amber-700 text-xs">motivo non scelto</div>
                      : e.tipo === 'entrata_dichiarata' && !e.motivo ? <div className="text-xs text-slate-400">nessun testo</div> : null}
                    {e.causale_negozio && e.causale_negozio !== e.causale && <div className="text-xs text-slate-500">al negozio: {ETICHETTA_CAUSALE[e.causale_negozio]}</div>}
                    {e.motivo && <div className="text-xs bg-slate-50 rounded px-2 py-1 mt-1">«{e.motivo}»</div>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    {e.stato === 'da_confermare' ? (
                      <div className="flex gap-2 justify-end">
                        {confermaDiretta(e) && (
                          <button onClick={() => void confermaUno(e)} disabled={occupato} className="disabled:opacity-40 flex items-center gap-1 bg-emerald-600 text-white text-xs font-semibold rounded-lg px-3 py-1.5 hover:bg-emerald-700">
                            <Check size={13} />Conferma
                          </button>
                        )}
                        <button onClick={() => setAperto(e)} className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50">
                          {confermaDiretta(e) ? 'Altro' : 'Decidi'}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATO[e.stato]}`}>{ETICHETTA_ESITO_EVENTO[e.esito ?? ''] ?? e.stato}</span>
                        <span className="text-[11px] text-slate-400">{e.deciso_da ?? ''}{e.deciso_il ? ` · ${new Date(e.deciso_il).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}` : ''}</span>
                        <button onClick={() => setAperto(e)} className="text-[11px] text-slate-500 underline">dettagli</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {aperto && <Decisione e={aperto} onClose={() => setAperto(null)} onFatto={() => { setAperto(null); void carica() }} />}
    </div>
  )
}

function Decisione({ e, onClose, onFatto }: { e: EventoPresenze; onClose: () => void; onFatto: () => void }) {
  const { toast } = useToast()
  const [minuti, setMinuti] = useState(e.minuti_confermati ?? e.minuti_proposti)
  const [causale, setCausale] = useState(e.causale ?? '')
  const [scala, setScala] = useState<boolean | null>(e.scala_permesso)
  const [nota, setNota] = useState('')
  const [occupato, setOccupato] = useState(false)
  const aperto = e.stato === 'da_confermare'
  const entrata = e.tipo === 'entrata_dichiarata'
  const oraSegnata = e.ora ? oraRoma(e.ora) : ''
  const [oraEntrata, setOraEntrata] = useState(oraSegnata)
  // Minuti dopo l'inizio del turno con l'ora scelta (per dire se nasce il ritardo)
  const minutiEntrata = (() => {
    if (!entrata || !e.turno_inizio || !/^\d{2}:\d{2}$/.test(oraEntrata)) return e.minuti
    const [h, m] = oraEntrata.split(':').map(Number); const [hi, mi] = e.turno_inizio.split(':').map(Number)
    return Math.max(0, h * 60 + m - (hi * 60 + mi))
  })()
  const causali: Record<string, string> | null = e.tipo === 'uscita_anticipata' ? CAUSALI_USCITA : e.tipo === 'straordinario' ? CAUSALI_STRAORDINARIO : null
  const malattia = causale === 'malattia'
  const accordo = causale === 'accordo'
  // «Sto male» (386): permesso, oppure malattia se c'e' il certificato medico (scala = false)
  const malattiaCertificata = malattia && scala === false
  const permesso = e.tipo === 'ritardo' || causale === 'personale' || (accordo && scala === true) || (malattia && !malattiaCertificata)

  const decidiEntrata = async (conferma: boolean) => {
    setOccupato(true)
    try {
      const { data, error } = await supabase.rpc('presenze_decidi_entrata', {
        p_evento: e.id, p_conferma: conferma,
        p_ora: conferma && oraEntrata && oraEntrata !== oraSegnata ? oraEntrata : undefined, p_nota: nota || undefined,
      })
      if (error) { toast({ type: 'error', message: error.message }); return }
      toast({ type: 'success', message: !conferma ? 'Non confermata: la giornata resta senza entrata, la persona lo vede nell\'app.'
        : data === 'entrata_confermata_ritardo' ? 'Entrata confermata. È nato il ritardo: lo trovi nell\'elenco da confermare.' : 'Entrata confermata.' })
      onFatto()
    } finally { setOccupato(false) }
  }

  const esegui = async (conferma: boolean) => {
    if (entrata) { await decidiEntrata(conferma); return }
    setOccupato(true)
    try {
      if (causali && causale && causale !== e.causale) {
        const { error } = await supabase.rpc('presenze_causale_evento', { p_evento: e.id, p_causale: causale })
        if (error) { toast({ type: 'error', message: error.message }); return }
      }
      const { error } = await supabase.rpc('presenze_decidi_evento', {
        p_evento: e.id, p_conferma: conferma, p_minuti: conferma ? minuti : undefined,
        p_scala_permesso: accordo || malattia ? scala ?? undefined : undefined, p_nota: nota || undefined,
      })
      if (error) { toast({ type: 'error', message: error.message }); return }
      toast({ type: 'success', message: conferma ? (permesso ? 'Confermato: il permesso è in Ferie e permessi.' : malattiaCertificata ? 'Registrata come malattia.' : 'Confermato.') : 'Non confermato: la persona lo vede nell\'app con il tuo motivo.' })
      onFatto()
    } finally { setOccupato(false) }
  }
  const riapri = async () => {
    if (!nota.trim()) { toast({ type: 'warning', message: 'Scrivi il motivo della riapertura.' }); return }
    setOccupato(true)
    const { error } = await supabase.rpc('presenze_riapri_evento', { p_evento: e.id, p_motivo: nota })
    setOccupato(false)
    if (error) { toast({ type: 'error', message: error.message }); return }
    toast({ type: 'success', message: e.leave_request_id ? 'Riaperto: il permesso creato è stato ritirato.' : 'Riaperto.' })
    onFatto()
  }

  return (
    <Modal open onClose={onClose} title={`${etichettaTipo({ tipo: e.tipo, causale })} · ${e.persona}, ${giornoBreve(e.data)}`} maxWidthClass="max-w-lg">
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">{dettaglioTurno(e)}{e.prova ? ' · dipendente di prova' : ''}</p>
        {e.motivo && <p className="bg-slate-50 rounded-lg px-3 py-2">Motivo scritto dalla persona: «{e.motivo}»</p>}

        {aperto && entrata ? (
          <>
            <label className="flex items-center gap-2">
              Entrata alle
              <input type="time" value={oraEntrata} onChange={(x) => setOraEntrata(x.target.value)}
                className="border border-slate-300 rounded px-2 py-1 font-semibold tabular-nums" />
              {oraEntrata !== oraSegnata && <span className="text-xs text-slate-400">segnata {oraSegnata}</span>}
            </label>
            <p className={`text-xs ${esitoEntrataDichiarata(minutiEntrata, e.tolleranza).ritardo ? 'text-amber-700' : 'text-slate-500'}`}>
              {esitoEntrataDichiarata(minutiEntrata, e.tolleranza).testo}. Puoi correggere l'ora: fra l'inizio del turno meno un'ora e quando è stata segnata.
            </p>
            <p className="text-xs text-slate-500">Non confermata, l'entrata non vale: la giornata resta senza entrata e se ne occupa chi segue il personale.</p>
            <textarea value={nota} onChange={(x) => setNota(x.target.value)} rows={2} maxLength={500}
              placeholder="Nota (obbligatoria se non confermi: la persona la legge nell'app)" className="w-full border border-slate-300 rounded-lg px-3 py-2" />
            <div className="flex gap-2 justify-end">
              <button disabled={occupato || !nota.trim()} onClick={() => void esegui(false)} className="border border-slate-300 rounded-lg px-4 py-2 disabled:opacity-40">Non confermare</button>
              <button disabled={occupato || !/^\d{2}:\d{2}$/.test(oraEntrata)} onClick={() => void esegui(true)}
                className="bg-emerald-600 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-40">Conferma</button>
            </div>
          </>
        ) : aperto ? (
          <>
            {causali && (
              <div className="space-y-1.5">
                <p className="font-medium text-slate-900">Motivo</p>
                {Object.entries(causali).map(([k, v]) => (
                  <label key={k} className={`flex items-center gap-2 border rounded-lg px-3 py-2 ${causale === k ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                    <input type="radio" checked={causale === k} onChange={() => setCausale(k)} />{v}
                    {e.causale_negozio === k && <span className="text-xs text-slate-400 ml-auto">scelto al negozio</span>}
                  </label>
                ))}
              </div>
            )}
            {accordo && (
              <div className="space-y-1.5">
                <p className="font-medium text-slate-900">Le ore non lavorate</p>
                <label className="flex items-center gap-2"><input type="radio" checked={scala === true} onChange={() => setScala(true)} />si scalano come permesso</label>
                <label className="flex items-center gap-2"><input type="radio" checked={scala === false} onChange={() => setScala(false)} />non si scalano (restano ore non lavorate)</label>
              </div>
            )}
            {malattia && (
              <div className="space-y-1.5">
                <p className="font-medium text-slate-900">Sto male</p>
                <label className="flex items-center gap-2"><input type="radio" checked={scala !== false} onChange={() => setScala(true)} />senza certificato medico: è un permesso</label>
                <label className="flex items-center gap-2"><input type="radio" checked={scala === false} onChange={() => setScala(false)} />ha il certificato medico: è malattia</label>
              </div>
            )}
            {!malattiaCertificata && (
              <label className="flex items-center gap-2">
                {e.tipo === 'straordinario' ? 'Straordinario' : permesso ? 'Permesso' : 'Minuti'}
                <input type="number" min={1} max={1440} value={minuti} onChange={(x) => setMinuti(Number(x.target.value))}
                  className="w-20 border border-slate-300 rounded px-2 py-1 text-center font-semibold" />
                minuti <span className="text-slate-400">({formatMinuti(minuti)})</span>
              </label>
            )}
            <p className="text-xs text-slate-500">
              {malattiaCertificata ? 'Con il certificato medico si registra come malattia del giorno, dall\'ora dell\'uscita. Nessun permesso scalato.'
                : permesso ? 'Alla conferma nasce un permesso approvato in Ferie e permessi (ex festività finché bastano, poi ROL), scalato dal saldo.'
                : e.tipo === 'straordinario' ? 'Alla conferma entra nelle ore di straordinario del mese della persona.'
                : accordo ? 'Scegli se scalare il permesso.' : ''}
            </p>
            <textarea value={nota} onChange={(x) => setNota(x.target.value)} rows={2} maxLength={500}
              placeholder="Nota (obbligatoria se non confermi: la persona la legge nell'app)" className="w-full border border-slate-300 rounded-lg px-3 py-2" />
            <div className="flex gap-2 justify-end">
              <button disabled={occupato || !nota.trim()} onClick={() => void esegui(false)} className="border border-slate-300 rounded-lg px-4 py-2 disabled:opacity-40">Non confermare</button>
              <button disabled={occupato || (!!causali && !causale) || (accordo && scala === null) || (!malattiaCertificata && !(minuti > 0))} onClick={() => void esegui(true)}
                className="bg-emerald-600 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-40">Conferma</button>
            </div>
          </>
        ) : (
          <>
            <p><span className={`text-xs px-2 py-0.5 rounded-full ${STATO[e.stato]}`}>{ETICHETTA_ESITO_EVENTO[e.esito ?? ''] ?? e.stato}</span>
              {e.minuti_confermati != null && e.esito !== 'malattia' && !entrata && <span className="ml-2">{formatMinuti(e.minuti_confermati)}</span>}</p>
            {e.causale && <p>Motivo: {ETICHETTA_CAUSALE[e.causale]}{e.causale_negozio && e.causale_negozio !== e.causale ? ` (al negozio: ${ETICHETTA_CAUSALE[e.causale_negozio]})` : ''}</p>}
            {e.nota_decisione && <p className="bg-slate-50 rounded-lg px-3 py-2">Nota: {e.nota_decisione}</p>}
            <p className="text-xs text-slate-500">Deciso da {e.deciso_da ?? '—'}{e.deciso_il ? ` il ${new Date(e.deciso_il).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' })}` : ''}.</p>
            {entrata ? (
              <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">
                Un'entrata decisa non si riapre: per correggerla, in Dipendenti → Presenze → Giornata si annulla la timbratura o se ne aggiunge una a mano.
              </p>
            ) : (
            <div className="border-t border-slate-100 pt-3 space-y-2">
              <p className="text-xs text-slate-500">Solo gli amministratori possono riaprire un caso deciso. {e.leave_request_id ? 'Il permesso creato dalla conferma si ritira insieme.' : ''}</p>
              <textarea value={nota} onChange={(x) => setNota(x.target.value)} rows={2} maxLength={500} placeholder="Motivo della riapertura" className="w-full border border-slate-300 rounded-lg px-3 py-2" />
              <div className="flex justify-end">
                <button disabled={occupato || !nota.trim()} onClick={() => void riapri()} className="flex items-center gap-1.5 border border-slate-300 rounded-lg px-4 py-2 disabled:opacity-40"><RotateCcw size={14} />Riapri</button>
              </div>
            </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ─── Riepilogo del mese ──────────────────────────────────────────────────

function Riepilogo() {
  const { toast } = useToast()
  const oggi = dataRoma(Date.now())
  const [mese, setMese] = useState(oggi.slice(0, 7))
  const [outletId, setOutletId] = useState('')
  const [eventi, setEventi] = useState<EventoPresenze[] | null>(null)
  const [assente, setAssente] = useState(false)

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mese)) return
    let vivo = true
    const dal = `${mese}-01`
    const al = aggiungiGiorni(`${aggiungiGiorni(dal, 32).slice(0, 7)}-01`, -1)
    void supabase.rpc('presenze_eventi_elenco', { p_dal: dal, p_al: al, p_solo_da_confermare: false }).then(({ data, error }) => {
      if (!vivo) return
      if (error) { if (nonDisponibile(error.message)) setAssente(true); else toast({ type: 'error', message: error.message }); return }
      setEventi(data as unknown as EventoPresenze[])
    })
    return () => { vivo = false }
  }, [mese, toast])

  const negozi = useMemo(() => [...new Map((eventi ?? []).map((e) => [e.outlet_id, e.negozio])).entries()], [eventi])
  const righe = useMemo(() => riepilogoMese((eventi ?? []).filter((e) => !outletId || e.outlet_id === outletId)), [eventi, outletId])
  const aperti = righe.reduce((s, r) => s + r.daConfermare, 0)
  const causaliTesto = (r: (typeof righe)[number]) => Object.entries(r.perCausale).map(([k, v]) => `${ETICHETTA_CAUSALE[k] ?? 'senza motivo'} ${formatMinuti(v)}`).join(' · ')
  const malattieTesto = (r: (typeof righe)[number]) => r.malattie.map((m) => `${giornoBreve(m.data)}${m.ora ? ` dalle ${oraRoma(m.ora)}` : ''}`).join(', ')

  const scarica = async () => {
    const XLSX = await import('xlsx')
    const aoa: (string | number)[][] = [['Negozio', 'Persona', 'Ritardi', 'Permessi da ritardi (min)', 'Permessi da uscite (min)', 'Ore non lavorate senza permesso (min)', 'Uscite per malattia', 'Straordinari (min)', 'Straordinari per motivo', 'Ancora da confermare']]
    for (const r of righe) aoa.push([r.negozio, r.persona, r.ritardi, r.permessoRitardi, r.permessoUscite, r.oreNonLavorate, malattieTesto(r), r.straordinari, causaliTesto(r), r.daConfermare])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Presenze')
    XLSX.writeFile(wb, `presenze_${mese}.xlsx`)
  }

  if (assente) return <p className="text-slate-500 py-12 text-center">Il riepilogo non è ancora attivo per questa azienda.</p>
  const cella = (min: number) => (min ? formatMinuti(min) : '–')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          <option value="">Tutti i miei negozi</option>
          {negozi.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </select>
        {aperti > 0 && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-orange-50 text-orange-700">{aperti} ancora da confermare</span>}
        <button onClick={() => void scarica()} disabled={!righe.length} className="ml-auto flex items-center gap-1.5 text-sm border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 disabled:opacity-40">
          <Download size={14} />Scarica Excel
        </button>
      </div>
      <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Persona</th><th className="text-right px-3 py-2">Ritardi</th><th className="text-right px-3 py-2">Permessi da ritardi</th>
              <th className="text-right px-3 py-2">Permessi da uscite</th><th className="text-right px-3 py-2">Senza permesso</th><th className="text-left px-3 py-2">Malattia</th>
              <th className="text-right px-3 py-2">Straordinari</th><th className="text-left px-3 py-2">Per motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {eventi && righe.length === 0 && <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-400">Nessun caso nel mese.</td></tr>}
            {righe.map((r) => (
              <tr key={r.employee_id}>
                <td className="px-3 py-2"><span className="font-medium text-slate-900">{r.persona}</span><div className="text-xs text-slate-500">{r.negozio}{r.daConfermare ? ` · ${r.daConfermare} da confermare` : ''}</div></td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ritardi || '–'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cella(r.permessoRitardi)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cella(r.permessoUscite)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cella(r.oreNonLavorate)}</td>
                <td className="px-3 py-2 text-xs">{malattieTesto(r) || '–'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{cella(r.straordinari)}</td>
                <td className="px-3 py-2 text-xs">{causaliTesto(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-slate-500">Solo i casi confermati. Il formato del file per lo studio paghe si adatta quando il consulente dice come lo vuole.</p>
    </div>
  )
}

// ─── Chi conferma ed eccezioni per persona ───────────────────────────────

interface Confermatore { user_id: string; nome: string | null; email: string | null; ruolo: string | null; amministratore: boolean; negozi: string[]; dipendente_id?: string | null }
interface Eccezione { employee_id: string; tolleranza_entrata_minuti: number | null; margine_uscita_minuti: number | null; nota: string | null }

function ChiConfermaERegole() {
  const { toast } = useToast()
  const { outlets } = useOutlets()
  const [utenti, setUtenti] = useState<Confermatore[] | null>(null)
  const [eccezioni, setEccezioni] = useState<Eccezione[]>([])
  const [persone, setPersone] = useState<{ id: string; nome: string }[]>([])
  const [assente, setAssente] = useState(false)
  const [vietato, setVietato] = useState(false)
  const [nuova, setNuova] = useState({ emp: '', tolleranza: '', margine: '', nota: '' })

  const carica = useCallback(async () => {
    const [u, ecc, emp] = await Promise.all([
      supabase.rpc('presenze_confermatori_elenco'),
      supabase.from('attendance_regole_dipendente').select('employee_id, tolleranza_entrata_minuti, margine_uscita_minuti, nota'),
      supabase.from('employees').select('id, nome, cognome, first_name, last_name, is_active').eq('is_active', true),
    ])
    if (u.error) {
      if (nonDisponibile(u.error.message)) setAssente(true)
      else if (/non autorizzato/i.test(u.error.message)) setVietato(true)
      else toast({ type: 'error', message: u.error.message })
      return
    }
    setUtenti(u.data as unknown as Confermatore[])
    setEccezioni((ecc.data ?? []) as Eccezione[])
    setPersone(((emp.data ?? []) as { id: string; nome: string | null; cognome: string | null; first_name: string | null; last_name: string | null }[])
      .map((e) => ({ id: e.id, nome: `${e.cognome ?? e.last_name ?? ''} ${e.nome ?? e.first_name ?? ''}`.trim() }))
      .sort((a, b) => a.nome.localeCompare(b.nome)))
  }, [toast])
  useEffect(() => { void carica() }, [carica])

  const negozi = outlets.filter((o) => o.is_active !== false)
  const spunta = async (u: Confermatore, outletId: string, attivo: boolean) => {
    const { error } = await supabase.rpc('presenze_confermatore_imposta', { p_user: u.user_id, p_outlet: outletId, p_attivo: attivo })
    if (error) { toast({ type: 'error', message: error.message }); return }
    setUtenti((xs) => xs?.map((x) => x.user_id !== u.user_id ? x : { ...x, negozi: attivo ? [...x.negozi, outletId] : x.negozi.filter((n) => n !== outletId) }) ?? null)
  }
  // Collega l'account alla sua scheda dipendente: cosi' non decide sui propri casi
  const collega = async (u: Confermatore, employeeId: string | null) => {
    const { error } = await supabase.rpc('presenze_responsabile_dipendente_imposta', { p_user: u.user_id, p_employee: employeeId as string })
    if (error) { toast({ type: 'error', message: error.message }); return }
    setUtenti((xs) => xs?.map((x) => x.user_id !== u.user_id ? x : { ...x, dipendente_id: employeeId }) ?? null)
  }
  const senzaNessuno = negozi.filter((o) => !(utenti ?? []).some((u) => !u.amministratore && u.ruolo !== 'viewer' && u.negozi.includes(o.id)))
  const numero = (s: string) => (s.trim() === '' ? null : Number(s))
  const salvaEccezione = async (emp: string, tolleranza: number | null, margine: number | null, nota: string | null) => {
    const { error } = await supabase.rpc('presenze_regola_dipendente', { p_emp: emp, p_tolleranza: tolleranza, p_margine: margine, p_nota: nota ?? undefined })
    if (error) { toast({ type: 'error', message: error.message }); return }
    setNuova({ emp: '', tolleranza: '', margine: '', nota: '' })
    void carica()
  }
  const nomeDi = (id: string) => persone.find((p) => p.id === id)?.nome ?? 'persona'

  if (assente) return <p className="text-slate-500 py-12 text-center">Chi conferma e le eccezioni non sono ancora attivi per questa azienda.</p>
  if (vietato) return <p className="text-slate-500 py-12 text-center">Chi conferma e le eccezioni li gestiscono gli amministratori e chi segue il personale.</p>

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 overflow-x-auto">
        <h3 className="font-semibold text-slate-900">Chi conferma, negozio per negozio</h3>
        <p className="text-xs text-slate-500">
          Solo utenti del gestionale. Il referente ha un negozio, l'area manager ne ha più di uno. Gli amministratori e chi segue il personale confermano sempre tutto.
          Chi è spuntato riceve una notifica nel gestionale per ogni caso nuovo del suo negozio.
        </p>
        {utenti && !utenti.some((u) => !u.amministratore && u.ruolo !== 'viewer') && (
          <p className="text-sm bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-3 py-2">
            Per ora non c'è nessuno da spuntare: gli utenti del gestionale sono amministratori, che confermano già tutti i negozi
            (casella grigia spuntata), oppure in sola lettura, che non confermano (casella grigia vuota). Quando crei l'account di un
            responsabile di negozio o di un area manager, compare qui con le caselle attive e scegli tu i suoi negozi.
          </p>
        )}
        {senzaNessuno.length > 0 && utenti && (
          <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
            Senza un responsabile per le presenze: {senzaNessuno.map((o) => o.name).join(', ')}. I loro casi li vedono solo gli amministratori.
          </p>
        )}
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-xs uppercase">
            <tr><th className="text-left py-2 pr-3">Utente</th>{negozi.map((o) => <th key={o.id} className="px-2 py-2 text-center font-medium">{o.name}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(utenti ?? []).map((u) => (
              <tr key={u.user_id}>
                <td className="py-2 pr-3"><span className="font-medium text-slate-900">{u.nome ?? u.email}</span>
                  <div className="text-xs text-slate-500">{u.amministratore ? 'conferma sempre tutto' : u.ruolo === 'viewer' ? 'sola lettura: non può confermare' : u.ruolo}</div>
                  {!u.amministratore && u.ruolo !== 'viewer' && 'dipendente_id' in u && (
                    <label className="block mt-1 text-xs text-slate-600">
                      È anche il dipendente:{' '}
                      <select value={u.dipendente_id ?? ''} onChange={(e) => void collega(u, e.target.value || null)}
                        className={`border rounded px-1 py-0.5 text-xs ${u.dipendente_id ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}>
                        <option value="">non è un dipendente</option>
                        {persone.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </select>
                    </label>
                  )}</td>
                {negozi.map((o) => (
                  <td key={o.id} className="px-2 py-2 text-center">
                    <input type="checkbox" aria-label={`${u.nome ?? u.email} conferma ${o.name}`}
                      checked={u.amministratore || (u.ruolo !== 'viewer' && u.negozi.includes(o.id))} disabled={u.amministratore || u.ruolo === 'viewer'}
                      onChange={(e) => void spunta(u, o.id, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-slate-900">Eccezioni per persona</h3>
        <p className="text-xs text-slate-500">La tolleranza del negozio (una sola, per entrata e uscita) si cambia nella scheda «Giornata». Qui le eccezioni per singola persona: il campo vuoto vuol dire «come il negozio».</p>
        <table className="w-full text-sm">
          <thead className="text-slate-500 text-xs uppercase"><tr><th className="text-left py-2">Persona</th><th className="text-left py-2">Tolleranza (entrata e uscita)</th><th className="text-left py-2">Perché</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {eccezioni.filter((x) => x.tolleranza_entrata_minuti != null || x.margine_uscita_minuti != null).map((x) => (
              <tr key={x.employee_id}>
                <td className="py-2 font-medium">{nomeDi(x.employee_id)}</td>
                <td className="py-2">{x.tolleranza_entrata_minuti != null ? `${x.tolleranza_entrata_minuti}'` : <span className="text-slate-400">del negozio</span>}</td>
                <td className="py-2 text-xs">{x.nota}</td>
                <td className="py-2 text-right"><button onClick={() => void salvaEccezione(x.employee_id, null, null, x.nota)} className="text-xs text-slate-500 underline">Togli</button></td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-2">
                <select value={nuova.emp} onChange={(e) => {
                  // Chi ha gia' un'eccezione parte dai valori salvati: un campo lasciato vuoto la toglierebbe
                  const g = eccezioni.find((x) => x.employee_id === e.target.value)
                  setNuova({ emp: e.target.value, tolleranza: g?.tolleranza_entrata_minuti?.toString() ?? '', margine: g?.margine_uscita_minuti?.toString() ?? '', nota: g?.nota ?? '' })
                }} className="border border-slate-300 rounded px-2 py-1 w-full">
                  <option value="">Scegli una persona…</option>
                  {persone.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </td>
              <td className="py-2 pr-2"><input type="number" min={0} max={120} placeholder="min" value={nuova.tolleranza} onChange={(e) => setNuova({ ...nuova, tolleranza: e.target.value })} className="w-20 border border-slate-300 rounded px-2 py-1" /></td>
              <td className="py-2 pr-2"><input value={nuova.nota} maxLength={300} placeholder="per esempio: treno da Orte" onChange={(e) => setNuova({ ...nuova, nota: e.target.value })} className="w-full border border-slate-300 rounded px-2 py-1" /></td>
              <td className="py-2 text-right">
                <button disabled={!nuova.emp || nuova.tolleranza === ''}
                  onClick={() => void salvaEccezione(nuova.emp, numero(nuova.tolleranza), numero(nuova.tolleranza), nuova.nota || null)}
                  className="text-xs bg-slate-900 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Aggiungi</button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  )
}
