// Modal accessibile condiviso (audit A25: nessuna modale dell'app aveva
// role="dialog", aria-modal, gestione Escape o focus trap).
//
// Fornisce:
//  - role="dialog" + aria-modal + aria-labelledby (titolo) per gli screen reader
//  - chiusura con Escape
//  - focus trap (Tab/Shift+Tab restano dentro la modale)
//  - focus spostato dentro all'apertura e RESTITUITO all'elemento che l'ha aperta
//  - click sul backdrop per chiudere (opzionale) + bottone X con aria-label
//
// Migrazione progressiva: le pagine con overlay `fixed inset-0` fatti a mano
// possono adottare <Modal> partendo dalle conferme di azioni distruttive.

import { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  /** Larghezza max (classe Tailwind), default max-w-lg. */
  maxWidthClass?: string
  /** Se false, il click sul backdrop non chiude (per form con dati non salvati). */
  closeOnBackdrop?: boolean
  /** Nasconde la X in alto a destra (raro). */
  hideCloseButton?: boolean
  /**
   * Modalità "wrap": NON applica header/padding/stile di default. Utile per
   * migrare una modale esistente conservandone l'aspetto: passa le classi del
   * pannello in `panelClassName` e il markup interno originale come children.
   * Aggiunge comunque tutti i comportamenti di accessibilità (Escape, focus trap,
   * role=dialog). In questo caso passa `ariaLabel` per l'etichetta del dialog.
   */
  bare?: boolean
  /** Classi Tailwind del pannello in modalità bare (es. l'ex `<div className>`). */
  panelClassName?: string
  /** Etichetta accessibile del dialog quando non c'è un `title` (modalità bare). */
  ariaLabel?: string
  /** Classe z-index (default z-[120]). Alza per impilare sopra un altro overlay. */
  zClass?: string
  /**
   * (bare) Override completo delle classi del contenitore/backdrop. Default:
   * `fixed inset-0 <zClass> flex items-center justify-center p-4 bg-black/40`.
   * Utile per slide-over/pannelli non centrati che vogliono conservare il layout.
   */
  containerClassName?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidthClass = 'max-w-lg',
  closeOnBackdrop = true,
  hideCloseButton = false,
  bare = false,
  panelClassName,
  ariaLabel,
  zClass = 'z-[120]',
  containerClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2)}`)

  // Escape + focus trap
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Tab' && panelRef.current) {
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(el => el.offsetParent !== null)
      if (nodes.length === 0) { e.preventDefault(); return }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus()
      }
    }
  }, [onClose])

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKeyDown, true)
    // Sposta il focus dentro la modale (primo elemento focusabile o il pannello)
    const t = setTimeout(() => {
      const node = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
      ;(node || panelRef.current)?.focus()
    }, 0)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      clearTimeout(t)
      // Restituisce il focus all'elemento che aveva aperto la modale
      previouslyFocused.current?.focus?.()
    }
  }, [open, onKeyDown])

  if (!open) return null

  // Modalità "wrap": solo comportamenti a11y, aspetto invariato (panelClassName).
  if (bare) {
    return (
      <div
        className={containerClassName ?? `fixed inset-0 ${zClass} flex items-center justify-center p-4 bg-black/40`}
        onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          tabIndex={-1}
          className={`outline-none ${panelClassName ?? ''}`}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center p-4 bg-black/40`}
      onMouseDown={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId.current : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
        className={`bg-white rounded-xl shadow-xl w-full ${maxWidthClass} max-h-[90dvh] overflow-auto outline-none`}
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-slate-200">
            {title ? <h2 id={titleId.current} className="text-base font-semibold text-slate-900">{title}</h2> : <span />}
            {!hideCloseButton && (
              <button onClick={onClose} aria-label="Chiudi" className="p-1 -mr-1 text-slate-400 hover:text-slate-700 rounded transition">
                <X size={20} />
              </button>
            )}
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Stile bottone di conferma: 'danger' (rosso) per azioni distruttive. */
  variant?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

/** Modale di conferma accessibile (azioni distruttive: elimina, annulla, ecc.). */
export function ConfirmModal({
  open, title, message, confirmLabel = 'Conferma', cancelLabel = 'Annulla',
  variant = 'danger', busy = false, onConfirm, onClose,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-md" closeOnBackdrop={!busy}>
      <div className="text-sm text-slate-600">{message}</div>
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
        >
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className={`px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 ${
            variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {busy ? '…' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
