// «Riposi» di un negozio (Patrizio, 12/11/2026): per ogni persona i giorni in
// cui riposa di preferenza e quelli in cui non riposa mai, anche piu' di uno.
// Solo feriali: sabato, domenica e giorni di evento non compaiono, li' si lavora.
// Ogni tocco si salva subito (tabella employee_riposi, migration 403). Dove la
// tabella non c'e' ancora la scheda lo dice e non fa scegliere niente.

import { useEffect, useState } from 'react';
import { useToast } from './Toast';
import { caricaRiposi, salvaRiposi } from '../lib/regoleNuoveDb';

type Props = {
  companyId: string;
  persone: { id: string; nome: string }[];
  puoScrivere: boolean;
};

const GIORNI = [{ g: 1, n: 'L', nome: 'lunedì' }, { g: 2, n: 'Ma', nome: 'martedì' }, { g: 3, n: 'Me', nome: 'mercoledì' }, { g: 4, n: 'G', nome: 'giovedì' }, { g: 5, n: 'V', nome: 'venerdì' }];

export default function RiposiNegozio({ companyId, persone, puoScrivere }: Props) {
  const { toast } = useToast();
  const [preferiti, setPreferiti] = useState<Map<string, number[]>>(new Map());
  const [mai, setMai] = useState<Map<string, number[]>>(new Map());
  const [disponibile, setDisponibile] = useState<boolean | null>(null);

  useEffect(() => {
    let vivo = true;
    caricaRiposi(companyId).then((r) => {
      if (!vivo) return;
      setPreferiti(r.preferiti); setMai(r.mai); setDisponibile(r.disponibile);
    }).catch(() => { if (vivo) setDisponibile(false); });
    return () => { vivo = false; };
  }, [companyId]);

  const tocca = async (id: string, giorno: number, lista: 'preferiti' | 'mai') => {
    const p = new Set(preferiti.get(id) ?? []);
    const m = new Set(mai.get(id) ?? []);
    const [questa, altra] = lista === 'preferiti' ? [p, m] : [m, p];
    if (questa.has(giorno)) questa.delete(giorno);
    else { questa.add(giorno); altra.delete(giorno); } // un giorno non sta in tutte e due
    if (m.size === 5) { toast({ type: 'error', message: 'Almeno un giorno feriale deve restare libero per il riposo: per legge c’è almeno un giorno di riposo a settimana.' }); return; }
    const prima = { p: preferiti, m: mai };
    setPreferiti(new Map(preferiti).set(id, [...p].sort()));
    setMai(new Map(mai).set(id, [...m].sort()));
    try { await salvaRiposi(companyId, id, [...p], [...m]); }
    catch (e) {
      setPreferiti(prima.p); setMai(prima.m);
      toast({ type: 'error', message: `Riposo non salvato: ${e instanceof Error ? e.message : 'errore'}` });
    }
  };

  if (disponibile === null) return <p className="text-sm text-slate-400">Caricamento…</p>;
  if (!disponibile) {
    return <p className="text-sm text-slate-500">I giorni di riposo per persona si potranno scegliere qui dopo il prossimo aggiornamento del database. Fino ad allora i riposi li decide la turnazione.</p>;
  }
  if (!persone.length) return <p className="text-sm text-slate-500">Nessuna persona in servizio in questo negozio.</p>;

  const chip = (attivo: boolean, colore: 'nero' | 'rosa') => `min-w-[36px] min-h-[32px] rounded-full border text-xs font-semibold px-2 ${attivo
    ? (colore === 'nero' ? 'bg-slate-900 border-slate-900 text-white' : 'bg-pink-100 border-pink-300 text-pink-800')
    : 'bg-white border-slate-300 text-slate-400'} ${puoScrivere ? 'hover:border-slate-500' : 'cursor-default'}`;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800">
              <th className="py-1.5 pr-2 font-semibold">Persona</th>
              <th className="py-1.5 px-2 font-semibold">Riposa di preferenza</th>
              <th className="py-1.5 px-2 font-semibold">Non riposa mai</th>
            </tr>
          </thead>
          <tbody>
            {persone.map((x) => (
              <tr key={x.id} className="border-b border-slate-100">
                <td className="py-2 pr-2 font-semibold whitespace-nowrap">{x.nome}</td>
                {(['preferiti', 'mai'] as const).map((lista) => {
                  const scelti = (lista === 'preferiti' ? preferiti : mai).get(x.id) ?? [];
                  return (
                    <td key={lista} className="py-2 px-2">
                      <div className="flex flex-wrap gap-1 items-center">
                        {GIORNI.map((d) => (
                          <button key={d.g} type="button" disabled={!puoScrivere} aria-pressed={scelti.includes(d.g)}
                            aria-label={`${x.nome}: ${lista === 'preferiti' ? 'riposa di preferenza' : 'non riposa mai'} il ${d.nome}`}
                            onClick={() => tocca(x.id, d.g, lista)} className={chip(scelti.includes(d.g), lista === 'preferiti' ? 'nero' : 'rosa')}>{d.n}</button>
                        ))}
                        {lista === 'preferiti' && !scelti.length && <span className="text-xs text-slate-400 ml-1">sceglie il sistema</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Puoi toccare più giorni in ogni riga. Sabato, domenica e giorni di evento non compaiono: lì si lavora. Il sistema rispetta le preferenze il più possibile; se per coprire il negozio non può, lo segna fra le cose da guardare nella settimana.</p>
    </div>
  );
}
