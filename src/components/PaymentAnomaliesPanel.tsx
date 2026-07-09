import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ArrowRight, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Pannello segnalazioni "anomalie configurazione pagamento fornitore".
// Alimentato dalla tabella payment_import_anomalies (stato condiviso azienda).
// Al mount lancia il refresh (rpc) e mostra le anomalie APERTE con "come risolvere".

interface AnomalyRow {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  anomaly_type: string
  descrizione: string | null
  come_risolvere: string | null
}

const TYPE_LABEL: Record<string, string> = {
  metodo_mancante: 'Modalità pagamento mancante',
  banca_mancante: 'Banca di pagamento mancante',
  piano_incompleto: 'Piano rate incompleto',
  importo_non_quadra: 'Importo non quadra',
  fornitore_non_riconosciuto: 'Fornitore non riconosciuto',
}

export default function PaymentAnomaliesPanel() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<AnomalyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Ricalcola le anomalie (idempotente), poi leggi quelle aperte.
      await supabase.rpc('rpc_refresh_payment_anomalies' as never)
      // Tabella non ancora nei tipi generati (database.ts): cast minimale.
      const sb = supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (col: string, val: string) => {
              order: (col: string, o: { ascending: boolean }) => Promise<{ data: unknown }>
            }
          }
        }
      }
      const { data } = await sb
        .from('payment_import_anomalies')
        .select('id, supplier_id, supplier_name, anomaly_type, descrizione, come_risolvere')
        .eq('stato', 'aperta')
        .order('supplier_name', { ascending: true })
      setRows((data || []) as unknown as AnomalyRow[])
    } catch (e) {
      console.warn('[payment-anomalies]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function resolve(id: string) {
    setResolvingId(id)
    try {
      await supabase.rpc('rpc_resolve_payment_anomaly' as never, { p_id: id } as never)
      setRows(prev => prev.filter(r => r.id !== id))
      // Aggiorna il badge rosso in sidebar
      window.dispatchEvent(new Event('fatt-anomalia-risolta'))
    } catch (e) {
      console.warn('[payment-anomalies:resolve]', e)
    } finally {
      setResolvingId(null)
    }
  }

  if (loading && rows.length === 0) return null
  if (rows.length === 0) return null

  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/70 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-rose-500" />
          <span className="font-semibold text-rose-700">
            {rows.length} {rows.length === 1 ? 'anomalia' : 'anomalie'} sui fornitori da sistemare
          </span>
        </div>
        {expanded ? <ChevronUp size={18} className="text-rose-400" /> : <ChevronDown size={18} className="text-rose-400" />}
      </button>

      {expanded && (
        <div className="divide-y divide-rose-100 border-t border-rose-100">
          {rows.map(r => (
            <div key={r.id} className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-rose-600 bg-rose-100 px-2 py-0.5 rounded">
                    {TYPE_LABEL[r.anomaly_type] || r.anomaly_type}
                  </span>
                  <span className="font-medium text-slate-800 truncate">{r.supplier_name || 'Fornitore'}</span>
                </div>
                <p className="mt-1 text-sm text-slate-600">{r.descrizione}</p>
                {r.come_risolvere && (
                  <p className="mt-0.5 text-xs text-slate-500"><span className="font-medium">Come risolvere:</span> {r.come_risolvere}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.supplier_id && (
                  <button
                    onClick={() => navigate(`/fornitori?edit=${r.supplier_id}`)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    Vai al fornitore <ArrowRight size={14} />
                  </button>
                )}
                <button
                  onClick={() => resolve(r.id)}
                  disabled={resolvingId === r.id}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  title="Segna risolta (per tutte le operatrici)"
                >
                  {resolvingId === r.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Risolto
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
