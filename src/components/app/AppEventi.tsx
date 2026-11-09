// App del dipendente, scheda Oggi: ritardi, uscite anticipate e straordinari
// di oggi e di ieri (migration 372). Il telefono del negozio li registra; qui
// il dipendente scrive il motivo (e cambia la scelta fatta al negozio finché
// il responsabile non ha deciso). Permessi e straordinari contano solo dopo
// la conferma del responsabile.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CAUSALI_STRAORDINARIO, CAUSALI_USCITA, formatMinuti } from '../../lib/timbrature'
import { giornoBreve } from '../../lib/appDipendente'

export interface EventoApp {
  id: string
  data: string
  tipo: 'ritardo' | 'uscita_anticipata' | 'straordinario'
  minuti: number
  minuti_proposti: number
  turno_inizio: string | null
  turno_fine: string | null
  causale: string | null
  motivo: string | null
  stato: 'da_confermare' | 'confermato' | 'respinto'
  esito: string | null
  // Dalla migration 373 (decisione del responsabile)
  minuti_confermati?: number | null
  nota_decisione?: string | null
}

const STATO: Record<EventoApp['stato'], { testo: string; stile: string }> = {
  da_confermare: { testo: 'da confermare', stile: 'bg-amber-50 text-amber-700' },
  confermato: { testo: 'confermato', stile: 'bg-emerald-50 text-emerald-700' },
  respinto: { testo: 'non confermato', stile: 'bg-slate-100 text-slate-600' },
}

/** Titolo e spiegazione dell'evento, nelle parole dell'app. */
export function testoEvento(e: EventoApp): { titolo: string; dettaglio: string } {
  const turno = e.turno_inizio && e.turno_fine ? `turno ${e.turno_inizio.slice(0, 5)} - ${e.turno_fine.slice(0, 5)}` : ''
  if (e.stato === 'confermato') {
    const min = formatMinuti(e.minuti_confermati ?? e.minuti_proposti)
    const titolo = e.tipo === 'ritardo' ? `Entrata con ${formatMinuti(e.minuti)} di ritardo`
      : e.tipo === 'straordinario' ? `${min} di straordinario`
      : `Uscita ${formatMinuti(e.minuti)} prima della fine del turno`
    const dettaglio = e.esito === 'permesso' ? `${min} di permesso scalati dal saldo. Li trovi anche nella scheda Ferie.`
      : e.esito === 'malattia' ? 'Uscita per malattia registrata.'
      : e.esito === 'ore_non_lavorate' ? `D'accordo con il responsabile: ${min} non lavorati, senza permesso.`
      : e.esito === 'straordinario' ? `${min} di straordinario confermati.`
      : 'Confermato.'
    return { titolo, dettaglio }
  }
  if (e.tipo === 'ritardo') {
    return {
      titolo: `Entrata con ${formatMinuti(e.minuti)} di ritardo`,
      dettaglio: `${turno}. Oltre la tolleranza: ${formatMinuti(e.minuti_proposti)} di permesso, se il responsabile conferma.`,
    }
  }
  if (e.tipo === 'uscita_anticipata') {
    const titolo = `Uscita ${formatMinuti(e.minuti)} prima della fine del turno`
    if (e.causale === 'malattia') return { titolo, dettaglio: `${turno}. Uscita per malattia registrata.` }
    if (e.causale === 'accordo') return { titolo, dettaglio: `${turno}. D'accordo con il responsabile: la conferma lui.` }
    if (e.causale === 'personale') return { titolo, dettaglio: `${turno}. Se il responsabile conferma, ti vengono scalati ${formatMinuti(e.minuti_proposti)} di permesso.` }
    return { titolo, dettaglio: `${turno}. Scegli il motivo dell'uscita.` }
  }
  return {
    titolo: `${formatMinuti(e.minuti_proposti)} di straordinario`,
    dettaglio: `${turno}. Uscita ${formatMinuti(e.minuti)} dopo la fine del turno: conta la parte oltre il margine, se il responsabile conferma.`,
  }
}

export default function AppEventi({ eventi, oggi, onSalvato }: { eventi: EventoApp[]; oggi: string; onSalvato: () => void }) {
  if (!eventi.length) return null
  return (
    <div className="w-full max-w-sm flex flex-col gap-3">
      {[...eventi].reverse().map((e) => <Evento key={e.id} e={e} oggi={oggi} onSalvato={onSalvato} />)}
    </div>
  )
}

function Evento({ e, oggi, onSalvato }: { e: EventoApp; oggi: string; onSalvato: () => void }) {
  const [aperto, setAperto] = useState(false)
  const [motivo, setMotivo] = useState(e.motivo ?? '')
  const [causale, setCausale] = useState(e.causale ?? '')
  const [salvo, setSalvo] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const { titolo, dettaglio } = testoEvento(e)
  const modificabile = e.stato === 'da_confermare'
  const causali: Record<string, string> | null = e.tipo === 'uscita_anticipata' ? CAUSALI_USCITA
    : e.tipo === 'straordinario' ? CAUSALI_STRAORDINARIO : null
  // Uscita senza scelta fatta al negozio: si apre subito
  const mostraModulo = modificabile && (aperto || (e.tipo === 'uscita_anticipata' && !e.causale))

  const salva = async () => {
    setSalvo(true)
    setErrore(null)
    const { error } = await supabase.rpc('app_dipendente_motivo_evento', {
      p_evento: e.id, p_motivo: motivo, p_causale: causale && causale !== e.causale ? causale : undefined,
    })
    setSalvo(false)
    if (error) { setErrore(error.message); return }
    setAperto(false)
    onSalvato()
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
      <div className="flex justify-between items-start gap-2">
        <p className="text-xs uppercase tracking-wide text-slate-400">{e.data === oggi ? 'Oggi' : giornoBreve(e.data)}</p>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${STATO[e.stato].stile}`}>{STATO[e.stato].testo}</span>
      </div>
      <p className="font-semibold text-slate-900 mt-1">{titolo}</p>
      <p className="text-sm text-slate-600 mt-1">{dettaglio}</p>
      {e.causale && causali?.[e.causale] && !mostraModulo && (
        <p className="text-sm text-slate-800 mt-2"><span className="text-slate-500">Motivo:</span> {causali[e.causale]}</p>
      )}
      {e.motivo && !mostraModulo && <p className="text-sm text-slate-800 mt-1 bg-slate-50 rounded-xl px-3 py-2">«{e.motivo}»</p>}
      {e.nota_decisione && e.stato !== 'da_confermare' && (
        <p className="text-sm text-slate-600 mt-2">Il responsabile: «{e.nota_decisione}»</p>
      )}

      {mostraModulo ? (
        <div className="mt-3 flex flex-col gap-2">
          {causali && Object.entries(causali).map(([k, v]) => (
            <label key={k} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${causale === k ? 'border-[#ff0066] bg-[#ff0066]/5' : 'border-slate-200'}`}>
              <input type="radio" name={`causale-${e.id}`} checked={causale === k} onChange={() => setCausale(k)} className="accent-[#ff0066]" />
              {v}
            </label>
          ))}
          <textarea value={motivo} onChange={(x) => setMotivo(x.target.value)} maxLength={500} rows={2}
            placeholder={e.tipo === 'ritardo' ? 'Motivo del ritardo (facoltativo)' : 'Vuoi aggiungere qualcosa? (facoltativo)'}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          {errore && <p className="text-sm text-rose-600">{errore}</p>}
          <div className="flex gap-2">
            <button onClick={() => void salva()} disabled={salvo || (!!causali && !causale)}
              className="flex-1 py-2.5 rounded-xl bg-[#ff0066] text-white font-semibold disabled:opacity-40">
              {salvo ? 'Salvo...' : 'Salva'}
            </button>
            {aperto && <button onClick={() => setAperto(false)} className="px-4 rounded-xl border border-slate-200 text-slate-600">Annulla</button>}
          </div>
        </div>
      ) : modificabile && (
        <button onClick={() => setAperto(true)} className="mt-3 text-sm font-semibold text-[#ff0066]">
          {e.motivo ? 'Cambia il motivo' : e.tipo === 'ritardo' ? 'Aggiungi un motivo' : 'Aggiungi o cambia il motivo'}
        </button>
      )}
    </div>
  )
}
