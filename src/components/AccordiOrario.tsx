import { useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { minuti, regoleDaRiga, REGOLE_DEFAULT, type RegoleTurni } from '../lib/turni';
import { orePossibiliSettimana, testoAccordo, type Accordo, type FasciaOraria } from '../lib/accordiOrario';

// Riquadro «Disponibilita' per i turni» della scheda dipendente (Patrizio,
// 28/10/2026): gli accordi presi con la persona. L'orario di contratto resta
// fermo; qui si dice in quali giorni e in quali fasce puo' lavorare. Li usano il
// piano del mese, il piano settimanale e le simulazioni. Li modifica solo la
// responsabile HR; gli altri li vedono.

type Scelta = 'sempre' | 'mai' | 'fascia';
type Riga = { scelta: Scelta; dalle: string; alle: string };

const GIORNI = ['', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const TUTTI_SEMPRE: Record<number, Riga> = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((g) => [g, { scelta: 'sempre', dalle: '', alle: '' }]));
const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 1 });

function righeDa(a: Accordo | null): Record<number, Riga> {
  if (!a) return { ...TUTTI_SEMPRE };
  return Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((g) => {
    const f = a.fasce[String(g)]?.[0];
    const scelta: Scelta = !a.giorni.includes(g) ? 'mai' : f ? 'fascia' : 'sempre';
    return [g, { scelta, dalle: f?.dalle?.slice(0, 5) ?? '', alle: f?.alle?.slice(0, 5) ?? '' }];
  }));
}

export default function AccordiOrario({ employeeId, companyId, outletId, oreSettimanali }: {
  employeeId: string; companyId: string; outletId: string | null; oreSettimanali: number | null;
}) {
  const { toast } = useToast();
  const [salvato, setSalvato] = useState<Accordo | null>(null);
  const [righe, setRighe] = useState<Record<number, Riga>>({ ...TUTTI_SEMPRE });
  const [nota, setNota] = useState('');
  const [dal, setDal] = useState('');
  const [al, setAl] = useState('');
  const [eHr, setEHr] = useState(false);
  const [orario, setOrario] = useState<Record<number, { apre: number; chiude: number } | null>>({});
  const [regole, setRegole] = useState<RegoleTurni>(REGOLE_DEFAULT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [a, hr, o, r] = await Promise.all([
        supabase.from('employee_availability').select('giorni, fasce, valido_dal, valido_al, nota').eq('employee_id', employeeId).maybeSingle(),
        supabase.rpc('organico_e_hr'),
        outletId ? supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude').eq('outlet_id', outletId) : Promise.resolve({ data: [] }),
        outletId ? supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!vivo) return;
      const x = a.data as { giorni: number[]; fasce: Record<string, FasciaOraria[]> | null; valido_dal: string | null; valido_al: string | null; nota: string | null } | null;
      const acc: Accordo | null = x ? { giorni: x.giorni.map(Number), fasce: x.fasce ?? {}, validoDal: x.valido_dal, validoAl: x.valido_al, nota: x.nota } : null;
      setSalvato(acc);
      setRighe(righeDa(acc));
      setNota(acc?.nota ?? '');
      setDal(acc?.validoDal ?? '');
      setAl(acc?.validoAl ?? '');
      setEHr(!!hr.data);
      const oo: Record<number, { apre: number; chiude: number } | null> = {};
      for (const y of ((o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [])) {
        oo[y.giorno] = y.chiuso || !y.apre || !y.chiude ? null : { apre: minuti(y.apre), chiude: minuti(y.chiude) };
      }
      setOrario(oo);
      setRegole(regoleDaRiga(r.data as Parameters<typeof regoleDaRiga>[0]));
    })();
    return () => { vivo = false; };
  }, [employeeId, outletId]);

  // L'accordo come lo scriverebbe il salvataggio.
  const bozza: Accordo = useMemo(() => ({
    giorni: [1, 2, 3, 4, 5, 6, 7].filter((g) => righe[g].scelta !== 'mai'),
    fasce: Object.fromEntries([1, 2, 3, 4, 5, 6, 7]
      .filter((g) => righe[g].scelta === 'fascia' && righe[g].dalle && righe[g].alle)
      .map((g) => [String(g), [{ dalle: righe[g].dalle, alle: righe[g].alle }]])),
    validoDal: dal || null, validoAl: al || null, nota: nota.trim() || null,
  }), [righe, dal, al, nota]);
  const tuttoSempre = bozza.giorni.length === 7 && !Object.keys(bozza.fasce).length;
  const haOrario = Object.keys(orario).length > 0;
  const possibili = haOrario ? orePossibiliSettimana(tuttoSempre ? null : bozza, orario, regole) : null;
  const fasciaErrata = [1, 2, 3, 4, 5, 6, 7].find((g) => righe[g].scelta === 'fascia' && (!righe[g].dalle || !righe[g].alle || righe[g].alle <= righe[g].dalle));
  const nessuno: Accordo = { giorni: [1, 2, 3, 4, 5, 6, 7], fasce: {}, validoDal: null, validoAl: null, nota: null };
  const cambiato = JSON.stringify(bozza) !== JSON.stringify(salvato ?? nessuno);

  const imposta = (g: number, v: Partial<Riga>) => setRighe((r) => ({ ...r, [g]: { ...r[g], ...v } }));

  const salva = async () => {
    if (!bozza.giorni.length) { toast({ type: 'error', message: 'Serve almeno un giorno in cui può lavorare.' }); return; }
    if (fasciaErrata) { toast({ type: 'error', message: `${GIORNI[fasciaErrata]}: scrivi dalle e alle, con «alle» dopo «dalle».` }); return; }
    if (dal && al && al < dal) { toast({ type: 'error', message: 'La data di fine viene prima di quella di inizio.' }); return; }
    setBusy(true);
    try {
      if (tuttoSempre && !bozza.nota && !bozza.validoDal && !bozza.validoAl) {
        // nessun vincolo: si toglie l'accordo, la persona torna disponibile sempre
        const { error } = await supabase.from('employee_availability').delete().eq('employee_id', employeeId);
        if (error) throw error;
        setSalvato(null);
      } else {
        const { error } = await supabase.from('employee_availability').upsert([{
          employee_id: employeeId, company_id: companyId, giorni: bozza.giorni, fasce: bozza.fasce,
          valido_dal: bozza.validoDal, valido_al: bozza.validoAl, nota: bozza.nota, updated_at: new Date().toISOString(),
        }], { onConflict: 'employee_id' });
        if (error) throw error;
        setSalvato(bozza);
      }
      toast({ type: 'success', message: 'Accordi salvati: valgono per i prossimi piani dei turni e le simulazioni.' });
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Accordi non salvati.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 inline-flex items-center gap-1.5"><CalendarClock size={14} /> Disponibilità per i turni</span>
        <span className="text-xs text-slate-600">{salvato ? testoAccordo(salvato) : 'sempre disponibile'}</span>
      </div>
      <p className="text-[11px] text-slate-500 mb-2">
        Gli accordi presi con la persona: in quali giorni e in quali ore può lavorare. Il contratto non cambia. Li rispettano il piano del mese, il piano settimanale e le simulazioni; un turno messo a mano può uscirne.
        {!eHr && ' Li modifica solo la responsabile HR.'}
      </p>
      <div className="space-y-1.5">
        {[1, 2, 3, 4, 5, 6, 7].map((g) => {
          const r = righe[g];
          return (
            <div key={g} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-24 text-slate-700">{GIORNI[g]}</span>
              <select aria-label={`${GIORNI[g]}: disponibilità`} value={r.scelta} disabled={!eHr}
                onChange={(e) => imposta(g, { scelta: e.target.value as Scelta })}
                className="px-2 py-1 rounded border border-slate-300 bg-white text-sm disabled:bg-slate-50">
                <option value="sempre">Sempre</option>
                <option value="mai">Mai</option>
                <option value="fascia">Solo dalle… alle…</option>
              </select>
              {r.scelta === 'fascia' && (
                <>
                  <input type="time" step={1800} aria-label={`${GIORNI[g]} dalle`} value={r.dalle} disabled={!eHr} onChange={(e) => imposta(g, { dalle: e.target.value })}
                    className="px-2 py-1 rounded border border-slate-300 text-sm" />
                  <span className="text-slate-400">–</span>
                  <input type="time" step={1800} aria-label={`${GIORNI[g]} alle`} value={r.alle} disabled={!eHr} onChange={(e) => imposta(g, { alle: e.target.value })}
                    className="px-2 py-1 rounded border border-slate-300 text-sm" />
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
        <label className="text-xs text-slate-500 sm:col-span-3">Accordo (con chi, perché)
          <input type="text" value={nota} disabled={!eHr} onChange={(e) => setNota(e.target.value)} placeholder="es. accordo con Lilian: il martedì porta il figlio a scuola"
            className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 text-sm text-slate-800" />
        </label>
        <label className="text-xs text-slate-500">Valido dal
          <input type="date" value={dal} disabled={!eHr} onChange={(e) => setDal(e.target.value)} className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 text-sm text-slate-800" />
        </label>
        <label className="text-xs text-slate-500">Valido fino al
          <input type="date" value={al} disabled={!eHr} onChange={(e) => setAl(e.target.value)} className="mt-0.5 w-full px-2 py-1 rounded border border-slate-300 text-sm text-slate-800" />
        </label>
        <span className="text-[11px] text-slate-400 self-end">Date vuote: vale sempre.</span>
      </div>
      {possibili != null && oreSettimanali != null && oreSettimanali > 0 && (
        <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${possibili + 1e-9 < oreSettimanali ? 'bg-red-50 border border-red-200 text-red-800' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>
          {possibili + 1e-9 < oreSettimanali
            ? <>Con questi accordi può fare al massimo <strong>{fmt(possibili)} ore</strong> a settimana nell'orario del negozio; il contratto ne prevede <strong>{fmt(oreSettimanali)}</strong>. Le ore che mancano non si possono pianificare.</>
            : <>Con questi accordi può fare fino a {fmt(possibili)} ore a settimana nell'orario del negozio: il contratto di {fmt(oreSettimanali)} ore ci sta.</>}
        </div>
      )}
      {eHr && (
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" disabled={busy || !cambiato} onClick={salva}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50">Salva gli accordi</button>
          <button type="button" disabled={busy || tuttoSempre} onClick={() => setRighe({ ...TUTTI_SEMPRE })}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Sempre disponibile</button>
        </div>
      )}
    </div>
  );
}
