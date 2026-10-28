// Scheda «Trasferte» della pagina Turni (Patrizio, 28/10/2026): le ore di
// lavoro fuori dal negozio di riferimento, mese per mese, con i totali per
// persona e per destinazione e l'esportazione in Excel. Le trasferte si
// segnano dalla casella del piano del mese oppure da qui.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Plane, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { nomePersona, oggiRoma, formattaDataBreve } from '../lib/organico';
import { nomeNegozio, type DatiOrganico } from '../lib/organicoDati';
import { minuti, pausaMinimaPerPresenza, REGOLE_DEFAULT } from '../lib/turni';
import { caricaTrasferte, doveTrasferta, oreTrasferta, riepilogaTrasferte, type Trasferta } from '../lib/trasferte';

const NOMI_MESE = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 1 });
const ultimoGiorno = (mese: string) => {
  const [y, m] = mese.split('-').map(Number);
  return `${mese}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const spostaMese = (mese: string, n: number) => {
  const [y, m] = mese.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function TrasferteNegozi({ companyId, dati, puoScrivere }: { companyId: string; dati: DatiOrganico; puoScrivere: boolean }) {
  const { toast } = useToast();
  const [mese, setMese] = useState(() => oggiRoma().slice(0, 7));
  const [lista, setLista] = useState<Trasferta[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [puo, setPuo] = useState(puoScrivere);
  const [nuova, setNuova] = useState<{ employeeId: string; data: string; inizio: string; fine: string; dove: string; luogo: string; copre: boolean; motivo: string } | null>(null);
  const [salvo, setSalvo] = useState(false);

  const nomeNeg = useCallback((id: string) => nomeNegozio(dati.negozi.find((n) => n.id === id)), [dati]);
  const nomeDi = useCallback((id: string) => { const s = dati.schede.find((x) => x.id === id); return s ? nomePersona(s) : 'Persona non trovata'; }, [dati]);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const [t, hr] = await Promise.all([caricaTrasferte(companyId, `${mese}-01`, ultimoGiorno(mese)), supabase.rpc('organico_e_hr')]);
      setLista(t);
      setPuo(puoScrivere || !!hr.data);
    } catch (e) {
      toast({ type: 'error', message: `Trasferte non caricate: ${e instanceof Error ? e.message : 'errore'}` });
    } finally {
      setCaricamento(false);
    }
  }, [companyId, mese, puoScrivere, toast]);
  useEffect(() => { carica(); }, [carica]);

  const riepilogo = useMemo(() => riepilogaTrasferte(lista, nomeNeg), [lista, nomeNeg]);
  const negoziAttivi = dati.negozi.filter((n) => n.is_active !== false);

  const esporta = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const dettaglio = lista.map((t) => ({
      Data: formattaDataBreve(t.data), Persona: nomeDi(t.employeeId), 'Negozio di riferimento': t.outletId ? nomeNeg(t.outletId) : '',
      Dove: doveTrasferta(t, nomeNeg), Dalle: t.inizio, Alle: t.fine, 'Pausa (min)': t.pausaMinuti, 'Ore di lavoro': oreTrasferta(t),
      'Copre il negozio di destinazione': t.copreDestinazione ? 'sì' : 'no', Motivo: t.motivo ?? '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dettaglio), 'Trasferte');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riepilogo.persone.map((p) => ({
      Persona: nomeDi(p.employeeId), Giornate: p.giornate, Ore: p.ore, Destinazioni: p.destinazioni.join(', '),
    }))), 'Per persona');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(riepilogo.destinazioni.map((d) => ({ Dove: d.dove, Giornate: d.giornate, Ore: d.ore }))), 'Per destinazione');
    XLSX.writeFile(wb, `Trasferte ${NOMI_MESE[Number(mese.slice(5))]} ${mese.slice(0, 4)}.xlsx`);
  };

  const togli = async (t: Trasferta) => {
    if (!window.confirm(`Togliere la trasferta di ${nomeDi(t.employeeId)} del ${formattaDataBreve(t.data)}?`)) return;
    const { error } = await supabase.from('employee_trasferte').delete().eq('id', t.id);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: 'Trasferta tolta.' });
    await carica();
  };

  const salvaNuova = async () => {
    if (!nuova) return;
    const altro = nuova.dove === 'altro';
    if (!nuova.employeeId || !nuova.data || !nuova.dove || (altro && !nuova.luogo.trim())) { toast({ type: 'error', message: 'Scegli persona, giorno e dove va.' }); return; }
    if (nuova.fine <= nuova.inizio) { toast({ type: 'error', message: 'La fine viene prima dell’inizio.' }); return; }
    setSalvo(true);
    const riferimento = dati.schede.find((x) => x.id === nuova.employeeId)?.outlet_id ?? null;
    const { error } = await supabase.from('employee_trasferte').insert([{
      company_id: companyId, employee_id: nuova.employeeId, outlet_id: riferimento, data: nuova.data, inizio: nuova.inizio, fine: nuova.fine,
      pausa_minuti: pausaMinimaPerPresenza(minuti(nuova.fine) - minuti(nuova.inizio), REGOLE_DEFAULT),
      destinazione_outlet_id: altro ? null : nuova.dove, luogo: altro ? nuova.luogo.trim() : null,
      copre_destinazione: !altro && nuova.copre, motivo: nuova.motivo.trim() || null,
    }]);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: 'Trasferta segnata: vale come lavoro nelle ore della settimana.' });
    setNuova(null);
    if (nuova.data.startsWith(mese)) await carica(); else setMese(nuova.data.slice(0, 7));
  };

  const persone = [...dati.schede].filter((s) => s.is_active !== false).sort((a, b) => nomePersona(a).localeCompare(nomePersona(b), 'it'));

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 inline-flex items-center gap-1.5"><Plane size={15} /> Trasferte di {NOMI_MESE[Number(mese.slice(5))]} {mese.slice(0, 4)}</h3>
          <p className="text-xs text-slate-500">Ore di lavoro fuori dal negozio di riferimento: valgono come lavoro nelle ore della settimana, non come presenza nel negozio. Si segnano dalla casella del piano del mese o da qui.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setMese((m) => spostaMese(m, -1))} className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-sm">‹</button>
          <input type="month" value={mese} onChange={(e) => e.target.value && setMese(e.target.value)} aria-label="Mese" className="min-h-[36px] px-2 rounded-lg border border-slate-300 text-sm" />
          <button type="button" onClick={() => setMese((m) => spostaMese(m, 1))} className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-sm">›</button>
          <button type="button" onClick={esporta} disabled={!lista.length} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-slate-300 text-sm font-semibold disabled:opacity-50"><Download size={14} /> Excel</button>
          {puo && <button type="button" onClick={() => setNuova({ employeeId: '', data: `${mese}-01`, inizio: '10:00', fine: '19:00', dove: '', luogo: '', copre: false, motivo: '' })}
            className="min-h-[36px] px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">Nuova trasferta</button>}
        </div>
      </div>

      {nuova && (
        <div className="px-4 py-3 border-b border-slate-100 bg-indigo-50/50 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
          <label className="text-xs font-semibold text-slate-600">Persona
            <select value={nuova.employeeId} onChange={(e) => setNuova({ ...nuova, employeeId: e.target.value })} className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2">
              <option value="">Scegli…</option>
              {persone.map((p) => <option key={p.id} value={p.id}>{nomePersona(p)}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">Giorno
            <input type="date" value={nuova.data} onChange={(e) => setNuova({ ...nuova, data: e.target.value })} className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-semibold text-slate-600">Dalle<input type="time" step={1800} value={nuova.inizio} onChange={(e) => setNuova({ ...nuova, inizio: e.target.value })} className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2" /></label>
            <label className="text-xs font-semibold text-slate-600">Alle<input type="time" step={1800} value={nuova.fine} onChange={(e) => setNuova({ ...nuova, fine: e.target.value })} className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2" /></label>
          </div>
          <label className="text-xs font-semibold text-slate-600">Dove
            <select value={nuova.dove} onChange={(e) => setNuova({ ...nuova, dove: e.target.value, copre: e.target.value === 'altro' ? false : nuova.copre })} className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2">
              <option value="">Scegli…</option>
              {negoziAttivi.map((n) => <option key={n.id} value={n.id}>{nomeNegozio(n)}</option>)}
              <option value="altro">Altro luogo…</option>
            </select>
          </label>
          {nuova.dove === 'altro'
            ? <label className="text-xs font-semibold text-slate-600">Luogo<input type="text" value={nuova.luogo} onChange={(e) => setNuova({ ...nuova, luogo: e.target.value })} className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2" /></label>
            : <label className="flex items-center gap-2 text-xs text-slate-700 self-end pb-2"><input type="checkbox" disabled={!nuova.dove} checked={nuova.copre} onChange={(e) => setNuova({ ...nuova, copre: e.target.checked })} /> Le ore coprono anche quel negozio</label>}
          <label className="text-xs font-semibold text-slate-600">Motivo<input type="text" value={nuova.motivo} onChange={(e) => setNuova({ ...nuova, motivo: e.target.value })} className="mt-1 w-full min-h-[38px] rounded-lg border border-slate-300 bg-white px-2" /></label>
          <p className="text-xs text-slate-500 sm:col-span-2 self-center">La pausa si conta da sola (30 minuti da 6 ore di lavoro, un'ora da 8) e non si paga. Il negozio di riferimento è quello della persona.</p>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setNuova(null)} className="min-h-[38px] px-3 rounded-lg border border-slate-300 text-sm">Annulla</button>
            <button type="button" onClick={salvaNuova} disabled={salvo} className="min-h-[38px] px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">Salva</button>
          </div>
        </div>
      )}

      {caricamento ? <p className="px-4 py-6 text-sm text-slate-400">Carico…</p> : !lista.length ? (
        <p className="px-4 py-6 text-sm text-slate-500">Nessuna trasferta in questo mese.</p>
      ) : (
        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-700"><b>{riepilogo.giornate}</b> giornate di trasferta, <b>{fmt(riepilogo.ore)} ore</b> di lavoro fuori dal negozio.</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1">Persona</th><th className="py-1 text-right">Giornate</th><th className="py-1 text-right">Ore</th><th className="py-1 pl-3">Dove</th></tr></thead>
              <tbody>
                {riepilogo.persone.map((p) => (
                  <tr key={p.employeeId} className="border-t border-slate-100"><td className="py-1.5">{nomeDi(p.employeeId)}</td><td className="py-1.5 text-right tabular-nums">{p.giornate}</td><td className="py-1.5 text-right tabular-nums">{fmt(p.ore)}</td><td className="py-1.5 pl-3 text-xs text-slate-600">{p.destinazioni.join(', ')}</td></tr>
                ))}
              </tbody>
            </table>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wide text-slate-500"><th className="py-1">Destinazione</th><th className="py-1 text-right">Giornate</th><th className="py-1 text-right">Ore</th></tr></thead>
              <tbody>
                {riepilogo.destinazioni.map((d) => (
                  <tr key={d.dove} className="border-t border-slate-100"><td className="py-1.5">{d.dove}</td><td className="py-1.5 text-right tabular-nums">{d.giornate}</td><td className="py-1.5 text-right tabular-nums">{fmt(d.ore)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Giorno</th><th className="px-3 py-2">Persona</th><th className="px-3 py-2">Da</th><th className="px-3 py-2">Dove</th><th className="px-3 py-2">Orario</th><th className="px-3 py-2 text-right">Ore</th><th className="px-3 py-2">Motivo</th><th />
              </tr></thead>
              <tbody>
                {lista.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 whitespace-nowrap">{formattaDataBreve(t.data)}</td>
                    <td className="px-3 py-1.5">{nomeDi(t.employeeId)}</td>
                    <td className="px-3 py-1.5 text-slate-600">{t.outletId ? nomeNeg(t.outletId) : '—'}</td>
                    <td className="px-3 py-1.5">{doveTrasferta(t, nomeNeg)}{t.copreDestinazione && <span className="ml-1 text-[11px] font-semibold rounded-full bg-indigo-100 text-indigo-800 px-2 py-0.5">copre il negozio</span>}</td>
                    <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{t.inizio}–{t.fine}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(oreTrasferta(t))}</td>
                    <td className="px-3 py-1.5 text-slate-600">{t.motivo ?? ''}</td>
                    <td className="px-2 py-1.5 text-right">{puo && <button type="button" onClick={() => togli(t)} aria-label="Togli la trasferta" title="Togli" className="p-1.5 rounded text-rose-600 hover:bg-rose-50"><Trash2 size={14} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
