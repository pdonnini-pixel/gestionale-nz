// Riquadro «Sposta il turno», aperto lasciando un turno su un'altra casella
// (Patrizio, 29/10/2026). Comune al piano del mese e al piano settimanale.

import { useState } from 'react';
import { Modal } from './ui/Modal';
import { ETICHETTE_MOSSA, giornoEsteso, mossePossibili, type MossaTurno, type TurnoRiga } from '../lib/spostaTurni';

export default function SpostaTurnoModal({ turno, versoId, versoData, arrivo, nomeDi, avvisi, esegui, onClose }: {
  turno: TurnoRiga; versoId: string; versoData: string; arrivo: TurnoRiga | null;
  nomeDi: (id: string) => string;
  avvisi: (m: MossaTurno) => string[];
  esegui: (m: MossaTurno) => Promise<boolean>;
  onClose: () => void;
}) {
  const [lavoro, setLavoro] = useState(false);
  const scelte = mossePossibili(!!arrivo, turno.employee_id === versoId);
  return (
    <Modal open onClose={onClose} title="Sposta il turno">
      <div className="space-y-3 text-sm">
        <p className="text-slate-700">
          Turno di <b>{nomeDi(turno.employee_id)}</b>, {giornoEsteso(turno.data)}, {turno.inizio}–{turno.fine}
          {' '}→ <b>{nomeDi(versoId)}</b>, {giornoEsteso(versoData)}
          {arrivo ? <>, che ha già il turno {arrivo.inizio}–{arrivo.fine}</> : null}.
        </p>
        {scelte.map((m) => {
          const lista = avvisi(m);
          return (
            <div key={m} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">{ETICHETTE_MOSSA[m].titolo}</p>
                  <p className="text-xs text-slate-500">{ETICHETTE_MOSSA[m].spiega}</p>
                </div>
                <button type="button" disabled={lavoro}
                  onClick={async () => { setLavoro(true); const ok = await esegui(m); setLavoro(false); if (ok) onClose(); }}
                  className="min-h-[36px] px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{ETICHETTE_MOSSA[m].titolo}</button>
              </div>
              {lista.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-amber-800">{lista.map((a) => <li key={a}>• {a}</li>)}</ul>}
            </div>
          );
        })}
        <p className="text-xs text-slate-500">I turni toccati diventano «messi a mano»: il ricalcolo non li cambia. Gli avvisi non bloccano: decidi tu.</p>
        <div className="flex justify-end"><button type="button" onClick={onClose} className="min-h-[38px] px-4 rounded-lg border border-slate-300 text-sm">Annulla</button></div>
      </div>
    </Modal>
  );
}
