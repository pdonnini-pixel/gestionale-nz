// App del dipendente, scheda Ferie e permessi.
// Il saldo in ore (Ferie e Permessi), la richiesta di giorni o di ore, lo
// stato delle richieste. La richiesta e' una proposta: la decide il referente
// del negozio, come quelle registrate dall'amministrazione (leave_decidi).
// Regole e parole: PIANO_FERIE_NOTES.md («Come si parla a chi chiede le ferie»).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { AVVISO_CAMPO_LIBERO, MAX_MOTIVO, dataRoma, oraRoma } from '../../lib/timbrature'
import { oreInParole } from '../../lib/ferieRichiesta'
import {
  STATO_RICHIESTA, aggiungiGiorni, dataItaliana, eventoSenzaFerie, giornateCirca, giornoBreve, giorniPianificati, giorniTra,
  quantoRichiesta, saldiApp, voceRichiesta, type SaldoApp, type SaldoVoce,
} from '../../lib/appDipendente'
import { Check, Clock3 } from 'lucide-react'
import { useDatiApp } from './useDatiApp'

interface Richiesta {
  id: string; stato: string; note: string | null; motivazione: string | null
  inviata_il: string | null; decisa_il: string | null; decisa_da_nome: string | null
  giorni: { data: string; voce: string; tipo: string; ore: number; stato: string }[] | null
  /** chiesta come eccezione, in un giorno in cui di norma non si chiede (migration 407) */
  eccezione?: boolean
}
interface DatiFerie {
  a_chiamata: boolean
  saldi: SaldoVoce[]
  richieste: Richiesta[]
  senza_ferie: { nome: string; dal: string; al: string }[]
  /** il negozio ha scritto chi approva le eccezioni: dove un giorno è spento si può chiedere lo stesso */
  eccezioni?: boolean
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
  const [quantoPermesso, setQuantoPermesso] = useState<'giornata' | 'mezza_giornata' | 'ore'>('ore')
  const [orePermesso, setOrePermesso] = useState('')
  const [note, setNote] = useState('')
  const [invio, setInvio] = useState(false)
  const inCorso = useRef(false) // blocca il doppio tocco prima che lo stato si aggiorni
  const [esito, setEsito] = useState<{ ok: boolean; testo: string } | null>(null)
  // Il motivo per cui la richiesta non passa, quando si può chiedere come eccezione
  const [daEccezione, setDaEccezione] = useState<string | null>(null)

  const saldo = useMemo(() => saldiApp(dati?.saldi ?? []), [dati])
  const senzaFerie = dati?.senza_ferie ?? []

  const giorniFerie = useMemo(() => {
    if (cosa !== 'ferie' || !dal) return []
    const fine = al && al >= dal ? al : dal
    return giorniTra(dal, fine).slice(0, 62)
  }, [cosa, dal, al])

  const righe = useMemo(() => {
    if (cosa === 'permesso') {
      if (!dataPermesso) return []
      if (quantoPermesso !== 'ore') return [{ data: dataPermesso, tipo: quantoPermesso, voce: 'permesso' }]
      const ore = Number(orePermesso.replace(',', '.'))
      return ore > 0 ? [{ data: dataPermesso, tipo: 'ore', ore, voce: 'permesso' }] : []
    }
    return giorniFerie.filter((d) => (tipi[d] ?? 'giornata') !== 'no')
      .map((d) => ({ data: d, tipo: tipi[d] ?? 'giornata', voce: 'ferie' }))
  }, [cosa, giorniFerie, tipi, dataPermesso, orePermesso, quantoPermesso])

  // Cambiati i giorni, il motivo di prima non vale più
  useEffect(() => { setDaEccezione(null) }, [righe])

  const problemi = useMemo(() => {
    const p: string[] = []
    for (const r of righe) {
      if (r.data < oggi) p.push(`Il ${dataItaliana(r.data)} è già passato.`)
      // Dove il negozio ammette le eccezioni decide il server: risponde con il motivo e la scelta
      const ev = dati?.eccezioni ? null : eventoSenzaFerie(r.data, senzaFerie)
      if (ev) p.push(`Il ${dataItaliana(r.data)} c'è ${ev}: niente ferie né permessi.`)
    }
    return p
  }, [righe, oggi, senzaFerie, dati?.eccezioni])

  const invia = async (comeEccezione = false) => {
    if (!righe.length || problemi.length || inCorso.current) return
    inCorso.current = true
    setInvio(true); setEsito(null)
    try {
      const giorni = comeEccezione ? righe.map((r) => ({ ...r, eccezione: true })) : righe
      const { data, error } = await supabase.rpc('app_dipendente_chiedi_ferie', { p_giorni: giorni, p_note: note.trim() || undefined })
      if (error) {
        // Giorno in cui di norma non si chiede: il database dice perché e, se il negozio
        // lo prevede, lascia chiederlo come eccezione (hint «eccezione», migration 407).
        if (error.hint === 'eccezione' && !comeEccezione) setDaEccezione(error.message.replace(/\s*Si può chiedere solo come eccezione\.$/, ''))
        else { setDaEccezione(null); setEsito({ ok: false, testo: error.message }) }
        return
      }
      setDaEccezione(null)
      // L'avviso al referente lo crea il database insieme alla richiesta
      // (notifica nel gestionale, migration 351): dal telefono non parte
      // nessuna mail.
      void data
      setEsito({ ok: true, testo: comeEccezione ? 'Richiesta inviata come eccezione. Ti rispondono qui, in «Le tue richieste».' : 'Richiesta inviata. Ti rispondono qui, in «Le tue richieste».' })
      setDal(''); setAl(''); setTipi({}); setDataPermesso(''); setOrePermesso(''); setQuantoPermesso('ore'); setNote('')
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

  const pianificati = giorniPianificati(dati.richieste, oggi)
  const giornata = saldo.ferie?.giornata ?? saldo.permessi?.giornata ?? 8
  // Ore che chiede la richiesta in preparazione (per dire quante ne resterebbero)
  const oreRichiesta = righe.reduce((t, r) => t + (r.tipo === 'giornata' ? giornata : r.tipo === 'mezza_giornata' ? giornata / 2 : Number((r as { ore?: number }).ore ?? 0)), 0)
  const saldoScelto = cosa === 'ferie' ? saldo.ferie : saldo.permessi

  return (
    <div className="w-full max-w-sm flex flex-col gap-4">
      {/* Saldi */}
      {saldo.ferie || saldo.permessi ? (
        <>
          {saldo.ferie && <CardSaldo titolo="Ferie" s={saldo.ferie} />}
          {saldo.permessi && <CardSaldo titolo="Permessi" s={saldo.permessi} />}
          {saldo.aggiornatoAl && (
            <p className="text-xs text-slate-400 -mt-2 px-1">
              Saldo del cedolino al {dataItaliana(saldo.aggiornatoAl)}, tolte le ore chieste o approvate dopo.
            </p>
          )}
        </>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
          <p className="font-semibold text-slate-900">Le tue ore</p>
          <p className="text-sm text-slate-600 mt-1">Arrivano con il prossimo cedolino. Puoi già fare una richiesta: la valuta il tuo referente.</p>
        </div>
      )}

      {/* Già pianificate */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
        <p className="font-semibold text-slate-900">Già pianificate</p>
        {pianificati.length === 0 ? (
          <p className="text-sm text-slate-500 mt-1">Nessuna ferie o permesso nei prossimi giorni.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {pianificati.map((g, i) => {
              const [, m, d] = g.data.split('-')
              return (
                <li key={`${g.data}-${i}`} className="flex items-center gap-3">
                  <div className="w-12 shrink-0 rounded-2xl bg-slate-50 border border-slate-100 text-center py-1.5">
                    <p className="text-lg font-bold leading-none text-slate-900">{Number(d)}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 mt-0.5">{MESI[Number(m) - 1]}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${g.voce === 'Ferie' ? 'bg-pink-50 text-[#d6005a]' : 'bg-violet-50 text-violet-700'}`}>{g.voce}</span>
                    <p className="text-sm text-slate-900 mt-0.5">
                      {g.tipo === 'giornata' ? 'giornata intera' : g.tipo === 'mezza_giornata' ? 'mezza giornata' : oreInParole(g.ore)}
                      <span className="text-slate-500"> · {giornoBreve(g.data)}</span>
                    </p>
                  </div>
                  {g.approvato
                    ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={14} />Approvata</span>
                    : <span className="flex items-center gap-1 text-xs font-medium text-amber-700"><Clock3 size={14} />In attesa</span>}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Nuova richiesta */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5 flex flex-col gap-3">
        <p className="font-semibold text-slate-900">Nuova richiesta</p>
        <Selettore valore={cosa} onCambia={(v) => setCosa(v as 'ferie' | 'permesso')}
          voci={[['ferie', 'Ferie'], ['permesso', 'Permesso']]} />

        {cosa === 'ferie' ? (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex flex-col gap-1 text-slate-600">Dal
                <input type="date" min={oggi} value={dal} onChange={(e) => { setDal(e.target.value); if (!al || al < e.target.value) setAl(e.target.value) }}
                  className="border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900" />
              </label>
              <label className="flex flex-col gap-1 text-slate-600">Al
                <input type="date" min={dal || oggi} max={dal ? aggiungiGiorni(dal, 61) : undefined} value={al} onChange={(e) => setAl(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900" />
              </label>
            </div>
            {giorniFerie.length > 0 && (
              <ul className="divide-y divide-slate-100 text-sm">
                {giorniFerie.map((d) => (
                  <li key={d} className="py-1.5 flex justify-between items-center gap-2">
                    <span className={eventoSenzaFerie(d, senzaFerie) ? 'text-rose-600' : 'text-slate-700'}>{giornoBreve(d)}</span>
                    <select value={tipi[d] ?? 'giornata'} onChange={(e) => setTipi({ ...tipi, [d]: e.target.value as Tipo | 'no' })}
                      className="border border-slate-200 rounded-xl px-2 py-1.5 bg-white">
                      <option value="giornata">giornata intera</option>
                      <option value="mezza_giornata">mezza giornata</option>
                      <option value="no">non lavoro, togli</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
            {giorniFerie.length > 0 && <p className="text-xs text-slate-500">Per ogni giorno scegli giornata intera o mezza giornata. Togli quelli in cui non lavori.</p>}
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm text-slate-600">Giorno
              <input type="date" min={oggi} value={dataPermesso} onChange={(e) => setDataPermesso(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900" />
            </label>
            <Selettore valore={quantoPermesso} onCambia={(v) => setQuantoPermesso(v as 'giornata' | 'mezza_giornata' | 'ore')}
              voci={[['giornata', 'Giornata'], ['mezza_giornata', 'Mezza'], ['ore', 'Ore']]} piccolo />
            {quantoPermesso === 'ore' && (
              <label className="flex flex-col gap-1 text-sm text-slate-600">Quante ore
                <input type="number" inputMode="decimal" min={0.5} max={10} step={0.5} value={orePermesso} onChange={(e) => setOrePermesso(e.target.value)}
                  placeholder="2" className="border border-slate-200 rounded-xl px-3 py-2.5 text-slate-900" />
              </label>
            )}
          </>
        )}

        {righe.length > 0 && oreRichiesta > 0 && (
          <p className="text-sm text-slate-700 bg-slate-50 rounded-xl px-3 py-2">
            Chiedi {quantoRichiesta(righe.map((r) => ({ data: r.data, voce: r.voce === 'ferie' ? 'F01' : 'F02', tipo: r.tipo, ore: r.tipo === 'ore' ? Number((r as { ore?: number }).ore ?? 0) : r.tipo === 'giornata' ? giornata : giornata / 2, stato: 'richiesto' })))}
            {!saldoScelto ? '.'
              : saldoScelto.oggi - oreRichiesta >= -0.005
                ? <>: ti resterebbero <b>{oreInParole(saldoScelto.oggi - oreRichiesta)}</b> di {cosa === 'ferie' ? 'ferie' : 'permessi'}.</>
                : <>: sono {oreInParole(oreRichiesta - saldoScelto.oggi)} più di quelle da usare oggi. Si contano anche quelle che maturano: decide il tuo referente.</>}
          </p>
        )}

        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_MOTIVO} rows={2}
          placeholder="Nota per il referente (facoltativa)" className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        <p className="-mt-1 text-xs text-slate-500">{AVVISO_CAMPO_LIBERO}</p>
        {problemi.map((p) => <p key={p} className="text-sm text-rose-600">{p}</p>)}
        {daEccezione && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Questa richiesta non è ammessa</p>
            <p className="mt-1">{daEccezione}</p>
            <p className="mt-1">Puoi chiederla come eccezione: la valuta chi approva le eccezioni del tuo negozio. Scrivi il motivo nella nota qui sopra.</p>
            <button type="button" onClick={() => void invia(true)} disabled={invio || !navigator.onLine}
              className="mt-3 w-full py-3 rounded-2xl bg-amber-600 text-white font-semibold disabled:opacity-40">
              {invio ? 'Invio…' : 'Chiedi come eccezione'}
            </button>
          </div>
        )}
        <button onClick={() => void invia()} disabled={!righe.length || problemi.length > 0 || invio || !navigator.onLine}
          className="py-3.5 rounded-2xl bg-[#ff0066] text-white font-semibold disabled:opacity-40 active:scale-[0.99] transition">
          {invio ? 'Invio…' : !navigator.onLine ? 'Serve la rete per inviare' : 'Invia richiesta'}
        </button>
        {esito && <p className={`text-sm ${esito.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{esito.testo}</p>}
      </div>

      {/* Le tue richieste */}
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
        <p className="font-semibold text-slate-900 mb-3">Le tue richieste</p>
        {dati.richieste.length === 0 ? <p className="text-sm text-slate-500">Nessuna richiesta.</p> : (
          <ul className="flex flex-col gap-3">
            {dati.richieste.map((r) => {
              const g = r.giorni ?? []
              const st = STATO_RICHIESTA[r.stato] ?? { testo: r.stato, colore: 'bg-slate-100 text-slate-600' }
              const voce = voceRichiesta(g)
              const primo = g[0]?.data
              const ultimo = g[g.length - 1]?.data
              return (
                <li key={r.id} className="border border-slate-100 rounded-2xl p-3 text-sm">
                  <div className="flex justify-between items-start gap-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${voce === 'Ferie' ? 'bg-pink-50 text-[#d6005a]' : voce === 'Permesso' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-700'}`}>{voce}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${st.colore}`}>{st.testo}</span>
                  </div>
                  <p className="text-slate-900 font-medium mt-2">
                    {primo ? (primo === ultimo ? giornoBreve(primo) : `dal ${giornoBreve(primo)} al ${giornoBreve(ultimo!)}`) : ''}
                  </p>
                  <p className="text-slate-500 text-xs mt-0.5">
                    {quantoRichiesta(g)}{/(ora|ore|nessuna)$/.test(quantoRichiesta(g)) ? '' : ` · ${oreInParole(g.reduce((t, x) => t + Number(x.ore), 0))}`}
                    {r.stato === 'approvata_parziale' ? `, approvate ${oreInParole(g.filter((x) => x.stato === 'approvato').reduce((t, x) => t + Number(x.ore), 0))}` : ''}
                    {r.decisa_da_nome ? ` · decisa da ${r.decisa_da_nome}` : ''}
                  </p>
                  {r.eccezione && (
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">chiesta come eccezione</span>
                    </p>
                  )}
                  {r.motivazione && r.stato !== 'ritirata' && <p className="text-slate-700 text-xs mt-1">«{r.motivazione}»</p>}
                  {r.stato === 'inviata' && (
                    <button onClick={() => void ritira(r.id)} className="text-xs text-slate-500 underline mt-2">Ritira la richiesta</button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {aggiornatoIl && <p className="text-xs text-slate-400 mt-3">Aggiornate alle {oraRoma(aggiornatoIl)}</p>}
      </div>
    </div>
  )
}

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

function numero(n: number): string {
  return n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
}

/** Saldo di una voce: ore libere grandi, barra con approvate, in attesa e libere. */
function CardSaldo({ titolo, s }: { titolo: string; s: SaldoApp }) {
  const tot = Math.max(s.totale, s.oggi + s.inAttesa + s.approvate, 0.0001)
  const pct = (x: number) => `${Math.max(0, Math.min(100, (x / tot) * 100))}%`
  const circa = giornateCirca(s.oggi, s.giornata)
  const maturano = s.conMaturazione - s.oggi
  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-5">
      <div className="flex justify-between items-baseline">
        <p className="font-semibold text-slate-900">{titolo}</p>
        <p className="text-xs text-slate-400">{oreInParole(s.totale)} in tutto</p>
      </div>
      {s.oggi < -0.005 ? (
        <p className="mt-2 text-sm text-rose-600">{oreInParole(s.oggi)}</p>
      ) : (
        <>
          <p className="mt-2 leading-none">
            <span className="text-4xl font-bold tracking-tight text-slate-900">{numero(s.oggi)}</span>
            <span className="text-slate-500 ml-1.5">ore ancora da usare</span>
          </p>
          {circa && <p className="text-sm text-slate-500 mt-1">{circa}</p>}
        </>
      )}
      <div className="mt-4 h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
        <div className="bg-emerald-500" style={{ width: pct(s.approvate) }} />
        <div className="bg-amber-400" style={{ width: pct(s.inAttesa) }} />
        <div className="bg-[#ff0066]" style={{ width: pct(Math.max(s.oggi, 0)) }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-emerald-500" />approvate {numero(s.approvate)}</span>
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-400" />in attesa {numero(s.inAttesa)}</span>
        <span className="flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-[#ff0066]" />da usare {numero(Math.max(s.oggi, 0))}</span>
      </div>
      {maturano > 0.005 && <p className="text-xs text-slate-400 mt-2">Con quelle che maturano: altre {numero(maturano)} ore.</p>}
    </div>
  )
}

/** Pulsanti a scelta unica (stile segmenti). */
function Selettore({ valore, onCambia, voci, piccolo }: { valore: string; onCambia: (v: string) => void; voci: [string, string][]; piccolo?: boolean }) {
  return (
    <div className={`flex rounded-2xl bg-slate-100 p-1 ${piccolo ? 'text-sm' : ''}`}>
      {voci.map(([k, etichetta]) => (
        <button key={k} type="button" onClick={() => onCambia(k)}
          className={`flex-1 ${piccolo ? 'py-1.5' : 'py-2'} rounded-xl transition ${valore === k ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-600'}`}>
          {etichetta}
        </button>
      ))}
    </div>
  )
}
