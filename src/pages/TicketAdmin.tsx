// ═══════════════════════════════════════════════════════════════════
// Segnalazioni — Cruscotto Admin
//
// Pagina dedicata a super_advisor (Patrizio + Lilian) per la gestione
// operativa delle segnalazioni.
//
// La VISTA LISTA e' la STESSA di /ticket (componente TicketList con
// adminMode=true), per coerenza tra operatori e admin (richiesto
// esplicitamente). In modalita' admin la lista mostra:
//  - Checkbox di selezione su ogni riga
//  - Barra bulk actions sopra la tabella quando hai selezioni attive
//
// Bonus admin sopra/sotto la lista:
//  - SLA card: ticket fermi >= 3 giorni
//  - Bottone "Esporta CSV"
//  - Timeline ultimi commenti AutoFix
//  - Modale "Chiudi senza lavorarlo": chiude direttamente con motivo
//    (l'AutoFix non tocca i ticket chiusi)
//
// Accesso: solo role === 'super_advisor'.
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Clock, Download, MessageSquare, RefreshCw, Shield, Sparkles, Trash2, Upload, X, XCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import { errorMessage } from '../types/business'
import {
  type Ticket, type TicketCommento, type TicketStato,
  TICKET_STATO_LABEL,
} from '../types/ticket'
import { TicketList } from './Ticket'
import { Modal } from '../components/ui/Modal'

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

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v).replace(/"/g, '""')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s}"`
  return s
}

export default function TicketAdminPage() {
  const { profile, session } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [closeWithoutWorkModal, setCloseWithoutWorkModal] = useState<{
    ids: string[]; clearSelection: () => void;
  } | null>(null)
  const [closeMotivo, setCloseMotivo] = useState('')
  // Import ticket batch da CSV/XLSX
  type ImportRow = {
    titolo: string; descrizione: string; modulo: string;
    priorita: 'basso' | 'medio' | 'alto'; tipo: 'bug' | 'funzione';
    _errors?: string[];
  }
  const [importModal, setImportModal] = useState<{ rows: ImportRow[]; fileName: string } | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const [confirm, setConfirm] = useState<null | {
    title: string; message: string; confirmLabel?: string; destructive?: boolean;
    onConfirm: () => void;
  }>(null)

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

  // Ticket fermi (>= 3 giorni in stato aperto o in_corso)
  const fermi = useMemo(() => {
    return tickets.filter(t => (t.stato === 'aperto' || t.stato === 'in_corso') && daysSince(t.creato_il) >= 3)
  }, [tickets])

  // Commenti AutoFix recenti (ultimi 15)
  // NOTA: commenti vecchi possono avere creato_il=undefined o testo=null,
  // serve fallback safe in localeCompare per non crashare la pagina.
  const commentiAutoFixRecenti = useMemo(() => {
    const items: Array<{ ticketId: string; ticketTitolo: string; testo: string; creato_il: string }> = []
    for (const t of tickets) {
      for (const c of (t.commenti ?? [])) {
        if (c?.origine === 'ai') {
          items.push({
            ticketId: t.id,
            ticketTitolo: t.titolo ?? '(senza titolo)',
            testo: c.testo ?? '',
            creato_il: c.creato_il ?? '',
          })
        }
      }
    }
    return items.sort((a, b) => (b.creato_il || '').localeCompare(a.creato_il || '')).slice(0, 15)
  }, [tickets])

  const autoreAdminLabel: string =
    (profile?.full_name as string | undefined) ??
    (session?.user?.email as string | undefined) ??
    'Admin'

  // Bulk update stato (per "Prendi in carico", "Riapri")
  const bulkUpdateStato = async (ids: string[], nuovoStato: TicketStato, clear: () => void) => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      const patch: Record<string, unknown> = { stato: nuovoStato }
      if (nuovoStato === 'risolto') patch.risolto_il = new Date().toISOString()
      if (nuovoStato === 'aperto' || nuovoStato === 'in_corso') patch.risolto_il = null
      const { error } = await supabase
        .from('tickets' as never)
        .update(patch as never)
        .in('id', ids)
      if (error) throw error
      toast({ type: 'success', message: `${ids.length} ticket aggiornati a "${TICKET_STATO_LABEL[nuovoStato]}"` })
      clear()
      await load()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Aggiornamento fallito') })
    } finally {
      setBusy(false)
    }
  }

  // Risolvi via AI: invoca Edge Function ticket-resolve-now su ogni ticket
  // selezionato. L'edge function chiama Claude API, analizza il file del
  // modulo, apre PR su GitHub e aggiunge commenti AI nel ticket.
  // Per N ticket: chiamate seriali (no parallel) per non saturare Anthropic
  // rate limit e per dare feedback progressivo all'utente.
  const bulkResolveViaAI = async (ids: string[], clear: () => void) => {
    if (ids.length === 0) return
    setBusy(true)
    let fixed = 0
    let cantFix = 0
    let failed = 0
    const errors: string[] = []
    try {
      for (const ticketId of ids) {
        try {
          const { data, error } = await supabase.functions.invoke('ticket-resolve-now', {
            body: { ticketId },
          })
          if (error) {
            failed++
            errors.push(`${ticketId.slice(0, 8)}: ${error.message}`)
            continue
          }
          if (data?.action === 'fix') fixed++
          else if (data?.action === 'cant_fix') cantFix++
          else { failed++; errors.push(`${ticketId.slice(0, 8)}: risposta inattesa`) }
        } catch (e) {
          failed++
          errors.push(`${ticketId.slice(0, 8)}: ${errorMessage(e)}`)
        }
      }
      const parts: string[] = []
      if (fixed > 0) parts.push(`${fixed} risolt${fixed === 1 ? 'o con PR' : 'i con PR'}`)
      if (cantFix > 0) parts.push(`${cantFix} non risolvibil${cantFix === 1 ? 'e' : 'i'} (commento AI)`)
      if (failed > 0) parts.push(`${failed} error${failed === 1 ? 'e' : 'i'}`)
      toast({
        type: failed > 0 ? 'warning' : 'success',
        message: parts.join(', ') || 'Nessuna azione',
      })
      if (errors.length > 0) console.warn('[ticket-resolve-now] errori:', errors)
      clear()
      await load()
    } finally {
      setBusy(false)
    }
  }

  // Chiudi senza lavorarli: salta workflow aperto→in_corso→risolto e va diretto
  // a chiuso, scrivendo un commento admin che spiega il motivo. L'AutoFix
  // non tocca i ticket chiusi, quindi questo li ferma immediatamente.
  const bulkCloseWithoutWork = async (ids: string[], motivo: string, clear: () => void) => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      // Per ogni ticket, leggi commenti correnti e aggiungi il commento admin
      const { data: existing, error: readErr } = await supabase
        .from('tickets' as never)
        .select('id, commenti')
        .in('id', ids)
      if (readErr) throw readErr

      const updates = (existing as unknown as Array<{ id: string; commenti: TicketCommento[] | null }>).map(t => {
        const nuovoCommento: TicketCommento = {
          id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          autore: autoreAdminLabel,
          origine: 'utente',
          testo: `[Admin] Ticket chiuso senza lavorazione. Motivo: ${motivo.trim() || '(non specificato)'}`,
          creato_il: new Date().toISOString(),
        }
        return {
          id: t.id,
          commenti: [...(t.commenti ?? []), nuovoCommento],
        }
      })

      // Update riga-per-riga (Supabase non supporta update bulk con valori diversi per riga)
      for (const u of updates) {
        const { error: updErr } = await supabase
          .from('tickets' as never)
          .update({
            stato: 'chiuso',
            risolto_il: null,
            commenti: u.commenti,
          } as never)
          .eq('id', u.id)
        if (updErr) throw updErr
      }

      toast({ type: 'success', message: `${ids.length} ticket chius${ids.length === 1 ? 'o' : 'i'} senza lavorazione` })
      clear()
      setCloseWithoutWorkModal(null)
      setCloseMotivo('')
      await load()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Chiusura fallita') })
    } finally {
      setBusy(false)
    }
  }

  const bulkDelete = async (ids: string[], clear: () => void) => {
    if (ids.length === 0) return
    setBusy(true)
    try {
      // Prima rimuovo gli allegati dallo storage dei ticket selezionati, per non
      // lasciare file orfani nel bucket 'media' (prima la cancellazione in blocco
      // li abbandonava tutti). Best-effort: non blocca la cancellazione.
      const idSet = new Set(ids)
      const paths: string[] = []
      for (const t of tickets) {
        if (!idSet.has(t.id)) continue
        for (const att of (t.allegati || [])) {
          let p = att.path ?? null
          if (!p && att.url) { const i = att.url.indexOf('/media/'); if (i >= 0) p = att.url.slice(i + 7) }
          if (p) paths.push(p)
        }
        if (t.screenshot_url) { const i = t.screenshot_url.indexOf('/media/'); if (i >= 0) paths.push(t.screenshot_url.slice(i + 7)) }
      }
      if (paths.length > 0) {
        const { error: rmErr } = await supabase.storage.from('media').remove(paths)
        if (rmErr) console.warn('[ticket-admin] pulizia allegati storage:', rmErr.message)
      }

      const { error } = await supabase
        .from('tickets' as never)
        .delete()
        .in('id', ids)
      if (error) throw error
      toast({ type: 'success', message: `${ids.length} ticket cancellat${ids.length === 1 ? 'o' : 'i'}` })
      clear()
      await load()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Cancellazione fallita') })
    } finally {
      setBusy(false)
    }
  }

  // ────────── Import ticket batch da CSV/XLSX ──────────
  // Colonne attese: titolo, descrizione, modulo, priorita (basso|medio|alto),
  // tipo (bug|funzione). Header riga 1, dalla 2 in poi i dati.
  // Validazione: titolo richiesto >= 3 char, modulo fallback "Altro",
  // priorita fallback "medio", tipo fallback "bug".
  const VALID_PRIORITA = ['basso', 'medio', 'alto'] as const
  const VALID_TIPO = ['bug', 'funzione'] as const

  const handleImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const data = ev.target?.result
        if (!data || typeof data === 'string') return
        const XLSX = await import('xlsx')
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Array<Record<string, unknown>>
        const rows: ImportRow[] = raw.map((r: Record<string, unknown>) => {
          const titolo = String(r.titolo ?? r.Titolo ?? r.title ?? '').trim()
          const descrizione = String(r.descrizione ?? r.Descrizione ?? r.description ?? '').trim()
          const moduloRaw = String(r.modulo ?? r.Modulo ?? r.module ?? 'Altro').trim()
          const prioritaRaw = String(r.priorita ?? r.priorità ?? r.Priorita ?? 'medio').trim().toLowerCase()
          const tipoRaw = String(r.tipo ?? r.Tipo ?? r.type ?? 'bug').trim().toLowerCase()
          const errors: string[] = []
          if (titolo.length < 3) errors.push('titolo mancante o < 3 char')
          const priorita = (VALID_PRIORITA as readonly string[]).includes(prioritaRaw) ? prioritaRaw : 'medio'
          const tipo = (VALID_TIPO as readonly string[]).includes(tipoRaw) ? tipoRaw : 'bug'
          return {
            titolo, descrizione,
            modulo: moduloRaw || 'Altro',
            priorita: priorita as 'basso' | 'medio' | 'alto',
            tipo: tipo as 'bug' | 'funzione',
            _errors: errors.length > 0 ? errors : undefined,
          }
        })
        if (rows.length === 0) {
          toast({ type: 'warning', message: 'File vuoto o nessuna riga valida.' })
          return
        }
        setImportModal({ rows, fileName: file.name })
      } catch (e) {
        toast({ type: 'error', message: `Errore parsing file: ${errorMessage(e)}` })
      }
    }
    reader.onerror = () => toast({ type: 'error', message: 'Errore lettura file.' })
    reader.readAsArrayBuffer(file)
  }

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleImportFile(f)
    e.target.value = ''  // reset così si può rifare lo stesso file
  }

  const confermaImport = async () => {
    if (!importModal) return
    const valide = importModal.rows.filter((r) => !r._errors)
    if (valide.length === 0) {
      toast({ type: 'warning', message: 'Nessuna riga valida da importare.' })
      return
    }
    setBusy(true)
    try {
      const autoreLabel = (profile?.full_name as string | undefined)
        ?? (session?.user?.email as string | undefined)
        ?? 'Admin (import)'
      const autoreId = session?.user?.id ?? null
      const payload = valide.map((r) => ({
        tipo: r.tipo, modulo: r.modulo, titolo: r.titolo,
        descrizione: r.descrizione || null,
        priorita: r.priorita, stato: 'aperto',
        autore: autoreLabel, autore_id: autoreId,
      }))
      const { error } = await supabase.from('tickets' as never).insert(payload as never)
      if (error) throw new Error(error.message)
      toast({ type: 'success', message: `${valide.length} ticket importati con successo.` })
      setImportModal(null)
      await load()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Import fallito') })
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = () => {
    const headers = [
      'id', 'creato_il', 'autore', 'tipo', 'modulo', 'priorita', 'stato',
      'titolo', 'descrizione', 'risolto_il', 'aggiornato_il', 'n_commenti', 'n_allegati',
    ]
    const rows = tickets.map(t => [
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
    a.download = `ticket-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ type: 'success', message: `Esportati ${tickets.length} ticket in CSV` })
  }

  // ────────── Gate UI ──────────
  if (!isAdmin) {
    return (
      <PageShell>
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Shield className="w-10 h-10 text-amber-500 mx-auto mb-2" />
          <h2 className="text-lg font-semibold text-slate-900">Accesso riservato</h2>
          <p className="text-sm text-slate-500 mt-1">
            Il cruscotto admin è riservato ai super_advisor.
          </p>
          <button
            type="button"
            onClick={() => navigate('/ticket')}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            Vai a Ticket &amp; Segnalazioni
          </button>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      {/* Barra admin sopra la TicketList */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => navigate('/ticket')}
            className="text-xs text-blue-700 hover:text-blue-900 flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" /> Vista operatore
          </button>
          <div className="h-4 w-px bg-blue-200" />
          <span className="flex items-center gap-1.5 text-blue-900 font-semibold">
            <Shield className="w-4 h-4" /> Modalità Admin
          </span>
          {fermi.length > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-800 border border-orange-200 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {fermi.length} fermi ≥ 3gg
            </span>
          )}
        </div>
        <p className="text-xs text-blue-700">
          In più rispetto alla vista operatore: selezione multipla, esport CSV, chiudi senza lavorare.
        </p>
      </div>

      {/* La stessa TicketList di /ticket, con adminMode + bulk bar custom */}
      <TicketList
        tickets={tickets}
        loading={loading}
        onRefresh={load}
        onOpenDetail={(id) => navigate(`/ticket/${id}`)}
        onCreate={() => navigate('/ticket')}  // crea passa dalla vista standard
        adminMode
        renderAdminHeaderExtras={() => (
          <>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-2"
              title="Importa ticket batch da CSV o Excel. Colonne: titolo, descrizione, modulo, priorita, tipo."
            >
              <Upload className="w-4 h-4" /> Importa
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={handleImportFileChange}
            />
            <button
              type="button"
              onClick={exportCsv}
              disabled={tickets.length === 0}
              className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Esporta CSV
            </button>
          </>
        )}
        renderAdminBulkBar={(selectedIds, clear) => (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-blue-900">
              {selectedIds.length} ticket selezionat{selectedIds.length === 1 ? 'o' : 'i'}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => bulkUpdateStato(selectedIds, 'in_corso', clear)}
              className="ml-auto px-3 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
            >
              Prendi in carico
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => bulkResolveViaAI(selectedIds, clear)}
              title="Invoca AI che analizza il ticket, applica fix al codice e apre PR su GitHub. Aggiunge commento AI nel ticket per Sabrina/Veronica."
              className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 flex items-center gap-1"
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Risolvi con AI
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setCloseWithoutWorkModal({ ids: selectedIds, clearSelection: clear })}
              className="px-3 py-1.5 text-xs font-medium text-orange-800 bg-orange-100 hover:bg-orange-200 border border-orange-200 rounded-lg disabled:opacity-50 flex items-center gap-1"
              title="Chiude i ticket direttamente come 'chiuso' senza farli lavorare dall'AutoFix. Aggiunge un commento admin col motivo."
            >
              <XCircle className="w-3 h-3" /> Chiudi senza lavorare
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => bulkUpdateStato(selectedIds, 'aperto', clear)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
            >
              Riapri
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                // Audit 2026-07-19: nel modal di conferma elenchiamo QUALI ticket
                // stanno per essere cancellati, non solo quanti — cosi' una
                // selezione dimenticata si riconosce prima del danno.
                const titoli = selectedIds
                  .map(id => tickets.find(t => t.id === id)?.titolo)
                  .filter((t): t is string => Boolean(t))
                const anteprima = titoli.slice(0, 5).map(t => `«${t}»`).join(', ')
                const extra = titoli.length > 5 ? ` e altri ${titoli.length - 5}` : ''
                setConfirm({
                  title: 'Cancellare definitivamente?',
                  message: `Stai per CANCELLARE ${selectedIds.length} ticket: ${anteprima}${extra}. L'operazione e' irreversibile.`,
                  confirmLabel: 'Cancella',
                  destructive: true,
                  onConfirm: () => { setConfirm(null); void bulkDelete(selectedIds, clear) },
                })
              }}
              className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" /> Cancella
            </button>
            <button
              type="button"
              onClick={clear}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              Annulla selezione
            </button>
          </div>
        )}
      />

      {/* Timeline AutoFix recenti */}
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

      {/* Modal import ticket batch (preview + conferma) */}
      {importModal && (
        <Modal
          open
          onClose={() => setImportModal(null)}
          bare
          ariaLabel="Importa ticket — anteprima"
          closeOnBackdrop={false}
          containerClassName="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
          panelClassName="bg-white rounded-xl shadow-2xl max-w-4xl w-full p-6 max-h-[85dvh] flex flex-col"
        >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-600" />
                Importa ticket — anteprima
                <span className="text-xs text-slate-500 font-normal">({importModal.fileName})</span>
              </h3>
              <button
                type="button"
                onClick={() => setImportModal(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
                aria-label="Chiudi"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              <strong>{importModal.rows.length}</strong> righe totali, di cui{' '}
              <strong className="text-emerald-700">{importModal.rows.filter(r => !r._errors).length}</strong> valide,{' '}
              <strong className="text-red-700">{importModal.rows.filter(r => r._errors).length}</strong> con errori (saranno saltate).
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 mb-3">
              Colonne attese: <code className="font-mono">titolo</code> (obbligatorio, min 3 char),{' '}
              <code className="font-mono">descrizione</code>, <code className="font-mono">modulo</code>,{' '}
              <code className="font-mono">priorita</code> (basso/medio/alto),{' '}
              <code className="font-mono">tipo</code> (bug/funzione).
            </div>
            <div className="flex-1 overflow-auto border border-slate-200 rounded-lg">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase">
                  <tr>
                    <th className="px-2 py-1.5 text-left">#</th>
                    <th className="px-2 py-1.5 text-left">Titolo</th>
                    <th className="px-2 py-1.5 text-left">Modulo</th>
                    <th className="px-2 py-1.5 text-left">Priorità</th>
                    <th className="px-2 py-1.5 text-left">Tipo</th>
                    <th className="px-2 py-1.5 text-left">Errori</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {importModal.rows.map((r, i) => (
                    <tr key={i} className={r._errors ? 'bg-red-50' : ''}>
                      <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                      <td className="px-2 py-1.5 text-slate-900 max-w-md truncate" title={r.titolo}>{r.titolo || <em className="text-slate-400">vuoto</em>}</td>
                      <td className="px-2 py-1.5 text-slate-700">{r.modulo}</td>
                      <td className="px-2 py-1.5 text-slate-700">{r.priorita}</td>
                      <td className="px-2 py-1.5 text-slate-700">{r.tipo}</td>
                      <td className="px-2 py-1.5 text-red-700">{r._errors?.join(', ') ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setImportModal(null)}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={confermaImport}
                disabled={busy || importModal.rows.filter(r => !r._errors).length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
                Importa {importModal.rows.filter(r => !r._errors).length} ticket
              </button>
            </div>
        </Modal>
      )}

      {/* Modal chiudi senza lavorare */}
      {closeWithoutWorkModal && (
        <Modal
          open
          onClose={() => { setCloseWithoutWorkModal(null); setCloseMotivo('') }}
          bare
          ariaLabel="Chiudi senza lavorare"
          closeOnBackdrop={false}
          containerClassName="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
          panelClassName="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
        >
            <h3 className="text-lg font-semibold text-slate-900 mb-2 flex items-center gap-2">
              <XCircle className="w-5 h-5 text-orange-600" />
              Chiudi senza lavorare ({closeWithoutWorkModal.ids.length})
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              I ticket selezionati saranno chiusi <strong>senza essere lavorati dall&apos;AutoFix</strong>.
              Verrà aggiunto un commento admin con il motivo.
            </p>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Motivo <span className="text-slate-400 font-normal">(opzionale)</span>
            </label>
            <textarea
              value={closeMotivo}
              onChange={(e) => setCloseMotivo(e.target.value)}
              rows={3}
              placeholder="Es: duplicato di #abc12345, non riproducibile, fuori scope, già risolto manualmente…"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setCloseWithoutWorkModal(null); setCloseMotivo('') }}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => bulkCloseWithoutWork(closeWithoutWorkModal.ids, closeMotivo, closeWithoutWorkModal.clearSelection)}
                className="px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {busy && <RefreshCw className="w-4 h-4 animate-spin" />}
                {busy ? 'Chiusura…' : 'Conferma chiusura'}
              </button>
            </div>
        </Modal>
      )}

      {/* Modal conferma generica (per Cancella) */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{confirm.title}</h3>
            <p className="text-sm text-slate-600 mb-6">{confirm.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={confirm.onConfirm}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                  confirm.destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {confirm.confirmLabel ?? 'Conferma'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      {children}
    </div>
  )
}
