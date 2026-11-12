// Editor delle persone per fascia (Patrizio, 12/11/2026): una riga per fascia
// con dalle, alle e le persone (tasti − e +), «Togli», «+ Aggiungi una fascia»
// che parte dove finisce l'ultima, e una barra della giornata che fa vedere
// subito se resta un buco di orario. Lo usano «Regole e orari» (fasce del
// negozio, giorno per giorno) e la finestra di un periodo speciale.

import { Minus, Plus } from 'lucide-react';

export type FasciaSemplice = { dalle: string; alle: string; persone: number; chiave?: string };

type Props = {
  fasce: FasciaSemplice[];
  apre: string;
  chiude: string;
  bloccato?: boolean;
  onCambia: (fasce: FasciaSemplice[]) => void;
};

const minuti = (o: string) => Number(o.slice(0, 2)) * 60 + Number(o.slice(3, 5));
const inputCls = 'min-h-[38px] rounded-lg border border-slate-300 px-2 text-sm disabled:bg-slate-50 disabled:text-slate-500';

/** I pezzi della giornata, con le ore senza fascia segnate come buchi. */
export function pezziGiornata(fasce: FasciaSemplice[], apre: string, chiude: string): { da: number; a: number; persone: number | null }[] {
  if (!apre || !chiude || chiude <= apre) return [];
  const valide = fasce.filter((f) => f.dalle && f.alle && f.alle > f.dalle).sort((a, b) => a.dalle.localeCompare(b.dalle));
  const out: { da: number; a: number; persone: number | null }[] = [];
  let cursore = minuti(apre);
  const fine = minuti(chiude);
  for (const f of valide) {
    const da = Math.max(cursore, minuti(f.dalle));
    const a = Math.min(fine, minuti(f.alle));
    if (a <= da) continue;
    if (da > cursore) out.push({ da: cursore, a: da, persone: null });
    out.push({ da, a, persone: f.persone });
    cursore = a;
  }
  if (cursore < fine) out.push({ da: cursore, a: fine, persone: null });
  return out;
}

export default function FasceEditor({ fasce, apre, chiude, bloccato = false, onCambia }: Props) {
  const pezzi = pezziGiornata(fasce, apre, chiude);
  const totale = pezzi.reduce((s, p) => s + (p.a - p.da), 0) || 1;
  const massimo = Math.max(1, ...pezzi.map((p) => p.persone ?? 0));
  const buchi = pezzi.filter((p) => p.persone === null);
  const cambia = (i: number, patch: Partial<FasciaSemplice>) => onCambia(fasce.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const aggiungi = () => {
    const ultima = [...fasce].sort((a, b) => a.alle.localeCompare(b.alle)).pop();
    const dalle = ultima && ultima.alle < (chiude || '23:59') ? ultima.alle : (buchi[0] ? `${String(Math.floor(buchi[0].da / 60)).padStart(2, '0')}:${String(buchi[0].da % 60).padStart(2, '0')}` : apre || '10:00');
    onCambia([...fasce, { dalle, alle: chiude || '20:00', persone: 1, chiave: `n${Date.now()}${fasce.length}` }]);
  };

  return (
    <div className="space-y-2">
      {pezzi.length > 0 && (
        <div>
          <div className="flex h-7 rounded-lg overflow-hidden text-[11px] font-bold text-white" role="img"
            aria-label={`Giornata dalle ${apre} alle ${chiude}: ${pezzi.map((p) => (p.persone === null ? 'buco' : `${p.persone} persone`)).join(', ')}`}>
            {pezzi.map((p, i) => (
              <div key={i} style={{ width: `${((p.a - p.da) / totale) * 100}%` }}
                className={`flex items-center justify-center ${p.persone === null ? 'bg-amber-300 text-amber-950' : p.persone === massimo && massimo > 1 ? 'bg-pink-600' : p.persone > 1 ? 'bg-slate-600' : 'bg-slate-400'}`}>
                {p.persone === null ? 'buco' : p.persone}
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-0.5"><span>{apre}</span><span>{chiude}</span></div>
        </div>
      )}
      {buchi.length > 0 && fasce.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">Resta un pezzo di orario senza fascia (in giallo): lì il sistema mette comunque almeno una persona.</p>
      )}
      <div className="space-y-1.5">
        {fasce.map((f, i) => (
          <div key={f.chiave ?? `${i}`} className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-500">Dalle <input aria-label="Dalle" type="time" step={1800} disabled={bloccato} className={`${inputCls} w-[124px] ml-1`} value={f.dalle} onChange={(e) => cambia(i, { dalle: e.target.value })} /></label>
            <label className="text-xs text-slate-500">alle <input aria-label="Alle" type="time" step={1800} disabled={bloccato} className={`${inputCls} w-[124px] ml-1`} value={f.alle} onChange={(e) => cambia(i, { alle: e.target.value })} /></label>
            <span className="inline-flex items-center gap-1">
              <button type="button" aria-label="Una persona in meno" disabled={bloccato || f.persone <= 0} onClick={() => cambia(i, { persone: Math.max(0, f.persone - 1) })} className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-40"><Minus size={14} /></button>
              <span className="min-w-[2.2rem] text-center font-semibold tabular-nums" aria-label="Persone">{f.persone}</span>
              <button type="button" aria-label="Una persona in più" disabled={bloccato || f.persone >= 30} onClick={() => cambia(i, { persone: f.persone + 1 })} className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-40"><Plus size={14} /></button>
              <span className="text-xs text-slate-500">{f.persone === 1 ? 'persona' : 'persone'}</span>
            </span>
            {!bloccato && <button type="button" onClick={() => onCambia(fasce.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:text-red-700 underline ml-auto">Togli</button>}
          </div>
        ))}
        {!fasce.length && <p className="text-sm text-slate-400">Nessuna fascia: per questo giorno il sistema usa gli ingressi MODA, con almeno una persona.</p>}
      </div>
      {!bloccato && (
        <button type="button" onClick={aggiungi} className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700"><Plus size={14} /> Aggiungi una fascia</button>
      )}
    </div>
  );
}
