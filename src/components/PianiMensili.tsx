// «Piano del mese»: i turni di un negozio per un mese intero, in piu' varianti
// da confrontare (Patrizio, 20/10/2026).
//
// Ogni variante ha la sua regola per i sabati e le domeniche liberi (nessuno,
// solo sabati, solo domeniche, sabato o domenica). Il fabbisogno viene dal
// traffico MODA del negozio (pianoMensile.ts): le ore di chi c'e' si
// distribuiscono come gli ingressi. La responsabile HR sceglie la variante
// che vale; le altre restano bozze. Quando arrivano i cedolini del mese il
// piano si chiude e resta com'era, per la riprova.
//
// «Simulazione» (Patrizio, 20/10/2026): ore di contratto ipotetiche e
// straordinari ammessi, senza toccare l'organico, sul fabbisogno fisso di
// «Orari e fabbisogno». Si confronta con gli altri piani ma non si sceglie.
// Si possono aggiungere persone nuove (non ancora assunte): non hanno una
// scheda, quindi i loro turni e i loro liberi restano nel riepilogo del piano.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, Lock, Plus, Send, Trash2 } from 'lucide-react';
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
  type EsitoPianoMese, type PersonaPiano, type RegolaWeekend, type RigaTraffico,
} from '../lib/pianoMensile';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  dati: DatiOrganico;
  puoScrivere: boolean;
};

type Piano = {
  id: string; nome: string; mese: string; regola_weekend: RegolaWeekend; stato: 'bozza' | 'scelto'; simulazione: boolean;
  riepilogo: Riepilogo; created_by_nome: string | null; scelto_da_nome: string | null; scelto_il: string | null; created_at: string;
};
type Riepilogo = {
  oreScoperte?: number; oreRiserva?: number; straordinario?: number; fonte?: string; turni?: number;
  persone?: EsitoPianoMese['persone'];
  ipotesi?: {
    persone: { nome: string; oggi: number | null; ipotesi: number | null; soloWeekend: boolean; straordinari?: number }[];
    /** solo nelle prime simulazioni: un tetto uguale per tutti */
    straordinariSettimana?: number;
    nuove?: { id: string; nome: string; ore: number | null; soloWeekend: boolean; dal: string; straordinari?: number }[];
  };
  /** turni e liberi delle persone nuove di una simulazione (non hanno una scheda) */
  turniNuove?: { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number }[];
  liberiNuove?: { employee_id: string; data: string }[];
};
/** Persona nuova ipotetica: vive solo nella simulazione. */
type NuovaPersona = { id: string; nome: string; ore: string; soloWeekend: boolean; dal: string; straord: string };
/** Le ipotesi di una simulazione: ore per persona (vuoto = come oggi), solo weekend, straordinari ammessi. */
/** `straord`: ore di straordinario che la persona puo' fare a settimana (vuoto = non ne fa). */
type Simulazione = { ore: Record<string, string>; soloWeekend: Record<string, boolean>; straord: Record<string, string>; perTutti: string; nuove: NuovaPersona[] };
const ID_NUOVA = 'nuova-';
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
  const [sim, setSim] = useState<Simulazione | null>(null);
  const [simRegola, setSimRegola] = useState<RegolaWeekend>('nessuno');
  const [ferieMese, setFerieMese] = useState<{ employee_id: string; data: string; ore: number; tipo: string }[]>([]);
  const [giorniMax, setGiorniMax] = useState(6);

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
      // Ferie e permessi del mese (approvati o in attesa), per vederli nelle caselle.
      try {
        const fe = await caricaGiorniFerie(companyId, dateMese[0], dateMese[dateMese.length - 1]);
        const rr = await supabase.from('outlet_shift_rules').select('giorni_lavoro_max').eq('outlet_id', outletId).maybeSingle();
        if (!vivo) return;
        setFerieMese(fe.filter((x) => STATI_FERIE_APPROVATE.includes(x.stato_richiesta) && GIORNI_FERIE_VALIDI.includes(x.stato_giorno)));
        setGiorniMax(Number((rr.data as { giorni_lavoro_max?: number } | null)?.giorni_lavoro_max ?? 6));
      } catch { setFerieMese([]); }
      setTurniPiano(((t.data as TurnoDb[]) ?? []).map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine) })));
      setLiberiPiano((l.data as { employee_id: string; data: string }[]) ?? []);
    })();
    return () => { vivo = false; };
  }, [aperto, versione, companyId, outletId, dateMese]);

  // Chi lavora in questo negozio nel mese.
  const persone = useMemo(() => dati.schede
    .map((s) => ({ scheda: s, perGiorno: dateMese.map((d) => personaAllaData(s, dati.eventi, d)) }))
    .filter((x) => x.perGiorno.some((p) => p.outletId === outletId && p.stato === 'in_servizio'))
    .sort((a, b) => nomePersona(a.scheda).localeCompare(nomePersona(b.scheda), 'it')), [dati, dateMese, outletId]);

  const oreOggi = (perGiorno: ReturnType<typeof personaAllaData>[]) => perGiorno.find((p) => p.outletId === outletId && p.stato === 'in_servizio')?.ore ?? null;
  const numero = (v: string | undefined) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return v != null && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };

  const creaPiano = async (regola: RegolaWeekend, ipotesi?: Simulazione) => {
    setLavoro(ipotesi ? 'simulazione' : regola);
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

      const fasceNegozio = (f.data as unknown[] | null) ?? [];
      const personePiano: PersonaPiano[] = persone.map(({ scheda, perGiorno }) => {
        // In simulazione le ore scritte sostituiscono quelle del contratto; vuoto = come oggi.
        const oreSett = (ipotesi ? numero(ipotesi.ore[scheda.id]) : null) ?? oreOggi(perGiorno);
        const suoFerie = ferieOk.filter((x) => x.employee_id === scheda.id);
        const soloWeekend = !!ipotesi?.soloWeekend[scheda.id];
        return {
          id: scheda.id,
          oreSettimana: oreSett,
          nonDisponibile: new Set([
            ...dateMese.filter((d, i) => perGiorno[i].outletId !== outletId || perGiorno[i].stato !== 'in_servizio'),
            ...suoFerie.filter((x) => x.tipo === 'giornata').map((x) => x.data),
            ...(soloWeekend ? tutte.filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) : []),
          ]),
          oreFerie: new Map(suoFerie.map((x) => [x.data, Number(x.ore)])),
          saldoOre: saldi.get(scheda.id) ?? 0,
        };
      });
      // Persone nuove della simulazione: dal giorno indicato, ore scritte (vuoto = a chiamata).
      for (const n of ipotesi?.nuove ?? []) {
        const dal = n.dal || dateMese[0];
        personePiano.push({
          id: n.id,
          oreSettimana: numero(n.ore),
          nonDisponibile: new Set(tutte.filter((d) => d < dal
            || (n.soloWeekend && ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())))),
          oreFerie: new Map(),
          saldoOre: 0,
        });
      }
      const fabbisognoFisso = !!ipotesi && fasceNegozio.length > 0;
      // Straordinari: la disponibilita' del singolo, vuoto = non ne fa.
      const straordinariPersona = new Map<string, number>([
        ...persone.map(({ scheda }) => [scheda.id, numero(ipotesi?.straord[scheda.id]) ?? 0] as [string, number]),
        ...(ipotesi?.nuove ?? []).map((n) => [n.id, numero(n.straord) ?? 0] as [string, number]),
      ]);
      const esito = pianificaMese({
        mese, giorni, persone: personePiano, regola, storicoWeekend, atteso, extra, senzaLiberi, regole,
        fabbisognoFisso, straordinariPersona: ipotesi ? straordinariPersona : undefined,
      });

      const riepilogo: Riepilogo = {
        oreScoperte: esito.oreScoperte,
        oreRiserva: esito.oreRiserva,
        straordinario: Object.values(esito.persone).reduce((a, p) => a + p.straordinario, 0),
        fonte: fabbisognoFisso ? '«Orari e fabbisogno» del negozio (le ore che servono, fisse)'
          : atteso.size ? `${propria ? 'traffico MODA del negozio' : 'forma media degli altri negozi (questo non ha storico)'}: ${[...fonti].join(', ')}${ipotesi ? ' (manca il fabbisogno fisso: si adatta alle ore ipotetiche, il confronto dice poco)' : ''}` : 'nessun traffico: fabbisogno di «Orari e fabbisogno»',
        turni: esito.turni.length,
        persone: esito.persone,
        ...(ipotesi ? {
          ipotesi: {
            persone: persone.map(({ scheda, perGiorno }) => ({
              nome: nomePersona(scheda), oggi: oreOggi(perGiorno), ipotesi: numero(ipotesi.ore[scheda.id]), soloWeekend: !!ipotesi.soloWeekend[scheda.id],
              straordinari: straordinariPersona.get(scheda.id) ?? 0,
            })),
            nuove: ipotesi.nuove.map((n, i) => ({
              id: n.id, nome: n.nome.trim() || `Persona nuova ${i + 1}`, ore: numero(n.ore), soloWeekend: n.soloWeekend, dal: n.dal || dateMese[0],
              straordinari: straordinariPersona.get(n.id) ?? 0,
            })),
          },
          turniNuove: esito.turni.filter((t) => t.employeeId.startsWith(ID_NUOVA))
            .map((t) => ({ employee_id: t.employeeId, data: t.data, inizio: t.inizio, fine: t.fine, pausa_minuti: t.pausaMinuti })),
          liberiNuove: [...esito.weekendLiberi].flatMap(([data, ids]) => ids.filter((id) => id.startsWith(ID_NUOVA)).map((id) => ({ employee_id: id, data }))),
        } : {}),
      };
      const nome = `${ipotesi ? 'Simulazione · ' : ''}${NOMI_MESE[Number(mese.slice(5))].replace(/^./, (c) => c.toUpperCase())} ${mese.slice(0, 4)} · ${ETICHETTE_REGOLA[regola]}`;
      const { data: pianoNuovo, error: e1 } = await supabase.from('shift_plans').insert([{
        company_id: companyId, outlet_id: outletId, mese: `${mese}-01`, nome, regola_weekend: regola, riepilogo, simulazione: !!ipotesi,
      }]).select('id').single();
      if (e1) throw e1;
      const planId = (pianoNuovo as { id: string }).id;
      const turniVeri = esito.turni.filter((t) => !t.employeeId.startsWith(ID_NUOVA));
      if (turniVeri.length) {
        const { error } = await supabase.from('shifts').insert(turniVeri.map((t: Turno) => ({
          company_id: companyId, outlet_id: outletId, employee_id: t.employeeId, data: t.data, inizio: t.inizio, fine: t.fine,
          pausa_minuti: t.pausaMinuti, origine: 'proposta', stato: 'bozza', plan_id: planId,
        })));
        if (error) throw error;
      }
      const liberi = [...esito.weekendLiberi].flatMap(([data, ids]) => ids.filter((id) => !id.startsWith(ID_NUOVA)).map((id) => ({ plan_id: planId, company_id: companyId, employee_id: id, data })));
      if (liberi.length) {
        const { error } = await supabase.from('shift_plan_weekend_off').insert(liberi);
        if (error) throw error;
      }
      toast({ type: 'success', message: `${ipotesi ? 'Simulazione' : 'Piano'} creat${ipotesi ? 'a' : 'o'}: ${esito.turni.length} turni, ${fmt(esito.oreScoperte)} ore scoperte nel mese${riepilogo.straordinario ? `, ${fmt(riepilogo.straordinario)} ore di straordinario` : ''}.` });
      if (ipotesi) setSim(null);
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
          <button type="button" onClick={() => setSim(sim ? null : { ore: {}, soloWeekend: {}, straord: {}, perTutti: '', nuove: [] })} disabled={!!lavoro}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 disabled:opacity-50">
            <FlaskConical size={14} /> Simulazione
          </button>
        </div>
      )}

      {sim && puoScrivere && !chiuso && (
        <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-violet-900 flex items-center gap-1.5"><FlaskConical size={15} /> Simulazione per {nomeNegozio}</h3>
            <p className="text-xs text-slate-600">Scrivi le ore a settimana che vuoi provare (vuoto = come oggi) e, per ognuno, quante ore di straordinario può fare a settimana (vuoto = non ne fa). Puoi aggiungere persone nuove, che esistono solo nella simulazione. L'organico non cambia: la simulazione usa il fabbisogno di «Orari e fabbisogno», cioè le ore che servono, e dice quante restano scoperte. Si confronta con gli altri piani, ma non si sceglie né si pubblica.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pr-4 py-1">Persona</th><th className="pr-4 py-1 text-right">Oggi</th><th className="pr-4 py-1">Ore da provare</th><th className="pr-4 py-1">Solo sabato e domenica</th><th className="py-1">Straordinari (ore a settimana)</th>
                </tr>
              </thead>
              <tbody>
                {persone.map(({ scheda, perGiorno }) => {
                  const oggi = oreOggi(perGiorno);
                  return (
                    <tr key={scheda.id}>
                      <td className="pr-4 py-1 font-medium text-slate-800">{nomePersona(scheda)}</td>
                      <td className="pr-4 py-1 text-right tabular-nums text-slate-600">{oggi == null ? 'a chiamata' : `${fmt(oggi)} h`}</td>
                      <td className="pr-4 py-1">
                        <input type="text" inputMode="decimal" aria-label={`Ore da provare per ${nomePersona(scheda)}`} placeholder={oggi == null ? 'a chiamata' : String(oggi)}
                          value={sim.ore[scheda.id] ?? ''} onChange={(e) => setSim({ ...sim, ore: { ...sim.ore, [scheda.id]: e.target.value } })}
                          className="w-24 px-2 py-1 rounded border border-slate-300 bg-white text-right" />
                      </td>
                      <td className="pr-4 py-1">
                        <input type="checkbox" aria-label={`${nomePersona(scheda)} solo sabato e domenica`} checked={!!sim.soloWeekend[scheda.id]}
                          onChange={(e) => setSim({ ...sim, soloWeekend: { ...sim.soloWeekend, [scheda.id]: e.target.checked } })} />
                      </td>
                      <td className="py-1">
                        <input type="text" inputMode="decimal" aria-label={`Straordinari a settimana per ${nomePersona(scheda)}`} placeholder="non ne fa"
                          value={sim.straord[scheda.id] ?? ''} onChange={(e) => setSim({ ...sim, straord: { ...sim.straord, [scheda.id]: e.target.value } })}
                          className="w-24 px-2 py-1 rounded border border-slate-300 bg-white text-right" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Persone nuove da provare</p>
            {sim.nuove.map((n, i) => {
              const cambia = (x: Partial<NuovaPersona>) => setSim({ ...sim, nuove: sim.nuove.map((y) => (y.id === n.id ? { ...y, ...x } : y)) });
              return (
                <div key={n.id} className="flex flex-wrap items-end gap-2 text-sm">
                  <label className="text-slate-700">Nome
                    <input type="text" value={n.nome} placeholder={`Persona nuova ${i + 1}`} onChange={(e) => cambia({ nome: e.target.value })}
                      className="block mt-1 w-40 px-2 py-1 rounded border border-slate-300 bg-white" />
                  </label>
                  <label className="text-slate-700">Ore a settimana
                    <input type="text" inputMode="decimal" value={n.ore} placeholder="a chiamata" onChange={(e) => cambia({ ore: e.target.value })}
                      className="block mt-1 w-24 px-2 py-1 rounded border border-slate-300 bg-white text-right" />
                  </label>
                  <label className="text-slate-700">Dal
                    <input type="date" value={n.dal} min={dateMese[0]} max={dateMese[dateMese.length - 1]} onChange={(e) => cambia({ dal: e.target.value })}
                      className="block mt-1 px-2 py-1 rounded border border-slate-300 bg-white" />
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-slate-700 pb-1.5">
                    <input type="checkbox" checked={n.soloWeekend} onChange={(e) => cambia({ soloWeekend: e.target.checked })} /> solo sabato e domenica
                  </label>
                  <label className="text-slate-700">Straordinari a settimana
                    <input type="text" inputMode="decimal" value={n.straord} placeholder="non ne fa" onChange={(e) => cambia({ straord: e.target.value })}
                      className="block mt-1 w-24 px-2 py-1 rounded border border-slate-300 bg-white text-right" />
                  </label>
                  <button type="button" aria-label="Togli questa persona" onClick={() => setSim({ ...sim, nuove: sim.nuove.filter((y) => y.id !== n.id) })}
                    className="p-1.5 mb-0.5 rounded hover:bg-violet-100"><Trash2 size={14} /></button>
                </div>
              );
            })}
            <button type="button" onClick={() => setSim({ ...sim, nuove: [...sim.nuove, { id: `${ID_NUOVA}${Date.now()}`, nome: '', ore: '', soloWeekend: false, dal: dateMese[0], straord: '' }] })}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-violet-300 bg-white text-violet-900 hover:bg-violet-100">
              <Plus size={14} /> Aggiungi una persona nuova
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="text-sm text-slate-700">Stessi straordinari a tutti
              <div className="flex gap-1 mt-1">
                <input type="text" inputMode="decimal" aria-label="Ore di straordinario a settimana da mettere a tutti" value={sim.perTutti} placeholder="ore"
                  onChange={(e) => setSim({ ...sim, perTutti: e.target.value })} className="w-20 px-2 py-1 rounded border border-slate-300 bg-white text-right" />
                <button type="button" onClick={() => setSim({
                  ...sim,
                  straord: Object.fromEntries(persone.map(({ scheda }) => [scheda.id, sim.perTutti])),
                  nuove: sim.nuove.map((n) => ({ ...n, straord: sim.perTutti })),
                })} className="px-2 py-1 rounded border border-violet-300 bg-white text-violet-900 hover:bg-violet-100">Metti a tutti</button>
              </div>
            </div>
            <label className="text-sm text-slate-700">Sabati e domeniche liberi
              <select value={simRegola} onChange={(e) => setSimRegola(e.target.value as RegolaWeekend)} className="block mt-1 px-2 py-1 rounded border border-slate-300 bg-white">
                {REGOLE.map((r) => <option key={r} value={r}>{ETICHETTE_REGOLA[r]}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => creaPiano(simRegola, sim)} disabled={!!lavoro}
              className="text-sm px-3 py-2 rounded-lg bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50">
              {lavoro === 'simulazione' ? 'Calcolo…' : 'Calcola la simulazione'}
            </button>
          </div>
        </section>
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
                      {p.simulazione && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-violet-700"><FlaskConical size={13} /> simulazione</span>}
                      {p.stato === 'scelto' && <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} /> scelto{p.scelto_da_nome ? ` da ${p.scelto_da_nome}` : ''}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.riepilogo.oreScoperte)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.riepilogo.oreRiserva)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(p.riepilogo.straordinario)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{liberi.length ? `${Math.min(...liberi)}-${Math.max(...liberi)}` : '-'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {eHr && p.stato !== 'scelto' && !p.simulazione && !chiuso && (
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
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Lo stato del piano, prima di tutto: vale o non vale. */}
          {pianoAperto.simulazione ? (
            <div className="px-4 py-3 bg-violet-50 border-b border-violet-200 text-sm text-violet-900 flex items-start gap-2">
              <FlaskConical size={16} className="mt-0.5 shrink-0" />
              <div><b>Simulazione.</b> Serve solo a confrontare: non vale, non si sceglie e non si pubblica. Le persone in viola esistono solo qui.</div>
            </div>
          ) : pianoAperto.stato === 'scelto' ? (
            <div className="px-4 py-3 bg-emerald-50 border-b border-emerald-200 text-sm text-emerald-900 flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              <div>
                <b>Questo è il piano che vale per {NOMI_MESE[Number(mese.slice(5))]}.</b>
                {pianoAperto.scelto_da_nome ? ` Scelto da ${pianoAperto.scelto_da_nome}.` : ''}
                {' '}{bozzeAperto > 0 ? `${bozzeAperto} turni ancora da pubblicare: il negozio li vede dopo «Pubblica il mese».` : 'Tutti i turni sono pubblicati.'}
              </div>
            </div>
          ) : (
            <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-900 flex items-start gap-2">
              <CalendarDays size={16} className="mt-0.5 shrink-0" />
              <div><b>Bozza.</b> È una delle varianti da confrontare: non vale finché la responsabile HR non la sceglie con «Scegli questo».</div>
            </div>
          )}
          <div className="flex flex-wrap items-start justify-between gap-3 p-4 border-b border-slate-100">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900">{pianoAperto.nome}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Fabbisogno da: {pianoAperto.riepilogo.fonte ?? '-'}</p>
              {pianoAperto.riepilogo.ipotesi && (
                <p className="text-xs text-violet-800 mt-1">
                  Ipotesi: {pianoAperto.riepilogo.ipotesi.persone.filter((x) => x.ipotesi != null || x.soloWeekend)
                    .map((x) => `${x.nome} ${x.ipotesi != null ? `${fmt(x.ipotesi)} h (oggi ${x.oggi == null ? 'a chiamata' : `${fmt(x.oggi)} h`})` : ''}${x.soloWeekend ? ' solo sabato e domenica' : ''}`).join(' · ') || 'ore di oggi'}
                  {(pianoAperto.riepilogo.ipotesi.nuove ?? []).map((n) => ` · nuova: ${n.nome} ${n.ore == null ? 'a chiamata' : `${fmt(n.ore)} h`} dal ${n.dal.slice(8)}/${n.dal.slice(5, 7)}${n.soloWeekend ? ', solo sabato e domenica' : ''}`).join('')}
                  {' · '}straordinari disponibili: {pianoAperto.riepilogo.ipotesi.straordinariSettimana != null
                    ? `${fmt(pianoAperto.riepilogo.ipotesi.straordinariSettimana)} h a settimana per tutti`
                    : [...pianoAperto.riepilogo.ipotesi.persone, ...(pianoAperto.riepilogo.ipotesi.nuove ?? [])].filter((x) => (x.straordinari ?? 0) > 0)
                      .map((x) => `${x.nome} ${fmt(x.straordinari)} h`).join(', ') || 'nessuno'}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-2 text-xs">
                <span className={`px-2 py-1 rounded-md ${(pianoAperto.riepilogo.oreScoperte ?? 0) > 0.25 ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
                  {(pianoAperto.riepilogo.oreScoperte ?? 0) > 0.25 ? `${fmt(pianoAperto.riepilogo.oreScoperte)} ore scoperte nel mese` : 'Fabbisogno coperto'}
                </span>
                {(pianoAperto.riepilogo.oreRiserva ?? 0) > 0 && <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-700">{fmt(pianoAperto.riepilogo.oreRiserva)} ore a chiamata</span>}
                {(pianoAperto.riepilogo.straordinario ?? 0) > 0.25 && <span className="px-2 py-1 rounded-md bg-amber-50 text-amber-800">{fmt(pianoAperto.riepilogo.straordinario)} ore di straordinario</span>}
              </div>
            </div>
            {puoScrivere && pianoAperto.stato === 'scelto' && !pianoAperto.simulazione && bozzeAperto > 0 && !chiuso && (
              <button type="button" onClick={() => pubblica(pianoAperto)} disabled={!!lavoro}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"><Send size={14} /> Pubblica il mese ({bozzeAperto})</button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-slate-600 border-b border-slate-100">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-600" /> turno pubblicato</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-300" /> turno in bozza</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100" /> libero nel weekend</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100" /> ferie o permesso</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200" /> non in servizio in questo negozio</span>
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs min-w-max border-separate border-spacing-0">
              <thead>
                <tr className="text-slate-500">
                  <th className="px-3 py-2 text-left sticky left-0 z-10 bg-white min-w-[160px] border-b border-slate-200 font-semibold">Persona</th>
                  {dateMese.map((d) => {
                    const t = tipoDelGiorno(d);
                    const gs = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
                    const speciale = !['feriale', 'venerdi', 'sabato', 'domenica'].includes(t.tipo);
                    return (
                      <th key={d} title={t.nome ?? undefined}
                        className={`px-1 py-2 text-center min-w-[64px] border-b border-slate-200 font-medium ${gs >= 6 ? 'bg-slate-50' : ''} ${gs === 1 ? 'border-l border-l-slate-300' : ''}`}>
                        <span className="block text-[10px] uppercase tracking-wide">{NOMI_GIORNO_BREVI[gs]}</span>
                        <span className="block text-sm font-semibold text-slate-800">{Number(d.slice(8))}</span>
                        {speciale && <span className="block text-[10px] font-semibold text-red-700 truncate max-w-[64px]">{t.nome}</span>}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2 text-right border-b border-slate-200 min-w-[170px] font-semibold">Ore del mese</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...persone.map(({ scheda, perGiorno }) => ({
                    id: scheda.id, nome: nomePersona(scheda), nuova: false,
                    inServizio: (i: number) => perGiorno[i].outletId === outletId && perGiorno[i].stato === 'in_servizio',
                    turni: turniPiano.filter((x) => x.employee_id === scheda.id).map((x) => ({ ...x, pubblicato: x.stato === 'pubblicato' })),
                    liberi: new Set(liberiPiano.filter((x) => x.employee_id === scheda.id).map((x) => x.data)),
                  })),
                  ...(pianoAperto.riepilogo.ipotesi?.nuove ?? []).map((n) => ({
                    id: n.id, nome: n.nome, nuova: true,
                    inServizio: (i: number) => dateMese[i] >= n.dal,
                    turni: (pianoAperto.riepilogo.turniNuove ?? []).filter((x) => x.employee_id === n.id).map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine), pubblicato: false })),
                    liberi: new Set((pianoAperto.riepilogo.liberiNuove ?? []).filter((x) => x.employee_id === n.id).map((x) => x.data)),
                  })),
                ].map((riga) => {
                  const r = pianoAperto.riepilogo.persone?.[riga.id];
                  const fatte = riga.turni.reduce((a, x) => a + oreLavorate({ inizio: x.inizio, fine: x.fine, pausaMinuti: x.pausa_minuti }), 0);
                  const suoFerie = ferieMese.filter((x) => x.employee_id === riga.id);
                  const oreFerieVista = suoFerie.reduce((a, x) => a + x.ore, 0);
                  const ferie = r?.ferie ?? oreFerieVista;
                  const nonUsate = r && !r.riserva ? Math.max(0, r.contratto - fatte) : 0;
                  return (
                    <tr key={riga.id} className={riga.nuova ? 'bg-violet-50/40' : ''}>
                      <td className={`px-3 py-2 sticky left-0 z-10 border-b border-slate-100 ${riga.nuova ? 'bg-violet-50' : 'bg-white'}`}>
                        <span className={`block text-sm font-medium ${riga.nuova ? 'text-violet-900' : 'text-slate-900'}`}>{riga.nome}</span>
                        <span className="block text-[11px] text-slate-500">
                          {riga.nuova ? 'nuova, solo simulazione' : ''}{riga.nuova && r?.riserva ? ' · ' : ''}{r?.riserva ? 'a chiamata, solo dove serve' : ''}
                        </span>
                      </td>
                      {dateMese.map((d, i) => {
                        const t = riga.turni.find((x) => x.data === d);
                        const f = suoFerie.find((x) => x.data === d);
                        const gs = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
                        const fondo = `${gs >= 6 ? 'bg-slate-50/60' : ''} ${gs === 1 ? 'border-l border-l-slate-300' : ''}`;
                        let dentro: ReactNode;
                        if (t) {
                          const ore = oreLavorate({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti });
                          dentro = (
                            <span title={`${t.inizio}-${t.fine}, ${fmt(ore)} ore${t.pausa_minuti ? ` con ${t.pausa_minuti}' di pausa` : ''}`}
                              className={`block rounded-md px-1 py-1 leading-tight ${riga.nuova ? 'bg-violet-100 text-violet-900' : t.pubblicato ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-200'}`}>
                              <span className="block font-semibold tabular-nums">{t.inizio.replace(/:00$/, '')}–{t.fine.replace(/:00$/, '')}</span>
                              <span className="block text-[10px] opacity-80">{fmt(ore)} h</span>
                            </span>
                          );
                          if (f) dentro = <>{dentro}<span className="block mt-0.5 text-[10px] text-amber-800">{f.tipo === 'ore' ? `perm. ${fmt(f.ore)} h` : 'mezza ferie'}</span></>;
                        } else if (f) {
                          dentro = <span className="block rounded-md px-1 py-1.5 bg-amber-100 text-amber-900 font-medium">{f.tipo === 'giornata' ? 'ferie' : f.tipo === 'ore' ? `perm. ${fmt(f.ore)} h` : 'mezza ferie'}</span>;
                        } else if (riga.liberi.has(d)) {
                          dentro = <span className="block rounded-md px-1 py-1.5 bg-emerald-100 text-emerald-900 font-medium">libero</span>;
                        } else if (!riga.inServizio(i)) {
                          dentro = <span className="block rounded-md py-1.5 bg-slate-100 text-slate-400" title="Non in servizio in questo negozio">·</span>;
                        } else {
                          dentro = <span className="block py-1.5 text-slate-300">–</span>;
                        }
                        return <td key={d} className={`px-1 py-1.5 text-center border-b border-slate-100 ${fondo}`}>{dentro}</td>;
                      })}
                      <td className="px-3 py-2 text-right border-b border-slate-100 align-top">
                        <span className="block text-sm font-semibold text-slate-900 tabular-nums">{fmt(fatte)} h</span>
                        {r && !r.riserva && <span className="block text-[11px] text-slate-500">su {fmt(r.contratto + ferie)} h di contratto</span>}
                        {ferie > 0.25 && <span className="block text-[11px] text-amber-800">ferie e permessi {fmt(ferie)} h</span>}
                        {nonUsate > 0.25 && (
                          <span className="block text-[11px] text-slate-600"
                            title={(r?.settimanePiene ?? 0) > 0
                              ? 'In quelle settimane ha già il massimo di giorni di lavoro: le ore che restano non si possono mettere in un altro giorno.'
                              : 'Il fabbisogno di quei giorni era già coperto dagli altri.'}>
                            {fmt(nonUsate)} h non usate
                            <span className="block text-[10px] text-slate-500">
                              {(r?.settimanePiene ?? 0) > 0 ? `${r?.settimanePiene === 1 ? 'una settimana' : `${r?.settimanePiene} settimane`} con già ${giorniMax} giorni di lavoro` : 'non servivano al negozio'}
                            </span>
                          </span>
                        )}
                        {r && r.straordinario > 0.25 && <span className="block text-[11px] font-medium text-amber-800">{fmt(r.straordinario)} h di straordinario</span>}
                        {r?.riserva && fatte > 0 && <span className="block text-[11px] text-slate-500">chiamata per i buchi</span>}
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
