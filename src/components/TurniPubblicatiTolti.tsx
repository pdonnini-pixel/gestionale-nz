// Turni pubblicati tolti nella settimana (Patrizio, 17/11/2026: «solo per i turni che sono stati
// pubblicati, non le prove»). Il registro lo scrive il database (migration 424) ogni volta che un turno
// pubblicato viene annullato, torna in bozza o viene cancellato: qui si legge e basta.
// Dove la tabella manca (migration non applicata) il riquadro non si vede.

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { History } from 'lucide-react';
import { supabase } from '../lib/supabase';

// tabella nuova, non ancora nei tipi generati del database
const db = supabase as unknown as SupabaseClient;

interface RigaTolta {
  id: number;
  employee_id: string | null;
  data: string;
  inizio: string | null;
  fine: string | null;
  azione: 'annullato' | 'ritirato' | 'cancellato';
  motivo: string | null;
  utente_nome: string | null;
  creato_il: string;
}

const AZIONE: Record<RigaTolta['azione'], string> = {
  annullato: 'annullato',
  ritirato: 'tolto dalla pubblicazione (tornato in bozza)',
  cancellato: 'cancellato',
};

const giorno = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' });
const quando = (t: string) => new Date(t).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function TurniPubblicatiTolti({ companyId, outletId, dal, al, nomeDi, aggiorna }: {
  companyId: string; outletId: string; dal: string; al: string;
  nomeDi: (id: string) => string;
  /** cambia quando cambiano i turni a video: il registro si rilegge */
  aggiorna: unknown;
}) {
  const [righe, setRighe] = useState<RigaTolta[] | null>(null);

  useEffect(() => {
    let vivo = true;
    db.from('turni_pubblicati_tolti')
      .select('id, employee_id, data, inizio, fine, azione, motivo, utente_nome, creato_il')
      .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', dal).lte('data', al)
      .order('creato_il', { ascending: false }).limit(200)
      .then(({ data, error }) => { if (vivo) setRighe(error ? null : ((data as RigaTolta[]) ?? [])); });
    return () => { vivo = false; };
  }, [companyId, outletId, dal, al, aggiorna]);

  if (!righe || righe.length === 0) return null;

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
      <summary className="cursor-pointer font-semibold text-slate-800 inline-flex items-center gap-2">
        <History size={15} /> Turni pubblicati tolti in questa settimana ({righe.length})
      </summary>
      <p className="mt-1 text-xs text-slate-500">Turni che le persone avevano già ricevuto e che poi sono stati annullati, tolti dalla pubblicazione o cancellati: chi e quando. Il registro non si modifica. Le bozze non compaiono.</p>
      <ul className="mt-2 divide-y divide-slate-100">
        {righe.map((r) => (
          <li key={r.id} className="py-1.5">
            <span className="font-medium text-slate-900">{r.employee_id ? nomeDi(r.employee_id) : 'Persona non indicata'}</span>
            {' · '}{giorno(r.data)}{r.inizio && r.fine ? ` ${r.inizio.slice(0, 5)}-${r.fine.slice(0, 5)}` : ''}
            {' · '}{AZIONE[r.azione]}
            {r.motivo ? ` («${r.motivo}»)` : ''}
            <span className="block text-xs text-slate-500">{quando(r.creato_il)} · {r.utente_nome || 'sistema'}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
