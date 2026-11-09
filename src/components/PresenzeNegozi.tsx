// Dipendenti → Presenze (migration 348).
//
// Per chi segue il personale:
//   1. Presenze del giorno, negozio per negozio: turno, entrata, pausa,
//      uscita, ore lavorate, ritardo, uscita oltre il margine (straordinario
//      da guardare), uscita non timbrata. Le uscite segnate dal dipendente si
//      confermano qui; una timbratura sbagliata si annulla con il motivo.
//   2. Impostazioni del negozio: timbrature accese e avvisi sul telefono
//      (app New Zago, migration 367): ritardo in entrata (15 minuti di
//      default), uscita non timbrata (margine di 30 minuti, che vale anche per
//      lo straordinario), e chi li riceve: dipendente, responsabile del
//      negozio, ufficio. WhatsApp tolto il 05/11/2026.
//   3. Accessi: codice per attivare l'app e telefoni con le notifiche attive.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BellRing, Copy, KeyRound, RefreshCw, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOutlets } from '../hooks/useOutlets'
import { useToast } from './Toast'
import {
  ETICHETTA_ESITO, ETICHETTA_TIPO, MARGINE_USCITA_DEFAULT, TOLLERANZA_ENTRATA_DEFAULT, dataRoma, formatMinuti, oraRoma, oraRomaInMs, ordina,
  riepilogoGiorno, type EsitoGiorno, type TipoTimbratura,
} from '../lib/timbrature'

interface Impostazioni {
  attive: boolean; margine_uscita_minuti: number; tolleranza_entrata_minuti: number
  avvisi_push: boolean; ritardo_attivo: boolean; ritardo_minuti: number; uscita_attivo: boolean
  avvisa_dipendente: boolean; avvisa_responsabile: boolean; avvisa_ufficio: boolean
}
const IMP_DEFAULT: Impostazioni = {
  attive: false, margine_uscita_minuti: MARGINE_USCITA_DEFAULT, tolleranza_entrata_minuti: TOLLERANZA_ENTRATA_DEFAULT,
  avvisi_push: false, ritardo_attivo: true, ritardo_minuti: 15, uscita_attivo: true,
  avvisa_dipendente: true, avvisa_responsabile: true, avvisa_ufficio: false,
}
const ESITO_AVVISO: Record<string, string> = {
  mandato: 'arrivato sul telefono', nessun_telefono: 'non arrivato: app non installata', non_riuscito: 'non riuscito', nel_gestionale: 'nel gestionale',
}
interface Turno { id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null }
interface Punch {
  id: string; employee_id: string; tipo: TipoTimbratura; ora: string; origine: string; verifica: string; nota: string | null
}
interface Accesso {
  employee_id: string; nome: string; codice: string | null
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
  const [imp, setImp] = useState<Impostazioni>(IMP_DEFAULT)
  const [responsabile, setResponsabile] = useState<string | null>(null)
  const [conApp, setConApp] = useState<Map<string, string>>(new Map())
  const [turni, setTurni] = useState<Turno[]>([])
  const [punches, setPunches] = useState<Punch[]>([])
  const [avvisi, setAvvisi] = useState<{ employee_id: string; tipo: string; destinatario: string; esito: string }[]>([])
  const [nomi, setNomi] = useState<Map<string, string>>(new Map())
  const [accessi, setAccessi] = useState<Accesso[]>([])
  const [carico, setCarico] = useState(false)
  // Sul sito di un'azienda senza la migration 348 (Made) le tabelle non ci sono:
  // la scheda lo dice invece di riempirsi di errori.
  const [nonDisponibile, setNonDisponibile] = useState(false)

  // Riparte dall'ultimo negozio guardato (nessun negozio scritto nel codice)
  useEffect(() => {
    if (!outletId && outlets.length) {
      const ultimo = localStorage.getItem('nz-presenze-negozio')
      setOutletId((outlets.find((o) => o.id === ultimo) ?? outlets[0]).id)
    }
  }, [outlets, outletId])
  useEffect(() => { if (outletId) localStorage.setItem('nz-presenze-negozio', outletId) }, [outletId])

  const carica = useCallback(async () => {
    if (!outletId) return
    setCarico(true)
    try {
      const mese = `${giorno.slice(0, 7)}-01`
      const dal = new Date(oraRomaInMs(giorno, '00:00')).toISOString()
      const al = new Date(oraRomaInMs(giorno, '23:59') + 60_000).toISOString()
      const [sRes, pianoRes, tRes, pRes, nRes, aRes, eRes] = await Promise.all([
        supabase.from('attendance_settings').select('attive, margine_uscita_minuti, tolleranza_entrata_minuti, avvisi_push, ritardo_attivo, ritardo_minuti, uscita_attivo, avvisa_dipendente, avvisa_responsabile, avvisa_ufficio').eq('outlet_id', outletId).maybeSingle(),
        supabase.from('shift_plans').select('id').eq('outlet_id', outletId).eq('mese', mese).eq('stato', 'scelto').maybeSingle(),
        supabase.from('shifts').select('id, employee_id, data, inizio, fine, pausa_minuti, plan_id, stato, origine').eq('outlet_id', outletId).eq('data', giorno).neq('stato', 'annullato'),
        supabase.from('attendance_punches').select('id, employee_id, tipo, ora, origine, verifica, nota').eq('outlet_id', outletId).eq('annullata', false).gte('ora', dal).lt('ora', al),
        supabase.from('attendance_alerts').select('employee_id, tipo, destinatario, esito').eq('outlet_id', outletId).eq('data', giorno),
        supabase.rpc('app_accessi_elenco', { p_outlet_id: outletId }),
        supabase.from('employees').select('id, nome, cognome, first_name, last_name').eq('company_id', companyId),
      ])
      const manca = (e: { code?: string } | null) => !!e && ['PGRST205', '42P01', 'PGRST202', '42883', '42703'].includes(e.code ?? '')
      if (manca(sRes.error) || manca(aRes.error)) { setNonDisponibile(true); return }
      setImp(sRes.data ? { ...IMP_DEFAULT, ...(sRes.data as Partial<Impostazioni>) } : IMP_DEFAULT)
      const [refRes, pushRes] = await Promise.all([
        supabase.from('outlets').select('referente_employee_id').eq('id', outletId).maybeSingle(),
        supabase.rpc('app_push_stato', { p_outlet_id: outletId }),
      ])
      setResponsabile((refRes.data as { referente_employee_id: string | null } | null)?.referente_employee_id ?? null)
      setConApp(new Map(((pushRes.data ?? []) as { employee_id: string; piattaforme: string }[]).map((x) => [x.employee_id, x.piattaforme])))
      // Turni ufficiali: quelli del piano scelto del mese, altrimenti quelli
      // senza piano pubblicati o messi a mano (stessa regola della migration 348).
      const pianoId = (pianoRes.data as { id: string } | null)?.id ?? null
      const tutti = (tRes.data ?? []) as (Turno & { plan_id: string | null; stato: string; origine: string })[]
      setTurni(tutti.filter((t) => pianoId ? t.plan_id === pianoId : (t.plan_id === null && (t.stato === 'pubblicato' || t.origine === 'manuale'))))
      setPunches((pRes.data ?? []) as Punch[])
      setAvvisi((nRes.data ?? []) as { employee_id: string; tipo: string; destinatario: string; esito: string }[])
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
  // Tolleranza e margine uguali in tutti i negozi (il resto delle impostazioni non cambia)
  const regoleATutti = async () => {
    const ora = new Date().toISOString()
    const { error } = await supabase.from('attendance_settings').upsert(
      outlets.map((o) => ({ outlet_id: o.id, company_id: companyId, tolleranza_entrata_minuti: imp.tolleranza_entrata_minuti, margine_uscita_minuti: imp.margine_uscita_minuti, updated_at: ora })),
      { onConflict: 'outlet_id' })
    if (error) toast({ type: 'error', message: `Non salvate: ${error.message}` })
    else toast({ type: 'success', message: `Tolleranza ${imp.tolleranza_entrata_minuti}' e margine ${imp.margine_uscita_minuti}' in tutti i negozi.` })
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
  const nuovoCodice = async (empId: string) => {
    const { error } = await supabase.rpc('app_accesso_nuovo_codice', { p_employee_id: empId })
    if (error) toast({ type: 'error', message: error.message }); else void carica()
  }
  const linkApp = (codice: string) => `${window.location.origin}/app?codice=${codice}`
  const copia = async (testo: string) => {
    try { await navigator.clipboard.writeText(testo); toast({ type: 'success', message: 'Copiato: incollalo nel messaggio al dipendente.' }) }
    catch { toast({ type: 'warning', message: testo }) }
  }

  if (nonDisponibile) {
    return <p className="text-slate-500 py-12 text-center">Le timbrature non sono attive per questa azienda.</p>
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
      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <h3 className="font-semibold text-slate-900">Timbrature del negozio</h3>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={imp.attive} onChange={(e) => void salvaImp({ ...imp, attive: e.target.checked })} />
            Timbrature attive
          </label>
          <label className="flex items-center gap-2">
            Tolleranza all'entrata
            <input type="number" min={0} max={120} value={imp.tolleranza_entrata_minuti}
              onChange={(e) => setImp({ ...imp, tolleranza_entrata_minuti: Number(e.target.value) })}
              onBlur={() => void salvaImp(imp)} className="w-16 border border-slate-300 rounded px-2 py-1" /> minuti
          </label>
          <label className="flex items-center gap-2">
            Margine dopo la fine del turno
            <input type="number" min={0} max={240} value={imp.margine_uscita_minuti}
              onChange={(e) => setImp({ ...imp, margine_uscita_minuti: Number(e.target.value) })}
              onBlur={() => void salvaImp(imp)} className="w-16 border border-slate-300 rounded px-2 py-1" /> minuti
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Entro la tolleranza non è un ritardo; oltre, il permesso va a blocchi di 15 minuti per eccesso. Chi esce entro il margine non fa straordinario; oltre, conta la parte oltre il margine.
          Le eccezioni per persona sono in «Chi conferma e regole».{' '}
          <button type="button" onClick={() => void regoleATutti()} className="text-blue-700 underline">Usa tolleranza e margine per tutti i negozi</button>.
          Sul cellulare del negozio si apre <span className="font-mono">{window.location.origin}/timbra</span> con l'account di cassa.
        </p>

        <div className="border-t border-slate-100 pt-4 space-y-3">
          <h4 className="font-semibold text-slate-900 flex items-center gap-2"><BellRing size={15} />Avvisi sul telefono (app New Zago)</h4>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={imp.avvisi_push} disabled={!imp.attive} onChange={(e) => void salvaImp({ ...imp, avvisi_push: e.target.checked })} />
            Avvisi accesi per questo negozio
          </label>
          <div className={`grid gap-3 sm:grid-cols-2 text-sm ${imp.avvisi_push ? '' : 'opacity-50 pointer-events-none'}`}>
            <div className="border border-slate-200 rounded-lg p-3 space-y-2">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={imp.ritardo_attivo} onChange={(e) => void salvaImp({ ...imp, ritardo_attivo: e.target.checked })} />
                Ritardo in entrata
              </label>
              <label className="flex items-center gap-2 text-slate-600">
                dopo
                <input type="number" min={0} max={240} value={imp.ritardo_minuti}
                  onChange={(e) => setImp({ ...imp, ritardo_minuti: Number(e.target.value) })}
                  onBlur={() => void salvaImp(imp)} className="w-16 border border-slate-300 rounded px-2 py-1" />
                minuti dall'inizio del turno senza entrata
              </label>
            </div>
            <div className="border border-slate-200 rounded-lg p-3 space-y-2">
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={imp.uscita_attivo} onChange={(e) => void salvaImp({ ...imp, uscita_attivo: e.target.checked })} />
                Uscita non timbrata
              </label>
              <p className="text-slate-600">dopo {imp.margine_uscita_minuti} minuti dalla fine del turno (il margine qui sopra)</p>
            </div>
          </div>
          <div className={`flex flex-wrap gap-6 text-sm ${imp.avvisi_push ? '' : 'opacity-50 pointer-events-none'}`}>
            <span className="text-slate-500">Chi li riceve:</span>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={imp.avvisa_dipendente} onChange={(e) => void salvaImp({ ...imp, avvisa_dipendente: e.target.checked })} />
              il dipendente
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={imp.avvisa_responsabile} onChange={(e) => void salvaImp({ ...imp, avvisa_responsabile: e.target.checked })} />
              il responsabile del negozio{responsabile ? ` (${nomi.get(responsabile) ?? 'indicato in Outlet'})` : ' (non indicato: si sceglie in Outlet)'}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={imp.avvisa_ufficio} onChange={(e) => void salvaImp({ ...imp, avvisa_ufficio: e.target.checked })} />
              l'ufficio (notifica nel gestionale)
            </label>
          </div>
          <p className="text-xs text-slate-500">Ogni turno riceve al massimo un avviso di ritardo e uno di uscita. Gli avvisi arrivano a chi ha installato l'app New Zago e ha accettato le notifiche.</p>
        </div>
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
                    {avvisi.filter((a) => a.employee_id === emp && a.destinatario !== 'ufficio').map((a) => (
                      <span key={`${a.tipo}-${a.destinatario}`} className="text-xs text-slate-500">
                        avviso di {a.tipo === 'ritardo' ? 'ritardo' : 'uscita'} {a.destinatario === 'responsabile' ? 'al responsabile' : 'al dipendente'}: {ESITO_AVVISO[a.esito] ?? a.esito}
                      </span>
                    ))}
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
          Ogni persona riceve il suo codice quando viene inserita nel gestionale. Mandale il link: lo apre dal suo telefono e l'app resta attiva. Con l'app New Zago installata dagli store riceve anche gli avvisi.
        </p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {accessi.map((a) => (
              <tr key={a.employee_id}>
                <td className="py-2 pr-3 font-medium text-slate-900">{a.nome}</td>
                <td className="py-2 pr-3 text-xs">
                  {conApp.has(a.employee_id)
                    ? <span className="text-emerald-700">notifiche attive ({conApp.get(a.employee_id)})</span>
                    : <span className="text-slate-400">notifiche non attive</span>}
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
