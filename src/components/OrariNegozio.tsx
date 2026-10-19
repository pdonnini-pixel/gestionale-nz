// «Orari e fabbisogno» di un negozio: la base da cui si propongono i turni.
//
//  - Orari della settimana tipo: li inserisce chi tiene l'organico.
//  - Fabbisogno (quante persone servono in ogni fascia): lo decide Patrizio,
//    quindi lo modifica solo super_advisor; gli altri lo vedono.
//  - Giorni speciali (festivi, chiusure, saldi): orari diversi e, se serve,
//    persone in piu' (che sono fabbisogno: solo super_advisor).
//  - Regole: turno minimo e massimo, pausa, giorni di lavoro a settimana.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Lock, Plus, Save, Trash2 } from 'lucide-react';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import {
  NOMI_GIORNO, REGOLE_DEFAULT, costruisciGiorni, giorniDellaSettimana, lunediDi, oreDaCoprire,
  type FasciaFabbisogno, type RegoleTurni,
} from '../lib/turni';
import { formattaDataBreve, oggiRoma } from '../lib/organico';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  puoScrivere: boolean;
  puoFabbisogno: boolean;
  /** ore settimanali di contratto delle persone in servizio nel negozio */
  oreContratto: number;
  onSalvato?: () => void;
};

type RigaOrario = { giorno: number; chiuso: boolean; apre: string; chiude: string };
type RigaFascia = FasciaFabbisogno & { id?: string; chiave: string };
type RigaSpeciale = { id?: string; data: string; chiuso: boolean; apre: string; chiude: string; persone_extra: number; nota: string };

const settimanaVuota = (): RigaOrario[] => [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '', chiude: '' }));
const t5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
const inputCls = 'min-h-[36px] rounded-lg border border-slate-300 px-2 text-sm disabled:bg-slate-50 disabled:text-slate-500';
let chiaveSeq = 0;
const nuovaChiave = () => `n${++chiaveSeq}`;

export default function OrariNegozio({ companyId, outletId, nomeNegozio, puoScrivere, puoFabbisogno, oreContratto, onSalvato }: Props) {
  const { toast } = useToast();
  const [orari, setOrari] = useState<RigaOrario[]>(settimanaVuota());
  const [fasce, setFasce] = useState<RigaFascia[]>([]);
  const [fasceIniziali, setFasceIniziali] = useState<string[]>([]);
  const [regole, setRegole] = useState<RegoleTurni>(REGOLE_DEFAULT);
  const [speciali, setSpeciali] = useState<RigaSpeciale[]>([]);
  const [nuovoSpeciale, setNuovoSpeciale] = useState<RigaSpeciale>({ data: '', chiuso: false, apre: '', chiude: '', persone_extra: 0, nota: '' });
  const [caricamento, setCaricamento] = useState(true);
  const [salvo, setSalvo] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    const [o, f, s, r] = await Promise.all([
      supabase.from('outlet_opening_hours').select('*').eq('outlet_id', outletId),
      supabase.from('outlet_staffing_needs').select('*').eq('outlet_id', outletId).order('giorno').order('dalle'),
      supabase.from('outlet_special_days').select('*').eq('outlet_id', outletId).gte('data', oggiRoma()).order('data'),
      supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
    ]);
    const base = settimanaVuota();
    for (const x of (o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? []) {
      base[x.giorno - 1] = { giorno: x.giorno, chiuso: x.chiuso, apre: t5(x.apre), chiude: t5(x.chiude) };
    }
    setOrari(base);
    const ff = ((f.data as { id: string; giorno: number; dalle: string; alle: string; persone: number }[]) ?? [])
      .map((x) => ({ id: x.id, giorno: x.giorno, dalle: t5(x.dalle), alle: t5(x.alle), persone: x.persone, chiave: x.id }));
    setFasce(ff);
    setFasceIniziali(ff.map((x) => x.id!));
    setSpeciali(((s.data as { id: string; data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [])
      .map((x) => ({ id: x.id, data: x.data, chiuso: x.chiuso, apre: t5(x.apre), chiude: t5(x.chiude), persone_extra: x.persone_extra, nota: x.nota ?? '' })));
    const rr = r.data as { turno_min_ore: number; turno_max_ore: number; pausa_oltre_ore: number; pausa_minuti: number; giorni_lavoro_max: number } | null;
    setRegole(rr ? {
      turnoMinOre: Number(rr.turno_min_ore), turnoMaxOre: Number(rr.turno_max_ore), pausaOltreOre: Number(rr.pausa_oltre_ore),
      pausaMinuti: Number(rr.pausa_minuti), giorniLavoroMax: Number(rr.giorni_lavoro_max),
    } : REGOLE_DEFAULT);
    setCaricamento(false);
  }, [outletId]);

  useEffect(() => { carica(); }, [carica]);

  const oreServono = useMemo(() => {
    const date = giorniDellaSettimana(lunediDi(oggiRoma()));
    return oreDaCoprire(costruisciGiorni(date, orari.map((o) => ({ ...o, apre: o.apre || null, chiude: o.chiude || null })), fasce, []));
  }, [orari, fasce]);

  const erroreOrari = orari.find((o) => !o.chiuso && (!o.apre || !o.chiude || o.chiude <= o.apre));
  const erroreFasce = fasce.find((f) => !f.dalle || !f.alle || f.alle <= f.dalle || f.persone < 0);

  const salvaOrari = async () => {
    if (erroreOrari) { toast({ type: 'error', message: `${NOMI_GIORNO[erroreOrari.giorno]}: indica apertura e chiusura, oppure segna chiuso.` }); return; }
    setSalvo('orari');
    const { error } = await supabase.from('outlet_opening_hours').upsert(orari.map((o) => ({
      company_id: companyId, outlet_id: outletId, giorno: o.giorno, chiuso: o.chiuso,
      apre: o.chiuso ? null : o.apre, chiude: o.chiuso ? null : o.chiude, updated_at: new Date().toISOString(),
    })), { onConflict: 'outlet_id,giorno' });
    setSalvo(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: `Orari di ${nomeNegozio} salvati.` });
    onSalvato?.();
  };

  const salvaFasce = async () => {
    if (erroreFasce) { toast({ type: 'error', message: `${NOMI_GIORNO[erroreFasce.giorno]}: una fascia ha orari non validi.` }); return; }
    setSalvo('fasce');
    try {
      const tolte = fasceIniziali.filter((id) => !fasce.some((f) => f.id === id));
      if (tolte.length) {
        const { error } = await supabase.from('outlet_staffing_needs').delete().in('id', tolte);
        if (error) throw error;
      }
      for (const f of fasce) {
        const riga = { company_id: companyId, outlet_id: outletId, giorno: f.giorno, dalle: f.dalle, alle: f.alle, persone: f.persone, updated_at: new Date().toISOString() };
        const { error } = f.id
          ? await supabase.from('outlet_staffing_needs').update(riga).eq('id', f.id)
          : await supabase.from('outlet_staffing_needs').insert([riga]);
        if (error) throw error;
      }
      toast({ type: 'success', message: `Fabbisogno di ${nomeNegozio} salvato.` });
      await carica();
      onSalvato?.();
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Fabbisogno non salvato.' });
    } finally {
      setSalvo(null);
    }
  };

  const salvaRegole = async () => {
    if (regole.turnoMaxOre < regole.turnoMinOre) { toast({ type: 'error', message: 'Il turno massimo è più corto del minimo.' }); return; }
    setSalvo('regole');
    const { error } = await supabase.from('outlet_shift_rules').upsert([{
      outlet_id: outletId, company_id: companyId, turno_min_ore: regole.turnoMinOre, turno_max_ore: regole.turnoMaxOre,
      pausa_oltre_ore: regole.pausaOltreOre, pausa_minuti: regole.pausaMinuti, giorni_lavoro_max: regole.giorniLavoroMax,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'outlet_id' });
    setSalvo(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: 'Regole salvate.' });
    onSalvato?.();
  };

  const aggiungiSpeciale = async () => {
    const s = nuovoSpeciale;
    if (!s.data) { toast({ type: 'error', message: 'Indica la data.' }); return; }
    if (!s.chiuso && s.apre && s.chiude && s.chiude <= s.apre) { toast({ type: 'error', message: 'La chiusura viene prima dell’apertura.' }); return; }
    setSalvo('speciali');
    const { error } = await supabase.from('outlet_special_days').upsert([{
      company_id: companyId, outlet_id: outletId, data: s.data, chiuso: s.chiuso,
      apre: s.chiuso ? null : (s.apre || null), chiude: s.chiuso ? null : (s.chiude || null),
      persone_extra: puoFabbisogno ? s.persone_extra : 0, nota: s.nota || null,
    }], { onConflict: 'outlet_id,data' });
    setSalvo(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    setNuovoSpeciale({ data: '', chiuso: false, apre: '', chiude: '', persone_extra: 0, nota: '' });
    await carica();
    onSalvato?.();
  };

  const togliSpeciale = async (id: string) => {
    const { error } = await supabase.from('outlet_special_days').delete().eq('id', id);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    await carica();
    onSalvato?.();
  };

  const copiaOrariLunedi = () => setOrari((o) => o.map((x) => (x.giorno === 1 ? x : { ...o[0], giorno: x.giorno })));
  const copiaFasceLunedi = () => setFasce((f) => {
    const lun = f.filter((x) => x.giorno === 1);
    return [...lun, ...[2, 3, 4, 5, 6, 7].flatMap((g) => lun.map((x) => ({ giorno: g, dalle: x.dalle, alle: x.alle, persone: x.persone, chiave: nuovaChiave() })))];
  });

  if (caricamento) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const mancano = oreServono - oreContratto;

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm ${oreServono > 0 && mancano > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
        <span>Ore da coprire in una settimana tipo: <strong className="tabular-nums">{oreServono.toLocaleString('it-IT')}</strong></span>
        <span>Ore di contratto delle persone in servizio: <strong className="tabular-nums">{oreContratto.toLocaleString('it-IT')}</strong></span>
        {oreServono > 0 && (mancano > 0
          ? <span className="font-semibold text-amber-900">Mancano {mancano.toLocaleString('it-IT')} ore</span>
          : <span className="font-semibold text-emerald-800">Le ore bastano ({(-mancano).toLocaleString('it-IT')} in più)</span>)}
        {oreServono === 0 && <span className="text-slate-500">Senza fabbisogno la proposta dei turni usa solo le ore di contratto.</span>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="flex items-center justify-between gap-2 p-4 border-b border-slate-100 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Orari della settimana tipo</h3>
              <p className="text-xs text-slate-500">Quando il negozio è aperto.</p>
            </div>
            {puoScrivere && (
              <div className="flex gap-2">
                <button type="button" onClick={copiaOrariLunedi} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50"><Copy size={13} /> Lunedì su tutti</button>
                <button type="button" onClick={salvaOrari} disabled={salvo === 'orari'} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"><Save size={13} /> Salva orari</button>
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <tbody>
              {orari.map((o, i) => (
                <tr key={o.giorno} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-medium w-28">{NOMI_GIORNO[o.giorno]}</td>
                  <td className="px-2 py-2">
                    <label className="text-xs text-slate-600 flex items-center gap-1.5">
                      <input type="checkbox" disabled={!puoScrivere} checked={o.chiuso}
                        onChange={(e) => setOrari((x) => x.map((r, j) => (j === i ? { ...r, chiuso: e.target.checked } : r)))} /> chiuso
                    </label>
                  </td>
                  <td className="px-2 py-2">
                    <label className="sr-only" htmlFor={`apre-${o.giorno}`}>Apre</label>
                    <input id={`apre-${o.giorno}`} type="time" step={1800} disabled={!puoScrivere || o.chiuso} className={inputCls} value={o.apre}
                      onChange={(e) => setOrari((x) => x.map((r, j) => (j === i ? { ...r, apre: e.target.value } : r)))} />
                  </td>
                  <td className="px-2 py-2">
                    <label className="sr-only" htmlFor={`chiude-${o.giorno}`}>Chiude</label>
                    <input id={`chiude-${o.giorno}`} type="time" step={1800} disabled={!puoScrivere || o.chiuso} className={inputCls} value={o.chiude}
                      onChange={(e) => setOrari((x) => x.map((r, j) => (j === i ? { ...r, chiude: e.target.value } : r)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="flex items-center justify-between gap-2 p-4 border-b border-slate-100 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">Fabbisogno: persone per fascia {!puoFabbisogno && <Lock size={13} className="text-slate-400" />}</h3>
              <p className="text-xs text-slate-500">{puoFabbisogno ? 'Quante persone servono in negozio, fascia per fascia.' : 'Lo decide Patrizio: qui lo vedi, non lo modifichi.'}</p>
            </div>
            {puoFabbisogno && (
              <div className="flex gap-2">
                <button type="button" onClick={copiaFasceLunedi} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50"><Copy size={13} /> Lunedì su tutti</button>
                <button type="button" onClick={salvaFasce} disabled={salvo === 'fasce'} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"><Save size={13} /> Salva fabbisogno</button>
              </div>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {[1, 2, 3, 4, 5, 6, 7].map((g) => {
              const dg = fasce.filter((f) => f.giorno === g);
              return (
                <div key={g} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm w-24">{NOMI_GIORNO[g]}</span>
                  {dg.length === 0 && <span className="text-xs text-slate-400">nessuna fascia</span>}
                  {dg.map((f) => (
                    <span key={f.chiave} className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-1.5 py-1">
                      <input aria-label="Dalle" type="time" step={1800} disabled={!puoFabbisogno} className={`${inputCls} min-h-[30px] w-[92px]`} value={f.dalle}
                        onChange={(e) => setFasce((x) => x.map((r) => (r.chiave === f.chiave ? { ...r, dalle: e.target.value } : r)))} />
                      <span className="text-xs text-slate-400">–</span>
                      <input aria-label="Alle" type="time" step={1800} disabled={!puoFabbisogno} className={`${inputCls} min-h-[30px] w-[92px]`} value={f.alle}
                        onChange={(e) => setFasce((x) => x.map((r) => (r.chiave === f.chiave ? { ...r, alle: e.target.value } : r)))} />
                      <input aria-label="Persone" type="number" min={0} max={30} disabled={!puoFabbisogno} className={`${inputCls} min-h-[30px] w-14 text-center`} value={f.persone}
                        onChange={(e) => setFasce((x) => x.map((r) => (r.chiave === f.chiave ? { ...r, persone: Math.max(0, Number(e.target.value) || 0) } : r)))} />
                      <span className="text-xs text-slate-500">pers.</span>
                      {puoFabbisogno && (
                        <button type="button" aria-label="Togli la fascia" onClick={() => setFasce((x) => x.filter((r) => r.chiave !== f.chiave))}
                          className="p-1 rounded hover:bg-slate-200"><Trash2 size={13} /></button>
                      )}
                    </span>
                  ))}
                  {puoFabbisogno && (
                    <button type="button" onClick={() => {
                      const o = orari[g - 1];
                      setFasce((x) => [...x, { giorno: g, dalle: o.apre || '10:00', alle: o.chiude || '20:00', persone: 2, chiave: nuovaChiave() }]);
                    }} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border border-dashed border-slate-300 hover:bg-slate-50"><Plus size={12} /> fascia</button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="p-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Giorni speciali</h3>
            <p className="text-xs text-slate-500">Festivi aperti, chiusure, saldi: valgono al posto della settimana tipo.</p>
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {speciali.map((s) => (
              <li key={s.id} className="px-4 py-2 flex items-center justify-between gap-2">
                <span>
                  <strong>{formattaDataBreve(s.data)}</strong>{s.nota ? ` · ${s.nota}` : ''}
                  <span className="text-slate-500"> · {s.chiuso ? 'chiuso' : `${s.apre || 'orario solito'}${s.chiude ? `-${s.chiude}` : ''}`}{s.persone_extra ? `, ${s.persone_extra > 0 ? '+' : ''}${s.persone_extra} persone` : ''}</span>
                </span>
                {puoScrivere && s.id && (
                  <button type="button" aria-label="Togli il giorno speciale" onClick={() => togliSpeciale(s.id!)} className="p-1.5 rounded hover:bg-slate-100"><Trash2 size={14} /></button>
                )}
              </li>
            ))}
            {!speciali.length && <li className="px-4 py-3 text-slate-400">Nessun giorno speciale nei prossimi mesi.</li>}
          </ul>
          {puoScrivere && (
            <div className="p-4 border-t border-slate-100 flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">Data<br /><input type="date" className={inputCls} value={nuovoSpeciale.data} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, data: e.target.value }))} /></label>
              <label className="text-xs text-slate-600 flex items-center gap-1 pb-2"><input type="checkbox" checked={nuovoSpeciale.chiuso} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, chiuso: e.target.checked }))} /> chiuso</label>
              <label className="text-xs text-slate-600">Apre<br /><input type="time" step={1800} disabled={nuovoSpeciale.chiuso} className={inputCls} value={nuovoSpeciale.apre} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, apre: e.target.value }))} /></label>
              <label className="text-xs text-slate-600">Chiude<br /><input type="time" step={1800} disabled={nuovoSpeciale.chiuso} className={inputCls} value={nuovoSpeciale.chiude} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, chiude: e.target.value }))} /></label>
              {puoFabbisogno && (
                <label className="text-xs text-slate-600">Persone in più<br /><input type="number" min={-30} max={30} className={`${inputCls} w-20`} value={nuovoSpeciale.persone_extra} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, persone_extra: Number(e.target.value) || 0 }))} /></label>
              )}
              <label className="text-xs text-slate-600 flex-1 min-w-[140px]">Nota<br /><input className={`${inputCls} w-full`} value={nuovoSpeciale.nota} placeholder="Immacolata, saldi…" onChange={(e) => setNuovoSpeciale((s) => ({ ...s, nota: e.target.value }))} /></label>
              <button type="button" onClick={aggiungiSpeciale} disabled={salvo === 'speciali'} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"><Plus size={13} /> Aggiungi</button>
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="flex items-center justify-between gap-2 p-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Regole dei turni</h3>
              <p className="text-xs text-slate-500">Valgono per la proposta automatica di questo negozio.</p>
            </div>
            {puoScrivere && (
              <button type="button" onClick={salvaRegole} disabled={salvo === 'regole'} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"><Save size={13} /> Salva regole</button>
            )}
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {([
              { k: 'turnoMinOre' as const, label: 'Turno minimo (ore)', min: 1, max: 12, step: 0.5 },
              { k: 'turnoMaxOre' as const, label: 'Turno massimo (ore)', min: 1, max: 12, step: 0.5 },
              { k: 'pausaOltreOre' as const, label: 'Pausa oltre le (ore)', min: 1, max: 12, step: 0.5 },
              { k: 'pausaMinuti' as const, label: 'Pausa (minuti)', min: 0, max: 120, step: 15 },
              { k: 'giorniLavoroMax' as const, label: 'Giorni di lavoro a settimana, al massimo', min: 1, max: 7, step: 1 },
            ]).map((c) => (
              <label key={c.k} className="text-xs text-slate-600">{c.label}<br />
                <input type="number" min={c.min} max={c.max} step={c.step} disabled={!puoScrivere} className={`${inputCls} w-24 mt-1`} value={regole[c.k]}
                  onChange={(e) => setRegole((r) => ({ ...r, [c.k]: Number(e.target.value) || 0 }))} />
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
