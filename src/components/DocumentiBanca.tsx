// Documenti banca: la porta unica da cui si caricano gli estratti (R27, R28).
//
// Sabrina trascina i file. Per ognuno il gestionale capisce da solo che cos'e'
// (dal contenuto) e di quale conto, lo archivia e lo applica: il documento
// della banca comanda. Estratto conto → `apply_bank_statement`, estratto carta →
// `apply_card_statement`, distinta RiBa MPS → `apply_riba_distinta` (lato
// database). Quello che non sa decidere non lo indovina: lo chiede nella chat.
//
// Logica pura e testata in src/lib/documentiBanca.ts: qui c'e' solo il contorno.

import { useCallback, useMemo, useRef, useState } from 'react'
import { FileUp, Loader2, Check, AlertTriangle, FileText, Info, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { extractPdfLines } from '../lib/pdfText'
import { archiviaFile, collegaFileArchiviato } from '../lib/archivioFile'
import {
  trovaConto, contoDaiMovimenti, righeIntestazione, classificaDocumento, saldiDichiarati, periodoDelle, righePerDb, leggiEstratto,
  righeDaFoglio, fraseEsito, chiusuraCaricamento, ETICHETTA_TIPO, leggiCarta, righeCartaPerDb, fraseEsitoCarta,
  leggiDistintaMps, fraseEsitoDistinta, motivoNonSupportato,
  type ContoLite, type ContoTrovato, type TipoDocumento, type EsitoApplicazione,
  type EsitoCarta, type EsitoDistinta, type DistintaRiba,
} from '../lib/documentiBanca'
import { sourceLabelOf, type CardStatementParsed } from '../lib/cartaEstratto'
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
  /** Esito gia' in parole (carte, distinte). */
  frase?: string
  /** Domande nuove aperte da questo file, per il messaggio di fine percorso. */
  domande?: number
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

// Dove si caricano, per ora, i documenti che qui non si applicano.
const DOVE: Partial<Record<TipoDocumento, string>> = {
  commissioni: 'Gli estratti commissioni Nexi/Amex per ora si caricano in Banche → Commissioni.',
  sconosciuto: 'Non ho riconosciuto il documento: non è stato toccato niente.',
}

// Lo stato della distinta che dice che la banca l'ha presa in carico.
const RE_STATO_OK = /RICEVUT|ESEGUIT|PAGAT|ACCOLT|CONTABILIZZAT/i

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

      const es = esito as unknown as EsitoApplicazione
      aggiorna(v.key, { stato: 'fatto', esito: es, domande: es.domande_nuove ?? 0 })
      setChatKey((k) => k + 1)
      onRefresh?.()
    } catch (e) {
      aggiorna(v.key, { stato: 'errore', messaggio: e instanceof Error ? e.message : String(e) })
    }
  }, [aggiorna, companyId, onRefresh, userId])

  const applicaCarta = useCallback(async (v: Voce, carta: CardStatementParsed, hash: string) => {
    if (!companyId) return
    aggiorna(v.key, { stato: 'applicazione' })
    try {
      const periodo = carta.period
      const last4 = carta.cards[0]?.card_last4 ?? null
      const etichetta = sourceLabelOf(carta.issuer, last4)
      const totale = carta.total_declared ?? carta.total_computed
      // Lo stesso file, o lo stesso estratto (carta e mese) gia' caricato: si riusa.
      let statementId: string | null = null
      const { data: perHash } = await supabase.from('bank_statements')
        .select('id').eq('company_id', companyId).eq('content_hash', hash).maybeSingle()
      statementId = (perHash as { id: string } | null)?.id ?? null
      if (!statementId && periodo && last4) {
        const { data: perCarta } = await supabase.from('bank_statements')
          .select('id').eq('company_id', companyId).eq('doc_kind', 'carta').eq('card_last4', last4)
          .eq('period_year', periodo.year).eq('period_month', periodo.month).limit(1)
        const vecchio = ((perCarta ?? []) as Array<{ id: string }>)[0]?.id ?? null
        if (vecchio) {
          // Estratto della stessa carta e mese gia' caricato da Prima nota con un altro
          // file: le sue righe e i loro abbinamenti restano come sono (dati gia' presenti).
          const { count } = await supabase.from('card_transactions').select('id', { count: 'exact', head: true }).eq('statement_id', vecchio)
          if ((count ?? 0) > 0) {
            aggiorna(v.key, { stato: 'altro', messaggio: `L'estratto ${etichetta} di ${String(periodo.month).padStart(2, '0')}/${periodo.year} era già stato caricato da Prima nota: per non toccare i dati già presenti non lo rielaboro.` })
            return
          }
          statementId = vecchio
          await supabase.from('bank_statements').update({ statement_total: totale, transaction_count: carta.lines.length, content_hash: hash }).eq('id', statementId)
        }
      }
      if (!statementId) {
        const arch = await archiviaFile({
          file: v.file, companyId, userId, modulo: 'Banche', funzione: `Estratto carta · ${etichetta}`,
          bucket: 'bank-statements', year: periodo?.year ?? null, month: periodo?.month ?? null, referenceTable: 'bank_statements',
        })
        if (arch.errore) throw new Error(`il file non è finito in archivio (${arch.errore})`)
        const ext = (v.file.name.split('.').pop() ?? '').toLowerCase()
        const { data: ins, error: iErr } = await supabase.from('bank_statements').insert({
          company_id: companyId, bank_account_id: null, filename: v.file.name,
          file_type: ext === 'pdf' ? 'pdf' : ext === 'csv' ? 'csv' : 'xlsx',
          doc_kind: 'carta', status: 'processing', source_label: etichetta, card_last4: last4,
          statement_total: totale, transaction_count: carta.lines.length, closing_balance: carta.available_balance,
          period_year: periodo?.year ?? null, period_month: periodo?.month ?? null,
          content_hash: hash, import_document_id: arch.id, file_url: arch.path, uploaded_by: userId,
        }).select('id').single()
        if (iErr) throw iErr
        statementId = (ins as { id: string }).id
        await collegaFileArchiviato(arch.id, 'bank_statements', statementId)
      }
      const { data: esito, error } = await supabase.rpc('apply_card_statement', {
        p_statement_id: statementId,
        p_lines: righeCartaPerDb(carta) as never,
        p_debit_date: carta.debit_date ?? undefined,
      })
      if (error) throw error
      const es = esito as unknown as EsitoCarta
      aggiorna(v.key, { stato: 'fatto', frase: fraseEsitoCarta(es), domande: es.domande_nuove ?? 0 })
      setChatKey((k) => k + 1)
      onRefresh?.()
    } catch (e) {
      aggiorna(v.key, { stato: 'errore', messaggio: e instanceof Error ? e.message : String(e) })
    }
  }, [aggiorna, companyId, onRefresh, userId])

  const applicaDistinta = useCallback(async (v: Voce, dist: DistintaRiba, hash: string, dalPdf: boolean) => {
    if (!companyId) return
    aggiorna(v.key, { stato: 'applicazione' })
    try {
      // La stessa distinta (stesso file o stesso numero di supporto) non si registra due volte.
      let distintaId: string | null = null
      const { data: perHash } = await supabase.from('riba_distinte')
        .select('id').eq('company_id', companyId).eq('content_hash', hash).maybeSingle()
      distintaId = (perHash as { id: string } | null)?.id ?? null
      if (!distintaId && dist.supporto) {
        const { data: perSupporto } = await supabase.from('riba_distinte')
          .select('id').eq('company_id', companyId).eq('supporto', dist.supporto).maybeSingle()
        distintaId = (perSupporto as { id: string } | null)?.id ?? null
      }
      if (!distintaId) {
        const anno = dist.dataCreazione ? Number(dist.dataCreazione.slice(0, 4)) : null
        const mese = dist.dataCreazione ? Number(dist.dataCreazione.slice(5, 7)) : null
        const arch = await archiviaFile({
          file: v.file, companyId, userId, modulo: 'Banche', funzione: `Distinta RiBa · ${dist.supporto ?? v.file.name}`,
          bucket: 'bank-statements', year: anno, month: mese, referenceTable: 'riba_distinte',
        })
        if (arch.errore) throw new Error(`il file non è finito in archivio (${arch.errore})`)
        const { data: ins, error: iErr } = await supabase.from('riba_distinte').insert({
          company_id: companyId, file_name: v.file.name, file_path: arch.path, source_kind: dalPdf ? 'pdf' : 'xlsx',
          status: 'bozza', content_hash: hash, supporto: dist.supporto, doc_date: dist.dataCreazione,
          bank_stato: dist.stato, conto_testo: dist.conto, declared_total: dist.totale,
          line_count: dist.disposizioni.length, created_by: userId, import_document_id: arch.id,
        }).select('id').single()
        if (iErr) throw iErr
        distintaId = (ins as { id: string }).id
        await collegaFileArchiviato(arch.id, 'riba_distinte', distintaId)
      }
      const { data: esito, error } = await supabase.rpc('apply_riba_distinta', {
        p_distinta_id: distintaId,
        p_lines: dist.disposizioni as never,
        p_conto: dist.conto ?? undefined,
      })
      if (error) throw error
      const es = esito as unknown as EsitoDistinta
      let frase = fraseEsitoDistinta(es)
      if (dist.nDichiarate != null && dist.nDichiarate !== dist.disposizioni.length) {
        frase += ` Attenzione: la distinta dichiara ${dist.nDichiarate} effetti e ne ho letti ${dist.disposizioni.length}.`
      }
      aggiorna(v.key, { stato: 'fatto', frase, domande: es.domande_nuove ?? 0 })
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
      let fogli: unknown[][][] = []
      if (dalPdf) {
        righeTesto = await extractPdfLines(file)
        parsed = leggiEstratto({ righePdf: righeTesto })
      } else {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true })
        fogli = wb.SheetNames.map((n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) as unknown[][])
        righeTesto = fogli.flatMap(righeDaFoglio)
        parsed = leggiEstratto({ fogli })
      }
      // Scansioni, distinte di versamento, prospetti dei fornitori: non si leggono qui.
      const nonQui = motivoNonSupportato({ nome: file.name, righe: righeTesto, dalPdf })
      if (nonQui) {
        aggiorna(key, { stato: 'altro', tipo: 'sconosciuto', messaggio: nonQui })
        return
      }
      const testo = righeTesto.join('\n')
      const intestazione = righeIntestazione(righeTesto, parsed.rows)
      let conto = trovaConto(intestazione.join('\n'), accounts)
      let tipo = classificaDocumento({ testo, righe: righeTesto, conto, righeEstratto: parsed.rows.length, intestazione })

      if (tipo === 'estratto_carta') {
        const carta = leggiCarta(dalPdf ? { righePdf: righeTesto } : { fogli })
        if (carta.lines.length > 0 && carta.issuer !== 'generico') {
          aggiorna(key, { tipo })
          await applicaCarta({ ...voce, tipo }, carta, hash)
          return
        }
        if (carta.issuer === 'generico' && carta.lines.length > 0) {
          aggiorna(key, { stato: 'altro', tipo, messaggio: 'Estratto carta di un emittente che non conosco: si leggono Carta Montepaschi, CartaBCC (Numia) e la prepagata Tasca. Non è stato toccato niente.' })
          return
        }
        // Nessuna spesa letta ma righe da estratto conto («Lista movimenti» Intesa): e' un conto.
        if (parsed.rows.length > 0) tipo = 'estratto_conto'
      }
      if (tipo === 'distinta_riba') {
        const dist = leggiDistintaMps(righeTesto)
        if (!dist || dist.disposizioni.length === 0) {
          aggiorna(key, { stato: 'altro', tipo, messaggio: 'Di questa distinta non riesco a leggere gli effetti: si legge la «Distinta di ritiro effetti pagati» di MPS in PDF. Le altre per ora si caricano da Scadenzario → «Carica distinta RiBa».' })
          return
        }
        if (dist.stato && !RE_STATO_OK.test(dist.stato)) {
          aggiorna(key, { stato: 'altro', tipo, messaggio: `La distinta è nello stato «${dist.stato}»: si applica quando la banca l'ha ricevuta. Non è stato toccato niente.` })
          return
        }
        aggiorna(key, { tipo })
        await applicaDistinta({ ...voce, tipo }, dist, hash, dalPdf)
        return
      }
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
      const pronta: Voce = { ...voce, tipo, conto, hash, righe, saldi: parsed.saldi ?? saldiDichiarati(intestazione) }
      if (!conto) {
        aggiorna(key, { ...pronta, stato: 'scegli_conto', messaggio: 'Nel file non c\'è l\'IBAN e i movimenti non bastano a capire il conto: dimmi tu di quale conto è.' })
        return
      }
      aggiorna(key, pronta)
      await applica(pronta, conto)
    } catch (e) {
      aggiorna(key, { stato: 'errore', messaggio: `Non sono riuscito a leggere il file: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [accounts, aggiorna, applica, applicaCarta, applicaDistinta])

  // Il messaggio di fine percorso: senza, una lista di righe verdi non dice
  // se il lavoro e' finito e se resta qualcosa da fare.
  const chiusura = useMemo(() => chiusuraCaricamento({
    inCorso: voci.filter((v) => v.stato === 'lettura' || v.stato === 'applicazione').length,
    fatti: voci.filter((v) => v.stato === 'fatto').length,
    nonCaricati: voci.filter((v) => v.stato === 'altro').length,
    errori: voci.filter((v) => v.stato === 'errore').length,
    daScegliere: voci.filter((v) => v.stato === 'scegli_conto').length,
    domande: voci.reduce((n, v) => n + (v.stato === 'fatto' ? v.domande ?? 0 : 0), 0),
  }), [voci])

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
        <h3 className="mt-2 text-sm font-semibold text-slate-900">Carica i documenti della banca</h3>
        <p className="mt-1 text-xs text-slate-500 max-w-xl mx-auto">
          Trascina qui estratti conto, estratti carta e distinte RiBa, anche più file insieme e di mesi diversi (Excel o PDF).
          Il gestionale capisce da solo che documento è e di che conto o carta, lo archivia e lo applica:
          il documento della banca comanda. Se qualcosa non torna te lo chiede qui sotto.
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

      <details className="bg-white rounded-xl border border-slate-200 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-slate-900">Cosa puoi caricare qui (e cosa no)</summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2 text-xs text-slate-600">
          <div>
            <div className="font-semibold text-emerald-800 mb-1">Si carica e si analizza</div>
            <ul className="list-disc pl-4 space-y-1">
              <li><b>Estratti conto corrente</b> in Excel o PDF (provati sugli estratti veri di MPS, BCC Figline, BCC Mugello e Intesa). I PDF BCC («Relax Banking») valgono come l&apos;Excel: portano segno e saldi. Per gli altri PDF meglio l&apos;Excel, perché dal PDF non si legge se un movimento è un&apos;entrata o un&apos;uscita.</li>
              <li><b>Estratti carta di credito</b> Carta Montepaschi e CartaBCC (Numia), in PDF: le spese confermano le fatture pagate con la carta e l&apos;addebito del mese si aggancia sul conto.</li>
              <li><b>Prepagata Tasca</b>, in PDF o Excel: le spese chiudono le fatture alla data della spesa.</li>
              <li><b>Distinta di ritiro effetti pagati</b> MPS (RiBa), in PDF: ogni effetto conferma o chiude le rate del fornitore indicate nella causale.</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-slate-800 mb-1">Non si carica qui</div>
            <ul className="list-disc pl-4 space-y-1">
              <li><b>PDF scansionati</b> (fotografie o immagini): non hanno testo da leggere. Scarica dalla banca il PDF o l&apos;Excel originale.</li>
              <li><b>Distinte di versamento contanti</b>: non servono, i versamenti arrivano dalle chiusure di cassa e l&apos;estratto conto li conferma.</li>
              <li><b>Prospetti dei fornitori</b> (per esempio «Analisi scadenze» di un fornitore): non sono documenti della banca e non comandano sui pagamenti.</li>
              <li><b>Estratti commissioni Nexi/Amex</b>: per ora si caricano in Banche → Commissioni.</li>
              <li><b>Distinte RiBa diverse da quella MPS</b> e carte di altri emittenti: per ora non si leggono; il file non viene toccato e te lo dico.</li>
            </ul>
          </div>
        </div>
      </details>

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
                {v.stato === 'fatto' && (v.esito || v.frase) && (
                  <span className="inline-flex items-start gap-1.5 text-emerald-800">
                    <Check size={15} className="mt-0.5 shrink-0" /> {v.frase ?? (v.esito ? fraseEsito(v.esito) : '')}
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

      {chiusura && (
        <div
          role="status"
          className={`rounded-xl border p-4 flex items-start gap-3 ${
            chiusura.tono === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : chiusura.tono === 'errore' ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'}`}
        >
          {chiusura.tono === 'ok'
            ? <CheckCircle2 size={22} className="shrink-0 text-emerald-600" />
            : <AlertTriangle size={22} className="shrink-0" />}
          <div>
            <div className="font-semibold">{chiusura.titolo}</div>
            <div className="text-sm mt-0.5">{chiusura.testo}</div>
          </div>
        </div>
      )}

      <ChatDocumentiBanca key={chatKey} companyId={companyId} />
    </div>
  )
}
