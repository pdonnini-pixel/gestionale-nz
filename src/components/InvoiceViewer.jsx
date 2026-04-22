import { useState, useEffect, useMemo } from 'react'
import { X, Printer, Download, FileText, AlertCircle } from 'lucide-react'

// ─── FatturaPA XML → HTML (parser manuale) ───────────────────────
// Supporta TD01 (Fattura), TD04 (Nota credito), TD06 (Parcella), TD24 (Differita)

const TIPO_DOCUMENTO = {
  TD01: 'Fattura', TD02: 'Acconto/Anticipo', TD03: 'Acconto/Anticipo parcella',
  TD04: 'Nota di credito', TD05: 'Nota di debito', TD06: 'Parcella',
  TD16: 'Integrazione reverse charge', TD17: 'Integrazione acquisti UE',
  TD20: 'Autofattura', TD24: 'Fattura differita', TD25: 'Fattura differita (art.21 c.6 lett.a)',
  TD26: 'Cessione beni ammortizzabili', TD27: 'Fattura autoconsumo/cessioni gratuite',
}

const MODALITA_PAGAMENTO = {
  MP01: 'Contanti', MP02: 'Assegno', MP03: 'Assegno circolare',
  MP04: 'Contanti presso Tesoreria', MP05: 'Bonifico', MP06: 'Vaglia cambiario',
  MP07: 'Bollettino bancario', MP08: 'Carta di pagamento', MP09: 'RID',
  MP10: 'RID utenze', MP11: 'RID veloce', MP12: 'RIBA',
  MP13: 'MAV', MP14: 'Quietanza erario', MP15: 'Giroconto su conti di contabilità speciale',
  MP16: 'Domiciliazione bancaria', MP17: 'Domiciliazione postale',
  MP18: 'Bollettino di c/c postale', MP19: 'SEPA Direct Debit',
  MP20: 'SEPA Direct Debit CORE', MP21: 'SEPA Direct Debit B2B',
  MP22: 'Trattenuta su somme già riscosse', MP23: 'PagoPA',
}

function fmtNum(val) {
  if (val == null || val === '') return '—'
  const n = parseFloat(String(val).replace(',', '.'))
  if (isNaN(n)) return val
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function fmtDate(val) {
  if (!val) return '—'
  const parts = val.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`
  return val
}

function getTextContent(parent, tagName) {
  if (!parent) return ''
  const el = parent.getElementsByTagName(tagName)[0]
  return el ? el.textContent.trim() : ''
}

function getAllElements(parent, tagName) {
  if (!parent) return []
  return Array.from(parent.getElementsByTagName(tagName))
}

// ─── Parse FatturaPA XML → struttura dati ────────────────────────
function parseFatturaPA(xmlString) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'text/xml')

  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error('XML non valido')

  // Namespace-aware: FatturaPA può avere namespace "p:" o nessuno
  const body = doc.getElementsByTagName('FatturaElettronicaBody')[0]
    || doc.getElementsByTagName('p:FatturaElettronicaBody')[0]
  const header = doc.getElementsByTagName('FatturaElettronicaHeader')[0]
    || doc.getElementsByTagName('p:FatturaElettronicaHeader')[0]

  if (!body && !header) throw new Error('Struttura FatturaPA non riconosciuta')

  // Cedente (fornitore)
  const cedente = header?.getElementsByTagName('CedentePrestatore')[0]
  const datiAnagCedente = cedente?.getElementsByTagName('DatiAnagrafici')[0]
  const sedeCedente = cedente?.getElementsByTagName('Sede')[0]

  const fornitore = {
    denominazione: getTextContent(datiAnagCedente, 'Denominazione')
      || `${getTextContent(datiAnagCedente, 'Nome')} ${getTextContent(datiAnagCedente, 'Cognome')}`.trim(),
    partitaIva: getTextContent(datiAnagCedente, 'IdCodice'),
    codiceFiscale: getTextContent(datiAnagCedente, 'CodiceFiscale'),
    indirizzo: getTextContent(sedeCedente, 'Indirizzo'),
    cap: getTextContent(sedeCedente, 'CAP'),
    comune: getTextContent(sedeCedente, 'Comune'),
    provincia: getTextContent(sedeCedente, 'Provincia'),
    nazione: getTextContent(sedeCedente, 'Nazione'),
  }

  // Cessionario (cliente)
  const cessionario = header?.getElementsByTagName('CessionarioCommittente')[0]
  const datiAnagCess = cessionario?.getElementsByTagName('DatiAnagrafici')[0]
  const sedeCess = cessionario?.getElementsByTagName('Sede')[0]

  const cliente = {
    denominazione: getTextContent(datiAnagCess, 'Denominazione')
      || `${getTextContent(datiAnagCess, 'Nome')} ${getTextContent(datiAnagCess, 'Cognome')}`.trim(),
    partitaIva: getTextContent(datiAnagCess, 'IdCodice'),
    codiceFiscale: getTextContent(datiAnagCess, 'CodiceFiscale'),
    indirizzo: getTextContent(sedeCess, 'Indirizzo'),
    cap: getTextContent(sedeCess, 'CAP'),
    comune: getTextContent(sedeCess, 'Comune'),
    provincia: getTextContent(sedeCess, 'Provincia'),
  }

  // Dati generali
  const datiGenerali = body?.getElementsByTagName('DatiGeneraliDocumento')[0]
  const tipoDoc = getTextContent(datiGenerali, 'TipoDocumento')
  const documento = {
    tipo: tipoDoc,
    tipoLabel: TIPO_DOCUMENTO[tipoDoc] || tipoDoc,
    numero: getTextContent(datiGenerali, 'Numero'),
    data: getTextContent(datiGenerali, 'Data'),
    divisa: getTextContent(datiGenerali, 'Divisa') || 'EUR',
    importoTotale: getTextContent(datiGenerali, 'ImportoTotaleDocumento'),
    causale: getTextContent(datiGenerali, 'Causale'),
  }

  // Dettaglio linee
  const datiBeniServizi = body?.getElementsByTagName('DatiBeniServizi')[0]
  const linee = getAllElements(datiBeniServizi, 'DettaglioLinee').map(l => ({
    numero: getTextContent(l, 'NumeroLinea'),
    descrizione: getTextContent(l, 'Descrizione'),
    quantita: getTextContent(l, 'Quantita'),
    unitaMisura: getTextContent(l, 'UnitaMisura'),
    prezzoUnitario: getTextContent(l, 'PrezzoUnitario'),
    prezzoTotale: getTextContent(l, 'PrezzoTotale'),
    aliquotaIva: getTextContent(l, 'AliquotaIVA'),
  }))

  // Riepilogo IVA
  const riepilogo = getAllElements(datiBeniServizi, 'DatiRiepilogo').map(r => ({
    aliquota: getTextContent(r, 'AliquotaIVA'),
    imponibile: getTextContent(r, 'ImponibileImporto'),
    imposta: getTextContent(r, 'Imposta'),
    natura: getTextContent(r, 'Natura'),
    esigibilita: getTextContent(r, 'EsigibilitaIVA'),
  }))

  // Pagamento
  const datiPagamento = body?.getElementsByTagName('DatiPagamento')[0]
  const dettaglioPag = getAllElements(datiPagamento, 'DettaglioPagamento').map(d => ({
    modalita: getTextContent(d, 'ModalitaPagamento'),
    modalitaLabel: MODALITA_PAGAMENTO[getTextContent(d, 'ModalitaPagamento')] || getTextContent(d, 'ModalitaPagamento'),
    scadenza: getTextContent(d, 'DataScadenzaPagamento'),
    importo: getTextContent(d, 'ImportoPagamento'),
    iban: getTextContent(d, 'IBAN'),
    istituto: getTextContent(d, 'IstitutoFinanziario'),
  }))

  return { fornitore, cliente, documento, linee, riepilogo, pagamento: dettaglioPag }
}

// ─── Render fattura come HTML ────────────────────────────────────
function FatturaRendered({ data }) {
  const { fornitore, cliente, documento, linee, riepilogo, pagamento } = data

  const totaleImponibile = riepilogo.reduce((s, r) => s + parseFloat(r.imponibile || 0), 0)
  const totaleImposta = riepilogo.reduce((s, r) => s + parseFloat(r.imposta || 0), 0)

  return (
    <div className="space-y-6 text-sm">
      {/* Header: tipo documento + numero */}
      <div className="text-center border-b pb-4">
        <div className="text-xs text-slate-500 uppercase tracking-wider">{documento.tipoLabel}</div>
        <div className="text-xl font-bold text-slate-900 mt-1">N. {documento.numero}</div>
        <div className="text-sm text-slate-600">Data: {fmtDate(documento.data)}</div>
      </div>

      {/* Fornitore / Cliente */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase font-semibold mb-2">Cedente / Prestatore</div>
          <div className="font-semibold text-slate-900">{fornitore.denominazione}</div>
          {fornitore.partitaIva && <div className="text-xs text-slate-600 mt-1">P.IVA: {fornitore.partitaIva}</div>}
          {fornitore.codiceFiscale && <div className="text-xs text-slate-600">CF: {fornitore.codiceFiscale}</div>}
          {fornitore.indirizzo && (
            <div className="text-xs text-slate-500 mt-1">
              {fornitore.indirizzo}, {fornitore.cap} {fornitore.comune} {fornitore.provincia && `(${fornitore.provincia})`}
            </div>
          )}
        </div>
        <div className="bg-slate-50 rounded-lg p-4">
          <div className="text-xs text-slate-500 uppercase font-semibold mb-2">Cessionario / Committente</div>
          <div className="font-semibold text-slate-900">{cliente.denominazione}</div>
          {cliente.partitaIva && <div className="text-xs text-slate-600 mt-1">P.IVA: {cliente.partitaIva}</div>}
          {cliente.codiceFiscale && <div className="text-xs text-slate-600">CF: {cliente.codiceFiscale}</div>}
          {cliente.indirizzo && (
            <div className="text-xs text-slate-500 mt-1">
              {cliente.indirizzo}, {cliente.cap} {cliente.comune} {cliente.provincia && `(${cliente.provincia})`}
            </div>
          )}
        </div>
      </div>

      {/* Dettaglio linee */}
      {linee.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 uppercase font-semibold mb-2">Dettaglio beni/servizi</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="text-left p-2 font-semibold">#</th>
                <th className="text-left p-2 font-semibold">Descrizione</th>
                <th className="text-right p-2 font-semibold">Qtà</th>
                <th className="text-right p-2 font-semibold">Prezzo un.</th>
                <th className="text-right p-2 font-semibold">Totale</th>
                <th className="text-right p-2 font-semibold">IVA %</th>
              </tr>
            </thead>
            <tbody>
              {linee.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="p-2 text-slate-400">{l.numero || i + 1}</td>
                  <td className="p-2 text-slate-800 max-w-[300px]">{l.descrizione}</td>
                  <td className="p-2 text-right text-slate-600">{l.quantita || '—'}</td>
                  <td className="p-2 text-right text-slate-600">{fmtNum(l.prezzoUnitario)}</td>
                  <td className="p-2 text-right font-medium text-slate-900">{fmtNum(l.prezzoTotale)}</td>
                  <td className="p-2 text-right text-slate-600">{fmtNum(l.aliquotaIva)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Riepilogo IVA */}
      {riepilogo.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 uppercase font-semibold mb-2">Riepilogo IVA</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="text-left p-2 font-semibold">Aliquota</th>
                <th className="text-left p-2 font-semibold">Natura</th>
                <th className="text-right p-2 font-semibold">Imponibile</th>
                <th className="text-right p-2 font-semibold">Imposta</th>
              </tr>
            </thead>
            <tbody>
              {riepilogo.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="p-2">{fmtNum(r.aliquota)}%</td>
                  <td className="p-2 text-slate-600">{r.natura || '—'}</td>
                  <td className="p-2 text-right">{fmtNum(r.imponibile)}</td>
                  <td className="p-2 text-right">{fmtNum(r.imposta)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td className="p-2" colSpan={2}>Totale</td>
                <td className="p-2 text-right">{fmtNum(totaleImponibile)}</td>
                <td className="p-2 text-right">{fmtNum(totaleImposta)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Totale documento */}
      <div className="flex justify-end">
        <div className="bg-blue-50 rounded-lg px-6 py-3 text-right">
          <div className="text-xs text-blue-600 uppercase">Totale documento</div>
          <div className="text-2xl font-bold text-blue-900">{fmtNum(documento.importoTotale)} {documento.divisa}</div>
        </div>
      </div>

      {/* Pagamento */}
      {pagamento.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 uppercase font-semibold mb-2">Dati pagamento</div>
          <div className="space-y-2">
            {pagamento.map((p, i) => (
              <div key={i} className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500">Modalità:</span>
                  <div className="font-medium">{p.modalitaLabel}</div>
                </div>
                <div>
                  <span className="text-slate-500">Scadenza:</span>
                  <div className="font-medium">{fmtDate(p.scadenza)}</div>
                </div>
                <div>
                  <span className="text-slate-500">Importo:</span>
                  <div className="font-medium">{fmtNum(p.importo)} EUR</div>
                </div>
                {p.iban && (
                  <div>
                    <span className="text-slate-500">IBAN:</span>
                    <div className="font-medium font-mono text-[11px]">{p.iban}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {documento.causale && (
        <div className="text-xs text-slate-500 italic border-t pt-3">
          Causale: {documento.causale}
        </div>
      )}
    </div>
  )
}

// ─── Componente principale InvoiceViewer ─────────────────────────
export default function InvoiceViewer({ xmlContent, onClose }) {
  const [error, setError] = useState(null)

  const parsed = useMemo(() => {
    if (!xmlContent) return null
    try {
      return parseFatturaPA(xmlContent)
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [xmlContent])

  const handlePrint = () => {
    const printWindow = window.open('', '_blank')
    if (!printWindow) return
    const container = document.getElementById('invoice-render-area')
    if (!container) return
    printWindow.document.write(`
      <html><head><title>Fattura ${parsed?.documento?.numero || ''}</title>
      <style>body{font-family:system-ui,sans-serif;padding:40px;font-size:12px;color:#333}
      table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #eee}
      th{background:#f5f5f5;font-weight:600}.text-right{text-align:right}
      </style></head><body>${container.innerHTML}</body></html>
    `)
    printWindow.document.close()
    printWindow.print()
  }

  const handleDownloadXml = () => {
    const blob = new Blob([xmlContent], { type: 'application/xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fattura_${parsed?.documento?.numero || 'xml'}.xml`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (!xmlContent) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden mx-4 flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50 rounded-t-xl flex-shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <FileText size={16} className="text-blue-600" />
            Anteprima Fattura
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
              <Printer size={13} /> Stampa / PDF
            </button>
            <button onClick={handleDownloadXml} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition">
              <Download size={13} /> XML
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6" id="invoice-render-area">
          {error ? (
            <div className="flex items-center gap-3 p-4 bg-red-50 text-red-700 rounded-lg">
              <AlertCircle size={18} />
              <div>
                <div className="font-medium">Impossibile visualizzare la fattura</div>
                <div className="text-xs mt-1">{error}</div>
              </div>
            </div>
          ) : parsed ? (
            <FatturaRendered data={parsed} />
          ) : (
            <div className="text-center py-8 text-slate-400">Nessun contenuto XML disponibile</div>
          )}
        </div>
      </div>
    </div>
  )
}
