// ═══════════════════════════════════════════════════════════════════
// Segnalazioni — Cruscotto Admin
//
// Pagina dedicata a super_advisor (Patrizio + Lilian) per la gestione
// operativa delle segnalazioni: vista aggregata, bulk actions, esport,
// timeline AutoFix, filtro per autore.
//
// Visibile solo se role === 'super_advisor'. Accesso non autorizzato
// reindirizza alla pagina ticket standard.
//
// Differenze rispetto a /ticket:
//  - Cruscotto con SLA (ticket "fermi" da N giorni)
//  - Bulk actions: chiudi N selezionati, riapri N, esporta CSV
//  - Modifica diretta: titolo, descrizione, modulo, priorità
//  - Cancellazione ticket (solo super_advisor)
//  - Filtro per autore (Sabrina / Veronica / Patrizio / ecc)
//  - Lista commenti AutoFix recenti su tutti i ticket
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, ArrowLeft, Bug, Check, CheckSquare, Clock, Download, Filter,
  MessageSquare, RefreshCw, Shield, Sparkles, Square, Trash2, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import { errorMessage } from '../types/business'
import {
  type Ticket, type TicketPriorita, type TicketStato, type TicketTipo,
  TICKET_MODULI, TICKET_PRIORITA_LABEL, TICKET_STATO_LABEL, TICKET_TIPO_LABEL,
} from '../types/ticket'

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}

function shortId(id: string): string {
  return id.slice(0, 8)
}

function priorityClasses(p: TicketPriorita): string {
  switch (p) {
    case 'alto':  return 'bg-red-100 text-red-800 border-red-200'
    case 'medio': return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'basso': return 'bg-slate-100 text-slate-700 border-slate-200'
  }
}

function statoClasses(s: TicketStato): string {
  switch (s) {
    case 'aperto':   return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'in_corso': return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'risolto':  return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'chiuso':   return 'bg-slate-100 text-slate-700 border-slate-200'
  }
}

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v).replace(/"/g, '""')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s}"`
  return s
}

// ─────────────────────────────────────────────────────────────────
// Componente principale
// ─────────────────────────────────────────────────────────────────

export default function TicketAdminPage() {
  const { profile } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroAutore, setFiltroAutore] = useState<string>('tutti')
  const [filtroStato, setFiltroStato] = useState<TicketStato | 'tutti'>('tutti')
  const [filtroTipo, setFiltroTipo] = useState<TicketTipo | 'tutti'>('tutti')
  const [filtroModulo, setFiltroModulo] = useState<string>('tutti')
  const [filtroSlaDays, setFiltroSlaDays] = useState<number>(0)  // 0 = no filtro SLA
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | {
    title: string; message: string; confirmLabel?: string; destructive?: boolean;
    onConfirm: () => void;
  }>(null)

  // Gate: solo super_advisor
  const isAdmin = profile?.role === 'super_advisor'

  const load = useCallback(async () => {
    if (!isAdmin) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('tickets' as never)
        .select('*')
        .order('creato_il', { ascending: false })
      if (error) throw error
      setTickets((data ?? []) as unknown as Ticket[])
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Errore caricamento segnalazioni') })
    } finally {
      setLoading(false)
    }
  }, [isAdmin, toast])

  useEffect(() => { load() }, [load])

  // Lista autori unici per filtro
  const autori = useMemo(() => {
    const set = new Set<string>()
    for (const t of tickets) set.add(t.autore)
    return Array.from(set).sort()
  }, [tickets])

  // Statistiche aggregate
  const stats = useMemo(() => {
    const s = { totale: tickets.length, aperti: 0, in_corso: 0, risolti: 0, chiusi: 0, alta_priorita: 0, fermi_3gg: 0 }
    for (const t of tickets) {
      if (t.stato === 'aperto') s.aperti++
      else if (t.stato === 'in_corso') s.in_corso++
      else if (t.stato === 'risolto') s.risolti++
      else if (t.stato === 'chiuso') s.chiusi++
      if ((t.stato === 'aperto' || t.stato === 'in_corso') && t.priorita === 'alto') s.alta_priorita++
      if ((t.stato === 'aperto' || t.stato === 'in_corso') && daysSince(t.creato_il) >= 3) s.fermi_3gg++
    }
    return s
  }, [tickets])

  // Filtri applicati
  const filtered = useMemo(() => {
    return tickets.filter(t => {
      if (filtroStato !== 'tutti' && t.stato !== filtroStato) return false
      if (filtroTipo !== 'tutti' && t.tipo !== filtroTipo) return false
      if (filtroModulo !== 'tutti' && t.modulo !== filtroModulo) return false
      if (filtroAutore !== 'tutti' && t.autore !== filtroAutore) return false
      if (filtroSlaDays > 0) {
        const age = daysSince(t.creato_il)
        if (age < filtroSlaDays) return false
        if (t.stato !== 'aperto' && t.stato !== 'in_corso') return false
      }
      return true
    })
  }, [tickets, filtroStato, filtroTipo, filtroModulo, filtroAutore, filtroSlaDays])

  // Commenti AutoFix recenti (ultimi 15) — su tutti i ticket
  const commentiAutoFixRecenti = useMemo(() => {
    const items: Array<{ ticketId: string; ticketTitolo: string; testo: string; creato_il: string }> = []
    for (const t of tickets) {
      for (const c of (t.commenti ?? [])) {
        if (c.origine === 'ai') {
          items.push({
            ticketId: t.id,
            ticketTitolo: t.titolo,
            testo: c.testo,
            creato_il: c.creato_il,
          })
        }
      }
    }
    return items.sort((a, b) => b.creato_il.localeCompare(a.creato_il)).slice(0, 15)
  }, [tickets])

  // Selezione
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      if (prev.size === filtered.length) return new Set()
      return new Set(filtered.map(t => t.id))
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  // Bulk actions
  const bulkUpdateStato = async (nuovoStato: TicketStato) => {
    if (selectedIds.size === 0) return
    setBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const patch: Record<string, unknown> = { stato: nuovoStato }
      if (nuovoStato === 'risolto') patch.risolto_il = new Date().toISOString()
      if (nuovoStato === 'aperto' || nuovoStato === 'in_corso') patch.risolto_il = null

      const { error } = await supabase
        .from('tickets' as never)
        .update(patch as never)
        .in('id', ids)
      if (error) throw error

      toast({ type: 'success', message: `${ids.length} segnalazion${ids.length === 1 ? 'e' : 'i'} aggiornat${ids.length === 1 ? 'a' : 'e'} a "${TICKET_STATO_LABEL[nuovoStato]}"` })
      clearSelection()
      await load()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Aggiornamento bulk fallito') })
    } finally {
      setBusy(false)
    }
  }

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return
    setBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const { error } = await supabase
        .from('tickets' as never)
        .delete()
        .in('id', ids)
      if (error) throw error
      toast({ type: 'success', message: `${ids.length} segnalazion${ids.length === 1 ? 'e cancellata' : 'i cancellate'}` })
      clearSelection()
      await load()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Cancellazione bulk fallita') })
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const headers = [
      'id', 'creato_il', 'autore', 'tipo', 'modulo', 'priorita', 'stato',
      'titolo', 'descrizione', 'risolto_il', 'aggiornato_il', 'n_commenti', 'n_allegati',
    ]
    const rows = filtered.map(t => [
      t.id, t.creato_il, t.autore, t.tipo, t.modulo, t.priorita, t.stato,
      t.titolo, t.descrizione ?? '', t.risolto_il ?? '', t.aggiornato_il,
      (t.commenti ?? []).length,
      (t.allegati ?? []).length,
    ].map(csvEscape).join(','))
    const csv = headers.join(',') + '\n' + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `segnalazioni-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ type: 'success', message: `Esportate ${filtered.length} segnalazioni in CSV` })
  }

  // Gate UI
  if (!isAdmin) {
    return (
      <PageShell>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Shield className="w-10 h-10 text-amber-500 mx-auto mb-2" />
          <h2 className="text-lg font-semibold text-slate-900">Accesso riservato</h2>
          <p className="text-sm text-slate-500 mt-1">
            Il cruscotto admin delle segnalazioni è riservato ai super_advisor.
          </p>
          <button
            type="button"
            onClick={() => navigate('/ticket')}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Vai alla pagina segnalazioni
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate('/ticket')}
            className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-1"
          >
            <ArrowLeft className="w-3 h-3" /> Torna a Segnalazioni
          </button>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-blue-600" />
            Cruscotto Admin Segnalazioni
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Vista gestione: bulk actions, esport, SLA, commenti AutoFix recenti.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
            aria-label="Aggiorna"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-2 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Esporta CSV
          </button>
        </div>
      </div>

      {/* Stat cards estese */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Totale"        value={stats.totale}        icon={<MessageSquare className="w-5 h-5 text-slate-700" />}   accent="bg-slate-100" />
        <StatCard label="In attesa"     value={stats.aperti}        icon={<AlertCircle className="w-5 h-5 text-blue-700" />}      accent="bg-blue-100" />
        <StatCard label="In corso"      value={stats.in_corso}      icon={<Clock className="w-5 h-5 text-amber-700" />}           accent="bg-amber-100" />
        <StatCard label="Risolti"       value={stats.risolti}       icon={<Check className="w-5 h-5 text-emerald-700" />}         accent="bg-emerald-100" />
        <StatCard label="Chiusi"        value={stats.chiusi}        icon={<X className="w-5 h-5 text-slate-500" />}               accent="bg-slate-100" />
        <StatCard label="Alta priorità" value={stats.alta_priorita} icon={<AlertCircle className="w-5 h-5 text-red-700" />}       accent="bg-red-100" />
        <StatCard label="Fermi 3+ gg"   value={stats.fermi_3gg}     icon={<Clock className="w-5 h-5 text-orange-700" />}          accent="bg-orange-100" />
      </div>

      {/* Filtri estesi */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-slate-500 text-sm">
          <Filter className="w-4 h-4" /> Filtri:
        </div>
        <SelectChip
          label={`Autore: ${filtroAutore === 'tutti' ? 'tutti' : filtroAutore}`}
          options={[
            { value: 'tutti', label: 'Tutti gli autori' },
            ...autori.map(a => ({ value: a, label: a })),
          ]}
          value={filtroAutore}
          onChange={setFiltroAutore}
        />
        <SelectChip
          label={`Stato: ${filtroStato === 'tutti' ? 'tutti' : TICKET_STATO_LABEL[filtroStato]}`}
          options={[
            { value: 'tutti', label: 'Tutti gli stati' },
            { value: 'aperto', label: TICKET_STATO_LABEL.aperto },
            { value: 'in_corso', label: TICKET_STATO_LABEL.in_corso },
            { value: 'risolto', label: TICKET_STATO_LABEL.risolto },
            { value: 'chiuso', label: TICKET_STATO_LABEL.chiuso },
          ]}
          value={filtroStato}
          onChange={(v) => setFiltroStato(v as TicketStato | 'tutti')}
        />
        <SelectChip
          label={`Tipo: ${filtroTipo === 'tutti' ? 'tutti' : TICKET_TIPO_LABEL[filtroTipo]}`}
          options={[
            { value: 'tutti', label: 'Tutti i tipi' },
            { value: 'bug', label: 'Bug' },
            { value: 'funzione', label: 'Funzione' },
          ]}
          value={filtroTipo}
          onChange={(v) => setFiltroTipo(v as TicketTipo | 'tutti')}
        />
        <SelectChip
          label={`Modulo: ${filtroModulo === 'tutti' ? 'tutti' : filtroModulo}`}
          options={[
            { value: 'tutti', label: 'Tutti i moduli' },
            ...TICKET_MODULI.map(m => ({ value: m, label: m })),
          ]}
          value={filtroModulo}
          onChange={setFiltroModulo}
        />
        <SelectChip
          label={filtroSlaDays === 0 ? 'SLA: qualsiasi' : `SLA: fermi ≥ ${filtroSlaDays}gg`}
          options={[
            { value: '0', label: 'SLA: qualsiasi' },
            { value: '1', label: 'Fermi ≥ 1 giorno' },
            { value: '3', label: 'Fermi ≥ 3 giorni' },
            { value: '7', label: 'Fermi ≥ 1 settimana' },
            { value: '14', label: 'Fermi ≥ 2 settimane' },
          ]}
          value={String(filtroSlaDays)}
          onChange={(v) => setFiltroSlaDays(Number(v))}
        />
        <div className="ml-auto text-xs text-slate-500">
          {filtered.length} su {tickets.length}
        </div>
      </div>

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-blue-900">
            {selectedIds.size} segnalazion{selectedIds.size === 1 ? 'e selezionata' : 'i selezionate'}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkUpdateStato('in_corso')}
            className="ml-auto px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
          >
            Prendi in carico
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkUpdateStato('risolto')}
            className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
          >
            Risolvi
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm({
              title: 'Chiudere le segnalazioni selezionate?',
              message: `Verranno chiuse ${selectedIds.size} segnalazioni. Puoi sempre riaprirle in seguito.`,
              confirmLabel: 'Chiudi tutte',
              onConfirm: () => { setConfirm(null); void bulkUpdateStato('chiuso') },
            })}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
          >
            Chiudi
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => bulkUpdateStato('aperto')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
          >
            Riapri
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirm({
              title: 'Cancellare definitivamente?',
              message: `Stai per CANCELLARE ${selectedIds.size} segnalazioni. L'operazione e' irreversibile.`,
              confirmLabel: 'Cancella',
              destructive: true,
              onConfirm: () => { setConfirm(null); void bulkDelete() },
            })}
            className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Cancella
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            Annulla selezione
          </button>
        </div>
      )}

      {/* Tabella admin */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading && tickets.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
            Caricamento…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            Nessuna segnalazione corrisponde ai filtri.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      aria-label="Seleziona tutti"
                      className="p-0.5 text-slate-500 hover:text-slate-900"
                    >
                      {selectedIds.size === filtered.length && filtered.length > 0
                        ? <CheckSquare className="w-4 h-4 text-blue-600" />
                        : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Titolo</th>
                  <th className="px-3 py-2 text-left">Autore</th>
                  <th className="px-3 py-2 text-left">Tipo</th>
                  <th className="px-3 py-2 text-left">Modulo</th>
                  <th className="px-3 py-2 text-left">Priorità</th>
                  <th className="px-3 py-2 text-left">Stato</th>
                  <th className="px-3 py-2 text-left">Età</th>
                  <th className="px-3 py-2 text-left">Creato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(t => {
                  const isSel = selectedIds.has(t.id)
                  const eta = daysSince(t.creato_il)
                  const slaWarn = (t.stato === 'aperto' || t.stato === 'in_corso') && eta >= 3
                  return (
                    <tr
                      key={t.id}
                      className={`hover:bg-slate-50 ${isSel ? 'bg-blue-50/50' : ''}`}
                    >
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => toggleSelect(t.id)}
                          aria-label={`Seleziona ${t.titolo}`}
                          className="p-0.5"
                        >
                          {isSel
                            ? <CheckSquare className="w-4 h-4 text-blue-600" />
                            : <Square className="w-4 h-4 text-slate-400 hover:text-slate-700" />}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500 font-mono">#{shortId(t.id)}</td>
                      <td className="px-3 py-2.5 max-w-xs">
                        <button
                          type="button"
                          onClick={() => navigate(`/ticket/${t.id}`)}
                          className="text-slate-900 font-medium hover:text-blue-700 hover:underline text-left truncate block w-full"
                          title={t.titolo}
                        >
                          {t.titolo}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{t.autore}</td>
                      <td className="px-3 py-2.5">
                        {t.tipo === 'bug'
                          ? <span className="inline-flex items-center gap-1 text-red-600 text-xs"><Bug className="w-3 h-3" /> Bug</span>
                          : <span className="inline-flex items-center gap-1 text-violet-600 text-xs"><Sparkles className="w-3 h-3" /> Funzione</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 text-xs">{t.modulo}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 text-xs rounded-full border ${priorityClasses(t.priorita)}`}>
                          {TICKET_PRIORITA_LABEL[t.priorita]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 text-xs rounded-full border ${statoClasses(t.stato)}`}>
                          {TICKET_STATO_LABEL[t.stato]}
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 text-xs ${slaWarn ? 'text-orange-700 font-semibold' : 'text-slate-500'}`}>
                        {eta} {eta === 1 ? 'gg' : 'gg'}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs">{formatDate(t.creato_il)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Timeline AutoFix */}
      {commentiAutoFixRecenti.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="text-base font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-600" />
            Ultimi commenti AutoFix
          </h2>
          <ul className="space-y-2">
            {commentiAutoFixRecenti.map((c, i) => (
              <li
                key={i}
                className="border-l-2 border-emerald-300 pl-3 py-1 text-sm cursor-pointer hover:bg-slate-50 rounded-r"
                onClick={() => navigate(`/ticket/${c.ticketId}`)}
              >
                <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                  <span className="truncate" title={c.ticketTitolo}>su «{c.ticketTitolo}»</span>
                  <span className="ml-2 shrink-0">{formatDate(c.creato_il)}</span>
                </div>
                <p className="text-slate-700 line-clamp-2">{c.testo}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modal conferma */}
      {confirm && (
        <ConfirmModal
          open
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          destructive={confirm.destructive}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </PageShell>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sotto-componenti (locali — non riutilizzati altrove)
// ─────────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      {children}
    </div>
  )
}

function StatCard({
  label, value, icon, accent,
}: {
  label: string
  value: number
  icon: React.ReactNode
  accent: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-semibold text-slate-900 leading-none">{value}</div>
          <div className="text-xs text-slate-500 mt-1">{label}</div>
        </div>
      </div>
    </div>
  )
}

function SelectChip({
  label, options, value, onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none pl-3 pr-8 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-200"
        aria-label={label}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" viewBox="0 0 12 12">
        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

function ConfirmModal({
  open, title, message,
  confirmLabel = 'Conferma', cancelLabel = 'Annulla',
  destructive, onConfirm, onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
