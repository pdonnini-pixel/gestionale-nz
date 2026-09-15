// Popup "Dettaglio Fornitore" dello Scadenzario. Estratto da
// ScadenzarioSmart.tsx (spezzatura ondata 9) senza cambi funzionali.
import { Modal } from './SharedUI';

export type SupplierDetailData = {
  ragione_sociale?: string | null
  name?: string | null
  partita_iva?: string | null
  codice_fiscale?: string | null
  iban?: string | null
  email?: string | null
  telefono?: string | null
  [k: string]: unknown
}

export function SupplierDetailModal({ supplier, onClose }: { supplier: SupplierDetailData | null; onClose: () => void }) {
  if (!supplier) return null;
  return (
    <Modal open={true} onClose={onClose} title="Dettaglio Fornitore">
      <div className="space-y-3">
        <div>
          <div className="text-xs text-slate-500 uppercase">Ragione Sociale</div>
          <div className="text-base font-semibold text-slate-900">{supplier.ragione_sociale || supplier.name || '—'}</div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-500 uppercase">P.IVA</div>
            <div className="text-sm text-slate-800 mt-0.5">{supplier.partita_iva || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">CF</div>
            <div className="text-sm text-slate-800 mt-0.5">{supplier.codice_fiscale || '—'}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase">IBAN</div>
          <div className="text-sm text-slate-800 mt-0.5">{supplier.iban || '—'}</div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-slate-500 uppercase">Email</div>
            <div className="text-sm text-slate-800 mt-0.5">{supplier.email || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 uppercase">Telefono</div>
            <div className="text-sm text-slate-800 mt-0.5">{supplier.telefono || '—'}</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
