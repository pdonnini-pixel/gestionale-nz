// Dipendenti → Presenze (migration 348).
//
// Per chi segue il personale:
//   1. Presenze del giorno, negozio per negozio: turno, entrata, pausa,
//      uscita, ore lavorate, ritardo, uscita oltre il margine (straordinario
//      da guardare), uscita non timbrata. Le uscite segnate dal dipendente si
//      confermano qui; una timbratura sbagliata si annulla con il motivo.
//   2. Impostazioni del negozio: timbrature accese, avvisi WhatsApp, margine
//      dopo la fine del turno (30 minuti di default).
//   3. Accessi: numero WhatsApp di ogni persona e codice per attivare l'app.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, KeyRound, RefreshCw, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOutlets } from '../hooks/useOutlets'
import { useToast } from './Toast'
import {
  ETICHETTA_ESITO, ETICHETTA_TIPO, MARGINE_USCITA_DEFAULT, dataRoma, formatMinuti, oraRoma, oraRomaInMs, ordina,
  riepilogoGiorno, type EsitoGiorno, type TipoTimbratura,
} from '../lib/timbrature'

interface Impostazioni { attive: boolean; avvisi_whatsapp: boolean; margine_uscita_minuti: number }
interface Turno { id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null }
interface Punch {
  id: string; employee_id: string; tipo: TipoTimbratura; ora: string; origine: string; verifica: string; nota: string | null
}
interface Accesso {
  employee_id: string; nome: string; telefono_whatsapp: string | null; codice: string | null
  codice_scade: string | null; attivata_il: string | null
}

const COLORE_ESITO: Record<EsitoGiorno, string> = {
  non_timbrato: 'bg-slate-100 text-slate-600',
  in_negozio: 'bg-emerald-100 text-emerald-800',
  in_pausa: 'bg-amber-100 text-amber-800',
  uscito: 'bg-slate-100 text-slate-700',
  uscita_mancante: 'bg-rose-100 text-rose-800',
}

const ETICHETTA_VERIFICA: Record<string, string> = {
  firma_non_valida: 'codice non valido',
  fuori_tempo: 'ora non attendibile',
  da_confermare: 'da confermare',
}

export default function PresenzeNegozi({ companyId }: { companyId: string }) {
  const { toast } = useToast()
  const { outlets } = useOutlets()
  const [outletId, setOutletId] = useState('')
  const [giorno, setGiorno] = useState(() => dataRoma(Date.now()))
  const [imp, setImp] = useState<Impostazioni>({ attive: false, avvisi_whatsapp: false, margine_uscita_minuti: MARGINE_USCITA_DEFAULT })
  const [turni, setTurni] = useState<Turno[]>([])
  const [punches, setPunches] = useState<Punch[]>([])
  const [avvisati, setAvvisati] = useState<Map<string, string>>(new Map())
  const [nomi, setNomi] = useState<Map<string, string>>(new Map())
  const [accessi, setAccessi] = useState<Accesso[]>([])
  const [carico, setCarico] = useState(false)

  useEffect(() => {
    if (!outletId && outlets.length) {
      setOutletId((outlets.find((o) => o.code === 'RSO') ?? outlets[0]).id)
    }
  }, [outlets, outletId])

  const carica = useCallback(async () => {
    if (!outletId) return
    setCarico(true)
    try {
      const mese = `${giorno.slice(0, 7)}-01`
      const dal = new Date(oraRomaInMs(giorno, '00:00')).toISOString()
      const al = new Date(oraRomaInMs(giorno, '23:59') + 60_000).toISOString()
      const [sRes, pianoRes, tRes, pRes, nRes, aRes, eRes] = await Promise.all([
        supabase.from('attendance_settings').select('attive, avvisi_whatsapp, margine_uscita_minuti').eq('outlet_id', outletId).maybeSingle(),
        supabase.from('shift_plans').select('id').eq('outlet_id', outletId).eq('mese', mese).eq('stato', 'scelto').maybeSingle(),
        supabase.from('shifts').select('id, employee_id, data, inizio, fine, pausa_minuti, plan_id, stato, origine').eq('outlet_id', outletId).eq('data', giorno).neq('stato', 'annullato'),
        supabase.from('attendance_punches').select('id, employee_id, tipo, ora, origine, verifica, nota').eq('outlet_id', outletId).eq('annullata', false).gte('ora', dal).lt('ora', al),
        supabase.from('attendance_notifications').select('employee_id, esito').eq('data', giorno),
        supabase.rpc('app_accessi_elenco', { p_outlet_id: outletId }),
        supabase.from('employees').select('id, nome, cognome, first_name, last_name').eq('company_id', companyId),
      ])
      if (sRes.data) setImp(sRes.data as Impostazioni)
      else setImp({ attive: false, avvisi_whatsapp: false, margine_uscita_minuti: MARGINE_USCITA_DEFAULT })
      // Turni ufficiali: quelli del piano scelto del mese, altrimenti quelli
      // senza piano pubblicati o messi a mano (stessa regola della migration 348).
      const pianoId = (pianoRes.data as { id: string } | null)?.id ?? null
      const tutti = (tRes.data ?? []) as (Turno & { plan_id: string | null; stato: string; origine: string })[]
      setTurni(tutti.filter((t) => pianoId ? t.plan_id === pianoId : (t.plan_id === null && (t.stato === 'pubblicato' || t.origine === 'manuale'))))
      setPunches((pRes.data ?? []) as Punch[])
      setAvvisati(new Map(((nRes.data ?? []) as { employee_id: string; esito: string }[]).map((n) => [n.employee_id, n.esito])))
      setAccessi((aRes.data ?? []) as Accesso[])
      setNomi(new Map(((eRes.data ?? []) as { id: string; nome: string | null; cognome: string | null; first_name: string | null; last_name: string | null }[])
        .map((e) => [e.id, `${e.nome ?? e.first_name ?? ''} ${e.cognome ?? e.last_name ?? ''}`.trim()])))
    } finally {
      setCarico(false)
    }
  }, [outletId, giorno, companyId])

  useEffect(() => { void carica() }, [carica])

  const salvaImp = async (nuove: Impostazioni) => {
    setImp(nuove)
    const { error } = await supabase.from('attendance_settings').upsert({ outlet_id: outletId, company_id: companyId, ...nuove, updated_at: new Date().toISOString() }, { onConflict: 'outlet_id' })
    if (error) { toast({ type: 'error', message: `Impostazioni non salvate: ${error.message}` }); void carica() }
    else toast({ type: 'success', message: 'Impostazioni salvate.' })
  }

  const righe = useMemo(() => {
    const persone = new Set<string>([...turni.map((t) => t.employee_id), ...punches.map((p) => p.employee_id)])
    const adesso = Date.now()
    return [...persone].map((emp) => {
      const turno = turni.filter((t) => t.employee_id === emp).sort((a, b) => a.inizio.localeCompare(b.inizio))
      const primo = turno[0] ?? null
      const ultimo = turno[turno.length - 1] ?? null
      const ts = ordina(punches.filter((p) => p.employee_id === emp))
      const r = riepilogoGiorno(ts, ultimo ? { ...ultimo, inizio: primo!.inizio } : null, adesso, imp.margine_uscita_minuti)
      return { emp, nome: nomi.get(emp) ?? 'Persona', turno: primo && ultimo ? `${primo.inizio.slice(0, 5)} - ${ultimo.fine.slice(0, 5)}` : '', ts, r }
    }).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [turni, punches, nomi, imp.margine_uscita_minuti])

  const conferma = async (id: string) => {
    const { error } = await supabase.rpc('timbrature_conferma', { p_id: id })
    if (error) toast({ type: 'error', message: error.message }); else { toast({ type: 'success', message: 'Uscita confermata.' }); void carica() }
  }
  const annulla = async (id: string) => {
    const motivo = window.prompt('Perché annulli questa timbratura? (resta nello storico)')
    if (!motivo?.trim()) return
    const { error } = await supabase.rpc('timbrature_annulla', { p_id: id, p_motivo: motivo.trim() })
    if (error) toast({ type: 'error', message: error.message }); else { toast({ type: 'success', message: 'Timbratura annullata.' }); void carica() }
  }
  const salvaTelefono = async (empId: string, valore: string) => {
    const pulito = valore.trim() || null
    const { error } = await supabase.from('employees').update({ telefono_whatsapp: pulito }).eq('id', empId)
    if (error) toast({ type: 'error', message: `Numero non salvato: ${error.message}` }); else toast({ type: 'success', message: 'Numero salvato.' })
  }
  const nuovoCodice = async (empId: string) => {
    const { error } = await supabase.rpc('app_accesso_nuovo_codice', { p_employee_id: empId })
    if (error) toast({ type: 'error', message: error.message }); else void carica()
  }
  const linkApp = (codice: string) => `${window.location.origin}/app?codice=${codice}`
  const copia = async (testo: string) => {
    try { await navigator.clipboard.writeText(testo); toast({ type: 'success', message: 'Copiato: incollalo nel messaggio al dipendente.' }) }
    catch { toast({ type: 'warning', message: testo }) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <input type="date" value={giorno} onChange={(e) => setGiorno(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <button onClick={() => void carica()} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
          <RefreshCw size={14} className={carico ? 'animate-spin' : ''} />Aggiorna
        </button>
      </div>

      {/* Impostazioni del negozio */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-slate-900">Timbrature del negozio</h3>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={imp.attive} onChange={(e) => void salvaImp({ ...imp, attive: e.target.checked })} />
            Timbrature attive
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={imp.avvisi_whatsapp} disabled={!imp.attive} onChange={(e) => void salvaImp({ ...imp, avvisi_whatsapp: e.target.checked })} />
            Avviso WhatsApp se l'uscita non è timbrata
          </label>
          <label className="flex items-center gap-2">
            Margine dopo la fine del turno
            <input type="number" min={0} max={240} value={imp.margine_uscita_minuti}
              onChange={(e) => setImp({ ...imp, margine_uscita_minuti: Number(e.target.value) })}
              onBlur={() => void salvaImp(imp)} className="w-16 border border-slate-300 rounded px-2 py-1" /> minuti
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Chi esce entro il margine non fa straordinario e non riceve l'avviso. Sul cellulare del negozio si apre <span className="font-mono">{window.location.origin}/timbra</span> con l'account di cassa.
        </p>
      </section>

      {/* Presenze del giorno */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-3 py-2">Persona</th><th className="text-left px-3 py-2">Turno</th>
              <th className="text-left px-3 py-2">Timbrature</th><th className="text-right px-3 py-2">Lavorate</th>
              <th className="text-right px-3 py-2">Pausa</th><th className="text-left px-3 py-2">Stato</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {righe.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Nessun turno e nessuna timbratura per questo giorno.</td></tr>
            )}
            {righe.map(({ emp, nome, turno, ts, r }) => (
              <tr key={emp} className="align-top">
                <td className="px-3 py-2 font-medium text-slate-900">{nome}</td>
                <td className="px-3 py-2 text-slate-600 tabular-nums">{turno || 'nessuno'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {ts.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-2">
                        <span className="tabular-nums">{ETICHETTA_TIPO[p.tipo]} {oraRoma(p.ora)}</span>
                        {ETICHETTA_VERIFICA[p.verifica] && <span className="text-xs px-1.5 rounded bg-amber-100 text-amber-800">{ETICHETTA_VERIFICA[p.verifica]}</span>}
                        {p.origine === 'dichiarata' && <span className="text-xs text-slate-500">segnata dal dipendente</span>}
                        {p.verifica === 'da_confermare' && <button onClick={() => void conferma(p.id)} className="text-xs text-blue-700 underline">Conferma</button>}
                        <button onClick={() => void annulla(p.id)} className="text-xs text-slate-400 hover:text-rose-600 underline">Annulla</button>
                      </div>
                    ))}
                    {ts.length === 0 && <span className="text-slate-400">nessuna</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.minutiLavorati ? formatMinuti(r.minutiLavorati) : ''}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.minutiPausa ? formatMinuti(r.minutiPausa) : ''}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1 items-start">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${COLORE_ESITO[r.esito]}`}>{ETICHETTA_ESITO[r.esito]}</span>
                    {r.minutiRitardo > 0 && <span className="text-xs text-amber-700">entrata {formatMinuti(r.minutiRitardo)} dopo il turno</span>}
                    {r.minutiOltreTurno > 0 && (
                      <span className={`text-xs ${r.straordinario ? 'text-rose-700 font-medium' : 'text-slate-500'}`}>
                        uscita {formatMinuti(r.minutiOltreTurno)} dopo il turno{r.straordinario ? ': straordinario da guardare' : ', entro il margine'}
                      </span>
                    )}
                    {avvisati.has(emp) && <span className="text-xs text-slate-500">avviso WhatsApp {avvisati.get(emp) === 'sent' ? 'mandato' : 'non partito'}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Accessi */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Smartphone size={16} />App del dipendente</h3>
        <p className="text-xs text-slate-500">
          Ogni persona riceve il suo codice quando viene inserita nel gestionale. Mandale il link: lo apre dal suo telefono e l'app resta attiva. Il numero serve per l'avviso WhatsApp.
        </p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {accessi.map((a) => (
              <tr key={a.employee_id}>
                <td className="py-2 pr-3 font-medium text-slate-900">{a.nome}</td>
                <td className="py-2 pr-3">
                  <input defaultValue={a.telefono_whatsapp ?? ''} placeholder="+39 333 1234567" onBlur={(e) => {
                    if ((e.target.value.trim() || null) !== (a.telefono_whatsapp ?? null)) void salvaTelefono(a.employee_id, e.target.value)
                  }} className="w-44 border border-slate-300 rounded px-2 py-1" />
                </td>
                <td className="py-2 pr-3 text-slate-600">
                  {a.codice ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono tracking-wider">{a.codice}</span>
                      <button onClick={() => void copia(linkApp(a.codice!))} className="flex items-center gap-1 text-blue-700 underline text-xs"><Copy size={12} />Copia link</button>
                      {a.codice_scade && <span className="text-xs text-slate-400">vale fino al {new Date(a.codice_scade).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}</span>}
                    </span>
                  ) : a.attivata_il ? (
                    <span className="text-emerald-700">App attiva dal {new Date(a.attivata_il).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}</span>
                  ) : <span className="text-slate-400">nessun codice</span>}
                </td>
                <td className="py-2 text-right">
                  <button onClick={() => void nuovoCodice(a.employee_id)} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 ml-auto">
                    <KeyRound size={12} />{a.attivata_il ? 'Telefono nuovo' : 'Codice nuovo'}
                  </button>
                </td>
              </tr>
            ))}
            {accessi.length === 0 && <tr><td className="py-4 text-slate-400">Nessuna persona in questo negozio.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
