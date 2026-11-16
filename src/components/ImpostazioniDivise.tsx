// Impostazioni di divise e acquisti: sconti standard dell'azienda e «Chi gestisce divise e
// acquisti». Le vede e le cambia solo il Super Advisor (Patrizio, 16/11/2026; migration 422).
// Sta in fondo alla sezione «Divise e acquisti» della pagina della dipendente.

import { useCallback, useEffect, useState } from 'react'
import { Settings, Trash2, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { caricaGestori, impostaGestore, salvaScontiStandard } from '../lib/diviseDb'
import type { SupabaseClient } from '@supabase/supabase-js'

const db = supabase as unknown as SupabaseClient
interface Utente { id: string; nome: string; ruolo: string }

export default function ImpostazioniDivise({ companyId }: { companyId: string }) {
  const { toast } = useToast()
  const [utenti, setUtenti] = useState<Utente[]>([])
  const [gestori, setGestori] = useState<string[] | null>(null)
  const [standard, setStandard] = useState<{ divise: string; acquisti: string }>({ divise: '', acquisti: '' })
  const [scelto, setScelto] = useState('')
  const [busy, setBusy] = useState(false)

  const carica = useCallback(async () => {
    try {
      const [g, u, s] = await Promise.all([
        caricaGestori(companyId),
        supabase.from('user_profiles').select('id, first_name, last_name, role').eq('company_id', companyId),
        db.from('divise_impostazioni').select('sconto_divise_pct, sconto_acquisti_pct').eq('company_id', companyId).maybeSingle(),
      ])
      setGestori(g.map((x) => x.user_id))
      setUtenti(((u.data ?? []) as { id: string; first_name: string | null; last_name: string | null; role: string | null }[])
        .filter((x) => x.role && !['dipendente', 'operatore_cassa', 'viewer'].includes(x.role))
        .map((x) => ({ id: x.id, nome: [x.first_name, x.last_name].filter(Boolean).join(' ') || 'Senza nome', ruolo: x.role ?? '' }))
        .sort((a, b) => a.nome.localeCompare(b.nome)))
      const st = s.data as { sconto_divise_pct: unknown; sconto_acquisti_pct: unknown } | null
      setStandard({ divise: String(st?.sconto_divise_pct ?? 0).replace('.', ','), acquisti: String(st?.sconto_acquisti_pct ?? 0).replace('.', ',') })
    } catch (e) {
      console.error('[divise] impostazioni', e)
      setGestori([])
    }
  }, [companyId])
  useEffect(() => { void carica() }, [carica])

  const fai = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast({ type: 'success', message: ok }); await carica() } catch (e) {
      toast({ type: 'error', message: (e as Error).message })
    } finally { setBusy(false) }
  }
  const salva = () => {
    const d = Number(standard.divise.replace(',', '.')); const a = Number(standard.acquisti.replace(',', '.'))
    if (Number.isNaN(d) || Number.isNaN(a) || d < 0 || d > 100 || a < 0 || a > 100) { toast({ type: 'error', message: 'Lo sconto va da 0 a 100.' }); return }
    void fai(() => salvaScontiStandard(d, a), 'Sconti standard salvati: valgono per i capi presi da adesso')
  }
  const nome = (id: string) => utenti.find((u) => u.id === id)?.nome ?? 'Utente non più attivo'
  const candidati = utenti.filter((u) => !(gestori ?? []).includes(u.id) && u.ruolo !== 'super_advisor')

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="font-semibold text-slate-900 inline-flex items-center gap-2"><Settings size={16} /> Impostazioni divise e acquisti</p>
      <p className="text-xs text-slate-500 mt-0.5">Le vede e le cambia solo il Super Advisor. Valgono per tutta l’azienda.</p>

      <div className="mt-3 grid md:grid-cols-2 gap-4">
        <div>
          <p className="text-sm font-medium text-slate-800">Sconti standard</p>
          <p className="text-xs text-slate-500">Valgono per chi non ha uno sconto personale.</p>
          <div className="flex flex-wrap items-end gap-3 mt-2">
            <label className="text-xs text-slate-600">Divise con sconto
              <span className="flex items-center gap-1 mt-0.5"><input type="text" inputMode="decimal" value={standard.divise} onChange={(e) => setStandard({ ...standard, divise: e.target.value })} className="w-20 px-2 py-1 rounded-lg border border-slate-300 text-sm" /> %</span>
            </label>
            <label className="text-xs text-slate-600">Acquisti personali
              <span className="flex items-center gap-1 mt-0.5"><input type="text" inputMode="decimal" value={standard.acquisti} onChange={(e) => setStandard({ ...standard, acquisti: e.target.value })} className="w-20 px-2 py-1 rounded-lg border border-slate-300 text-sm" /> %</span>
            </label>
            <button type="button" onClick={salva} disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-40">Salva</button>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-800">Chi gestisce divise e acquisti</p>
          <p className="text-xs text-slate-500">Vede la sezione nelle pagine delle dipendenti, corregge i prezzi, segna scaricato e addebitato, cambia gli sconti personali. Il Super Advisor c’è sempre.</p>
          {gestori === null ? <p className="text-sm text-slate-500 mt-2">Carico…</p> : (
            <ul className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {gestori.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">Nessuno oltre al Super Advisor.</li>}
              {gestori.map((g) => (
                <li key={g} className="px-3 py-2 text-sm flex items-center justify-between">
                  <span>{nome(g)}</span>
                  <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Togli ${nome(g)} da chi gestisce divise e acquisti?`)) void fai(() => impostaGestore(g, false), 'Tolto dall’elenco') }}
                    aria-label={`Togli ${nome(g)}`} className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 mt-2">
            <select value={scelto} onChange={(e) => setScelto(e.target.value)} aria-label="Persona da aggiungere" className="flex-1 px-2 py-1.5 rounded-lg border border-slate-300 text-sm">
              <option value="">Scegli una persona…</option>
              {candidati.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <button type="button" disabled={!scelto || busy} onClick={() => { const id = scelto; setScelto(''); void fai(() => impostaGestore(id, true), 'Aggiunto all’elenco') }}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-blue-600 disabled:opacity-40 inline-flex items-center gap-1"><UserPlus size={15} /> Aggiungi</button>
          </div>
        </div>
      </div>
    </div>
  )
}
