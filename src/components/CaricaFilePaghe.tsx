// Zona unica per i file dello studio paghe (Dipendenti, in alto).
//
// Ogni mese lo studio manda gli stessi documenti: Elenco netti, Netti negativi,
// Prospetto riepilogativo; ogni tanto la Statistica costo orario e i ratei ferie.
// Prima chi caricava doveva sapere in quale scheda andava ciascuno e scegliere a
// mano mese e tipo di cedolino. Qui si trascinano tutti insieme: il gestionale
// riconosce cosa sono (src/lib/payrollParse.ts, riconosciFilePaghe) e apre
// ciascuno nel flusso che c'era gia', con mese e cedolino gia' impostati.
// Anteprima e conferma restano dove erano: questa zona smista, non salva.

import { useRef, useState } from 'react'
import { FileUp, Loader2, Check, AlertTriangle, ArrowRight, Info } from 'lucide-react'
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

type Voce = {
  id: number
  file: File
  r: FilePagheRiconosciuto | null
  stato: 'lettura' | 'pronto' | 'aperto' | 'archiviato' | 'errore'
  nota?: string
}

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
  onApri: (f: Omit<FileInArrivo, 'nonce'>) => void
  onVai: (vista: 'lordi' | 'ferie') => void
}) {
  const [voci, setVoci] = useState<Voce[]>([])
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  const aggiorna = (id: number, patch: Partial<Voce>) =>
    setVoci((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)))

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
    if (v.r.tipo === 'elenco_netti' || v.r.tipo === 'prospetto') {
      onApri({ dest: v.r.tipo === 'elenco_netti' ? 'netti' : 'prospetto', file: v.file, year: v.r.year, month: v.r.month, tipoCedolino: v.r.tipoCedolino })
      aggiorna(v.id, { stato: 'aperto' })
    } else if (v.r.tipo === 'statistica') onVai('lordi')
    else if (v.r.tipo === 'ratei_ferie') onVai('ferie')
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-1">
        <FileUp size={18} className="text-blue-600" />
        <h3 className="font-bold text-slate-800">Carica i file dello studio paghe</h3>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Trascina qui tutti i PDF del mese insieme. Il gestionale riconosce cosa sono e di che mese, e apre ciascuno
        nella scheda giusta con mese e cedolino già scelti: controlli l'anteprima e confermi, come sempre.
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
              {v.stato === 'lettura' && <Loader2 size={16} className="animate-spin text-slate-400 mt-0.5" />}
              {(v.stato === 'pronto' || v.stato === 'aperto' || v.stato === 'archiviato') && <Check size={16} className="text-green-600 mt-0.5" />}
              {v.stato === 'errore' && <AlertTriangle size={16} className="text-amber-600 mt-0.5" />}
              <div className="flex-1 min-w-[12rem]">
                <div className="font-medium text-slate-800 break-all">{v.file.name}</div>
                <div className="text-xs text-slate-500">
                  {v.stato === 'lettura' ? 'Lettura…' : v.r ? descriviFilePaghe(v.r) : ''}
                  {v.r?.tipo === 'sconosciuto' && ': non è uno dei documenti dello studio paghe che il gestionale conosce. Se è un Excel di netti, caricalo da «Costi & cedolini».'}
                  {v.r?.tipo === 'statistica' && ': si carica nel riquadro «Costo lordo per dipendente» della scheda «Costo lordo» (va scelta l\'azienda del file).'}
                  {v.r?.tipo === 'ratei_ferie' && ': si carica dalla scheda «Ferie e permessi».'}
                  {v.stato === 'aperto' && ' · aperto: controlla l\'anteprima e conferma.'}
                  {v.nota && <> · {v.nota}</>}
                </div>
              </div>
              {v.stato === 'pronto' && v.r && v.r.tipo !== 'sconosciuto' && (
                <button onClick={() => apri(v)}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium flex items-center gap-1">
                  {v.r.tipo === 'statistica' ? 'Vai a Costo lordo' : v.r.tipo === 'ratei_ferie' ? 'Vai a Ferie e permessi' : 'Apri e controlla'}
                  <ArrowRight size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer flex items-center gap-1 text-slate-500"><Info size={13} /> Cosa riconosce e cosa succede dopo</summary>
        <ul className="mt-2 ml-4 list-disc space-y-1">
          <li><strong>Elenco netti</strong> (mensilità normale, cedolino aggiuntivo, mensilità aggiuntive: a giugno è la 14ª, a dicembre la 13ª): si apre in «Costi & cedolini». Dopo la conferma le buste si agganciano da sole alle disposizioni di emolumenti arrivate in banca.</li>
          <li><strong>Prospetto riepilogativo</strong>: si apre in «Costo lordo». Oltre al costo per outlet, salva quanto va versato con l'F24 del 16 del mese dopo; il gestionale controlla che le deleghe in banca lo coprano.</li>
          <li><strong>Netti negativi</strong>: si archivia e basta, per scelta non si importa.</li>
          <li><strong>Statistica costo orario</strong> e <strong>ratei ferie</strong>: vengono riconosciuti e ti porta nella scheda dove si caricano.</li>
          <li>Quello che non torna (una disposizione senza buste, un F24 che manca) diventa una domanda in Banche → Documenti banca → «Da chiarire».</li>
        </ul>
      </details>
    </div>
  )
}
