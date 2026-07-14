// Pagina: /fatturazione/converti-xml
// Convertitore provvisorio: export Excel del gestionale -> XML Fattura Elettronica (FPR12)
// pronti per l'import in Agenzia delle Entrate. Tutto lato client (offline), nessuna
// chiamata di rete. Numerazione progressiva ricordata in localStorage.
//
// NB: gli XML NON sono firmati (.p7m) ne' validati contro XSD ufficiale: stessa forma
// del modello usato per l'import manuale. Riga di dettaglio unica e sintetica.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import PageHeader from '../components/PageHeader'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Upload, FileCode, Download, CheckCircle, AlertTriangle,
  Loader2, FileSpreadsheet, ClipboardPaste, Archive, RefreshCw,
} from 'lucide-react'

// ─── Dati fissi cedente ──────────────────────────────────────────────────
const CEDENTE_PIVA = '07362100484'
const LS_KEY = 'nz_fe_last_prog'
const DEFAULT_START = 21

// Ordine standard colonne export (usato SOLO se si incolla senza intestazione).
// La mappatura per NOME (header nel file o riga incollata) e' quella affidabile.
const STANDARD_ORDER = [
  'Cod.interno', 'Data Fat.', 'N.Fat.', 'Num.Fat.Stamp.', 'Tot.',
  'Cliente Fat. Descrizione', 'P.IVA', 'Cod.Fisc.', 'Località', 'Cap',
  'Indirizzo', 'Provincia', 'Nazione', 'Imponibile', 'Imposta', 'Totale Fatt.',
]

// ─── Province: nome esteso -> sigla ──────────────────────────────────────
const PROV_RAW: Record<string, string> = {
  'Agrigento': 'AG', 'Alessandria': 'AL', 'Ancona': 'AN', 'Aosta': 'AO', "Valle d'Aosta": 'AO',
  'Arezzo': 'AR', 'Ascoli Piceno': 'AP', 'Asti': 'AT', 'Avellino': 'AV', 'Bari': 'BA',
  'Barletta-Andria-Trani': 'BT', 'Belluno': 'BL', 'Benevento': 'BN', 'Bergamo': 'BG', 'Biella': 'BI',
  'Bologna': 'BO', 'Bolzano': 'BZ', 'Bozen': 'BZ', 'Brescia': 'BS', 'Brindisi': 'BR', 'Cagliari': 'CA',
  'Caltanissetta': 'CL', 'Campobasso': 'CB', 'Caserta': 'CE', 'Catania': 'CT', 'Catanzaro': 'CZ',
  'Chieti': 'CH', 'Como': 'CO', 'Cosenza': 'CS', 'Cremona': 'CR', 'Crotone': 'KR', 'Cuneo': 'CN',
  'Enna': 'EN', 'Fermo': 'FM', 'Ferrara': 'FE', 'Firenze': 'FI', 'Foggia': 'FG', 'Forlì-Cesena': 'FC',
  'Forli-Cesena': 'FC', 'Frosinone': 'FR', 'Genova': 'GE', 'Gorizia': 'GO', 'Grosseto': 'GR',
  'Imperia': 'IM', 'Isernia': 'IS', 'La Spezia': 'SP', "L'Aquila": 'AQ', 'Latina': 'LT', 'Lecce': 'LE',
  'Lecco': 'LC', 'Livorno': 'LI', 'Lodi': 'LO', 'Lucca': 'LU', 'Macerata': 'MC', 'Mantova': 'MN',
  'Massa-Carrara': 'MS', 'Massa Carrara': 'MS', 'Matera': 'MT', 'Messina': 'ME', 'Milano': 'MI',
  'Modena': 'MO', 'Monza e della Brianza': 'MB', 'Monza-Brianza': 'MB', 'Monza': 'MB', 'Napoli': 'NA',
  'Novara': 'NO', 'Nuoro': 'NU', 'Oristano': 'OR', 'Padova': 'PD', 'Palermo': 'PA', 'Parma': 'PR',
  'Pavia': 'PV', 'Perugia': 'PG', 'Pesaro e Urbino': 'PU', 'Pesaro-Urbino': 'PU', 'Pescara': 'PE',
  'Piacenza': 'PC', 'Pisa': 'PI', 'Pistoia': 'PT', 'Pordenone': 'PN', 'Potenza': 'PZ', 'Prato': 'PO',
  'Ragusa': 'RG', 'Ravenna': 'RA', 'Reggio Calabria': 'RC', 'Reggio di Calabria': 'RC',
  'Reggio Emilia': 'RE', "Reggio nell'Emilia": 'RE', 'Rieti': 'RI', 'Rimini': 'RN', 'Roma': 'RM',
  'Rovigo': 'RO', 'Salerno': 'SA', 'Sassari': 'SS', 'Savona': 'SV', 'Siena': 'SI', 'Siracusa': 'SR',
  'Sondrio': 'SO', 'Sud Sardegna': 'SU', 'Taranto': 'TA', 'Teramo': 'TE', 'Terni': 'TR', 'Torino': 'TO',
  'Trapani': 'TP', 'Trento': 'TN', 'Trieste': 'TS', 'Treviso': 'TV', 'Udine': 'UD', 'Varese': 'VA',
  'Venezia': 'VE', 'Verbano-Cusio-Ossola': 'VB', 'Vercelli': 'VC', 'Verona': 'VR', 'Vibo Valentia': 'VV',
  'Vicenza': 'VI', 'Viterbo': 'VT',
}
const SIGLE = new Set<string>(Object.values(PROV_RAW))
const norm = (s: unknown): string =>
  String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const PROV: Record<string, string> = {}
for (const name of Object.keys(PROV_RAW)) PROV[norm(name)] = PROV_RAW[name]
function provinciaSigla(v: unknown): string {
  const raw = String(v == null ? '' : v).trim()
  if (!raw) return ''
  const up = raw.toUpperCase()
  if (up.length === 2 && SIGLE.has(up)) return up
  const k = norm(raw)
  if (PROV[k]) return PROV[k]
  return up.slice(0, 2)
}

// ─── Conversioni ─────────────────────────────────────────────────────────
function excelSerialToISO(serial: number): string {
  const ms = Math.round((Number(serial) - 25569) * 86400 * 1000)
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function toISODate(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number' && isFinite(v)) return excelSerialToISO(v)
  const s = String(v).trim()
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToISO(parseFloat(s))
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/)
  if (m) {
    const dd = m[1].padStart(2, '0'); const mm = m[2].padStart(2, '0'); let yy = m[3]
    if (yy.length === 2) yy = (parseInt(yy, 10) > 70 ? '19' : '20') + yy
    return `${yy}-${mm}-${dd}`
  }
  return s
}
function parseNum(v: unknown): number {
  if (typeof v === 'number') return v
  let s = String(v == null ? '' : v).trim()
  if (!s) return NaN
  s = s.replace(/[^\d.,-]/g, '')
  if (s.indexOf(',') > -1 && s.indexOf('.') > -1) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.indexOf(',') > -1) s = s.replace(',', '.')
  return parseFloat(s)
}
function money(v: unknown): string {
  let n = parseNum(v)
  if (!isFinite(n)) n = 0
  return n.toFixed(2)
}
function cap5(v: unknown): string {
  let s = String(v == null ? '' : v).trim().replace(/[^\d]/g, '')
  if (s && s.length < 5) s = s.padStart(5, '0')
  return s
}
const pad5 = (n: number): string => String(n).padStart(5, '0')
function xmlEsc(v: unknown): string {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

// ─── Mappatura colonne per nome ──────────────────────────────────────────
type Field = 'dataFat' | 'numFat' | 'cliente' | 'piva' | 'codfisc' | 'localita' | 'cap' | 'indirizzo' | 'provincia' | 'nazione' | 'imponibile' | 'imposta' | 'totale'
const HEADER_KEYS: Record<Field, string[]> = {
  dataFat: ['datafat', 'datafattura', 'data'],
  numFat: ['numfatstamp', 'numfatturastamp', 'numfatstampa'],
  cliente: ['clientefatdescrizione', 'clientedescrizione', 'cliente'],
  piva: ['piva', 'partitaiva'],
  codfisc: ['codfisc', 'codicefiscale'],
  localita: ['localita', 'comune'],
  cap: ['cap'],
  indirizzo: ['indirizzo'],
  provincia: ['provincia', 'prov'],
  nazione: ['nazione'],
  imponibile: ['imponibile'],
  imposta: ['imposta', 'iva'],
  totale: ['totalefatt', 'totalefattura'],
}
type ColMap = Record<Field, number>
function buildHeaderMap(headerRow: unknown[]): ColMap {
  const normed = headerRow.map(norm)
  const map = {} as ColMap
  ;(Object.keys(HEADER_KEYS) as Field[]).forEach((field) => {
    map[field] = -1
    const cands = HEADER_KEYS[field]
    for (let i = 0; i < normed.length && map[field] < 0; i++) {
      if (cands.includes(normed[i])) map[field] = i
    }
  })
  return map
}
function standardMap(): ColMap {
  const byKey: Record<Field, string> = {
    dataFat: 'Data Fat.', numFat: 'Num.Fat.Stamp.', cliente: 'Cliente Fat. Descrizione',
    piva: 'P.IVA', codfisc: 'Cod.Fisc.', localita: 'Località', cap: 'Cap',
    indirizzo: 'Indirizzo', provincia: 'Provincia', nazione: 'Nazione',
    imponibile: 'Imponibile', imposta: 'Imposta', totale: 'Totale Fatt.',
  }
  const map = {} as ColMap
  ;(Object.keys(byKey) as Field[]).forEach((f) => { map[f] = STANDARD_ORDER.indexOf(byKey[f]) })
  return map
}

interface Rec {
  dataISO: string; numero: string; denom: string; piva: string; codfisc: string
  localita: string; cap: string; indirizzo: string; provincia: string
  imponibile: string; imposta: string; totale: string
}
function rowToRecord(cells: unknown[], map: ColMap): Rec {
  const g = (field: Field): unknown => {
    const i = map[field]
    return (i != null && i >= 0 && i < cells.length) ? cells[i] : ''
  }
  const str = (field: Field): string => String(g(field) == null ? '' : g(field)).trim()
  return {
    dataISO: toISODate(g('dataFat')),
    numero: str('numFat'),
    denom: str('cliente'),
    piva: str('piva'),
    codfisc: str('codfisc'),
    localita: str('localita'),
    cap: cap5(g('cap')),
    indirizzo: str('indirizzo'),
    provincia: provinciaSigla(g('provincia')),
    imponibile: money(g('imponibile')),
    imposta: money(g('imposta')),
    totale: money(g('totale')),
  }
}

// ─── Costruzione XML (template FPR12) ────────────────────────────────────
function buildXml(rec: Rec, prog: number): string {
  const progS = pad5(prog)
  let idBlock: string
  if (rec.piva) idBlock = `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${xmlEsc(rec.piva)}</IdCodice></IdFiscaleIVA>`
  else if (rec.codfisc) idBlock = `<CodiceFiscale>${xmlEsc(rec.codfisc)}</CodiceFiscale>`
  else idBlock = '<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice></IdCodice></IdFiscaleIVA>'
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>07362100484</IdCodice></IdTrasmittente>
      <ProgressivoInvio>${progS}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>0000000</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>07362100484</IdCodice></IdFiscaleIVA>
        <Anagrafica><Denominazione>NEW ZAGO S.R.L.</Denominazione></Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede><Indirizzo>VIA IX FEBBRAIO 7</Indirizzo><CAP>50129</CAP><Comune>FIRENZE</Comune><Provincia>FI</Provincia><Nazione>IT</Nazione></Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        ${idBlock}
        <Anagrafica><Denominazione>${xmlEsc(rec.denom)}</Denominazione></Anagrafica>
      </DatiAnagrafici>
      <Sede><Indirizzo>${xmlEsc(rec.indirizzo)}</Indirizzo><CAP>${xmlEsc(rec.cap)}</CAP><Comune>${xmlEsc(rec.localita)}</Comune><Provincia>${xmlEsc(rec.provincia)}</Provincia><Nazione>IT</Nazione></Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>${rec.dataISO}</Data><Numero>${xmlEsc(rec.numero)}</Numero><ImportoTotaleDocumento>${rec.totale}</ImportoTotaleDocumento></DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Fornitura merce vs/ordine</Descrizione><PrezzoUnitario>${rec.imponibile}</PrezzoUnitario><PrezzoTotale>${rec.imponibile}</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee>
      <DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>${rec.imponibile}</ImponibileImporto><Imposta>${rec.imposta}</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo>
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
`
}

interface GenFile { filename: string; xml: string; rec: Rec; prog: number; quadra: boolean }
interface Alert { kind: 'info' | 'warn' | 'err'; text: string }
interface ArchiveRow {
  id: string; batch_id: string; progressivo: number; file_name: string
  invoice_number: string | null; invoice_date: string | null; client_name: string | null
  imponibile: number | null; imposta: number | null; totale: number | null
  quadra: boolean | null; xml_content: string; created_at: string
}
const fmtDateTime = (s: string): string => { try { return new Date(s).toLocaleString('it-IT') } catch { return s } }
function downloadXmlString(name: string, xml: string): void {
  const blob = new Blob([xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

// ═════════════════════════════════════════════════════════════════════════
export default function ConvertitoreFattureXML() {
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [fileRows, setFileRows] = useState<unknown[][] | null>(null)
  const [fileInfo, setFileInfo] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [startNum, setStartNum] = useState<string>(String(DEFAULT_START))
  const [touched, setTouched] = useState(false)
  const [history, setHistory] = useState<{ last: number | null }>({ last: null })
  const [generated, setGenerated] = useState<GenFile[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [busy, setBusy] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [archive, setArchive] = useState<ArchiveRow[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Storico progressivo da localStorage
  useEffect(() => {
    const raw = localStorage.getItem(LS_KEY)
    const last = raw != null && raw !== '' && isFinite(parseInt(raw, 10)) ? parseInt(raw, 10) : null
    setHistory({ last })
    if (!touched) setStartNum(String((last ?? (DEFAULT_START - 1)) + 1))
  }, [touched])

  // Archivio generazioni (tabella fattura_xml_export, isolata per company via RLS)
  const loadArchive = useCallback(async () => {
    setArchiveLoading(true)
    try {
      const { data, error } = await supabase
        .from('fattura_xml_export' as never)
        .select('id,batch_id,progressivo,file_name,invoice_number,invoice_date,client_name,imponibile,imposta,totale,quadra,xml_content,created_at')
        .order('created_at', { ascending: false })
        .order('progressivo', { ascending: true })
        .limit(2000)
      if (error) throw error
      setArchive((data as unknown as ArchiveRow[]) || [])
    } catch {
      setArchive([]) // archivio non disponibile (es. utente non loggato): silenzioso
    } finally {
      setArchiveLoading(false)
    }
  }, [])
  useEffect(() => { loadArchive() }, [loadArchive])

  // Raggruppa per batch mantenendo l'ordine (created_at desc, progressivo asc)
  const batches = useMemo(() => {
    const map = new Map<string, ArchiveRow[]>()
    for (const r of archive) {
      if (!map.has(r.batch_id)) map.set(r.batch_id, [])
      map.get(r.batch_id)!.push(r)
    }
    return Array.from(map.entries()).map(([batch_id, rows]) => ({
      batch_id, rows, created_at: rows[0].created_at,
      progFrom: rows[0].progressivo, progTo: rows[rows.length - 1].progressivo,
    }))
  }, [archive])

  const downloadBatchZip = useCallback(async (rows: ArchiveRow[]) => {
    const zip = new JSZip()
    rows.forEach((r) => zip.file(r.file_name, r.xml_content))
    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `FatturaElettronica_XML_${rows[0].progressivo}-${rows[rows.length - 1].progressivo}.zip`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }, [])

  const readFile = useCallback(async (file: File) => {
    setFileInfo(`File: ${file.name} — lettura…`)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false, raw: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }) as unknown[][]
      setFileRows(rows)
      setFileInfo(`File: ${file.name} — ${Math.max(0, rows.length - 2)} righe dati (dalla riga 3).`)
    } catch (err) {
      setFileRows(null)
      setFileInfo('')
      setAlerts([{ kind: 'err', text: 'Errore lettura file: ' + (err as Error).message }])
    }
  }, [])

  const getRecords = useCallback((): Rec[] => {
    if (mode === 'file') {
      if (!fileRows || fileRows.length < 3) throw new Error('Carica un file Excel valido (riga 1 titolo, riga 2 intestazioni, dati dalla riga 3).')
      const map = buildHeaderMap(fileRows[1])
      if (map.numFat < 0 || map.dataFat < 0) throw new Error("Intestazioni non riconosciute: mancano 'Data Fat.' e/o 'Num.Fat.Stamp.' nella riga 2.")
      const recs: Rec[] = []
      for (let i = 2; i < fileRows.length; i++) {
        const r = rowToRecord(fileRows[i], map)
        if (r.numero) recs.push(r)
      }
      return recs
    }
    const lines = pasteText.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) throw new Error('Incolla almeno una riga di dati.')
    const first = lines[0].split('\t')
    const isHeader = first.map(norm).some((c) => c === 'datafat' || c === 'numfatstamp' || c === 'clientefatdescrizione' || c === 'totalefatt')
    const map = isHeader ? buildHeaderMap(first) : standardMap()
    const start = isHeader ? 1 : 0
    const recs: Rec[] = []
    for (let i = start; i < lines.length; i++) {
      const rec = rowToRecord(lines[i].split('\t'), map)
      if (rec.numero) recs.push(rec)
    }
    if (!recs.length) throw new Error("Nessuna riga con 'Num.Fat.Stamp.' valorizzato. Se hai incollato senza intestazione, verifica l'ordine colonne o includi la riga di intestazione.")
    return recs
  }, [mode, fileRows, pasteText])

  const generate = useCallback(async () => {
    setBusy(true)
    setAlerts([])
    setGenerated([])
    try {
      const recs = getRecords()
      if (!recs.length) { setAlerts([{ kind: 'err', text: 'Nessuna fattura valida trovata.' }]); return }
      recs.sort((a, b) => {
        if (!a.dataISO) return 1
        if (!b.dataISO) return -1
        return a.dataISO < b.dataISO ? -1 : (a.dataISO > b.dataISO ? 1 : 0)
      })
      const start = parseInt(startNum, 10)
      if (!isFinite(start) || start < 1) { setAlerts([{ kind: 'err', text: 'Numero di partenza non valido.' }]); return }

      const out: GenFile[] = []
      let nBad = 0, nProvBad = 0, nDateBad = 0
      recs.forEach((rec, i) => {
        const prog = start + i
        const imp = parseNum(rec.imponibile), iva = parseNum(rec.imposta), tot = parseNum(rec.totale)
        const quadra = isFinite(imp) && isFinite(iva) && isFinite(tot) && Math.abs((imp + iva) - tot) <= 0.01
        if (!quadra) nBad++
        if (!rec.provincia) nProvBad++
        if (!rec.dataISO) nDateBad++
        out.push({ filename: `IT${CEDENTE_PIVA}_${pad5(prog)}.xml`, xml: buildXml(rec, prog), rec, prog, quadra })
      })
      setGenerated(out)

      const last = start + out.length - 1
      const msgs: Alert[] = [{ kind: 'info', text: `Generati ${out.length} XML — progressivi da ${pad5(start)} a ${pad5(last)}.` }]
      if (nBad) msgs.push({ kind: 'warn', text: `${nBad} fattura/e in cui Imponibile + Imposta ≠ Totale (tolleranza 0,01): righe evidenziate. Gli XML sono comunque generati.` })
      if (nProvBad) msgs.push({ kind: 'warn', text: `${nProvBad} fattura/e senza provincia riconosciuta: controlla la colonna Provincia.` })
      if (nDateBad) msgs.push({ kind: 'warn', text: `${nDateBad} fattura/e senza data valida.` })

      localStorage.setItem(LS_KEY, String(last))
      setHistory({ last })

      // Archivia in DB (ogni generazione = un batch). Se fallisce, i file restano scaricabili.
      // company_id lo valorizza il DB (DEFAULT get_my_company_id()), coerente con la RLS.
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const batchId = crypto.randomUUID()
        const payload = out.map((g) => ({
          batch_id: batchId,
          progressivo: g.prog,
          file_name: g.filename,
          invoice_number: g.rec.numero || null,
          invoice_date: g.rec.dataISO || null,
          client_name: g.rec.denom || null,
          imponibile: Number(g.rec.imponibile),
          imposta: Number(g.rec.imposta),
          totale: Number(g.rec.totale),
          quadra: g.quadra,
          xml_content: g.xml,
          created_by: user?.id ?? null,
        }))
        const { error: insErr } = await supabase.from('fattura_xml_export' as never).insert(payload as never)
        if (insErr) throw insErr
        msgs.push({ kind: 'info', text: `Archiviati ${out.length} file: li ritrovi in «Archivio generazioni» qui sotto.` })
        await loadArchive()
      } catch (e) {
        msgs.push({ kind: 'warn', text: 'File generati ma NON archiviati (' + (e as Error).message + '). Puoi comunque scaricarli ora con «Scarica tutti (.zip)».' })
      }

      setAlerts(msgs)
    } catch (e) {
      setAlerts([{ kind: 'err', text: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }, [getRecords, startNum, loadArchive])

  const downloadZip = useCallback(async () => {
    if (!generated.length) return
    setZipping(true)
    try {
      const zip = new JSZip()
      generated.forEach((g) => zip.file(g.filename, g.xml))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `FatturaElettronica_XML_${generated[0].prog}-${generated[generated.length - 1].prog}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1500)
    } finally {
      setZipping(false)
    }
  }, [generated])

  const alertStyle: Record<Alert['kind'], string> = {
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    err: 'bg-red-50 border-red-200 text-red-700',
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1100px] mx-auto">
      <Link to="/fatturazione?tab=active" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft size={16} /> Torna a Fatturazione
      </Link>
      <PageHeader
        title="Converti Excel → XML Fattura Elettronica"
        subtitle="NEW ZAGO S.R.L. — genera un XML FPR12 per fattura dall'export del gestionale, pronto per l'import in Agenzia delle Entrate"
      />

      {/* Progressivo */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
        <div className={`rounded-lg border p-3 text-sm ${history.last != null ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
          {history.last != null
            ? <>L'ultima fattura generata aveva il numero <b>{pad5(history.last)}</b>. La prossima partirà da <b>{pad5(history.last + 1)}</b>.</>
            : <>Nessuno storico in questo browser: inserisci il <b>numero di partenza</b> (proposto: {pad5(DEFAULT_START)}).</>}
        </div>
        <div className="max-w-[240px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Numero di partenza (ProgressivoInvio)</label>
          <input
            type="number" min={1} step={1} value={startNum}
            onChange={(e) => { setTouched(true); setStartNum(e.target.value) }}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <div className="text-xs text-slate-400 mt-1">A 5 cifre nel file e nell'XML (es. 21 → <span className="font-mono">00021</span>).</div>
        </div>
      </div>

      {/* Input dati */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
          {([['file', 'Carica file Excel', FileSpreadsheet], ['paste', 'Incolla righe', ClipboardPaste]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setMode(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded font-medium transition ${mode === key ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <div>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]) }}
              className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center text-slate-500 cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition"
            >
              <Upload size={22} className="mx-auto mb-2 text-slate-400" />
              Trascina qui il file <b className="text-slate-700">.xls / .xlsx</b> oppure <b className="text-blue-600">clicca per selezionarlo</b>
              {fileInfo && <div className="text-xs text-slate-500 mt-2">{fileInfo}</div>}
            </div>
            <input ref={fileInputRef} type="file" accept=".xls,.xlsx" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />
            <div className="text-xs text-slate-400 mt-2">Export del gestionale: riga 1 titolo, riga 2 intestazioni, dati dalla riga 3. Colonne individuate per nome.</div>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Incolla una o più righe copiate da Excel (valori separati da TAB, una fattura per riga)</label>
            <textarea
              value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              placeholder={'Puoi incollare anche la riga di intestazione: se c\'è, le colonne vengono mappate per nome.\nSenza intestazione si usa l\'ordine standard dell\'export — verifica poi il riepilogo.'}
              className="w-full min-h-[120px] px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="text-xs text-slate-400 mt-1">Consiglio: includi la riga di intestazione (riga 2 dell'export) per una mappatura sicura.</div>
          </div>
        )}
      </div>

      {/* Azioni */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={generate} disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-sm rounded-lg font-medium transition">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FileCode size={16} />}
          Genera XML
        </button>
        {generated.length > 0 && (
          <button onClick={downloadZip} disabled={zipping}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-blue-600 text-blue-700 text-sm rounded-lg font-medium hover:bg-blue-50 transition">
            {zipping ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Scarica tutti (.zip)
          </button>
        )}
      </div>

      {/* Avvisi */}
      {alerts.map((a, i) => (
        <div key={i} className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${alertStyle[a.kind]}`}>
          {a.kind === 'info' ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{a.text}</span>
        </div>
      ))}

      {/* Riepilogo */}
      {generated.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-800">Riepilogo file generati ({generated.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="text-left px-4 py-2 font-medium">File</th>
                  <th className="text-left px-4 py-2 font-medium">N. Fattura</th>
                  <th className="text-left px-4 py-2 font-medium">Cliente</th>
                  <th className="text-left px-4 py-2 font-medium">Data</th>
                  <th className="text-right px-4 py-2 font-medium">Imponibile</th>
                  <th className="text-right px-4 py-2 font-medium">Imposta</th>
                  <th className="text-right px-4 py-2 font-medium">Totale</th>
                  <th className="text-center px-4 py-2 font-medium">Quadra</th>
                </tr>
              </thead>
              <tbody>
                {generated.map((g, idx) => (
                  <tr key={g.filename} className={`border-b border-slate-100 ${!g.quadra ? 'bg-red-50/60' : (idx % 2 === 1 ? 'bg-slate-50/50' : '')}`}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600 whitespace-nowrap">{g.filename}</td>
                    <td className="px-4 py-2 text-slate-800 whitespace-nowrap">{g.rec.numero}</td>
                    <td className="px-4 py-2 text-slate-700">{g.rec.denom}</td>
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{g.rec.dataISO || '—'}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">{g.rec.imponibile}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">{g.rec.imposta}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-900">{g.rec.totale}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-bold ${g.quadra ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {g.quadra ? 'OK' : 'NO'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Anteprima primo XML */}
      {generated.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <div className="text-sm font-semibold text-slate-800">Anteprima primo XML</div>
          <pre className="bg-slate-900 text-green-300 rounded-lg p-3 text-[11px] leading-relaxed overflow-x-auto max-h-80 font-mono">{generated[0].xml}</pre>
        </div>
      )}

      {/* Archivio generazioni */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Archive size={16} className="text-slate-500" />
            Archivio generazioni
            {archive.length > 0 && <span className="text-slate-400 font-normal">({archive.length} file · {batches.length} generazioni)</span>}
          </div>
          <button onClick={loadArchive} className="p-1.5 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition" title="Aggiorna archivio">
            <RefreshCw size={15} className={archiveLoading ? 'animate-spin' : ''} />
          </button>
        </div>
        {batches.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            {archiveLoading ? 'Caricamento…' : 'Nessuna generazione archiviata. Ogni volta che premi «Genera XML» i file vengono salvati qui.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {batches.map((b) => (
              <div key={b.batch_id} className="p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <div className="text-sm text-slate-700">
                    <span className="font-medium">{fmtDateTime(b.created_at)}</span>
                    <span className="text-slate-400"> · {b.rows.length} file · progressivi {pad5(b.progFrom)}–{pad5(b.progTo)}</span>
                  </div>
                  <button onClick={() => downloadBatchZip(b.rows)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 transition">
                    <Download size={13} /> Scarica .zip
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {b.rows.map((r) => (
                        <tr key={r.id} className="border-t border-slate-50">
                          <td className="py-1.5 pr-3 font-mono text-slate-500 whitespace-nowrap">{r.file_name}</td>
                          <td className="py-1.5 pr-3 text-slate-700 whitespace-nowrap">{r.invoice_number || '—'}</td>
                          <td className="py-1.5 pr-3 text-slate-600">{r.client_name || '—'}</td>
                          <td className="py-1.5 pr-3 text-slate-500 whitespace-nowrap">{r.invoice_date || '—'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-slate-700 whitespace-nowrap">{r.totale != null ? Number(r.totale).toFixed(2) : '—'}</td>
                          <td className="py-1.5 text-right">
                            <button onClick={() => downloadXmlString(r.file_name, r.xml_content)}
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800" title="Scarica questo XML">
                              <Download size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Note */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-500 space-y-1.5 leading-relaxed">
        <div><b>Strumento provvisorio.</b> Gli XML <b>non sono firmati</b> (.p7m) né validati contro lo schema XSD ufficiale: hanno la stessa forma del modello già usato per l'import manuale.</div>
        <div>La riga di dettaglio è <b>unica e sintetica</b> («Fornitura merce vs/ordine»), non articolo per articolo. Cedente fisso: NEW ZAGO S.R.L., P.IVA 07362100484, VIA IX FEBBRAIO 7, 50129 FIRENZE (FI), RF01, aliquota 22%.</div>
        <div>Prima di generare, per ogni riga si verifica che <b>Imponibile + Imposta = Totale</b> (tolleranza 0,01); le righe che non quadrano sono evidenziate ma generate comunque.</div>
      </div>
    </div>
  )
}
