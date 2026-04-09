import { useState, useRef } from 'react'
import { parseContract, extractTextFromDoc, extractTextFromDocx, extractTextFromPdf } from '../lib/contractParser'
import {
  Upload, FileText, Check, AlertCircle, RefreshCw,
  X, Sparkles, ArrowRight
} from 'lucide-react'

function fmt(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

function ConfidenceBadge({ pct }) {
  const color = pct >= 70 ? 'bg-emerald-50 text-emerald-700' :
                pct >= 40 ? 'bg-amber-50 text-amber-700' :
                'bg-red-50 text-red-700'
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${color}`}>
      <Sparkles size={12} />
      {pct}% dati estratti
    </span>
  )
}

function DataPreview({ data }) {
  const sections = [
    { title: 'Anagrafica', items: [
      ['Nome outlet', data.name],
      ['Brand/Insegna', data.brand],
      ['SLP (mq)', data.sqm],
      ['Sup. vendita (mq)', data.sell_sqm],
      ['Unita', data.unit_code],
    ]},
    { title: 'Ubicazione', items: [
      ['Centro commerciale', data.mall_name],
      ['Concedente', data.concedente],
      ['Citta', data.city],
      ['Provincia', data.province],
      ['Indirizzo', data.address],
    ]},
    { title: 'Contratto', items: [
      ['Data consegna', data.delivery_date],
      ['Data apertura', data.opening_date],
      ['Durata (mesi)', data.contract_duration_months],
      ['Durata minima (mesi)', data.contract_min_months],
      ['Giorni gratuiti', data.rent_free_days],
    ]},
    { title: 'Canone', items: [
      ['Canone annuo', data.rent_annual ? `${fmt(data.rent_annual)} €` : null],
      ['€/mq', data.rent_per_sqm],
      ['% variabile', data.variable_rent_pct ? `${data.variable_rent_pct}%` : null],
      ['Anno 3+', data.rent_year3_annual ? `${fmt(data.rent_year3_annual)} €` : null],
    ]},
    { title: 'Garanzie', items: [
      ['Fideiussione', data.deposit_guarantee ? `${fmt(data.deposit_guarantee)} €` : null],
      ['Anticipo', data.advance_payment ? `${fmt(data.advance_payment)} €` : null],
      ['Recesso al mese', data.exit_clause_month],
      ['Soglia recesso', data.exit_revenue_threshold ? `${fmt(data.exit_revenue_threshold)} €` : null],
    ]},
  ]

  return (
    <div className="space-y-3">
      {sections.map(s => {
        const hasData = s.items.some(([, v]) => v != null)
        if (!hasData) return null
        return (
          <div key={s.title} className="bg-slate-50 rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{s.title}</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-sm">
              {s.items.filter(([, v]) => v != null).map(([label, value]) => (
                <div key={label} className="flex justify-between py-0.5">
                  <span className="text-slate-500">{label}</span>
                  <span className="font-medium text-slate-900">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AllegatiChecklist({ allegati, uploadedFiles, onFileUpload }) {
  if (!allegati || allegati.length === 0) return null

  const defaultLabels = {
    'A': 'Planimetria Outlet',
    'B': 'Condizioni Generali',
    'C': 'Planimetria Porzione Immobiliare',
    'D': 'Elenco Impianti e Cespiti',
    'E': 'Progetto layout',
    'F': 'Bozza fideiussione bancaria',
    'CG': 'Condizioni Generali',
    'REG': 'Regolamento immobiliare',
  }

  const uploaded = uploadedFiles || {}
  const uploadedCount = Object.keys(uploaded).length

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertCircle size={16} className="text-amber-600" />
          <span className="text-sm font-semibold text-amber-800">
            Allegati menzionati nel contratto ({allegati.length})
          </span>
        </div>
        {uploadedCount > 0 && (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
            {uploadedCount}/{allegati.length} caricati
          </span>
        )}
      </div>
      <p className="text-xs text-amber-700 mb-3">
        Clicca su un allegato per caricarlo ora, oppure potrai farlo dopo dalla scheda outlet.
      </p>
      <div className="space-y-1.5">
        {allegati.map(a => {
          const file = uploaded[a.code]
          return (
            <label
              key={a.code}
              className={`flex items-center gap-2.5 text-sm p-2 rounded-lg cursor-pointer transition ${
                file ? 'bg-emerald-50 border border-emerald-200' : 'hover:bg-amber-100/60 border border-transparent'
              }`}
            >
              <input
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                onChange={e => {
                  if (e.target.files[0] && onFileUpload) {
                    onFileUpload(a.code, e.target.files[0])
                  }
                }}
              />
              <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 ${
                file ? 'bg-emerald-500 text-white' : 'border-2 border-amber-300 bg-white'
              }`}>
                {file ? <Check size={14} /> : <span className="text-[10px] font-bold text-amber-600">{a.code}</span>}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`${file ? 'text-emerald-900' : 'text-amber-900'}`}>
                  Allegato {a.code} — {a.description || defaultLabels[a.code] || 'Documento'}
                </div>
                {file && (
                  <div className="text-xs text-emerald-600 truncate">{file.name}</div>
                )}
              </div>
              {!file && (
                <Upload size={14} className="text-amber-400 shrink-0" />
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

export default function ContractUploader({ onDataExtracted, onCancel }) {
  const fileRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState(null)
  const [fileName, setFileName] = useState(null)
  const [error, setError] = useState(null)
  const [uploadedFiles, setUploadedFiles] = useState({}) // { code: File }

  function handleAllegatoUpload(code, file) {
    setUploadedFiles(prev => ({ ...prev, [code]: file }))
  }

  async function handleFile(file) {
    if (!file) return

    const ext = file.name.split('.').pop().toLowerCase()
    if (!['doc', 'docx', 'pdf', 'txt'].includes(ext)) {
      setError('Formato non supportato. Usa .doc, .docx o .pdf')
      return
    }

    setAnalyzing(true)
    setError(null)
    setFileName(file.name)

    try {
      let text = ''

      if (ext === 'docx') {
        text = await extractTextFromDocx(file)
      } else if (ext === 'doc') {
        text = await extractTextFromDoc(file)
      } else if (ext === 'txt') {
        text = await file.text()
      } else if (ext === 'pdf') {
        text = await extractTextFromPdf(file)
      }

      console.log('[ContractUploader] Testo estratto:', text?.length, 'caratteri')
      console.log('[ContractUploader] Prime 500 char:', text?.substring(0, 500))

      if (!text || text.trim().length < 50) {
        setError('Il PDF sembra essere un\'immagine scansionata — non è stato possibile estrarre testo. Prova a convertire in .doc o .docx, oppure usa un PDF con testo selezionabile.')
        setAnalyzing(false)
        return
      }

      const parsed = parseContract(text)

      // Se nessun dato estratto, avvisa comunque con il testo grezzo
      if (parsed.confidence.pct === 0) {
        console.warn('[ContractUploader] Nessun dato estratto. Il testo potrebbe non essere un contratto outlet.')
      }

      setResult(parsed)
    } catch (err) {
      setError(`Errore nell'analisi: ${err.message}`)
    }

    setAnalyzing(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  function handleProceed() {
    if (result) {
      // Converti il risultato nel formato del wizard
      const wizardData = {
        name: result.name || '',
        code: result.name ? result.name.substring(0, 3).toUpperCase() : '',
        brand: result.brand || '',
        outlet_type: result.outlet_type || 'outlet',
        sqm: result.sqm?.toString() || '',
        sell_sqm: result.sell_sqm?.toString() || '',
        unit_code: result.unit_code || '',
        mall_name: result.mall_name || '',
        concedente: result.concedente || '',
        address: result.address || '',
        city: result.city || '',
        province: result.province || '',
        region: '',
        delivery_date: result.delivery_date || '',
        opening_date: result.opening_date || '',
        opening_confirmed: false,
        contract_start: result.opening_date || '',
        contract_end: '',
        contract_duration_months: result.contract_duration_months?.toString() || '',
        contract_min_months: result.contract_min_months?.toString() || '',
        rent_free_days: result.rent_free_days?.toString() || '30',
        exit_clause_month: result.exit_clause_month?.toString() || '',
        rent_annual: result.rent_annual?.toString() || '',
        rent_monthly: result.rent_annual ? (result.rent_annual / 12).toFixed(2) : '',
        rent_per_sqm: result.rent_per_sqm?.toString() || '',
        variable_rent_pct: result.variable_rent_pct?.toString() || '',
        rent_year2_annual: result.rent_year2_annual?.toString() || result.rent_annual?.toString() || '',
        rent_year3_annual: result.rent_year3_annual?.toString() || '',
        condo_marketing_monthly: '',
        staff_budget_monthly: '',
        deposit_guarantee: result.deposit_guarantee?.toString() || '',
        advance_payment: result.advance_payment?.toString() || '',
        setup_cost: '',
        target_margin_pct: '60',
        target_cogs_pct: '40',
        exit_revenue_threshold: result.exit_revenue_threshold?.toString() || '',
        min_revenue_period: result.exit_clause_month ? `${result.exit_clause_month} mesi` : '',
        notes: '',
      }

      // Calcola contract_end se abbiamo start + durata
      if (wizardData.contract_start && result.contract_duration_months) {
        const start = new Date(wizardData.contract_start)
        start.setMonth(start.getMonth() + result.contract_duration_months)
        wizardData.contract_end = start.toISOString().split('T')[0]
      }

      onDataExtracted(wizardData, result.allegati, fileName, uploadedFiles)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Crea outlet da contratto</h2>
            <p className="text-xs text-slate-400 mt-0.5">Carica il contratto e i dati verranno estratti automaticamente</p>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-slate-100 rounded-lg"><X size={20} /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              <AlertCircle size={16} /><span>{error}</span>
              <button onClick={() => setError(null)} className="ml-auto"><X size={14} /></button>
            </div>
          )}

          {/* Upload zone */}
          {!result && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${
                dragOver ? 'border-blue-400 bg-blue-50' :
                analyzing ? 'border-blue-300 bg-blue-50/50' :
                'border-slate-200 hover:border-blue-300 hover:bg-slate-50'
              }`}
            >
              <input ref={fileRef} type="file" accept=".doc,.docx,.pdf,.txt" onChange={e => handleFile(e.target.files[0])} className="hidden" />
              {analyzing ? (
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw size={36} className="text-blue-500 animate-spin" />
                  <span className="text-sm font-medium text-blue-700">Analisi del contratto in corso...</span>
                  <span className="text-xs text-blue-500">{fileName}</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="p-4 rounded-full bg-blue-50">
                    <FileText size={36} className="text-blue-500" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">
                    Trascina il contratto o clicca per selezionare
                  </span>
                  <span className="text-xs text-slate-400">
                    Formati: .pdf, .doc, .docx — Il sistema estrarrà automaticamente i dati
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {result && (
            <>
              {/* Success banner */}
              <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <Check size={18} className="text-emerald-600" />
                  <div>
                    <span className="text-sm font-medium text-emerald-800">Analisi completata</span>
                    <span className="text-xs text-emerald-600 ml-2">{fileName}</span>
                  </div>
                </div>
                <ConfidenceBadge pct={result.confidence.pct} />
              </div>

              {/* Extracted data */}
              <DataPreview data={result} />

              {/* Allegati checklist — upload interattivo */}
              <AllegatiChecklist
                allegati={result.allegati}
                uploadedFiles={uploadedFiles}
                onFileUpload={handleAllegatoUpload}
              />

              {/* Re-upload */}
              <button
                onClick={() => { setResult(null); setFileName(null) }}
                className="text-xs text-blue-600 hover:underline"
              >
                Carica un contratto diverso
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-slate-100">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition">
            Annulla
          </button>
          {result && (
            <button onClick={handleProceed}
              className="flex items-center gap-2 px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              Procedi con il wizard <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
