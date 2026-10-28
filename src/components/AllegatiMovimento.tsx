// Allegati di un movimento bancario: scontrini, ricevute, distinte di bonifico.
//
// Prima non c'era un posto dove mettere il giustificativo di un movimento: lo
// scontrino del taxi o la distinta di un rimborso restavano in una cartella a
// parte e andavano mandati allo studio insieme alla Prima Nota.
//
// Il file va nell'archivio unico (`import_documents`, bucket `bank-statements`)
// legato al movimento con reference_table = 'bank_transactions'. Nessuna tabella
// nuova: lo stesso file si ritrova anche in Archivio documenti.
//
// Regola fissa dei caricamenti (CLAUDE.md): il file si salva da solo, piu' file
// si lavorano uno alla volta, alla fine si dice che e' finito. Togliere un
// allegato non cancella niente: il documento resta in archivio marcato come
// sostituito (superseded_at) e sparisce solo da questo riquadro.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Paperclip, FileUp, Loader2, Check, AlertTriangle, CheckCircle2, ExternalLink, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Modal } from './ui/Modal'
import { archiviaFile, urlFileArchiviato } from '../lib/archivioFile'

export const TABELLA_MOVIMENTI = 'bank_transactions'
const FUNZIONE = 'Allegato movimento'

export type MovimentoLite = {
  id: string
  transaction_date?: string | null
  amount?: number | null
  description?: string | null
}

type Allegato = {
  id: string
  file_name: string | null
  file_path: string | null
  storage_bucket: string | null
  file_size: number | null
  uploaded_at: string | null
}

type Voce = { key: string; nome: string; stato: 'attesa' | 'salvataggio' | 'fatto' | 'gia_presente' | 'errore'; messaggio?: string }

/** Quanti allegati ha ogni movimento della lista (solo quelli correnti). */
export async function contaAllegatiMovimenti(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  if (ids.length === 0) return out
  const { data } = await supabase.from('import_documents')
    .select('reference_id')
    .eq('reference_table', TABELLA_MOVIMENTI)
    .is('superseded_at', null)
    .in('reference_id', ids)
  for (const r of (data ?? []) as Array<{ reference_id: string | null }>) {
    if (r.reference_id) out[r.reference_id] = (out[r.reference_id] ?? 0) + 1
  }
  return out
}

const fmtEuro = (n: number | null | undefined) =>
  (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtData = (d: string | null | undefined) => {
  if (!d) return ''
  const [y, m, g] = d.slice(0, 10).split('-')
  return `${g}/${m}/${y}`
}

const fmtPeso = (b: number | null | undefined) => {
  const n = Number(b) || 0
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

const ESTENSIONI = /\.(pdf|jpe?g|png|heic|webp)$/i

export default function AllegatiMovimento({ movimento, companyId, onClose, onCambiato }: {
  movimento: MovimentoLite | null
  companyId: string
  onClose: () => void
  /** Avvisa la tabella del nuovo numero di allegati del movimento. */
  onCambiato?: (movimentoId: string, quanti: number) => void
}) {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const inputRef = useRef<HTMLInputElement>(null)
  const [allegati, setAllegati] = useState<Allegato[]>([])
  const [carico, setCarico] = useState(false)
  const [voci, setVoci] = useState<Voce[]>([])
  const [lavoro, setLavoro] = useState(false)
  const [trascina, setTrascina] = useState(false)

  const ricarica = useCallback(async (): Promise<Allegato[]> => {
    if (!movimento) return []
    setCarico(true)
    const { data } = await supabase.from('import_documents')
      .select('id, file_name, file_path, storage_bucket, file_size, uploaded_at')
      .eq('reference_table', TABELLA_MOVIMENTI)
      .eq('reference_id', movimento.id)
      .is('superseded_at', null)
      .order('uploaded_at', { ascending: true })
    const lista = (data ?? []) as Allegato[]
    setAllegati(lista)
    setCarico(false)
    onCambiato?.(movimento.id, lista.length)
    return lista
  }, [movimento, onCambiato])

  useEffect(() => {
    setVoci([])
    setAllegati([])
    if (movimento) void ricarica()
  }, [movimento, ricarica])

  const carica = useCallback(async (files: File[]) => {
    if (!movimento || !companyId || files.length === 0) return
    const nuove: Voce[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, nome: f.name, stato: 'attesa' }))
    setVoci((vs) => [...vs, ...nuove])
    setLavoro(true)
    const aggiorna = (key: string, patch: Partial<Voce>) =>
      setVoci((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)))
    const anno = movimento.transaction_date ? Number(movimento.transaction_date.slice(0, 4)) : null
    const mese = movimento.transaction_date ? Number(movimento.transaction_date.slice(5, 7)) : null
    let presenti = allegati
    // Uno alla volta, ciascuno fino in fondo.
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const key = nuove[i].key
      if (!ESTENSIONI.test(f.name)) {
        aggiorna(key, { stato: 'errore', messaggio: 'Formato non accettato: carica un PDF o una foto (JPG, PNG).' })
        continue
      }
      if (presenti.some((a) => a.file_name === f.name && Number(a.file_size) === f.size)) {
        aggiorna(key, { stato: 'gia_presente', messaggio: 'Era già allegato a questo movimento.' })
        continue
      }
      aggiorna(key, { stato: 'salvataggio' })
      const arch = await archiviaFile({
        file: f, companyId, userId, modulo: 'Banche', funzione: FUNZIONE,
        bucket: 'bank-statements', year: anno, month: mese,
        referenceTable: TABELLA_MOVIMENTI, referenceId: movimento.id,
        note: `${fmtData(movimento.transaction_date)} · ${fmtEuro(movimento.amount)} € · ${(movimento.description ?? '').slice(0, 120)}`,
      })
      if (arch.errore) {
        aggiorna(key, { stato: 'errore', messaggio: `Non salvato: ${arch.errore}` })
        continue
      }
      aggiorna(key, { stato: 'fatto' })
      presenti = await ricarica()
    }
    setLavoro(false)
  }, [allegati, companyId, movimento, ricarica, userId])

  const togli = useCallback(async (a: Allegato) => {
    if (!window.confirm(`Togliere «${a.file_name}» da questo movimento? Il file resta comunque in Archivio documenti.`)) return
    await supabase.from('import_documents').update({ superseded_at: new Date().toISOString() }).eq('id', a.id)
    await ricarica()
  }, [ricarica])

  const apri = useCallback(async (a: Allegato) => {
    const url = await urlFileArchiviato(a.storage_bucket, a.file_path)
    if (url) window.open(url, '_blank', 'noopener')
  }, [])

  const finite = voci.length > 0 && !lavoro && voci.every((v) => v.stato !== 'attesa' && v.stato !== 'salvataggio')
  const errori = voci.filter((v) => v.stato === 'errore').length

  return (
    <Modal open={!!movimento} onClose={onClose} title="Allegati del movimento" maxWidthClass="max-w-xl">
      {movimento && (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-slate-600">{fmtData(movimento.transaction_date)}</span>
              <span className={(Number(movimento.amount) || 0) >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>
                {(Number(movimento.amount) || 0) >= 0 ? '+' : ''}{fmtEuro(movimento.amount)} €
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1 line-clamp-2">{movimento.description || '—'}</div>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setTrascina(true) }}
            onDragLeave={() => setTrascina(false)}
            onDrop={(e) => { e.preventDefault(); setTrascina(false); void carica(Array.from(e.dataTransfer.files)) }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-5 text-center cursor-pointer transition ${trascina ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-blue-300 hover:bg-slate-50'}`}
          >
            <FileUp size={20} className="text-blue-600" />
            <span className="text-sm font-medium text-slate-700">Trascina qui lo scontrino o la ricevuta</span>
            <span className="text-xs text-slate-500">PDF o foto. Si salva da solo, anche più file insieme.</span>
            <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.heic,.webp,application/pdf,image/*" className="hidden"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ''; void carica(fs) }} />
          </div>

          {voci.length > 0 && (
            <ul className="space-y-1 text-sm">
              {voci.map((v) => (
                <li key={v.key} className="flex items-start gap-2">
                  {v.stato === 'salvataggio' || v.stato === 'attesa'
                    ? <Loader2 size={14} className="mt-0.5 animate-spin text-blue-600 shrink-0" />
                    : v.stato === 'errore'
                      ? <AlertTriangle size={14} className="mt-0.5 text-amber-600 shrink-0" />
                      : <Check size={14} className="mt-0.5 text-emerald-600 shrink-0" />}
                  <span className="min-w-0">
                    <span className="text-slate-800 break-all">{v.nome}</span>
                    <span className="text-xs text-slate-500">
                      {' '}· {v.stato === 'attesa' ? 'in coda' : v.stato === 'salvataggio' ? 'salvataggio…' : v.stato === 'fatto' ? 'allegato' : v.messaggio}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {finite && (
            errori === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <CheckCircle2 size={16} className="shrink-0" /> Finito, gli allegati sono salvati.
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                {errori === 1 ? 'Un file non è stato salvato' : `${errori} file non sono stati salvati`}: il motivo è scritto accanto. Gli altri sono allegati.
              </div>
            )
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Allegati</h3>
            {carico && allegati.length === 0 ? (
              <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Caricamento…</p>
            ) : allegati.length === 0 ? (
              <p className="text-sm text-slate-500">Nessun allegato per questo movimento.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {allegati.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <Paperclip size={14} className="text-slate-400 shrink-0" />
                    <button type="button" onClick={() => void apri(a)} className="min-w-0 flex-1 text-left text-blue-700 hover:underline break-all" title="Apri il file">
                      {a.file_name}
                    </button>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{fmtPeso(a.file_size)}</span>
                    <button type="button" onClick={() => void apri(a)} aria-label={`Apri ${a.file_name}`} className="p-1 text-slate-400 hover:text-blue-600">
                      <ExternalLink size={14} />
                    </button>
                    <button type="button" onClick={() => void togli(a)} aria-label={`Togli ${a.file_name}`} title="Togli dal movimento (resta in archivio)" className="p-1 text-slate-400 hover:text-red-600">
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
