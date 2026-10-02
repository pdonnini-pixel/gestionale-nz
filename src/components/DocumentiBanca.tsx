// Documenti banca: la porta unica da cui si caricano gli estratti (R27, R28).
//
// Sabrina trascina i file. Per ognuno il gestionale capisce da solo che cos'e'
// (dal contenuto) e di quale conto (dall'IBAN), lo archivia e lo applica:
// l'estratto conto comanda, quindi conferma, corregge o aggiunge i movimenti
// (funzione `apply_bank_statement`, lato database). Quello che non sa decidere
// non lo indovina: lo chiede nella chat qui sotto.
//
// Logica pura e testata in src/lib/documentiBanca.ts: qui c'e' solo il contorno.

import { useCallback, useRef, useState } from 'react'
import { FileUp, Loader2, Check, AlertTriangle, FileText, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { extractPdfLines } from '../lib/pdfText'
import { archiviaFile, collegaFileArchiviato } from '../lib/archivioFile'
import {
  trovaConto, contoDaiMovimenti, righeIntestazione, classificaDocumento, saldiDichiarati, periodoDelle, righePerDb, leggiEstratto,
  righeDaFoglio, fraseEsito, ETICHETTA_TIPO,
  type ContoLite, type ContoTrovato, type TipoDocumento, type EsitoApplicazione,
} from '../lib/documentiBanca'
import ChatDocumentiBanca from './ChatDocumentiBanca'

type Props = { companyId: string | null; accounts: ContoLite[]; onRefresh?: () => void }

type Stato = 'lettura' | 'scegli_conto' | 'applicazione' | 'fatto' | 'altro' | 'errore'

type Voce = {
  key: string
  file: File
  stato: Stato
  tipo?: TipoDocumento
  conto?: ContoLite | null
  messaggio?: string
  esito?: EsitoApplicazione
  // dati letti, tenuti per applicare dopo la scelta del conto
  righe?: ReturnType<typeof righePerDb>
  saldi?: { iniziale: number | null; finale: number | null }
  hash?: string
}

const sha256 = async (buf: ArrayBuffer): Promise<string> => {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const nomeConto = (c: ContoLite): string => {
  const iban = (c.iban || c.account_name || '').replace(/\s/g, '')
  return `${c.bank_name ?? 'Conto'}${iban ? ` …${iban.slice(-6)}` : ''}`
}

// Dove si completano, per ora, i documenti che non sono estratti di conto corrente.
const DOVE: Partial<Record<TipoDocumento, string>> = {
  estratto_carta: 'Gli estratti carta per ora si caricano in Banche → Prima nota → Carte.',
  distinta_riba: 'Le distinte RiBa per ora si caricano in Scadenzario → «Carica distinta RiBa».',
  commissioni: 'Gli estratti commissioni per ora si caricano in Banche → Commissioni.',
  sconosciuto: 'Non ho riconosciuto il documento: non è stato toccato niente.',
}

export default function DocumentiBanca({ companyId, accounts, onRefresh }: Props) {
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const inputRef = useRef<HTMLInputElement>(null)
  const [voci, setVoci] = useState<Voce[]>([])
  const [trascina, setTrascina] = useState(false)
  const [chatKey, setChatKey] = useState(0)

  const aggiorna = useCallback((key: string, patch: Partial<Voce>) => {
    setVoci((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)))
  }, [])

  const applica = useCallback(async (v: Voce, conto: ContoLite) => {
    if (!companyId || !v.righe || !v.hash) return
    aggiorna(v.key, { stato: 'applicazione', conto, messaggio: undefined })
    try {
      const periodo = periodoDelle(v.righe)
      // Lo stesso file gia' caricato: si riusa il suo estratto, niente doppio archivio.
      const { data: esistente } = await supabase.from('bank_statements')
        .select('id').eq('company_id', companyId).eq('content_hash', v.hash).maybeSingle()
      let statementId = (esistente as { id: string } | null)?.id ?? null

      if (!statementId) {
        const etichetta = nomeConto(conto)
        const arch = await archiviaFile({
          file: v.file, companyId, userId, modulo: 'Banche', funzione: `Estratto conto · ${etichetta}`,
          bucket: 'bank-statements', year: periodo?.year ?? null, month: periodo?.month ?? null, referenceTable: 'bank_statements',
        })
        if (arch.errore) throw new Error(`il file non è finito in archivio (${arch.errore})`)
        const ext = (v.file.name.split('.').pop() ?? '').toLowerCase()
        const { data: ins, error: iErr } = await supabase.from('bank_statements').insert({
          company_id: companyId, bank_account_id: conto.id, filename: v.file.name,
          file_type: ext === 'pdf' ? 'pdf' : ext === 'csv' ? 'csv' : 'xlsx',
          doc_kind: 'conto_corrente', status: 'processing', source_label: etichetta,
          period_year: periodo?.year ?? null, period_month: periodo?.month ?? null,
          content_hash: v.hash, import_document_id: arch.id, file_url: arch.path, uploaded_by: userId,
        }).select('id').single()
        if (iErr) throw iErr
        statementId = (ins as { id: string }).id
        await collegaFileArchiviato(arch.id, 'bank_statements', statementId)
      }

      const { data: esito, error } = await supabase.rpc('apply_bank_statement', {
        p_statement_id: statementId,
        p_rows: v.righe as never,
        p_opening: v.saldi?.iniziale ?? undefined,
        p_closing: v.saldi?.finale ?? undefined,
      })
      if (error) throw error

      // Con le causali estese il motore riconosce piu' fornitori: si riprova
      // subito l'abbinamento invece di aspettare il giro notturno.
      try { await supabase.rpc('rerun_bijective_reconciliation') } catch { /* il giro notturno lo rifa' */ }

      aggiorna(v.key, { stato: 'fatto', esito: esito as unknown as EsitoApplicazione })
      setChatKey((k) => k + 1)
      onRefresh?.()
    } catch (e) {
      aggiorna(v.key, { stato: 'errore', messaggio: e instanceof Error ? e.message : String(e) })
    }
  }, [aggiorna, companyId, onRefresh, userId])

  const leggi = useCallback(async (file: File) => {
    const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`
    const voce: Voce = { key, file, stato: 'lettura' }
    setVoci((vs) => [voce, ...vs])
    try {
      const buf = await file.arrayBuffer()
      const hash = await sha256(buf)
      const dalPdf = /\.pdf$/i.test(file.name)
      let righeTesto: string[]
      let parsed
      if (dalPdf) {
        righeTesto = await extractPdfLines(file)
        parsed = leggiEstratto({ righePdf: righeTesto })
      } else {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true })
        const fogli = wb.SheetNames.map((n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) as unknown[][])
        righeTesto = fogli.flatMap(righeDaFoglio)
        parsed = leggiEstratto({ fogli })
      }
      const testo = righeTesto.join('\n')
      const intestazione = righeIntestazione(righeTesto, parsed.rows)
      let conto = trovaConto(intestazione.join('\n'), accounts)
      const tipo = classificaDocumento({ testo, righe: righeTesto, conto, righeEstratto: parsed.rows.length, intestazione })

      if (tipo !== 'estratto_conto') {
        aggiorna(key, { stato: 'altro', tipo, messaggio: DOVE[tipo] })
        return
      }
      const righe = righePerDb(parsed, dalPdf)
      if (!conto) {
        // Nessun IBAN nell'intestazione (gli Excel MPS e BCC non lo portano): il
        // conto e' quello su cui il gestionale ritrova i movimenti del file.
        const { data: trovati } = await supabase.rpc('fn_bank_doc_guess_account', { p_rows: righe as never })
        conto = contoDaiMovimenti((trovati ?? []) as ContoTrovato[], accounts)
      }
      const pronta: Voce = { ...voce, tipo, conto, hash, righe, saldi: saldiDichiarati(intestazione) }
      if (!conto) {
        aggiorna(key, { ...pronta, stato: 'scegli_conto', messaggio: 'Nel file non c\'è l\'IBAN e i movimenti non bastano a capire il conto: dimmi tu di quale conto è.' })
        return
      }
      aggiorna(key, pronta)
      await applica(pronta, conto)
    } catch (e) {
      aggiorna(key, { stato: 'errore', messaggio: `Non sono riuscito a leggere il file: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [accounts, aggiorna, applica])

  const caricaFile = useCallback((lista: FileList | File[] | null) => {
    if (!lista) return
    for (const f of Array.from(lista)) void leggi(f)
  }, [leggi])

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setTrascina(true) }}
        onDragLeave={() => setTrascina(false)}
        onDrop={(e) => { e.preventDefault(); setTrascina(false); caricaFile(e.dataTransfer.files) }}
        className={`bg-white rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition ${trascina ? 'border-blue-400 bg-blue-50' : 'border-slate-300'}`}
      >
        <FileUp size={28} className="mx-auto text-slate-400" />
        <h3 className="mt-2 text-sm font-semibold text-slate-900">Carica gli estratti della banca</h3>
        <p className="mt-1 text-xs text-slate-500 max-w-xl mx-auto">
          Trascina qui i file, anche più di uno e anche di mesi diversi (Excel o PDF).
          Il gestionale capisce da solo di che conto sono, li archivia e controlla ogni movimento:
          l&apos;estratto della banca comanda. Se qualcosa non torna te lo chiede qui sotto.
        </p>
        <input
          ref={inputRef} type="file" multiple accept=".xls,.xlsx,.csv,.pdf" className="hidden"
          onChange={(e) => { caricaFile(e.target.files); e.target.value = '' }}
        />
        <button
          type="button" onClick={() => inputRef.current?.click()} disabled={!companyId}
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
        >
          <FileUp size={15} /> Scegli i file
        </button>
      </div>

      {voci.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {voci.map((v) => (
            <div key={v.key} className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
              <div className="flex items-center gap-2 min-w-0 sm:w-72 shrink-0">
                <FileText size={16} className="text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate" title={v.file.name}>{v.file.name}</div>
                  <div className="text-xs text-slate-500">
                    {v.tipo ? ETICHETTA_TIPO[v.tipo] : 'lettura…'}
                    {v.conto ? ` · ${nomeConto(v.conto)}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex-1 text-sm">
                {(v.stato === 'lettura' || v.stato === 'applicazione') && (
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <Loader2 size={14} className="animate-spin" /> {v.stato === 'lettura' ? 'Leggo il file…' : 'Controllo i movimenti…'}
                  </span>
                )}
                {v.stato === 'fatto' && v.esito && (
                  <span className="inline-flex items-start gap-1.5 text-emerald-800">
                    <Check size={15} className="mt-0.5 shrink-0" /> {fraseEsito(v.esito)}
                  </span>
                )}
                {v.stato === 'altro' && (
                  <span className="inline-flex items-start gap-1.5 text-slate-600">
                    <Info size={15} className="mt-0.5 shrink-0" /> {v.messaggio}
                  </span>
                )}
                {v.stato === 'errore' && (
                  <span className="inline-flex items-start gap-1.5 text-red-700">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {v.messaggio}
                  </span>
                )}
                {v.stato === 'scegli_conto' && (
                  <div className="space-y-2">
                    <div className="text-amber-800">{v.messaggio}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {accounts.filter((c) => c.is_active !== false).map((c) => (
                        <button
                          key={c.id} type="button" onClick={() => void applica(v, c)}
                          className="px-2.5 py-1 rounded-md border border-slate-300 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          {nomeConto(c)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ChatDocumentiBanca key={chatKey} companyId={companyId} />
    </div>
  )
}
