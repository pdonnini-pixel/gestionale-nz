// Pagina del responsabile di negozio o area manager (migration 378): i casi
// delle presenze da confermare e le richieste di ferie e permessi dei negozi
// che un amministratore gli ha spuntato in Dipendenti → Presenze → «Chi
// conferma». Il resto del gestionale gli e' chiuso dal database
// (responsabile_block): qui tutto passa da funzioni che controllano i negozi.
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CalendarClock, CheckCircle2, Fingerprint, RefreshCw, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import PageHeader from '../components/PageHeader'
import { DaConfermare } from '../components/PresenzeConferme'
import { ETICHETTE_VOCE_BREVI, formattaData, formattaOre } from '../lib/ferieRichiesta'
import type { VoceFerie } from '../lib/ferieRichiesta'

interface RichiestaResp {
  id: string; stato: string; negozio: string | null; persona: string; prova: boolean; titolo: string | null
  note_dipendente: string | null; compilata_da_nome: string | null; inviata_il: string | null
  decisa_il: string | null; decisa_da_nome: string | null; motivazione: string | null
  giorni: { id: string; data: string; voce: string; tipo: string; ore: number; stato: string }[]
  saldi: { voce: string; disponibile: number | null }[]
  /** migration 407: richiesta in un giorno in cui di norma non si chiede, e perché */
  eccezione?: boolean; eccezione_motivo?: string | null
  /** false = per le regole del negozio questa richiesta la decide l'HR */
  posso?: boolean
}
const STATO: Record<string, { testo: string; stile: string }> = {
  inviata: { testo: 'da decidere', stile: 'bg-orange-50 text-orange-700' },
  approvata: { testo: 'approvata', stile: 'bg-emerald-50 text-emerald-700' },
  approvata_parziale: { testo: 'approvata in parte', stile: 'bg-emerald-50 text-emerald-700' },
  respinta: { testo: 'respinta', stile: 'bg-slate-100 text-slate-600' },
}
const voce = (v: string) => ETICHETTE_VOCE_BREVI[v as VoceFerie] ?? v

export default function Responsabile() {
  const [scheda, setScheda] = useState<'presenze' | 'ferie'>('presenze')
  const [negozi, setNegozi] = useState<{ id: string; nome: string }[] | null>(null)
  const [erroreNegozi, setErroreNegozi] = useState(false)

  const caricaNegozi = useCallback(() => {
    setErroreNegozi(false)
    void supabase.rpc('responsabile_negozi').then(({ data, error }) => {
      // Un errore di rete non e' «nessun negozio»: lo si dice e si riprova
      if (error) { setErroreNegozi(true); return }
      setNegozi((data as unknown as { id: string; nome: string }[]) ?? [])
    })
  }, [])
  useEffect(() => { caricaNegozi() }, [caricaNegozi])

  // Stesso contenitore e stesse schede delle altre pagine del gestionale (es. Dipendenti)
  return (
    <div className="min-h-screen bg-white">
      <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
        <PageHeader title="Presenze e ferie" subtitle={negozi?.length ? `I tuoi negozi: ${negozi.map((n) => n.nome).join(', ')}` : 'I casi e le richieste dei tuoi negozi'} noDivider />
        {erroreNegozi && (
          <div className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex items-start gap-2.5">
            <AlertCircle size={16} className="text-rose-600 mt-0.5 shrink-0" />
            <div>Non riesco a leggere i tuoi negozi: controlla la connessione.{' '}
              <button type="button" onClick={caricaNegozi} className="font-medium underline underline-offset-2">Riprova</button></div>
          </div>
        )}
        {negozi && negozi.length === 0 && (
          <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5">
            <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div>Non hai ancora negozi assegnati: chiedi a un amministratore di spuntarti in Dipendenti → Presenze → «Chi conferma».</div>
          </div>
        )}
        <div className="inline-flex bg-slate-100 rounded-lg p-0.5">
          {([
            { k: 'presenze' as const, label: 'Da confermare', Icon: Fingerprint },
            { k: 'ferie' as const, label: 'Ferie e permessi', Icon: CalendarClock },
          ]).map(({ k, label, Icon }) => (
            <button key={k} type="button" onClick={() => setScheda(k)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm font-medium transition-all ${scheda === k ? 'bg-white shadow text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>
        {scheda === 'presenze' ? <DaConfermare /> : <FerieDaDecidere />}
      </div>
    </div>
  )
}

function FerieDaDecidere() {
  const { toast } = useToast()
  const [tutte, setTutte] = useState(false)
  const [richieste, setRichieste] = useState<RichiestaResp[] | null>(null)
  const [carico, setCarico] = useState(false)
  const [occupato, setOccupato] = useState<string | null>(null)
  const [respingi, setRespingi] = useState<{ id: string; motivo: string } | null>(null)

  const carica = useCallback(async () => {
    setCarico(true)
    const { data, error } = await supabase.rpc('responsabile_ferie_elenco', { p_solo_in_attesa: !tutte })
    setCarico(false)
    if (error) { toast({ type: 'error', message: error.message }); return }
    setRichieste(data as unknown as RichiestaResp[])
  }, [tutte, toast])
  useEffect(() => { void carica() }, [carica])

  const decidi = async (q: RichiestaResp, approva: boolean, motivo?: string) => {
    if (occupato) return
    setOccupato(q.id)
    const { data: esito, error } = await supabase.rpc('leave_decidi', {
      p_request_id: q.id, p_giorni_approvati: approva ? q.giorni.map((g) => g.id) : [], p_motivazione: motivo || undefined,
    })
    setOccupato(null)
    if (error) { toast({ type: 'error', message: error.message }); return }
    // Come in Ferie e permessi → Approvazioni: la mail ai referenti e' un di piu', se non parte la decisione vale lo stesso
    try { await supabase.functions.invoke('leave-notify', { body: { request_id: q.id, momento: 'decisione' } }) } catch { /* solo l'avviso per mail */ }
    toast({ type: 'success', message: !approva || String(esito) === 'respinta'
      ? `${q.persona}: richiesta respinta.`
      : `${q.persona}: richiesta approvata.` })
    setRespingi(null)
    void carica()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={tutte} onChange={(e) => setTutte(e.target.checked)} />anche quelle decise negli ultimi 30 giorni
        </label>
        <button onClick={() => void carica()} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <RefreshCw size={14} className={carico ? 'animate-spin' : ''} />Aggiorna
        </button>
      </div>
      {richieste && richieste.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-10 text-center text-sm text-slate-400">Nessuna richiesta da decidere.</div>
      )}
      <div className="grid gap-3">
        {(richieste ?? []).map((q) => (
          <div key={q.id} className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">{q.persona}</span>
              {q.prova && <span className="text-[11px] px-1.5 rounded bg-violet-100 text-violet-700">prova</span>}
              <span className="text-xs text-slate-500">{q.negozio ?? ''}</span>
              <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full ${STATO[q.stato]?.stile ?? STATO.respinta.stile}`}>{STATO[q.stato]?.testo ?? q.stato}</span>
            </div>
            <ul className="text-sm text-slate-700">
              {q.giorni.map((g) => (
                <li key={g.id}>{formattaData(g.data)}: {voce(g.voce)}, {g.tipo === 'giornata' ? 'giornata intera' : g.tipo === 'mezza_giornata' ? 'mezza giornata' : 'ore'} ({formattaOre(g.ore)})</li>
              ))}
            </ul>
            {q.saldi.length > 0 && (
              <p className="text-xs text-slate-500">Ore ancora da usare: {q.saldi.map((s) => `${voce(s.voce)} ${formattaOre(s.disponibile ?? 0)}`).join(' · ')}</p>
            )}
            {q.eccezione && (
              <div className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
                <span className="font-semibold">Chiesta come eccezione.</span>{q.eccezione_motivo ? ` ${q.eccezione_motivo}` : ''}
              </div>
            )}
            {q.note_dipendente && <p className="text-sm bg-slate-50 rounded px-3 py-2">«{q.note_dipendente}»</p>}
            <p className="text-xs text-slate-400">{q.compilata_da_nome ?? ''}{q.inviata_il ? ` · ${new Date(q.inviata_il).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}` : ''}
              {q.decisa_da_nome ? ` · decisa da ${q.decisa_da_nome}` : ''}{q.motivazione ? ` · motivo: ${q.motivazione}` : ''}</p>
            {q.stato === 'inviata' && q.posso === false && (
              <p className="text-sm text-slate-500">Questa richiesta non la decidi tu: la decide l’HR.</p>
            )}
            {q.stato === 'inviata' && q.posso !== false && (respingi?.id === q.id ? (
              <div className="space-y-2">
                <textarea value={respingi.motivo} onChange={(e) => setRespingi({ id: q.id, motivo: e.target.value })} rows={2} maxLength={500}
                  placeholder="Motivo (obbligatorio: lo legge la persona)" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setRespingi(null)} className="text-sm border border-slate-300 rounded-lg px-3 py-1.5">Annulla</button>
                  <button disabled={!respingi.motivo.trim() || occupato === q.id} onClick={() => void decidi(q, false, respingi.motivo)}
                    className="text-sm bg-rose-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Respingi</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 justify-end">
                <button onClick={() => setRespingi({ id: q.id, motivo: '' })} className="inline-flex items-center gap-1.5 text-sm border border-slate-300 rounded-lg px-3 py-1.5"><XCircle size={14} />Respingi</button>
                <button disabled={occupato === q.id} onClick={() => void decidi(q, true)}
                  className="inline-flex items-center gap-1.5 text-sm bg-emerald-600 text-white font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"><CheckCircle2 size={14} />Approva</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
