// «Piano del mese»: i turni di un negozio per un mese intero, in piu' varianti
// da confrontare (Patrizio, 20/10/2026).
//
// Ogni variante ha la sua regola per i sabati e le domeniche liberi (nessuno,
// solo sabati, solo domeniche, sabato o domenica). Il fabbisogno viene dal
// traffico MODA del negozio (pianoMensile.ts): le ore di chi c'e' si
// distribuiscono come gli ingressi. La responsabile HR sceglie la variante
// che vale; le altre restano bozze. Quando arrivano i cedolini del mese il
// piano si chiude e resta com'era, per la riprova.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Lock, Plus, Send, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { personaAllaData, nomePersona, oggiRoma } from '../lib/organico';
import { caricaGiorniFerie, caricaTraffico, type DatiOrganico } from '../lib/organicoDati';
import {
  NOMI_GIORNO_BREVI, costruisciGiorni, regoleDaRiga, giorniDellaSettimana, lunediDi, oreLavorate, eventiDelNegozio, eventiDelGiorno,
  type EventoNegozio, type Turno,
} from '../lib/turni';
import {
  pianificaMese, storicoTraffico, trafficoAtteso, tipoDelGiorno, ETICHETTE_REGOLA, NOMI_MESE,
  type PersonaPiano, type RegolaWeekend, type RigaTraffico,
} from '../lib/pianoMensile';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  dati: DatiOrganico;
  puoScrivere: boolean;
};

type Piano = {
  id: string; nome: string; mese: string; regola_weekend: RegolaWeekend; stato: 'bozza' | 'scelto';
  riepilogo: Riepilogo; created_by_nome: string | null; scelto_da_nome: string | null; scelto_il: string | null; created_at: string;
};
type Riepilogo = {
  oreScoperte?: number; oreRiserva?: number; straordinario?: number; fonte?: string; turni?: number;
  persone?: Record<string, { contratto: number; pianificate: number; straordinario: number; weekendLiberi: number; riserva: boolean }>;
};
type TurnoDb = { id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number; stato: string; origine: string };

const REGOLE: RegolaWeekend[] = ['sabato_o_domenica', 'solo_sabati', 'solo_domeniche', 'nessuno'];
// Nei turni contano le ferie approvate e anche quelle chieste e in attesa
// (Patrizio, 20/10/2026: «prendile in considerazione»): una richiesta
// respinta torna disponibile al ricalcolo, un giorno respinto no.
const STATI_FERIE_APPROVATE = ['inviata', 'approvata', 'approvata_parziale', 'chiusa'];
const GIORNI_FERIE_VALIDI = ['richiesto', 'approvato'];
const t5 = (t: string) => t.slice(0, 5);
const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 1 });

function meseSuccessivo(mese: string, delta: number): string {
  const [a, m] = mese.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
function dateDelMese(mese: string): string[] {
  const [a, m] = mese.split('-').map(Number);
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${mese}-${String(i + 1).padStart(2, '0')}`);
}

export default function PianiMensili({ companyId, outletId, nomeNegozio, dati, puoScrivere }: Props) {
  const { toast } = useToast();
  const [mese, setMese] = useState(() => meseSuccessivo(oggiRoma().slice(0, 7), 1));
  const [piani, setPiani] = useState<Piano[]>([]);
  const [eHr, setEHr] = useState(false);
  const [chiuso, setChiuso] = useState(false);
  const [aperto, setAperto] = useState<string | null>(null);
  const [versione, setVersione] = useState(0);
  const [turniPiano, setTurniPiano] = useState<TurnoDb[]>([]);
  const [liberiPiano, setLiberiPiano] = useState<{ employee_id: string; data: string }[]>([]);
  const [lavoro, setLavoro] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(true);

  const dateMese = useMemo(() => dateDelMese(mese), [mese]);

  const carica = useCallback(async () => {
    setCaricamento(true);
    const [p, hr, ch] = await Promise.all([
      supabase.from('shift_plans').select('*').eq('company_id', companyId).eq('outlet_id', outletId).eq('mese', `${mese}-01`).order('created_at'),
      supabase.rpc('organico_e_hr'),
      supabase.rpc('turni_mese_chiuso', { p_company: companyId, p_data: `${mese}-01` }),
    ]);
    if (p.error) toast({ type: 'error', message: `Piani non caricati: ${p.error.message}` });
    const lista = ((p.data as Piano[]) ?? []);
    setPiani(lista);
    setEHr(!!hr.data);
    setChiuso(!!ch.data);
    setAperto((a) => (a && lista.some((x) => x.id === a) ? a : lista.find((x) => x.stato === 'scelto')?.id ?? null));
    setCaricamento(false);
  }, [companyId, outletId, mese, toast]);
  useEffect(() => { carica(); }, [carica]);

  useEffect(() => {
    if (!aperto) { setTurniPiano([]); setLiberiPiano([]); return; }
    let vivo = true;
    void (async () => {
      const [t, l] = await Promise.all([
        supabase.from('shifts').select('id, employee_id, data, inizio, fine, pausa_minuti, stato, origine').eq('plan_id', aperto).neq('stato', 'annullato'),
        supabase.from('shift_plan_weekend_off').select('employee_id, data').eq('plan_id', aperto),
      ]);
      if (!vivo) return;
      setTurniPiano(((t.data as TurnoDb[]) ?? []).map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine) })));
      setLiberiPiano((l.data as { employee_id: string; data: string }[]) ?? []);
    })();
    return () => { vivo = false; };
  }, [aperto, versione]);

  // Chi lavora in questo negozio nel mese.
  const persone = useMemo(() => dati.schede
    .map((s) => ({ scheda: s, perGiorno: dateMese.map((d) => personaAllaData(s, dati.eventi, d)) }))
    .filter((x) => x.perGiorno.some((p) => p.outletId === outletId && p.stato === 'in_servizio'))
    .sort((a, b) => nomePersona(a.scheda).localeCompare(nomePersona(b.scheda), 'it')), [dati, dateMese, outletId]);

  const creaPiano = async (regola: RegolaWeekend) => {
    setLavoro(regola);
    try {
      // Settimane intere che toccano il mese.
      const settimane = [...new Set(dateMese.map(lunediDi))];
      const tutte = settimane.flatMap(giorniDellaSettimana);
      const [o, f, s, r, ev, tr, fe, sl, storico] = await Promise.all([
        supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude').eq('outlet_id', outletId),
        supabase.from('outlet_staffing_needs').select('giorno, dalle, alle, persone').eq('outlet_id', outletId),
        supabase.from('outlet_special_days').select('data, chiuso, apre, chiude, persone_extra, nota').eq('outlet_id', outletId).gte('data', tutte[0]).lte('data', tutte[tutte.length - 1]),
        supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
        supabase.from('outlet_events').select('nome, data_dal, data_al, outlet_ids, persone_extra, blocca_ferie, straordinari').eq('company_id', companyId).lte('data_dal', tutte[tutte.length - 1]).gte('data_al', tutte[0]),
        caricaTraffico(companyId, outletId),
        caricaGiorniFerie(companyId, dateMese[0], dateMese[dateMese.length - 1]),
        supabase.from('v_leave_disponibilita').select('employee_id, residuo_disponibile').eq('company_id', companyId),
        // Sabati e domeniche liberi dei piani scelti prima di questo mese: lo storico della rotazione.
        supabase.from('shift_plan_weekend_off').select('employee_id, data, shift_plans!inner(stato, outlet_id, mese)').eq('company_id', companyId).lt('data', `${mese}-01`),
      ]);
      const orari = (o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [];
      if (!orari.length) { toast({ type: 'error', message: `Mancano gli orari di ${nomeNegozio}: inseriscili in «Orari e fabbisogno».` }); return; }
      const eventi = eventiDelNegozio((ev.data as EventoNegozio[]) ?? [], outletId);
      const giorni = costruisciGiorni(tutte, orari, (f.data as { giorno: number; dalle: string; alle: string; persone: number }[]) ?? [],
        (s.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [], eventi);
      const regole = regoleDaRiga(r.data as Parameters<typeof regoleDaRiga>[0]);

      // Traffico: quello del negozio; se non ne ha (negozio nuovo), la forma media degli altri.
      const righe: RigaTraffico[] = tr;
      const propria = righe.length > 0;
      const st = storicoTraffico(propria ? righe : await caricaTraffico(companyId, null));
      const atteso = new Map<string, number[]>();
      const fonti = new Set<string>();
      for (const d of tutte) {
        const a = trafficoAtteso(st, d);
        if (a) { atteso.set(d, a.ore); if (d.startsWith(mese)) fonti.add(a.fonte); }
      }
      const extra = new Map(tutte.map((d) => [d, eventiDelGiorno(eventi, d).reduce((m, e) => Math.max(m, e.persone_extra || 0), 0)]));
      const senzaLiberi = new Set(tutte.filter((d) => eventiDelGiorno(eventi, d).some((e) => e.blocca_ferie)));

      const saldi = new Map<string, number>();
      for (const x of ((sl.data as { employee_id: string | null; residuo_disponibile: number | null }[]) ?? [])) {
        if (x.employee_id) saldi.set(x.employee_id, (saldi.get(x.employee_id) ?? 0) + Number(x.residuo_disponibile ?? 0));
      }
      const storicoWeekend = new Map<string, number>();
      for (const x of ((storico.data as unknown as { employee_id: string; shift_plans: { stato: string; outlet_id: string } | { stato: string; outlet_id: string }[] }[]) ?? [])) {
        const pl = Array.isArray(x.shift_plans) ? x.shift_plans[0] : x.shift_plans;
        if (pl?.stato === 'scelto') storicoWeekend.set(x.employee_id, (storicoWeekend.get(x.employee_id) ?? 0) + 1);
      }
      const ferieOk = fe.filter((x) => STATI_FERIE_APPROVATE.includes(x.stato_richiesta) && GIORNI_FERIE_VALIDI.includes(x.stato_giorno));

      const personePiano: PersonaPiano[] = persone.map(({ scheda, perGiorno }) => {
        const oreSett = perGiorno.find((p) => p.outletId === outletId && p.stato === 'in_servizio')?.ore ?? null;
        const suoFerie = ferieOk.filter((x) => x.employee_id === scheda.id);
        return {
          id: scheda.id,
          oreSettimana: oreSett,
          nonDisponibile: new Set([
            ...dateMese.filter((d, i) => perGiorno[i].outletId !== outletId || perGiorno[i].stato !== 'in_servizio'),
            ...suoFerie.filter((x) => x.tipo === 'giornata').map((x) => x.data),
          ]),
          oreFerie: new Map(suoFerie.map((x) => [x.data, Number(x.ore)])),
          saldoOre: saldi.get(scheda.id) ?? 0,
        };
      });
      const esito = pianificaMese({ mese, giorni, persone: personePiano, regola, storicoWeekend, atteso, extra, senzaLiberi, regole });

      const riepilogo: Riepilogo = {
        oreScoperte: esito.oreScoperte,
        oreRiserva: esito.oreRiserva,
        straordinario: Object.values(esito.persone).reduce((a, p) => a + p.straordinario, 0),
        fonte: atteso.size ? `${propria ? 'traffico MODA del negozio' : 'forma media degli altri negozi (questo non ha storico)'}: ${[...fonti].join(', ')}` : 'nessun traffico: fabbisogno di «Orari e fabbisogno»',
        turni: esito.turni.length,
        persone: esito.persone,
      };
      const nome = `${NOMI_MESE[Number(mese.slice(5))].replace(/^./, (c) => c.toUpperCase())} ${mese.slice(0, 4)} · ${ETICHETTE_REGOLA[regola]}`;
      const { data: pianoNuovo, error: e1 } = await supabase.from('shift_plans').insert([{
        company_id: companyId, outlet_id: outletId, mese: `${mese}-01`, nome, regola_weekend: regola, riepilogo,
      }]).select('id').single();
      if (e1) throw e1;
      const planId = (pianoNuovo as { id: string }).id;
      if (esito.turni.length) {
        const { error } = await supabase.from('shifts').insert(esito.turni.map((t: Turno) => ({
          company_id: companyId, outlet_id: outletId, employee_id: t.employeeId, data: t.data, inizio: t.inizio, fine: t.fine,
          pausa_minuti: t.pausaMinuti, origine: 'proposta', stato: 'bozza', plan_id: planId,
        })));
        if (error) throw error;
      }
      const liberi = [...esito.weekendLiberi].flatMap(([data, ids]) => ids.map((id) => ({ plan_id: planId, company_id: companyId, employee_id: id, data })));
      if (liberi.length) {
        const { error } = await supabase.from('shift_plan_weekend_off').insert(liberi);
        if (error) throw error;
      }
      toast({ type: 'success', message: `Piano creato: ${esito.turni.length} turni, ${fmt(esito.oreScoperte)} ore scoperte nel mese.` });
      await carica();
      setAperto(planId);
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Piano non creato.' });
    } finally {
      setLavoro(null);
    }
  };

  const scegli = async (id: string) => {
    setLavoro(id);
    const { error } = await supabase.rpc('turni_scegli_piano', { p_plan_id: id });
    setLavoro(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: 'Piano scelto: è quello che vale per il mese.' });
    carica();
  };

  const togli = async (p: Piano) => {
    if (!window.confirm(`Togliere la bozza «${p.nome}»? I suoi turni proposti spariscono; il piano si può rifare.`)) return;
    setLavoro(p.id);
    try {
      const a = await supabase.from('shifts').delete().eq('plan_id', p.id).eq('origine', 'proposta').eq('stato', 'bozza');
      if (a.error) throw a.error;
      const b = await supabase.from('shift_plan_weekend_off').delete().eq('plan_id', p.id);
      if (b.error) throw b.error;
      const c = await supabase.from('shift_plans').delete().eq('id', p.id).eq('stato', 'bozza');
      if (c.error) throw c.error;
      if (aperto === p.id) setAperto(null);
      await carica();
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Bozza non tolta (un turno messo a mano non si cancella).' });
    } finally {
      setLavoro(null);
    }
  };

  const pubblica = async (p: Piano) => {
    setLavoro(p.id);
    const { error } = await supabase.from('shifts').update({ stato: 'pubblicato' }).eq('plan_id', p.id).eq('stato', 'bozza');
    setLavoro(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: `Turni di ${NOMI_MESE[Number(mese.slice(5))]} pubblicati per ${nomeNegozio}.` });
    setVersione((v) => v + 1);
  };

  const pianoAperto = piani.find((p) => p.id === aperto) ?? null;
  const bozzeAperto = turniPiano.filter((t) => t.stato === 'bozza').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Mese prima" onClick={() => setMese((m) => meseSuccessivo(m, -1))} className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold text-slate-800 min-w-[160px] text-center capitalize">{NOMI_MESE[Number(mese.slice(5))]} {mese.slice(0, 4)}</span>
          <button type="button" aria-label="Mese dopo" onClick={() => setMese((m) => meseSuccessivo(m, 1))} className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50"><ChevronRight size={16} /></button>
        </div>
        {chiuso && <span className="inline-flex items-center gap-1.5 text-sm text-slate-600"><Lock size={14} /> Cedolini arrivati: il mese è chiuso e resta com'era, per la riprova.</span>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 space-y-1">
        <p>Il piano del mese distribuisce le ore di chi lavora in {nomeNegozio} come gli ingressi registrati da MODA: più persone quando entra più gente, sempre almeno una. I giorni speciali (festivi, Black Friday, settimane di Natale) si riconoscono dal calendario; gli eventi del negozio si aggiungono dalla scheda «Eventi».</p>
        <p>Si possono creare più varianti con regole diverse per i sabati e le domeniche liberi e confrontarle. {eHr ? 'Tu puoi scegliere quella che vale.' : 'Quella che vale la sceglie la responsabile HR.'}</p>
      </div>

      {puoScrivere && !chiuso && (
        <div className="flex flex-wrap gap-2">
          {REGOLE.map((r) => (
            <button key={r} type="button" onClick={() => creaPiano(r)} disabled={!!lavoro}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
              <Plus size={14} /> {lavoro === r ? 'Calcolo…' : `Piano con ${ETICHETTE_REGOLA[r]}`}
            </button>
          ))}
        </div>
      )}

      {caricamento ? <div className="text-slate-400 py-6 text-center">Caricamento…</div> : (
        <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2">Variante</th>
                <th className="px-3 py-2 text-right">Ore scoperte</th>
                <th className="px-3 py-2 text-right">A chiamata</th>
                <th className="px-3 py-2 text-right">Straordinari</th>
                <th className="px-3 py-2">Weekend liberi a testa</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {piani.map((p) => {
                const pp = Object.values(p.riepilogo.persone ?? {}).filter((x) => !x.riserva);
                const liberi = pp.map((x) => x.weekendLiberi);
                return (
                  <tr key={p.id} className={`border-b border-slate-100 ${aperto === p.id ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setAperto(p.id)} className="font-medium text-slate-900 hover:underline text-left">{p.nome}</button>
                      {p.stato === 'scelto' && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} /> scelto{p.scelto_da_nome ? ` da ${p.scelto_da_nome}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.riepilogo.oreScoperte)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.riepilogo.oreRiserva)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.riepilogo.straordinario)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{liberi.length ? `${Math.min(...liberi)}-${Math.max(...liberi)}` : '-'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {eHr && p.stato !== 'scelto' && !chiuso && (
                        <button type="button" onClick={() => scegli(p.id)} disabled={!!lavoro} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Scegli questo</button>
                      )}
                      {puoScrivere && p.stato === 'bozza' && !chiuso && (
                        <button type="button" aria-label="Togli la bozza" onClick={() => togli(p)} disabled={!!lavoro} className="ml-1 p-1.5 rounded hover:bg-slate-100"><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!piani.length && <tr><td colSpan={6} className="px-3 py-4 text-slate-400">Nessun piano per questo mese. Creane uno o più con i pulsanti sopra e confrontali.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {pianoAperto && (
        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><CalendarDays size={15} /> {pianoAperto.nome}</h3>
              <p className="text-xs text-slate-500">Fabbisogno da: {pianoAperto.riepilogo.fonte ?? '-'}</p>
            </div>
            {puoScrivere && pianoAperto.stato === 'scelto' && bozzeAperto > 0 && !chiuso && (
              <button type="button" onClick={() => pubblica(pianoAperto)} disabled={!!lavoro}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"><Send size={14} /> Pubblica il mese ({bozzeAperto})</button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-max">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-2 py-1.5 text-left sticky left-0 bg-white min-w-[150px]">Persona</th>
                  {dateMese.map((d) => {
                    const t = tipoDelGiorno(d);
                    const speciale = !['feriale', 'venerdi', 'sabato', 'domenica'].includes(t.tipo);
                    return (
                      <th key={d} className={`px-1 py-1.5 font-medium text-center min-w-[54px] ${[6, 7].includes(new Date(`${d}T00:00:00Z`).getUTCDay() || 7) ? 'bg-slate-50' : ''}`} title={t.nome ?? undefined}>
                        {NOMI_GIORNO_BREVI[new Date(`${d}T00:00:00Z`).getUTCDay() || 7]} {Number(d.slice(8))}
                        {speciale && <span className="block text-[10px] font-semibold text-red-700 truncate max-w-[54px]">{t.nome}</span>}
                      </th>
                    );
                  })}
                  <th className="px-2 py-1.5 text-right">Ore</th>
                </tr>
              </thead>
              <tbody>
                {persone.map(({ scheda }) => {
                  const r = pianoAperto.riepilogo.persone?.[scheda.id];
                  return (
                    <tr key={scheda.id} className="border-b border-slate-100">
                      <td className="px-2 py-1.5 sticky left-0 bg-white font-medium text-slate-800">{nomePersona(scheda)}{r?.riserva && <span className="block text-[10px] font-normal text-slate-500">a chiamata</span>}</td>
                      {dateMese.map((d) => {
                        const t = turniPiano.find((x) => x.employee_id === scheda.id && x.data === d);
                        const lib = liberiPiano.some((x) => x.employee_id === scheda.id && x.data === d);
                        return (
                          <td key={d} className="px-1 py-1 text-center">
                            {t ? <span className={`block rounded px-0.5 py-0.5 font-mono ${t.stato === 'pubblicato' ? 'bg-blue-100 text-blue-900' : 'bg-blue-50 text-blue-800'}`}>{t.inizio}<br />{t.fine}</span>
                              : lib ? <span className="block rounded px-0.5 py-1 bg-emerald-50 text-emerald-800 font-semibold">libero</span>
                                : <span className="text-slate-300">-</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                        {fmt(turniPiano.filter((x) => x.employee_id === scheda.id).reduce((a, x) => a + oreLavorate({ inizio: x.inizio, fine: x.fine, pausaMinuti: x.pausa_minuti }), 0))}
                        {r && !r.riserva && <span className="text-slate-400">/{fmt(r.contratto)}</span>}
                        {r && r.straordinario > 0.25 && <span className="block text-[10px] text-amber-800">{fmt(r.straordinario)} h straord.</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-slate-500">Il dettaglio della settimana, con le pause e la copertura ora per ora, è nel «Piano settimanale»: per i mesi con un piano scelto mostra i turni di quel piano.</p>
        </section>
      )}
    </div>
  );
}
