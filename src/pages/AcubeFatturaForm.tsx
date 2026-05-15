// Pagina: /fatturazione/nuova-acube
// Form minimale per emettere fattura attiva via A-Cube SDI sandbox/production.
// Chiama Edge Function acube-sdi-send-invoice. Mostra esito (uuid + sdi_file_id) o errore.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Send, Loader2, CheckCircle, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Line = { description: string; quantity: number; unit_price: number; vat_rate: number }
type Stage = 'sandbox' | 'production'
type Result = { acube_uuid: string; sdi_file_id?: string; marking?: string; total: number } | null

const newLine = (): Line => ({ description: '', quantity: 1, unit_price: 0, vat_rate: 22 })

export default function AcubeFatturaForm() {
  const [stage, setStage] = useState<Stage>('sandbox')
  const [cessFiscalId, setCessFiscalId] = useState('')
  const [cessName, setCessName] = useState('')
  const [cessCity, setCessCity] = useState('')
  const [cessProvince, setCessProvince] = useState('')
  const [cessZip, setCessZip] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState(`ATT-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`)
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [docType, setDocType] = useState('TD01')
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [error, setError] = useState<string | null>(null)

  const totalNet = lines.reduce((s, l) => s + (l.quantity * l.unit_price), 0)
  const totalVat = lines.reduce((s, l) => s + (l.quantity * l.unit_price * l.vat_rate / 100), 0)
  const totalGross = totalNet + totalVat

  const updateLine = (i: number, patch: Partial<Line>) => {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true); setError(null); setResult(null)
    try {
      const body = {
        stage,
        cessionario: {
          fiscal_id: cessFiscalId.trim(),
          name: cessName.trim(),
          address: { city: cessCity, province: cessProvince, zip: cessZip, country: 'IT' },
        },
        invoice: {
          number: invoiceNumber.trim(),
          date: invoiceDate,
          document_type: docType,
          currency: 'EUR',
          lines: lines.map(l => ({
            description: l.description,
            quantity: l.quantity,
            unit_price: l.unit_price,
            vat_rate: l.vat_rate,
          })),
        },
      }
      const { data, error: fnErr } = await supabase.functions.invoke('acube-sdi-send-invoice', { body })
      if (fnErr) throw new Error(fnErr.message ?? String(fnErr))
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
      setResult(data as Result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setResult(null); setError(null)
    setInvoiceNumber(`ATT-${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`)
    setLines([newLine()])
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link to="/fatturazione?tab=active" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} /> Torna a Fatturazione
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Nuova Fattura Attiva — A-Cube SDI</h1>
        <p className="text-sm text-slate-600 mt-1">
          Emetti una fattura via A-Cube. In <strong>sandbox</strong> non viene davvero inviata a SDI. In <strong>production</strong> sì.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Ambiente</h2>
            <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
              {(['sandbox', 'production'] as Stage[]).map(s => (
                <button key={s} type="button" onClick={() => setStage(s)}
                  className={`px-3 py-1 text-sm rounded ${stage === s ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}>
                  {s === 'sandbox' ? '🧪 Sandbox' : '🚀 Production'}
                </button>
              ))}
            </div>
          </div>
          {stage === 'production' && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠️ Production = fattura reale inviata a SDI. Non si può annullare, solo emettere nota di credito.
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h2 className="font-semibold text-slate-900">Cliente (Cessionario)</h2>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm text-slate-700">P.IVA / Codice Fiscale *</span>
              <input required value={cessFiscalId} onChange={e => setCessFiscalId(e.target.value)}
                placeholder="12345678901" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="text-sm text-slate-700">Ragione sociale *</span>
              <input required value={cessName} onChange={e => setCessName(e.target.value)}
                placeholder="Cliente SRL" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="text-sm text-slate-700">Città</span>
              <input value={cessCity} onChange={e => setCessCity(e.target.value)}
                placeholder="Milano" className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </label>
            <label className="block grid grid-cols-2 gap-2">
              <div>
                <span className="text-sm text-slate-700">Provincia</span>
                <input value={cessProvince} onChange={e => setCessProvince(e.target.value)}
                  placeholder="MI" maxLength={2} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <span className="text-sm text-slate-700">CAP</span>
                <input value={cessZip} onChange={e => setCessZip(e.target.value)}
                  placeholder="20100" maxLength={5} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </label>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h2 className="font-semibold text-slate-900">Dati Documento</h2>
          <div className="grid grid-cols-3 gap-4">
            <label className="block">
              <span className="text-sm text-slate-700">Numero *</span>
              <input required value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono" />
            </label>
            <label className="block">
              <span className="text-sm text-slate-700">Data *</span>
              <input required type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="text-sm text-slate-700">Tipo</span>
              <select value={docType} onChange={e => setDocType(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                <option value="TD01">TD01 — Fattura</option>
                <option value="TD04">TD04 — Nota di credito</option>
                <option value="TD24">TD24 — Differita</option>
              </select>
            </label>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Linee documento</h2>
            <button type="button" onClick={() => setLines([...lines, newLine()])}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <Plus size={14} /> Aggiungi linea
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <label className="block col-span-5">
                  <span className="text-xs text-slate-600">Descrizione</span>
                  <input required value={l.description} onChange={e => updateLine(i, { description: e.target.value })}
                    className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
                </label>
                <label className="block col-span-2">
                  <span className="text-xs text-slate-600">Quantità</span>
                  <input type="number" step="0.01" value={l.quantity}
                    onChange={e => updateLine(i, { quantity: parseFloat(e.target.value) || 0 })}
                    className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
                </label>
                <label className="block col-span-2">
                  <span className="text-xs text-slate-600">Prezzo unit.</span>
                  <input type="number" step="0.01" value={l.unit_price}
                    onChange={e => updateLine(i, { unit_price: parseFloat(e.target.value) || 0 })}
                    className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm" />
                </label>
                <label className="block col-span-2">
                  <span className="text-xs text-slate-600">IVA %</span>
                  <select value={l.vat_rate} onChange={e => updateLine(i, { vat_rate: parseFloat(e.target.value) })}
                    className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
                    <option value={22}>22</option>
                    <option value={10}>10</option>
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={0}>0</option>
                  </select>
                </label>
                <button type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                  className="col-span-1 p-1.5 text-red-600 disabled:text-slate-300 hover:bg-red-50 rounded">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="border-t pt-3 flex justify-between text-sm">
            <span className="text-slate-600">Imponibile: <strong>€ {totalNet.toFixed(2)}</strong> + IVA € {totalVat.toFixed(2)}</span>
            <span className="text-lg font-bold text-slate-900">Totale: € {totalGross.toFixed(2)}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <XCircle size={20} className="text-red-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-semibold text-red-900">Errore invio</div>
              <pre className="text-xs text-red-700 mt-1 whitespace-pre-wrap break-all">{error}</pre>
            </div>
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle size={20} className="text-green-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-green-900">Fattura inviata ad A-Cube ({stage})</div>
                <div className="text-sm text-green-800 mt-2 space-y-1 font-mono">
                  <div>UUID A-Cube: <strong>{result.acube_uuid}</strong></div>
                  {result.sdi_file_id && <div>SDI file ID: <strong>{result.sdi_file_id}</strong></div>}
                  {result.marking && <div>Stato: <strong>{result.marking}</strong></div>}
                  <div>Totale: <strong>€ {result.total.toFixed(2)}</strong></div>
                </div>
                <button type="button" onClick={reset}
                  className="mt-3 text-sm text-green-700 hover:text-green-800 underline">
                  Crea un'altra fattura
                </button>
              </div>
            </div>
          </div>
        )}

        {!result && (
          <div className="flex justify-end">
            <button type="submit" disabled={submitting || !cessFiscalId || !cessName}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg font-medium transition">
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {submitting ? 'Invio in corso…' : `Invia via A-Cube (${stage})`}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
