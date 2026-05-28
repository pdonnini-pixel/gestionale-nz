// ═══════════════════════════════════════════════════════════════════
// Segnalazioni — modulo di ticket per Sabrina/Veronica
//
// Cosa fa:
// - Permette di aprire una segnalazione (bug o nuova funzione) con
//   titolo, descrizione, modulo coinvolto, priorità e (opz.) screenshot.
// - Mostra la lista delle segnalazioni con stat cards + filtri.
// - Vista dettaglio con stepper di stato, commenti AI/utente, azioni
//   ("Prendi in carico", "Risolvi", "Riapri", "Chiudi").
//
// AutoFix:
// - Un task scheduled Cowork legge i ticket aperti ogni ora, applica
//   fix banali al codice e chiude il ticket lasciando un commento
//   semplice per Sabrina + note_fix tecniche per Patrizio.
// - Vedi `system_deploy_config` (Supabase) per la configurazione di
//   deploy del task scheduled.
//
// Pattern NZ:
// - Niente alert/confirm nativi: tutte le conferme via Modal custom.
// - Toast via `useToast()` (vedi components/Toast.tsx).
// - Solo Tailwind utility classes (no CSS custom).
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  AlertCircle, ArrowLeft, Bug, Check, CheckSquare, Clock, Eye, Filter, FileText, Image as ImageIcon,
  MessageSquare, Paperclip, Plus, RefreshCw, Send, Sparkles, Square, Trash2, Upload, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import { errorMessage } from '../types/business'
import {
  type Ticket, type TicketAllegato, type TicketCommento, type TicketPriorita, type TicketStato,
  type TicketTipo,
  TICKET_MODULI, TICKET_PRIORITA_LABEL, TICKET_STATO_LABEL, TICKET_TIPO_LABEL,
} from '../types/ticket'

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
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

// ─────────────────────────────────────────────────────────────────
// PhaseStepper — stepper visuale 3 step (in attesa → in corso → risolto)
// ─────────────────────────────────────────────────────────────────

function PhaseStepper({ stato }: { stato: TicketStato }) {
  if (stato === 'chiuso') {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <div className="w-3 h-3 rounded-full bg-slate-400" />
        <span>Chiuso</span>
      </div>
    )
  }
  const steps: { key: TicketStato; label: string }[] = [
    { key: 'aperto',   label: 'In attesa' },
    { key: 'in_corso', label: 'In corso' },
    { key: 'risolto',  label: 'Risolto' },
  ]
  const currentIdx = steps.findIndex(s => s.key === stato)
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {steps.map((step, idx) => {
        const active = idx === currentIdx
        const done = idx < currentIdx
        const dotClass = done
          ? 'bg-emerald-500'
          : active
            ? 'bg-blue-500 animate-pulse'
            : 'bg-slate-300'
        const lineClass = done ? 'bg-emerald-500' : 'bg-slate-200'
        return (
          <div key={step.key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${dotClass}`} title={step.label} />
            {idx < steps.length - 1 && <div className={`w-6 h-0.5 ${lineClass}`} />}
          </div>
        )
      })}
      <span className="ml-2 text-slate-600 font-medium">{TICKET_STATO_LABEL[stato]}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// ConfirmModal — conferma azione distruttiva senza dialog nativi
// ─────────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({
  open, title, message,
  confirmLabel = 'Conferma', cancelLabel = 'Annulla',
  destructive, onConfirm, onCancel,
}: ConfirmModalProps) {
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

// ─────────────────────────────────────────────────────────────────
// Lightbox — preview screenshot full-size
// ─────────────────────────────────────────────────────────────────

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 text-white bg-white/10 hover:bg-white/20 rounded-full p-2"
        aria-label="Chiudi anteprima"
      >
        <X className="w-6 h-6" />
      </button>
      <img
        src={url}
        alt="Screenshot segnalazione"
        className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// DropZone — area drag&drop allegati multipli con paste-screenshot
// ─────────────────────────────────────────────────────────────────
// - Drag&drop di più file insieme (immagini + PDF)
// - Click per aprire selettore file
// - Paste con Cmd+V / Ctrl+V degli screenshot dalla clipboard
//   (gestito dal genitore via window.addEventListener)
// - Lista file con preview thumbnail + rimozione singola
// ─────────────────────────────────────────────────────────────────

const ALLOWED_ATTACHMENT_TYPES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'application/pdf',
]
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB

function DropZone({ files, onChange }: { files: File[]; onChange: (next: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const { toast } = useToast()

  const validateAndAdd = (incoming: FileList | File[]) => {
    const accepted: File[] = []
    const rejected: string[] = []
    for (const f of Array.from(incoming)) {
      if (!ALLOWED_ATTACHMENT_TYPES.includes(f.type)) {
        rejected.push(`${f.name} (tipo non supportato)`)
        continue
      }
      if (f.size > MAX_ATTACHMENT_BYTES) {
        rejected.push(`${f.name} (oltre 10 MB)`)
        continue
      }
      accepted.push(f)
    }
    if (rejected.length > 0) {
      toast({ type: 'warning', message: `Saltati: ${rejected.join(', ')}` })
    }
    if (accepted.length > 0) {
      onChange([...files, ...accepted])
    }
  }

  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files?.length) validateAndAdd(e.dataTransfer.files)
        }}
        className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition ${
          dragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
        }`}
      >
        <Upload className="w-6 h-6 text-slate-400 mx-auto mb-2" />
        <p className="text-sm text-slate-700 font-medium">
          Trascina qui i file o <span className="text-blue-600 underline">clicca per selezionare</span>
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Puoi anche incollare uno screenshot con <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono">⌘V</kbd> /{' '}
          <kbd className="px-1 py-0.5 bg-white border border-slate-300 rounded text-[10px] font-mono">Ctrl+V</kbd>
        </p>
        <p className="text-[10px] text-slate-400 mt-1">PNG, JPG, WEBP, GIF, PDF — max 10 MB ciascuno</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_ATTACHMENT_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) validateAndAdd(e.target.files)
          e.target.value = ''  // reset così re-selezionare stesso file riemette change
        }}
      />

      {files.length > 0 && (
        <ul className="mt-3 space-y-2">
          {files.map((f, idx) => (
            <li
              key={`${f.name}-${idx}`}
              className="flex items-center gap-3 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm"
            >
              {f.type.startsWith('image/') ? (
                <img
                  src={URL.createObjectURL(f)}
                  alt={f.name}
                  className="w-10 h-10 object-cover rounded border border-slate-200 shrink-0"
                />
              ) : (
                <FileText className="w-8 h-8 text-slate-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate text-slate-800" title={f.name}>{f.name}</div>
                <div className="text-xs text-slate-500">{Math.round(f.size / 1024)} KB · {f.type || 'file'}</div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeAt(idx) }}
                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                aria-label={`Rimuovi ${f.name}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// CreateTicketModal — form apertura nuova segnalazione
// ─────────────────────────────────────────────────────────────────

interface CreateTicketModalProps {
  open: boolean
  onClose: () => void
  onCreated: (t: Ticket) => void
}

function CreateTicketModal({ open, onClose, onCreated }: CreateTicketModalProps) {
  const { toast } = useToast()
  const { profile, session } = useAuth()
  const [tipo, setTipo] = useState<TicketTipo>('bug')
  const [modulo, setModulo] = useState<string>('Altro')
  const [titolo, setTitolo] = useState('')
  const [descrizione, setDescrizione] = useState('')
  const [priorita, setPriorita] = useState<TicketPriorita>('medio')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setTipo('bug'); setModulo('Altro'); setTitolo(''); setDescrizione('')
      setPriorita('medio'); setFiles([]); setSubmitting(false)
    }
  }, [open])

  // Paste-screenshot: quando il modal è aperto, intercetta Cmd+V / Ctrl+V e
  // aggiunge eventuali immagini dalla clipboard alla lista allegati.
  useEffect(() => {
    if (!open) return
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const pasted: File[] = []
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.kind === 'file') {
          const f = it.getAsFile()
          if (f) {
            // Rinomina file con timestamp leggibile
            const ext = f.type.split('/')[1] || 'png'
            const stamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')
            pasted.push(new File([f], `screenshot-${stamp}.${ext}`, { type: f.type }))
          }
        }
      }
      if (pasted.length > 0) {
        e.preventDefault()
        setFiles(prev => [...prev, ...pasted])
      }
    }
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [open])

  if (!open) return null

  const autoreLabel: string =
    (profile?.full_name as string | undefined) ??
    (session?.user?.email as string | undefined) ??
    'Utente'
  const autoreId = session?.user?.id ?? null

  const submit = async () => {
    const titoloTrim = titolo.trim()
    if (titoloTrim.length < 3) {
      toast({ type: 'warning', message: 'Inserisci un titolo (min. 3 caratteri)' })
      return
    }
    setSubmitting(true)
    try {
      const { data: inserted, error: insertErr } = await supabase
        .from('tickets' as never)
        .insert({
          tipo, modulo, titolo: titoloTrim,
          descrizione: descrizione.trim() || null,
          priorita, autore: autoreLabel, autore_id: autoreId,
        } as never)
        .select('*')
        .single()

      if (insertErr || !inserted) {
        throw new Error(errorMessage(insertErr, 'Impossibile salvare la segnalazione'))
      }
      let ticket = inserted as unknown as Ticket

      // Upload allegati (se presenti) — supporta multipli
      if (files.length > 0) {
        const uploaded: TicketAllegato[] = []
        const failures: string[] = []
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          // Path: tickets/<ticket.id>/<idx>_<safe-name>
          const safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)
          const path = `tickets/${ticket.id}/${String(i).padStart(2, '0')}_${safeName}`
          const { error: upErr } = await supabase.storage
            .from('media')
            .upload(path, f, { upsert: true, contentType: f.type })
          if (upErr) {
            failures.push(f.name)
            continue
          }
          const { data: pub } = supabase.storage.from('media').getPublicUrl(path)
          uploaded.push({ url: pub.publicUrl, name: f.name, size: f.size, type: f.type })
        }
        if (uploaded.length > 0) {
          const { data: updated } = await supabase
            .from('tickets' as never)
            .update({ allegati: uploaded } as never)
            .eq('id', ticket.id)
            .select('*')
            .single()
          if (updated) ticket = updated as unknown as Ticket
        }
        if (failures.length > 0) {
          toast({
            type: 'warning',
            message: `Segnalazione creata, ma ${failures.length} allegat${failures.length === 1 ? 'o' : 'i'} non caricat${failures.length === 1 ? 'o' : 'i'}: ${failures.join(', ')}`,
          })
        }
      }

      toast({ type: 'success', message: 'Segnalazione aperta correttamente' })
      onCreated(ticket)
      onClose()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Errore durante la creazione') })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">Nuova segnalazione</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
            aria-label="Chiudi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTipo('bug')}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border flex items-center justify-center gap-2 ${
                    tipo === 'bug'
                      ? 'bg-red-50 border-red-300 text-red-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Bug className="w-4 h-4" /> Bug
                </button>
                <button
                  type="button"
                  onClick={() => setTipo('funzione')}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border flex items-center justify-center gap-2 ${
                    tipo === 'funzione'
                      ? 'bg-blue-50 border-blue-300 text-blue-800'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Sparkles className="w-4 h-4" /> Nuova funzione
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Modulo</label>
              <select
                value={modulo}
                onChange={e => setModulo(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
              >
                {TICKET_MODULI.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Titolo <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={titolo}
              onChange={e => setTitolo(e.target.value)}
              maxLength={200}
              placeholder="Es: il pulsante Salva non si vede in Banche"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Descrizione <span className="text-slate-400 font-normal">(opzionale)</span>
            </label>
            <textarea
              value={descrizione}
              onChange={e => setDescrizione(e.target.value)}
              rows={4}
              placeholder="Spiega cosa è successo o cosa vorresti aggiungere..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Priorità</label>
            <div className="flex gap-2">
              {(['basso','medio','alto'] as TicketPriorita[]).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriorita(p)}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border ${
                    priorita === p
                      ? `${priorityClasses(p)} border-current font-medium`
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {TICKET_PRIORITA_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Allegati <span className="text-slate-400 font-normal">(opzionale)</span>
            </label>
            <DropZone files={files} onChange={setFiles} />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <RefreshCw className="w-4 h-4 animate-spin" />}
            {submitting ? 'Salvataggio…' : 'Apri segnalazione'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// StatCard
// ─────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────
// TicketList — vista principale
// ─────────────────────────────────────────────────────────────────

interface TicketListProps {
  tickets: Ticket[]
  loading: boolean
  onRefresh: () => void
  onOpenDetail: (id: string) => void
  onCreate: () => void
  initialStato?: TicketStato | 'tutti'
  /** Modalita' admin: mostra checkbox per selezione + barra bulk actions. */
  adminMode?: boolean
  /** Render della barra bulk visibile sopra la tabella quando ci sono selezionati.
   *  Riceve gli id selezionati e una funzione per pulire la selezione. */
  renderAdminBulkBar?: (selectedIds: string[], clear: () => void) => React.ReactNode
  /** Render extra in header destra (es. bottone esporta CSV). */
  renderAdminHeaderExtras?: () => React.ReactNode
}

// Esportata per riuso in TicketAdmin (stessa vista, layout uniforme).
export function TicketList({
  tickets, loading, onRefresh, onOpenDetail, onCreate, initialStato,
  adminMode = false, renderAdminBulkBar, renderAdminHeaderExtras,
}: TicketListProps) {
  // Default: 'da_lavorare' = aperti + in_corso (no chiusi/risolti).
  // Sia utente sia admin all'apertura vedono solo i ticket attivi.
  // Filtri 'risolto'/'chiuso' restano disponibili manualmente.
  const [filtroStato, setFiltroStato] = useState<TicketStato | 'tutti' | 'da_lavorare'>(initialStato ?? 'da_lavorare')
  const [filtroTipo, setFiltroTipo] = useState<TicketTipo | 'tutti'>('tutti')
  const [filtroModulo, setFiltroModulo] = useState<string>('tutti')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Reagisce a navigation con state.initialStato (es. da banner "ticket risolti")
  useEffect(() => {
    if (initialStato) setFiltroStato(initialStato)
  }, [initialStato])

  const stats = useMemo(() => {
    const s = { aperti: 0, in_corso: 0, risolti: 0, chiusi: 0, bug: 0, funzioni: 0, totali: tickets.length }
    for (const t of tickets) {
      if (t.stato === 'aperto') s.aperti++
      else if (t.stato === 'in_corso') s.in_corso++
      else if (t.stato === 'risolto') s.risolti++
      else if (t.stato === 'chiuso') s.chiusi++
      if (t.tipo === 'bug') s.bug++
      else s.funzioni++
    }
    return s
  }, [tickets])

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      // 'da_lavorare' = aperti + in_corso (default vista, no chiusi/risolti)
      if (filtroStato === 'da_lavorare') {
        if (t.stato !== 'aperto' && t.stato !== 'in_corso') return false
      } else if (filtroStato !== 'tutti' && t.stato !== filtroStato) return false
      if (filtroTipo !== 'tutti' && t.tipo !== filtroTipo) return false
      if (filtroModulo !== 'tutti' && t.modulo !== filtroModulo) return false
      return true
    })
  }, [tickets, filtroStato, filtroTipo, filtroModulo])

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
      if (prev.size === filtered.length && filtered.length > 0) return new Set()
      return new Set(filtered.map(t => t.id))
    })
  }
  const clearSelection = () => setSelectedIds(new Set())

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Ticket &amp; Segnalazioni</h1>
          <p className="text-sm text-slate-500 mt-1">
            Bug, richieste di funzioni e segnalazioni. I ticket &quot;facili&quot; possono essere risolti automaticamente dall&apos;AutoFix.
          </p>
          <AutoFixCountdown />
        </div>
        <div className="flex items-center gap-2">
          {renderAdminHeaderExtras?.()}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg flex items-center gap-2 disabled:opacity-50"
            aria-label="Aggiorna"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Apri ticket
          </button>
        </div>
      </div>

      {/* Stat cards (7 colonne: stati + tipi + totali) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Aperti"      value={stats.aperti}   icon={<AlertCircle className="w-5 h-5 text-blue-700" />}    accent="bg-blue-100" />
        <StatCard label="In corso"    value={stats.in_corso} icon={<Clock className="w-5 h-5 text-amber-700" />}        accent="bg-amber-100" />
        <StatCard label="Risolti"     value={stats.risolti}  icon={<Check className="w-5 h-5 text-emerald-700" />}      accent="bg-emerald-100" />
        <StatCard label="Chiusi"      value={stats.chiusi}   icon={<X className="w-5 h-5 text-slate-500" />}            accent="bg-slate-100" />
        <StatCard label="Bug"         value={stats.bug}      icon={<Bug className="w-5 h-5 text-red-700" />}            accent="bg-red-100" />
        <StatCard label="Funzioni"    value={stats.funzioni} icon={<Sparkles className="w-5 h-5 text-violet-700" />}    accent="bg-violet-100" />
        <StatCard label="Totali"      value={stats.totali}   icon={<MessageSquare className="w-5 h-5 text-slate-700" />} accent="bg-slate-100" />
      </div>

      {/* Filtri a pillole */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-slate-500 text-sm mr-2">
          <Filter className="w-4 h-4" /> Filtri:
        </div>
        {/* Pillole stato */}
        <div className="flex flex-wrap items-center gap-1">
          <PillButton active={filtroStato === 'da_lavorare'} onClick={() => setFiltroStato('da_lavorare')}>Da lavorare</PillButton>
          <PillButton active={filtroStato === 'aperto'}    onClick={() => setFiltroStato('aperto')}>In attesa</PillButton>
          <PillButton active={filtroStato === 'in_corso'}  onClick={() => setFiltroStato('in_corso')}>In corso</PillButton>
          <PillButton active={filtroStato === 'risolto'}   onClick={() => setFiltroStato('risolto')}>Risolto</PillButton>
          <PillButton active={filtroStato === 'chiuso'}    onClick={() => setFiltroStato('chiuso')}>Chiuso</PillButton>
          <PillButton active={filtroStato === 'tutti'}     onClick={() => setFiltroStato('tutti')}>Tutti</PillButton>
        </div>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        {/* Pillole tipo */}
        <div className="flex flex-wrap items-center gap-1">
          <PillButton active={filtroTipo === 'tutti'}    onClick={() => setFiltroTipo('tutti')}>Tutti</PillButton>
          <PillButton active={filtroTipo === 'bug'}      onClick={() => setFiltroTipo('bug')}>Bug</PillButton>
          <PillButton active={filtroTipo === 'funzione'} onClick={() => setFiltroTipo('funzione')}>Funzioni</PillButton>
        </div>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        {/* Modulo come select (lungo) */}
        <select
          value={filtroModulo}
          onChange={(e) => setFiltroModulo(e.target.value)}
          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-200"
          aria-label="Modulo"
        >
          <option value="tutti">Tutti i moduli</option>
          {TICKET_MODULI.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="ml-auto text-xs text-slate-500">
          {filtered.length} su {tickets.length}
        </div>
      </div>

      {/* Bulk action bar (solo admin con selezione attiva) */}
      {adminMode && selectedIds.size > 0 && renderAdminBulkBar?.(Array.from(selectedIds), clearSelection)}

      {/* Tabella */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading && tickets.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
            Caricamento segnalazioni…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-sm">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            Nessun ticket corrisponde ai filtri.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  {adminMode && (
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
                  )}
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">Titolo</th>
                  <th className="px-3 py-2 text-left">Priorità</th>
                  <th className="px-3 py-2 text-left">Modulo</th>
                  <th className="px-3 py-2 text-left">Autore</th>
                  <th className="px-3 py-2 text-left">Creato</th>
                  <th className="px-3 py-2 text-left">Fase</th>
                  <th className="px-3 py-2 text-left">Risolto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(t => {
                  const isSel = selectedIds.has(t.id)
                  return (
                    <tr
                      key={t.id}
                      onClick={(e) => {
                        // In admin mode, click sulla checkbox non apre il dettaglio
                        if (adminMode && (e.target as HTMLElement).closest('[data-select-cell]')) return
                        onOpenDetail(t.id)
                      }}
                      className={`hover:bg-slate-50 cursor-pointer ${isSel ? 'bg-blue-50/40' : ''}`}
                    >
                      {adminMode && (
                        <td className="px-3 py-2.5" data-select-cell>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleSelect(t.id) }}
                            aria-label={`Seleziona ${t.titolo}`}
                            className="p-0.5"
                          >
                            {isSel
                              ? <CheckSquare className="w-4 h-4 text-blue-600" />
                              : <Square className="w-4 h-4 text-slate-400 hover:text-slate-700" />}
                          </button>
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        {t.tipo === 'bug'
                          ? <Bug className="w-4 h-4 text-red-500" />
                          : <Sparkles className="w-4 h-4 text-violet-500" />}
                      </td>
                      <td className="px-3 py-2.5 text-slate-900 font-medium max-w-md truncate" title={t.titolo}>
                        {t.titolo}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 text-xs rounded-full border ${priorityClasses(t.priorita)}`}>
                          {TICKET_PRIORITA_LABEL[t.priorita]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{t.modulo}</td>
                      <td className="px-3 py-2.5 text-slate-700">{t.autore}</td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs">{formatDate(t.creato_il)}</td>
                      <td className="px-3 py-2.5"><PhaseStepper stato={t.stato} /></td>
                      <td className="px-3 py-2.5 text-slate-600 text-xs">
                        {t.risolto_il ? formatDate(t.risolto_il) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// AutoFixCountdown — countdown al prossimo run AutoFix scheduled.
// Cron NZ: ogni ora al :07 (vedi memoria ticket_autofix_system).
// Mostrato in header per dare attesa visiva all'utente.
function AutoFixCountdown() {
  const [now, setNow] = useState<Date>(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Prossimo run = prossima ora alle :07 (UTC del cron, ma mostriamo in locale)
  const next = useMemo(() => {
    const n = new Date(now)
    n.setSeconds(0, 0)
    n.setMinutes(7)
    if (n.getTime() <= now.getTime()) {
      n.setHours(n.getHours() + 1)
    }
    return n
  }, [now])

  const diffMs = next.getTime() - now.getTime()
  const diffMin = Math.max(0, Math.floor(diffMs / 60000))
  const diffSec = Math.max(0, Math.floor((diffMs % 60000) / 1000))
  const timeStr = next.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
      <Clock className="w-3 h-3" />
      <span>
        Prossimo AutoFix automatico alle <strong className="font-semibold">{timeStr}</strong>
        {' '}(tra {diffMin}m {String(diffSec).padStart(2, '0')}s).
        Admin: usa "Risolvi con AI" per non aspettare.
      </span>
    </div>
  )
}

// PillButton — bottone "pillola" usato per filtri stato/tipo (vedi screenshot)
function PillButton({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
        active
          ? 'bg-slate-900 text-white'
          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────
// FilterChip — dropdown filtro compatto
// ─────────────────────────────────────────────────────────────────

interface FilterChipProps {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}

function FilterChip({ label, options, value, onChange }: FilterChipProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
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

// ─────────────────────────────────────────────────────────────────
// TicketDetail — vista singolo ticket
// ─────────────────────────────────────────────────────────────────

interface TicketDetailProps {
  ticket: Ticket
  onBack: () => void
  onUpdated: (t: Ticket) => void
}

function TicketDetail({ ticket, onBack, onUpdated }: TicketDetailProps) {
  const { toast } = useToast()
  const { profile, session } = useAuth()
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const [nuovoCommento, setNuovoCommento] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | {
    title: string; message: string; confirmLabel?: string;
    destructive?: boolean; onConfirm: () => void;
  }>(null)

  // Mark seen: aggiorna last_seen_by_author_at sul DB. Serve per il badge
  // sidebar 'Segnalazioni' che mostra il numero di ticket dell'autore con
  // aggiornamenti dopo l'ultima visita. RPC mark_ticket_seen e' SECURITY
  // INVOKER e fa l'UPDATE solo se ticket.autore_id = auth.uid() -> non
  // tocca nulla se ad aprire e' Patrizio su un ticket di Sabrina.
  useEffect(() => {
    if (!ticket?.id) return
    supabase.rpc('mark_ticket_seen' as never, { p_ticket_id: ticket.id } as never).then(({ error }) => {
      if (error) console.warn('[mark_ticket_seen]', error.message)
      // Notifica la sidebar che il count badge va ricalcolato
      window.dispatchEvent(new CustomEvent('ticket-seen'))
    })
  }, [ticket?.id])

  // Unifico vecchio screenshot_url (deprecato) e nuovo array allegati.
  // I ticket pre-2026-05-26 hanno solo screenshot_url; quelli nuovi hanno
  // allegati[] (gia' inclusivo del backfill della migration 047).
  const allegatiVisualizzati: TicketAllegato[] = useMemo(() => {
    if (Array.isArray(ticket.allegati) && ticket.allegati.length > 0) {
      return ticket.allegati
    }
    if (ticket.screenshot_url) {
      return [{ url: ticket.screenshot_url, name: 'Screenshot', size: 0, type: 'image/webp' }]
    }
    return []
  }, [ticket.allegati, ticket.screenshot_url])

  const autoreLabel: string =
    (profile?.full_name as string | undefined) ??
    (session?.user?.email as string | undefined) ??
    'Utente'

  const aggiornaStato = useCallback(async (nuovoStato: TicketStato) => {
    setBusy(true)
    try {
      const patch: Record<string, unknown> = { stato: nuovoStato }
      if (nuovoStato === 'risolto') patch.risolto_il = new Date().toISOString()
      if (nuovoStato === 'aperto' || nuovoStato === 'in_corso') patch.risolto_il = null

      const { data, error } = await supabase
        .from('tickets' as never)
        .update(patch as never)
        .eq('id', ticket.id)
        .select('*')
        .single()
      if (error || !data) throw new Error(errorMessage(error, 'Aggiornamento fallito'))

      onUpdated(data as unknown as Ticket)
      toast({ type: 'success', message: `Segnalazione aggiornata: ${TICKET_STATO_LABEL[nuovoStato]}` })
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }, [onUpdated, ticket.id, toast])

  const aggiungiCommento = useCallback(async () => {
    const testo = nuovoCommento.trim()
    if (testo.length === 0) return
    setBusy(true)
    try {
      const commento: TicketCommento = {
        id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        autore: autoreLabel,
        origine: 'utente',
        testo,
        creato_il: new Date().toISOString(),
      }
      const nuoviCommenti = [...(ticket.commenti ?? []), commento]
      const { data, error } = await supabase
        .from('tickets' as never)
        .update({ commenti: nuoviCommenti } as never)
        .eq('id', ticket.id)
        .select('*')
        .single()
      if (error || !data) throw new Error(errorMessage(error, 'Salvataggio commento fallito'))

      onUpdated(data as unknown as Ticket)
      setNuovoCommento('')
      toast({ type: 'success', message: 'Commento aggiunto' })
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }, [autoreLabel, nuovoCommento, onUpdated, ticket.commenti, ticket.id, toast])

  // Calcola se ultimo commento AI e' < 60s fa: in tal caso bottone disabled
  // (protezione click duplicati come fa anche l'edge function lato server)
  const lastAiCommentAgeSec = useMemo(() => {
    const last = (ticket.commenti ?? [])
      .filter((c) => c.origine === 'ai' && c.creato_il)
      .sort((a, b) => (b.creato_il || '').localeCompare(a.creato_il || ''))[0]
    if (!last) return Infinity
    return (Date.now() - new Date(last.creato_il).getTime()) / 1000
  }, [ticket.commenti])
  const aiOnCooldown = lastAiCommentAgeSec < 60

  // Admin-only: invoca Edge Function ticket-resolve-now per fix on-demand
  const risolviConAI = useCallback(async () => {
    if (aiOnCooldown) {
      toast({ type: 'warning', message: `AutoFix gia' invocato ${Math.round(lastAiCommentAgeSec)}s fa. Attendi 60s prima di riprovare.` })
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('ticket-resolve-now', {
        body: { ticketId: ticket.id },
      })
      if (error) {
        // Edge function ritorna 429 con messaggio leggibile per rate-limit
        const msg = (error as { message?: string }).message ?? 'Errore Risolvi con AI'
        if (msg.includes('429') || msg.toLowerCase().includes('attendi')) {
          toast({ type: 'warning', message: 'AutoFix gia\' in elaborazione o appena completato. Attendi 60s e riprova.' })
        } else {
          toast({ type: 'error', message: msg })
        }
        return
      }
      if (data?.action === 'fix') {
        toast({
          type: 'success',
          message: `Fix proposto in PR ${data.pr_url ? `#${data.pr_number}` : ''}. ${data.message ?? ''}`.slice(0, 200),
        })
      } else if (data?.action === 'cant_fix') {
        toast({ type: 'warning', message: data.message ?? 'AI non puo risolvere automaticamente.' })
      } else {
        toast({ type: 'warning', message: 'Risposta AI inattesa.' })
      }
      // Ricarica ticket aggiornato (commenti AI + stato)
      const { data: refreshed } = await supabase
        .from('tickets' as never)
        .select('*')
        .eq('id', ticket.id)
        .single()
      if (refreshed) onUpdated(refreshed as unknown as Ticket)
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Errore Risolvi con AI') })
    } finally {
      setBusy(false)
    }
  }, [ticket.id, onUpdated, toast, aiOnCooldown, lastAiCommentAgeSec])

  // Admin-only: cancella ticket (solo per ticket di prova o aperti per errore)
  const cancellaTicket = useCallback(async () => {
    setBusy(true)
    try {
      const { error } = await supabase
        .from('tickets' as never)
        .delete()
        .eq('id', ticket.id)
      if (error) throw new Error(error.message)
      toast({ type: 'success', message: 'Ticket cancellato' })
      onBack()
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Cancellazione fallita') })
      setBusy(false)
    }
  }, [ticket.id, onBack, toast])

  const azioniDisponibili = useMemo(() => {
    const actions: Array<{ label: string; stato: TicketStato; primary?: boolean; destructive?: boolean }> = []
    if (ticket.stato === 'aperto') {
      actions.push({ label: 'Prendi in carico', stato: 'in_corso', primary: true })
      actions.push({ label: 'Risolvi', stato: 'risolto' })
      actions.push({ label: 'Chiudi', stato: 'chiuso', destructive: true })
    } else if (ticket.stato === 'in_corso') {
      actions.push({ label: 'Risolvi', stato: 'risolto', primary: true })
      actions.push({ label: 'Riapri', stato: 'aperto' })
      actions.push({ label: 'Chiudi', stato: 'chiuso', destructive: true })
    } else if (ticket.stato === 'risolto') {
      actions.push({ label: 'Chiudi', stato: 'chiuso', primary: true })
      actions.push({ label: 'Riapri', stato: 'aperto' })
    } else if (ticket.stato === 'chiuso') {
      actions.push({ label: 'Riapri', stato: 'aperto', primary: true })
    }
    return actions
  }, [ticket.stato])

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="w-4 h-4" /> Torna alla lista
      </button>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span>#{shortId(ticket.id)}</span>
              <span>·</span>
              <span>{ticket.tipo === 'bug' ? 'Bug' : 'Nuova funzionalità'}</span>
              <span>·</span>
              <span>{ticket.modulo}</span>
            </div>
            <h2 className="text-xl font-semibold text-slate-900">{ticket.titolo}</h2>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 text-xs rounded-full border ${priorityClasses(ticket.priorita)}`}>
                Priorità {TICKET_PRIORITA_LABEL[ticket.priorita]}
              </span>
              <span className={`px-2 py-0.5 text-xs rounded-full border ${statoClasses(ticket.stato)}`}>
                {TICKET_STATO_LABEL[ticket.stato]}
              </span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>Aperto da <span className="font-medium text-slate-700">{ticket.autore}</span></div>
            <div>{formatDate(ticket.creato_il)}</div>
            {ticket.risolto_il && (
              <div className="mt-1 text-emerald-600">Risolto il {formatDate(ticket.risolto_il)}</div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <PhaseStepper stato={ticket.stato} />
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {azioniDisponibili.map(a => (
            <button
              key={a.label}
              type="button"
              disabled={busy}
              onClick={() => {
                if (a.destructive) {
                  setConfirm({
                    title: 'Chiudere la segnalazione?',
                    message: 'Le segnalazioni chiuse non vengono più processate da AutoFix. Puoi sempre riaprirla in seguito.',
                    confirmLabel: 'Chiudi',
                    destructive: true,
                    onConfirm: () => { setConfirm(null); aggiornaStato(a.stato) },
                  })
                } else {
                  aggiornaStato(a.stato)
                }
              }}
              className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                a.primary
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : a.destructive
                    ? 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {a.label}
            </button>
          ))}

          {/* Azioni admin-only (super_advisor): Risolvi con AI on-demand + Cancella */}
          {profile?.role === 'super_advisor' && (ticket.stato === 'aperto' || ticket.stato === 'in_corso') && (
            <button
              type="button"
              disabled={busy || aiOnCooldown}
              onClick={() => risolviConAI()}
              title={aiOnCooldown
                ? `AutoFix invocato ${Math.round(lastAiCommentAgeSec)}s fa. Attendi 60s.`
                : "Invoca AI che analizza il ticket, applica fix al codice del modulo e apre PR su GitHub."}
              className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {aiOnCooldown ? `Attendi ${Math.max(1, 60 - Math.round(lastAiCommentAgeSec))}s` : 'Risolvi con AI'}
            </button>
          )}

          {profile?.role === 'super_advisor' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm({
                title: 'Cancellare definitivamente questo ticket?',
                message: 'L’operazione cancella il ticket dal database. Non e’ reversibile. Usalo solo per ticket di prova o errori di apertura.',
                confirmLabel: 'Cancella',
                destructive: true,
                onConfirm: () => { setConfirm(null); cancellaTicket() },
              })}
              title="Cancella ticket (solo super_advisor). Per ticket di prova o aperti per errore."
              className="ml-auto px-3 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" /> Cancella
            </button>
          )}
        </div>
      </div>

      {/* Descrizione + allegati (gallery) */}
      {(ticket.descrizione || allegatiVisualizzati.length > 0) && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          {ticket.descrizione && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">Descrizione</h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{ticket.descrizione}</p>
            </div>
          )}
          {allegatiVisualizzati.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                <Paperclip className="w-4 h-4" /> Allegati
                <span className="text-xs text-slate-500 font-normal">({allegatiVisualizzati.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {allegatiVisualizzati.map((att, idx) => {
                  const isImage = att.type.startsWith('image/')
                  if (isImage) {
                    return (
                      <button
                        key={`${att.url}-${idx}`}
                        type="button"
                        onClick={() => setLightboxUrl(att.url)}
                        className="block group relative aspect-video bg-slate-100 rounded-lg overflow-hidden border border-slate-200"
                        title={att.name}
                      >
                        <img
                          src={att.url}
                          alt={att.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors">
                          <Eye className="w-5 h-5 text-white opacity-0 group-hover:opacity-100" />
                        </div>
                      </button>
                    )
                  }
                  return (
                    <a
                      key={`${att.url}-${idx}`}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 text-sm text-slate-700"
                      title={att.name}
                    >
                      <FileText className="w-5 h-5 text-slate-400 shrink-0" />
                      <span className="truncate">{att.name}</span>
                    </a>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Note fix tecniche */}
      {ticket.note_fix && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-amber-900 mb-1">Note tecniche AutoFix</h3>
          <pre className="text-xs text-amber-900 whitespace-pre-wrap font-mono">{ticket.note_fix}</pre>
        </div>
      )}

      {/* Commenti */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4" /> Commenti
          {ticket.commenti.length > 0 && (
            <span className="text-xs text-slate-500 font-normal">({ticket.commenti.length})</span>
          )}
        </h3>

        {ticket.commenti.length === 0 ? (
          <p className="text-sm text-slate-500">Nessun commento ancora.</p>
        ) : (
          <ul className="space-y-3">
            {ticket.commenti.map(c => (
              <li
                key={c.id}
                className={`p-3 rounded-lg border ${
                  c.origine === 'ai'
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-blue-50 border-blue-200'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className={`font-medium ${c.origine === 'ai' ? 'text-emerald-800' : 'text-blue-800'}`}>
                    {c.origine === 'ai' ? '🤖 ' : ''}{c.autore}
                  </span>
                  <span className="text-slate-500">{formatDate(c.creato_il)}</span>
                </div>
                <p className="text-sm text-slate-800 whitespace-pre-wrap">{c.testo}</p>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex gap-2">
          <textarea
            value={nuovoCommento}
            onChange={e => setNuovoCommento(e.target.value)}
            rows={2}
            placeholder="Scrivi un commento…"
            className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
          />
          <button
            type="button"
            onClick={aggiungiCommento}
            disabled={busy || nuovoCommento.trim().length === 0}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 self-end flex items-center gap-1"
          >
            <Send className="w-4 h-4" /> Invia
          </button>
        </div>
      </div>

      {lightboxUrl && (
        <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel}
        destructive={confirm?.destructive}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm?.onConfirm()}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// TicketPage — root component (default export)
// ─────────────────────────────────────────────────────────────────

export default function TicketPage() {
  const { ticketId } = useParams<{ ticketId?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const initialStato = (location.state as { initialStato?: TicketStato } | null)?.initialStato

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('tickets' as never)
        .select('*')
        .order('creato_il', { ascending: false })
      if (error) throw error
      setTickets((data ?? []) as unknown as Ticket[])
    } catch (e) {
      toast({ type: 'error', message: errorMessage(e, 'Errore nel caricamento segnalazioni') })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const onCreated = useCallback((t: Ticket) => {
    setTickets(prev => [t, ...prev])
  }, [])

  const onUpdated = useCallback((t: Ticket) => {
    setTickets(prev => prev.map(x => x.id === t.id ? t : x))
  }, [])

  const detailTicket = ticketId ? tickets.find(t => t.id === ticketId) : null

  if (ticketId) {
    if (loading && !detailTicket) {
      return (
        <PageShell>
          <div className="py-16 text-center text-slate-500 text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
            Caricamento…
          </div>
        </PageShell>
      )
    }
    if (!detailTicket) {
      return (
        <PageShell>
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <h2 className="text-lg font-semibold text-slate-900">Segnalazione non trovata</h2>
            <p className="text-sm text-slate-500 mt-1">
              La segnalazione richiesta non esiste o è stata cancellata.
            </p>
            <button
              type="button"
              onClick={() => navigate('/ticket')}
              className="mt-4 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              Torna alla lista
            </button>
          </div>
        </PageShell>
      )
    }
    return (
      <PageShell>
        <TicketDetail
          ticket={detailTicket}
          onBack={() => navigate('/ticket')}
          onUpdated={onUpdated}
        />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <TicketList
        tickets={tickets}
        loading={loading}
        onRefresh={load}
        onOpenDetail={(id) => navigate(`/ticket/${id}`)}
        onCreate={() => setCreateOpen(true)}
        initialStato={initialStato}
      />
      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={onCreated}
      />
    </PageShell>
  )
}

// Container coerente con tutte le altre pagine (pattern: vedi Fatturazione,
// Banche, Cashflow, ecc). max-w-[1600px] + padding responsive, niente
// scroll interno: il main del Layout gestisce lo scroll.
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-[1600px] mx-auto">
      {children}
    </div>
  )
}
