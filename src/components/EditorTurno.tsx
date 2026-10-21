// Finestra per mettere, spostare o togliere un turno a mano. La usano il piano
// settimanale e il piano del mese (Patrizio, 20/10/2026: dal riepilogo «Ore del
// mese» la responsabile HR entra nella casella e sistema le ore; se con la
// dipendente si concordano ore in piu', il turno si segna come straordinario).

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import { formattaDataBreve } from '../lib/organico';
import { NOMI_GIORNO_BREVI, oreLavorate, pausaPer, type RegoleTurni } from '../lib/turni';

export type TurnoModificabile = {
  id: string; inizio: string; fine: string; pausa_minuti: number;
  origine: string; stato: string; straordinario?: boolean; ore_straordinario?: number;
};

/** Il conto del mese della persona, per vedere subito come cambia la differenza. */
export type ContoMese = {
  /** ore da lavorare nel mese (contratto meno ferie e permessi); null = a chiamata */
  daLavorare: number | null;
  /** ore ordinarie gia' pianificate nel mese, senza il turno che si sta modificando */
  ordinarieAltri: number;
  /** ore di straordinario gia' pianificate nel mese, senza questo turno */
  straordinarioAltri: number;
};

const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 1 });

export default function EditorTurno({
  companyId, outletId, employeeId, data, turno, planId, nome, apre, chiude, regole, conto, onClose, onSalvato,
}: {
  companyId: string; outletId: string; employeeId: string; data: string; turno: TurnoModificabile | null; planId: string | null;
  nome: string; apre: number; chiude: number; regole: RegoleTurni; conto?: ContoMese;
  onClose: () => void; onSalvato: () => void;
}) {
  const { toast } = useToast();
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const [inizio, setInizio] = useState(turno?.inizio ?? hh(apre));
  const [fine, setFine] = useState(turno?.fine ?? hh(Math.min(chiude, apre + regole.turnoMaxOre * 60 + pausaPer(regole.turnoMaxOre * 60, regole))));
  const [pausa, setPausa] = useState(turno?.pausa_minuti ?? 0);
  // Straordinario a ore: allungando un turno di un'ora, straordinario e' solo
  // quell'ora (Patrizio, 21/10/2026). Si propone la differenza rispetto alle ore
  // ordinarie che il turno aveva; si puo' correggere a mano.
  const oreStraordPrima = Number(turno?.ore_straordinario ?? 0);
  const ordinariePrima = turno ? oreLavorate({ inizio: turno.inizio, fine: turno.fine, pausaMinuti: turno.pausa_minuti }) - oreStraordPrima : 0;
  const [straordinario, setStraordinario] = useState(oreStraordPrima > 0);
  const [oreStraordScritte, setOreStraordScritte] = useState<string | null>(oreStraordPrima > 0 ? String(oreStraordPrima) : null);
  const [salvo, setSalvo] = useState(false);

  const ore = oreLavorate({ inizio, fine, pausaMinuti: pausa });
  const errore = fine <= inizio ? 'La fine viene prima dell’inizio.' : ore <= 0 ? 'Turno vuoto.' : null;
  // Pausa prevista dalle regole (30' da 6 ore lavorate, anche da 8, in aggiunta alle ore): si
  // suggerisce, non si impone, perche' il turno messo a mano e' una scelta.
  const pausaDovuta = errore ? 0 : pausaPer(ore * 60, regole);
  const giornoSett = new Date(`${data}T00:00:00Z`).getUTCDay() || 7;

  // Come cambia il mese della persona con questo turno.
  const oreTurno = errore ? 0 : ore;
  const proposte = Math.max(0, oreTurno - (turno ? ordinariePrima : 0)) || oreTurno;
  const lette = oreStraordScritte != null ? Number(oreStraordScritte.replace(',', '.')) : NaN;
  const oreStraord = !straordinario ? 0 : Math.min(oreTurno, Math.max(0, Number.isFinite(lette) ? lette : proposte));
  const ordinarie = (conto?.ordinarieAltri ?? 0) + (oreTurno - oreStraord);
  const straordTot = (conto?.straordinarioAltri ?? 0) + oreStraord;
  const differenza = conto?.daLavorare != null ? conto.daLavorare - ordinarie : null;

  const salva = async () => {
    if (errore) return;
    setSalvo(true);
    const riga = { inizio, fine, pausa_minuti: pausa, origine: 'manuale' as const, straordinario: oreStraord > 0, ore_straordinario: oreStraord };
    const { error } = turno
      ? await supabase.from('shifts').update(riga).eq('id', turno.id)
      : await supabase.from('shifts').insert([{ ...riga, company_id: companyId, outlet_id: outletId, employee_id: employeeId, data, stato: 'bozza', plan_id: planId }]);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato();
  };

  const togli = async () => {
    if (!turno) return;
    setSalvo(true);
    const { error } = turno.origine === 'proposta' && turno.stato === 'bozza'
      ? await supabase.from('shifts').delete().eq('id', turno.id)
      : await supabase.from('shifts').update({ stato: 'annullato', annullato_motivo: 'Tolto a mano' }).eq('id', turno.id);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato();
  };

  return (
    <Modal open onClose={onClose} title={`${nome} · ${NOMI_GIORNO_BREVI[giornoSett]} ${formattaDataBreve(data)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-slate-600">Inizio<input type="time" step={1800} value={inizio} onChange={(e) => setInizio(e.target.value)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Fine<input type="time" step={1800} value={fine} onChange={(e) => setFine(e.target.value)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Pausa (min)<input type="number" min={0} max={180} step={15} value={pausa} onChange={(e) => setPausa(Number(e.target.value) || 0)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
        </div>
        <p className="text-sm text-slate-600">{errore ?? `${fmt(ore)} ore di lavoro.`} Il turno diventa «messo a mano»: il ricalcolo non lo cambia.</p>
        {pausa < pausaDovuta && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Con {fmt(ore)} ore di lavoro la regola prevede {pausaDovuta} minuti di pausa.{' '}
            <button type="button" onClick={() => setPausa(pausaDovuta)} className="font-semibold underline">Metti {pausaDovuta} minuti</button>
          </p>
        )}

        <label className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${straordinario ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
          <input type="checkbox" checked={straordinario} onChange={(e) => { setStraordinario(e.target.checked); setOreStraordScritte(null); }} className="mt-0.5" />
          <span className="text-sm flex-1">
            <span className="font-semibold text-slate-800">Straordinario</span>
            <span className="block text-xs text-slate-500">Ore concordate con la dipendente in più del contratto: si contano a parte e non coprono le ore di contratto non usate. Allungando un turno, straordinario sono solo le ore aggiunte.</span>
          </span>
        </label>
        {straordinario && (
          <label className="flex items-center gap-2 text-sm text-slate-700 -mt-2 pl-3">
            Di queste, ore di straordinario:
            <input type="text" inputMode="decimal" aria-label="Ore di straordinario del turno"
              value={oreStraordScritte ?? String(oreStraord).replace('.', ',')}
              onChange={(e) => setOreStraordScritte(e.target.value)}
              className="w-20 min-h-[36px] rounded-lg border border-amber-300 px-2 text-right tabular-nums" />
            <span className="text-xs text-slate-500">su {fmt(oreTurno)} h del turno; il resto è ordinario</span>
          </label>
        )}

        {conto && conto.daLavorare != null && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Il mese di {nome.split(' ')[0]} con questo turno</p>
            <div className="grid grid-cols-3 gap-2">
              <div><span className="block text-xs text-slate-500">Da lavorare</span><span className="font-semibold tabular-nums">{fmt(conto.daLavorare)} h</span></div>
              <div><span className="block text-xs text-slate-500">Ordinarie</span><span className="font-semibold tabular-nums">{fmt(ordinarie)} h</span></div>
              <div><span className="block text-xs text-slate-500">Straordinario</span><span className="font-semibold tabular-nums text-amber-800">{fmt(straordTot)} h</span></div>
            </div>
            <p className={`mt-1.5 text-sm font-medium ${differenza! > 0.25 ? 'text-slate-700' : differenza! < -0.25 ? 'text-amber-800' : 'text-emerald-700'}`}>
              {differenza! > 0.25 ? `Restano ${fmt(differenza!)} h di contratto non usate.`
                : differenza! < -0.25 ? `Le ore ordinarie superano il contratto di ${fmt(-differenza!)} h: se sono ore in più concordate, segna il turno come straordinario.`
                  : 'Tutte le ore di contratto sono usate.'}
            </p>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-200">
          {turno ? (
            <button type="button" onClick={togli} disabled={salvo} className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} /> Togli il turno</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm">Annulla</button>
            <button type="button" onClick={salva} disabled={!!errore || salvo} className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">Salva</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
