// Scheda «Documenti» del negozio (disegno approvato da Patrizio il 16/11/2026).
//
// Un solo elenco al posto dei due di prima («Archivio documenti» e «Documenti e allegati»):
//  - in cima lo stato «Documenti del contratto: N su M» e cosa manca;
//  - un solo punto di caricamento: il file si salva da solo e va nella riga del suo documento,
//    riconosciuto dal nome (src/lib/documentiNegozio.ts). Si chiede solo quando prenderebbe il
//    posto della copia che vale. Alla fine un riquadro dice che è finito (regola fissa dei caricamenti);
//  - «Documenti del contratto» in ordine di contratto, con le versioni dentro la riga;
//  - «Altri documenti» in fondo, per mese, con «Sposta in…» facoltativo.
//
// Nel database non cambia niente: le righe restano in `outlet_attachments`, i file in `documents`
// e `contract_documents`. L'abbinamento si calcola a video; si salva solo la scelta fatta a mano
// (`outlet_document_links`, migration 412). Dove quella tabella manca la pagina funziona lo stesso,
// senza «Sposta in…».

import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Download, Eye, History, Plus, RefreshCw,
  Search, Trash2, Upload, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from './Toast'
import { Modal } from './ui/Modal'
import { raggruppaPerMese, etichettaMese } from '../lib/outletSlug'
import {
  categoriaDalNome, chiaveFile, destinoDelFile, eFirmato, etichettaRiga, ordinaRighe, rigaDelFile,
  statoContratto, type AbbinamentiAMano, type DestinoFile, type FileArchivio, type RigaContratto,
} from '../lib/documentiNegozio'

const PdfViewer = lazy(() => import('./PdfViewer'))

const BUCKET = 'outlet-attachments'
const MAX_FILE = 50 * 1024 * 1024 // 50 MB
const TIPI_FILE = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx,.txt'
const CARD = 'bg-white rounded-2xl border border-slate-200 overflow-hidden'

// La tabella degli abbinamenti a mano è nuova e non sta nei tipi generati del database.
const db = supabase as unknown as SupabaseClient
// Dove la tabella non c'è lo si scopre alla prima lettura e non si chiede più (niente errori ripetuti).
let tabellaAbbinamentiAssente = false

interface Riga extends RigaContratto {
  attachment_type: string
  file_path: string | null
  file_size: number | null
  uploaded_at: string | null
  uploaded_by: string | null
  uploaded_by_name: string | null
}

interface Doc extends FileArchivio {
  category: string | null
  file_path: string | null
  file_size: number | null
  storage_bucket: string | null
  uploaded_at: string | null
  created_at: string | null
  uploaded_by: string | null
  uploaded_by_name: string | null
  version_count: number | null
}

interface Dati {
  righe: Riga[]
  docs: Doc[]
  aMano: AbbinamentiAMano
  /** falso dove la tabella degli abbinamenti a mano non c'è: niente «Sposta in…» */
  haAbbinamenti: boolean
}

type Grezza = Record<string, unknown>
const testo = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const numero = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

function comeRiga(r: Grezza): Riga {
  return {
    id: String(r.id),
    label: String(r.label ?? ''),
    file_name: testo(r.file_name),
    is_required: Boolean(r.is_required),
    is_uploaded: Boolean(r.is_uploaded),
    created_at: testo(r.created_at),
    attachment_type: String(r.attachment_type ?? ''),
    file_path: testo(r.file_path),
    file_size: numero(r.file_size),
    uploaded_at: testo(r.uploaded_at),
    uploaded_by: testo(r.uploaded_by),
    uploaded_by_name: testo(r.uploaded_by_name),
  }
}

function comeDoc(r: Grezza, source: Doc['source']): Doc {
  return {
    id: String(r.id),
    source,
    file_name: testo(r.file_name),
    category: testo(r.category),
    file_path: testo(r.file_path),
    file_size: numero(r.file_size),
    storage_bucket: testo(r.storage_bucket),
    uploaded_at: testo(r.uploaded_at),
    created_at: testo(r.created_at),
    uploaded_by: testo(r.uploaded_by),
    uploaded_by_name: testo(r.uploaded_by_name),
    version_count: numero(r.version_count),
  }
}

/** Legge tutto dal database: è la fonte di ogni decisione sui file, non lo stato della pagina. */
async function leggiDocumenti(outletId: string): Promise<Dati> {
  const [righe, archivio, contratti, legami] = await Promise.all([
    supabase.from('outlet_attachments').select('*').eq('outlet_id', outletId).order('created_at'),
    supabase.from('documents').select('*').eq('reference_type', 'outlet').eq('reference_id', outletId),
    supabase.from('contract_documents').select('*').eq('outlet_id', outletId),
    tabellaAbbinamentiAssente
      ? Promise.resolve({ data: null, error: { message: 'tabella assente', code: 'PGRST205' } })
      : db.from('outlet_document_links').select('document_table, document_id, attachment_id').eq('outlet_id', outletId),
  ])
  // PGRST205 e 42P01: la tabella non esiste su questo database (migration 412 non applicata).
  if (legami.error && ['PGRST205', '42P01'].includes(String((legami.error as { code?: string }).code))) tabellaAbbinamentiAssente = true
  if (righe.error) throw new Error(righe.error.message)
  if (archivio.error) throw new Error(archivio.error.message)
  const aMano: AbbinamentiAMano = {}
  if (!legami.error) {
    for (const l of (legami.data ?? []) as { document_table: string; document_id: string; attachment_id: string | null }[]) {
      aMano[`${l.document_table}:${l.document_id}`] = l.attachment_id
    }
  }
  return {
    righe: ((righe.data ?? []) as Grezza[]).map(comeRiga),
    docs: [
      ...((archivio.data ?? []) as Grezza[]).map((d) => comeDoc(d, 'documents')),
      // contract_documents è l'archivio di prima: dove manca o non si legge, si va avanti senza.
      ...((contratti.error ? [] : contratti.data ?? []) as Grezza[]).map((d) => comeDoc(d, 'contract_documents')),
    ],
    aMano,
    haAbbinamenti: !legami.error,
  }
}

const dataDelDoc = (d: Doc) => d.uploaded_at || d.created_at
const giorno = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '')
const quando = (iso: string | null, chi: string | null) => [giorno(iso), chi].filter(Boolean).join(' · ')

interface DaAprire { titolo: string; file_name: string; bucket: string; path: string }
interface Anteprima extends DaAprire { signedUrl: string | null; pdfData: ArrayBuffer | null; blobUrl: string | null }

type EsitoTipo = 'ok' | 'altri' | 'saltato' | 'errore'
interface Lavoro { nome: string; stato: 'attesa' | 'in_corso' | EsitoTipo; testo: string }
interface Domanda { file: File; riga: Riga; rispondi: (r: 'sostituisci' | 'versione' | 'niente') => void }

function Chip({ tono, children }: { tono: 'verde' | 'ambra' | 'grigio'; children: React.ReactNode }) {
  const colori = { verde: 'bg-emerald-100 text-emerald-800', ambra: 'bg-amber-100 text-amber-800', grigio: 'bg-slate-200 text-slate-700' }[tono]
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${colori}`}>{children}</span>
}

function Azione({ onClick, icona, children }: { onClick: () => void; icona: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600 hover:text-blue-800 hover:underline">
      {icona}{children}
    </button>
  )
}

export default function DocumentiNegozio({ outletId, companyId }: { outletId: string; companyId: string }) {
  const { toast } = useToast()
  const { profile } = useAuth()
  const [dati, setDati] = useState<Dati>({ righe: [], docs: [], aMano: {}, haAbbinamenti: false })
  const [loading, setLoading] = useState(true)
  const [erroreLettura, setErroreLettura] = useState<string | null>(null)
  const [aperte, setAperte] = useState<Record<string, boolean>>({})
  const [mesiScelti, setMesiScelti] = useState<Record<string, boolean>>({})
  const [cerca, setCerca] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [lavori, setLavori] = useState<Lavoro[]>([])
  const [inCorso, setInCorso] = useState(false)
  const [domanda, setDomanda] = useState<Domanda | null>(null)
  const [anteprima, setAnteprima] = useState<Anteprima | null>(null)
  const [daTogliere, setDaTogliere] = useState<{ tipo: 'riga'; riga: Riga } | { tipo: 'doc'; doc: Doc } | null>(null)
  const [togliendo, setTogliendo] = useState(false)
  const [storico, setStorico] = useState<{ doc: Doc; versioni: Grezza[] } | null>(null)
  const [nuovaRiga, setNuovaRiga] = useState<string | null>(null)
  // Più gruppi di file trascinati di seguito si lavorano uno dopo l'altro, mai insieme.
  const coda = useRef<Promise<void>>(Promise.resolve())
  const negozio = useRef(outletId)

  const ricarica = useCallback(async (): Promise<Dati | null> => {
    const perNegozio = outletId
    try {
      const d = await leggiDocumenti(perNegozio)
      if (negozio.current !== perNegozio) return null
      setDati(d)
      setErroreLettura(null)
      return d
    } catch (e) {
      if (negozio.current === perNegozio) setErroreLettura((e as Error).message)
      return null
    }
  }, [outletId])

  useEffect(() => {
    negozio.current = outletId
    setLoading(true)
    setLavori([]); setAperte({}); setMesiScelti({}); setCerca('')
    void ricarica().finally(() => { if (negozio.current === outletId) setLoading(false) })
  }, [outletId, ricarica])

  const righe = useMemo(() => ordinaRighe(dati.righe), [dati.righe])
  const stato = useMemo(() => statoContratto(dati.righe), [dati.righe])
  const { versioni, altri } = useMemo(() => {
    const v = new Map<string, Doc[]>()
    const a: Doc[] = []
    for (const d of dati.docs) {
      const rigaId = rigaDelFile(d, dati.righe, dati.aMano)
      if (!rigaId) { a.push(d); continue }
      const lista = v.get(rigaId)
      if (lista) lista.push(d)
      else v.set(rigaId, [d])
    }
    for (const lista of v.values()) lista.sort((x, y) => String(dataDelDoc(y) || '').localeCompare(String(dataDelDoc(x) || '')))
    return { versioni: v, altri: a }
  }, [dati])

  const chiSono = useMemo(() => {
    const p = profile as { first_name?: string | null; last_name?: string | null; full_name?: string | null; email?: string | null } | null
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ') || p?.full_name || p?.email || 'Utente'
  }, [profile])

  // ── Aprire e scaricare ──────────────────────────────────────────────────────────
  const fileDellaRiga = (r: Riga): DaAprire | null =>
    r.file_path ? { titolo: etichettaRiga(r.label).titolo, file_name: r.file_name || '', bucket: BUCKET, path: r.file_path } : null
  const fileDelDoc = (d: Doc): DaAprire | null =>
    d.file_path ? { titolo: d.file_name || '', file_name: d.file_name || '', bucket: d.storage_bucket || BUCKET, path: d.file_path } : null

  async function indirizzo(f: DaAprire): Promise<string | null> {
    const { data, error } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 3600)
    return error ? null : data?.signedUrl ?? null
  }

  async function apri(f: DaAprire | null) {
    if (!f) { toast({ type: 'warning', message: 'Il file non è stato trovato.' }); return }
    const { data: blob, error } = await supabase.storage.from(f.bucket).download(f.path)
    const signedUrl = await indirizzo(f)
    if (error || !blob) {
      if (!signedUrl) { toast({ type: 'warning', message: 'Il file non è stato trovato in archivio.' }); return }
      setAnteprima({ ...f, signedUrl, pdfData: null, blobUrl: null })
      return
    }
    setAnteprima({ ...f, signedUrl, pdfData: await blob.arrayBuffer(), blobUrl: URL.createObjectURL(blob) })
  }

  async function scarica(f: DaAprire | null) {
    const url = f ? await indirizzo(f) : null
    if (url) window.open(url, '_blank')
    else toast({ type: 'warning', message: 'Il file non è stato trovato in archivio.' })
  }

  function chiudiAnteprima() {
    if (anteprima?.blobUrl) URL.revokeObjectURL(anteprima.blobUrl)
    setAnteprima(null)
  }

  // ── Caricare ────────────────────────────────────────────────────────────────────
  // Il file diventa la copia che vale della riga.
  async function mettiNellaRiga(riga: Riga, file: File): Promise<string | null> {
    const est = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
    const path = `${companyId}/${outletId}/${riga.attachment_type || 'documento'}_${Date.now()}.${est}`
    const su = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
    if (su.error) return su.error.message
    const adesso = new Date().toISOString()
    const { data, error } = await supabase.from('outlet_attachments')
      .update({ is_uploaded: true, file_name: file.name, file_path: path, uploaded_at: adesso } as never)
      .eq('id', riga.id).select('id')
    if (error || !data?.length) {
      // La riga non si è aggiornata (per esempio manca il permesso): il file appena salito non serve.
      await supabase.storage.from(BUCKET).remove([path])
      return error?.message || 'non hai il permesso di caricare documenti'
    }
    // Chi e quanto: campi in più, dove ci sono.
    await supabase.from('outlet_attachments')
      .update({ file_size: file.size, mime_type: file.type || null, uploaded_by: profile?.id ?? null, uploaded_by_name: chiSono } as never)
      .eq('id', riga.id)
    return null
  }

  // Il file entra nell'archivio. Con lo stesso nome di un file già in archivio diventa la sua
  // nuova versione, e quella di prima resta nello storico (come prima di questa scheda).
  async function mettiInArchivio(file: File, docs: Doc[]): Promise<{ errore?: string; nuovaVersione?: boolean }> {
    const sicuro = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${companyId}/${outletId}/${Date.now()}_${sicuro}`
    const esistente = docs.find((d) => d.file_name === file.name)
    const su = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
    if (su.error) return { errore: su.error.message }
    const chi = { uploaded_by: profile?.id ?? null, uploaded_by_name: chiSono }
    if (esistente) {
      const prima = await supabase.from('document_versions').insert({
        document_id: esistente.id, document_table: esistente.source,
        version_number: (esistente.version_count || 0) + 1,
        file_name: esistente.file_name || '', file_path: esistente.file_path || '', file_size: esistente.file_size || 0,
        storage_bucket: esistente.storage_bucket || BUCKET,
        uploaded_by: esistente.uploaded_by, uploaded_by_name: esistente.uploaded_by_name,
      } as never)
      if (prima.error) { await supabase.storage.from(BUCKET).remove([path]); return { errore: prima.error.message } }
      const { data, error } = await supabase.from(esistente.source)
        .update({ file_path: path, file_size: file.size, storage_bucket: BUCKET, uploaded_at: new Date().toISOString(), ...chi } as never)
        .eq('id', esistente.id).select('id')
      if (error || !data?.length) { await supabase.storage.from(BUCKET).remove([path]); return { errore: error?.message || 'non hai il permesso di caricare documenti' } }
      return { nuovaVersione: true }
    }
    const { error } = await supabase.from('documents').insert({
      company_id: companyId, reference_type: 'outlet', reference_id: outletId, category: categoriaDalNome(file.name),
      file_name: file.name, file_path: path, file_size: file.size, storage_bucket: BUCKET, ...chi,
    } as never)
    if (error) { await supabase.storage.from(BUCKET).remove([path]); return { errore: error.message } }
    return {}
  }

  // La copia che vale di prima non si perde: entra nell'archivio come versione della stessa riga.
  async function conservaCopiaDiPrima(riga: Riga, haAbbinamenti: boolean): Promise<{ errore?: string; id?: string }> {
    if (!riga.file_path) return {}
    const { data, error } = await supabase.from('documents').insert({
      company_id: companyId, reference_type: 'outlet', reference_id: outletId, category: 'allegato',
      file_name: riga.file_name || 'documento', file_path: riga.file_path, file_size: riga.file_size,
      storage_bucket: BUCKET, uploaded_by: riga.uploaded_by, uploaded_by_name: riga.uploaded_by_name,
      ...(riga.uploaded_at ? { uploaded_at: riga.uploaded_at } : {}),
    } as never).select('id')
    if (error || !data?.length) return { errore: error?.message || 'non hai il permesso di caricare documenti' }
    const id = (data[0] as { id: string }).id
    if (haAbbinamenti) {
      await db.from('outlet_document_links').upsert(
        [{ document_table: 'documents', document_id: id, company_id: companyId, outlet_id: outletId, attachment_id: riga.id }],
        { onConflict: 'document_table,document_id' },
      )
    }
    return { id }
  }

  const chiedi = (file: File, riga: Riga) => new Promise<'sostituisci' | 'versione' | 'niente'>((risolvi) => {
    setDomanda({ file, riga, rispondi: (r) => { setDomanda(null); risolvi(r) } })
  })

  // Un file, fino in fondo. Prima rilegge dal database: è lì che si vede cosa c'è già.
  async function lavoraFile(file: File, rigaForzata: string | null): Promise<{ tipo: EsitoTipo; testo: string; rigaId?: string }> {
    if (file.size > MAX_FILE) return { tipo: 'errore', testo: `troppo grande (${(file.size / 1024 / 1024).toFixed(1)} MB, il massimo è 50 MB)` }
    const freschi = await leggiDocumenti(outletId)
    const forzata = rigaForzata ? freschi.righe.find((r) => r.id === rigaForzata) : undefined
    const destino: DestinoFile = forzata
      ? { tipo: forzata.is_uploaded && forzata.file_path ? 'sostituisce' : 'riempie', rigaId: forzata.id }
      : destinoDelFile(file.name, freschi.righe)
    const riga = destino.tipo === 'altri' ? undefined : freschi.righe.find((r) => r.id === destino.rigaId)
    const nome = riga ? `«${etichettaRiga(riga.label).titolo}»` : ''

    if (riga && destino.tipo === 'riempie') {
      const errore = await mettiNellaRiga(riga, file)
      return errore ? { tipo: 'errore', testo: errore } : { tipo: 'ok', testo: `messo in ${nome}, che mancava`, rigaId: riga.id }
    }
    if (riga && destino.tipo === 'sostituisce') {
      const scelta = await chiedi(file, riga)
      if (scelta === 'niente') return { tipo: 'saltato', testo: 'non caricato, come hai scelto' }
      if (scelta === 'sostituisci') {
        const prima = await conservaCopiaDiPrima(riga, freschi.haAbbinamenti)
        if (prima.errore) return { tipo: 'errore', testo: prima.errore }
        const errore = await mettiNellaRiga(riga, file)
        if (errore) {
          // La riga è rimasta com'era: via la sola voce d'archivio appena aggiunta, che indicava lo
          // stesso file della riga. Il file non si tocca.
          if (prima.id) await supabase.from('documents').delete().eq('id', prima.id)
          return { tipo: 'errore', testo: errore }
        }
        return { tipo: 'ok', testo: `ora è la copia che vale di ${nome}; quella di prima resta fra le versioni`, rigaId: riga.id }
      }
    }
    const esito = await mettiInArchivio(file, freschi.docs)
    if (esito.errore) return { tipo: 'errore', testo: esito.errore }
    const nota = esito.nuovaVersione ? ' (c\'era già un file con lo stesso nome: quello di prima resta nello storico)' : ''
    if (riga) return { tipo: 'ok', testo: `aggiunto fra le versioni di ${nome}${nota}`, rigaId: riga.id }
    return { tipo: 'altri', testo: `non so di quale documento è, l'ho messo fra gli altri documenti${nota}` }
  }

  function carica(files: File[], rigaForzata: string | null = null) {
    if (files.length === 0) return
    const perNegozio = outletId
    coda.current = coda.current.then(async () => {
      if (negozio.current !== perNegozio) return
      setInCorso(true)
      const lista: Lavoro[] = files.map((f) => ({ nome: f.name, stato: 'attesa', testo: 'in attesa' }))
      setLavori(lista)
      const daAprire: string[] = []
      let finitiFraGliAltri = false
      // Uno alla volta, ciascuno fino in fondo.
      for (let i = 0; i < files.length; i++) {
        lista[i] = { ...lista[i], stato: 'in_corso', testo: 'sto salvando…' }
        setLavori([...lista])
        let esito: { tipo: EsitoTipo; testo: string; rigaId?: string }
        try { esito = await lavoraFile(files[i], rigaForzata) }
        catch (e) { esito = { tipo: 'errore', testo: (e as Error).message || 'errore' } }
        if (esito.rigaId) daAprire.push(esito.rigaId)
        if (esito.tipo === 'altri') finitiFraGliAltri = true
        lista[i] = { nome: files[i].name, stato: esito.tipo, testo: esito.testo }
        setLavori([...lista])
      }
      await ricarica()
      // La pagina mostra quello che è appena arrivato.
      if (daAprire.length) setAperte((p) => ({ ...p, ...Object.fromEntries(daAprire.map((id) => [id, true])) }))
      if (finitiFraGliAltri) { setCerca(''); setMesiScelti({}) }
      setInCorso(false)
    })
  }

  // ── Spostare a mano (solo dove c'è la tabella degli abbinamenti) ────────────────
  async function sposta(doc: Doc, rigaId: string | null) {
    const { error } = await db.from('outlet_document_links').upsert(
      [{ document_table: doc.source, document_id: doc.id, company_id: companyId, outlet_id: outletId, attachment_id: rigaId }],
      { onConflict: 'document_table,document_id' },
    )
    if (error) { toast({ type: 'error', message: `Non sono riuscito a spostarlo: ${error.message}` }); return }
    await ricarica()
    if (rigaId) setAperte((p) => ({ ...p, [rigaId]: true }))
  }

  // ── Togliere: sempre un gesto esplicito, con conferma ───────────────────────────
  async function confermaTogli() {
    if (!daTogliere) return
    setTogliendo(true)
    try {
      if (daTogliere.tipo === 'riga') {
        const r = daTogliere.riga
        const { data, error } = await supabase.from('outlet_attachments').delete().eq('id', r.id).select('id')
        if (error || !data?.length) throw new Error(error?.message || 'non hai il permesso di togliere documenti')
        if (r.file_path) await supabase.storage.from(BUCKET).remove([r.file_path])
      } else {
        const d = daTogliere.doc
        const { data, error } = await supabase.from(d.source).delete().eq('id', d.id).select('id')
        if (error || !data?.length) throw new Error(error?.message || 'non hai il permesso di togliere documenti')
        if (d.file_path) await supabase.storage.from(d.storage_bucket || BUCKET).remove([d.file_path])
        if (dati.haAbbinamenti) await db.from('outlet_document_links').delete().eq('document_table', d.source).eq('document_id', d.id)
      }
      setDaTogliere(null)
      await ricarica()
    } catch (e) {
      toast({ type: 'error', message: `Non sono riuscito a toglierlo: ${(e as Error).message}` })
    } finally {
      setTogliendo(false)
    }
  }

  async function aggiungiRiga() {
    const label = (nuovaRiga || '').trim()
    if (!label) return
    const { error } = await supabase.from('outlet_attachments').insert({
      company_id: companyId, outlet_id: outletId, label, is_required: false, is_uploaded: false,
      attachment_type: label.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    } as never)
    if (error) { toast({ type: 'error', message: `Non sono riuscito ad aggiungerlo: ${error.message}` }); return }
    setNuovaRiga(null)
    await ricarica()
  }

  async function apriStorico(doc: Doc) {
    const { data } = await supabase.from('document_versions').select('*').eq('document_id', doc.id).order('created_at', { ascending: false })
    setStorico({ doc, versioni: (data ?? []) as Grezza[] })
  }

  if (loading) return <div className={`${CARD} p-5 text-sm text-slate-400 text-center`}>Sto leggendo i documenti…</div>

  // ── Chiusura del caricamento ────────────────────────────────────────────────────
  const finiti = lavori.length > 0 && !inCorso
  const errori = lavori.filter((l) => l.stato === 'errore')
  const entrati = lavori.filter((l) => l.stato === 'ok' || l.stato === 'altri')
  const fraGliAltri = lavori.filter((l) => l.stato === 'altri')
  const saltati = lavori.filter((l) => l.stato === 'saltato')
  let chiusura = ''
  if (finiti) {
    if (errori.length) {
      chiusura = `${errori.length === 1 ? 'Un file non è entrato' : `${errori.length} file non sono entrati`}: ${errori.length === 1 ? 'va ricaricato' : 'vanno ricaricati'}.`
      if (entrati.length) chiusura += ` ${entrati.length === 1 ? 'L\'altro è salvato' : `Gli altri ${entrati.length} sono salvati`}.`
    } else if (entrati.length === 0) {
      chiusura = 'Finito: non ho caricato niente, come hai scelto.'
    } else {
      chiusura = `Finito, ${entrati.length === 1 ? 'il file è salvato' : entrati.length === 2 ? 'tutti e due i file sono salvati' : `tutti i ${entrati.length} file sono salvati`}.`
      if (saltati.length) chiusura += ` ${saltati.length === 1 ? 'Uno non l\'ho caricato' : `${saltati.length} non li ho caricati`}, come hai scelto.`
    }
    if (fraGliAltri.length) chiusura += ` ${fraGliAltri.length === 1 ? 'Uno è' : `${fraGliAltri.length} sono`} fra gli altri documenti: se vuoi, da lì ${dati.haAbbinamenti ? 'lo sposti nel suo documento' : 'lo apri e lo scarichi'}.`
    if (stato.mancanti.length) chiusura += ` ${stato.mancanti.length === 1 ? 'Manca ancora' : 'Mancano ancora'}: ${stato.mancanti.join(', ')}.`
    else if (stato.richiesti > 0 && !errori.length) chiusura += ' I documenti del contratto ci sono tutti.'
  }

  const cercato = cerca.trim().toLowerCase()
  const altriVisti = cercato
    ? altri.filter((d) => [d.file_name, d.uploaded_by_name, d.category].some((v) => v?.toLowerCase().includes(cercato)))
    : altri
  const gruppi = raggruppaPerMese(altriVisti, dataDelDoc)
  const meseAperto = (mese: string, i: number) => (cercato ? true : mese in mesiScelti ? mesiScelti[mese] : i === 0)
  const percento = stato.richiesti ? Math.round((stato.caricati / stato.richiesti) * 100) : 0
  const ultimaModifica = [...dati.righe.map((r) => r.uploaded_at), ...dati.docs.map(dataDelDoc)].filter(Boolean).sort().pop() || null

  const pulsanteCarica = (riga: Riga, testoPulsante = 'Carica') => (
    <label className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap ${inCorso ? 'bg-slate-100 text-slate-400' : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'}`}>
      <Upload size={14} />{testoPulsante}
      <input type="file" className="sr-only" accept={TIPI_FILE} disabled={inCorso} aria-label={`Carica ${etichettaRiga(riga.label).titolo}`}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) carica([f], riga.id) }} />
    </label>
  )

  return (
    <div className="space-y-3.5" data-testid="documenti-negozio">
      {erroreLettura && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Non riesco a leggere i documenti di questo negozio: {erroreLettura}
        </div>
      )}

      {/* Stato: quanti documenti del contratto ci sono e cosa manca */}
      {stato.richiesti > 0 && (
        <div className={`${CARD} px-4 py-3.5 flex flex-col md:flex-row md:items-center gap-3 md:gap-4`}>
          <div className="flex items-center gap-4 min-w-0">
            <div className="h-[54px] w-[54px] shrink-0 rounded-full flex items-center justify-center" aria-hidden
              style={{ background: `conic-gradient(#0f172a 0 ${percento}%, #e2e8f0 0)` }}>
              <div className="h-[42px] w-[42px] rounded-full bg-white flex items-center justify-center text-[13px] font-bold text-slate-900">
                {stato.caricati}/{stato.richiesti}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold text-slate-900">Documenti del contratto: {stato.caricati} su {stato.richiesti}</div>
              <div className="text-[12.5px] text-slate-500">
                {stato.mancanti.length === 0 ? 'Ci sono tutti.'
                  : stato.mancanti.length === 1 ? 'Ne manca uno.' : `Ne mancano ${stato.mancanti.length}.`}
              </div>
            </div>
          </div>
          {stato.mancanti.length > 0 && (
            <div className="md:ml-auto rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 space-y-1.5 min-w-0">
              {righe.filter((r) => r.is_required && !r.is_uploaded).slice(0, 3).map((r, i) => (
                <div key={r.id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-800 min-w-0"><b>{i === 0 ? (stato.mancanti.length === 1 ? 'Manca: ' : 'Mancano: ') : ''}</b>{etichettaRiga(r.label).titolo}</span>
                  {pulsanteCarica(r)}
                </div>
              ))}
              {stato.mancanti.length > 3 && <div className="text-xs text-slate-500">e {stato.mancanti.length === 4 ? 'un altro' : `altri ${stato.mancanti.length - 3}`}, li trovi in cima all'elenco qui sotto</div>}
            </div>
          )}
        </div>
      )}

      {/* Un solo punto di caricamento */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false) }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); carica(Array.from(e.dataTransfer.files)) }}
        className={`rounded-xl border-[1.5px] border-dashed px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 transition ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-400 bg-white'}`}
      >
        <div className="text-sm text-slate-900">
          <b>Trascina qui i file.</b>{' '}
          <span className="text-[12.5px] text-slate-500">
            {dati.righe.length > 0
              ? 'Si salvano da soli e vanno nella riga del loro documento. Ti chiedo solo se un file prenderebbe il posto di quello che vale.'
              : 'Si salvano da soli, senza altri passaggi.'}
          </span>
        </div>
        <label className={`inline-flex items-center justify-center gap-1.5 rounded-lg border-[1.5px] px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap ${inCorso ? 'border-slate-200 text-slate-400' : 'border-slate-300 text-slate-800 hover:bg-slate-50 cursor-pointer'}`}>
          {inCorso ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
          {inCorso ? 'Sto salvando…' : 'Scegli dal computer'}
          <input type="file" multiple className="sr-only" accept={TIPI_FILE} disabled={inCorso} aria-label="Scegli i file dal computer"
            onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; carica(f) }} />
        </label>
      </div>

      {/* Cosa è stato fatto di ogni file e, alla fine, la chiusura */}
      {lavori.length > 0 && (
        <div role="status" aria-live="polite" data-testid="esito-caricamento"
          className={`rounded-xl border p-3 text-[13px] ${!finiti ? 'border-slate-200 bg-white text-slate-700' : errori.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          <div className="flex items-start gap-2">
            {!finiti ? <RefreshCw size={16} className="shrink-0 mt-0.5 animate-spin" /> : errori.length ? <AlertCircle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{finiti ? chiusura : `Sto salvando ${lavori.length === 1 ? 'il file' : `${lavori.length} file, uno alla volta`}…`}</div>
              <ul className="mt-1.5 space-y-1">
                {lavori.map((l, i) => (
                  <li key={`${l.nome}-${i}`} className="flex gap-1.5">
                    <span className="shrink-0 w-4 text-center" aria-hidden>{l.stato === 'ok' ? '✓' : l.stato === 'altri' ? '•' : l.stato === 'errore' ? '✗' : l.stato === 'saltato' ? '–' : '…'}</span>
                    <span className="min-w-0 break-words"><b>{l.nome}</b>: {l.testo}</span>
                  </li>
                ))}
              </ul>
            </div>
            {finiti && <button type="button" onClick={() => setLavori([])} className="p-1 rounded hover:bg-black/5" title="Chiudi"><X size={14} /></button>}
          </div>
        </div>
      )}

      {/* Documenti del contratto */}
      {dati.righe.length > 0 && (
        <section className={CARD} aria-label="Documenti del contratto">
          <h3 className="m-0 px-4 py-3 text-[14.5px] font-semibold text-slate-900 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-slate-200">
            <span>Documenti del contratto</span>
            <span className="text-[12.5px] font-normal text-slate-500">in ordine di contratto{ultimaModifica ? ` · ultima modifica ${giorno(ultimaModifica)}` : ''}</span>
          </h3>
          <ul>
            {righe.map((r) => {
              const { titolo, nota } = etichettaRiga(r.label)
              const sue = versioni.get(r.id) ?? []
              const quante = sue.length + (r.is_uploaded ? 1 : 0)
              const aperta = Boolean(aperte[r.id])
              const manca = !r.is_uploaded
              const file = fileDellaRiga(r)
              return (
                <li key={r.id} className="border-b border-slate-100 last:border-b-0" data-testid="riga-contratto" data-stato={manca ? 'manca' : 'caricato'}>
                  <div className={`grid grid-cols-[20px_minmax(0,1fr)] md:grid-cols-[20px_minmax(0,1fr)_minmax(0,250px)_96px_auto] gap-x-3 gap-y-1 items-center px-4 py-2.5 ${manca && r.is_required ? 'bg-amber-50/60' : ''}`}>
                    <span aria-hidden className={`justify-self-center h-2.5 w-2.5 rounded-full ${manca ? (r.is_required ? 'bg-white border-2 border-amber-500' : 'bg-white border-2 border-slate-300') : 'bg-green-600'}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 break-words">{titolo}</div>
                      <div className="text-[12.5px] text-slate-500 break-words">
                        {[nota, manca ? 'non ancora caricato' : '', quante > 1 ? `${quante} versioni` : ''].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="col-start-2 md:col-start-auto min-w-0 text-[12.5px] text-slate-500 truncate" title={r.file_name || undefined}>{r.file_name || ''}</div>
                    <div className="col-start-2 md:col-start-auto flex items-center justify-between md:contents gap-3">
                      <span className="md:justify-self-start">
                        {manca ? <Chip tono={r.is_required ? 'ambra' : 'grigio'}>{r.is_required ? 'manca' : 'facoltativo'}</Chip>
                          : <Chip tono={eFirmato(r.file_name) ? 'verde' : 'grigio'}>{eFirmato(r.file_name) ? 'firmato' : 'caricato'}</Chip>}
                      </span>
                      <span className="flex items-center justify-end gap-3">
                        {manca ? pulsanteCarica(r) : (
                          <>
                            <Azione onClick={() => apri(file)} icona={<Eye size={13} />}>Apri</Azione>
                            <Azione onClick={() => scarica(file)} icona={<Download size={13} />}>Scarica</Azione>
                          </>
                        )}
                        <button type="button" onClick={() => setAperte((p) => ({ ...p, [r.id]: !aperta }))} aria-expanded={aperta}
                          aria-label={`${aperta ? 'Chiudi' : 'Apri'} i dettagli di ${titolo}`} title={aperta ? 'Chiudi i dettagli' : 'Versioni e dettagli'}
                          className="p-1 rounded-md text-slate-500 hover:bg-slate-100">
                          {aperta ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </span>
                    </div>
                  </div>

                  {aperta && (
                    <div className="bg-slate-50 border-t border-slate-100 pl-4 md:pl-[52px] pr-4 py-2 text-[12.5px]" data-testid="versioni">
                      {r.is_uploaded && (
                        <div className="grid grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)_150px_auto] gap-x-3 gap-y-0.5 items-center py-1.5">
                          <span className="text-slate-800"><b>{eFirmato(r.file_name) ? 'Firmata' : 'Caricata'}</b> · quella che vale</span>
                          <span className="text-slate-500 truncate" title={r.file_name || undefined}>{r.file_name}</span>
                          <span className="text-slate-500">{quando(r.uploaded_at, r.uploaded_by_name)}</span>
                          <span className="flex items-center md:justify-end gap-3">
                            <Azione onClick={() => apri(file)} icona={<Eye size={13} />}>Apri</Azione>
                            <Azione onClick={() => scarica(file)} icona={<Download size={13} />}>Scarica</Azione>
                          </span>
                        </div>
                      )}
                      {sue.map((d) => (
                        <div key={chiaveFile(d)} className="grid grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)_150px_auto] gap-x-3 gap-y-0.5 items-center py-1.5 border-t border-slate-200/70">
                          <span className="text-slate-700">{r.is_uploaded ? 'Versione precedente' : 'Versione'}{eFirmato(d.file_name) ? '' : ', non firmata'}</span>
                          <span className="text-slate-500 truncate" title={d.file_name || undefined}>{d.file_name}</span>
                          <span className="text-slate-500">{quando(dataDelDoc(d), d.uploaded_by_name)}</span>
                          <span className="flex flex-wrap items-center md:justify-end gap-3">
                            <Azione onClick={() => apri(fileDelDoc(d))} icona={<Eye size={13} />}>Apri</Azione>
                            <Azione onClick={() => scarica(fileDelDoc(d))} icona={<Download size={13} />}>Scarica</Azione>
                            {dati.haAbbinamenti && (
                              <button type="button" onClick={() => sposta(d, null)} className="text-[12.5px] text-slate-500 hover:text-slate-800 hover:underline">Non è di questo documento</button>
                            )}
                            <button type="button" onClick={() => setDaTogliere({ tipo: 'doc', doc: d })} className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" title="Elimina questo file" aria-label={`Elimina ${d.file_name || 'il file'}`}><Trash2 size={13} /></button>
                          </span>
                        </div>
                      ))}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3 pt-1.5 mt-0.5 border-t border-slate-200/70 text-slate-500">
                        <span>{manca ? (sue.length ? 'La copia firmata non è ancora caricata.' : 'Trascina il file qui sopra oppure usa «Carica».') : 'Per aggiungere una versione trascina il file nel riquadro in alto.'}</span>
                        <button type="button" onClick={() => setDaTogliere({ tipo: 'riga', riga: r })} className="inline-flex items-center gap-1 text-slate-500 hover:text-red-600 whitespace-nowrap"><Trash2 size={13} />Togli dall'elenco</button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Aggiungere una riga all'elenco del contratto */}
      <div className="px-1">
        {nuovaRiga === null ? (
          <button type="button" onClick={() => setNuovaRiga('')} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-blue-600 hover:text-blue-800">
            <Plus size={14} />Aggiungi un documento all'elenco del contratto
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input autoFocus type="text" value={nuovaRiga} onChange={(e) => setNuovaRiga(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void aggiungiRiga(); if (e.key === 'Escape') setNuovaRiga(null) }}
              placeholder="Nome del documento (per esempio Planimetria, Visura)" aria-label="Nome del documento da aggiungere"
              className="flex-1 min-w-[220px] text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button type="button" onClick={() => void aggiungiRiga()} disabled={!nuovaRiga.trim()} className="px-3 py-1.5 text-[13px] font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">Aggiungi</button>
            <button type="button" onClick={() => setNuovaRiga(null)} className="px-3 py-1.5 text-[13px] rounded-lg border border-slate-300 hover:bg-slate-50">Annulla</button>
          </div>
        )}
      </div>

      {/* Altri documenti */}
      <section className={CARD} aria-label="Altri documenti">
        <h3 className="m-0 px-4 py-3 text-[14.5px] font-semibold text-slate-900 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-slate-200">
          <span className="flex items-center gap-2">{dati.righe.length > 0 ? 'Altri documenti' : 'Documenti'} <Chip tono="grigio">{altri.length}</Chip></span>
          <span className="text-[12.5px] font-normal text-slate-500">
            {dati.righe.length > 0 ? 'rinnovi, comunicazioni e file che non sono fra quelli del contratto' : 'contratto, rinnovi, comunicazioni'}
          </span>
        </h3>
        {altri.length > 6 && (
          <div className="relative mx-4 mt-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca fra gli altri documenti" aria-label="Cerca fra gli altri documenti"
              className="w-full pl-8 pr-3 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none" />
          </div>
        )}
        {altri.length === 0 ? (
          <div className="px-4 py-4 text-[13px] text-slate-500">Nessun altro documento. Quello che carichi e non è fra i documenti del contratto finisce qui.</div>
        ) : altriVisti.length === 0 ? (
          <div className="px-4 py-4 text-[13px] text-slate-500">Nessun documento per questa ricerca.</div>
        ) : (
          <div className="p-3 space-y-2.5">
            {gruppi.map((g, i) => {
              const aperto = meseAperto(g.mese, i)
              return (
                <div key={g.mese || 'senza-data'} className="rounded-xl border border-slate-200 overflow-hidden">
                  <button type="button" onClick={() => setMesiScelti((p) => ({ ...p, [g.mese]: !aperto }))} aria-expanded={aperto}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-left">
                    {aperto ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                    <span className="text-xs font-semibold text-slate-800">{etichettaMese(g.mese)}</span>
                    <span className="text-xs text-slate-500">· {g.righe.length} document{g.righe.length !== 1 ? 'i' : 'o'}</span>
                  </button>
                  {aperto && (
                    <ul>
                      {g.righe.map((d) => (
                        <li key={chiaveFile(d)} data-testid="altro-documento" className="px-3 py-2.5 border-t border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 break-words">{d.file_name}</div>
                            <div className="text-[12.5px] text-slate-500">
                              {[
                                dataDelDoc(d) ? `caricato il ${giorno(dataDelDoc(d))}${d.uploaded_by_name ? ` da ${d.uploaded_by_name}` : ''}` : '',
                                d.file_size ? `${(d.file_size / 1024 / 1024).toFixed(2)} MB` : '',
                              ].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 shrink-0">
                            {dati.haAbbinamenti && dati.righe.length > 0 && (
                              <select value="" onChange={(e) => { if (e.target.value) void sposta(d, e.target.value) }} aria-label={`Sposta ${d.file_name || 'il file'} in un documento del contratto`}
                                className="max-w-[220px] text-[12.5px] border border-slate-300 rounded-lg px-2 py-1 bg-white text-slate-700">
                                <option value="">Sposta in…</option>
                                {righe.map((r) => <option key={r.id} value={r.id}>{etichettaRiga(r.label).titolo}</option>)}
                              </select>
                            )}
                            <Azione onClick={() => apri(fileDelDoc(d))} icona={<Eye size={13} />}>Apri</Azione>
                            <Azione onClick={() => scarica(fileDelDoc(d))} icona={<Download size={13} />}>Scarica</Azione>
                            <button type="button" onClick={() => void apriStorico(d)} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" title="Storico delle versioni" aria-label={`Storico delle versioni di ${d.file_name || 'questo file'}`}><History size={14} /></button>
                            <button type="button" onClick={() => setDaTogliere({ tipo: 'doc', doc: d })} className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50" title="Elimina questo file" aria-label={`Elimina ${d.file_name || 'il file'}`}><Trash2 size={14} /></button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* La sola domanda del caricamento: il file prenderebbe il posto di quello che vale */}
      {domanda && (
        <Modal open onClose={() => domanda.rispondi('niente')} title="Questo file prenderebbe il posto di quello che vale" closeOnBackdrop={false} maxWidthClass="max-w-2xl">
          <div className="space-y-3 text-sm text-slate-700">
            <p>
              Per <b>{etichettaRiga(domanda.riga.label).titolo}</b> oggi vale <b>{domanda.riga.file_name}</b>
              {domanda.riga.uploaded_at ? `, caricato il ${giorno(domanda.riga.uploaded_at)}` : ''}.
            </p>
            <p>Stai caricando <b>{domanda.file.name}</b>. Se lo fai valere, la copia di oggi non si perde: resta fra le versioni precedenti.</p>
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-2">
              <button type="button" onClick={() => domanda.rispondi('niente')} className="whitespace-nowrap px-3 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50">Non caricarlo</button>
              <button type="button" onClick={() => domanda.rispondi('versione')} className="whitespace-nowrap px-3 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50">Tienilo come versione in più</button>
              <button type="button" onClick={() => domanda.rispondi('sostituisci')} className="whitespace-nowrap px-3 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700">Fai valere questo</button>
            </div>
          </div>
        </Modal>
      )}

      {daTogliere && (
        <Modal open onClose={() => setDaTogliere(null)} title={daTogliere.tipo === 'riga' ? 'Togliere il documento dall\'elenco?' : 'Eliminare il file?'}>
          <div className="space-y-4 text-sm text-slate-700">
            {daTogliere.tipo === 'riga' ? (
              <p>
                <b>{etichettaRiga(daTogliere.riga.label).titolo}</b> esce dall'elenco del contratto{daTogliere.riga.is_uploaded ? ' e il suo file viene eliminato' : ''}.
                {(versioni.get(daTogliere.riga.id)?.length ?? 0) > 0 ? ' Le altre versioni restano fra gli altri documenti.' : ''} Non si può annullare.
              </p>
            ) : (
              <p><b>{daTogliere.doc.file_name}</b> viene eliminato dall'archivio. Non si può annullare.</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDaTogliere(null)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 hover:bg-slate-50">Annulla</button>
              <button type="button" onClick={() => void confermaTogli()} disabled={togliendo} className="px-3 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{togliendo ? 'Sto eliminando…' : 'Elimina'}</button>
            </div>
          </div>
        </Modal>
      )}

      {storico && (
        <Modal open onClose={() => setStorico(null)} title="Storico delle versioni">
          <p className="text-sm text-slate-500 mb-3 break-words">{storico.doc.file_name}</p>
          {storico.versioni.length === 0 ? (
            <p className="text-sm text-slate-500">Nessuna versione precedente. Lo storico nasce quando ricarichi un file con lo stesso nome.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-auto">
              {storico.versioni.map((v) => (
                <li key={String(v.id)} className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 text-sm">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-xs font-mono">v{String(v.version_number ?? '')}</span>
                  <span className="min-w-0">
                    <span className="block text-slate-700 truncate">{String(v.file_name ?? '')}</span>
                    <span className="block text-xs text-slate-500">{quando(testo(v.created_at), testo(v.uploaded_by_name))}</span>
                  </span>
                  <span className="ml-auto">
                    <Azione onClick={() => scarica(v.file_path ? { titolo: '', file_name: String(v.file_name ?? ''), bucket: String(v.storage_bucket || BUCKET), path: String(v.file_path) } : null)} icona={<Download size={13} />}>Scarica</Azione>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {anteprima && (
        <Modal open onClose={chiudiAnteprima} bare ariaLabel="Anteprima del documento" containerClassName="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" panelClassName="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden flex flex-col h-[90dvh]">
          <div className="flex items-center justify-between gap-3 p-4 border-b border-slate-200 shrink-0">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-slate-900 truncate">{anteprima.titolo}</h3>
              {anteprima.file_name !== anteprima.titolo && <p className="text-xs text-slate-500 truncate">{anteprima.file_name}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {anteprima.signedUrl && (
                <button type="button" onClick={() => window.open(anteprima.signedUrl || '', '_blank')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"><Download size={14} />Scarica</button>
              )}
              <button type="button" onClick={chiudiAnteprima} className="p-2 rounded-lg hover:bg-slate-100" title="Chiudi" aria-label="Chiudi l'anteprima"><X size={20} /></button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {/\.pdf$/i.test(anteprima.file_name) ? (
              <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>}>
                <PdfViewer pdfData={anteprima.pdfData ?? undefined} url={anteprima.signedUrl || ''} />
              </Suspense>
            ) : /\.(jpg|jpeg|png|gif|webp)$/i.test(anteprima.file_name) ? (
              <div className="flex items-center justify-center h-full p-6">
                <img src={anteprima.blobUrl || anteprima.signedUrl || ''} alt={anteprima.file_name} className="max-w-full max-h-full rounded-lg shadow object-contain" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-slate-500 text-sm text-center p-6">
                <p>Questo tipo di file non si può vedere qui{/\.(docx?|xlsx?)$/i.test(anteprima.file_name) ? ' (Word o Excel)' : ''}: scaricalo per aprirlo.</p>
                {anteprima.signedUrl && <button type="button" onClick={() => window.open(anteprima.signedUrl || '', '_blank')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">Scarica il file</button>}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
