// Scheda «Commissioni» dentro Banche, accanto alla Prima Nota.
//
// Mostra quanto costa incassare con le carte, per punto vendita e per mese, e
// distingue le due forme in cui quel costo arriva (COMMISSIONI_INCASSO_NOTES.md):
//
//   al lordo -> l'accredito e' il transato pieno e la commissione viene
//               addebitata a parte con un SDD. In banca si vede.
//   al netto -> l'accredito e' gia' decurtato: in banca non compare niente e
//               il ricavo registrato e' piu' basso del vero. Senza l'estratto
//               conto quel costo non e' conoscibile.
//
// Da qui si caricano gli estratti Amex e Nexi: il file finisce su Storage
// (archiviaFile -> import_documents) e i numeri in acquirer_fees, con il
// documento agganciato alla riga.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Percent, Upload, Loader2, AlertTriangle, CheckCircle2, FileText, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { extractPdfLines } from '../lib/pdfText'
import { archiviaFile, avvisoArchiviazioneFallita } from '../lib/archivioFile'
import TableScroll from '../components/ui/TableScroll'
import {
  fetchCommissioni, fetchContratti, totaliPerOutlet,
  parseAmexStatement, parseNexiStatement, tipoEstratto,
  type CommissioneRiga, type ContrattoAcquirer,
} from '../lib/acquirerFees'

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const eur = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Esito = { file: string; ok: boolean; testo: string }

export default function CommissioniIncasso() {
  const { company } = useCompany()
  const { profile } = useAuth()
  const { toast } = useToast()
  const companyId = company?.id ?? null

  const [anno, setAnno] = useState(new Date().getFullYear())
  const [righe, setRighe] = useState<CommissioneRiga[]>([])
  const [contratti, setContratti] = useState<ContrattoAcquirer[]>([])
  const [loading, setLoading] = useState(false)
  const [caricamento, setCaricamento] = useState(false)
  const [esiti, setEsiti] = useState<Esito[]>([])
  const inputFile = useRef<HTMLInputElement>(null)

  const carica = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const [r, c] = await Promise.all([fetchCommissioni(companyId, anno), fetchContratti(companyId)])
      setRighe(r)
      setContratti(c)
    } catch (e) {
      toast({ type: 'error', message: `Non riesco a leggere le commissioni: ${(e as Error).message}` })
    } finally {
      setLoading(false)
    }
  }, [companyId, anno, toast])

  useEffect(() => { void carica() }, [carica])

  const totali = useMemo(() => totaliPerOutlet(righe), [righe])
  const mesiConDati = useMemo(() => {
    const s = new Set(righe.map(r => r.period_month))
    return [...s].sort((a, b) => a - b)
  }, [righe])

  const totaleAnno = useMemo(() => totali.reduce((s, t) => s + t.totale, 0), [totali])
  const transatoNoto = useMemo(() => totali.reduce((s, t) => s + t.lordo, 0), [totali])
  const quotaNetto = useMemo(
    () => righe.filter(r => r.settlement_mode === 'netto').reduce((s, r) => s + r.fee_amount, 0),
    [righe],
  )
  const daStima = useMemo(() => righe.filter(r => r.source !== 'documento'), [righe])

  // --- Caricamento estratti -------------------------------------------------

  const importa = useCallback(async (files: FileList) => {
    if (!companyId) return
    setCaricamento(true)
    const nuovi: Esito[] = []
    try {
      for (const file of Array.from(files)) {
        try {
          const lines = await extractPdfLines(file)
          const tipo = tipoEstratto(lines)
          if (!tipo) {
            // I PDF che sono solo immagine (scansioni) non hanno testo da leggere.
            nuovi.push({ file: file.name, ok: false, testo: lines.length < 5
              ? 'nessun testo nel PDF: sembra una scansione, serve il documento originale'
              : 'non sembra un estratto conto Amex o Nexi' })
            continue
          }

          const letture = tipo === 'amex'
            ? (() => {
                const st = parseAmexStatement(lines)
                return st ? { anno: st.anno, mese: st.mese, etichetta: `Amex ${st.numero}`,
                  voci: st.puntiVendita.map(p => ({
                    code: p.merchant_code, gross: p.lordo, fee: p.commissioni, fixed: 0, stamp: 0, mode: 'lordo' as const,
                  })) } : null
              })()
            : (() => {
                const st = parseNexiStatement(lines)
                return st ? { anno: st.anno, mese: st.mese, etichetta: `Nexi ${st.merchant_code}`,
                  voci: [{ code: st.merchant_code, gross: st.negoziato, fee: st.commissioni,
                    fixed: st.acquiring, stamp: st.bollo, mode: st.settlement_mode }] } : null
              })()

          if (!letture || !letture.voci.length) {
            nuovi.push({ file: file.name, ok: false, testo: 'documento riconosciuto ma non leggibile' })
            continue
          }

          // Il file va in archivio prima dei numeri: se Storage non risponde i
          // dati si salvano lo stesso e l'avviso lo dice (regola di archivioFile).
          const archiviato = await archiviaFile({
            file, companyId, userId: profile?.id ?? null, modulo: 'Banche',
            funzione: 'Commissioni di incasso',
            year: letture.anno, month: letture.mese,
            referenceTable: 'acquirer_fees',
            note: letture.etichetta,
          })
          if (archiviato.errore) toast({ type: 'warning', message: avvisoArchiviazioneFallita(file.name, archiviato.errore) })

          const senzaContratto: string[] = []
          for (const v of letture.voci) {
            const contratto = contratti.find(c => c.merchant_code === v.code)
            if (!contratto) { senzaContratto.push(v.code); continue }
            const { error } = await supabase.from('acquirer_fees').upsert({
              company_id: companyId,
              contract_id: contratto.id,
              outlet_id: contratto.outlet_id,
              period_year: letture.anno,
              period_month: letture.mese,
              gross_amount: v.gross,
              fee_amount: v.fee,
              fixed_amount: v.fixed,
              stamp_amount: v.stamp,
              settlement_mode: v.mode,
              source: 'documento',
              document_id: archiviato.id,
              note: letture.etichetta,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'contract_id,period_year,period_month' })
            if (error) throw error
          }

          const scritte = letture.voci.length - senzaContratto.length
          nuovi.push({
            file: file.name, ok: scritte > 0,
            testo: senzaContratto.length
              ? `${MESI_BREVI[letture.mese - 1]} ${letture.anno}: ${scritte} punti vendita aggiornati. Codici non censiti: ${senzaContratto.join(', ')}`
              : `${MESI_BREVI[letture.mese - 1]} ${letture.anno}: ${scritte} ${scritte === 1 ? 'punto vendita aggiornato' : 'punti vendita aggiornati'}`,
          })
        } catch (e) {
          nuovi.push({ file: file.name, ok: false, testo: (e as Error).message })
        }
      }
      setEsiti(nuovi)
      if (nuovi.some(n => n.ok)) { toast({ type: 'success', message: 'Estratti caricati' }); await carica() }
    } finally {
      setCaricamento(false)
      if (inputFile.current) inputFile.current.value = ''
    }
  }, [companyId, contratti, profile, toast, carica])

  // --- Vista ----------------------------------------------------------------

  if (!companyId) return <div className="p-6 text-gray-500">Nessuna azienda selezionata.</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Percent className="h-5 w-5 text-indigo-600" />
            Commissioni di incasso
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Quanto costa incassare con le carte, per punto vendita e per mese.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={anno}
            onChange={e => setAnno(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            aria-label="Anno"
          >
            {[anno + 1, anno, anno - 1, anno - 2].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b - a).map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button
            onClick={() => void carica()}
            className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50"
            title="Ricarica"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => inputFile.current?.click()}
            disabled={caricamento}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {caricamento ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Carica estratti
          </button>
          <input
            ref={inputFile}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={e => { if (e.target.files?.length) void importa(e.target.files) }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Commissioni {anno}</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{eur(totaleAnno)} €</div>
          {transatoNoto > 0 && (
            <div className="mt-1 text-xs text-gray-500">
              su {eur(transatoNoto)} € di transato noto
            </div>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Trattenute alla fonte</div>
          <div className="mt-1 text-2xl font-semibold text-amber-600">{eur(quotaNetto)} €</div>
          <div className="mt-1 text-xs text-gray-500">
            mai passate dal conto corrente: senza estratto conto non si vedono
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Contratti censiti</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{contratti.length}</div>
          <div className="mt-1 text-xs text-gray-500">
            {contratti.filter(c => c.settlement_mode === 'lordo').length} al lordo,{' '}
            {contratti.filter(c => c.settlement_mode === 'netto').length} al netto
          </div>
        </div>
      </div>

      {esiti.length > 0 && (
        <div className="space-y-2">
          {esiti.map((e, i) => (
            <div
              key={`${e.file}-${i}`}
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                e.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {e.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              <div>
                <span className="font-medium">{e.file}</span> — {e.testo}
              </div>
            </div>
          ))}
        </div>
      )}

      {daStima.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <FileText className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {daStima.length} {daStima.length === 1 ? 'riga ricavata' : 'righe ricavate'} dall'addebito in banca e non da un
            estratto conto. Caricando il documento il valore viene sostituito.
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Carico…
        </div>
      ) : totali.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-gray-500">
          Per il {anno} non ci sono commissioni registrate. Carica gli estratti conto Amex o Nexi.
        </div>
      ) : (
        <TableScroll className="rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Punto vendita</th>
                {mesiConDati.map(m => (
                  <th key={m} className="px-3 py-3 text-right">{MESI_BREVI[m - 1]}</th>
                ))}
                <th className="px-4 py-3 text-right">Totale</th>
                <th className="px-4 py-3 text-right">Aliquota</th>
                <th className="px-4 py-3 text-left">Accredito</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {totali.map(t => (
                <tr key={t.outlet_code} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium text-gray-900">{t.outlet_code}</td>
                  {mesiConDati.map(m => (
                    <td key={m} className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {t.perMese[m] ? eur(t.perMese[m]) : <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-gray-900">{eur(t.totale)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                    {t.aliquota != null ? `${t.aliquota.toFixed(3)} %` : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.soloNetto ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {t.soloNetto ? 'al netto' : 'al lordo'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold text-gray-900">
              <tr>
                <td className="px-4 py-3">Totale</td>
                {mesiConDati.map(m => (
                  <td key={m} className="px-3 py-3 text-right tabular-nums">
                    {eur(totali.reduce((s, t) => s + (t.perMese[m] ?? 0), 0))}
                  </td>
                ))}
                <td className="px-4 py-3 text-right tabular-nums">{eur(totaleAnno)}</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      )}
    </div>
  )
}
