import React, { useState, useEffect, useMemo } from 'react'
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

// TODO: tighten type
interface FatturaData {
  fornitore: Record<string, string>
  cliente: Record<string, string>
  documento: Record<string, string>
  linee: Array<Record<string, string>>
  riepilogo: Array<Record<string, string>>
  pagamento: Array<Record<string, string>>
}

function getTextContent(parent: Element | null, tagName: string): string {
  if (!parent) return ''
  const el = parent.getElementsByTagName(tagName)[0]
  return el ? el.textContent.trim() : ''
}

function getAllElements(parent: Element | null, tagName: string): Element[] {
  if (!parent) return []
  return Array.from(parent.getElementsByTagName(tagName))
}

// ─── Parse FatturaPA XML → struttura dati ────────────────────────
function parseFatturaPA(xmlString: string): FatturaData {
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

  // Pagamento — legge TUTTI i blocchi DatiPagamento (non solo il primo!)
  const datiPagamentoNodes = getAllElements(body, 'DatiPagamento')
  const dettaglioPag = []
  for (const dp of datiPagamentoNodes) {
    const condizioni = getTextContent(dp, 'CondizioniPagamento')
    const dettagliNodes = getAllElements(dp, 'DettaglioPagamento')
    for (const d of dettagliNodes) {
      dettaglioPag.push({
        condizioni,
        modalita: getTextContent(d, 'ModalitaPagamento'),
        modalitaLabel: MODALITA_PAGAMENTO[getTextContent(d, 'ModalitaPagamento')] || getTextContent(d, 'ModalitaPagamento'),
        scadenza: getTextContent(d, 'DataScadenzaPagamento'),
        importo: getTextContent(d, 'ImportoPagamento'),
        iban: getTextContent(d, 'IBAN'),
        istituto: getTextContent(d, 'IstitutoFinanziario'),
      })
    }
  }

  return { fornitore, cliente, documento, linee, riepilogo, pagamento: dettaglioPag }
}

// ─── Render fattura come HTML ────────────────────────────────────
function FatturaRendered({ data }: { data: FatturaData }) {
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
          {pagamento.length > 1 && (
            <p className="text-xs text-slate-500 mb-2">Pagamento in {pagamento.length} rate</p>
          )}
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100">
                {pagamento.length > 1 && <th className="text-left p-2 font-semibold">Rata</th>}
                <th className="text-left p-2 font-semibold">Modalità</th>
                <th className="text-left p-2 font-semibold">Scadenza</th>
                <th className="text-right p-2 font-semibold">Importo</th>
                <th className="text-left p-2 font-semibold">IBAN</th>
              </tr>
            </thead>
            <tbody>
              {pagamento.map((p, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {pagamento.length > 1 && <td className="p-2 text-slate-600">{i + 1}/{pagamento.length}</td>}
                  <td className="p-2 font-medium">{p.modalitaLabel}</td>
                  <td className="p-2 font-medium">{fmtDate(p.scadenza)}</td>
                  <td className="p-2 text-right font-medium">{fmtNum(p.importo)} EUR</td>
                  <td className="p-2 font-mono text-[11px]">{p.iban || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
// autoPrint: se true, triggera handlePrint automaticamente dopo il mount.
// Usato quando il viewer viene aperto da un bottone "Scarica PDF" che deve
// saltare l'anteprima e andare direttamente al dialog di stampa.
interface InvoiceViewerProps {
  xmlContent: string | null
  onClose: () => void
  autoPrint?: boolean
}

export default function InvoiceViewer({ xmlContent, onClose, autoPrint = false }: InvoiceViewerProps) {
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => {
    if (!xmlContent) return null
    try {
      return parseFatturaPA(xmlContent)
    } catch (err: unknown) {
      setError((err as Error).message)
      return null
    }
  }, [xmlContent])

  // Se autoPrint e' attivo triggera la stampa una volta che il parsing e'
  // pronto. Piccolo delay per dar tempo al modal di renderizzare se visibile.
  useEffect(() => {
    if (autoPrint && parsed) {
      const t = setTimeout(() => handlePrint(), 150)
      return () => clearTimeout(t)
    }
  }, [autoPrint, parsed]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePrint = () => {
    if (!parsed) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) return

    const { fornitore, cliente, documento, linee, riepilogo, pagamento } = parsed
    const totaleImponibile = riepilogo.reduce((s, r) => s + parseFloat(r.imponibile || 0), 0)
    const totaleImposta = riepilogo.reduce((s, r) => s + parseFloat(r.imposta || 0), 0)

    const righeHTML = linee.map(l => `
      <tr>
        <td style="text-align:center">${l.numero || ''}</td>
        <td>${l.descrizione || ''}</td>
        <td style="text-align:center">${l.quantita || '—'}</td>
        <td style="text-align:right">${fmtNum(l.prezzoUnitario)}</td>
        <td style="text-align:right">${fmtNum(l.prezzoTotale)}</td>
        <td style="text-align:center">${fmtNum(l.aliquotaIva)}%</td>
      </tr>
    `).join('')

    const riepilogoHTML = riepilogo.map(r => `
      <tr>
        <td>${fmtNum(r.aliquota)}%</td>
        <td>${r.natura || '—'}</td>
        <td style="text-align:right">${fmtNum(r.imponibile)}</td>
        <td style="text-align:right">${fmtNum(r.imposta)}</td>
      </tr>
    `).join('')

    const pagamentiHTML = pagamento.map((p, idx) => `
      <tr>
        ${pagamento.length > 1 ? `<td>${idx + 1}/${pagamento.length}</td>` : ''}
        <td>${p.modalitaLabel}</td>
        <td>${fmtDate(p.scadenza)}</td>
        <td style="text-align:right;font-weight:bold">${fmtNum(p.importo)} EUR</td>
        <td style="font-family:monospace;font-size:8pt">${p.iban || '—'}</td>
      </tr>
    `).join('')

    printWindow.document.write(`<!DOCTYPE html><html><head>
      <title>Fattura ${documento.numero}</title>
      <style>
        @page { size: A4; margin: 15mm 20mm; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #333; line-height: 1.4; }
        .title { text-align: center; margin: 20px 0; }
        .title h1 { font-size: 16pt; color: #1e40af; margin: 0; }
        .title .subtitle { font-size: 11pt; color: #555; }
        .parties { display: flex; gap: 30px; margin-bottom: 20px; }
        .party { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 4px; }
        .party-label { font-size: 8pt; text-transform: uppercase; color: #888; letter-spacing: 1px; margin-bottom: 6px; }
        .party-name { font-weight: bold; font-size: 11pt; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th { background-color: #f0f4ff; padding: 8px 6px; text-align: left; font-size: 8pt; text-transform: uppercase; color: #555; border-bottom: 2px solid #2563eb; }
        td { padding: 6px; border-bottom: 1px solid #eee; font-size: 9pt; }
        .section-title { font-size: 10pt; font-weight: bold; color: #1e40af; margin-top: 20px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
        .totale-box { float: right; background: #1e40af; color: white; padding: 12px 24px; border-radius: 6px; text-align: center; margin-top: 15px; }
        .totale-box .label { font-size: 8pt; text-transform: uppercase; opacity: 0.8; }
        .totale-box .amount { font-size: 16pt; font-weight: bold; }
        .clearfix::after { content: ""; display: table; clear: both; }
        .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 8pt; color: #999; text-align: center; }
      </style>
    </head><body>
      <div class="title">
        <h1>${documento.tipoLabel || 'FATTURA'}</h1>
        <div class="subtitle">N. ${documento.numero}</div>
        <div class="subtitle">Data: ${fmtDate(documento.data)}</div>
      </div>
      <div class="parties">
        <div class="party">
          <div class="party-label">Cedente / Prestatore</div>
          <div class="party-name">${fornitore.denominazione}</div>
          ${fornitore.partitaIva ? `<div style="font-size:9pt">P.IVA: ${fornitore.partitaIva}</div>` : ''}
          ${fornitore.codiceFiscale ? `<div style="font-size:9pt">CF: ${fornitore.codiceFiscale}</div>` : ''}
          ${fornitore.indirizzo ? `<div style="font-size:8pt;color:#666">${fornitore.indirizzo}, ${fornitore.cap} ${fornitore.comune} ${fornitore.provincia ? `(${fornitore.provincia})` : ''}</div>` : ''}
        </div>
        <div class="party">
          <div class="party-label">Cessionario / Committente</div>
          <div class="party-name">${cliente.denominazione}</div>
          ${cliente.partitaIva ? `<div style="font-size:9pt">P.IVA: ${cliente.partitaIva}</div>` : ''}
          ${cliente.indirizzo ? `<div style="font-size:8pt;color:#666">${cliente.indirizzo}, ${cliente.cap} ${cliente.comune} ${cliente.provincia ? `(${cliente.provincia})` : ''}</div>` : ''}
        </div>
      </div>
      <div class="section-title">DETTAGLIO BENI/SERVIZI</div>
      <table>
        <thead><tr>
          <th style="text-align:center">#</th><th>Descrizione</th><th style="text-align:center">Qtà</th>
          <th style="text-align:right">Prezzo un.</th><th style="text-align:right">Totale</th><th style="text-align:center">IVA %</th>
        </tr></thead>
        <tbody>${righeHTML}</tbody>
      </table>
      <div class="section-title">RIEPILOGO IVA</div>
      <table>
        <thead><tr><th>Aliquota</th><th>Natura</th><th style="text-align:right">Imponibile</th><th style="text-align:right">Imposta</th></tr></thead>
        <tbody>${riepilogoHTML}
          <tr style="border-top:2px solid #333"><td colspan="2" style="font-weight:bold">Totale</td>
          <td style="text-align:right;font-weight:bold">${fmtNum(totaleImponibile)}</td>
          <td style="text-align:right;font-weight:bold">${fmtNum(totaleImposta)}</td></tr>
        </tbody>
      </table>
      <div class="clearfix">
        <div class="totale-box">
          <div class="label">TOTALE DOCUMENTO</div>
          <div class="amount">${fmtNum(documento.importoTotale)} ${documento.divisa}</div>
        </div>
      </div>
      <div style="clear:both"></div>
      <div class="section-title">DATI PAGAMENTO</div>
      ${pagamento.length > 1 ? `<p style="font-size:9pt;color:#666;margin-bottom:8px">Pagamento in ${pagamento.length} rate</p>` : ''}
      <table>
        <thead><tr>
          ${pagamento.length > 1 ? '<th>Rata</th>' : ''}
          <th>Modalità</th><th>Scadenza</th><th style="text-align:right">Importo</th><th>IBAN</th>
        </tr></thead>
        <tbody>${pagamentiHTML}</tbody>
      </table>
      <div class="footer">Documento generato dal gestionale New Zago</div>
      <script>window.onload = function() { window.print(); };</script>
    </body></html>`)
    printWindow.document.close()
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
