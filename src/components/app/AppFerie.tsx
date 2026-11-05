// App del dipendente, scheda Ferie e permessi.
// Il saldo in ore (Ferie e Permessi), la richiesta di giorni o di ore, lo
// stato delle richieste. La richiesta e' una proposta: la decide il referente
// del negozio, come quelle registrate dall'amministrazione (leave_decidi).
// Regole e parole: PIANO_FERIE_NOTES.md («Come si parla a chi chiede le ferie»).
import { useCallback, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { dataRoma, oraRoma } from '../../lib/timbrature'
import { oreInParole } from '../../lib/ferieRichiesta'
import {
  STATO_RICHIESTA, aggiungiGiorni, dataItaliana, eventoSenzaFerie, giornoBreve, giorniTra, saldiApp, type SaldoVoce,
} from '../../lib/appDipendente'
import { useDatiApp } from './useDatiApp'

interface Richiesta {
  id: string; stato: string; note: string | null; motivazione: string | null
  inviata_il: string | null; decisa_il: string | null; decisa_da_nome: string | null
  giorni: { data: string; voce: string; tipo: string; ore: number; stato: string }[] | null
}
interface DatiFerie {
  a_chiamata: boolean
  saldi: SaldoVoce[]
  richieste: Richiesta[]
  senza_ferie: { nome: string; dal: string; al: string }[]
}
type Tipo = 'giornata' | 'mezza_giornata'

export default function AppFerie() {
  const oggi = dataRoma(Date.now())
  const scarica = useCallback(async () => {
    const { data, error } = await supabase.rpc('app_dipendente_ferie')
    if (error) throw error
    return data as unknown as DatiFerie
  }, [])
  const { dati, aggiornatoIl, aggiorna } = useDatiApp<DatiFerie>('nz-app-ferie', scarica)

  const [cosa, setCosa] = useState<'ferie' | 'permesso'>('ferie')
  const [dal, setDal] = useState('')
  const [al, setAl] = useState('')
  const [tipi, setTipi] = useState<Record<string, Tipo | 'no'>>({})
  const [dataPermesso, setDataPermesso] = useState('')
  const [orePermesso, setOrePermesso] = useState('')
  const [note, setNote] = useState('')
  const [invio, setInvio] = useState(false)
  const inCorso = useRef(false) // blocca il doppio tocco prima che lo stato si aggiorni
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null)

  const saldo = useMemo(() => saldiApp(dati?.saldi ?? []), [dati])
  const senzaFerie = dati?.senza_ferie ?? []

  const giorniFerie = useMemo(() => {
    if (cosa !== 'ferie' || !dal) return []
    const fine = al && al >= dal ? al : dal
    return giorniTra(dal, fine).slice(0, 62)
  }, [cosa, dal, al])

  const righe = useMemo(() => {
    if (cosa === 'permesso') {
      const ore = Number(orePermesso.replace(',', '.'))
      return dataPermesso && ore > 0 ? [{ data: dataPermesso, tipo: 'ore', ore, voce: 'permesso' }] : []
    }
    return giorniFerie.filter((d) => (tipi[d] ?? 'giornata') !== 'no')
      .map((d) => ({ data: d, tipo: tipi[d] ?? 'giornata', voce: 'ferie' }))
  }, [cosa, giorniFerie, tipi, dataPermesso, orePermesso])

  const problemi = useMemo(() => {
    const p: string[] = []
    for (const r of righe) {
      if (r.data < oggi) p.push(`Il ${dataItaliana(r.data)} è già passato.`)
      const ev = eventoSenzaFerie(r.data, senzaFerie)
      if (ev) p.push(`Il ${dataItaliana(r.data)} c'è ${ev}: niente ferie né permessi.`)
    }
    return p
  }, [righe, oggi, senzaFerie])

  const invia = async () => {
    if (!righe.length || problemi.length || inCorso.current) return
    inCorso.current = true
    setInvio(true); setEsito(null)
    try {
      const { data, error } = await supabase.rpc('app_dipendente_chiedi_ferie', { p_giorni: righe, p_note: note.trim() || undefined })
      if (error) { setEsito({ ok: false, testo: error.message }); return }
      // Avviso al referente per mail: e' un di piu', la richiesta e' gia' registrata
      try { await supabase.functions.invoke('leave-notify', { body: { request_id: data, momento: 'richiesta' } }) } catch { /* resta l'avviso nella pagina del referente */ }
      setEsito({ ok: true, testo: 'Richiesta inviata. Ti rispondono qui, in «Le tue richieste».' })
      setDal(''); setAl(''); setTipi({}); setDataPermesso(''); setOrePermesso(''); setNote('')
      void aggiorna()
    } finally {
      inCorso.current = false
      setInvio(false)
    }
  }

  const ritira = async (id: string) => {
    if (!window.confirm('Ritirare questa richiesta?')) return
    const { error } = await supabase.rpc('app_dipendente_ritira_ferie', { p_request_id: id })
    setEsito(error ? { ok: false, testo: error.message } : { ok: true, testo: 'Richiesta ritirata.' })
    void aggiorna()
  }

  if (!dati) {
    return <p className="text-slate-500 text-sm text-center max-w-sm">Ferie e permessi non ancora scaricati: serve la rete la prima volta.</p>
  }

  if (dati.a_chiamata) {
    return (
      <div className="w-full max-w-sm bg-white rounded-2xl shadow p-4 text-slate-700">
        Con il contratto a chiamata ferie e permessi ti vengono pagati ogni mese: non ci sono ore da chiedere.
      </div>
    )
  }

  const Riga = ({ etichetta, s }: { etichetta: string; s: { oggi: number; conMaturazione: number; inAttesa: number } | null }) => (
    <div className="py-2">
      <div className="flex justify-between items-baseline">
        <span className="text-slate-700 font-medium">{etichetta}</span>
        <span className="text-xl font-bold text-slate-900">{s ? oreInParole(s.oggi) : '—'}</span>
      </div>
      {s && (
        <p className="text-xs text-slate-500">
          {Math.abs(s.conMaturazione - s.oggi) > 0.005 ? `contando quelle che maturano: ${oreInParole(s.conMaturazione)}` : ''}
          {s.inAttesa > 0.005 ? `${Math.abs(s.conMaturazione - s.oggi) > 0.005 ? ' · ' : ''}${oreInParole(s.inAttesa)} chieste, in attesa di risposta` : ''}
        </p>
      )}
    </div>
  )

  return (
    <div className="w-full max-w-sm flex flex-col gap-4">
      {/* Saldo */}
      <div className="bg-white rounded-2xl shadow p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Le tue ore disponibili</p>
        {saldo.ferie || saldo.permessi ? (
          <>
            <div className="divide-y divide-slate-100">
              <Riga etichetta="Ferie" s={saldo.ferie} />
              <Riga etichetta="Permessi" s={saldo.permessi} />
            </div>
            {saldo.aggiornatoAl && <p className="text-xs text-slate-400 mt-1">Aggiornate al {dataItaliana(saldo.aggiornatoAl)}, tolte le ore già chieste dopo quella data.</p>}
          </>
        ) : (
          <p className="text-sm text-slate-600">Le tue ore arrivano con il prossimo cedolino. Puoi già fare una richiesta: la valuta il tuo referente.</p>
        )}
      </div>

      {/* Nuova richiesta */}
      <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-3">
        <p className="text-xs uppercase tracking-wide text-slate-400">Nuova richiesta</p>
        <div className="flex rounded-xl bg-slate-100 p-1 text-sm">
          {(['ferie', 'permesso'] as const).map((c) => (
            <button key={c} onClick={() => setCosa(c)}
              className={`flex-1 py-2 rounded-lg ${cosa === c ? 'bg-white shadow font-semibold text-slate-900' : 'text-slate-600'}`}>
              {c === 'ferie' ? 'Ferie (giorni)' : 'Permesso (ore)'}
            </button>
          ))}
        </div>

        {cosa === 'ferie' ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex flex-col gap-1">Dal
                <input type="date" min={oggi} value={dal} onChange={(e) => { setDal(e.target.value); if (!al || al < e.target.value) setAl(e.target.value) }}
                  className="border border-slate-300 rounded-lg px-2 py-2" />
              </label>
              <label className="flex flex-col gap-1">Al
                <input type="date" min={dal || oggi} max={dal ? aggiungiGiorni(dal, 61) : undefined} value={al} onChange={(e) => setAl(e.target.value)}
                  className="border border-slate-300 rounded-lg px-2 py-2" />
              </label>
            </div>
            {giorniFerie.length > 0 && (
              <ul className="divide-y divide-slate-100 text-sm">
                {giorniFerie.map((d) => (
                  <li key={d} className="py-1.5 flex justify-between items-center gap-2">
                    <span className={eventoSenzaFerie(d, senzaFerie) ? 'text-rose-600' : 'text-slate-700'}>{giornoBreve(d)}</span>
                    <select value={tipi[d] ?? 'giornata'} onChange={(e) => setTipi({ ...tipi, [d]: e.target.value as Tipo | 'no' })}
                      className="border border-slate-300 rounded-lg px-2 py-1">
                      <option value="giornata">giornata intera</option>
                      <option value="mezza_giornata">mezza giornata</option>
                      <option value="no">non lavoro, togli</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
            {giorniFerie.length > 0 && <p className="text-xs text-slate-500">Togli i giorni in cui non lavori: non serve chiedere ferie per quelli.</p>}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col gap-1">Giorno
              <input type="date" min={oggi} value={dataPermesso} onChange={(e) => setDataPermesso(e.target.value)}
                className="border border-slate-300 rounded-lg px-2 py-2" />
            </label>
            <label className="flex flex-col gap-1">Quante ore
              <input type="number" inputMode="decimal" min={0.5} max={10} step={0.5} value={orePermesso} onChange={(e) => setOrePermesso(e.target.value)}
                placeholder="2" className="border border-slate-300 rounded-lg px-2 py-2" />
            </label>
          </div>
        )}

        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2}
          placeholder="Nota per il referente (facoltativa)" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        {problemi.map((p) => <p key={p} className="text-sm text-rose-600">{p}</p>)}
        <button onClick={() => void invia()} disabled={!righe.length || problemi.length > 0 || invio || !navigator.onLine}
          className="py-3 rounded-xl bg-blue-700 text-white font-semibold disabled:opacity-40">
          {invio ? 'Invio…' : !navigator.onLine ? 'Serve la rete per inviare' : 'Invia richiesta'}
        </button>
        {esito && <p className={`text-sm ${esito.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{esito.testo}</p>}
      </div>

      {/* Le tue richieste */}
      <div className="bg-white rounded-2xl shadow p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Le tue richieste</p>
        {dati.richieste.length === 0 ? <p className="text-sm text-slate-500">Nessuna richiesta.</p> : (
          <ul className="flex flex-col gap-3">
            {dati.richieste.map((r) => {
              const g = r.giorni ?? []
              const st = STATO_RICHIESTA[r.stato] ?? { testo: r.stato, colore: 'bg-slate-100 text-slate-600' }
              const ore = g.reduce((s, x) => s + Number(x.ore), 0)
              const primo = g[0]?.data
              const ultimo = g[g.length - 1]?.data
              return (
                <li key={r.id} className="border border-slate-100 rounded-xl p-3 text-sm">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-slate-900 font-medium">
                      {primo ? (primo === ultimo ? giornoBreve(primo) : `dal ${giornoBreve(primo)} al ${giornoBreve(ultimo!)}`) : ''}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${st.colore}`}>{st.testo}</span>
                  </div>
                  <p className="text-slate-500 text-xs mt-1">
                    {oreInParole(ore)}{r.stato === 'approvata_parziale' ? `, approvate ${oreInParole(g.filter((x) => x.stato === 'approvato').reduce((s, x) => s + Number(x.ore), 0))}` : ''}
                    {r.decisa_da_nome ? ` · decisa da ${r.decisa_da_nome}` : ''}
                  </p>
                  {r.motivazione && r.stato !== 'ritirata' && <p className="text-slate-700 text-xs mt-1">«{r.motivazione}»</p>}
                  {r.stato === 'inviata' && (
                    <button onClick={() => void ritira(r.id)} className="text-xs text-slate-500 underline mt-1">Ritira la richiesta</button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {aggiornatoIl && <p className="text-xs text-slate-400 mt-2">Aggiornate alle {oraRoma(aggiornatoIl)}</p>}
      </div>
    </div>
  )
}
