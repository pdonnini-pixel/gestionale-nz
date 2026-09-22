// Lettura degli estratti conto per completare le causali dei movimenti.
//
// L'open banking porta i movimenti ma su MPS la disposizione di bonifico arriva
// senza il nome di chi incassa: la causale finisce con «ORD.ORIG:» e basta.
// L'estratto conto della banca la stessa riga la scrive per esteso. Qui il file
// viene letto, le righe appaiate ai movimenti che abbiamo (stesso importo, data
// vicina) e la causale estesa scritta ACCANTO a quella originale, che non si
// tocca mai. Nessun movimento viene creato: quelli li porta l'open banking.
//
// Logica pura e testata in src/lib/estrattoConto.ts: qui c'e' solo il contorno.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, Loader2, FileSpreadsheet, Check, AlertTriangle, RefreshCw, Archive } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { fetchAllPaged } from '../lib/fetchAllPaged'
import { extractPdfLines } from '../lib/pdfText'
import {
  parseEcAoa, parseEcLines, matchEcRows, aggiornamentiDa, riepilogoEc,
  type EcMatch, type EcMovement, type EcParsed,
} from '../lib/estrattoConto'

type Props = { companyId: string | null; onRefresh?: () => void }

type FileArchivio = { name: string; path: string; size: number }

const eur = (n: number): string => n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const data = (s: string): string => s.split('-').reverse().join('/')

const ETICHETTE: Record<EcMatch['esito'], { testo: string; classe: string }> = {
  nuovo: { testo: 'causale da completare', classe: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  gia_presente: { testo: 'già completa', classe: 'bg-slate-50 text-slate-600 border-slate-200' },
  ambiguo: { testo: 'più movimenti uguali', classe: 'bg-amber-50 text-amber-700 border-amber-200' },
  senza_movimento: { testo: 'nessun movimento', classe: 'bg-slate-50 text-slate-500 border-slate-200' },
}

export default function EstrattiContoImport({ companyId, onRefresh }: Props) {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [archivio, setArchivio] = useState<FileArchivio[]>([])
  const [caricamento, setCaricamento] = useState(false)
  const [lettura, setLettura] = useState(false)
  const [scrittura, setScrittura] = useState(false)
  const [nomeFile, setNomeFile] = useState<string | null>(null)
  const [parsed, setParsed] = useState<EcParsed | null>(null)
  const [matches, setMatches] = useState<EcMatch[]>([])
  const [applicati, setApplicati] = useState<number | null>(null)

  // File di estratto conto gia' in archivio: si leggono dallo storage, dove il
  // caricamento li mette. Le carte hanno una loro sezione in Prima Nota: qui
  // servono solo i conti correnti.
  const caricaArchivio = useCallback(async () => {
    if (!companyId) return
    setCaricamento(true)
    try {
      const { data: files, error } = await supabase.storage.from('bank-statements').list(`${companyId}/imports/bank`, { limit: 200, sortBy: { column: 'name', order: 'desc' } })
      if (error) throw error
      const utili = (files ?? [])
        .filter((f) => /\.(xls|xlsx|pdf)$/i.test(f.name) && /\bEC\b|ESTRATTO/i.test(f.name) && !/CARTA|TASCA|PREPAGATA|CREDITO/i.test(f.name))
        .map((f) => ({ name: f.name, path: `${companyId}/imports/bank/${f.name}`, size: Number(f.metadata?.size ?? 0) }))
      setArchivio(utili)
    } catch (e) {
      console.warn('[estratti conto] archivio non leggibile:', (e as Error).message)
      setArchivio([])
    } finally {
      setCaricamento(false)
    }
  }, [companyId])

  useEffect(() => { void caricaArchivio() }, [caricaArchivio])

  const leggiFile = useCallback(async (file: File) => {
    if (!companyId) return
    setLettura(true)
    setApplicati(null)
    setNomeFile(file.name)
    try {
      let p: EcParsed
      if (/\.pdf$/i.test(file.name)) {
        p = parseEcLines(await extractPdfLines(file))
      } else {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true })
        // Si prende il foglio che produce piu' righe: gli export delle banche
        // mettono spesso una copertina davanti alla tabella vera.
        let migliore: EcParsed = { rows: [], columns: null, warnings: [] }
        for (const nome of wb.SheetNames) {
          const aoa = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, defval: null }) as unknown[][]
          const q = parseEcAoa(aoa)
          if (q.rows.length > migliore.rows.length) migliore = q
        }
        p = migliore
      }
      setParsed(p)

      if (p.rows.length === 0) { setMatches([]); return }

      const date = p.rows.map((r) => r.date).sort()
      const da = new Date(Date.parse(date[0]) - 5 * 86400000).toISOString().slice(0, 10)
      const a = new Date(Date.parse(date[date.length - 1]) + 5 * 86400000).toISOString().slice(0, 10)

      const movimenti = await fetchAllPaged<EcMovement>(
        (from, to) => supabase.from('bank_transactions')
          .select('id, transaction_date, amount, description, counterpart, statement_description')
          .eq('company_id', companyId).gte('transaction_date', da).lte('transaction_date', a)
          .order('id', { ascending: true }).range(from, to),
        'bank_transactions per estratto conto',
      )
      setMatches(matchEcRows(p.rows, movimenti))
    } catch (e) {
      toast({ type: 'error', message: `Non sono riuscito a leggere il file: ${(e as Error).message}` })
      setParsed(null)
      setMatches([])
    } finally {
      setLettura(false)
    }
  }, [companyId, toast])

  const leggiDaArchivio = useCallback(async (f: FileArchivio) => {
    setLettura(true)
    try {
      const { data: blob, error } = await supabase.storage.from('bank-statements').download(f.path)
      if (error) throw error
      await leggiFile(new File([blob], f.name))
    } catch (e) {
      toast({ type: 'error', message: `File in archivio non scaricabile: ${(e as Error).message}` })
      setLettura(false)
    }
  }, [leggiFile, toast])

  const daScrivere = useMemo(() => aggiornamentiDa(matches), [matches])
  const riepilogo = useMemo(() => riepilogoEc(matches), [matches])

  const scrivi = useCallback(async () => {
    if (daScrivere.length === 0) return
    setScrittura(true)
    try {
      const { data: esito, error } = await supabase.rpc('apply_statement_enrichment', {
        p_rows: daScrivere as never, p_source: nomeFile ?? undefined,
      })
      if (error) throw error
      const scritte = Number((esito as { causali_scritte?: number } | null)?.causali_scritte ?? 0)
      const controparti = Number((esito as { controparti_scritte?: number } | null)?.controparti_scritte ?? 0)
      setApplicati(scritte)
      toast({ type: 'success', message: `${scritte} causali completate, ${controparti} beneficiari scritti dove mancavano.` })
      onRefresh?.()
    } catch (e) {
      toast({ type: 'error', message: `Scrittura non riuscita: ${(e as Error).message}` })
    } finally {
      setScrittura(false)
    }
  }, [daScrivere, nomeFile, onRefresh, toast])

  const riabbina = useCallback(async () => {
    setScrittura(true)
    try {
      const { data: esito, error } = await supabase.rpc('rerun_bijective_reconciliation')
      if (error) throw error
      const coppie = Number((esito as { coppie_abbinate?: number } | null)?.coppie_abbinate ?? 0)
      toast({ type: coppie > 0 ? 'success' : 'info', message: coppie > 0 ? `${coppie} movimenti agganciati alle loro fatture.` : 'Nessun nuovo abbinamento: le causali non bastano a riconoscere un fornitore.' })
      onRefresh?.()
    } catch (e) {
      toast({ type: 'error', message: `Riconciliazione non riuscita: ${(e as Error).message}` })
    } finally {
      setScrittura(false)
    }
  }, [onRefresh, toast])

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-slate-500" /> Causali dall'estratto conto
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl">
            La banca manda i bonifici senza il nome di chi incassa: nell'estratto conto quel nome c'è.
            Carica il file (Excel o PDF) e le causali dei movimenti che già abbiamo vengono completate,
            così il motore può agganciarli alle fatture. I movimenti non si toccano: si aggiunge solo il testo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef} type="file" accept=".xls,.xlsx,.pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void leggiFile(f); e.target.value = '' }}
          />
          <button
            type="button" onClick={() => inputRef.current?.click()} disabled={lettura || !companyId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {lettura ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />} Scegli un file
          </button>
        </div>
      </div>

      {archivio.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1.5">
            <Archive size={12} /> Già in archivio
          </div>
          <div className="flex flex-wrap gap-1.5">
            {archivio.slice(0, 12).map((f) => (
              <button
                key={f.path} type="button" onClick={() => void leggiDaArchivio(f)} disabled={lettura}
                className="px-2.5 py-1 rounded-md border border-slate-200 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title={f.name}
              >
                {f.name.replace(/^\d+_/, '').replace(/ARCHIVIO_EC_NEW_ZAGO_|Conti_correnti_/gi, '').replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>
      )}
      {caricamento && <div className="text-xs text-slate-400 mb-2">Cerco i file in archivio…</div>}

      {parsed && (
        <>
          {parsed.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-3">
              {parsed.warnings.map((w) => (
                <div key={w} className="text-xs text-amber-800 flex items-start gap-1.5"><AlertTriangle size={13} className="mt-px shrink-0" /> {w}</div>
              ))}
            </div>
          )}

          {parsed.rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600 mb-3">
              <span><strong className="text-slate-900">{riepilogo.righe}</strong> righe lette da {nomeFile}</span>
              <span className="text-emerald-700"><strong>{riepilogo.nuovi}</strong> da completare</span>
              <span><strong>{riepilogo.con_beneficiario}</strong> con beneficiario riconosciuto</span>
              <span className="text-slate-500">{riepilogo.gia_presenti} già complete</span>
              {riepilogo.ambigui > 0 && <span className="text-amber-700">{riepilogo.ambigui} ambigue, lasciate stare</span>}
              {riepilogo.senza_movimento > 0 && <span className="text-slate-400">{riepilogo.senza_movimento} senza movimento</span>}
            </div>
          )}

          {matches.filter((m) => m.esito === 'nuovo').length > 0 && (
            <div className="overflow-x-auto border border-slate-200 rounded-lg mb-3">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Data</th>
                    <th className="text-right font-medium px-3 py-2">Importo</th>
                    <th className="text-left font-medium px-3 py-2">Beneficiario</th>
                    <th className="text-left font-medium px-3 py-2">Causale dall'estratto conto</th>
                    <th className="text-left font-medium px-3 py-2">Esito</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matches.filter((m) => m.esito === 'nuovo').slice(0, 40).map((m, i) => (
                    <tr key={`${m.row.date}-${m.row.amount}-${i}`} className="hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{data(m.row.date)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-medium text-slate-900">{eur(m.row.amount)}</td>
                      <td className="px-3 py-2 text-slate-900">{m.beneficiario ?? <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-slate-600 max-w-md truncate" title={m.row.description}>{m.row.description}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] ${ETICHETTE[m.esito].classe}`}>{ETICHETTE[m.esito].testo}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button" onClick={() => void scrivi()} disabled={scrittura || daScrivere.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              {scrittura ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Completa {daScrivere.length} causali
            </button>
            {applicati !== null && (
              <button
                type="button" onClick={() => void riabbina()} disabled={scrittura}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={14} /> Riprova l'abbinamento alle fatture
              </button>
            )}
            {applicati !== null && <span className="text-xs text-emerald-700">{applicati} causali scritte.</span>}
          </div>
        </>
      )}
    </div>
  )
}
