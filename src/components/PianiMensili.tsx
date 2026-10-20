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
import EditorTurno from './EditorTurno';
import { Modal } from './ui/Modal';
import { personaAllaData, nomePersona, oggiRoma } from '../lib/organico';
import { caricaDisponibilita, caricaGiorniFerie, caricaTraffico, puoLavorareIl, type DatiOrganico } from '../lib/organicoDati';
import {
  NOMI_GIORNO_BREVI, costruisciGiorni, regoleDaRiga, giorniDellaSettimana, lunediDi, oreLavorate, eventiDelNegozio, eventiDelGiorno,
  REGOLE_DEFAULT, type EventoNegozio, type RegoleTurni, type Turno,
} from '../lib/turni';
import {
  pianificaMese, proponiFerie, storicoTraffico, trafficoAtteso, tipoDelGiorno, ETICHETTE_REGOLA, NOMI_MESE,
  type EsitoPianoMese, type FeriaProposta, type PersonaPiano, type RegolaWeekend, type RigaTraffico,
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
type TurnoDb = { id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number; stato: string; origine: string; straordinario?: boolean };

const REGOLE: RegolaWeekend[] = ['sabato_o_domenica', 'solo_sabati', 'solo_domeniche', 'nessuno'];
// Nei turni contano le ferie approvate e anche quelle chieste e in attesa
// (Patrizio, 20/10/2026: «prendile in considerazione»): una richiesta
// respinta torna disponibile al ricalcolo, un giorno respinto no.
const STATI_FERIE_APPROVATE = ['inviata', 'approvata', 'approvata_parziale', 'chiusa'];
const GIORNI_FERIE_VALIDI = ['richiesto', 'approvato'];
const t5 = (t: string) => t.slice(0, 5);
const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 1 });

const NOMI_GIORNI_LUNGHI = ['', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
function testoGiorni(giorni: number[]): string {
  const g = [...giorni].sort();
  return g.length === 7 ? 'tutti i giorni' : g.map((x) => NOMI_GIORNI_LUNGHI[x]).join(', ').replace(/, ([^,]*)$/, ' e $1');
}

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
  // Giorni in cui ognuno puo' lavorare (employee_availability): valgono per piani e simulazioni.
  const [disponibilita, setDisponibilita] = useState<Map<string, number[]>>(new Map());
  const [dispAperta, setDispAperta] = useState(false);
  const [dispModifica, setDispModifica] = useState<Record<string, number[]>>({});
  // Modifica a mano di un turno dal calendario del mese (solo HR).
  const [editorMese, setEditorMese] = useState<{ employeeId: string; data: string; turno: TurnoDb | null } | null>(null);
  const [regolePiano, setRegolePiano] = useState<RegoleTurni>(REGOLE_DEFAULT);
  // Proposta di ferie per le ore di contratto che restano non usate.
  const [proposta, setProposta] = useState<{ employeeId: string; nome: string; ore: number; giorni: FeriaProposta[] } | null>(null);
  const [giorniApertura, setGiorniApertura] = useState<Map<string, { apre: number; chiude: number; chiuso: boolean }>>(new Map());

  const dateMese = useMemo(() => dateDelMese(mese), [mese]);

  const carica = useCallback(async () => {
    setCaricamento(true);
    const [p, hr, ch, disp] = await Promise.all([
      supabase.from('shift_plans').select('*').eq('company_id', companyId).eq('outlet_id', outletId).eq('mese', `${mese}-01`).order('created_at'),
      supabase.rpc('organico_e_hr'),
      supabase.rpc('turni_mese_chiuso', { p_company: companyId, p_data: `${mese}-01` }),
      caricaDisponibilita(companyId).catch(() => new Map<string, number[]>()),
    ]);
    setDisponibilita(disp);
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
        supabase.from('shifts').select('id, employee_id, data, inizio, fine, pausa_minuti, stato, origine, straordinario').eq('plan_id', aperto).neq('stato', 'annullato'),
        supabase.from('shift_plan_weekend_off').select('employee_id, data').eq('plan_id', aperto),
      ]);
      if (!vivo) return;
      // Prima i turni: devono comparire anche se le ferie tardano o non arrivano.
      setTurniPiano(((t.data as TurnoDb[]) ?? []).map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine) })));
      setLiberiPiano((l.data as { employee_id: string; data: string }[]) ?? []);
      // Ferie e permessi del mese (approvati o in attesa), per vederli nelle caselle.
      try {
        const fe = await caricaGiorniFerie(companyId, dateMese[0], dateMese[dateMese.length - 1]);
        const [rr, oo, sp] = await Promise.all([
          supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
          supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude').eq('outlet_id', outletId),
          supabase.from('outlet_special_days').select('data, chiuso, apre, chiude, persone_extra, nota').eq('outlet_id', outletId).gte('data', dateMese[0]).lte('data', dateMese[dateMese.length - 1]),
        ]);
        if (!vivo) return;
        setRegolePiano(regoleDaRiga(rr.data as Parameters<typeof regoleDaRiga>[0]));
        setGiorniApertura(new Map(costruisciGiorni(dateMese,
          (oo.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [], [],
          (sp.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [])
          .map((g) => [g.data, { apre: g.apre, chiude: g.chiude, chiuso: g.chiuso }])));
        setFerieMese(fe.filter((x) => STATI_FERIE_APPROVATE.includes(x.stato_richiesta) && GIORNI_FERIE_VALIDI.includes(x.stato_giorno)));
        setGiorniMax(Number((rr.data as { giorni_lavoro_max?: number } | null)?.giorni_lavoro_max ?? 6));
      } catch { setFerieMese([]); }
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
            // i giorni in cui non e' disponibile (es. Falchi: solo sabato e domenica)
            ...tutte.filter((d) => !puoLavorareIl(disponibilita, scheda.id, d)),
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
      // Anche la simulazione segue la regola di sempre (Patrizio, 20/10/2026):
      // fabbisogno dal traffico MODA e dalle persone che ci sono, mai da obiettivi.
      // Straordinari: la disponibilita' del singolo, vuoto = non ne fa.
      const straordinariPersona = new Map<string, number>([
        ...persone.map(({ scheda }) => [scheda.id, numero(ipotesi?.straord[scheda.id]) ?? 0] as [string, number]),
        ...(ipotesi?.nuove ?? []).map((n) => [n.id, numero(n.straord) ?? 0] as [string, number]),
      ]);
      const esito = pianificaMese({
        mese, giorni, persone: personePiano, regola, storicoWeekend, atteso, extra, senzaLiberi, regole,
        straordinariPersona: ipotesi ? straordinariPersona : undefined,
      });

      const riepilogo: Riepilogo = {
        oreScoperte: esito.oreScoperte,
        oreRiserva: esito.oreRiserva,
        straordinario: Object.values(esito.persone).reduce((a, p) => a + p.straordinario, 0),
        fonte: atteso.size ? `${propria ? 'traffico MODA del negozio' : 'forma media degli altri negozi (questo non ha storico)'}: ${[...fonti].join(', ')}` : 'nessun traffico: fabbisogno di «Orari e fabbisogno»',
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

  const salvaDisponibilita = async (employeeId: string, giorni: number[]) => {
    setLavoro(`disp-${employeeId}`);
    try {
      if (giorni.length === 7) {
        const { error } = await supabase.from('employee_availability').delete().eq('employee_id', employeeId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('employee_availability').upsert([{ employee_id: employeeId, company_id: companyId, giorni, updated_at: new Date().toISOString() }], { onConflict: 'employee_id' });
        if (error) throw error;
      }
      setDisponibilita((m) => { const n = new Map(m); if (giorni.length === 7) n.delete(employeeId); else n.set(employeeId, giorni); return n; });
      setDispModifica((x) => { const n = { ...x }; delete n[employeeId]; return n; });
      toast({ type: 'success', message: 'Disponibilità salvata: vale per i prossimi piani e le simulazioni.' });
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Disponibilità non salvata.' });
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
  const varianti = piani.filter((p) => !p.simulazione);
  // Mettere e togliere turni a mano dal calendario: la responsabile HR, a mese aperto.
  const puoModificare = eHr && puoScrivere && !chiuso;
  // Ore da lavorare dal vivo: contratto del mese meno le ferie e i permessi di
  // adesso (una proposta di ferie appena inviata abbassa subito le ore non usate).
  const daLavorareOra = (employeeId: string): number | null => {
    const r = pianoAperto?.riepilogo.persone?.[employeeId];
    if (!r || r.riserva) return null;
    if (r.ferie == null) return r.contratto;
    const ferieOra = ferieMese.filter((x) => x.employee_id === employeeId).reduce((a, x) => a + x.ore, 0);
    return Math.max(0, r.contratto + r.ferie - ferieOra);
  };

  const apriProposta = (employeeId: string, nome: string, oreSett: number | null, ore: number) => {
    if (!oreSett) return;
    const pers = persone.find((x) => x.scheda.id === employeeId);
    const giorni = proponiFerie({
      ore, oreSettimana: oreSett, date: dateMese,
      possibile: (d) => {
        const k = dateMese.indexOf(d);
        return !!pers && k >= 0 && pers.perGiorno[k].outletId === outletId && pers.perGiorno[k].stato === 'in_servizio'
          && puoLavorareIl(disponibilita, employeeId, d) && !(giorniApertura.get(d)?.chiuso ?? false)
          && !turniPiano.some((x) => x.employee_id === employeeId && x.data === d)
          && !liberiPiano.some((x) => x.employee_id === employeeId && x.data === d)
          && !ferieMese.some((x) => x.employee_id === employeeId && x.data === d);
      },
    });
    if (!giorni.length) { toast({ type: 'warning', message: `Per ${nome} non ci sono giorni feriali liberi in cui proporre ferie: aggiungi le ore nel calendario.` }); return; }
    setProposta({ employeeId, nome, ore, giorni });
  };

  const inviaProposta = async () => {
    if (!proposta) return;
    setLavoro('proposta');
    try {
      const { data: u } = await supabase.auth.getUser();
      const negozio = dati.negozi.find((n) => n.id === outletId);
      const { data, error } = await supabase.from('leave_requests').insert({
        company_id: companyId, employee_id: proposta.employeeId, outlet_code: negozio?.code ?? null,
        stato: 'inviata', origine: 'gestionale', titolo: 'Proposta dal piano del mese',
        note_dipendente: `Ore di contratto non usate nel piano di ${NOMI_MESE[Number(mese.slice(5))]} ${mese.slice(0, 4)}: ${fmt(proposta.ore)} h. Proposta della responsabile HR, da concordare con la dipendente prima di approvarla.`,
        compilata_da: u.user?.id ?? null, inviata_il: new Date().toISOString(),
      }).select('id').single();
      if (error) throw error;
      const requestId = (data as { id: string }).id;
      const { error: e2 } = await supabase.from('leave_request_days').insert(proposta.giorni.map((g) => ({
        company_id: companyId, request_id: requestId, data: g.data, voce: g.voce, tipo: g.tipo, ore: g.ore,
        nota: 'Proposta dal piano del mese',
      })));
      if (e2) throw e2;
      toast({ type: 'success', message: `Proposta inviata per ${proposta.nome}: la trovi in Approvazioni ferie, da approvare dopo averne parlato con lei.` });
      setProposta(null);
      setVersione((v) => v + 1);
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Proposta non inviata.' });
    } finally {
      setLavoro(null);
    }
  };
  const pianoScelto = varianti.find((p) => p.stato === 'scelto') ?? null;
  const regoleMancanti = REGOLE.filter((r) => !varianti.some((p) => p.regola_weekend === r));
  const minimoScoperte = Math.min(...varianti.map((p) => p.riepilogo.oreScoperte ?? 0));
  // Le quattro varianti in un colpo solo, una alla volta: solo quelle che mancano.
  const creaVarianti = async () => { for (const r of regoleMancanti) await creaPiano(r); };
  const bozzeAperto = turniPiano.filter((t) => t.stato === 'bozza').length;

  return (
    <div className="space-y-5">
      {/* Testata: mese, stato del mese e le due azioni. */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50">
            <button type="button" aria-label="Mese prima" onClick={() => setMese((m) => meseSuccessivo(m, -1))} className="p-2 rounded-l-lg hover:bg-white"><ChevronLeft size={16} /></button>
            <span className="px-2 text-sm font-semibold text-slate-800 min-w-[120px] text-center capitalize">{NOMI_MESE[Number(mese.slice(5))]} {mese.slice(0, 4)}</span>
            <button type="button" aria-label="Mese dopo" onClick={() => setMese((m) => meseSuccessivo(m, 1))} className="p-2 rounded-r-lg hover:bg-white"><ChevronRight size={16} /></button>
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900 leading-tight">Turni di {nomeNegozio.charAt(0) + nomeNegozio.slice(1).toLowerCase()}</h2>
            <p className="text-sm text-slate-500">
              {chiuso ? 'Mese chiuso: sono arrivati i cedolini, il piano resta com\'era per la riprova.'
                : pianoScelto ? `Vale il piano «${ETICHETTE_REGOLA[pianoScelto.regola_weekend]}»${pianoScelto.scelto_da_nome ? `, scelto da ${pianoScelto.scelto_da_nome}` : ''}.`
                  : varianti.length ? `${varianti.length === 1 ? 'Una variante' : `${varianti.length} varianti`} da confrontare: ${eHr ? 'scegli tu quella che vale' : 'quella che vale la sceglie la responsabile HR'}.`
                    : 'Ancora nessun piano per questo mese.'}
            </p>
          </div>
        </div>
        {chiuso ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-slate-600 px-3 py-2 rounded-lg bg-slate-100"><Lock size={14} /> Mese chiuso</span>
        ) : puoScrivere && (
          <div className="flex flex-wrap gap-2">
            {regoleMancanti.length > 0 && (
              <button type="button" onClick={creaVarianti} disabled={!!lavoro}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
                <Plus size={15} /> {lavoro && lavoro !== 'simulazione' && !lavoro.startsWith('disp-') ? 'Calcolo le varianti…' : varianti.length ? `Crea le varianti mancanti (${regoleMancanti.length})` : 'Crea le varianti del mese'}
              </button>
            )}
            <button type="button" onClick={() => setSim(sim ? null : {
              ore: {}, straord: {}, perTutti: '', nuove: [],
              soloWeekend: Object.fromEntries(persone.map(({ scheda }) => [scheda.id, (disponibilita.get(scheda.id) ?? []).join(',') === '6,7'])),
            })} disabled={!!lavoro}
              className={`inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border font-semibold disabled:opacity-50 ${sim ? 'bg-violet-600 border-violet-600 text-white' : 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100'}`}>
              <FlaskConical size={15} /> {sim ? 'Chiudi la simulazione' : 'Simulazione'}
            </button>
          </div>
        )}
      </section>

      {/* Chi lavora nel mese, con ore e giorni in cui può lavorare. */}
      <section className="bg-white border border-slate-200 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
          <h3 className="text-sm font-semibold text-slate-800">Chi lavora a {NOMI_MESE[Number(mese.slice(5))]}</h3>
          {puoScrivere && (
            <button type="button" onClick={() => setDispAperta((v) => !v)} className="text-xs font-semibold text-blue-700 hover:underline">
              {dispAperta ? 'Fatto' : 'Cambia i giorni in cui possono lavorare'}
            </button>
          )}
        </div>
        {!dispAperta ? (
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {persone.map(({ scheda, perGiorno }) => {
              const ore = oreOggi(perGiorno);
              const g = disponibilita.get(scheda.id);
              return (
                <span key={scheda.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 pl-3 pr-2 py-1 text-sm">
                  <span className="font-medium text-slate-800">{nomePersona(scheda)}</span>
                  <span className="text-xs text-slate-500">{ore == null ? 'a chiamata' : `${fmt(ore)} h/sett.`}</span>
                  {g && <span className="text-[11px] font-semibold rounded-full bg-amber-100 text-amber-900 px-2 py-0.5">solo {testoGiorni(g)}</span>}
                </span>
              );
            })}
            {!persone.length && <span className="text-sm text-slate-400">Nessuno in servizio in questo negozio nel mese.</span>}
          </div>
        ) : (
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs text-slate-500">Nei giorni spenti la persona non riceve turni: vale per il piano del mese, il piano settimanale e le simulazioni. Il contratto non cambia.</p>
            {persone.map(({ scheda }) => {
              const salvati = disponibilita.get(scheda.id) ?? [1, 2, 3, 4, 5, 6, 7];
              const correnti = dispModifica[scheda.id] ?? salvati;
              const cambiato = correnti.slice().sort().join() !== salvati.slice().sort().join();
              return (
                <div key={scheda.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-44 font-medium text-slate-800">{nomePersona(scheda)}</span>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5, 6, 7].map((g) => {
                      const on = correnti.includes(g);
                      return (
                        <button key={g} type="button" disabled={!puoScrivere} aria-pressed={on} aria-label={`${nomePersona(scheda)} ${NOMI_GIORNI_LUNGHI[g]}`}
                          onClick={() => setDispModifica((x) => ({ ...x, [scheda.id]: on ? correnti.filter((y) => y !== g) : [...correnti, g].sort() }))}
                          className={`w-10 py-1.5 rounded-md text-xs font-semibold border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-400'} disabled:opacity-60`}>
                          {NOMI_GIORNO_BREVI[g]}
                        </button>
                      );
                    })}
                  </div>
                  {cambiato && (
                    <button type="button" disabled={!!lavoro || correnti.length === 0} onClick={() => salvaDisponibilita(scheda.id, correnti)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
                      {correnti.length === 0 ? 'Almeno un giorno' : 'Salva'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {sim && puoScrivere && !chiuso && (
        <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-violet-900 flex items-center gap-1.5"><FlaskConical size={15} /> Simulazione per {nomeNegozio}</h3>
            <p className="text-xs text-slate-600">Scrivi le ore a settimana che vuoi provare (vuoto = come oggi) e, per ognuno, quante ore di straordinario può fare a settimana (vuoto = non ne fa). Puoi aggiungere persone nuove, che esistono solo nella simulazione. L'organico non cambia. Come i piani veri, la simulazione distribuisce le ore di chi c'è (con le ore che scrivi qui) come gli ingressi MODA del negozio, sempre almeno una persona, con le stesse regole: turno minimo di 4 ore, pause, giorni di lavoro, sabati e domeniche liberi. Si confronta con gli altri piani, ma non si sceglie né si pubblica.</p>
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
                      <td className="pr-4 py-1 font-medium text-slate-800">{nomePersona(scheda)}
                        {disponibilita.get(scheda.id) && <span className="block text-[11px] font-normal text-slate-500">lavora solo {testoGiorni(disponibilita.get(scheda.id)!)}</span>}
                      </td>
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

      {caricamento ? <div className="text-slate-400 py-6 text-center">Caricamento…</div> : !piani.length ? (
        <section className="bg-white border border-dashed border-slate-300 rounded-xl px-6 py-10 text-center">
          <CalendarDays size={28} className="mx-auto text-slate-400" />
          <h3 className="mt-2 text-base font-semibold text-slate-800">Nessun piano per {NOMI_MESE[Number(mese.slice(5))]}</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-xl mx-auto">
            «Crea le varianti del mese» prepara quattro piani, uno per ogni regola dei sabati e delle domeniche liberi, sul traffico MODA di {nomeNegozio.charAt(0) + nomeNegozio.slice(1).toLowerCase()} e sulle ore di chi lavora. Poi si confrontano qui e la responsabile HR sceglie quello che vale.
          </p>
        </section>
      ) : (
        <section>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {piani.map((p) => {
              const pp = Object.values(p.riepilogo.persone ?? {}).filter((x) => !x.riserva);
              const liberi = pp.map((x) => x.weekendLiberi);
              const scoperte = p.riepilogo.oreScoperte ?? 0;
              const migliore = !p.simulazione && varianti.length > 1 && scoperte <= minimoScoperte + 1e-9;
              const selezionato = aperto === p.id;
              return (
                <div key={p.id} role="button" tabIndex={0} onClick={() => setAperto(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') setAperto(p.id); }}
                  className={`relative cursor-pointer rounded-xl border bg-white p-4 transition-shadow hover:shadow-md ${selezionato ? 'ring-2 ring-blue-600 border-blue-600' : p.stato === 'scelto' ? 'border-emerald-400' : p.simulazione ? 'border-violet-300' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${p.stato === 'scelto' ? 'bg-emerald-100 text-emerald-800' : p.simulazione ? 'bg-violet-100 text-violet-800' : 'bg-slate-100 text-slate-600'}`}>
                      {p.stato === 'scelto' ? 'Vale questo' : p.simulazione ? 'Simulazione' : 'Bozza'}
                    </span>
                    {migliore && <span className="text-[11px] font-semibold text-blue-700">meno ore scoperte</span>}
                  </div>
                  <h4 className="mt-2 text-sm font-semibold text-slate-900 leading-snug first-letter:uppercase">{ETICHETTE_REGOLA[p.regola_weekend]}</h4>
                  {p.simulazione && p.riepilogo.ipotesi && (
                    <p className="text-xs text-violet-700 mt-0.5 line-clamp-2">
                      {[...p.riepilogo.ipotesi.persone.filter((x) => x.ipotesi != null).map((x) => `${x.nome.split(' ')[0]} ${fmt(x.ipotesi!)} h`),
                        ...(p.riepilogo.ipotesi.nuove ?? []).map((n) => `+ ${n.nome}`)].join(' · ') || 'ore di oggi'}
                    </p>
                  )}
                  <p className={`mt-3 text-2xl font-semibold tabular-nums ${scoperte > 0.25 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {scoperte > 0.25 ? `${fmt(scoperte)} h` : 'Coperto'}
                    <span className="ml-1 text-xs font-normal text-slate-500">{scoperte > 0.25 ? 'scoperte nel mese' : 'tutto il mese'}</span>
                  </p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><dt className="text-slate-500">A chiamata</dt><dd className="font-semibold text-slate-800 tabular-nums">{fmt(p.riepilogo.oreRiserva)} h</dd></div>
                    <div><dt className="text-slate-500">Straordinari</dt><dd className="font-semibold text-slate-800 tabular-nums">{fmt(p.riepilogo.straordinario)} h</dd></div>
                    <div><dt className="text-slate-500">Weekend liberi</dt><dd className="font-semibold text-slate-800">{liberi.length ? (Math.min(...liberi) === Math.max(...liberi) ? `${Math.min(...liberi)} a testa` : `${Math.min(...liberi)}-${Math.max(...liberi)} a testa`) : '-'}</dd></div>
                  </dl>
                  <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {eHr && p.stato !== 'scelto' && !p.simulazione && !chiuso && (
                      <button type="button" onClick={() => scegli(p.id)} disabled={!!lavoro} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">Scegli questo</button>
                    )}
                    <span className="text-xs text-slate-500">{selezionato ? 'aperto sotto' : 'clicca per aprirlo'}</span>
                    {puoScrivere && p.stato === 'bozza' && !chiuso && (
                      <button type="button" aria-label="Togli la bozza" title="Togli" onClick={() => togli(p)} disabled={!!lavoro} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">Come si calcola il piano</summary>
        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1 text-xs">
          <p>Le ore di contratto di chi lavora nel negozio, meno ferie e permessi, si distribuiscono come gli ingressi registrati da MODA: più persone quando entra più gente, sempre almeno una. I giorni speciali (festivi, Black Friday, settimane di Natale) si riconoscono dal calendario; gli eventi del negozio si aggiungono dalla scheda «Eventi».</p>
          <p>Ogni turno dura almeno 4 ore (si cambia solo nelle regole del negozio), con la pausa di 30 minuti da 6 ore; al massimo 6 giorni su 7. Chi è a chiamata copre solo i buchi che restano, nei giorni in cui può lavorare.</p>
        </div>
      </details>

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
          {(() => {
            // Le righe del piano: persone del negozio, poi le persone nuove della simulazione.
            const righe = [
              ...persone.map(({ scheda, perGiorno }) => ({
                id: scheda.id, nome: nomePersona(scheda), nuova: false,
                oreSett: oreOggi(perGiorno) as number | null,
                inServizio: (d: string) => { const k = dateMese.indexOf(d); return k >= 0 && perGiorno[k].outletId === outletId && perGiorno[k].stato === 'in_servizio'; },
                turni: turniPiano.filter((x) => x.employee_id === scheda.id).map((x) => ({ ...x, pubblicato: x.stato === 'pubblicato' })),
                liberi: new Set(liberiPiano.filter((x) => x.employee_id === scheda.id).map((x) => x.data)),
              })),
              ...(pianoAperto.riepilogo.ipotesi?.nuove ?? []).map((n) => ({
                id: n.id, nome: n.nome, nuova: true, oreSett: n.ore,
                inServizio: (d: string) => d >= n.dal && dateMese.includes(d),
                turni: (pianoAperto.riepilogo.turniNuove ?? []).filter((x) => x.employee_id === n.id).map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine), pubblicato: false })),
                liberi: new Set((pianoAperto.riepilogo.liberiNuove ?? []).filter((x) => x.employee_id === n.id).map((x) => x.data)),
              })),
            ];
            const ipot = pianoAperto.riepilogo.ipotesi?.persone;
            const oreDi = (t: { inizio: string; fine: string; pausa_minuti: number }) => oreLavorate({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti });
            const giornoCorto = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
            const settimane = [...new Set(dateMese.map(lunediDi))];
            // Si apre solo dove la persona puo' lavorare: in servizio, negozio aperto,
            // giorno disponibile e non in ferie per la giornata intera.
            const modificabile = (riga: (typeof righe)[number], d: string) => puoModificare && !riga.nuova && dateMese.includes(d)
              && riga.inServizio(d) && !(giorniApertura.get(d)?.chiuso ?? false)
              && puoLavorareIl(disponibilita, riga.id, d)
              && !ferieMese.some((x) => x.employee_id === riga.id && x.data === d && x.tipo === 'giornata');
            const apriEditor = (riga: (typeof righe)[number], d: string) => {
              const t = turniPiano.find((x) => x.employee_id === riga.id && x.data === d) ?? null;
              setEditorMese({ employeeId: riga.id, data: d, turno: t });
            };
            const casellaCliccabile = (riga: (typeof righe)[number], d: string): ReactNode => {
              const dentro = casella(riga, d);
              if (!modificabile(riga, d)) return dentro;
              const vuota = !riga.turni.some((x) => x.data === d);
              return (
                <button type="button" onClick={() => apriEditor(riga, d)} title={vuota ? 'Aggiungi un turno' : 'Modifica il turno'}
                  className="group block w-full rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {vuota && !riga.liberi.has(d) && !ferieMese.some((x) => x.employee_id === riga.id && x.data === d)
                    ? <span className="block py-1.5 rounded-md text-slate-300 group-hover:bg-blue-50 group-hover:text-blue-600">+</span> : dentro}
                </button>
              );
            };
            const casella = (riga: (typeof righe)[number], d: string): ReactNode => {
              if (!dateMese.includes(d)) return <span className="block py-1.5 text-slate-200">·</span>;
              const t = riga.turni.find((x) => x.data === d);
              const f = ferieMese.find((x) => x.employee_id === riga.id && x.data === d);
              const fTesto = f ? (f.tipo === 'giornata' ? 'ferie' : f.tipo === 'ore' ? `permesso ${fmt(f.ore)} h` : 'mezza giornata di ferie') : '';
              if (t) {
                const ore = oreDi(t);
                return (
                  <>
                    <span title={`${t.inizio}-${t.fine}, ${fmt(ore)} ore${t.pausa_minuti ? ` con ${t.pausa_minuti}' di pausa` : ''}`}
                      className={`block rounded-md px-1 py-1 leading-tight ${riga.nuova ? 'bg-violet-100 text-violet-900' : 'straordinario' in t && t.straordinario ? 'bg-amber-100 text-amber-950 ring-1 ring-inset ring-amber-400' : t.pubblicato ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-200'}`}>
                      <span className="block font-semibold tabular-nums">{t.inizio.replace(/:00$/, '')}–{t.fine.replace(/:00$/, '')}</span>
                      <span className="block text-[10px] opacity-80">{fmt(ore)} h{'straordinario' in t && t.straordinario ? ' · straord.' : ''}</span>
                    </span>
                    {f && <span className="block mt-0.5 text-[10px] text-amber-800">{fTesto}</span>}
                  </>
                );
              }
              if (f) return <span className="block rounded-md px-1 py-1.5 bg-amber-100 text-amber-900 font-medium">{fTesto}</span>;
              if (riga.liberi.has(d)) return <span className="block rounded-md px-1 py-1.5 bg-emerald-100 text-emerald-900 font-medium">libero</span>;
              if (!riga.inServizio(d)) return <span className="block rounded-md py-1.5 bg-slate-100 text-slate-400" title="Non in servizio in questo negozio">non in servizio</span>;
              if (!riga.nuova && !puoLavorareIl(disponibilita, riga.id, d)) return <span className="block py-1.5 text-[10px] text-slate-400">non disponibile</span>;
              return <span className="block py-1.5 text-slate-300">–</span>;
            };
            return (
              <>
                {/* Il mese settimana per settimana, una sotto l'altra. */}
                <div className="p-4 space-y-5">
                  {settimane.map((lun) => {
                    const giorniSett = giorniDellaSettimana(lun);
                    const nelMese = giorniSett.filter((d) => dateMese.includes(d));
                    return (
                      <div key={lun}>
                        <h4 className="text-sm font-semibold text-slate-700 mb-1.5">
                          Settimana dal {giornoCorto(nelMese[0])} al {giornoCorto(nelMese[nelMese.length - 1])}
                        </h4>
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full text-xs border-separate border-spacing-0">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="px-3 py-2 text-left bg-slate-50 border-b border-slate-200 font-semibold w-[170px] min-w-[150px]">Persona</th>
                                {giorniSett.map((d) => {
                                  const gs = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
                                  const t = tipoDelGiorno(d);
                                  const speciale = dateMese.includes(d) && !['feriale', 'venerdi', 'sabato', 'domenica'].includes(t.tipo);
                                  return (
                                    <th key={d} title={t.nome ?? undefined} className={`px-1 py-2 text-center border-b border-slate-200 min-w-[78px] font-medium ${gs >= 6 ? 'bg-slate-100' : 'bg-slate-50'} ${dateMese.includes(d) ? '' : 'opacity-40'}`}>
                                      <span className="block text-[10px] uppercase tracking-wide">{NOMI_GIORNO_BREVI[gs]}</span>
                                      <span className="block text-sm font-semibold text-slate-800">{Number(d.slice(8))}</span>
                                      {speciale && <span className="block text-[10px] font-semibold text-red-700 truncate">{t.nome}</span>}
                                    </th>
                                  );
                                })}
                                <th className="px-3 py-2 text-right bg-slate-50 border-b border-slate-200 font-semibold min-w-[90px]">Ore settimana</th>
                              </tr>
                            </thead>
                            <tbody>
                              {righe.map((riga) => {
                                const oreSett = riga.turni.filter((x) => nelMese.includes(x.data)).reduce((a, x) => a + oreDi(x), 0);
                                const quota = riga.oreSett != null ? riga.oreSett * nelMese.length / 7 : null;
                                return (
                                  <tr key={riga.id} className={riga.nuova ? 'bg-violet-50/40' : ''}>
                                    <td className={`px-3 py-1.5 border-b border-slate-100 ${riga.nuova ? 'text-violet-900' : 'text-slate-900'} font-medium`}>
                                      {riga.nome}
                                      {riga.nuova && <span className="block text-[10px] font-normal text-violet-700">nuova, solo simulazione</span>}
                                    </td>
                                    {giorniSett.map((d) => {
                                      const gs = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
                                      return <td key={d} className={`px-1 py-1.5 text-center border-b border-slate-100 ${gs >= 6 ? 'bg-slate-50/60' : ''}`}>{casellaCliccabile(riga, d)}</td>;
                                    })}
                                    <td className="px-3 py-1.5 text-right border-b border-slate-100 tabular-nums">
                                      <span className="font-semibold text-slate-900">{fmt(oreSett)} h</span>
                                      {quota != null && <span className="block text-[10px] text-slate-500">contratto {fmt(quota)} h</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Il conto delle ore del mese, persona per persona. */}
                <div className="px-4 pb-4">
                  <h4 className="text-sm font-semibold text-slate-800">Ore del mese, persona per persona</h4>
                  <p className="text-xs text-slate-500 mb-2">
                    <b>Contratto nel mese</b> = ore a settimana × giorni del mese ÷ 7. <b>Da lavorare</b> = contratto meno ferie e permessi.
                    <b> Pianificate</b> = ore dei turni di questo piano. La differenza è straordinario (se sono di più) oppure ore non usate (se sono di meno), con il motivo.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                          <th className="px-3 py-2">Persona</th>
                          <th className="px-3 py-2 text-right">Ore a settimana</th>
                          <th className="px-3 py-2 text-right">Contratto nel mese</th>
                          <th className="px-3 py-2">Ferie e permessi</th>
                          <th className="px-3 py-2 text-right">Da lavorare</th>
                          <th className="px-3 py-2 text-right">Pianificate</th>
                          <th className="px-3 py-2">Differenza</th>
                        </tr>
                      </thead>
                      <tbody>
                        {righe.map((riga) => {
                          const r = pianoAperto.riepilogo.persone?.[riga.id];
                          const fatte = riga.turni.reduce((a, x) => a + oreDi(x), 0);
                          const segnate = riga.turni.filter((x) => 'straordinario' in x && x.straordinario).reduce((a, x) => a + oreDi(x), 0);
                          const ordinarie = fatte - segnate;
                          const suoFerie = ferieMese.filter((x) => x.employee_id === riga.id).sort((a, b) => a.data.localeCompare(b.data));
                          const oreFerie = suoFerie.reduce((a, x) => a + x.ore, 0);
                          const daLavorare = riga.nuova ? (r && !r.riserva ? r.contratto : null) : daLavorareOra(riga.id);
                          const ipo = ipot?.find((x) => x.nome === riga.nome);
                          const giorniFerie = suoFerie.filter((x) => x.tipo !== 'ore');
                          const permessi = suoFerie.filter((x) => x.tipo === 'ore');
                          // Le ore ordinarie coprono il contratto; quelle segnate straordinario si contano a parte.
                          const nonUsate = daLavorare != null ? Math.max(0, daLavorare - ordinarie) : 0;
                          const straordTot = segnate + (daLavorare != null ? Math.max(0, ordinarie - daLavorare) : 0);
                          return (
                            <tr key={riga.id} className={`border-b border-slate-100 align-top ${riga.nuova ? 'bg-violet-50/40' : ''}`}>
                              <td className="px-3 py-2 font-medium text-slate-900">{riga.nome}
                                {r?.riserva && <span className="block text-xs font-normal text-slate-500">a chiamata: solo dove manca qualcuno</span>}
                                {ipo?.ipotesi != null && <span className="block text-xs font-normal text-violet-700">simulazione: {fmt(ipo.ipotesi)} h invece di {ipo.oggi == null ? 'a chiamata' : `${fmt(ipo.oggi)} h`}</span>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{riga.oreSett == null ? '–' : `${fmt(ipo?.ipotesi ?? riga.oreSett)} h`}</td>
                              <td className="px-3 py-2 text-right tabular-nums">{daLavorare != null ? `${fmt(daLavorare + (riga.nuova ? 0 : oreFerie))} h` : '–'}</td>
                              <td className="px-3 py-2 text-xs text-slate-700">
                                {oreFerie > 0.25 ? (
                                  <>
                                    <span className="font-semibold text-amber-800">{fmt(oreFerie)} h</span>
                                    {giorniFerie.length > 0 && <span className="block">ferie: {giorniFerie.map((x) => giornoCorto(x.data)).join(', ')}</span>}
                                    {permessi.length > 0 && <span className="block">permessi: {permessi.map((x) => `${giornoCorto(x.data)} (${fmt(x.ore)} h)`).join(', ')}</span>}
                                  </>
                                ) : <span className="text-slate-400">nessuna</span>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{daLavorare != null ? `${fmt(daLavorare)} h` : '–'}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <span className="font-semibold">{fmt(fatte)} h</span>
                                {segnate > 0.25 && <span className="block text-xs text-amber-800">di cui {fmt(segnate)} h straord.</span>}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {daLavorare == null ? (fatte > 0 ? <span className="text-slate-600">chiamata per i buchi</span> : <span className="text-slate-400">non chiamata</span>) : (
                                  <>
                                    {nonUsate > 0.25 ? (
                                      <span className="block text-slate-700"><b>{fmt(nonUsate)} h non usate</b>
                                        <span className="block text-slate-500">{(r?.settimanePiene ?? 0) > 0
                                          ? `in ${r?.settimanePiene === 1 ? 'una settimana ha' : `${r?.settimanePiene} settimane ha`} già ${giorniMax} giorni di lavoro: le ore che restano non entrano in un altro giorno`
                                          : 'al negozio non servivano: il traffico di quei giorni era già coperto'}</span>
                                        {puoModificare && !pianoAperto.simulazione && !riga.nuova && nonUsate >= 1 && (
                                          <button type="button" onClick={() => apriProposta(riga.id, riga.nome, riga.oreSett, nonUsate)}
                                            className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200">
                                            Proponi ferie per {fmt(nonUsate)} h
                                          </button>
                                        )}
                                        {puoModificare && <span className="block mt-1 text-blue-700">oppure clicca una casella del calendario per aggiungere ore</span>}
                                      </span>
                                    ) : <span className="block text-emerald-700 font-medium">tutte le ore di contratto usate</span>}
                                    {straordTot > 0.25 && <span className="block mt-1 font-semibold text-amber-800">+{fmt(straordTot)} h di straordinario</span>}
                                  </>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}
          <p className="px-4 py-2 text-xs text-slate-500">Il dettaglio della settimana, con le pause e la copertura ora per ora, è nel «Piano settimanale»: per i mesi con un piano scelto mostra i turni di quel piano.</p>
        </section>
      )}
      {proposta && (
        <Modal open onClose={() => setProposta(null)} title={`Ferie proposte a ${proposta.nome}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Nel piano restano <b>{fmt(proposta.ore)} ore di contratto non usate</b>. Invece di pagarle senza lavoro, si propongono come ferie nei feriali in cui non lavora:
              giornate intere di ferie e, per il resto, un permesso a ore.
            </p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {proposta.giorni.map((g) => (
                <li key={g.data} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="font-medium text-slate-800 capitalize">{new Date(`${g.data}T00:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</span>
                  <span className="text-slate-600">{g.tipo === 'giornata' ? 'ferie, giornata intera' : 'permesso'} · <b className="tabular-nums">{fmt(g.ore)} h</b></span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Diventa una richiesta di ferie «in attesa»: si approva o si respinge in Approvazioni ferie, dopo averne parlato con la dipendente. Le ore escono dal suo saldo solo se approvata.</p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setProposta(null)} className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm">Annulla</button>
              <button type="button" onClick={inviaProposta} disabled={lavoro === 'proposta'} className="min-h-[40px] px-4 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">
                {lavoro === 'proposta' ? 'Invio…' : 'Invia la proposta'}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {editorMese && pianoAperto && (() => {
        const altri = turniPiano.filter((x) => x.employee_id === editorMese.employeeId && x.id !== editorMese.turno?.id);
        const ore = (x: TurnoDb) => oreLavorate({ inizio: x.inizio, fine: x.fine, pausaMinuti: x.pausa_minuti });
        const g = giorniApertura.get(editorMese.data);
        return (
          <EditorTurno
            companyId={companyId} outletId={outletId} employeeId={editorMese.employeeId} data={editorMese.data} turno={editorMese.turno}
            planId={pianoAperto.id}
            nome={nomePersona(dati.schede.find((x) => x.id === editorMese.employeeId) ?? { nome: '', cognome: '' })}
            apre={g?.apre ?? 600} chiude={g?.chiude ?? 1200} regole={regolePiano}
            conto={{
              daLavorare: daLavorareOra(editorMese.employeeId),
              ordinarieAltri: altri.filter((x) => !x.straordinario).reduce((a, x) => a + ore(x), 0),
              straordinarioAltri: altri.filter((x) => x.straordinario).reduce((a, x) => a + ore(x), 0),
            }}
            onClose={() => setEditorMese(null)}
            onSalvato={() => { setEditorMese(null); setVersione((v) => v + 1); toast({ type: 'success', message: 'Turno salvato: il riepilogo delle ore è aggiornato.' }); }}
          />
        );
      })()}
    </div>
  );
}
