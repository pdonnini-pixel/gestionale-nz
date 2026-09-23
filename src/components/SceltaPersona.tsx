// Scelta di un dipendente, con ricerca.
//
// Un elenco di sessanta nomi in ordine di database non si legge: qui si
// digita un pezzo di cognome (o la matricola) e restano le righe che
// corrispondono, in ordine alfabetico. Nato per gli abbinamenti del
// tabulato ratei, serve ovunque si debba puntare a una persona.

import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { normNome, type DipendenteRif } from '../lib/rateiParse';

type Props = {
  dipendenti: DipendenteRif[];
  valore: string | null;
  onScegli: (id: string | null) => void;
  /** Testo del pulsante quando non è stato scelto nessuno. */
  placeholder?: string;
  /** Bordo ambra finché non si sceglie: serve dove la scelta è obbligatoria. */
  obbligatorio?: boolean;
  classeBottone?: string;
};

export function etichettaDipendente(d: DipendenteRif): string {
  return `${[d.cognome, d.nome].filter(Boolean).join(' ')}${d.matricola ? ` · ${d.matricola}` : ''}`;
}

export default function SceltaPersona({
  dipendenti, valore, onScegli,
  placeholder = 'Scegli la persona…',
  obbligatorio = true,
  classeBottone = 'w-full max-w-[240px]',
}: Props) {
  const [aperto, setAperto] = useState(false);
  const [q, setQ] = useState('');
  const scelto = dipendenti.find((d) => d.id === valore) ?? null;

  const filtrati = useMemo(() => {
    const t = normNome(q);
    const num = q.replace(/\D/g, '');
    return dipendenti.filter((d) => {
      if (!t && !num) return true;
      const nome = normNome(`${d.cognome ?? ''} ${d.nome ?? ''}`);
      return (t && nome.includes(t)) || (num && (d.matricola ?? '').includes(num));
    });
  }, [q, dipendenti]);

  const bordo = scelto
    ? 'border-slate-300 text-slate-800'
    : obbligatorio ? 'border-amber-300 text-slate-500' : 'border-slate-300 text-slate-500';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setAperto((v) => !v); setQ(''); }}
        className={`text-sm rounded-lg px-2.5 py-1.5 bg-white text-left border ${bordo} ${classeBottone}`}
      >
        {scelto ? etichettaDipendente(scelto) : placeholder}
      </button>

      {aperto && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setAperto(false)} />
          <div className="absolute z-30 mt-1 w-[280px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-100">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setAperto(false); }}
                placeholder="Cognome o matricola"
                className="w-full text-sm outline-none"
              />
              {q && <button type="button" onClick={() => setQ('')} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtrati.length === 0 && (
                <div className="px-3 py-3 text-sm text-slate-400">Nessuno con questo nome.</div>
              )}
              {filtrati.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { onScegli(d.id); setAperto(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${d.id === valore ? 'bg-blue-50 font-medium' : ''}`}
                >
                  {[d.cognome, d.nome].filter(Boolean).join(' ')}
                  <span className="text-slate-400"> · {d.matricola ?? 'senza matricola'}</span>
                  {!d.isActive && <span className="text-rose-600"> · cessata</span>}
                </button>
              ))}
            </div>
            {scelto && (
              <button
                type="button"
                onClick={() => { onScegli(null); setAperto(false); }}
                className="w-full text-left px-3 py-2 text-xs text-slate-500 border-t border-slate-100 hover:bg-slate-50"
              >
                Togli la scelta
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
