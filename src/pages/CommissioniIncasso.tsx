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
// Da qui si caricano gli estratti Amex e Nexi, anche dentro uno zip: gli
// archivi vengono aperti nel browser, ogni PDF viene riconosciuto dal suo
// contenuto (acquirer, punto vendita, mese), rinominato di conseguenza e messo
// su Storage (archiviaFile -> import_documents); i numeri finiscono in
// acquirer_fees con il documento agganciato alla riga.
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Percent, Upload, Loader2, AlertTriangle, CheckCircle2, FileText, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../components/Toast'
import { extractPdfLines } from '../lib/pdfText'
import { archiviaFile, sostituisciPrecedenti, avvisoArchiviazioneFallita } from '../lib/archivioFile'
import { espandiZip } from '../lib/zipFiles'
import TableScroll from '../components/ui/TableScroll'
import {
  fetchCommissioni, fetchContratti, totaliPerOutlet, fetchRigheCaricate, ultimiCaricamenti, meseAtteso,
  parseAmexStatement, parseNexiStatement, tipoEstratto,
  nomeDocumento, funzioneArchivio,
  type CommissioneRiga, type ContrattoAcquirer, type RigaCaricata,
} from '../lib/acquirerFees'
import { formatEuro } from '../lib/cashClosings'

const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']
const MESI_LUNGHI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
// Importi sempre in euro: «1.234,56 €».
const eur = formatEuro

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
  const [caricate, setCaricate] = useState<RigaCaricata[]>([])
  const [trascina, setTrascina] = useState(false)
  const inputFile = useRef<HTMLInputElement>(null)

  const carica = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      // L'ultimo estratto caricato si cerca anche negli anni prima di quello
      // scelto: a gennaio l'ultimo documento e' di dicembre.
      const annoOggi = meseAtteso().anno
      const [r, c, u] = await Promise.all([
        fetchCommissioni(companyId, anno), fetchContratti(companyId), fetchRigheCaricate(companyId, annoOggi - 1),
      ])
      setRighe(r)
      setContratti(c)
      setCaricate(u)
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
  // Costo pagato nell'anno: commissioni piu' acquiring e bolli.
  const costoTotale = useMemo(
    () => Math.round(righe.reduce((s, r) => s + Number(r.fee_amount) + Number(r.fixed_amount) + Number(r.stamp_amount), 0) * 100) / 100,
    [righe],
  )
  // Trattenute alla fonte: la commissione dei contratti al netto, mai passata dal conto.
  const quotaNetto = useMemo(
    () => Math.round(righe.filter(r => r.settlement_mode === 'netto').reduce((s, r) => s + Number(r.fee_amount), 0) * 100) / 100,
    [righe],
  )
  // Tutto il resto arriva dopo, come addebito SDD in banca.
  const quotaAddebitata = Math.round((costoTotale - quotaNetto) * 100) / 100
  const atteso = useMemo(() => meseAtteso(), [])
  const ultimi = useMemo(() => ultimiCaricamenti(caricate, contratti, atteso), [caricate, contratti, atteso])
  const mancanti = ultimi.filter(u => u.manca).length
  const daStima = useMemo(() => righe.filter(r => r.source !== 'documento'), [righe])

  // --- Caricamento estratti -------------------------------------------------

  const importa = useCallback(async (scelti: FileList | File[]) => {
    if (!companyId) return
    setCaricamento(true)
    const nuovi: Esito[] = []
    try {
      // Gli estratti arrivano quasi sempre in un archivio unico: si apre qui,
      // cosi' nessuno deve estrarlo a mano prima di trascinarlo.
      const { files, problemi } = await espandiZip(Array.from(scelti), { estensioni: ['pdf'] })
      for (const p of problemi) nuovi.push({ file: p.zip, ok: false, testo: p.testo })

      for (const { file, daZip } of files) {
        const etichettaFile = daZip ? `${daZip} › ${file.name}` : file.name
        try {
          const lines = await extractPdfLines(file)
          const tipo = tipoEstratto(lines)
          if (!tipo) {
            // I PDF che sono solo immagine (scansioni) non hanno testo da leggere.
            nuovi.push({ file: etichettaFile, ok: false, testo: lines.length < 5
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
            nuovi.push({ file: etichettaFile, ok: false, testo: 'documento riconosciuto ma non leggibile' })
            continue
          }

          // Chi e' il documento lo dice il suo contenuto, non il nome del file:
          // l'Amex copre tutti i punti vendita, il Nexi ne riguarda uno solo.
          const contrattiDelFile = letture.voci
            .map(v => contratti.find(c => c.merchant_code === v.code))
            .filter((c): c is ContrattoAcquirer => !!c)
          const chi = tipo === 'nexi'
            ? (contrattiDelFile[0]?.outlet_code || letture.voci[0].code)
            : null
          const nomeNuovo = nomeDocumento({ acquirer: tipo, anno: letture.anno, mese: letture.mese, chi })
          const funzione = funzioneArchivio(tipo, chi)
          const rinominato = file.name === nomeNuovo ? file : new File([file], nomeNuovo, { type: file.type || 'application/pdf' })

          // Il file va in archivio prima dei numeri: se Storage non risponde i
          // dati si salvano lo stesso e l'avviso lo dice (regola di archivioFile).
          const archiviato = await archiviaFile({
            file: rinominato, companyId, userId: profile?.id ?? null, modulo: 'Banche',
            funzione,
            year: letture.anno, month: letture.mese,
            referenceTable: 'acquirer_fees',
            note: `${letture.etichetta}${daZip ? ` (da ${daZip})` : ''} — file originale: ${file.name}`,
          })
          if (archiviato.errore) toast({ type: 'warning', message: avvisoArchiviazioneFallita(file.name, archiviato.errore) })
          // Ricaricare lo stesso estratto sostituisce il precedente, non lo affianca.
          else await sostituisciPrecedenti({ companyId, funzione, year: letture.anno, month: letture.mese, nuovoId: archiviato.id })

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
          const dove = `archiviato come ${nomeNuovo}`
          const periodo = `${MESI_BREVI[letture.mese - 1]} ${letture.anno}`
          nuovi.push({
            file: etichettaFile, ok: scritte > 0,
            testo: senzaContratto.length
              ? `${periodo}: ${scritte} punti vendita aggiornati, ${dove}. Codici non censiti: ${senzaContratto.join(', ')}`
              : `${periodo}: ${scritte} ${scritte === 1 ? 'punto vendita aggiornato' : 'punti vendita aggiornati'}, ${dove}`,
          })
        } catch (e) {
          nuovi.push({ file: etichettaFile, ok: false, testo: (e as Error).message })
        }
      }
      setEsiti(nuovi)
      if (nuovi.some(n => n.ok)) { toast({ type: 'success', message: 'Estratti caricati' }); await carica() }
      else if (nuovi.length) toast({ type: 'warning', message: 'Nessun estratto riconosciuto' })
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
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <div className="text-xs uppercase tracking-wide text-indigo-700">Costo totale commissioni {anno}</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{eur(costoTotale)}</div>
          <div className="mt-1 text-xs text-gray-600">
            {eur(quotaNetto)} alla fonte + {eur(quotaAddebitata)} addebitate dopo
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Trattenute alla fonte</div>
          <div className="mt-1 text-2xl font-semibold text-amber-600">{eur(quotaNetto)}</div>
          <div className="mt-1 text-xs text-gray-500">
            mai passate dal conto corrente: senza estratto conto non si vedono
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Addebitate dopo in banca</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{eur(quotaAddebitata)}</div>
          <div className="mt-1 text-xs text-gray-500">
            commissioni al lordo, canoni di acquiring e bolli, addebitati il mese dopo
            {transatoNoto > 0 && <> · transato noto {eur(transatoNoto)}</>}
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div
          role="button"
          tabIndex={0}
          onClick={() => { if (!caricamento) inputFile.current?.click() }}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !caricamento) { e.preventDefault(); inputFile.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setTrascina(true) }}
          onDragLeave={() => setTrascina(false)}
          onDrop={e => {
            e.preventDefault()
            setTrascina(false)
            if (!caricamento && e.dataTransfer.files.length) void importa(Array.from(e.dataTransfer.files))
          }}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-5 transition-colors ${
            trascina ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-gray-50'
          } ${caricamento ? 'opacity-60' : ''}`}
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {caricamento ? <Loader2 className="h-5 w-5 animate-spin text-indigo-600" /> : <Upload className="h-5 w-5 text-indigo-600" />}
            {caricamento ? 'Leggo gli estratti…' : 'Trascina qui gli estratti, oppure clicca per sceglierli'}
          </div>
          <div className="mt-3 space-y-2 text-sm text-gray-600">
            <p className="font-medium text-gray-700">Cosa caricare, ogni mese:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li><span className="font-medium">Amex</span>: l'«Estratto Conto Commissioni», un unico PDF con dentro tutti i punti vendita.</li>
              <li><span className="font-medium">Nexi</span>: l'estratto conto mensile, un PDF per ogni punto vendita.</li>
            </ul>
            <p>
              Vanno bene i PDF singoli o lo zip ricevuto per mail. I PDF devono essere quelli scaricati dal
              portale: le scansioni sono fotografie della pagina e non si possono leggere. Il canone dei POS
              non sta in questi estratti.
            </p>
          </div>
          <input
            ref={inputFile}
            type="file"
            accept="application/pdf,.zip,application/zip,application/x-zip-compressed"
            multiple
            className="hidden"
            onClick={e => e.stopPropagation()}
            onChange={e => { if (e.target.files?.length) void importa(e.target.files) }}
          />
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Ultimo estratto caricato</h3>
            <span className="text-xs text-gray-500">
              atteso: {MESI_LUNGHI[atteso.mese - 1]} {atteso.anno}
            </span>
          </div>
          {ultimi.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              Nessun contratto Amex o Nexi censito: gli estratti non hanno ancora un punto vendita a cui agganciarsi.
            </p>
          ) : (
            <>
              <table className="mt-3 w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="py-1 text-left">Documento</th>
                    <th className="py-1 text-left">Ultimo mese</th>
                    <th className="py-1 text-right">Importo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ultimi.map(u => (
                    <tr key={u.chiave}>
                      <td className="py-1.5 font-medium text-gray-900">{u.etichetta}</td>
                      <td className="py-1.5">
                        {u.mese && u.anno ? (
                          <span className={u.manca ? 'text-amber-700' : 'text-emerald-700'}>
                            {MESI_LUNGHI[u.mese - 1]} {u.anno}
                          </span>
                        ) : (
                          <span className="text-amber-700">mai caricato</span>
                        )}
                        {u.manca && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            manca {MESI_BREVI[atteso.mese - 1]} {atteso.anno}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-700">{eur(u.importo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={`mt-3 text-xs ${mancanti ? 'text-amber-700' : 'text-emerald-700'}`}>
                {mancanti
                  ? `${mancanti} ${mancanti === 1 ? 'estratto da caricare' : 'estratti da caricare'} per ${MESI_LUNGHI[atteso.mese - 1]} ${atteso.anno}.`
                  : `Tutti gli estratti di ${MESI_LUNGHI[atteso.mese - 1]} ${atteso.anno} sono caricati.`}
              </p>
            </>
          )}
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
