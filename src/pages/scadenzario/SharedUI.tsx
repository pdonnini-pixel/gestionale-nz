// Componenti UI condivisi dello Scadenzario (estratti da ScadenzarioSmart.tsx,
// spezzatura ondata 9, nessun cambio funzionale).
import { useEffect } from 'react';
import { X } from 'lucide-react';
import StatusBadge from '../../components/ui/StatusBadge';
import { Modal as UIModal } from '../../components/ui/Modal';

// Status pill component — delegates to shared StatusBadge
export function StatusPill({ status }: { status: string | null | undefined }) {
  return <StatusBadge status={status || ''} size="sm" />
}

// Modal component
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  // Escape chiude il modale (prima solo overlay/X). Hook prima dell'early
  // return per rispettare le regole dei hook.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <UIModal
      open={open}
      onClose={onClose}
      bare
      closeOnBackdrop={false}
      ariaLabel={title}
      containerClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      panelClassName={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} mx-4 max-h-[90dvh] overflow-y-auto overscroll-contain`}
    >
      <div className="flex items-center justify-between p-5 border-b border-slate-100">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <button onClick={onClose} title="Chiudi" className="p-1 rounded-lg hover:bg-slate-100 text-slate-400"><X size={20} /></button>
      </div>
      <div className="p-5">{children}</div>
    </UIModal>
  )
}
