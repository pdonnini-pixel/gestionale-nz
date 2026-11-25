// Dipendenti → Presenze → «Per lo studio»: il file mensile delle presenze per lo studio
// paghe, con la struttura del modello dello Studio Signorini (mail del 18/11/2026).
// I conti sono in src/lib/presenzeStudio.ts; qui si caricano i dati e si scarica il file.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from './Toast'
import {
  ETICHETTA_RIGA, ORDINE_RIGHE, foglioStudio, inizioCaricamento, nomeFileStudio, oreMinuti, presenzeDelMese, titoloMese, turniUfficiali,
  type AssenzaLungaStudio, type EsitoStudio, type EventoStudio, type GiornoAssenzaStudio, type PersonaStudio, type TurnoStudio,
} from '../lib/presenzeStudio'

const STATI_APPROVATE = ['approvata', 'approvata_parziale', 'chiusa']

interface Negozio { id: string; name: string | null; code: string | null; festa_patrono: string | null }

interface Caricati {
  esito: EsitoStudio
  codice: string
  ragione: string
  negozi: Negozio[]
  /** persone in forza senza matricola: lo studio non le riconoscerebbe */
  senzaMatricola: string[]
  patronoDisponibile: boolean
}

function oggiRoma(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date())
}

function mesePrecedente(m: string): string {
  const [a, mm] = m.split('-').map(Number)
  return mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, '0')}`
}

function fineMese(m: string): string {
  const [a, mm] = m.split('-').map(Number)
  return `${m}-${String(new Date(Date.UTC(a, mm, 0)).getUTCDate()).padStart(2, '0')}`
}

async function carica(companyId: string, mese: string): Promise<Caricati> {
  const dal = `${mese}-01`
  const al = fineMese(mese)
  const dalTurni = inizioCaricamento(mese)

  const [imp, emp, neg, tur, pia, ass, lun, eve] = await Promise.all([
    supabase.from('leave_accrual_imports').select('azienda_codice, azienda_nome, periodo_anno, periodo_mese')
      .eq('company_id', companyId).not('azienda_codice', 'is', null)
      .order('periodo_anno', { ascending: false }).order('periodo_mese', { ascending: false }).limit(1),
    supabase.from('employees')
      .select('id, matricola, cognome, nome, first_name, last_name, data_assunzione, hire_date, data_cessazione, termination_date, ore_settimanali, weekly_hours, contratto_tipo, outlet_id, is_demo')
      .eq('company_id', companyId),
    supabase.from('outlets').select('id, name, code, festa_patrono' as 'id').eq('company_id', companyId).order('name'),
    supabase.from('shifts').select('employee_id, outlet_id, data, inizio, fine, pausa_minuti, ore_straordinario, stato, origine, plan_id')
      .eq('company_id', companyId).gte('data', dalTurni).lte('data', al).neq('stato', 'annullato'),
    supabase.from('shift_plans').select('id, outlet_id, mese, stato, simulazione' as 'id')
      .eq('company_id', companyId).eq('stato', 'scelto').in('mese', [`${dalTurni.slice(0, 7)}-01`, dal]),
    supabase.from('leave_request_days').select('data, voce, tipo, ore, stato, leave_requests!inner(employee_id, stato)')
      .eq('company_id', companyId).gte('data', dalTurni).lte('data', al).eq('stato', 'approvato'),
    supabase.from('employee_events').select('employee_id, motivo, data_dal, data_al, stato')
      .eq('company_id', companyId).eq('tipo', 'assenza_lunga').neq('stato', 'annullato').lte('data_dal', al),
    supabase.from('attendance_eventi').select('employee_id, data, tipo, esito, stato, minuti_confermati, minuti_proposti')
      .eq('company_id', companyId).gte('data', dalTurni).lte('data', al).eq('stato', 'confermato'),
  ])
  for (const r of [emp, tur, ass]) if (r.error) throw r.error

  // negozi: se la colonna del patrono (466) non c'è ancora, si legge senza
  let negozi: Negozio[] = []
  let patronoDisponibile = true
  if (neg.error) {
    patronoDisponibile = false
    const r = await supabase.from('outlets').select('id, name, code').eq('company_id', companyId).order('name')
    if (r.error) throw r.error
    negozi = (r.data ?? []).map((o) => ({ ...(o as { id: string; name: string | null; code: string | null }), festa_patrono: null }))
  } else negozi = (neg.data ?? []) as unknown as Negozio[]

  type Emp = {
    id: string; matricola: string | null; cognome: string | null; nome: string | null; first_name: string | null; last_name: string | null
    data_assunzione: string | null; hire_date: string | null; data_cessazione: string | null; termination_date: string | null
    ore_settimanali: number | string | null; weekly_hours: number | string | null; contratto_tipo: string | null; outlet_id: string | null; is_demo: boolean | null
  }
  const persone: PersonaStudio[] = []
  const senzaMatricola: string[] = []
  for (const e of (emp.data ?? []) as unknown as Emp[]) {
    if (e.is_demo || e.contratto_tipo === 'amministratore') continue
    const assunzione = e.data_assunzione ?? e.hire_date
    const cessazione = e.data_cessazione ?? e.termination_date
    if ((assunzione && assunzione > al) || (cessazione && cessazione < dal)) continue
    const cognome = (e.cognome ?? e.last_name ?? '').trim()
    const nome = (e.nome ?? e.first_name ?? '').trim()
    if (!e.matricola) { senzaMatricola.push(`${cognome} ${nome}`.trim()); continue }
    const ore = e.ore_settimanali ?? e.weekly_hours
    persone.push({
      id: e.id, matricola: e.matricola, cognome, nome, assunzione, cessazione,
      oreSettimanali: ore == null ? null : Number(ore), contratto: e.contratto_tipo, outletId: e.outlet_id,
    })
  }

  type Tur = TurnoStudio & { outlet_id: string; stato: string; origine: string | null; plan_id: string | null }
  const piani = ((pia.error ? [] : pia.data ?? []) as unknown as { id: string; outlet_id: string; mese: string; simulazione: boolean | null }[])
    .filter((p) => !p.simulazione)
  const turni = turniUfficiali((tur.data ?? []) as unknown as Tur[], piani)
    .map((t) => ({ ...t, inizio: String(t.inizio).slice(0, 5), fine: String(t.fine).slice(0, 5) }))

  type Ass = { data: string; voce: string; tipo: string; ore: number | string; leave_requests: { employee_id: string; stato: string } | { employee_id: string; stato: string }[] }
  const assenze: GiornoAssenzaStudio[] = ((ass.data ?? []) as unknown as Ass[]).flatMap((a) => {
    const r = Array.isArray(a.leave_requests) ? a.leave_requests[0] : a.leave_requests
    if (!r || !STATI_APPROVATE.includes(r.stato)) return []
    return [{ employee_id: r.employee_id, data: a.data, voce: a.voce, tipo: a.tipo, ore: Number(a.ore) }]
  })

  const assenzeLunghe: AssenzaLungaStudio[] = ((lun.data ?? []) as unknown as { employee_id: string; motivo: string | null; data_dal: string; data_al: string | null }[])
    .filter((l) => !l.data_al || l.data_al >= dalTurni)
    .map((l) => ({ employee_id: l.employee_id, motivo: l.motivo, dal: l.data_dal, al: l.data_al }))

  if (eve.error) throw new Error(`Non riesco a leggere i casi confermati delle presenze (${eve.error.message}): il file uscirebbe senza straordinari e uscite.`)
  if (lun.error) throw new Error(`Non riesco a leggere le assenze lunghe (${lun.error.message}): il file uscirebbe senza maternità e malattie.`)
  const eventi: EventoStudio[] = ((eve.data ?? []) as unknown as { employee_id: string; data: string; tipo: string; esito: string | null; minuti_confermati: number | null; minuti_proposti: number | null }[])
    .map((e) => ({ employee_id: e.employee_id, data: e.data, tipo: e.tipo, esito: e.esito, minuti: Number(e.minuti_confermati ?? e.minuti_proposti ?? 0) }))

  const patroni = new Map(negozi.filter((n) => n.festa_patrono).map((n) => [n.id, n.festa_patrono!]))
  const esito = presenzeDelMese({ mese, persone, turni, assenze, assenzeLunghe, eventi, patroni })
  const testata = (imp.data?.[0] ?? null) as { azienda_codice: string | null; azienda_nome: string | null } | null
  return { esito, codice: testata?.azienda_codice ?? '', ragione: testata?.azienda_nome ?? '', negozi, senzaMatricola, patronoDisponibile }
}

export default function PresenzeStudio({ companyId }: { companyId?: string }) {
  const { toast } = useToast()
  const { profile } = useAuth()
  const puoNegozi = profile?.role === 'super_advisor'
  const [mese, setMese] = useState(() => mesePrecedente(oggiRoma().slice(0, 7)))
  const [dati, setDati] = useState<Caricati | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [caricando, setCaricando] = useState(false)
  const [codice, setCodice] = useState('')
  const [ragione, setRagione] = useState('')

  const ricarica = useCallback(async () => {
    if (!companyId || !/^\d{4}-\d{2}$/.test(mese)) return
    setCaricando(true); setErrore(null)
    try {
      const d = await carica(companyId, mese)
      setDati(d); setCodice(d.codice); setRagione(d.ragione)
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e))
    } finally {
      setCaricando(false)
    }
  }, [companyId, mese])

  useEffect(() => { void ricarica() }, [ricarica])

  const salvaPatrono = async (n: Negozio, valore: string) => {
    const v = valore.trim()
    const mmdd = v === '' ? null : /^\d{1,2}\/\d{1,2}$/.test(v) ? v.split('/').reverse().map((x) => x.padStart(2, '0')).join('-') : v
    if (mmdd && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(mmdd)) { toast({ type: 'error', message: 'Scrivi il giorno come 11/11 (giorno/mese).' }); return }
    if (mmdd === n.festa_patrono) return
    const { data, error } = await supabase.from('outlets').update({ festa_patrono: mmdd } as never).eq('id', n.id).select('id')
    if (error) { toast({ type: 'error', message: error.message }); return }
    if (!data?.length) { toast({ type: 'error', message: 'Non salvato: il patrono lo cambia solo il Super Advisor.' }); return }
    toast({ type: 'success', message: `Patrono di ${n.name ?? n.code} salvato.` })
    void ricarica()
  }

  const scarica = async () => {
    if (!dati) return
    const XLSX = await import('xlsx')
    const aoa = foglioStudio(dati.esito, mese, { codice, ragioneSociale: ragione })
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // ore con due decimali come nel modello (7,30 = 7 ore e mezza)
    for (const k of Object.keys(ws)) {
      if (k.startsWith('!')) continue
      const c = ws[k] as { t: string; z?: string }
      const col = XLSX.utils.decode_cell(k).c
      if (c.t === 'n' && col >= 6 && XLSX.utils.decode_cell(k).r > 2) c.z = '0.00'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Foglio1')
    XLSX.writeFile(wb, nomeFileStudio(codice, mese), { bookType: 'biff8' })
  }

  const conteggi = useMemo(() => {
    if (!dati) return null
    let lavorate = 0, giorniFerie = 0, straord = 0
    for (const p of dati.esito.persone) {
      for (const v of p.righe.get('ORD')!) if (typeof v === 'number') lavorate += v
      for (const v of p.righe.get('LFS')!) if (typeof v === 'number') lavorate += v
      for (const v of p.righe.get('FE')!) if (typeof v === 'number' && v > 0) giorniFerie++
      for (const c of ['ST', 'LS'] as const) for (const v of p.righe.get(c)!) if (typeof v === 'number') straord += v
    }
    return { persone: dati.esito.persone.length, lavorate, giorniFerie, straord }
  }, [dati])

  const avvisi = dati ? [
    ...(dati.senzaMatricola.length ? [`Senza matricola in anagrafica, fuori dal file: ${dati.senzaMatricola.join(', ')}.`] : []),
    ...(!codice ? ['Manca il codice azienda dello studio: si legge dall\'ultimo tabulato ferie caricato, oppure scrivilo qui sotto.'] : []),
    ...dati.esito.avvisi,
  ] : []

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 max-w-3xl">
        Il file mensile delle presenze per lo studio paghe, con la struttura del loro modello: una riga per causale, un giorno per colonna.
        Le ore lavorate vengono dai turni ufficiali del mese, corrette con i casi confermati delle presenze; ferie e permessi da quelli approvati;
        maternità e malattia lunga dalle assenze dell'organico.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">Mese
          <input type="month" value={mese} onChange={(e) => setMese(e.target.value)} className="block mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-slate-500">Codice azienda
          <input value={codice} onChange={(e) => setCodice(e.target.value)} className="block mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm w-28" />
        </label>
        <label className="text-xs text-slate-500">Ragione sociale
          <input value={ragione} onChange={(e) => setRagione(e.target.value)} className="block mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm w-56" />
        </label>
        <button onClick={() => void ricarica()} disabled={caricando} className="flex items-center gap-1.5 text-sm border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 disabled:opacity-40">
          <RefreshCw size={14} className={caricando ? 'animate-spin' : ''} />Ricalcola
        </button>
        <button onClick={() => void scarica()} disabled={!dati || caricando || !dati.esito.persone.length}
          className="ml-auto flex items-center gap-1.5 text-sm bg-slate-800 text-white rounded-lg px-3 py-2 hover:bg-slate-700 disabled:opacity-40">
          <Download size={14} />Scarica il file per lo studio
        </button>
      </div>

      {errore && <p className="text-sm text-rose-600">{errore}</p>}

      {dati && conteggi && (
        <>
          <section className={`rounded-xl border p-4 text-sm ${avvisi.length ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
            <div className="flex items-center gap-2 font-semibold mb-1">
              {avvisi.length ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}
              {titoloMese(mese)}: {conteggi.persone} persone, {conteggi.lavorate.toFixed(1).replace('.', ',')} ore lavorate,
              {' '}{conteggi.giorniFerie} giorni di ferie, {conteggi.straord.toFixed(1).replace('.', ',')} ore di straordinario
            </div>
            {avvisi.length
              ? <><p className="text-slate-700 mb-1">Da guardare prima di mandarlo allo studio:</p><ul className="list-disc ml-5 space-y-0.5 text-slate-700">{avvisi.map((a) => <li key={a}>{a}</li>)}</ul></>
              : <p className="text-slate-700">Pronto: niente da sistemare.</p>}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl p-4 text-sm">
            <h3 className="font-semibold text-slate-800 mb-1">Festa del patrono dei negozi</h3>
            <p className="text-slate-500 text-xs mb-3">Quel giorno vale come festivo: «F» nelle ore ordinarie e le ore lavorate in «Lavoro festivo». Scrivi giorno/mese, per esempio 11/11.{!puoNegozi && ' La modifica la fa il Super Advisor.'}</p>
            {!dati.patronoDisponibile
              ? <p className="text-slate-500">Il patrono non è ancora disponibile su questo gestionale.</p>
              : <div className="flex flex-wrap gap-3">
                {dati.negozi.map((n) => (
                  <label key={n.id} className="text-xs text-slate-600">{n.name ?? n.code}
                    <input defaultValue={n.festa_patrono ? n.festa_patrono.split('-').reverse().join('/') : ''} disabled={!puoNegozi}
                      onBlur={(e) => void salvaPatrono(n, e.target.value)} placeholder="gg/mm"
                      className="block mt-1 border border-slate-300 rounded px-2 py-1 w-20 disabled:bg-slate-50" />
                  </label>
                ))}
              </div>}
          </section>

          <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <table className="text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left px-2 py-2 sticky left-0 bg-slate-50">Persona e causale</th>
                  {dati.esito.giorni.map((d) => <th key={d} className="px-1.5 py-2 text-right tabular-nums">{Number(d.slice(8))}</th>)}
                </tr>
              </thead>
              <tbody>
                {dati.esito.persone.map((p) => ORDINE_RIGHE
                  .filter((c) => c === 'ORD' || p.righe.get(c)!.some((v) => v !== null))
                  .map((c, k) => (
                    <tr key={`${p.persona.id}-${c}`} className={k === 0 ? 'border-t border-slate-200' : ''}>
                      <td className="px-2 py-1 sticky left-0 bg-white whitespace-nowrap">
                        {k === 0 ? <><b>{p.persona.matricola}</b> {p.persona.cognome} {p.persona.nome} · </> : <span className="text-slate-300">· </span>}
                        <span className="text-slate-500">{ETICHETTA_RIGA[c]}</span>
                      </td>
                      {p.righe.get(c)!.map((v, i) => (
                        <td key={i} className="px-1.5 py-1 text-right tabular-nums">{v === null ? '' : v === 'F' ? 'F' : oreMinuti(v).toFixed(2).replace('.', ',')}</td>
                      ))}
                    </tr>
                  )))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
