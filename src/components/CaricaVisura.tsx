// Carica la visura camerale in Impostazioni → «Dati azienda».
//
// Regola fissa dei caricamenti (CLAUDE.md, 08/10/2026): il file si salva e si
// legge da solo; si chiede conferma solo se un dato già scritto a mano
// verrebbe sostituito; alla fine si dice che è finito.
// In più (Patrizio, 24/11/2026): una visura con una P.IVA diversa da quella di
// questa azienda si ferma subito e non scrive niente, nemmeno l'archivio.
import { useRef, useState } from 'react'
import { Upload, Loader, CheckCircle2, AlertTriangle, Ban } from 'lucide-react'
import { archiviaFile, periodoDalNomeFile } from '../lib/archivioFile'
import {
  confrontaScheda, confrontaSedi, valoriDaVisura, ETICHETTE_SEDE,
  type CampoScheda, type CampoSede, type Differenza, type DifferenzaSede,
  type OutletSede, type SchedaAzienda, type Socio, type VisuraLetta,
} from '../lib/visura'
import { leggiVisura, scriviSchedaDaVisura, scriviSedeDaVisura, VisuraError } from '../lib/visuraDb'

export type OutletConNote = OutletSede & { notes: string | null }

type Props = {
  companyId: string
  userId: string | null
  settingsId: string | null
  scheda: SchedaAzienda | null
  azienda: { partitaIva: string | null; nome: string | null }
  outlets: OutletConNote[]
  onAggiornato: () => void
}

type Stato =
  | { fase: 'pronto' }
  | { fase: 'lavoro'; messaggio: string }
  | { fase: 'bloccato'; motivo: string }
  | { fase: 'errore'; motivo: string }
  | { fase: 'conferma'; scheda: Differenza[]; sedi: DifferenzaSede[] }
  | { fase: 'finito' }

type Resoconto = {
  nomeFile: string
  dataVisura: string | null
  campiScritti: string[]
  sediScritte: string[]
  lasciati: number
  archivio: string | null
  daSapere: string[]
}

const dataIt = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '')

export default function CaricaVisura(p: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [stato, setStato] = useState<Stato>({ fase: 'pronto' })
  const [trascina, setTrascina] = useState(false)
  const [scelti, setScelti] = useState<Set<string>>(new Set())
  const [resoconto, setResoconto] = useState<Resoconto | null>(null)
  // Stato del lavoro in corso, che serve anche alla seconda scrittura (conferme).
  const lavoro = useRef<{ letta: VisuraLetta; provenienza: Record<string, string>; settingsId: string | null; documentoId: string | null } | null>(null)

  const occupato = stato.fase === 'lavoro'

  const scriviSedi = async (gruppi: Map<string, Partial<Record<CampoSede, string>>>, dataVisura: string | null) => {
    const fatte: string[] = []
    for (const [outletId, patch] of gruppi) {
      const o = p.outlets.find((x) => x.id === outletId)
      await scriviSedeDaVisura(outletId, patch, o?.notes ?? null, dataVisura)
      fatte.push(o?.name || o?.code || outletId)
    }
    return fatte
  }

  const avvia = async (file: File) => {
    setResoconto(null)
    setScelti(new Set())
    try {
      setStato({ fase: 'lavoro', messaggio: 'Leggo la visura…' })
      const letta = await leggiVisura(file)

      const esito = confrontaScheda(p.scheda, letta, p.azienda)
      if (esito.blocco) { setStato({ fase: 'bloccato', motivo: esito.blocco }); return }
      const sedi = confrontaSedi(p.outlets, letta.unitaLocali, letta.dataEstrazione)

      setStato({ fase: 'lavoro', messaggio: 'Salvo la visura in archivio…' })
      const periodo = periodoDalNomeFile(file.name)
      const arch = await archiviaFile({
        file, companyId: p.companyId, userId: p.userId, modulo: 'Azienda',
        funzione: 'Visura camerale', year: periodo?.year ?? null, month: periodo?.month ?? null,
        referenceTable: 'company_settings', referenceId: p.settingsId,
        note: letta.dataEstrazione ? `Estratta dal Registro Imprese il ${dataIt(letta.dataEstrazione)}` : null,
      })

      setStato({ fase: 'lavoro', messaggio: 'Aggiorno la scheda…' })
      const provenienza = { ...(p.scheda?.campi_da_visura || {}) }
      const automatici = esito.automatici
      const settingsId = await scriviSchedaDaVisura({
        companyId: p.companyId, settingsId: p.settingsId, campi: automatici,
        campiDaVisura: provenienza, dataVisura: letta.dataEstrazione, documentoId: arch.id,
      })
      for (const k of Object.keys(automatici)) provenienza[k] = letta.dataEstrazione || ''

      const gruppi = new Map<string, Partial<Record<CampoSede, string>>>()
      for (const a of sedi.automatici) gruppi.set(a.outletId, a.patch)
      const sediScritte = await scriviSedi(gruppi, letta.dataEstrazione)

      const daSapere: string[] = []
      if (sedi.nonNelGestionale.length) {
        daSapere.push(`In visura ci sono unità locali senza un negozio nel gestionale: ${sedi.nonNelGestionale
          .map((u) => `${u.tipo ? `${u.tipo.toLowerCase()} ` : ''}${u.comune}${u.indirizzo ? `, ${u.indirizzo}` : ''}`).join('; ')}. Se non esistono più vanno chiuse in Camera di Commercio.`)
      }
      if (sedi.nonInVisura.length) {
        daSapere.push(`Negozi attivi che la visura non riporta: ${sedi.nonInVisura.map((o) => o.name || o.code).join(', ')}.`)
      }

      // La scheda è stata creata adesso: l'id serve alla seconda scrittura.
      lavoro.current = { letta, provenienza, settingsId, documentoId: arch.id }
      setResoconto({
        nomeFile: file.name,
        dataVisura: letta.dataEstrazione,
        campiScritti: Object.keys(automatici),
        sediScritte,
        lasciati: 0,
        archivio: arch.errore ? `La visura non è stata archiviata (${arch.errore}), i dati sono stati scritti lo stesso.` : null,
        daSapere,
      })

      if (esito.daConfermare.length || sedi.daConfermare.length) {
        setScelti(new Set([
          ...esito.daConfermare.map((d) => `s:${d.campo}`),
          ...sedi.daConfermare.map((d) => `o:${d.outletId}:${d.campo}`),
        ]))
        setStato({ fase: 'conferma', scheda: esito.daConfermare, sedi: sedi.daConfermare })
      } else {
        setStato({ fase: 'finito' })
      }
      p.onAggiornato()
    } catch (e) {
      setStato({ fase: 'errore', motivo: e instanceof VisuraError ? e.message : (e as Error)?.message || 'Errore imprevisto' })
      // Una parte può essere già stata scritta: la pagina mostra lo stato vero.
      p.onAggiornato()
    }
  }

  const conferma = async (applica: boolean) => {
    if (stato.fase !== 'conferma' || !lavoro.current) return
    const { letta, provenienza, documentoId } = lavoro.current
    const totale = stato.scheda.length + stato.sedi.length
    if (!applica) {
      setResoconto((r) => (r ? { ...r, lasciati: totale } : r))
      setStato({ fase: 'finito' })
      return
    }
    try {
      setStato({ fase: 'lavoro', messaggio: 'Sostituisco i dati scelti…' })
      const valori = valoriDaVisura(letta)
      const campi: Partial<Record<CampoScheda, string | Socio[]>> = {}
      for (const d of stato.scheda) if (scelti.has(`s:${d.campo}`)) campi[d.campo] = valori[d.campo] as string | Socio[]
      if (Object.keys(campi).length) {
        await scriviSchedaDaVisura({
          companyId: p.companyId, settingsId: lavoro.current.settingsId ?? p.settingsId, campi,
          campiDaVisura: provenienza, dataVisura: letta.dataEstrazione, documentoId,
        })
      }
      const gruppi = new Map<string, Partial<Record<CampoSede, string>>>()
      for (const d of stato.sedi) {
        if (!scelti.has(`o:${d.outletId}:${d.campo}`)) continue
        gruppi.set(d.outletId, { ...(gruppi.get(d.outletId) || {}), [d.campo]: d.nuovo })
      }
      const sedi = await scriviSedi(gruppi, letta.dataEstrazione)
      const scelte = Object.keys(campi).length + [...gruppi.values()].reduce((n, g) => n + Object.keys(g).length, 0)
      setResoconto((r) => (r ? {
        ...r,
        campiScritti: [...r.campiScritti, ...Object.keys(campi)],
        sediScritte: [...new Set([...r.sediScritte, ...sedi])],
        lasciati: totale - scelte,
      } : r))
      setStato({ fase: 'finito' })
      p.onAggiornato()
    } catch (e) {
      setStato({ fase: 'errore', motivo: (e as Error)?.message || 'Errore imprevisto' })
      p.onAggiornato()
    }
  }

  const alterna = (k: string) => setScelti((s) => {
    const n = new Set(s)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!occupato) setTrascina(true) }}
        onDragLeave={() => setTrascina(false)}
        onDrop={(e) => {
          e.preventDefault(); setTrascina(false)
          const f = e.dataTransfer.files?.[0]
          if (f && !occupato) void avvia(f)
        }}
        onClick={() => !occupato && input.current?.click()}
        className={`border-2 border-dashed rounded-xl px-4 py-5 text-center cursor-pointer transition-colors ${
          trascina ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
        } ${occupato ? 'opacity-60 cursor-wait' : ''}`}
      >
        <input
          ref={input} type="file" accept="application/pdf,.pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void avvia(f) }}
        />
        {occupato ? (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader size={16} className="animate-spin" /> {stato.messaggio}
          </div>
        ) : (
          <div className="text-sm text-slate-600">
            <Upload size={18} className="mx-auto mb-1 text-slate-400" />
            <span className="font-medium text-slate-800">Carica la visura camerale</span> (PDF, anche scansionato): trascinala qui o clicca.
            <div className="text-xs text-slate-400 mt-1">Riempio da solo i dati che mancano; se un dato scritto a mano è diverso ti chiedo prima di cambiarlo.</div>
          </div>
        )}
      </div>

      {stato.fase === 'bloccato' && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          <Ban size={16} className="mt-0.5 shrink-0" />
          <div><strong>Visura di un'altra società.</strong> {stato.motivo}</div>
        </div>
      )}

      {stato.fase === 'errore' && (
        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div><strong>La visura non è stata caricata fino in fondo.</strong> {stato.motivo} I dati sotto sono quelli salvati adesso.</div>
        </div>
      )}

      {stato.fase === 'conferma' && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm space-y-2">
          <div className="font-medium text-amber-900">
            Questi dati sono già scritti e la visura dice altro. Sostituisco quelli spuntati?
          </div>
          <ul className="space-y-1">
            {stato.scheda.map((d) => (
              <li key={`s:${d.campo}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={scelti.has(`s:${d.campo}`)} onChange={() => alterna(`s:${d.campo}`)} />
                  <span><strong>{d.etichetta}</strong>: <span className="line-through text-slate-500">{d.attuale}</span> → {d.nuovo}</span>
                </label>
              </li>
            ))}
            {stato.sedi.map((d) => (
              <li key={`o:${d.outletId}:${d.campo}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={scelti.has(`o:${d.outletId}:${d.campo}`)} onChange={() => alterna(`o:${d.outletId}:${d.campo}`)} />
                  <span><strong>{d.negozio}, {ETICHETTE_SEDE[d.campo]}</strong>: <span className="line-through text-slate-500">{d.attuale}</span> → {d.nuovo}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <button onClick={() => void conferma(true)} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              Sostituisci quelli spuntati
            </button>
            <button onClick={() => void conferma(false)} className="px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-white">
              Lascia tutto com'è
            </button>
          </div>
        </div>
      )}

      {stato.fase === 'finito' && resoconto && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-900 space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={16} /> Finito, tutti i dati sono aggiornati.
          </div>
          <div>
            {resoconto.nomeFile}{resoconto.dataVisura ? `, estratta il ${dataIt(resoconto.dataVisura)}` : ''}:{' '}
            {resoconto.campiScritti.length
              ? `${resoconto.campiScritti.length} dati della scheda scritti`
              : 'la scheda era già allineata'}
            {resoconto.sediScritte.length ? `; sedi aggiornate: ${resoconto.sediScritte.join(', ')}` : ''}
            {resoconto.lasciati ? `; ${resoconto.lasciati} dati lasciati come erano, per tua scelta` : ''}.
          </div>
          {resoconto.archivio && <div className="text-amber-800">{resoconto.archivio}</div>}
          {resoconto.daSapere.map((t) => <div key={t} className="text-slate-600">{t}</div>)}
        </div>
      )}
    </div>
  )
}
