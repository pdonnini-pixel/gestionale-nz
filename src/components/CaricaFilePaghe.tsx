// Zona unica per i file dello studio paghe (Dipendenti, in alto).
//
// Ogni mese lo studio manda gli stessi documenti: Elenco netti, Netti negativi,
// Prospetto riepilogativo; ogni tanto la Statistica costo orario e i ratei ferie.
// Si trascinano tutti insieme: il gestionale riconosce cosa sono
// (src/lib/payrollParse.ts, riconosciFilePaghe) e li porta fino in fondo da
// solo, uno alla volta, nel flusso di sempre (Elenco netti → ImportLane,
// Prospetto → CostiLordoTab).
//
// Regola fissa (08/10/2026, Patrizio): un caricamento arriva in fondo da solo e
// dice che e' finito. Si chiede una conferma solo quando il file SOSTITUIREBBE
// dati gia' presenti per quel mese, o quando i totali non tornano. Il 08/10
// Sabrina si era fermata al vecchio «Apri e controlla» e settembre non era mai
// stato salvato, senza che niente glielo dicesse.
//
// Il flusso che salva risponde con l'evento `paghe-esito` (segnalaEsitoPaghe).

import { useEffect, useRef, useState } from 'react'
import { FileUp, Loader2, Check, AlertTriangle, ArrowRight, Info, CheckCircle2 } from 'lucide-react'
import { riconosciFilePaghe, type FilePagheRiconosciuto, type FilePaghe } from '../lib/payrollParse'
import { archiviaFile } from '../lib/archivioFile'

export type FileInArrivo = {
  nonce: number
  dest: 'netti' | 'prospetto'
  file: File
  year: number | null
  month: number | null
  tipoCedolino: string | null
}

/** Come e' finito il salvataggio di un file passato dalla zona. */
export type EsitoPaghe = { nonce: number; stato: 'salvato' | 'da_confermare' | 'errore'; testo: string }

const EVENTO = 'paghe-esito'

/** Chiamata dal flusso che salva (ImportLane, CostiLordoTab) per dire alla zona com'e' andata. */
export function segnalaEsitoPaghe(e: EsitoPaghe): void {
  window.dispatchEvent(new CustomEvent<EsitoPaghe>(EVENTO, { detail: e }))
}

type Voce = {
  id: number
  file: File
  r: FilePagheRiconosciuto | null
  stato: 'lettura' | 'pronto' | 'in_corso' | 'salvato' | 'da_confermare' | 'archiviato' | 'errore'
  nota?: string
  nonce?: number
}

// Un file che non risponde entro questo tempo e' rimasto a meta' (pagina
// cambiata, errore non gestito): si dice, invece di restare in attesa per sempre.
const ATTESA_MAX_MS = 180_000

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const CEDOLINO: Record<string, string> = {
  normale: 'mensilità normale', tredicesima: 'tredicesima', quattordicesima: 'quattordicesima', aggiuntivo: 'cedolino aggiuntivo',
}
const NOME: Record<FilePaghe, string> = {
  elenco_netti: 'Elenco netti',
  netti_negativi: 'Netti negativi',
  prospetto: 'Prospetto riepilogativo',
  statistica: 'Statistica costo orario',
  ratei_ferie: 'Ratei ferie e permessi',
  sconosciuto: 'File non riconosciuto',
}

export function descriviFilePaghe(r: FilePagheRiconosciuto): string {
  const mese = r.month && r.year ? ` di ${MESI[r.month - 1]} ${r.year}` : ''
  const ced = r.tipoCedolino ? ` · ${CEDOLINO[r.tipoCedolino] ?? r.tipoCedolino}` : ''
  return `${NOME[r.tipo]}${mese}${ced}`
}

async function testoDelFile(file: File): Promise<string> {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return ''
  const { extractPdfItems } = await import('../lib/pdfText')
  const pages = await extractPdfItems(file)
  // Le prime pagine bastano: titolo, periodo e tipo di cedolino stanno in testa.
  return pages.slice(0, 3).map((items) => items.map((t) => t.str).join(' ')).join(' ')
}

export default function CaricaFilePaghe({ companyId, userId, onApri, onVai }: {
  companyId: string
  userId: string | null
  /** Apre il file nel suo flusso e restituisce il nonce con cui il flusso rispondera'. */
  onApri: (f: Omit<FileInArrivo, 'nonce'>) => number
  onVai: (vista: 'lordi' | 'ferie') => void
}) {
  const [voci, setVoci] = useState<Voce[]>([])
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  // Esiti arrivati dai flussi, per nonce: la coda li aspetta uno alla volta.
  // Il callback dice se il file ha finito (true) o resta in attesa di conferma.
  const attese = useRef(new Map<number, (e: EsitoPaghe) => boolean>())
  const coda = useRef<Promise<void>>(Promise.resolve())

  const aggiorna = (id: number, patch: Partial<Voce>) =>
    setVoci((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))

  useEffect(() => {
    const su = (ev: Event) => {
      const e = (ev as CustomEvent<EsitoPaghe>).detail
      // Un esito dopo la conferma a mano (file rimasto «da confermare»).
      setVoci((vs) => vs.map((v) => (v.nonce === e.nonce ? { ...v, stato: e.stato, nota: e.testo } : v)))
      const fine = attese.current.get(e.nonce)
      if (fine && fine(e)) attese.current.delete(e.nonce)
    }
    window.addEventListener(EVENTO, su)
    return () => window.removeEventListener(EVENTO, su)
  }, [])

  // Un file alla volta: i due flussi stanno in schede diverse, e aprirne uno
  // mentre l'altro sta ancora salvando lo interromperebbe.
  const salva = (v: Voce, r: FilePagheRiconosciuto) => {
    coda.current = coda.current.then(() => new Promise<void>((resolve) => {
      aggiorna(v.id, { stato: 'in_corso', nota: undefined })
      const nonce = onApri({ dest: r.tipo === 'elenco_netti' ? 'netti' : 'prospetto', file: v.file, year: r.year, month: r.month, tipoCedolino: r.tipoCedolino })
      aggiorna(v.id, { nonce })
      const timer = window.setTimeout(() => {
        attese.current.delete(nonce)
        aggiorna(v.id, { stato: 'errore', nota: 'Il salvataggio non ha risposto. Ricarica la pagina e trascina di nuovo questo file.' })
        resolve()
      }, ATTESA_MAX_MS)
      attese.current.set(nonce, (e) => {
        window.clearTimeout(timer)
        // In attesa di conferma: la coda si ferma qui finche' non arriva l'esito
        // finale. Il file dopo cambierebbe scheda e l'anteprima da confermare sparirebbe.
        if (e.stato === 'da_confermare') return false
        resolve()
        return true
      })
    }))
  }

  const leggi = async (files: FileList | File[]) => {
    const nuove: Voce[] = Array.from(files).map((file) => ({ id: ++seq.current, file, r: null, stato: 'lettura' }))
    setVoci((vs) => [...nuove, ...vs])
    for (const v of nuove) {
      try {
        const r = riconosciFilePaghe(v.file.name, await testoDelFile(v.file))
        if (r.tipo === 'netti_negativi') {
          // Per scelta non si importa (vedi ImportLane): si archivia e si dice perche'.
          const esito = await archiviaFile({
            file: v.file, companyId, userId, modulo: 'Personale',
            funzione: 'Netti negativi (non importati)', bucket: 'employee-documents',
            year: r.year ?? undefined, month: r.month ?? undefined, referenceTable: null,
            note: 'Tabulato dei netti negativi: non entra nella distinta dei bonifici, il negativo si recupera dal cedolino successivo.',
          })
          aggiorna(v.id, {
            r, stato: esito.errore ? 'errore' : 'archiviato',
            nota: esito.errore
              ? `Archiviazione non riuscita: ${esito.errore}`
              : 'Archiviato. Non si importa: chi è in questo elenco quel mese non incassa, e il negativo si recupera dal cedolino successivo.',
          })
        } else if (r.tipo === 'elenco_netti' || r.tipo === 'prospetto') {
          aggiorna(v.id, { r, stato: 'pronto' })
          salva(v, r)
        } else {
          aggiorna(v.id, { r, stato: 'pronto' })
        }
      } catch (e) {
        aggiorna(v.id, { stato: 'errore', nota: `Non riesco a leggere il file: ${e instanceof Error ? e.message : 'motivo non noto'}` })
      }
    }
  }

  const apri = (v: Voce) => {
    if (!v.r) return
    if (v.r.tipo === 'statistica') onVai('lordi')
    else if (v.r.tipo === 'ratei_ferie') onVai('ferie')
  }

  // Il messaggio di fine percorso: se non c'e', non si capisce che e' finito.
  const inCoda = voci.filter((v) => v.stato === 'pronto' && (v.r?.tipo === 'elenco_netti' || v.r?.tipo === 'prospetto')).length
  const salvati = voci.filter((v) => v.stato === 'salvato').length
  const daConfermare = voci.filter((v) => v.stato === 'da_confermare').length
  const errori = voci.filter((v) => v.stato === 'errore').length
  const altrove = voci.filter((v) => v.stato === 'pronto' && (v.r?.tipo === 'statistica' || v.r?.tipo === 'ratei_ferie')).length
  const sconosciuti = voci.filter((v) => v.stato === 'pronto' && v.r?.tipo === 'sconosciuto').length
  const resta: string[] = []
  if (daConfermare) resta.push(`${daConfermare === 1 ? '1 file aspetta' : `${daConfermare} file aspettano`} la tua conferma: il motivo è scritto accanto${inCoda ? `; dopo salvo ${inCoda === 1 ? "l'altro file" : `gli altri ${inCoda}`}` : ''}`)
  if (errori) resta.push(`${errori === 1 ? '1 file non è riuscito' : `${errori} file non sono riusciti`}: il motivo è scritto accanto`)
  if (altrove) resta.push(`${altrove === 1 ? '1 file si carica' : `${altrove} file si caricano`} dalla sua scheda (pulsante accanto)`)
  if (sconosciuti) resta.push(`${sconosciuti === 1 ? '1 file non è stato riconosciuto' : `${sconosciuti} file non sono stati riconosciuti`}`)
  // In lavorazione: un file in lettura o in salvataggio, o file in coda senza
  // una conferma che li stia trattenendo.
  const inCorso = voci.some((v) => v.stato === 'lettura' || v.stato === 'in_corso') || (inCoda > 0 && daConfermare === 0)
  const chiusura = voci.length === 0 || inCorso ? null
    : resta.length === 0
      ? { ok: true, titolo: 'Finito, tutti i dati sono aggiornati', testo: `${salvati === 1 ? '1 documento salvato' : `${salvati} documenti salvati`}${voci.some((v) => v.stato === 'archiviato') ? ', i Netti negativi archiviati' : ''}. Non c'è altro da fare.` }
      : { ok: false, titolo: salvati ? 'Quasi finito' : 'Niente di salvato', testo: `${salvati ? `${salvati === 1 ? '1 documento salvato' : `${salvati} documenti salvati`}. ` : ''}${resta.join('; ')}.` }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileUp size={18} className="text-blue-600" />
        <h3 className="font-bold text-slate-800">Carica i file dello studio paghe</h3>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Trascina qui tutti i PDF del mese insieme. Il gestionale riconosce cosa sono e di che mese e li salva da solo,
        uno alla volta. Ti chiede di confermare solo se un file sostituirebbe dati già caricati per quel mese.
        Quando ha finito te lo dice qui sotto.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) void leggi(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${drag ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 text-slate-500'}`}
      >
        Trascina i file o <span className="text-blue-600 font-medium">sceglili dal computer</span>
        <input ref={inputRef} type="file" multiple accept=".pdf,.xlsx,.xls,.csv" className="hidden"
          onChange={(e) => { if (e.target.files?.length) void leggi(e.target.files); e.target.value = '' }} />
      </div>

      {voci.length > 0 && (
        <ul className="mt-3 space-y-2">
          {voci.map((v) => (
            <li key={v.id} className="flex flex-wrap items-start gap-2 text-sm border border-slate-100 rounded-lg px-3 py-2">
              {(v.stato === 'lettura' || v.stato === 'in_corso') && <Loader2 size={16} className="animate-spin text-slate-400 mt-0.5" />}
              {(v.stato === 'salvato' || v.stato === 'archiviato') && <Check size={16} className="text-green-600 mt-0.5" />}
              {v.stato === 'pronto' && <Info size={16} className="text-slate-400 mt-0.5" />}
              {(v.stato === 'errore' || v.stato === 'da_confermare') && <AlertTriangle size={16} className="text-amber-600 mt-0.5" />}
              <div className="flex-1 min-w-[12rem]">
                <div className="font-medium text-slate-800 break-all">{v.file.name}</div>
                <div className="text-xs text-slate-500">
                  {v.stato === 'lettura' ? 'Lettura…' : v.r ? descriviFilePaghe(v.r) : ''}
                  {v.r?.tipo === 'sconosciuto' && ': non è uno dei documenti dello studio paghe che il gestionale conosce. Se è un Excel di netti, caricalo da «Costi & cedolini».'}
                  {v.r?.tipo === 'statistica' && ': si carica nel riquadro «Costo lordo per dipendente» della scheda «Costo lordo» (va scelta l\'azienda del file).'}
                  {v.r?.tipo === 'ratei_ferie' && ': si carica dalla scheda «Ferie e permessi».'}
                  {v.stato === 'in_corso' && ' · salvataggio in corso…'}
                  {v.nota && <> · {v.nota}</>}
                </div>
              </div>
              {v.stato === 'pronto' && v.r && (v.r.tipo === 'statistica' || v.r.tipo === 'ratei_ferie') && (
                <button onClick={() => apri(v)}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1">
                  {v.r.tipo === 'statistica' ? 'Vai a Costo lordo' : 'Vai a Ferie e permessi'}
                  <ArrowRight size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {chiusura && (
        <div role="status" className={`mt-3 rounded-xl border p-3 flex items-start gap-2.5 ${chiusura.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          {chiusura.ok ? <CheckCircle2 size={20} className="shrink-0 text-emerald-600" /> : <AlertTriangle size={20} className="shrink-0" />}
          <div>
            <div className="font-semibold text-sm">{chiusura.titolo}</div>
            <div className="text-xs mt-0.5">{chiusura.testo}</div>
          </div>
        </div>
      )}

      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer flex items-center gap-1 text-slate-500"><Info size={13} /> Cosa riconosce e cosa succede dopo</summary>
        <ul className="mt-2 ml-4 list-disc space-y-1">
          <li><strong>Elenco netti</strong> (mensilità normale, cedolino aggiuntivo, mensilità aggiuntive: a giugno è la 14ª, a dicembre la 13ª): le buste si salvano in «Costi & cedolini» e si agganciano da sole alle disposizioni di emolumenti arrivate in banca.</li>
          <li><strong>Prospetto riepilogativo</strong>: salva il costo per outlet in «Costo lordo» e quanto va versato con l'F24 del 16 del mese dopo; il gestionale controlla che le deleghe in banca lo coprano.</li>
          <li><strong>Conferma</strong>: solo se per quel mese c'erano già buste o costo lordo (il file li sostituirebbe) o se i totali non tornano. In quel caso trovi l'anteprima aperta con il pulsante di conferma.</li>
          <li><strong>Netti negativi</strong>: si archivia e basta, per scelta non si importa.</li>
          <li><strong>Statistica costo orario</strong> e <strong>ratei ferie</strong>: vengono riconosciuti e ti porta nella scheda dove si caricano.</li>
          <li>Quello che non torna (una disposizione senza buste, un F24 che manca) diventa una domanda in Banche → Documenti banca → «Da chiarire».</li>
        </ul>
      </details>
    </div>
  )
}
