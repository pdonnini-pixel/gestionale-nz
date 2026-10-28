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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FlaskConical, Lock, Plus, Send, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import EditorTurno from './EditorTurno';
import { Modal } from './ui/Modal';
import { personaAllaData, nomePersona, oggiRoma } from '../lib/organico';
import { caricaDisponibilita, caricaGiorniFerie, caricaTraffico, puoLavorareIl, type DatiOrganico } from '../lib/organicoDati';
import { fasceDelle, testoAccordo, type Accordo } from '../lib/accordiOrario';
import { caricaTrasferte, copertureVerso, doveTrasferta, orePerData, oreTrasferta, type Trasferta } from '../lib/trasferte';
import {
  NOMI_GIORNO_BREVI, costruisciGiorni, regoleDaRiga, giorniDellaSettimana, lunediDi, oreLavorate, eventiDelNegozio, eventiDelGiorno,
  REGOLE_DEFAULT, minuti, type EventoNegozio, type GiornoPiano, type RegoleTurni, type Turno,
} from '../lib/turni';
import {
  pianificaMese, proponiFerie, oreFerieGiorno, suggerisciFinestre, storicoTraffico, trafficoAtteso, tipoDelGiorno, ETICHETTE_REGOLA, NOMI_MESE,
  type EsitoPianoMese, type SettimanaPiano, type FeriaProposta, type FinestraSuggerita, type PersonaPiano, type RegolaWeekend, type RigaTraffico,
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
  /** il mese settimana per settimana (piani calcolati dal 28/10/2026) */
  settimane?: SettimanaPiano[];
  /** calendario senza ferie e permessi: l'organico pieno, le ferie si inseriscono dopo dal calendario */
  senzaFerie?: boolean;
  ipotesi?: {
    persone: { nome: string; oggi: number | null; ipotesi: number | null; soloWeekend: boolean; straordinari?: number }[];
    /** solo nelle prime simulazioni: un tetto uguale per tutti */
    straordinariSettimana?: number;
    nuove?: { id: string; nome: string; ore: number | null; soloWeekend: boolean; dal: string; straordinari?: number }[];
    /** ferie tolte per prova nella simulazione */
    ferieTolte?: { nome: string; data: string }[];
  };
  /** per ogni giorno del mese: apertura e persone che MODA chiede in ogni mezz'ora (senza tetto) */
  bisogno?: Record<string, { apre: number; chiude: number; esigenza: number[] }>;
  /** turni e liberi delle persone nuove di una simulazione (non hanno una scheda) */
  turniNuove?: { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number }[];
  liberiNuove?: { employee_id: string; data: string }[];
};
/** Persona nuova ipotetica: vive solo nella simulazione. */
type NuovaPersona = { id: string; nome: string; ore: string; soloWeekend: boolean; dal: string; straord: string };
/** Le ipotesi di una simulazione: ore per persona (vuoto = come oggi), solo weekend, straordinari ammessi. */
/** `straord`: ore di straordinario che la persona puo' fare a settimana (vuoto = non ne fa). */
type Simulazione = {
  ore: Record<string, string>; soloWeekend: Record<string, boolean>; straord: Record<string, string>; perTutti: string; nuove: NuovaPersona[];
  /** ferie tolte per prova (chiavi «persona|data»): la richiesta vera non cambia */
  ferieTolte?: string[];
};
type GiornoFerie = { employee_id: string; data: string; ore: number; tipo: string; stato_richiesta: string; stato_giorno: string };
/** I dati del mese per calcolare un piano, caricati una volta. */
type BaseMese = {
  tutte: string[]; giorni: GiornoPiano[]; regole: RegoleTurni; atteso: Map<string, number[]>; extra: Map<string, number>;
  senzaLiberi: Set<string>; saldi: Map<string, number>; storicoWeekend: Map<string, number>; ferie: GiornoFerie[]; fonte: string;
  /** ore dei turni veri nei giorni dell'altro mese delle settimane a cavallo, per persona e data */
  oreFuoriMese: Map<string, Map<string, number>>;
};
const ID_NUOVA = 'nuova-';
type TurnoDb = { id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number; stato: string; origine: string; straordinario?: boolean; ore_straordinario?: number };

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
  // Prima della data di apertura il negozio e' chiuso: nessun turno.
  const apertura = dati.negozi.find((n) => n.id === outletId)?.opening_date ?? null;
  const nomeNegozioDi = (id: string) => { const n = dati.negozi.find((x) => x.id === id); return n ? (n.name ?? n.code ?? 'negozio') : 'altro negozio'; };
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
  const [ferieRegistrate, setFerieMese] = useState<{ employee_id: string; data: string; ore: number; tipo: string; creato_il: string; id: string; request_id: string; stato_richiesta: string }[]>([]);
  const [giorniMax, setGiorniMax] = useState(6);
  // Giorni in cui ognuno puo' lavorare (employee_availability): valgono per piani e simulazioni.
  const [disponibilita, setDisponibilita] = useState<Map<string, Accordo>>(new Map());
  // Trasferte delle settimane del mese (tutta l'azienda): lavoro fuori dal negozio.
  const [trasferte, setTrasferte] = useState<Trasferta[]>([]);
  // Modifica a mano di un turno dal calendario del mese (solo HR).
  const [editorMese, setEditorMese] = useState<{ employeeId: string; data: string; turno: TurnoDb | null } | null>(null);
  const [regolePiano, setRegolePiano] = useState<RegoleTurni>(REGOLE_DEFAULT);
  // Proposta di ferie per le ore di contratto che restano non usate.
  // Dove mettere le ore che avanzano: le finestre migliori del mese (traffico MODA).
  const [dove, setDove] = useState<{ employeeId: string; nome: string; ore: number; finestre: FinestraSuggerita[] | null } | null>(null);
  const [proposta, setProposta] = useState<{ employeeId: string; nome: string; ore: number; giorni: FeriaProposta[] } | null>(null);
  const [giorniApertura, setGiorniApertura] = useState<Map<string, { apre: number; chiude: number; chiuso: boolean }>>(new Map());

  const dateMese = useMemo(() => dateDelMese(mese), [mese]);

  const carica = useCallback(async () => {
    setCaricamento(true);
    const settimaneMese = [...new Set(dateMese.map(lunediDi))].flatMap(giorniDellaSettimana);
    const [p, hr, ch, disp, tr] = await Promise.all([
      supabase.from('shift_plans').select('*').eq('company_id', companyId).eq('outlet_id', outletId).eq('mese', `${mese}-01`).order('created_at'),
      supabase.rpc('organico_e_hr'),
      supabase.rpc('turni_mese_chiuso', { p_company: companyId, p_data: `${mese}-01` }),
      caricaDisponibilita(companyId).catch(() => new Map<string, Accordo>()),
      caricaTrasferte(companyId, settimaneMese[0], settimaneMese[settimaneMese.length - 1]).catch(() => [] as Trasferta[]),
    ]);
    setDisponibilita(disp);
    setTrasferte(tr);
    if (p.error) toast({ type: 'error', message: `Piani non caricati: ${p.error.message}` });
    const lista = ((p.data as Piano[]) ?? []);
    setPiani(lista);
    setEHr(!!hr.data);
    setChiuso(!!ch.data);
    setAperto((a) => (a && lista.some((x) => x.id === a) ? a : lista.find((x) => x.stato === 'scelto')?.id ?? null));
    setCaricamento(false);
  }, [companyId, outletId, mese, toast, dateMese, versione]);
  useEffect(() => { carica(); }, [carica]);

  useEffect(() => {
    if (!aperto) { setTurniPiano([]); setLiberiPiano([]); return; }
    let vivo = true;
    void (async () => {
      const [t, l] = await Promise.all([
        supabase.from('shifts').select('id, employee_id, data, inizio, fine, pausa_minuti, stato, origine, straordinario, ore_straordinario').eq('plan_id', aperto).neq('stato', 'annullato'),
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
          (sp.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [], [], apertura)
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

  // Ferie e permessi approvati valgono le ore scritte nel piano ferie (Patrizio,
  // 28/10/2026); solo se mancano, la giornata vale ore settimanali / 6.
  const ferieTutte = useMemo(() => {
    const oreSett = new Map(persone.map(({ scheda, perGiorno }) => [scheda.id, perGiorno.find((p) => p.outletId === outletId && p.stato === 'in_servizio')?.ore ?? null]));
    return ferieRegistrate.map((x) => ({ ...x, ore: oreFerieGiorno(x.tipo, Number(x.ore), oreSett.get(x.employee_id) ?? null, regolePiano) }));
  }, [ferieRegistrate, persone, outletId, regolePiano]);

  const oreOggi = (perGiorno: ReturnType<typeof personaAllaData>[]) => perGiorno.find((p) => p.outletId === outletId && p.stato === 'in_servizio')?.ore ?? null;
  const numero = (v: string | undefined) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return v != null && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null;
  };

  // I dati del mese per calcolare un piano: si caricano una volta e servono sia
  // per creare le varianti sia per la prova delle ferie (Patrizio, 28/10/2026).
  const caricaBase = async (): Promise<BaseMese | null> => {
    // Settimane intere che toccano il mese.
    const settimane = [...new Set(dateMese.map(lunediDi))];
    const tutte = settimane.flatMap(giorniDellaSettimana);
    const [o, f, s, r, ev, tr, fe, sl, storico, fuori] = await Promise.all([
      supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude').eq('outlet_id', outletId),
      supabase.from('outlet_staffing_needs').select('giorno, dalle, alle, persone').eq('outlet_id', outletId),
      supabase.from('outlet_special_days').select('data, chiuso, apre, chiude, persone_extra, nota').eq('outlet_id', outletId).gte('data', tutte[0]).lte('data', tutte[tutte.length - 1]),
      supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
      supabase.from('outlet_events').select('nome, data_dal, data_al, outlet_ids, persone_extra, blocca_ferie, straordinari').eq('company_id', companyId).lte('data_dal', tutte[tutte.length - 1]).gte('data_al', tutte[0]),
      caricaTraffico(companyId, outletId),
      // anche i giorni dell'altro mese nelle settimane a cavallo: tolgono ore alla settimana
      caricaGiorniFerie(companyId, tutte[0], tutte[tutte.length - 1]),
      supabase.from('v_leave_disponibilita').select('employee_id, residuo_disponibile').eq('company_id', companyId),
      // Sabati e domeniche liberi dei piani scelti prima di questo mese: lo storico della rotazione.
      supabase.from('shift_plan_weekend_off').select('employee_id, data, shift_plans!inner(stato, outlet_id, mese)').eq('company_id', companyId).lt('data', `${mese}-01`),
      // Settimana intera anche a cavallo di due mesi (Patrizio, 28/10/2026): i
      // turni veri dei giorni dell'altro mese (piano scelto, piano settimanale,
      // turni a mano, in qualunque negozio) tolgono ore alla settimana.
      supabase.from('shifts').select('employee_id, data, inizio, fine, pausa_minuti, plan_id, shift_plans(stato)').eq('company_id', companyId)
        .in('data', tutte.filter((d) => !d.startsWith(mese))).neq('stato', 'annullato'),
    ]);
    const orari = (o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [];
    if (!orari.length) { toast({ type: 'error', message: `Mancano gli orari di ${nomeNegozio}: inseriscili in «Orari e fabbisogno».` }); return null; }
    const eventi = eventiDelNegozio((ev.data as EventoNegozio[]) ?? [], outletId);
    const giorni = costruisciGiorni(tutte, orari, (f.data as { giorno: number; dalle: string; alle: string; persone: number }[]) ?? [],
      (s.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [], eventi, apertura);
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
    const oreFuoriMese = new Map<string, Map<string, number>>();
    for (const x of ((fuori.data as unknown as { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number; plan_id: string | null; shift_plans: { stato: string } | { stato: string }[] | null }[]) ?? [])) {
      const pl = Array.isArray(x.shift_plans) ? x.shift_plans[0] : x.shift_plans;
      if (x.plan_id && pl?.stato !== 'scelto') continue; // le bozze degli altri piani non contano
      const m = oreFuoriMese.get(x.employee_id) ?? new Map<string, number>();
      m.set(x.data, (m.get(x.data) ?? 0) + oreLavorate({ inizio: x.inizio.slice(0, 5), fine: x.fine.slice(0, 5), pausaMinuti: x.pausa_minuti ?? 0 }));
      oreFuoriMese.set(x.employee_id, m);
    }
    return {
      tutte, giorni, regole, atteso, extra, senzaLiberi, saldi, storicoWeekend, oreFuoriMese,
      ferie: fe.filter((x) => STATI_FERIE_APPROVATE.includes(x.stato_richiesta) && GIORNI_FERIE_VALIDI.includes(x.stato_giorno)),
      fonte: atteso.size ? `${propria ? 'traffico MODA del negozio' : 'forma media degli altri negozi (questo non ha storico)'}: ${[...fonti].join(', ')}` : 'nessun traffico: fabbisogno di «Orari e fabbisogno»',
    };
  };

  // Il piano di una regola sui dati del mese: le ipotesi della simulazione e le
  // ferie tolte per prova (chiavi «persona|data») cambiano solo il calcolo.
  // Nelle settimane a cavallo le trasferte dei giorni dell'altro mese sono ore gia' lavorate.
  const conTrasferteFuori = (base: Map<string, Map<string, number>>) => {
    const out = new Map([...base].map(([k, v]) => [k, new Map(v)]));
    for (const t of trasferte.filter((x) => !x.data.startsWith(mese))) {
      const m = out.get(t.employeeId) ?? new Map<string, number>();
      m.set(t.data, (m.get(t.data) ?? 0) + oreTrasferta(t));
      out.set(t.employeeId, m);
    }
    return out;
  };
  const calcolaPiano = (b: BaseMese, regola: RegolaWeekend, ipotesi?: Simulazione, ferieTolte?: Set<string>) => {
    const tolte = new Set([...(ferieTolte ?? []), ...(ipotesi?.ferieTolte ?? [])]);
    const ferieOk = b.ferie.filter((x) => !tolte.has(`${x.employee_id}|${x.data}`));
    const { tutte, regole } = b;

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
            // i giorni in trasferta
            ...trasferte.filter((x) => x.employeeId === scheda.id).map((x) => x.data),
          ]),
          oreFerie: new Map(suoFerie.map((x) => [x.data, oreFerieGiorno(x.tipo, Number(x.ore), oreSett, regole)])),
          // Chi entra o esce a meta' mese conta solo i giorni con il contratto.
          inServizio: new Set(dateMese.filter((d, i) => perGiorno[i].outletId === outletId && perGiorno[i].stato === 'in_servizio')),
          saldoOre: b.saldi.get(scheda.id) ?? 0,
          // accordi della scheda: le fasce orarie in cui puo' lavorare
          fasce: fasceDelle(disponibilita, scheda.id, tutte),
          // trasferte: ore di lavoro fuori dal negozio, il giorno non e' libero per un turno qui
          oreTrasferta: orePerData(trasferte.filter((x) => x.data.startsWith(mese)), scheda.id),
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
          inServizio: new Set(dateMese.filter((d) => d >= dal)),
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
        mese, giorni: b.giorni, persone: personePiano, regola, storicoWeekend: b.storicoWeekend, atteso: b.atteso, extra: b.extra, senzaLiberi: b.senzaLiberi, regole,
        straordinariPersona: ipotesi ? straordinariPersona : undefined,
        oreFuoriMese: conTrasferteFuori(b.oreFuoriMese),
        // le trasferte verso questo negozio segnate «coprono il negozio»
        fissi: copertureVerso(trasferte, outletId),
      });
      return { esito, straordinariPersona, tolte };
  };

  // senzaFerie (Patrizio, 28/10/2026): il calendario dell'organico pieno, come se
  // nessuno avesse ferie o permessi; le ferie si inseriscono poi dal calendario.
  const creaPiano = async (regola: RegolaWeekend, ipotesi?: Simulazione, senzaFerie = false) => {
    setLavoro(ipotesi ? 'simulazione' : `${senzaFerie ? 'senza-' : ''}${regola}`);
    try {
      const b = await caricaBase();
      if (!b) return;
      const { esito, straordinariPersona, tolte } = calcolaPiano(b, regola, ipotesi, senzaFerie ? new Set(b.ferie.map((x) => `${x.employee_id}|${x.data}`)) : undefined);
      const riepilogo: Riepilogo = {
        oreScoperte: esito.oreScoperte,
        oreRiserva: esito.oreRiserva,
        straordinario: Object.values(esito.persone).reduce((a, p) => a + p.straordinario, 0),
        fonte: b.fonte,
        turni: esito.turni.length,
        ...(senzaFerie ? { senzaFerie: true } : {}),
        settimane: esito.settimane,
        persone: esito.persone,
        // «In negozio»: le persone necessarie a organico pieno (mai piu' di quelle in servizio)
        bisogno: Object.fromEntries(esito.necessari.filter((g) => !g.chiuso && g.data.startsWith(mese))
          .map((g) => [g.data, { apre: g.apre, chiude: g.chiude, esigenza: g.fabbisogno }])),
        ...(ipotesi ? {
          ipotesi: {
            persone: persone.map(({ scheda, perGiorno }) => ({
              nome: nomePersona(scheda), oggi: oreOggi(perGiorno), ipotesi: numero(ipotesi.ore[scheda.id]), soloWeekend: !!ipotesi.soloWeekend[scheda.id],
              straordinari: straordinariPersona.get(scheda.id) ?? 0,
            })),
            ferieTolte: b.ferie.filter((x) => tolte.has(`${x.employee_id}|${x.data}`))
              .map((x) => ({ nome: nomePersona(persone.find((q) => q.scheda.id === x.employee_id)?.scheda ?? { nome: '', cognome: '' }), data: x.data })),
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
      const nome = `${ipotesi ? 'Simulazione · ' : ''}${NOMI_MESE[Number(mese.slice(5))].replace(/^./, (c) => c.toUpperCase())} ${mese.slice(0, 4)} · ${senzaFerie ? 'senza ferie · ' : ''}${ETICHETTE_REGOLA[regola]}`;
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

  // Un piano si toglie intero, anche con turni messi a mano o segnati straordinario
  // (Patrizio, 21/10/2026), finche' non ha turni pubblicati: quelli il negozio li ha gia' visti.
  const togli = async (p: Piano) => {
    setLavoro(p.id);
    try {
      const pub = await supabase.from('shifts').select('id', { count: 'exact', head: true }).eq('plan_id', p.id).eq('stato', 'pubblicato');
      if (pub.error) throw pub.error;
      if ((pub.count ?? 0) > 0) {
        toast({ type: 'error', message: `«${p.nome}» ha ${pub.count} turni già pubblicati al negozio: non si toglie. Cambia i turni dal calendario.` });
        return;
      }
      const cosa = p.simulazione ? 'la simulazione' : p.stato === 'scelto' ? 'il piano che vale per il mese' : 'la bozza';
      if (!window.confirm(`Togliere ${cosa} «${p.nome}»? Spariscono tutti i suoi turni, anche quelli messi a mano. Il piano si può rifare.`)) return;
      const a = await supabase.from('shifts').delete().eq('plan_id', p.id).neq('stato', 'pubblicato');
      if (a.error) throw a.error;
      const b = await supabase.from('shift_plan_weekend_off').delete().eq('plan_id', p.id);
      if (b.error) throw b.error;
      const c = await supabase.from('shift_plans').delete().eq('id', p.id);
      if (c.error) throw c.error;
      if (aperto === p.id) setAperto(null);
      toast({ type: 'success', message: `Tolto «${p.nome}».` });
      await carica();
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Piano non tolto.' });
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
  // Nel calendario senza ferie si vedono solo le ferie inserite dopo averlo
  // creato (Patrizio, 28/10/2026): quelle di prima il calendario le ignora.
  const ferieMese = useMemo(() => (pianoAperto?.riepilogo.senzaFerie
    ? ferieTutte.filter((x) => x.creato_il > pianoAperto.created_at) : ferieTutte), [ferieTutte, pianoAperto]);
  const varianti = piani.filter((p) => !p.simulazione);
  // Mettere e togliere turni a mano dal calendario: la responsabile HR, a mese aperto.
  const puoModificare = eHr && puoScrivere && !chiuso;
  // Ore da lavorare dal vivo: contratto del mese meno le ferie e i permessi di
  // adesso (una proposta di ferie appena inviata abbassa subito le ore non usate).
  const daLavorareOra = (employeeId: string): number | null => {
    const r = pianoAperto?.riepilogo.persone?.[employeeId];
    if (!r || r.riserva) return null;
    const ferieOra = ferieMese.filter((x) => x.employee_id === employeeId).reduce((a, x) => a + x.ore, 0);
    // le trasferte di adesso: ore di lavoro gia' fatte fuori dal negozio
    const trasferteOra = trasferte.filter((x) => x.employeeId === employeeId && x.data.startsWith(mese)).reduce((a, x) => a + oreTrasferta(x), 0);
    // Contratto del mese meno le ferie e le trasferte di adesso.
    if (r.contrattoMese != null) return Math.max(0, r.contrattoMese - ferieOra - trasferteOra);
    if (r.ferie == null) return r.contratto;
    return Math.max(0, r.contratto + r.ferie - ferieOra);
  };

  // Ore da contratto di una settimana, dal vivo (Patrizio, 28/10/2026: «ore da
  // contratto» e «ore programmate», nient'altro): quelle della settimana (nelle
  // settimane a cavallo la parte di questo mese) meno ferie, permessi e trasferte
  // di adesso nei giorni del mese.
  const contrattoSettimanaOra = (employeeId: string, lun: string, oreSett: number | null): number | null => {
    const r = pianoAperto?.riepilogo.persone?.[employeeId];
    if (oreSett == null || r?.riserva) return null;
    const giorni = giorniDellaSettimana(lun).filter((d) => d.startsWith(mese));
    const lorde = r?.settimane?.[lun] ?? (giorni.length >= 7 ? oreSett : oreSett * giorni.length / 7);
    const via = ferieMese.filter((x) => x.employee_id === employeeId && giorni.includes(x.data)).reduce((a, x) => a + x.ore, 0)
      + trasferte.filter((x) => x.employeeId === employeeId && giorni.includes(x.data)).reduce((a, x) => a + oreTrasferta(x), 0);
    return Math.max(0, lorde - via);
  };

  // Un giorno in cui la persona puo' ricevere un turno o una proposta di ferie:
  // in servizio qui, disponibile, negozio aperto, senza turno, libero o ferie.
  const giornoSenzaImpegni = (employeeId: string, d: string) => {
    const pers = persone.find((x) => x.scheda.id === employeeId);
    const k = dateMese.indexOf(d);
    return !!pers && k >= 0 && pers.perGiorno[k].outletId === outletId && pers.perGiorno[k].stato === 'in_servizio'
      && puoLavorareIl(disponibilita, employeeId, d) && !(giorniApertura.get(d)?.chiuso ?? false)
      && !turniPiano.some((x) => x.employee_id === employeeId && x.data === d)
      && !liberiPiano.some((x) => x.employee_id === employeeId && x.data === d)
      && !ferieMese.some((x) => x.employee_id === employeeId && x.data === d);
  };

  const apriDove = async (employeeId: string, nome: string, ore: number) => {
    setDove({ employeeId, nome, ore, finestre: null });
    try {
      const [tr, oo, sp, ev] = await Promise.all([
        caricaTraffico(companyId, outletId),
        supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude').eq('outlet_id', outletId),
        supabase.from('outlet_special_days').select('data, chiuso, apre, chiude, persone_extra, nota').eq('outlet_id', outletId).gte('data', dateMese[0]).lte('data', dateMese[dateMese.length - 1]),
        supabase.from('outlet_events').select('nome, data_dal, data_al, outlet_ids, persone_extra, blocca_ferie, straordinari').eq('company_id', companyId).lte('data_dal', dateMese[dateMese.length - 1]).gte('data_al', dateMese[0]),
      ]);
      const st = storicoTraffico(tr.length ? tr : await caricaTraffico(companyId, null));
      const atteso = new Map<string, number[]>();
      for (const d of dateMese) { const a = trafficoAtteso(st, d); if (a) atteso.set(d, a.ore); }
      const giorni = costruisciGiorni(dateMese,
        (oo.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [], [],
        (sp.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [],
        eventiDelNegozio((ev.data as EventoNegozio[]) ?? [], outletId), apertura);
      const finestre = suggerisciFinestre({
        giorni, atteso, regole: regolePiano, ore,
        turni: turniPiano.map((t) => ({ employeeId: t.employee_id, data: t.data, inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti })),
        possibile: (d) => giornoSenzaImpegni(employeeId, d),
      });
      setDove({ employeeId, nome, ore, finestre });
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Suggerimenti non calcolati.' });
      setDove(null);
    }
  };

  const aggiungiFinestra = async (f: FinestraSuggerita, straordinario: boolean) => {
    if (!dove || !pianoAperto) return;
    setLavoro('dove');
    const { error } = await supabase.from('shifts').insert([{
      company_id: companyId, outlet_id: outletId, employee_id: dove.employeeId, data: f.data, inizio: f.inizio, fine: f.fine,
      pausa_minuti: f.pausaMinuti, origine: 'manuale', stato: 'bozza', plan_id: pianoAperto.id, straordinario, ore_straordinario: straordinario ? f.ore : 0,
    }]);
    setLavoro(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: `Turno aggiunto a ${dove.nome} come ${straordinario ? 'straordinario' : 'ore di contratto'}: il riepilogo è aggiornato.` });
    setDove(null);
    setVersione((v) => v + 1);
  };

  const apriProposta = (employeeId: string, nome: string, oreSett: number | null, ore: number) => {
    if (!oreSett) return;
    const giorni = proponiFerie({
      ore, oreSettimana: oreSett, date: dateMese,
      possibile: (d) => giornoSenzaImpegni(employeeId, d),
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
  // Due gruppi di varianti: la proposta con ferie e permessi e il calendario
  // dell'organico pieno, senza ferie (Patrizio, 28/10/2026).
  const variantiCon = varianti.filter((p) => !p.riepilogo.senzaFerie);
  const variantiSenza = varianti.filter((p) => p.riepilogo.senzaFerie);
  const regoleMancanti = REGOLE.filter((r) => !variantiCon.some((p) => p.regola_weekend === r));
  const regoleMancantiSenza = REGOLE.filter((r) => !variantiSenza.some((p) => p.regola_weekend === r));
  const minimoDi = (lista: Piano[]) => Math.min(...lista.map((p) => p.riepilogo.oreScoperte ?? 0));
  const minimoScoperte = minimoDi(variantiCon);
  // La simulazione vuota: ore di oggi, chi lavora solo nel weekend lo resta.
  const simulazioneVuota = (): Simulazione => ({
    ore: {}, straord: {}, perTutti: '', nuove: [],
    soloWeekend: Object.fromEntries(persone.map(({ scheda }) => [scheda.id, (disponibilita.get(scheda.id)?.giorni ?? []).join(',') === '6,7'])),
  });

  // Prova delle ferie (Patrizio, 28/10/2026): si spengono giorni di ferie e si
  // vede subito quante ore scoperte si recuperano, settimana per settimana, in
  // ogni variante. E' solo un calcolo: le richieste di ferie non cambiano.
  const [ferieTolte, setFerieTolte] = useState<Set<string>>(new Set());
  const [prova, setProva] = useState<{ calcolo: boolean; prima: Partial<Record<RegolaWeekend, SettimanaPiano[]>>; dopo: Partial<Record<RegolaWeekend, SettimanaPiano[]>> } | null>(null);
  const baseProva = useRef<{ base: BaseMese; prima: Partial<Record<RegolaWeekend, SettimanaPiano[]>> } | null>(null);
  useEffect(() => { setFerieTolte(new Set()); }, [mese, outletId]);
  useEffect(() => { baseProva.current = null; }, [mese, outletId, piani]);
  const regoleVarianti = variantiCon.map((p) => p.regola_weekend).join(',');
  useEffect(() => {
    if (!ferieTolte.size) { setProva(null); return; }
    let vivo = true;
    setProva((x) => ({ prima: x?.prima ?? {}, dopo: x?.dopo ?? {}, calcolo: true }));
    const t = setTimeout(async () => {
      try {
        if (!baseProva.current) {
          const b = await caricaBase();
          if (!b || !vivo) return;
          baseProva.current = { base: b, prima: {} };
        }
        const { base, prima } = baseProva.current;
        const dopo: Partial<Record<RegolaWeekend, SettimanaPiano[]>> = {};
        for (const r of regoleVarianti.split(',').filter(Boolean) as RegolaWeekend[]) {
          prima[r] ??= calcolaPiano(base, r).esito.settimane;
          dopo[r] = calcolaPiano(base, r, undefined, ferieTolte).esito.settimane;
          await new Promise((ok) => setTimeout(ok, 0));
          if (!vivo) return;
        }
        setProva({ calcolo: false, prima: { ...prima }, dopo });
      } catch (e) {
        if (vivo) { setProva(null); toast({ type: 'error', message: e instanceof Error ? e.message : 'Prova non calcolata.' }); }
      }
    }, 350);
    return () => { vivo = false; clearTimeout(t); };
    // caricaBase e calcolaPiano leggono lo stato del mese: basta ricalcolare quando cambiano le ferie spente o le varianti
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ferieTolte, regoleVarianti]);
  const scoperteDi = (w?: SettimanaPiano[]) => (w ?? []).reduce((a, x) => a + x.scoperte, 0);
  // Il riquadro delle ore: la variante aperta, altrimenti quella con meno ore scoperte.
  const pianoOre = [pianoAperto, ...variantiCon.filter((p) => (p.riepilogo.oreScoperte ?? 0) <= minimoScoperte + 1e-9), ...piani]
    .find((p) => p?.riepilogo.settimane?.length) ?? null;
  // Le quattro varianti in un colpo solo, una alla volta: solo quelle che mancano.
  const creaVarianti = async () => { for (const r of regoleMancanti) await creaPiano(r); };
  const creaVariantiSenza = async () => { for (const r of regoleMancantiSenza) await creaPiano(r, undefined, true); };
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
                <Plus size={15} /> {lavoro && lavoro !== 'simulazione' && !lavoro.startsWith('disp-') && !lavoro.startsWith('senza-') ? 'Calcolo le varianti…' : variantiCon.length ? `Varianti con ferie mancanti (${regoleMancanti.length})` : 'Crea le varianti con ferie e permessi'}
              </button>
            )}
            {regoleMancantiSenza.length > 0 && (
              <button type="button" onClick={creaVariantiSenza} disabled={!!lavoro}
                title="Il calendario dell'organico pieno, come se nessuno avesse ferie o permessi: le ferie si inseriscono poi dal calendario"
                className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border border-blue-300 bg-white text-blue-800 font-semibold hover:bg-blue-50 disabled:opacity-50">
                <Plus size={15} /> {lavoro?.startsWith('senza-') ? 'Calcolo le varianti…' : variantiSenza.length ? `Varianti senza ferie mancanti (${regoleMancantiSenza.length})` : 'Crea le varianti senza ferie'}
              </button>
            )}
            <button type="button" onClick={() => setSim(sim ? null : simulazioneVuota())} disabled={!!lavoro}
              className={`inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border font-semibold disabled:opacity-50 ${sim ? 'bg-violet-600 border-violet-600 text-white' : 'border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100'}`}>
              <FlaskConical size={15} /> {sim ? 'Chiudi la simulazione' : 'Simulazione'}
            </button>
          </div>
        )}
      </section>

      {/* Le ore del mese settimana per settimana (Patrizio, 28/10/2026): prima di tutto. */}
      {pianoOre?.riepilogo.settimane && (() => {
        const w = pianoOre.riepilogo.settimane;
        const dopo = prova?.dopo[pianoOre.regola_weekend];
        const etichetta = (x: SettimanaPiano) => x.dal === x.al ? `${Number(x.dal.slice(8))}/${Number(x.dal.slice(5, 7))}` : `${Number(x.dal.slice(8))}-${Number(x.al.slice(8))}/${Number(x.al.slice(5, 7))}`;
        const peggiore = Math.max(...w.map((x) => x.scoperte));
        // Due conti che si sommano: necessarie = coperte + scoperte; nei turni = coperte + in piu'.
        const val = (x: SettimanaPiano, k: string): number => {
          if (k === 'coperte') return x.coperte ?? x.necessarie - x.scoperte;
          if (k === 'inPiu') return x.inPiu ?? Math.max(0, x.pianificate - (x.necessarie - x.scoperte));
          if (k === 'nonUsate') return x.nonUsate ?? Math.max(0, x.disponibili - x.pianificate);
          return Number(x[k as keyof SettimanaPiano]);
        };
        const tot = (k: string) => w.reduce((a, x) => a + val(x, k), 0);
        const righe: { k: string; label: string; nota: string; forte?: boolean; rientro?: boolean; bordo?: boolean }[] = [
          { k: 'necessarie', label: 'Ore necessarie', nota: 'MODA a organico pieno: tutte al lavoro, nessuna ferie', forte: true },
          { k: 'coperte', label: 'coperte dai turni', nota: 'necessarie meno scoperte', rientro: true },
          { k: 'contratto', label: 'Contratto', nota: 'ore a giornata dei giorni con il contratto', bordo: true },
          { k: 'ferie', label: 'Ferie e permessi', nota: 'chiesti o approvati' },
          { k: 'disponibili', label: 'Ore disponibili', nota: 'contratto meno ferie e permessi', forte: true },
          { k: 'pianificate', label: 'Ore nei turni', nota: 'pause escluse, anche chi è a chiamata', forte: true, bordo: true },
          { k: 'coperte', label: 'dove servono', nota: 'le stesse ore coperte di sopra', rientro: true },
          { k: 'inPiu', label: 'dove MODA non le chiede', nota: 'per le regole: turno minimo, un turno al giorno, negozio sempre aperto', rientro: true },
          { k: 'nonUsate', label: 'Contratto non usato', nota: 'ore disponibili che i turni non usano (turno minimo, giorni di lavoro, giorni non disponibili)', bordo: true },
        ];
        return (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Ore del mese, settimana per settimana</h3>
                <p className="text-xs text-slate-500">Variante «{ETICHETTE_REGOLA[pianoOre.regola_weekend]}»{pianoOre.simulazione ? ' (simulazione)' : ''}: la settimana più rossa è dove intervenire.</p>
              </div>
              {puoScrivere && !chiuso && (
                <button type="button" onClick={() => setSim(simulazioneVuota())} disabled={!!lavoro}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100 disabled:opacity-50">
                  <FlaskConical size={13} /> Prova ore di contratto diverse
                </button>
              )}
            </div>
            <div className="overflow-x-auto px-4 py-3">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-xs text-slate-500">
                    <th className="text-left font-medium py-1 pr-3">Settimana</th>
                    {w.map((x) => <th key={x.lunedi} className="text-right font-medium py-1 px-2 whitespace-nowrap">{etichetta(x)}</th>)}
                    <th className="text-right font-semibold py-1 pl-3 text-slate-700">Mese</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.slice(0, 2).map((r, i) => (
                    <tr key={`${r.k}-${i}`} className="border-t border-slate-100">
                      <td className={`py-1.5 pr-3 ${r.rientro ? 'pl-4' : ''}`}><span className={r.forte ? 'font-semibold text-slate-800' : 'text-slate-700'}>{r.rientro ? '↳ ' : ''}{r.label}</span><span className="block text-[11px] text-slate-400">{r.nota}</span></td>
                      {w.map((x) => <td key={x.lunedi} className={`text-right px-2 ${r.forte ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{fmt(val(x, r.k))}</td>)}
                      <td className="text-right pl-3 font-semibold text-slate-800">{fmt(tot(r.k))}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 pl-4"><span className="font-semibold text-red-800">↳ scoperte</span><span className="block text-[11px] text-slate-400">necessarie che i turni non coprono: dove intervenire</span></td>
                    {w.map((x) => (
                      <td key={x.lunedi} className="text-right px-2">
                        <span className={`inline-block min-w-[2.5rem] rounded px-1.5 py-0.5 font-semibold ${x.scoperte < 0.25 ? 'text-emerald-700' : x.scoperte >= peggiore - 1e-9 ? 'bg-red-600 text-white' : 'bg-red-50 text-red-800'}`}>{fmt(x.scoperte)}</span>
                      </td>
                    ))}
                    <td className="text-right pl-3 font-semibold text-red-800">{fmt(tot('scoperte'))}</td>
                  </tr>
                  {righe.slice(2).map((r, i) => (
                    <tr key={`${r.k}-b${i}`} className={r.bordo ? 'border-t-2 border-slate-200' : 'border-t border-slate-100'}>
                      <td className={`py-1.5 pr-3 ${r.rientro ? 'pl-4' : ''}`}><span className={r.forte ? 'font-semibold text-slate-800' : 'text-slate-700'}>{r.rientro ? '↳ ' : ''}{r.label}</span><span className="block text-[11px] text-slate-400">{r.nota}</span></td>
                      {w.map((x) => <td key={x.lunedi} className={`text-right px-2 ${r.forte ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{fmt(val(x, r.k))}</td>)}
                      <td className="text-right pl-3 font-semibold text-slate-800">{fmt(tot(r.k))}</td>
                    </tr>
                  ))}
                  {dopo && (
                    <tr className="border-t border-amber-200 bg-amber-50/60">
                      <td className="py-1.5 pr-3"><span className="font-semibold text-amber-900">Senza le ferie spente</span><span className="block text-[11px] text-amber-800">prova, le richieste non cambiano</span></td>
                      {dopo.map((x) => <td key={x.lunedi} className="text-right px-2 font-semibold text-amber-900">{fmt(x.scoperte)}</td>)}
                      <td className="text-right pl-3 font-semibold text-amber-900">{fmt(scoperteDi(dopo))}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })()}
      {!pianoOre && piani.length > 0 && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Queste varianti sono state calcolate prima del 28/10/2026, senza il dettaglio per settimana: toglile con il cestino e ricreale per vedere le ore necessarie e scoperte settimana per settimana.</p>
      )}

      {/* Chi lavora nel mese, con ore e giorni in cui può lavorare. */}
      <section className="bg-white border border-slate-200 rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
          <h3 className="text-sm font-semibold text-slate-800">Chi lavora a {NOMI_MESE[Number(mese.slice(5))]}</h3>
          <span className="text-xs text-slate-500">Gli accordi di ognuno (giorni e fasce orarie) si cambiano nella scheda del dipendente, riquadro «Disponibilità per i turni».</span>
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {persone.map(({ scheda, perGiorno }) => {
            const ore = oreOggi(perGiorno);
            const a = disponibilita.get(scheda.id);
            return (
              <span key={scheda.id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 pl-3 pr-2 py-1 text-sm">
                <span className="font-medium text-slate-800">{nomePersona(scheda)}</span>
                <span className="text-xs text-slate-500">{ore == null ? 'a chiamata' : `${fmt(ore)} h/sett.`}</span>
                {a && <span className="text-[11px] font-semibold rounded-full bg-amber-100 text-amber-900 px-2 py-0.5" title={a.nota ?? undefined}>{testoAccordo(a)}</span>}
              </span>
            );
          })}
          {!persone.length && <span className="text-sm text-slate-400">Nessuno in servizio in questo negozio nel mese.</span>}
        </div>
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
                        {disponibilita.get(scheda.id) && <span className="block text-[11px] font-normal text-slate-500">{testoAccordo(disponibilita.get(scheda.id)!)}</span>}
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

      {/* Ferie del mese da spegnere per prova (Patrizio, 28/10/2026). */}
      {variantiCon.length > 0 && ferieTutte.length > 0 && !chiuso && (
        <section className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Ferie e permessi del mese: prova a spegnerli</h3>
              <p className="text-xs text-slate-500">Clicca un giorno per spegnerlo o riaccenderlo: le ore scoperte si ricalcolano subito in ogni variante. È una prova, le richieste di ferie non cambiano.</p>
            </div>
            {ferieTolte.size > 0 && (
              <div className="flex gap-2">
                <button type="button" onClick={() => setFerieTolte(new Set())} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">Riaccendi tutte</button>
                {puoScrivere && (
                  <button type="button" disabled={!!lavoro}
                    onClick={() => creaPiano(variantiCon.find((p) => (p.riepilogo.oreScoperte ?? 0) <= minimoScoperte + 1e-9)?.regola_weekend ?? 'nessuno', { ...simulazioneVuota(), ferieTolte: [...ferieTolte] })}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                    <FlaskConical size={13} /> Salva come simulazione
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {persone.filter(({ scheda }) => ferieTutte.some((x) => x.employee_id === scheda.id)).map(({ scheda }) => {
              const suoi = ferieTutte.filter((x) => x.employee_id === scheda.id).sort((a, b) => a.data.localeCompare(b.data));
              return (
                <div key={scheda.id} className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="w-44 font-medium text-slate-800 truncate">{nomePersona(scheda)}</span>
                  {suoi.map((x) => {
                    const chiave = `${x.employee_id}|${x.data}`;
                    const spenta = ferieTolte.has(chiave);
                    const g = new Date(`${x.data}T00:00:00Z`).getUTCDay() || 7;
                    return (
                      <button key={chiave} type="button" aria-pressed={!spenta}
                        title={`${x.tipo === 'ore' ? `Permesso di ${fmt(x.ore)} h` : x.tipo === 'giornata' ? 'Giornata di ferie' : 'Mezza giornata di ferie'} (${fmt(x.ore)} h): ${spenta ? 'spenta nella prova' : 'conta nel piano'}`}
                        onClick={() => setFerieTolte((set) => { const n = new Set(set); if (n.has(chiave)) n.delete(chiave); else n.add(chiave); return n; })}
                        className={`text-xs px-2 py-1 rounded-md border tabular-nums ${spenta ? 'bg-white border-slate-300 text-slate-400 line-through' : 'bg-amber-100 border-amber-300 text-amber-900'}`}>
                        {NOMI_GIORNO_BREVI[g]} {Number(x.data.slice(8))}{x.tipo === 'ore' ? ` · ${fmt(x.ore)} h` : x.tipo === 'giornata' ? '' : ' · ½'}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {prova && (
            <p className="mt-2 text-xs text-amber-900">
              {prova.calcolo ? 'Ricalcolo le varianti…' : `${ferieTolte.size === 1 ? 'Un giorno spento' : `${ferieTolte.size} giorni spenti`}: il risultato è nelle schede qui sotto e nel riquadro delle ore.`}
            </p>
          )}
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
        <section className="space-y-4">
          {[
            { chiave: 'con', titolo: 'Proposta con ferie e permessi', nota: 'il calendario calcolato con le ferie e i permessi di adesso', lista: [...variantiCon, ...piani.filter((x) => x.simulazione)] },
            { chiave: 'senza', titolo: 'Senza ferie e permessi: organico pieno', nota: 'tutte al lavoro; scelto il calendario, le ferie si inseriscono cliccando la casella', lista: variantiSenza },
          ].filter((gr) => gr.lista.length > 0).map((gr, _i, gruppi) => (
          <div key={gr.chiave}>
            {(gruppi.length > 1 || gr.chiave === 'senza') && (
              <h3 className="mb-2 text-sm font-semibold text-slate-800">{gr.titolo} <span className="font-normal text-slate-500">· {gr.nota}</span></h3>
            )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {gr.lista.map((p) => {
              const pp = Object.values(p.riepilogo.persone ?? {}).filter((x) => !x.riserva);
              const liberi = pp.map((x) => x.weekendLiberi);
              const scoperte = p.riepilogo.oreScoperte ?? 0;
              const delGruppo = gr.lista.filter((x) => !x.simulazione);
              const migliore = !p.simulazione && delGruppo.length > 1 && scoperte <= minimoDi(delGruppo) + 1e-9;
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
                  {p.riepilogo.senzaFerie && <p className="text-xs text-blue-700 mt-0.5">senza ferie e permessi</p>}
                  {p.simulazione && p.riepilogo.ipotesi && (
                    <p className="text-xs text-violet-700 mt-0.5 line-clamp-2">
                      {[...p.riepilogo.ipotesi.persone.filter((x) => x.ipotesi != null).map((x) => `${x.nome.split(' ')[0]} ${fmt(x.ipotesi!)} h`),
                        ...(p.riepilogo.ipotesi.nuove ?? []).map((n) => `+ ${n.nome}`),
                        ...(p.riepilogo.ipotesi.ferieTolte?.length ? [`${p.riepilogo.ipotesi.ferieTolte.length} giorni di ferie spenti`] : [])].join(' · ') || 'ore di oggi'}
                    </p>
                  )}
                  <p className={`mt-3 text-2xl font-semibold tabular-nums ${scoperte > 0.25 ? 'text-red-700' : 'text-emerald-700'}`}>
                    {scoperte > 0.25 ? `${fmt(scoperte)} h` : 'Coperto'}
                    <span className="ml-1 text-xs font-normal text-slate-500">{scoperte > 0.25 ? 'scoperte nel mese' : 'tutto il mese'}</span>
                  </p>
                  {p.riepilogo.settimane?.length ? (() => {
                    // Le ore scoperte settimana per settimana, a colpo d'occhio.
                    const w = p.riepilogo.settimane;
                    const max = Math.max(...w.map((x) => x.scoperte));
                    const prima = prova?.prima[p.regola_weekend];
                    const dopo = prova?.dopo[p.regola_weekend];
                    return (
                      <div className="mt-2">
                        <div className="flex gap-1" aria-label="Ore scoperte per settimana">
                          {w.map((x) => (
                            <div key={x.lunedi} className="flex-1 min-w-0 text-center" title={`Settimana ${x.dal.slice(8)}/${x.dal.slice(5, 7)}-${x.al.slice(8)}/${x.al.slice(5, 7)}: ${fmt(x.scoperte)} h scoperte su ${fmt(x.necessarie)} necessarie`}>
                              <div className={`rounded text-[11px] font-semibold py-0.5 tabular-nums ${x.scoperte < 0.25 ? 'bg-emerald-50 text-emerald-700' : x.scoperte >= max - 1e-9 ? 'bg-red-600 text-white' : 'bg-red-50 text-red-800'}`}>{fmt(x.scoperte)}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 truncate">{Number(x.dal.slice(8))}{x.dal !== x.al ? `-${Number(x.al.slice(8))}` : ''}</div>
                            </div>
                          ))}
                        </div>
                        {prova && (
                          <p className="mt-1.5 text-xs rounded-md bg-amber-50 text-amber-900 px-2 py-1">
                            {prova.calcolo || !dopo || !prima ? 'Ricalcolo senza le ferie spente…'
                              : <>Senza le ferie spente: <b>{fmt(scoperteDi(dopo))} h</b> scoperte ({scoperteDi(prima) - scoperteDi(dopo) >= 0.25 ? `−${fmt(scoperteDi(prima) - scoperteDi(dopo))} h` : 'nessun recupero'})</>}
                          </p>
                        )}
                      </div>
                    );
                  })() : null}
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
                    {puoScrivere && !chiuso && (p.stato === 'bozza' || eHr) && (
                      <button type="button" aria-label={p.simulazione ? 'Togli la simulazione' : p.stato === 'scelto' ? 'Togli il piano' : 'Togli la bozza'} title="Togli"
                        onClick={() => togli(p)} disabled={!!lavoro} className="ml-auto p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-700"><Trash2 size={14} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </div>
          ))}
        </section>
      )}

      <details className="text-sm text-slate-600">
        <summary className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700">Come si calcola il piano</summary>
        <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1 text-xs">
          <p>Le ore necessarie sono le ore di contratto di tutte le persone del negozio, senza togliere ferie e permessi, distribuite come gli ingressi MODA: è il fabbisogno a organico pieno. Le ore scoperte sono le ore necessarie che i turni non coprono, per le ferie o per le regole dei turni; spegnendo una ferie nella prova si vede quante se ne recuperano.</p>
          <p>Le ore di contratto di chi lavora nel negozio, meno ferie e permessi, si distribuiscono come gli ingressi registrati da MODA: più persone quando entra più gente, sempre almeno una. I giorni speciali (festivi, Black Friday, settimane di Natale) si riconoscono dal calendario; gli eventi del negozio si aggiungono dalla scheda «Eventi».</p>
          <p>Comanda l'orario del negozio: in ogni mezz'ora di apertura c'è almeno una persona, i giorni chiusi sono solo quelli del calendario (e quelli prima della data di apertura). MODA decide dove servono la seconda e la terza persona; se le ore non bastano, la riga «In negozio» lo segnala come personale mancante.</p>
          <p>Ogni turno dura almeno 4 ore (si cambia solo nelle regole del negozio). La pausa non è lavoro e non si paga: almeno 30 minuti da 6 ore di lavoro, un'ora da 8 (9 ore di presenza = 8 di lavoro). Al massimo 6 giorni su 7. Chi è a chiamata copre solo i buchi che restano, nei giorni in cui può lavorare.</p>
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
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600" /> In negozio: scoperto</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-300" /> In negozio: manca personale per MODA</span>
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
            // Copertura del giorno (Patrizio, 21/10/2026): comanda l'orario del
            // negozio, mai una mezz'ora senza nessuno; MODA dice dove manca personale.
            const hhmmCorto = (m: number) => `${Math.floor(m / 60)}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''}`;
            const statoCopertura = (d: string): ReactNode => {
              const b = pianoAperto.riepilogo.bisogno?.[d];
              if (!b || !dateMese.includes(d)) return null;
              const tutti = [
                ...turniPiano.filter((x) => x.data === d),
                ...(pianoAperto.riepilogo.turniNuove ?? []).filter((x) => x.data === d),
                // chi viene qui in trasferta e copre il negozio
                ...trasferte.filter((x) => x.data === d && x.copreDestinazione && x.destinazioneOutletId === outletId),
              ];
              const n = Math.round((b.chiude - b.apre) / 30);
              const cop = Array.from({ length: n }, (_, i) => {
                const t = b.apre + i * 30;
                return tutti.filter((x) => minuti(x.inizio) <= t && minuti(x.fine) > t).length;
              });
              const fasce = (cond: (i: number) => boolean) => {
                const out: string[] = [];
                for (let i = 0; i < n; i++) if (cond(i)) { let j = i; while (j < n && cond(j)) j++; out.push(`${hhmmCorto(b.apre + i * 30)}-${hhmmCorto(b.apre + j * 30)}`); i = j; }
                return out;
              };
              const vuote = fasce((i) => cop[i] === 0);
              if (vuote.length) return <span className="block rounded-md px-1 py-1 bg-red-600 text-white text-[10px] font-semibold leading-tight" title="Negozio senza nessuno in questi orari">scoperto {vuote.join(', ')}</span>;
              const mancano = Math.max(0, ...cop.map((c, i) => (b.esigenza[i] ?? 1) - c));
              if (mancano > 0) {
                const dove = fasce((i) => (b.esigenza[i] ?? 1) > cop[i]);
                return <span className="block rounded-md px-1 py-1 bg-amber-100 text-amber-900 text-[10px] font-semibold leading-tight" title="Per il traffico MODA servirebbero più persone in questi orari">manca {mancano === 1 ? '1 persona' : `${mancano} persone`} {dove.join(', ')}</span>;
              }
              return <span className="block text-[10px] font-semibold text-emerald-700">coperto</span>;
            };
            // Si apre solo dove la persona puo' lavorare: in servizio, negozio aperto,
            // giorno disponibile e non in ferie per la giornata intera.
            const modificabile = (riga: (typeof righe)[number], d: string) => puoModificare && !riga.nuova && dateMese.includes(d)
              && riga.inServizio(d) && !(giorniApertura.get(d)?.chiuso ?? false)
              && puoLavorareIl(disponibilita, riga.id, d);
              // anche il giorno di ferie si apre: da li' si tolgono (Patrizio, 28/10/2026)
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
                  {vuota && !riga.liberi.has(d) && !ferieMese.some((x) => x.employee_id === riga.id && x.data === d) && !trasferte.some((x) => x.employeeId === riga.id && x.data === d)
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
                      className={`block rounded-md px-1 py-1 leading-tight ${riga.nuova ? 'bg-violet-100 text-violet-900' : 'ore_straordinario' in t && Number(t.ore_straordinario ?? 0) > 0 ? 'bg-amber-100 text-amber-950 ring-1 ring-inset ring-amber-400' : t.pubblicato ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-blue-200'}`}>
                      <span className="block font-semibold tabular-nums">{t.inizio.replace(/:00$/, '')}–{t.fine.replace(/:00$/, '')}</span>
                      <span className="block text-[10px] opacity-80">{fmt(ore)} h{'ore_straordinario' in t && Number(t.ore_straordinario ?? 0) > 0 ? ` · ${Number(t.ore_straordinario) >= ore - 1e-9 ? 'straord.' : `${fmt(Number(t.ore_straordinario))} straord.`}` : ''}</span>
                    </span>
                    {f && <span className="block mt-0.5 text-[10px] text-amber-800">{fTesto}</span>}
                  </>
                );
              }
              const tr = trasferte.find((x) => x.employeeId === riga.id && x.data === d);
              if (tr) {
                return (
                  <span title={`Trasferta ${tr.inizio}-${tr.fine}${tr.motivo ? `: ${tr.motivo}` : ''}`} className="block rounded-md px-1 py-1 bg-indigo-100 text-indigo-900 leading-tight">
                    <span className="block font-semibold">trasferta</span>
                    <span className="block text-[10px] truncate">{doveTrasferta(tr, nomeNegozioDi)} · {fmt(oreTrasferta(tr))} h</span>
                  </span>
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
                                <th className="sticky left-0 z-10 px-3 py-2 text-left bg-slate-50 border-b border-slate-200 font-semibold w-[170px] min-w-[150px]">Persona</th>
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
                              </tr>
                            </thead>
                            <tbody>
                              {righe.map((riga) => {
                                // Ore da contratto e ore programmate della settimana (Patrizio, 28/10/2026):
                                // lo straordinario concordato resta fuori dalle programmate e si conta a parte.
                                const suoiSett = riga.turni.filter((x) => nelMese.includes(x.data));
                                const straordSett = suoiSett.reduce((a, x) => a + ('ore_straordinario' in x ? Number(x.ore_straordinario ?? 0) : 0), 0);
                                const programmate = suoiSett.reduce((a, x) => a + oreDi(x), 0) - straordSett;
                                const daContratto = riga.nuova ? null : contrattoSettimanaOra(riga.id, lun, riga.oreSett);
                                const scarto = daContratto == null ? 0 : programmate - daContratto;
                                return (
                                  <tr key={riga.id} className={riga.nuova ? 'bg-violet-50/40' : ''}>
                                    <td className={`sticky left-0 z-10 px-3 py-1.5 border-b border-slate-100 ${riga.nuova ? 'text-violet-900 bg-violet-50' : 'text-slate-900 bg-white'} font-medium`}>
                                      {riga.nome}
                                      {riga.nuova && <span className="block text-[10px] font-normal text-violet-700">nuova, solo simulazione</span>}
                                      {daContratto != null ? (
                                        <span className="block text-[11px] font-normal tabular-nums" title={nelMese.length < 7 ? `Settimana a cavallo del mese: ${fmt(riga.oreSett ?? 0)} h in tutta la settimana, qui la parte di questo mese` : undefined}>
                                          <span className="text-slate-600">{fmt(programmate)} di {fmt(daContratto)} h</span>{' '}
                                          {Math.abs(scarto) <= 0.25 ? <span className="text-emerald-700 font-semibold">in linea</span>
                                            : scarto < 0 ? <span className="text-slate-700 font-semibold">mancano {fmt(-scarto)} h</span>
                                              : <span className="text-amber-800 font-semibold">{fmt(scarto)} h in più</span>}
                                          {straordSett > 0.25 && <span className="block text-amber-800">+ {fmt(straordSett)} h straordinario</span>}
                                        </span>
                                      ) : !riga.nuova && <span className="block text-[11px] font-normal text-slate-500">{fmt(programmate + straordSett)} h, a chiamata</span>}
                                    </td>
                                    {giorniSett.map((d) => {
                                      const gs = new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
                                      return <td key={d} className={`px-1 py-1.5 text-center border-b border-slate-100 ${gs >= 6 ? 'bg-slate-50/60' : ''}`}>{casellaCliccabile(riga, d)}</td>;
                                    })}
                                  </tr>
                                );
                              })}
                              <tr className="bg-slate-50/70">
                                <td className="sticky left-0 z-10 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">In negozio</td>
                                {giorniSett.map((d) => <td key={d} className="px-1 py-1.5 text-center align-top">{statoCopertura(d)}</td>)}
                              </tr>
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
                    Due numeri e la differenza. <b>Ore da contratto</b> = le ore a settimana di ogni settimana del mese (nelle settimane a cavallo di due mesi, la parte di questo mese) meno ferie, permessi e trasferte.
                    <b> Ore programmate</b> = ore dei turni di questo piano, senza lo straordinario concordato, che si conta a parte. Se le programmate sono meno, mancano ore da programmare; se sono di più, decidi se sono straordinario o se toglierle.
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50 border-b border-slate-200">
                          <th className="px-3 py-2">Persona</th>
                          <th className="px-3 py-2 text-right">Ore a settimana</th>
                          <th className="px-3 py-2">Ferie, permessi e trasferte</th>
                          <th className="px-3 py-2 text-right">Ore da contratto</th>
                          <th className="px-3 py-2 text-right">Ore programmate</th>
                          <th className="px-3 py-2">Differenza</th>
                        </tr>
                      </thead>
                      <tbody>
                        {righe.map((riga) => {
                          const r = pianoAperto.riepilogo.persone?.[riga.id];
                          const fatte = riga.turni.reduce((a, x) => a + oreDi(x), 0);
                          const segnate = riga.turni.reduce((a, x) => a + ('ore_straordinario' in x ? Number(x.ore_straordinario ?? 0) : 0), 0);
                          const ordinarie = fatte - segnate;
                          const suoFerie = ferieMese.filter((x) => x.employee_id === riga.id).sort((a, b) => a.data.localeCompare(b.data));
                          const oreFerie = suoFerie.reduce((a, x) => a + x.ore, 0);
                          const daLavorare = riga.nuova ? (r && !r.riserva ? r.contratto : null) : daLavorareOra(riga.id);
                          const ipo = ipot?.find((x) => x.nome === riga.nome);
                          const giorniFerie = suoFerie.filter((x) => x.tipo !== 'ore');
                          const permessi = suoFerie.filter((x) => x.tipo === 'ore');
                          // Le ore ordinarie coprono il contratto; quelle segnate straordinario si contano a parte.
                          const nonUsate = daLavorare != null ? Math.max(0, daLavorare - ordinarie) : 0;
                          // Programmate oltre il contratto: non sono straordinario finche' non si decide.
                          const inPiu = daLavorare != null ? Math.max(0, ordinarie - daLavorare) : 0;
                          const suoTrMese = trasferte.filter((x) => x.employeeId === riga.id && x.data.startsWith(mese)).reduce((a, x) => a + oreTrasferta(x), 0);
                          const lordo = r?.contrattoMese != null && !r.riserva ? r.contrattoMese : null;
                          return (
                            <tr key={riga.id} className={`border-b border-slate-100 align-top ${riga.nuova ? 'bg-violet-50/40' : ''}`}>
                              <td className="px-3 py-2 font-medium text-slate-900">{riga.nome}
                                {r?.riserva && <span className="block text-xs font-normal text-slate-500">a chiamata: solo dove manca qualcuno</span>}
                                {ipo?.ipotesi != null && <span className="block text-xs font-normal text-violet-700">simulazione: {fmt(ipo.ipotesi)} h invece di {ipo.oggi == null ? 'a chiamata' : `${fmt(ipo.oggi)} h`}</span>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{riga.oreSett == null ? '–' : `${fmt(ipo?.ipotesi ?? riga.oreSett)} h`}</td>
                              <td className="px-3 py-2 text-xs text-slate-700">
                                {oreFerie > 0.25 ? (
                                  <>
                                    <span className="font-semibold text-amber-800">{fmt(oreFerie)} h</span>
                                    {giorniFerie.length > 0 && <span className="block">ferie: {giorniFerie.map((x) => giornoCorto(x.data)).join(', ')}</span>}
                                    {permessi.length > 0 && <span className="block">permessi: {permessi.map((x) => `${giornoCorto(x.data)} (${fmt(x.ore)} h)`).join(', ')}</span>}
                                  </>
                                ) : <span className="text-slate-400">nessuna</span>}
                                {(() => {
                                  const suoTr = trasferte.filter((x) => x.employeeId === riga.id && x.data.startsWith(mese));
                                  return suoTr.length > 0 && <span className="block mt-0.5 text-indigo-800">trasferte: {fmt(suoTr.reduce((a, x) => a + oreTrasferta(x), 0))} h ({suoTr.map((x) => giornoCorto(x.data)).join(', ')})</span>;
                                })()}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <span className="font-semibold">{daLavorare != null ? `${fmt(daLavorare)} h` : '–'}</span>
                                {daLavorare != null && lordo != null && oreFerie + suoTrMese > 0.25 && !riga.nuova && (
                                  <span className="block text-xs font-normal text-slate-500">{fmt(lordo)} meno {fmt(oreFerie + suoTrMese)} di {suoTrMese > 0.25 && oreFerie > 0.25 ? 'ferie e trasferte' : suoTrMese > 0.25 ? 'trasferte' : 'ferie'}</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <span className="font-semibold">{fmt(ordinarie)} h</span>
                                {segnate > 0.25 && <span className="block text-xs text-amber-800">+ {fmt(segnate)} h straordinario</span>}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                {daLavorare == null ? (fatte > 0 ? <span className="text-slate-600">chiamata per i buchi</span> : <span className="text-slate-400">non chiamata</span>) : (
                                  <>
                                    {nonUsate > 0.25 ? (
                                      <span className="block text-slate-700"><b>Mancano {fmt(nonUsate)} h da programmare</b>
                                        <span className="block text-slate-500">{(r?.settimanePiene ?? 0) > 0
                                          ? `in ${r?.settimanePiene === 1 ? 'una settimana ha' : `${r?.settimanePiene} settimane ha`} già ${giorniMax} giorni di lavoro: le ore che restano non entrano in un altro giorno`
                                          : 'al negozio non servivano: il traffico di quei giorni era già coperto'}</span>
                                        {puoModificare && !pianoAperto.simulazione && !riga.nuova && nonUsate >= 1 && (
                                          <span className="mt-1.5 flex flex-wrap gap-1.5">
                                            <button type="button" onClick={() => apriDove(riga.id, riga.nome, nonUsate)}
                                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
                                              Dove metterle
                                            </button>
                                            <button type="button" onClick={() => apriProposta(riga.id, riga.nome, riga.oreSett, nonUsate)}
                                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200">
                                              Proponi ferie per {fmt(nonUsate)} h
                                            </button>
                                          </span>
                                        )}
                                        {puoModificare && <span className="block mt-1 text-blue-700">oppure clicca una casella del calendario per aggiungere ore</span>}
                                      </span>
                                    ) : inPiu > 0.25 ? (
                                      <span className="block text-amber-800"><b>{fmt(inPiu)} h in più del contratto</b>
                                        <span className="block">decidi se sono straordinario (apri il turno e segnalo) oppure se le togli</span>
                                      </span>
                                    ) : <span className="block text-emerald-700 font-medium">In linea con il contratto</span>}
                                    {segnate > 0.25 && <span className="block mt-1 text-amber-800">Straordinario concordato: {fmt(segnate)} h, a parte</span>}
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
      {dove && (
        <Modal open onClose={() => setDove(null)} title={`Dove mettere le ore di ${dove.nome}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Restano <b>{fmt(dove.ore)} ore</b>. Queste sono le finestre del mese con più ingressi MODA per persona già in negozio, nei giorni in cui {dove.nome.split(' ')[0]} può lavorare e non ha un turno.
              Scegli se aggiungerle come <b>ore di contratto</b> del mese (riducono le ore non usate) o come <b>straordinario</b> (si contano a parte).
            </p>
            {dove.finestre == null ? <p className="text-sm text-slate-400">Calcolo sul traffico MODA…</p>
              : !dove.finestre.length ? <p className="text-sm text-slate-500">Nessun giorno libero adatto in questo mese.</p> : (
                <ul className="space-y-2">
                  {dove.finestre.map((f, k) => {
                    const t = tipoDelGiorno(f.data);
                    const speciale = !['feriale', 'venerdi', 'sabato', 'domenica'].includes(t.tipo);
                    return (
                      <li key={f.data} className={`rounded-lg border p-3 ${k === 0 ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200'}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold text-slate-900 capitalize">
                            {new Date(`${f.data}T00:00:00Z`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}
                            {speciale && <span className="ml-2 text-xs font-semibold text-red-700 normal-case">{t.nome}</span>}
                            {k === 0 && <span className="ml-2 text-xs font-semibold text-blue-700 normal-case">la migliore</span>}
                          </span>
                          <span className="text-sm text-slate-700 tabular-nums">{f.inizio}–{f.fine} · <b>{fmt(f.ore)} h</b>{f.pausaMinuti ? ` · pausa ${f.pausaMinuti}'` : ''}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">circa {fmt(f.ingressiPerPersona)} ingressi l'ora per persona in negozio</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" disabled={lavoro === 'dove'} onClick={() => aggiungiFinestra(f, false)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Aggiungi come ore di contratto</button>
                          <button type="button" disabled={lavoro === 'dove'} onClick={() => aggiungiFinestra(f, true)}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50">Aggiungi come straordinario</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            <p className="text-xs text-slate-500">Il turno si aggiunge in bozza al piano e si può poi spostare cliccando la casella del calendario.</p>
          </div>
        </Modal>
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
            conto={(() => {
              const lun = lunediDi(editorMese.data);
              const giorniSett = giorniDellaSettimana(lun).filter((d) => d.startsWith(mese));
              const altriSett = altri.filter((x) => giorniSett.includes(x.data));
              const oreSett = oreOggi(persone.find((x) => x.scheda.id === editorMese.employeeId)?.perGiorno ?? []);
              const breve = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
              return {
                daLavorare: daLavorareOra(editorMese.employeeId),
                ordinarieAltri: altri.reduce((a, x) => a + ore(x) - Number(x.ore_straordinario ?? 0), 0),
                straordinarioAltri: altri.reduce((a, x) => a + Number(x.ore_straordinario ?? 0), 0),
                settimana: {
                  daLavorare: contrattoSettimanaOra(editorMese.employeeId, lun, oreSett),
                  ordinarieAltri: altriSett.reduce((a, x) => a + ore(x) - Number(x.ore_straordinario ?? 0), 0),
                  straordinarioAltri: altriSett.reduce((a, x) => a + Number(x.ore_straordinario ?? 0), 0),
                  etichetta: `dal ${breve(giorniSett[0])} al ${breve(giorniSett[giorniSett.length - 1])}`,
                },
              };
            })()}
            ferie={(() => {
              const oreSett = oreOggi(persone.find((x) => x.scheda.id === editorMese.employeeId)?.perGiorno ?? []);
              return oreSett == null ? undefined : {
                oreSettimana: oreSett, outletCode: dati.negozi.find((n) => n.id === outletId)?.code ?? null,
                giaInFerie: ferieMese.some((x) => x.employee_id === editorMese.employeeId && x.data === editorMese.data && x.tipo === 'giornata'),
                esistente: (() => {
                  const f = ferieMese.find((x) => x.employee_id === editorMese.employeeId && x.data === editorMese.data);
                  return f ? {
                    id: f.id, requestId: f.request_id, statoRichiesta: f.stato_richiesta,
                    testo: f.tipo === 'giornata' ? `Giornata di ferie (${fmt(f.ore)} h)` : f.tipo === 'mezza_giornata' ? `Mezza giornata di ferie (${fmt(f.ore)} h)` : `Permesso di ${fmt(f.ore)} h`,
                  } : null;
                })(),
              };
            })()}
            trasferta={{
              negozi: dati.negozi.filter((n) => n.is_active !== false).map((n) => ({ id: n.id, nome: nomeNegozioDi(n.id) })),
              esistente: trasferte.find((x) => x.employeeId === editorMese.employeeId && x.data === editorMese.data) ?? null,
            }}
            onClose={() => setEditorMese(null)}
            onSalvato={(msg) => { setEditorMese(null); setVersione((v) => v + 1); toast({ type: 'success', message: msg ?? 'Turno salvato: il riepilogo delle ore è aggiornato.' }); }}
          />
        );
      })()}
    </div>
  );
}
