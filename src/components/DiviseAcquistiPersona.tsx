// Divise e acquisti di una dipendente, vista della sede (Patrizio, 16/11/2026; migration 422).
// La vede solo chi gestisce divise e acquisti (elenco scelto dal Super Advisor) e il Super
// Advisor. Correggere il prezzo, segnare «scaricato in MODA» e «addebitato» non blocca niente:
// resta segnato chi e quando, e tutto finisce nel registro. Come si addebita è ancora da decidere.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, PackageCheck, Receipt, RefreshCw } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import {
  contatori, euro, leggiPrezzo, percento, prezzoCheVale, prezzoDaPagare, scontoEffettivo, valido, valoreSconto,
  type Capo, type Divisa,
} from '../lib/divise'
import { annullaCapo, caricaDivisePersona, correggiPrezzo, impostaScontiPersona, segnaCapi, type DatiPersonaDivise } from '../lib/diviseDb'
import ImpostazioniDivise from './ImpostazioniDivise'

const data = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '')
const dataBreve = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' }) : '')

const TESTO_AZIONE: Record<string, string> = {
  capo_registrato: 'ha registrato in negozio',
  divisa_aperta: 'ha aperto una divisa',
  scaricato: 'ha segnato come scaricato in MODA',
  scaricato_tolto: 'ha tolto il segno «scaricato in MODA»',
  addebitato: 'ha segnato come addebitato',
  addebitato_tolto: 'ha tolto il segno «addebitato»',
  prezzo_corretto: 'ha corretto il prezzo',
  sconti_persona: 'ha cambiato gli sconti personali',
  capo_annullato: 'ha annullato',
}

// tabella dei collegamenti dei referenti: non nei tipi generati
const db = supabase as unknown as SupabaseClient

/**
 * La persona è collegata a chi guarda (la sua scheda o un collegamento da referente)? Allora
 * le azioni non compaiono: nessuno sistema i propri capi né i propri sconti (lo controlla
 * anche il database, divise_non_proprio).
 */
async function eLaMiaScheda(employeeId: string): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser()
  const uid = u.user?.id
  if (!uid) return false
  const [e, r] = await Promise.all([
    db.from('employees').select('user_id').eq('id', employeeId).maybeSingle(),
    db.from('responsabile_dipendente').select('employee_id').eq('user_id', uid).eq('employee_id', employeeId).limit(1),
  ])
  return (e.data as { user_id: string | null } | null)?.user_id === uid || ((r.data as unknown[] | null)?.length ?? 0) > 0
}

export default function DiviseAcquistiPersona({ companyId, employeeId, nome, superAdvisor, negozi }: {
  companyId: string; employeeId: string; nome: string; superAdvisor: boolean; negozi: { id: string; name: string }[]
}) {
  const { toast } = useToast()
  const [dati, setDati] = useState<DatiPersonaDivise | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [scelti, setScelti] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [persone, setPersone] = useState<Map<string, string>>(new Map())
  const [correggi, setCorreggi] = useState<{ id: string; testo: string } | null>(null)
  const [sconti, setSconti] = useState<{ divise: string; acquisti: string } | null>(null)
  const [propria, setPropria] = useState(false)
  useEffect(() => { let vivo = true; eLaMiaScheda(employeeId).then((x) => { if (vivo) setPropria(x) }).catch(() => undefined); return () => { vivo = false } }, [employeeId])

  const carica = useCallback(async () => {
    try { setDati(await caricaDivisePersona(companyId, employeeId)); setErrore(null) } catch (e) {
      console.error('[divise] lettura', e); setErrore('Non riesco a leggere divise e acquisti: riprova fra poco.')
    }
  }, [companyId, employeeId])
  useEffect(() => { void carica() }, [carica])
  // i nomi di chi ha segnato o corretto
  useEffect(() => {
    supabase.from('user_profiles').select('id, first_name, last_name').eq('company_id', companyId).then(({ data: d }) => {
      setPersone(new Map(((d ?? []) as { id: string; first_name: string | null; last_name: string | null }[])
        .map((u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(' ') || 'qualcuno'])))
    })
  }, [companyId])

  const k = useMemo(() => (dati ? contatori(dati.capi, dati.divise) : null), [dati])
  const nomeNegozio = (id: string | null) => negozi.find((n) => n.id === id)?.name ?? ''
  const chi = (id: string | null) => (id ? persone.get(id) ?? 'qualcuno' : '')
  const primoNome = nome.split(' ')[0] || 'la dipendente'

  if (errore) return <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-rose-700">{errore}</div>
  if (!dati || !k) return <div className="bg-white border border-slate-200 rounded-xl p-6 flex justify-center"><RefreshCw className="animate-spin text-blue-600" size={20} /></div>

  const azione = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast({ type: 'success', message: ok }); setScelti(new Set()); await carica() } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
    } finally { setBusy(false) }
  }
  const segna = (cosa: 'scaricato' | 'addebitato', valore: boolean, ids = [...scelti]) => void azione(
    () => segnaCapi(ids, cosa, valore),
    valore ? (cosa === 'scaricato' ? 'Segnati come scaricati in MODA' : 'Segnati come addebitati') : 'Segno tolto',
  )
  const salvaPrezzo = () => {
    if (!correggi) return
    const p = correggi.testo.trim() === '' ? null : leggiPrezzo(correggi.testo)
    if (correggi.testo.trim() !== '' && p == null) { toast({ type: 'error', message: 'Scrivi un prezzo, per esempio 45 oppure 49,90.' }); return }
    const id = correggi.id
    setCorreggi(null)
    void azione(() => correggiPrezzo(id, p), p == null ? 'Torna il prezzo scritto in negozio' : 'Prezzo corretto')
  }
  const salvaSconti = (tornaStandard?: 'divise' | 'acquisti') => {
    if (!sconti && !tornaStandard) return
    const leggi = (t: string) => { const n = t.trim() === '' ? null : Number(t.replace(',', '.')); return n }
    let d = sconti ? leggi(sconti.divise) : dati.sconti.divise
    let a = sconti ? leggi(sconti.acquisti) : dati.sconti.acquisti
    if (tornaStandard === 'divise') d = null
    if (tornaStandard === 'acquisti') a = null
    if ((d != null && (Number.isNaN(d) || d < 0 || d > 100)) || (a != null && (Number.isNaN(a) || a < 0 || a > 100))) {
      toast({ type: 'error', message: 'Lo sconto va da 0 a 100.' }); return
    }
    setSconti(null)
    void azione(() => impostaScontiPersona(employeeId, d, a), 'Sconti salvati: valgono per i capi presi da adesso')
  }
  const annulla = (c: Capo) => {
    // un capo gia' addebitato o scaricato: l'annullamento non storna niente, va sistemato a parte (revisore sicurezza)
    const gia = [c.addebitato_il ? 'è già stato addebitato: l\'addebito fatto va restituito a parte' : '', c.scaricato_il ? 'è già stato scaricato in MODA: va ricaricato a parte' : ''].filter(Boolean)
    const avviso = gia.length ? `\n\nAttenzione: questo capo ${gia.join(' e ')}.` : ''
    const motivo = window.prompt(`Annulla il capo ${c.codice}: scrivi il motivo (per esempio «letto due volte per sbaglio»). Il capo resta nello storico, barrato, e non conta più. Non si può togliere l'annullamento.${avviso}`)
    if (motivo == null) return
    if (motivo.trim().length < 3) { toast({ type: 'error', message: 'Scrivi il motivo (almeno 3 caratteri).' }); return }
    void azione(() => annullaCapo(c.id, motivo.trim()), 'Capo annullato')
  }

  const gruppi: { titolo: React.ReactNode; capi: Capo[] }[] = [
    ...dati.divise.map((d: Divisa) => {
      const capi = dati.capi.filter((c) => c.divisa_id === d.id)
      const validi = capi.filter(valido)
      const valore = validi.reduce((s, c) => s + (prezzoCheVale(c) ?? 0), 0)
      return {
        titolo: <>
          <b>Divisa {d.numero}</b>{' '}
          <span className={`text-xs px-2 py-0.5 rounded-full ${d.tipo === 'fornita' ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'}`}>{d.tipo === 'fornita' ? 'fornita dall’azienda' : 'con sconto'}</span>
          <span className="text-slate-500"> · aperta il {data(d.aperta_il)}{nomeNegozio(d.outlet_id) ? ` · ${nomeNegozio(d.outlet_id)}` : ''} · {validi.length} {validi.length === 1 ? 'capo' : 'capi'}{validi.length < capi.length ? ` (più ${capi.length - validi.length} annullat${capi.length - validi.length === 1 ? 'o' : 'i'})` : ''}{valore ? ` · valore ${euro(valore)}` : ''}</span>
        </>,
        capi,
      }
    }),
    ...(dati.capi.some((c) => c.voce === 'acquisto') ? [{
      titolo: <><b>Acquisti personali</b> <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">per sé, non divisa</span></>,
      capi: dati.capi.filter((c) => c.voce === 'acquisto'),
    }] : []),
  ]
  const tutti = dati.capi.filter(valido).map((c) => c.id)
  const scontoRiquadro = (q: 'divise' | 'acquisti', titolo: string) => {
    const personale = dati.sconti[q]
    const standard = dati.standard[q]
    return (
      <div className="flex-1 min-w-[240px] border border-slate-200 rounded-xl p-3">
        <p className="text-xs text-slate-500">{titolo}</p>
        {sconti ? (
          <label className="flex items-center gap-2 mt-1">
            <input type="text" inputMode="decimal" value={sconti[q]} onChange={(e) => setSconti({ ...sconti, [q]: e.target.value })}
              placeholder={`standard ${standard}`} aria-label={titolo}
              className="w-24 px-2 py-1 rounded-lg border border-slate-300 text-lg font-semibold" /> <span className="text-slate-500">%</span>
          </label>
        ) : (
          <p className="text-2xl font-semibold text-slate-900">{percento(scontoEffettivo(personale, standard))}</p>
        )}
        <p className="text-xs mt-1">
          {personale != null
            ? <><span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">personale</span> <span className="text-slate-500">lo standard dell’azienda è {percento(standard)}</span>
              {!sconti && !propria && <button type="button" onClick={() => salvaSconti(q)} disabled={busy} className="ml-2 text-blue-600 hover:underline">Torna allo standard</button>}</>
            : <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">standard dell’azienda</span>}
        </p>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap gap-3">
          {scontoRiquadro('divise', 'Sconto divise')}
          {scontoRiquadro('acquisti', 'Sconto acquisti personali')}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {propria ? null : sconti ? (
            <>
              <button type="button" onClick={() => salvaSconti()} disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium">Salva gli sconti</button>
              <button type="button" onClick={() => setSconti(null)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm">Annulla</button>
              <span className="text-xs text-slate-500">Vuoto = vale lo standard dell’azienda.</span>
            </>
          ) : (
            <button type="button" onClick={() => setSconti({ divise: dati.sconti.divise?.toString() ?? '', acquisti: dati.sconti.acquisti?.toString() ?? '' })}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-blue-600 hover:bg-blue-50">Cambia gli sconti</button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2">Gli sconti si decidono qui e valgono per i capi presi da adesso: quelli già presi tengono lo sconto del giorno in cui sono stati registrati. Sul telefono del negozio non si vedono; {primoNome} li vede nella sua app, con quanto paga ogni capo.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { t: 'Divise fornite dall’azienda', v: String(k.diviseFornite), s: `${k.capiForniti} ${k.capiForniti === 1 ? 'capo' : 'capi'}` },
          { t: 'Divise con sconto', v: String(k.diviseSconto), s: `${k.capiSconto} ${k.capiSconto === 1 ? 'capo' : 'capi'}` },
          { t: 'Acquisti personali', v: `${k.acquisti} ${k.acquisti === 1 ? 'capo' : 'capi'}` },
          { t: 'Da scaricare in MODA', v: `${k.daScaricare} ${k.daScaricare === 1 ? 'capo' : 'capi'}`, tono: k.daScaricare ? 'text-amber-700' : '' },
          { t: 'Da addebitare', v: euro(k.importoDaAddebitare), s: `${k.daAddebitare} ${k.daAddebitare === 1 ? 'capo' : 'capi'}`, tono: k.daAddebitare ? 'text-rose-700' : '' },
        ].map((x) => (
          <div key={x.t} className="bg-white border border-slate-200 rounded-xl p-3">
            <p className="text-xs text-slate-500">{x.t}</p>
            <p className={`text-xl font-semibold ${x.tono ?? 'text-slate-900'}`}>{x.v}</p>
            {x.s && <p className="text-xs text-slate-500">{x.s}</p>}
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        {propria && (
          <p className="px-4 py-2 text-sm bg-amber-50 text-amber-900 border-b border-amber-200 rounded-t-xl">Le tue divise e i tuoi acquisti li sistema un’altra persona: qui puoi solo guardarli.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
          <p className="text-sm text-slate-600">{scelti.size ? `${scelti.size} ${scelti.size === 1 ? 'capo selezionato' : 'capi selezionati'}` : `${tutti.length} ${tutti.length === 1 ? 'capo' : 'capi'} in tutto`}</p>
          {!propria && <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!scelti.size || busy} onClick={() => segna('scaricato', true)}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1"><PackageCheck size={15} /> Segna come scaricati in MODA</button>
            <button type="button" disabled={!scelti.size || busy} onClick={() => segna('addebitato', true)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium disabled:opacity-40 inline-flex items-center gap-1"><Receipt size={15} /> Segna come addebitati</button>
          </div>}
        </div>
        {dati.capi.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">Nessun capo registrato. Divise e acquisti si registrano dal telefono del negozio: la dipendente avvicina il suo QR dopo l’entrata, tocca «Divise e acquisti» e legge i cartellini.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
                  <th className="px-3 py-2">{!propria && <input type="checkbox" aria-label="Seleziona tutti" checked={scelti.size === tutti.length && tutti.length > 0}
                    onChange={(e) => setScelti(e.target.checked ? new Set(tutti) : new Set())} />}</th>
                  <th className="px-3 py-2">Data</th><th className="px-3 py-2">Codice a barre</th>
                  <th className="px-3 py-2 text-right">Prezzo outlet</th><th className="px-3 py-2 text-right">Sconto</th>
                  <th className="px-3 py-2 text-right">Valore sconto</th><th className="px-3 py-2 text-right">Prezzo</th>
                  <th className="px-3 py-2">In MODA</th><th className="px-3 py-2">Addebito</th>
                </tr>
              </thead>
              <tbody>
                {gruppi.map((g, i) => (
                  <GruppoCapi key={i} titolo={g.titolo} capi={g.capi} scelti={scelti} setScelti={setScelti} primoNome={primoNome} chi={chi}
                    correggi={correggi} setCorreggi={setCorreggi} salvaPrezzo={salvaPrezzo} busy={busy} propria={propria} annulla={annulla}
                    togli={(c, cosa) => { if (window.confirm(cosa === 'scaricato' ? 'Togli il segno «scaricato in MODA» da questo capo?' : 'Togli il segno «addebitato» da questo capo?')) segna(cosa, false, [c.id]) }} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Come si addebita</p>
          <p className="mt-1">Da decidere con la sede: trattenuta in busta paga, pagamento in cassa o altro. Per ora «Segna come addebitati» registra solo che l’addebito è fatto, con la data e chi l’ha segnato. Le divise fornite dall’azienda non si addebitano.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p className="font-semibold text-slate-900">Registro</p>
          {dati.registro.length === 0 ? <p className="text-slate-500 mt-1">Ancora niente.</p> : (
            <ul className="mt-1 space-y-0.5 text-slate-600 max-h-48 overflow-y-auto">
              {dati.registro.map((r) => {
                const cod = typeof r.dettaglio?.codice === 'string' ? ` ${r.dettaglio.codice}` : ''
                const prezzo = r.azione === 'prezzo_corretto' ? `: da ${euro(num(r.dettaglio.prima) ?? num(r.dettaglio.prezzo_outlet))} a ${euro(num(r.dettaglio.dopo) ?? num(r.dettaglio.prezzo_outlet))}` : ''
                const motivo = r.azione === 'capo_annullato' && typeof r.dettaglio?.motivo === 'string' ? `: «${r.dettaglio.motivo}»` : ''
                const chiFa = r.azione === 'capo_registrato' || r.azione === 'divisa_aperta' ? `${primoNome} (telefono del negozio)` : (r.utente_nome || 'qualcuno')
                return <li key={r.id}>{dataBreve(r.creato_il)} · {chiFa} {TESTO_AZIONE[r.azione] ?? r.azione}{cod}{prezzo}{motivo}</li>
              })}
            </ul>
          )}
          <p className="text-xs text-slate-400 mt-2">Il registro non si modifica.</p>
        </div>
      </div>

      {superAdvisor && <ImpostazioniDivise companyId={companyId} />}
    </section>
  )
}

const num = (v: unknown): number | null => (v == null ? null : Number(v))

function GruppoCapi({ titolo, capi, scelti, setScelti, primoNome, chi, correggi, setCorreggi, salvaPrezzo, busy, togli, propria, annulla }: {
  titolo: React.ReactNode; capi: Capo[]; scelti: Set<string>; setScelti: (s: Set<string>) => void; primoNome: string
  chi: (id: string | null) => string; correggi: { id: string; testo: string } | null; setCorreggi: (c: { id: string; testo: string } | null) => void
  salvaPrezzo: () => void; busy: boolean; togli: (c: Capo, cosa: 'scaricato' | 'addebitato') => void
  propria: boolean; annulla: (c: Capo) => void
}) {
  const cambia = (id: string, si: boolean) => { const n = new Set(scelti); if (si) n.add(id); else n.delete(id); setScelti(n) }
  return (
    <>
      <tr className="bg-slate-50/60 border-t border-slate-200"><td colSpan={9} className="px-3 py-2 text-sm">{titolo}</td></tr>
      {capi.map((c) => c.annullato_il ? (
        // annullato: resta nello storico, barrato, con il motivo; non conta più e non ha azioni
        <tr key={c.id} className="border-t border-slate-100 text-slate-400">
          <td className="px-3 py-2" />
          <td className="px-3 py-2 whitespace-nowrap line-through">{data(c.registrato_il)}</td>
          <td className="px-3 py-2 font-mono text-xs line-through">{c.codice}</td>
          <td className="px-3 py-2 text-right line-through">{euro(prezzoCheVale(c))}</td>
          <td colSpan={5} className="px-3 py-2 text-xs">
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">annullato</span>{' '}
            il {dataBreve(c.annullato_il)} da {chi(c.annullato_da ?? null)}: «{c.annullato_motivo}»
          </td>
        </tr>
      ) : (
        <tr key={c.id} className={`border-t border-slate-100 ${scelti.has(c.id) ? 'bg-blue-50/40' : ''}`}>
          <td className="px-3 py-2">{!propria && <input type="checkbox" aria-label={`Seleziona ${c.codice}`} checked={scelti.has(c.id)} onChange={(e) => cambia(c.id, e.target.checked)} />}</td>
          <td className="px-3 py-2 whitespace-nowrap">{data(c.registrato_il)}</td>
          <td className="px-3 py-2 font-mono text-xs">{c.codice}</td>
          <td className="px-3 py-2 text-right whitespace-nowrap">
            {correggi?.id === c.id ? (
              <span className="inline-flex items-center gap-1">
                <input autoFocus type="text" inputMode="decimal" value={correggi.testo} onChange={(e) => setCorreggi({ id: c.id, testo: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') salvaPrezzo(); if (e.key === 'Escape') setCorreggi(null) }}
                  aria-label="Prezzo corretto" placeholder="vuoto = quello scritto" className="w-24 px-2 py-1 rounded border border-slate-300 text-right" />
                <button type="button" onClick={salvaPrezzo} disabled={busy} aria-label="Salva il prezzo" className="p-1 rounded text-emerald-700 hover:bg-emerald-50"><Check size={15} /></button>
              </span>
            ) : (
              <>
                <span>{euro(prezzoCheVale(c))}</span>
                <span className="block text-xs text-slate-500">
                  {c.prezzo_corretto != null
                    ? <span className="text-amber-700">corretto da {chi(c.corretto_da)} il {dataBreve(c.corretto_il)} ({primoNome} aveva scritto {euro(c.prezzo_outlet)})</span>
                    : c.prezzo_outlet != null ? `scritto da ${primoNome}` : 'non scritto'}
                  {!propria && <>{' '}<button type="button" onClick={() => setCorreggi({ id: c.id, testo: c.prezzo_corretto?.toString().replace('.', ',') ?? '' })} className="text-blue-600 hover:underline">correggi</button>
                    {' · '}<button type="button" onClick={() => annulla(c)} disabled={busy} className="text-rose-600 hover:underline">annulla</button></>}
                </span>
              </>
            )}
          </td>
          <td className="px-3 py-2 text-right">{c.voce === 'divisa_fornita' ? '·' : percento(c.sconto_pct)}</td>
          <td className="px-3 py-2 text-right">{c.voce === 'divisa_fornita' ? '·' : euro(valoreSconto(c))}</td>
          <td className="px-3 py-2 text-right font-semibold">{euro(prezzoDaPagare(c))}</td>
          <td className="px-3 py-2">
            {c.scaricato_il
              ? <button type="button" disabled={propria} onClick={() => togli(c, 'scaricato')} title={propria ? undefined : 'Tocca per togliere il segno'} className="text-left"><span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">scaricato</span><span className="block text-xs text-slate-500">{dataBreve(c.scaricato_il)} · {chi(c.scaricato_da)}</span></button>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">da scaricare</span>}
          </td>
          <td className="px-3 py-2">
            {c.voce === 'divisa_fornita' ? <span className="text-xs text-slate-500">non si addebita</span>
              : c.addebitato_il
                ? <button type="button" disabled={propria} onClick={() => togli(c, 'addebitato')} title={propria ? undefined : 'Tocca per togliere il segno'} className="text-left"><span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">addebitato</span><span className="block text-xs text-slate-500">{dataBreve(c.addebitato_il)} · {chi(c.addebitato_da)}</span></button>
                : <span className="text-xs px-2 py-0.5 rounded-full bg-rose-50 text-rose-700">da addebitare</span>}
          </td>
        </tr>
      ))}
    </>
  )
}

