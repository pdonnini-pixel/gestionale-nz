// Chi puo' aprire e chi puo' chiudere il negozio (Patrizio, 16/11/2026): «non e' un obbligo, e'
// un'abilitazione». Una persona appena assunta non ha le chiavi e non sa ancora come si chiude:
// il motore dei turni non la mette ad aprire o a chiudere da sola. Tre stati: si', no, da indicare.
// Responsabile e vice sono sempre abilitate. Le modifica l'HR, come la disponibilita' per i turni.
// Dove le colonne mancano (migration 418 non applicata) il riquadro non si vede.

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { salvaAbilitazione } from '../lib/regoleNuoveDb';
import { useToast } from './Toast';

// colonne nuove, non ancora nei tipi generati del database
const db = supabase as unknown as SupabaseClient;

type Stato = boolean | null;
type Campo = 'puo_aprire' | 'puo_chiudere';

export default function ChiaviNegozio({ employeeId, outletId }: { employeeId: string; outletId: string | null }) {
  const { toast } = useToast();
  const [valori, setValori] = useState<Record<Campo, Stato> | null>(null);
  const [guida, setGuida] = useState<string | null>(null);
  const [eHr, setEHr] = useState(false);
  const [busy, setBusy] = useState<Campo | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [e, hr, o] = await Promise.all([
        db.from('employees').select('puo_aprire, puo_chiudere').eq('id', employeeId).maybeSingle(),
        supabase.rpc('organico_e_hr'),
        outletId ? db.from('outlets').select('referente_employee_id, vice_referente_employee_id').eq('id', outletId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!vivo) return;
      if (e.error) { setValori(null); return; }
      const r = (e.data as { puo_aprire: Stato; puo_chiudere: Stato } | null) ?? { puo_aprire: null, puo_chiudere: null };
      setValori({ puo_aprire: r.puo_aprire, puo_chiudere: r.puo_chiudere });
      setEHr(!!hr.data);
      const n = o.data as { referente_employee_id?: string | null; vice_referente_employee_id?: string | null } | null;
      setGuida(n?.referente_employee_id === employeeId ? 'referente' : n?.vice_referente_employee_id === employeeId ? 'vice referente' : null);
    })();
    return () => { vivo = false; };
  }, [employeeId, outletId]);

  if (!valori) return null;

  const cambia = async (campo: Campo, valore: Stato) => {
    setBusy(campo);
    try {
      await salvaAbilitazione(employeeId, campo, valore);
      setValori((v) => (v ? { ...v, [campo]: valore } : v));
      toast({ type: 'success', message: 'Salvato: vale dal prossimo piano dei turni' });
    } catch (err) {
      toast({ type: 'error', message: `Non salvato: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const riga = (campo: Campo, testo: string) => {
    const v = valori[campo];
    const scelte: { valore: Stato; nome: string }[] = [{ valore: true, nome: 'Sì' }, { valore: false, nome: 'No' }, { valore: null, nome: 'Da indicare' }];
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
        <span className="text-sm text-slate-800">{testo}</span>
        {guida ? (
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">sempre, è la {guida}</span>
        ) : (
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="group" aria-label={testo}>
            {scelte.map((s) => (
              <button key={s.nome} type="button" disabled={!eHr || busy === campo} onClick={() => v !== s.valore && void cambia(campo, s.valore)}
                aria-pressed={v === s.valore}
                className={`px-2.5 py-1 text-xs font-medium border-l first:border-l-0 border-slate-200 disabled:cursor-not-allowed ${v === s.valore
                  ? (s.valore === null ? 'bg-amber-50 text-amber-800' : s.valore ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-800')
                  : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                {s.nome}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-3 rounded-xl border border-slate-200 px-3 py-2.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 inline-flex items-center gap-2 mb-1"><KeyRound size={13} /> Apertura e chiusura del negozio</div>
      <p className="text-xs text-slate-500 mb-1">
        Abilitazioni, non obblighi: i turni non mettono ad aprire o a chiudere da sola chi non ha le chiavi. Finché nel negozio c'è qualcuna «da indicare» la regola non si applica.
        {!eHr && ' Le modifica solo la responsabile HR.'}
      </p>
      {riga('puo_aprire', 'Può aprire il negozio')}
      {riga('puo_chiudere', 'Può chiudere il negozio')}
    </div>
  );
}
