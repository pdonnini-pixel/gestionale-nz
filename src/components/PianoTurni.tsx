// «Piano settimanale»: i turni di un negozio, persone per giorni.
//
// Chi c'e' viene dall'organico di oggi (anagrafica + cambiamenti), meno le
// ferie approvate a giornata intera. «Proponi i turni» rifa' solo le
// proposte in bozza: i turni messi a mano e quelli gia' pubblicati restano.
// Ogni modifica fatta su un turno lo rende «manuale», e il ricalcolo non lo
// tocca piu'. Sotto ogni giorno: se la copertura basta o cosa manca.
//
// Il fabbisogno viene dal traffico MODA come nel piano del mese (Patrizio,
// 29/10/2026): le ore delle persone disponibili nella settimana distribuite
// come gli ingressi attesi. Quello di «Regole e orari» vale solo per un
// negozio senza traffico (né suo né la forma media degli altri).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Copy, Info, Mail, MessageCircle, Printer, RefreshCw, Send, Trash2 } from 'lucide-react';
import { almenoDuePersone, attesoDelleDate, fabbisognoDaTraffico, tettoDelLunedi, type StoricoTraffico } from '../lib/pianoMensile';
import EditorTurno from './EditorTurno';
import { giornoDiPubblicazione, riallineaStraordinariForti } from '../lib/straordinariDb';
import SpostaTurnoModal from './SpostaTurnoModal';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import {
  personaAllaData, nomePersona, formattaDataBreve, oggiRoma, aggiungiGiorni, presenzaNeiTurni,
  type PersonaOggi,
} from '../lib/organico';
import { caricaDisponibilita, caricaGiorniFerie, caricaStoricoNegozio, nomeNegozio as nomeDelNegozio, puoLavorareIl, type DatiOrganico } from '../lib/organicoDati';
import { ottimizzaSettimana, scegliGiorniLiberi, derogheSettimana, ripartisciStraordinari, sceltePerLaSettimana } from '../lib/ottimizzaTurni';
import { eventoDaRiga } from '../lib/eventiTurni';
import { guidaConRipiego } from '../lib/guidaNegozio';
import { caricaGiorniLiberi, salvaGiorniLiberiDiSistema, impostaGiornoLibero, caricaCoppiePrima, caricaLunediPrima, guidaDelNegozio, caricaRiposi, caricaEventi, type GiornoLibero, type RiposiPersone } from '../lib/regoleNuoveDb';
import { cosaMancaAllaGuida, etichettaRuoloGuida, ruoloGuida } from '../lib/guidaNegozio';
import { getCurrentTenant } from '../lib/tenants';
import { fasceDelle, fasciaIl, type Accordo } from '../lib/accordiOrario';
import { avvisiMossa as avvisiDellaMossa, esitoMossa, mossePossibili, type ContestoSpostamenti, type MossaTurno } from '../lib/spostaTurni';
import { eseguiMossaSuShifts } from '../lib/spostaTurniDb';
import { caricaTrasferte, copertureVerso, oreTrasferta, type Trasferta } from '../lib/trasferte';
import {
  NOMI_GIORNO, NOMI_GIORNO_BREVI, REGOLE_DEFAULT, costruisciGiorni, giornoPieno, opzioniGiorni, oreInChiaro, regoleDaRiga, pausaPer, giorniDellaSettimana, lunediDi, oreLavorate,
  proponiSettimana, scopertureDelGiorno, minuti, eventiDelNegozio, personeInPiu, type EventoNegozio, type GiornoPiano, type RegoleTurni, type Turno,
  giornoIso,
} from '../lib/turni';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  dati: DatiOrganico;
  puoScrivere: boolean;
  onVaiOrari: () => void;
  /** il passo scelto nella pagina Turni: al 3 «Pubblica e invia» sta in evidenza */
  passo?: 2 | 3;
};

type TurnoDb = {
  id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number; plan_id: string | null;
  origine: 'proposta' | 'manuale'; stato: 'bozza' | 'pubblicato' | 'annullato'; annullato_motivo: string | null;
  straordinario?: boolean; ore_straordinario?: number; straordinario_motivo?: string | null; updated_at?: string;
  straordinario_a_mano?: boolean | null; pubblicato_il?: string | null;
};

const t5 = (t: string) => t.slice(0, 5);
const NOMI_MESE_LUNGHI = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
// Nei turni contano le ferie approvate e anche quelle chieste e in attesa
// (Patrizio, 20/10/2026: «prendile in considerazione»): una richiesta
// respinta torna disponibile al ricalcolo, un giorno respinto no.
const STATI_FERIE_APPROVATE = ['inviata', 'approvata', 'approvata_parziale', 'chiusa'];
const GIORNI_FERIE_VALIDI = ['richiesto', 'approvato'];

export default function PianoTurni({ companyId, outletId, nomeNegozio, dati, puoScrivere, onVaiOrari, passo = 2 }: Props) {
  const { toast } = useToast();
  const [lunedi, setLunedi] = useState(lunediDi(oggiRoma()));
  // La settimana si ferma all'ultimo giorno del mese e riparte dal primo (Patrizio,
  // 11/11/2026): a cavallo di due mesi si vedono due pezzi, uno per mese. Le ore dei
  // giorni dell'altro mese si portano dietro nella colonna Ore.
  const [mese, setMese] = useState(oggiRoma().slice(0, 7));
  const settimana = useMemo(() => giorniDellaSettimana(lunedi), [lunedi]);
  const date = useMemo(() => {
    const d = settimana.filter((x) => x.startsWith(mese));
    return d.length ? d : settimana.filter((x) => x.startsWith(settimana[0].slice(0, 7)));
  }, [settimana, mese]);
  const ultimo = date[date.length - 1];
  const fuori = useMemo(() => settimana.filter((x) => !date.includes(x)), [settimana, date]);
  const vaiAvanti = () => {
    if (ultimo === settimana[6]) { const l = aggiungiGiorni(lunedi, 7); setLunedi(l); setMese(l.slice(0, 7)); }
    else setMese(settimana[6].slice(0, 7));
  };
  const vaiIndietro = () => {
    if (date[0] === settimana[0]) { const l = aggiungiGiorni(lunedi, -7); setLunedi(l); setMese(aggiungiGiorni(l, 6).slice(0, 7)); }
    else setMese(settimana[0].slice(0, 7));
  };
  const vaiAOggi = () => { setLunedi(lunediDi(oggiRoma())); setMese(oggiRoma().slice(0, 7)); };
  const eOggi = lunedi === lunediDi(oggiRoma()) && date.includes(oggiRoma());
  // Giorni con orari e fabbisogno di «Regole e orari»; quello vero si ricalcola da MODA sotto.
  const [giorniBase, setGiorniBase] = useState<GiornoPiano[]>([]);
  const [extra, setExtra] = useState<Map<string, number>>(new Map());
  const [storico, setStorico] = useState<{ storico: StoricoTraffico; propria: boolean; fonte?: 'propria' | 'riferimento' | 'media'; riferimentoId?: string | null } | null>(null);
  // Ore gia' nei turni dei giorni dell'altro mese della stessa settimana, per persona.
  const [oreFuori, setOreFuori] = useState<Map<string, number>>(new Map());
  const [giorniFuori, setGiorniFuori] = useState<Map<string, number>>(new Map());
  // Giorno libero fisso di ognuno (migration 395); dove la tabella manca la riga non compare.
  const [giorniLiberi, setGiorniLiberi] = useState<Map<string, GiornoLibero>>(new Map());
  const [haGiorniLiberi, setHaGiorniLiberi] = useState(false);
  // Giorni di riposo preferiti e vietati di ognuno (12/11/2026, migration 405).
  const [riposi, setRiposi] = useState<RiposiPersone>({ preferiti: new Map(), mai: new Map(), disponibile: false });
  const [storicoPronto, setStoricoPronto] = useState(false);
  const [haOrari, setHaOrari] = useState(true);
  const [haFasce, setHaFasce] = useState(true);
  const [orariStimati, setOrariStimati] = useState(false);
  const [fasceStimate, setFasceStimate] = useState(false);
  const [regole, setRegole] = useState<RegoleTurni>(REGOLE_DEFAULT);
  const [turni, setTurni] = useState<TurnoDb[]>([]);
  const [ferie, setFerie] = useState<Awaited<ReturnType<typeof caricaGiorniFerie>>>([]);
  // Ore di ferie e permessi gia' maturate e non godute, per persona (tabulato dello studio).
  const [saldi, setSaldi] = useState<Map<string, number>>(new Map());
  const [caricamento, setCaricamento] = useState(true);
  const [lavoro, setLavoro] = useState(false);
  // Piano del mese scelto per ogni mese della settimana ('YYYY-MM' -> id).
  const [pianiScelti, setPianiScelti] = useState<Map<string, string>>(new Map());
  const [disponibilita, setDisponibilita] = useState<Map<string, Accordo>>(new Map());
  const [trasferte, setTrasferte] = useState<Trasferta[]>([]);
  const [editor, setEditor] = useState<{ employeeId: string; data: string; turno: TurnoDb | null } | null>(null);
  // Il motivo dello straordinario (migration 399): dove la colonna manca non si legge e non si scrive.
  const [haMotivo, setHaMotivo] = useState(false);
  useEffect(() => {
    let vivo = true;
    supabase.from('shifts').select('straordinario_motivo').limit(1).then((r) => { if (vivo) setHaMotivo(!r.error); });
    return () => { vivo = false; };
  }, [companyId]);
  // Straordinario scritto a mano e giorno di pubblicazione (migration 408): dove le colonne
  // mancano non si leggono, non si scrivono e lo straordinario non si ricalcola.
  const [ha408, setHa408] = useState(false);
  useEffect(() => {
    let vivo = true;
    supabase.from('shifts').select('straordinario_a_mano, pubblicato_il' as never).limit(1).then((r) => { if (vivo) setHa408(!r.error); });
    return () => { vivo = false; };
  }, [companyId]);
  // Le persone a cui ricalcolare lo straordinario, per negozio e settimana: se un ricalcolo
  // non arriva in fondo restano qui e si riprova al salvataggio dopo.
  const daRicalcolare = useRef(new Map<string, Set<string>>());
  const [straordNonTorna, setStraordNonTorna] = useState<string[]>([]);
  // Turno trascinato e mossa da confermare (Patrizio, 29/10/2026: come nel piano del mese).
  const [trascinato, setTrascinato] = useState<string | null>(null);
  const [mossa, setMossa] = useState<{ turno: TurnoDb; versoId: string; versoData: string } | null>(null);

  // Il traffico MODA del negozio (o la forma media degli altri) non dipende dalla
  // settimana ed e' lungo da leggere (decine di pagine): si carica una volta per
  // negozio, non a ogni modifica. Prima stava in carica() e ogni «Salva» lasciava
  // la tabella sui dati vecchi per 4 secondi (Patrizio, 11/11/2026: «mi chiede 2
  // volte il salva»; a Roma Soratte ne e' nato un turno doppio).
  useEffect(() => {
    let vivo = true;
    setStoricoPronto(false);
    caricaStoricoNegozio(companyId, outletId).catch(() => null).then((st) => {
      if (!vivo) return;
      setStorico(st);
      setStoricoPronto(true);
    });
    return () => { vivo = false; };
  }, [companyId, outletId]);

  // I turni della settimana: quelli del piano scelto per quel mese, oppure quelli
  // fatti settimana per settimana.
  const leggiTurni = useCallback(async (pianoDelMese: Map<string, string>): Promise<TurnoDb[]> => {
    const { data, error } = await supabase.from('shifts')
      .select(`id, employee_id, data, inizio, fine, pausa_minuti, origine, stato, annullato_motivo, plan_id, straordinario, ore_straordinario, updated_at${haMotivo ? ', straordinario_motivo' : ''}${ha408 ? ', straordinario_a_mano, pubblicato_il' : ''}`)
      .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', date[0]).lte('data', ultimo).order('inizio');
    if (error) throw error;
    return ((data as unknown as TurnoDb[]) ?? [])
      .filter((x) => (x.plan_id ?? null) === (pianoDelMese.get(x.data.slice(0, 7)) ?? null))
      .map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine) }));
  }, [companyId, outletId, date, ultimo, haMotivo, ha408]);

  // Dopo una modifica ai turni si rileggono solo i turni: una richiesta, la
  // tabella e' aggiornata subito.
  const ricaricaTurni = useCallback(async () => {
    try {
      setTurni(await leggiTurni(pianiScelti));
    } catch (e) {
      toast({ type: 'error', message: `Turni non ricaricati: ${e instanceof Error ? e.message : 'errore'}` });
    }
  }, [leggiTurni, pianiScelti, toast]);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const [o, f, s, r, fe, sl, ev, pi, disp, tr] = await Promise.all([
        supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude, origine').eq('outlet_id', outletId),
        supabase.from('outlet_staffing_needs').select('giorno, dalle, alle, persone, origine').eq('outlet_id', outletId),
        supabase.from('outlet_special_days').select('data, chiuso, apre, chiude, persone_extra, nota').eq('outlet_id', outletId).gte('data', date[0]).lte('data', ultimo),
        supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
        caricaGiorniFerie(companyId, date[0], ultimo),
        supabase.from('v_leave_disponibilita').select('employee_id, residuo_disponibile').eq('company_id', companyId),
        // Eventi della settimana (Black Friday, feste, saldi): piu' persone e straordinari se mancano
        // (con le regole dei periodi speciali dove ci sono: migration 405)
        caricaEventi(companyId, date[0], ultimo),
        // Piani del mese scelti per i mesi di questa settimana: nei loro giorni valgono i loro turni.
        supabase.from('shift_plans').select('id, mese').eq('outlet_id', outletId).eq('stato', 'scelto')
          .in('mese', [...new Set([date[0], ultimo].map((d) => `${d.slice(0, 7)}-01`))]),
        caricaDisponibilita(companyId).catch(() => new Map<string, Accordo>()),
        caricaTrasferte(companyId, date[0], ultimo).catch(() => [] as Trasferta[]),
      ]);
      // Giorno libero fisso di ognuno e ore gia' nei turni dei giorni dell'altro mese
      // (in qualunque negozio; le bozze dei piani non scelti non contano).
      const [gl, rp, fu] = await Promise.all([
        caricaGiorniLiberi(companyId),
        caricaRiposi(companyId).catch(() => ({ preferiti: new Map<string, number[]>(), mai: new Map<string, number[]>(), disponibile: false })),
        fuori.length
          ? supabase.from('shifts').select('employee_id, data, inizio, fine, pausa_minuti, plan_id, shift_plans(stato)').eq('company_id', companyId).in('data', fuori).neq('stato', 'annullato')
          : Promise.resolve({ data: [], error: null }),
      ]);
      setGiorniLiberi(gl.mappa);
      setHaGiorniLiberi(gl.disponibile);
      setRiposi(rp);
      const portate = new Map<string, number>();
      const giorniPortati = new Map<string, Set<string>>();
      for (const x of ((fu.data as unknown as { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null; plan_id: string | null; shift_plans: { stato: string } | { stato: string }[] | null }[]) ?? [])) {
        const pl = Array.isArray(x.shift_plans) ? x.shift_plans[0] : x.shift_plans;
        if (x.plan_id && pl?.stato !== 'scelto') continue;
        portate.set(x.employee_id, (portate.get(x.employee_id) ?? 0) + oreLavorate({ inizio: t5(x.inizio), fine: t5(x.fine), pausaMinuti: x.pausa_minuti ?? 0 }));
        giorniPortati.set(x.employee_id, (giorniPortati.get(x.employee_id) ?? new Set<string>()).add(x.data));
      }
      setOreFuori(portate);
      setGiorniFuori(new Map([...giorniPortati].map(([id, g]) => [id, g.size])));
      setDisponibilita(disp);
      setTrasferte(tr);
      const pianoDelMese = new Map(((pi.data as { id: string; mese: string }[]) ?? []).map((x) => [x.mese.slice(0, 7), x.id]));
      setPianiScelti(pianoDelMese);
      const turniLetti = await leggiTurni(pianoDelMese);
      const orari = (o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [];
      const fasce = (f.data as { giorno: number; dalle: string; alle: string; persone: number }[]) ?? [];
      const speciali = (s.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [];
      const eventi = eventiDelNegozio(ev.righe.map(eventoDaRiga) as EventoNegozio[], outletId);
      const regoleLette = regoleDaRiga(r.data as Parameters<typeof regoleDaRiga>[0]);
      setHaOrari(orari.length > 0);
      setOrariStimati(orari.some((x) => (x as { origine?: string }).origine === 'stima'));
      setFasceStimate(fasce.some((x) => (x as { origine?: string }).origine === 'stima'));
      setHaFasce(fasce.some((x) => x.persone > 0));
      // le scelte del negozio sui giorni caldi (12/11/2026): dove sono spente i giorni restano quelli di prima
      setGiorniBase(costruisciGiorni(date, orari, fasce, speciali, eventi, dati.negozi.find((n) => n.id === outletId)?.opening_date ?? null, opzioniGiorni(regoleLette)));
      setExtra(personeInPiu(date, speciali, eventi));
      setRegole(regoleLette);
      setTurni(turniLetti);
      setFerie(fe);
      const m = new Map<string, number>();
      for (const x of ((sl.data as { employee_id: string | null; residuo_disponibile: number | null }[]) ?? [])) {
        if (x.employee_id) m.set(x.employee_id, (m.get(x.employee_id) ?? 0) + Number(x.residuo_disponibile ?? 0));
      }
      setSaldi(m);
    } catch (e) {
      toast({ type: 'error', message: `Turni non caricati: ${e instanceof Error ? e.message : 'errore'}` });
    } finally {
      setCaricamento(false);
    }
  }, [companyId, outletId, date, ultimo, fuori, toast, leggiTurni]);

  useEffect(() => { carica(); }, [carica]);

  // Chi lavora in questo negozio nella settimana, giorno per giorno.
  const persone = useMemo(() => {
    const out: { scheda: PersonaOggi['scheda']; perGiorno: PersonaOggi[]; ore: number | null; inForza: boolean; finoAl: string | null }[] = [];
    for (const s of dati.schede) {
      const perGiorno = date.map((d) => personaAllaData(s, dati.eventi, d));
      // chi non e' piu' in servizio non si vede (Patrizio, 12/11/2026); resta, segnalata, solo chi ha ancora un turno salvato in questi giorni
      const presenza = presenzaNeiTurni(perGiorno, date, outletId, turni.some((t) => t.employee_id === s.id && t.stato !== 'annullato'));
      if (!presenza) continue;
      const oreSett = perGiorno.find((p) => p.outletId === outletId && p.stato === 'in_servizio')?.ore ?? perGiorno[0].ore;
      out.push({ scheda: s, perGiorno, ore: oreSett, ...presenza });
    }
    return out.sort((a, b) => nomePersona(a.scheda).localeCompare(nomePersona(b.scheda), 'it'));
  }, [dati, date, outletId, turni]);

  const inFerie = useCallback((empId: string, data: string) => ferie.find((f) => f.employee_id === empId && f.data === data
    && STATI_FERIE_APPROVATE.includes(f.stato_richiesta) && GIORNI_FERIE_VALIDI.includes(f.stato_giorno)), [ferie]);

  const motivoNonDisponibile = useCallback((pg: PersonaOggi, empId: string, data: string): string | null => {
    if (pg.stato === 'assente') return pg.assenza?.motivo ?? 'assente';
    if (pg.stato === 'cessato') return 'non più in forza';
    if (pg.stato === 'non_ancora_assunto') return 'non ancora assunta';
    if (pg.stato === 'scaduto') return 'contratto scaduto';
    if (pg.outletId !== outletId) return 'in un altro negozio';
    const fe = inFerie(empId, data);
    if (fe && fe.tipo === 'giornata') return 'ferie';
    // Trasferta: lavora fuori dal negozio, quel giorno niente turno qui.
    if (trasferte.some((x) => x.employeeId === empId && x.data === data)) return 'in trasferta';
    // Giorni in cui la persona puo' lavorare (es. solo sabato e domenica).
    if (!puoLavorareIl(disponibilita, empId, data)) return 'non disponibile quel giorno';
    return null;
  }, [outletId, inFerie, disponibilita, trasferte]);

  // Chi entra nella proposta, con le ore che puo' lavorare in settimana.
  const candidati = useMemo(() => persone
    .filter((p) => p.ore != null && p.ore > 0)
    .map((p) => ({
      id: p.scheda.id,
      // le ore gia' coperte da ferie e permessi approvati in settimana non si lavorano
      ore: Math.max(0, (p.ore as number) - date.reduce((a, d) => a + Number(inFerie(p.scheda.id, d)?.ore ?? 0), 0)
        // le ore di trasferta sono lavoro gia' fatto fuori dal negozio
        - trasferte.filter((x) => x.employeeId === p.scheda.id).reduce((a, x) => a + oreTrasferta(x), 0)
        // le ore gia' nei turni dei giorni dell'altro mese della stessa settimana
        - (oreFuori.get(p.scheda.id) ?? 0)),
      nonDisponibile: new Set(date.filter((d, i) => motivoNonDisponibile(p.perGiorno[i], p.scheda.id, d) != null)),
      saldoOre: saldi.get(p.scheda.id) ?? 0,
      // accordi della scheda: le fasce orarie in cui puo' lavorare
      fasce: fasceDelle(disponibilita, p.scheda.id, date),
    })), [persone, date, inFerie, trasferte, motivoNonDisponibile, saldi, disponibilita, oreFuori]);

  // Il fabbisogno dal traffico MODA, come nel piano del mese: ingressi attesi
  // diviso la soglia di ingressi per addetto, almeno una persona, al massimo le
  // persone disponibili quel giorno, piu' le persone in piu' di eventi e giorni speciali.
  const moda = useMemo(() => (storico ? attesoDelleDate(storico.storico, date) : null), [storico, date]);
  const usaModa = !!moda && moda.atteso.size > 0;
  const giorni = useMemo(() => {
    // senza traffico MODA comandano le fasce di «Orari e fabbisogno»: il lunedi' a due vale lo stesso
    if (!moda || !moda.atteso.size) return giorniBase.map((g) => tettoDelLunedi(g, regole));
    const maxP = new Map(date.map((d) => [d, candidati.filter((p) => !p.nonDisponibile.has(d)).length]));
    return fabbisognoDaTraffico(giorniBase, moda.atteso, regole, maxP, extra);
  }, [giorniBase, moda, candidati, date, extra, regole]);
  const haFabbisogno = usaModa || haFasce;
  const stimati = orariStimati || (!usaModa && fasceStimate);

  const attivi = turni.filter((t) => t.stato !== 'annullato');
  const turniPerCalcolo: Turno[] = attivi.map((t) => ({ employeeId: t.employee_id, data: t.data, inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }));
  const esclusiDallaProposta = persone.filter((p) => p.ore == null || p.ore <= 0);

  const meseFuori = fuori.length ? NOMI_MESE_LUNGHI[Number(fuori[0].slice(5, 7))] : '';
  // Responsabile e vice del negozio: il lunedi' almeno una delle due in turno.
  const negozio = dati.negozi.find((n) => n.id === outletId);
  // Dove il negozio ha i giorni caldi, finche' responsabile o vice non sono caricate il sistema usa
  // chi ha piu' ore di contratto e, a parita', chi e' assunta da piu' tempo (Patrizio, 12/11/2026).
  const guidaTurni = regole.giorniPieni
    ? guidaConRipiego(negozio?.referente_employee_id ?? null, negozio?.vice_referente_employee_id ?? null,
      candidati.map((c) => ({ id: c.id, ore: c.ore, assunta: dati.schede.find((x) => x.id === c.id)?.data_assunzione ?? null })))
    : { responsabile: negozio?.referente_employee_id ?? null, vice: negozio?.vice_referente_employee_id ?? null, provvisoria: { responsabile: false, vice: false } };
  const guida = regole.giorniPieni
    ? (guidaTurni.responsabile && guidaTurni.vice ? [guidaTurni.responsabile, guidaTurni.vice] : [])
    : guidaDelNegozio(negozio);
  // Dove il negozio ha scritto i riposi minimi il sistema non fissa piu' un giorno: valgono solo quelli decisi a mano.
  const riposoATurnazione = regole.riposiMinSettimana != null;
  const liberiValidi = new Map([...giorniLiberi].filter(([, g]) => !riposoATurnazione || g.origine === 'manuale').map(([id, g]) => [id, g.giorno]));
  // I riposi per il motore: i giorni preferiti e vietati della tabella nuova, piu' il giorno libero
  // deciso a mano con il selettore di questa pagina (finche' resta), che vale come un preferito.
  const riposiMotore = useMemo(() => {
    const preferiti = new Map(riposi.preferiti);
    if (riposoATurnazione) for (const [id, g] of liberiValidi) if (g >= 1 && g <= 5) preferiti.set(id, [...new Set([...(preferiti.get(id) ?? []), g])]);
    return preferiti.size || riposi.mai.size ? { preferiti, mai: riposi.mai } : undefined;
  }, [riposi, giorniLiberi, riposoATurnazione]); // eslint-disable-line react-hooks/exhaustive-deps
  const mancaGuida = dati.viceDisponibile ? cosaMancaAllaGuida(negozio?.referente_employee_id ?? null, negozio?.vice_referente_employee_id ?? null) : null;
  // Il lunedi' a due persone (Patrizio, 12/11/2026): le coppie dei lunedi' prima, per la rotazione.
  const [lunediPrima, setLunediPrima] = useState<string[]>([]);
  useEffect(() => {
    let vivo = true;
    if (!regole.lunediDue || !companyId || !outletId || !date[0]) { setLunediPrima([]); return; }
    caricaLunediPrima(companyId, outletId, date[0]).then((l) => { if (vivo) setLunediPrima(l); }).catch(() => undefined);
    return () => { vivo = false; };
  }, [regole.lunediDue, companyId, outletId, date[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  // Le regole che i turni della settimana non rispettano: le modifiche a mano
  // restano possibili, ma la deroga si vede (Patrizio, 11/11/2026).
  const deroghe = useMemo(() => (attivi.length ? derogheSettimana({
    giorni, turni: turniPerCalcolo,
    persone: candidati.map((c) => ({ ...c, nome: nomePersona(dati.schede.find((s) => s.id === c.id) ?? { nome: '', cognome: '' }) })),
    regole,
    giornoLibero: riposoATurnazione ? undefined : liberiValidi,
    guida: { responsabile: guidaTurni.responsabile, vice: guidaTurni.vice },
    riposi: sceltePerLaSettimana({ giorni, regole, riposi: riposiMotore, giorniFuori: 7 - date.length }).riposi,
    lunediPrima,
  }) : []), [attivi.length, giorni, turni, candidati, regole, giorniLiberi, riposiMotore, guida.join('|'), dati.schede, lunediPrima]); // eslint-disable-line react-hooks/exhaustive-deps

  const cambiaGiornoLibero = async (employeeId: string, giorno: number | null) => {
    try {
      await impostaGiornoLibero(companyId, employeeId, giorno);
      setGiorniLiberi((m) => {
        const n = new Map(m);
        if (giorno == null) n.delete(employeeId); else n.set(employeeId, { giorno, origine: 'manuale' });
        return n;
      });
    } catch (e) {
      toast({ type: 'error', message: `Giorno libero non salvato: ${e instanceof Error ? e.message : 'errore'}` });
    }
  };

  // Il PDF dell'orario della settimana, con la grafica dell'azienda (Patrizio, 11/11/2026).
  const foglioSettimana = () => {
      const tenant = getCurrentTenant();
      const orarioDi = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const visibili = persone.filter((p) => attivi.some((t) => t.employee_id === p.scheda.id) || p.perGiorno.some((pg) => pg.outletId === outletId && pg.stato === 'in_servizio'));
      const pubblicati = attivi.filter((t) => t.stato === 'pubblicato');
      const tuttiPubblicati = attivi.length > 0 && pubblicati.length === attivi.length;
      const dati0 = {
        marchio: tenant.alias === 'newzago' ? 'newzago' as const : 'testo' as const,
        azienda: tenant.displayName,
        negozio: nomeNegozio,
        giorni: settimana.map((d) => {
          const g = giorni.find((x) => x.data === d);
          return { data: d, nelMese: date.includes(d), chiuso: g ? g.chiuso : false, apre: g && !g.chiuso ? orarioDi(g.apre) : null, chiude: g && !g.chiuso ? orarioDi(g.chiude) : null, evento: g?.evento ?? null };
        }),
        persone: visibili.map((p) => ({
          nome: nomePersona(p.scheda),
          ruolo: ruoloGuida(p.scheda.id, negozio?.referente_employee_id ?? null, negozio?.vice_referente_employee_id ?? null),
          oreSettimana: p.ore,
          turni: Object.fromEntries(date.map((d) => [d, attivi.filter((t) => t.employee_id === p.scheda.id && t.data === d)
            .map((t) => ({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti ?? 0, oreStraordinario: Number(t.ore_straordinario ?? 0) || undefined }))])),
          assenze: Object.fromEntries(date.flatMap((d, i) => {
            const nd = motivoNonDisponibile(p.perGiorno[i], p.scheda.id, d);
            return nd && !attivi.some((t) => t.employee_id === p.scheda.id && t.data === d) ? [[d, nd]] : [];
          })),
        })),
        pubblicatoIl: tuttiPubblicati ? giornoDiPubblicazione(pubblicati) ?? oggiRoma() : null,
        oggi: oggiRoma(),
      };
      return dati0;
  };
  const stampa = async () => {
    setLavoro(true);
    try {
      const { creaPdfOrario, nomeFileOrario } = await import('../lib/stampaOrario');
      const dati0 = foglioSettimana();
      creaPdfOrario(dati0).save(nomeFileOrario(dati0));
    } catch (e) {
      toast({ type: 'error', message: `PDF non creato: ${e instanceof Error ? e.message : 'errore'}` });
    } finally {
      setLavoro(false);
    }
  };
  // Tutto il mese in un solo PDF, una pagina per settimana (Patrizio, 12/11/2026). Le persone e gli
  // orari di apertura sono quelli della settimana a schermo; i turni sono quelli salvati nel mese.
  const stampaMese = async () => {
    setLavoro(true);
    try {
      const { creaPdfOrari, nomeFileOrarioMese } = await import('../lib/stampaOrario');
      const base = foglioSettimana();
      const mese = date[0].slice(0, 7);
      const primo = `${mese}-01`;
      const ultimoDelMese = new Date(Date.UTC(Number(mese.slice(0, 4)), Number(mese.slice(5, 7)), 0)).toISOString().slice(0, 10);
      const { data, error } = await supabase.from('shifts')
        .select(`employee_id, data, inizio, fine, pausa_minuti, plan_id, stato, ore_straordinario, updated_at${ha408 ? ', pubblicato_il' : ''}`)
        .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', primo).lte('data', ultimoDelMese).neq('stato', 'annullato').order('inizio');
      if (error) throw error;
      const piano = pianiScelti.get(mese) ?? null;
      const delMese = ((data as unknown as { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null; plan_id: string | null; stato: string; ore_straordinario: number | null; updated_at: string | null; pubblicato_il?: string | null }[]) ?? [])
        .filter((x) => (x.plan_id ?? null) === piano);
      if (!delMese.length) { toast({ type: 'info', message: `Nessun turno salvato per ${NOMI_MESE_LUNGHI[Number(mese.slice(5, 7))]}: prepara prima il mese.` }); return; }
      const orarioDi = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const tipo = new Map(giorni.map((g) => [g.giorno, g]));
      const visibili = persone.filter((p) => delMese.some((t) => t.employee_id === p.scheda.id) || p.perGiorno.some((pg) => pg.outletId === outletId && pg.stato === 'in_servizio'));
      const fogli = [];
      for (let lun = lunediDi(primo); lun <= ultimoDelMese; lun = aggiungiGiorni(lun, 7)) {
        const sett = giorniDellaSettimana(lun);
        const dentro = sett.filter((d) => d.startsWith(mese));
        const suoi = delMese.filter((t) => dentro.includes(t.data));
        const tuttiPubblicati = suoi.length > 0 && suoi.every((t) => t.stato === 'pubblicato');
        fogli.push({
          ...base,
          giorni: sett.map((d, i) => {
            const g = giorni.find((x) => x.data === d) ?? tipo.get(i + 1);
            return { data: d, nelMese: dentro.includes(d), chiuso: g ? g.chiuso : false, apre: g && !g.chiuso ? orarioDi(g.apre) : null, chiude: g && !g.chiuso ? orarioDi(g.chiude) : null, evento: giorni.find((x) => x.data === d)?.evento ?? null };
          }),
          persone: visibili.map((p) => ({
            nome: nomePersona(p.scheda),
            ruolo: ruoloGuida(p.scheda.id, negozio?.referente_employee_id ?? null, negozio?.vice_referente_employee_id ?? null),
            oreSettimana: p.ore,
            turni: Object.fromEntries(dentro.map((d) => [d, suoi.filter((t) => t.employee_id === p.scheda.id && t.data === d)
              .map((t) => ({ inizio: t.inizio.slice(0, 5), fine: t.fine.slice(0, 5), pausaMinuti: t.pausa_minuti ?? 0, oreStraordinario: Number(t.ore_straordinario ?? 0) || undefined }))])),
          })),
          pubblicatoIl: tuttiPubblicati ? giornoDiPubblicazione(suoi) ?? oggiRoma() : null,
        });
      }
      creaPdfOrari(fogli, `Orario ${nomeNegozio} ${NOMI_MESE_LUNGHI[Number(mese.slice(5, 7))]} ${mese.slice(0, 4)}`).save(nomeFileOrarioMese(base, mese));
    } catch (e) {
      toast({ type: 'error', message: `PDF non creato: ${e instanceof Error ? e.message : 'errore'}` });
    } finally {
      setLavoro(false);
    }
  };
  // Condividi il foglio della settimana (Patrizio, 12/11/2026): niente invii automatici, parte
  // dal telefono o dal computer di chi preme. Dove il dispositivo sa condividere un file si apre
  // la sua finestra di condivisione con il PDF; altrimenti il PDF si scarica e si apre la mail o
  // WhatsApp con il testo pronto, e il file si allega a mano.
  const condividi = async (canale: 'mail' | 'whatsapp') => {
    setLavoro(true);
    try {
      const { creaPdfOrario, nomeFileOrario } = await import('../lib/stampaOrario');
      const dati0 = foglioSettimana();
      const nome = nomeFileOrario(dati0);
      const titolo = `Orario ${nomeNegozio}, ${date.length > 1 ? `settimana ${formattaDataBreve(date[0])} - ${formattaDataBreve(ultimo)}` : formattaDataBreve(date[0])}`;
      const testo = `${titolo}. In allegato il foglio con gli orari.`;
      const doc = creaPdfOrario(dati0);
      const file = new File([doc.output('blob')], nome, { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (canale === 'whatsapp' && nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: titolo, text: testo });
        return;
      }
      doc.save(nome);
      const url = canale === 'mail'
        ? `mailto:?subject=${encodeURIComponent(titolo)}&body=${encodeURIComponent(`${testo}\n\n(Il file «${nome}» è stato scaricato: allegalo a questa mail.)`)}`
        : `https://wa.me/?text=${encodeURIComponent(testo)}`;
      window.open(url, canale === 'mail' ? '_self' : '_blank', 'noopener');
      toast({ type: 'info', duration: 10000, message: `Ho scaricato «${nome}»: allegalo ${canale === 'mail' ? 'alla mail' : 'alla chat di WhatsApp'} che si è aperta.` });
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') toast({ type: 'error', message: `Condivisione non riuscita: ${e instanceof Error ? e.message : 'errore'}` });
    } finally {
      setLavoro(false);
    }
  };

  const proponi = async () => {
    if (!puoScrivere) return;
    setLavoro(true);
    try {
      const bozze = turni.filter((t) => t.origine === 'proposta' && t.stato === 'bozza').map((t) => t.id);
      if (bozze.length) {
        const { error } = await supabase.from('shifts').delete().in('id', bozze);
        if (error) throw error;
      }
      const fissi: Turno[] = turni
        .filter((t) => t.stato !== 'annullato' && !(t.origine === 'proposta' && t.stato === 'bozza'))
        .map((t) => ({ employeeId: t.employee_id, data: t.data, inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }));
      // chi viene qui in trasferta e copre il negozio conta come presenza
      const fissiTutti = [...fissi, ...copertureVerso(trasferte, outletId)];
      const proposta = proponiSettimana({ giorni, persone: candidati, regole, fissi: fissiTutti });
      // Mai un giorno con una persona sola (Patrizio, 28/10/2026); i turni a mano non si toccano.
      const conDue = almenoDuePersone(giorni, proposta.turni, candidati, [], regole, fissiTutti);
      // Ultimo passo (Patrizio, 11/11/2026): weekend tutti, giorno libero fisso, coppie
      // dei feriali a rotazione, lunedi' con responsabile o vice, ore fino al contratto.
      const liberi = riposoATurnazione ? liberiValidi : scegliGiorniLiberi(candidati.map((c) => c.id), new Map([...giorniLiberi].map(([id, g]) => [id, g.giorno])), guida);
      const coppiePrima = await caricaCoppiePrima(companyId, outletId, date[0]);
      const lunediVisti = regole.lunediDue ? await caricaLunediPrima(companyId, outletId, date[0]) : [];
      const sistemati = ottimizzaSettimana(giorni, conDue.filter((t) => !fissiTutti.includes(t)), candidati, regole,
        {
          // con la tabella dei riposi i giorni preferiti arrivano da li' (anche piu' di uno a testa)
          giornoLibero: riposoATurnazione ? undefined : liberi, guida, coppiePrima, lunediPrima: lunediVisti,
          riempiContratto: !!regole.riempiContratto, giorniGia: giorniFuori,
          // giorni caldi, apertura e chiusura fra responsabile e vice, riposi, straordinari pari: vuoto dove il negozio non li ha
          ...sceltePerLaSettimana({ giorni, regole, responsabile: guidaTurni.responsabile, vice: guidaTurni.vice, riposi: riposiMotore, giorniFuori: 7 - date.length }),
        }, fissiTutti);
      if (haGiorniLiberi && !riposoATurnazione) await salvaGiorniLiberiDiSistema(companyId, liberi, giorniLiberi).catch(() => undefined);
      const esito = { ...proposta, turni: sistemati, scoperture: giorni.flatMap((g) => scopertureDelGiorno(g, [...sistemati, ...fissiTutti])) };
      if (esito.turni.length) {
        // nei negozi con i giorni a massima intensita' lo straordinario della settimana si scrive sui turni dei giorni forti
        const straordDi = regole.giorniPieni
          // il contratto che resta dopo i turni gia' fissati (a mano, pubblicati, trasferte): la proposta non li contiene
          ? ripartisciStraordinari(esito.turni, new Map(candidati.map((c) => [c.id, c.ore - fissiTutti.filter((f) => f.employeeId === c.id).reduce((x, f) => x + oreLavorate(f), 0)])), new Set(giorni.filter((g) => !g.chiuso && (g.straordinariCaldo || g.straordinari)).map((g) => g.data)))
          : new Map<Turno, number>();
        const { error } = await supabase.from('shifts').insert(esito.turni.map((t) => ({
          company_id: companyId, outlet_id: outletId, employee_id: t.employeeId, data: t.data,
          inizio: t.inizio, fine: t.fine, pausa_minuti: t.pausaMinuti, origine: 'proposta', stato: 'bozza',
          plan_id: pianiScelti.get(t.data.slice(0, 7)) ?? null,
          // le stesse chiavi su tutte le righe: con chiavi diverse l'insert manda NULL dove mancano, e le colonne sono NOT NULL
          straordinario: straordDi.has(t), ore_straordinario: straordDi.get(t) ?? 0,
          ...(haMotivo ? { straordinario_motivo: straordDi.has(t) ? 'giorno_forte' : null } : {}),
        })));
        if (error) throw error;
      }
      const fatte = (id: string) => [...sistemati, ...fissiTutti].filter((t) => t.employeeId === id).reduce((a, t) => a + oreLavorate(t), 0);
      const libere = candidati.reduce((a, c) => a + Math.max(0, c.ore - fatte(c.id)), 0);
      const straord = candidati.reduce((a, c) => a + Math.max(0, fatte(c.id) - c.ore), 0);
      const perFerie = (libere > 0.25 ? ` Non servono ${oreInChiaro(libere)}${Math.round(libere * 60) % 30 === 0 ? ' ore' : ''} di contratto: restano per ferie e permessi, le vedi nella colonna Ore.` : '')
        + (straord > 0.25 ? ` Straordinario: ${oreInChiaro(straord)}${Math.round(straord * 60) % 30 === 0 ? ' ore' : ''} (sabato, domenica o giorni di evento).` : '');
      toast({
        type: esito.scoperture.length ? 'warning' : 'success',
        message: esito.scoperture.length
          ? `Proposta fatta: ${esito.turni.length} turni. Restano ${esito.scoperture.length} fasce scoperte, le vedi sotto ogni giorno.${perFerie}`
          : `Proposta fatta: ${esito.turni.length} turni, tutto coperto.${perFerie}`,
        duration: 10000,
      });
      await carica();
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Proposta non riuscita.' });
    } finally {
      setLavoro(false);
    }
  };

  // Una settimana ancora vuota parte dalla settimana prima (Patrizio, 11/11/2026):
  // stesse persone, stesso giorno della settimana, stessi orari, in bozza e «messi a
  // mano». Si saltano chi quel giorno non c'e' (ferie, fuori servizio, accordi), i
  // giorni chiusi e gli orari che non stanno nell'apertura del giorno.
  const copiaPrecedente = async () => {
    if (!puoScrivere) return;
    setLavoro(true);
    try {
      const prima = date.map((d) => aggiungiGiorni(d, -7));
      const ultimoPrima = prima[prima.length - 1];
      const [sh, pi] = await Promise.all([
        supabase.from('shifts').select('employee_id, data, inizio, fine, pausa_minuti, plan_id, stato')
          .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', prima[0]).lte('data', ultimoPrima).neq('stato', 'annullato'),
        supabase.from('shift_plans').select('id, mese').eq('outlet_id', outletId).eq('stato', 'scelto')
          .in('mese', [...new Set([prima[0], ultimoPrima].map((d) => `${d.slice(0, 7)}-01`))]),
      ]);
      if (sh.error) throw sh.error;
      if (pi.error) throw pi.error;
      // i turni gia' nella settimana si rileggono dal database, non dalla pagina:
      // due persone che copiano insieme non creano doppioni
      const giaQui = await leggiTurni(pianiScelti);
      const pianoPrima = new Map(((pi.data as { id: string; mese: string }[]) ?? []).map((x) => [x.mese.slice(0, 7), x.id]));
      // gli stessi turni che la settimana prima mostra: del piano scelto del mese, o quelli settimanali
      const sorgente = ((sh.data as { employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null; plan_id: string | null }[]) ?? [])
        .filter((t) => (t.plan_id ?? null) === (pianoPrima.get(t.data.slice(0, 7)) ?? null));
      const nuovi = sorgente.flatMap((t) => {
        const d = aggiungiGiorni(t.data, 7);
        const g = giorni.find((x) => x.data === d);
        const c = candidati.find((x) => x.id === t.employee_id);
        const [ini, fin] = [t5(t.inizio), t5(t.fine)];
        if (!g || g.chiuso || !c || c.nonDisponibile.has(d) || minuti(ini) < g.apre || minuti(fin) > g.chiude) return [];
        if (giaQui.some((x) => x.stato !== 'annullato' && x.employee_id === t.employee_id && x.data === d)) return [];
        return [{
          company_id: companyId, outlet_id: outletId, employee_id: t.employee_id, data: d, inizio: ini, fine: fin,
          pausa_minuti: t.pausa_minuti ?? 0, origine: 'manuale', stato: 'bozza', plan_id: pianiScelti.get(d.slice(0, 7)) ?? null,
        }];
      });
      if (!nuovi.length) {
        toast({ type: 'warning', message: sorgente.length ? 'Nessun turno della settimana prima si può copiare: le persone non ci sono o gli orari non stanno nell’apertura.' : 'La settimana prima non ha turni da copiare.' });
        return;
      }
      const { error } = await supabase.from('shifts').insert(nuovi);
      if (error) throw error;
      const saltati = sorgente.length - nuovi.length;
      toast({ type: 'success', message: `Copiati ${nuovi.length} turni dalla settimana prima, in bozza.${saltati > 0 ? ` ${saltati} non copiati: persona assente, giorno chiuso o orario fuori dall'apertura.` : ''} Ritoccali e pubblica.` });
      await dopoModifica(nuovi.map((n) => n.employee_id));
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Copia non riuscita.' });
    } finally {
      setLavoro(false);
    }
  };

  const pubblica = async () => {
    setLavoro(true);
    // Solo i turni che si vedono: quelli del piano scelto del mese o quelli settimanali, non le varianti scartate.
    const daPubblicare = turni.filter((t) => t.stato === 'bozza').map((t) => t.id);
    const { error } = await supabase.from('shifts').update({ stato: 'pubblicato' }).in('id', daPubblicare.length ? daPubblicare : ['00000000-0000-0000-0000-000000000000']);
    setLavoro(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: `Turni della settimana pubblicati per ${nomeNegozio}.` });
    ricaricaTurni();
  };

  // Dopo ogni modifica a mano (finestra del turno, trascinamento, mosse fra persone, copia
  // della settimana) lo straordinario «giorno forte» si ricalcola e si riscrive sui turni
  // (Patrizio, 12/11/2026): prima restava quello scritto dalla proposta. Solo nei negozi con
  // i giorni caldi, solo per le persone toccate dalla modifica (in una mossa fra due, tutte e
  // due) e mai sullo straordinario scritto a mano, sui turni di un mese chiuso o dove manca
  // la colonna della 408. Se non arriva in fondo lo dice e riprova al salvataggio dopo.
  const dopoModifica = async (personeToccate: string[]) => {
    const chiave = `${outletId}|${date[0]}`;
    const inAttesa = daRicalcolare.current.get(chiave) ?? new Set<string>();
    personeToccate.forEach((id) => inAttesa.add(id));
    if (regole.giorniPieni && haMotivo && ha408 && inAttesa.size) {
      daRicalcolare.current.set(chiave, inAttesa);
      try {
        const esito = await riallineaStraordinariForti({
          companyId, outletId, date, persone: [...inAttesa], planDi: (d) => pianiScelti.get(d.slice(0, 7)) ?? null,
          contratto: new Map(candidati.map((c) => [c.id, c.ore])),
          giorniForti: new Set(giorni.filter((g) => !g.chiuso && (g.straordinariCaldo || g.straordinari)).map((g) => g.data)),
        });
        daRicalcolare.current.delete(chiave);
        setStraordNonTorna((prima) => [...prima.filter((id) => !inAttesa.has(id)), ...esito.nonTorna]);
      } catch (e) {
        toast({ type: 'error', message: e instanceof Error ? e.message : 'Lo straordinario dei giorni forti non è stato ricalcolato: si riprova al prossimo salvataggio.' });
      }
    }
    await ricaricaTurni();
  };

  // Spostare, scambiare e affiancare i turni: dal calendario trascinando la
  // casella, dalla finestra del turno con «Dai questo turno a…». I turni
  // toccati diventano «messi a mano».
  const nomeDi = (id: string) => nomePersona(dati.schede.find((x) => x.id === id) ?? { nome: '', cognome: '' });
  const contestoMosse: ContestoSpostamenti = {
    turni: attivi,
    nomeDi,
    inServizio: (id, d) => {
      const p = persone.find((x) => x.scheda.id === id);
      const k = date.indexOf(d);
      return !!p && k >= 0 && p.perGiorno[k].outletId === outletId && p.perGiorno[k].stato === 'in_servizio';
    },
    inFerie: (id, d) => inFerie(id, d)?.tipo === 'giornata',
    inTrasferta: (id, d) => trasferte.some((x) => x.employeeId === id && x.data === d),
    puoLavorare: (id, d) => puoLavorareIl(disponibilita, id, d),
    fascia: (id, d) => fasciaIl(disponibilita, id, d),
    giorniMax: regole.giorniLavoroMax,
    apertura: (d) => giorni.find((g) => g.data === d),
    coperture: copertureVerso(trasferte, outletId).map((x) => ({ employee_id: x.employeeId, data: x.data, inizio: x.inizio, fine: x.fine })),
    settimanaDi: () => date,
  };
  const eseguiMossa = async (m: MossaTurno, t: TurnoDb, versoId: string, versoData: string, ore?: { inizio: string; fine: string; pausa_minuti: number }): Promise<string | null> => {
    try {
      await eseguiMossaSuShifts({ companyId, outletId, planDi: (d) => pianiScelti.get(d.slice(0, 7)) ?? null, turni: attivi, mossa: m, turno: t, versoId, versoData, ore });
      return esitoMossa(contestoMosse, m, t, versoId, versoData);
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Turno non spostato.' });
      return null;
    }
  };

  // Cambiando settimana le persone si ricalcolano subito sui giorni nuovi, mentre orari e
  // turni arrivano dopo la lettura: finche' i giorni non sono quelli del pezzo scelto si aspetta.
  if (!storicoPronto || (caricamento && !giorni.length) || giorni.length !== date.length || giorni[0]?.data !== date[0]) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const bozze = attivi.filter((t) => t.stato === 'bozza').length;
  const pubblicati = attivi.filter((t) => t.stato === 'pubblicato').length;
  const annullatiPubblicati = turni.filter((t) => t.stato === 'annullato').length;
  const scoperture = giorni.flatMap((g) => scopertureDelGiorno(g, turniPerCalcolo));
  const totaleOre = persone.reduce((s, p) => s + (oreFuori.get(p.scheda.id) ?? 0) + attivi.filter((t) => t.employee_id === p.scheda.id).reduce((a, t) => a + oreLavorate({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }), 0), 0);
  const totaleContratto = persone.reduce((s, p) => s + (p.ore ?? 0), 0);
  // «Come sta la settimana», in parole semplici (Patrizio, 12/11/2026).
  const oreDi = (id: string) => (oreFuori.get(id) ?? 0) + attivi.filter((t) => t.employee_id === id).reduce((a, t) => a + oreLavorate({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }), 0);
  const conTurni = persone.filter((p) => attivi.some((t) => t.employee_id === p.scheda.id));
  const riposiMinimi = date.length === 7 && conTurni.length ? Math.min(...conTurni.map((p) => date.filter((d) => !attivi.some((t) => t.employee_id === p.scheda.id && t.data === d)).length)) : null;
  const straordSettimana = conTurni.reduce((s, p) => s + Math.max(0, oreDi(p.scheda.id) - (p.ore ?? 0)), 0);
  const haLunedi = giorni.some((g) => g.giorno === 1 && !g.chiuso);
  const statoSettimana: { ok: boolean; testo: string }[] = [
    scoperture.length === 0 ? { ok: true, testo: 'Negozio sempre coperto' } : { ok: false, testo: `Mancano persone in ${scoperture.length} ${scoperture.length === 1 ? 'fascia' : 'fasce'}` },
    ...(riposiMinimi != null ? [{ ok: riposiMinimi >= Math.max(1, regole.riposiMinSettimana ?? 1), testo: riposiMinimi === 0 ? 'Qualcuno è senza riposo' : `Almeno ${riposiMinimi} ${riposiMinimi === 1 ? 'riposo' : 'riposi'} a testa` }] : []),
    ...(haLunedi && (guidaTurni.responsabile || guidaTurni.vice) ? [{ ok: !deroghe.some((d) => d.regola === 'lunedi_guida'), testo: deroghe.some((d) => d.regola === 'lunedi_guida') ? 'Lunedì manca responsabile o vice' : 'Lunedì c\'è responsabile o vice' }] : []),
    ...(giorni.some((g) => g.lunediDue) && attivi.some((t) => giorni.some((g) => g.lunediDue && g.data === t.data))
      ? [{ ok: !deroghe.some((d) => d.regola === 'lunedi_troppi' || d.regola === 'lunedi_coppia'),
        testo: deroghe.some((d) => d.regola === 'lunedi_troppi') ? 'Lunedì più di due persone' : deroghe.some((d) => d.regola === 'lunedi_coppia') ? 'Lunedì la stessa coppia di prima' : 'Lunedì in due, coppia diversa' }] : []),
    { ok: straordSettimana < 0.25, testo: straordSettimana < 0.25 ? 'Nessuno straordinario' : `${oreInChiaro(straordSettimana)}${Math.round(straordSettimana * 60) % 30 === 0 ? ' ore' : ''} di straordinario` },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Settimana prima" onClick={vaiIndietro} className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold text-slate-800 min-w-[200px] text-center">{date.length > 1 ? `Settimana ${formattaDataBreve(date[0])} – ${formattaDataBreve(ultimo)}` : `${NOMI_GIORNO[giorni[0]?.giorno ?? 1]} ${formattaDataBreve(date[0])}`}</span>
          <button type="button" aria-label="Settimana dopo" onClick={vaiAvanti} className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50"><ChevronRight size={16} /></button>
          {!eOggi && (
            <button type="button" onClick={vaiAOggi} className="text-xs text-blue-700 hover:underline">questa settimana</button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {attivi.length > 0 && (
            <>
              <button type="button" onClick={stampa} disabled={lavoro}
                title="Scarica il PDF dell'orario di questa settimana"
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                <Printer size={15} /> Stampa la settimana
              </button>
              <button type="button" onClick={stampaMese} disabled={lavoro}
                title="Scarica un solo PDF con tutte le settimane del mese, una per pagina"
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                <Printer size={15} /> Stampa il mese
              </button>
            </>
          )}
        {puoScrivere && (
          <div className="flex flex-wrap gap-2">
            {attivi.length === 0 && (
              <button type="button" onClick={copiaPrecedente} disabled={lavoro}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-800 text-sm font-semibold hover:bg-blue-100 disabled:opacity-50">
                <Copy size={15} /> Copia la settimana prima
              </button>
            )}
            <button type="button" onClick={proponi} disabled={lavoro || !haOrari}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={15} /> {attivi.length ? 'Rifai la proposta' : 'Proponi i turni'}
            </button>
            <button type="button" onClick={pubblica} disabled={lavoro || bozze === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              <Send size={15} /> Pubblica la settimana{bozze ? ` (${bozze})` : ''}
            </button>
          </div>
        )}
        </div>
      </div>

      {fuori.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" /> Questa settimana è a cavallo di due mesi: qui vedi i giorni di {NOMI_MESE_LUNGHI[Number(date[0].slice(5, 7))]}. Le ore già nei turni dei giorni di {meseFuori} contano nella colonna Ore, così il contratto della settimana resta uno solo.
        </div>
      )}
      {attivi.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <section aria-label="Come sta la settimana" className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <h3 className="font-semibold text-slate-800">Come sta la settimana</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {statoSettimana.map((x) => (
                <li key={x.testo} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${x.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                  {x.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {x.testo}
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Da guardare" className={`rounded-xl border p-3 text-sm ${deroghe.length ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-600'}`}>
            <h3 className="font-semibold flex items-center gap-2">{deroghe.length > 0 && <AlertTriangle size={15} />} Da guardare{deroghe.length ? ` (${deroghe.length})` : ''}</h3>
            {straordNonTorna.length > 0 && (
              <p className="mt-1 font-semibold">Straordinario da controllare a mano per {straordNonTorna.map(nomeDi).join(', ')}: una parte della settimana è in un mese chiuso, lì i turni non si riscrivono e il conto dello straordinario non torna.</p>
            )}
            {deroghe.length > 0 ? (
              <ul className="mt-1 list-disc pl-6 space-y-0.5">
                {deroghe.map((d, i) => <li key={`${d.regola}-${d.data}-${d.employeeId}-${i}`}>{d.testo}</li>)}
              </ul>
            ) : <p className="mt-1">Niente da segnalare: i turni rispettano le regole del negozio. Se sposti un turno a mano e una regola salta, lo vedi qui.</p>}
          </section>
        </div>
      )}
      {passo === 3 && (
        <section aria-label="Pubblica e invia" className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4 text-sm text-blue-950">
          <h3 className="font-semibold text-base">Pubblica e invia</h3>
          <p className="mt-1">{bozze > 0 ? `Ci sono ${bozze} turni in bozza: quando pubblichi, le persone del negozio li vedono nell'app.` : pubblicati > 0 ? 'La settimana è pubblicata: le persone del negozio la vedono nell\'app.' : 'Non ci sono ancora turni in questa settimana: preparali al passo 1 o 2.'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {puoScrivere && (
              <button type="button" onClick={pubblica} disabled={lavoro || bozze === 0} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"><Send size={16} /> Pubblica la settimana</button>
            )}
            <button type="button" onClick={stampa} disabled={lavoro || !attivi.length} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white font-medium hover:bg-slate-50 disabled:opacity-50"><Printer size={16} /> Stampa la settimana</button>
            <button type="button" onClick={stampaMese} disabled={lavoro} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white font-medium hover:bg-slate-50 disabled:opacity-50"><Printer size={16} /> Stampa il mese</button>
            <button type="button" onClick={() => condividi('mail')} disabled={lavoro || !attivi.length} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white font-medium hover:bg-slate-50 disabled:opacity-50"><Mail size={16} /> Invia per mail</button>
            <button type="button" onClick={() => condividi('whatsapp')} disabled={lavoro || !attivi.length} className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-slate-300 bg-white font-medium hover:bg-slate-50 disabled:opacity-50"><MessageCircle size={16} /> Invia su WhatsApp</button>
          </div>
          <p className="mt-2 text-xs text-blue-900/80">Mail e WhatsApp non partono da soli: si apre il programma con il testo pronto e il foglio in PDF, e lo mandi tu.</p>
        </section>
      )}
      {mancaGuida && attivi.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" /> {nomeNegozio}: {mancaGuida.charAt(0).toLowerCase() + mancaGuida.slice(1)}. Finché non ci sono tutte e due, la regola del lunedì (una fra responsabile e vice in negozio per il versamento) non si può controllare. Si scelgono in «Persone e riposi», in fondo alla pagina.
        </div>
      )}

      {!haOrari && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex flex-wrap items-center gap-2">
          <AlertTriangle size={15} /> Mancano gli orari di {nomeNegozio}: senza, il sistema non sa quando servono le persone.
          <button type="button" onClick={onVaiOrari} className="underline font-semibold">Inserisci gli orari</button>
        </div>
      )}
      {haOrari && usaModa && moda && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" /> Fabbisogno dal {storico?.propria ? 'traffico MODA del negozio' : storico?.fonte === 'riferimento' ? `traffico MODA di ${nomeDelNegozio(dati.negozi.find((n) => n.id === storico.riferimentoId)) || 'un altro negozio'} (negozio di riferimento: questo non ha storico)` : 'traffico MODA medio degli altri negozi (questo non ha storico)'}: {moda.fonti.join(', ')}. In ogni ora servono gli ingressi diviso {regole.sogliaFeriali === regole.sogliaWeekend ? `${regole.sogliaFeriali} ingressi per addetto` : `${regole.sogliaFeriali} ingressi per addetto nei feriali e ${regole.sogliaWeekend} nel weekend`} (soglia provvisoria, si cambia nelle regole dei turni); le ore di contratto che il traffico non chiede restano per ferie e permessi.
        </div>
      )}
      {haOrari && !haFabbisogno && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" /> {nomeNegozio} non ha traffico MODA e il fabbisogno non è ancora indicato (lo decide la direzione, profilo Super Advisor): la proposta distribuisce le ore di contratto, ma non può dire se bastano.
        </div>
      )}
      {stimati && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900 flex flex-wrap items-center gap-2">
          <Info size={15} /> Orari o fabbisogno di {nomeNegozio} sono stimati dai dati, non ancora confermati: la proposta è una simulazione.
          <button type="button" onClick={onVaiOrari} className="underline font-semibold">Controlla e conferma</button>
        </div>
      )}
      {annullatiPubblicati > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" /> {annullatiPubblicati} turni di questa settimana sono stati annullati da un cambiamento dell'organico: ricalcola la proposta e ripubblica.
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[980px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2 font-semibold w-48">Persona</th>
              {giorni.map((g) => (
                <th key={g.data} className={`px-1.5 py-2 font-semibold ${g.caldo && !g.chiuso ? 'bg-pink-50 text-pink-900' : ''}`}>
                  {NOMI_GIORNO_BREVI[g.giorno]} {g.data.slice(8, 10)}{g.caldo && !g.chiuso && <span className="ml-1 normal-case font-semibold text-[10px] rounded-full bg-pink-200 text-pink-900 px-1.5 py-0.5" title="Giorno caldo: lavorano tutte, straordinari ammessi">caldo</span>}
                  {g.chiuso && <span className="block normal-case font-normal text-slate-400">chiuso</span>}
                  {!g.chiuso && <span className="block normal-case font-normal text-slate-400">{`${String(Math.floor(g.apre / 60)).padStart(2, '0')}:${String(g.apre % 60).padStart(2, '0')}-${String(Math.floor(g.chiude / 60)).padStart(2, '0')}:${String(g.chiude % 60).padStart(2, '0')}`}</span>}
                  {g.nota && <span className="block normal-case font-normal text-blue-700">{g.nota}</span>}
                  {g.evento && <span className="block normal-case font-semibold text-red-700" title="Evento: più personale, niente ferie né permessi, straordinari se mancano persone">{g.evento}</span>}
                </th>
              ))}
              <th className="px-3 py-2 font-semibold text-right">Ore</th>
            </tr>
          </thead>
          <tbody>
            {persone.map((p) => {
              const suoi = attivi.filter((t) => t.employee_id === p.scheda.id);
              const qui = suoi.reduce((a, t) => a + oreLavorate({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }), 0);
              const portate = oreFuori.get(p.scheda.id) ?? 0;
              const pianificate = qui + portate;
              return (
                <tr key={p.scheda.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{nomePersona(p.scheda)}</div>
                    {!p.inForza && (
                      <div className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900" title="Non lavora più in questo negozio in questi giorni, ma ha ancora un turno salvato: toglilo o dallo a un'altra persona. Tolti i turni, non compare più.">
                        non più in servizio: ha ancora turni
                      </div>
                    )}
                    {p.inForza && p.finoAl && p.finoAl < ultimo && (
                      <div className="text-[11px] text-slate-500">in servizio fino a {NOMI_GIORNO_BREVI[giornoIso(p.finoAl)].toLowerCase()} {formattaDataBreve(p.finoAl)}</div>
                    )}
                    {etichettaRuoloGuida(ruoloGuida(p.scheda.id, negozio?.referente_employee_id ?? null, negozio?.vice_referente_employee_id ?? null)) && (
                      <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-700">{etichettaRuoloGuida(ruoloGuida(p.scheda.id, negozio?.referente_employee_id ?? null, negozio?.vice_referente_employee_id ?? null))}</div>
                    )}
                    <div className="text-xs text-slate-500">{p.ore != null ? `${p.ore} h` : 'a chiamata'}</div>
                    {/* Dove ci sono i riposi per persona (migration 405) si scelgono in «Persone e riposi»: qui si leggono. */}
                    {riposi.disponibile && ((riposi.preferiti.get(p.scheda.id)?.length ?? 0) > 0 || (riposi.mai.get(p.scheda.id)?.length ?? 0) > 0) && (
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {(riposi.preferiti.get(p.scheda.id)?.length ?? 0) > 0 && <>riposa di preferenza {riposi.preferiti.get(p.scheda.id)!.map((g) => NOMI_GIORNO_BREVI[g].toLowerCase()).join(', ')}</>}
                        {(riposi.preferiti.get(p.scheda.id)?.length ?? 0) > 0 && (riposi.mai.get(p.scheda.id)?.length ?? 0) > 0 && ' · '}
                        {(riposi.mai.get(p.scheda.id)?.length ?? 0) > 0 && <>mai {riposi.mai.get(p.scheda.id)!.map((g) => NOMI_GIORNO_BREVI[g].toLowerCase()).join(', ')}</>}
                      </div>
                    )}
                    {haGiorniLiberi && !riposi.disponibile && p.ore != null && (puoScrivere || giorniLiberi.has(p.scheda.id)) && (
                      <label className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500" title="Il giorno libero che resta lo stesso ogni settimana. Lo sceglie il sistema alla prima proposta; se lo cambi qui resta quello che decidi tu.">
                        libero fisso
                        <select disabled={!puoScrivere || lavoro} value={giorniLiberi.get(p.scheda.id)?.giorno ?? ''}
                          onChange={(e) => cambiaGiornoLibero(p.scheda.id, e.target.value ? Number(e.target.value) : null)}
                          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-700">
                          <option value="">da scegliere</option>
                          {[1, 2, 3, 4, 5, 6, 7].map((g) => <option key={g} value={g}>{NOMI_GIORNO_BREVI[g].toLowerCase()}</option>)}
                        </select>
                      </label>
                    )}
                  </td>
                  {giorni.map((g, i) => {
                    const pg = p.perGiorno[i];
                    const nd = motivoNonDisponibile(pg, p.scheda.id, g.data);
                    const t = turni.filter((x) => x.employee_id === p.scheda.id && x.data === g.data);
                    const vivo = t.find((x) => x.stato !== 'annullato') ?? null;
                    const annullato = t.find((x) => x.stato === 'annullato');
                    const fe = inFerie(p.scheda.id, g.data);
                    // casella di arrivo di un turno trascinato: giorno aperto, mossa possibile
                    const t0 = trascinato ? attivi.find((x) => x.id === trascinato) : null;
                    const accetta = !!t0 && puoScrivere && !g.chiuso && !(t0.employee_id === p.scheda.id && t0.data === g.data)
                      && mossePossibili(!!vivo, t0.employee_id === p.scheda.id).length > 0;
                    return (
                      <td key={g.data}
                        onDragOver={(e) => { if (accetta) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                        onDrop={(e) => { if (!accetta || !t0) return; e.preventDefault(); setTrascinato(null); setMossa({ turno: t0, versoId: p.scheda.id, versoData: g.data }); }}
                        className={`px-1.5 py-1.5 align-top ${accetta ? 'bg-blue-50 outline-2 outline-dashed outline-blue-300 -outline-offset-2' : ''}`}>
                        <button type="button" disabled={!puoScrivere || g.chiuso}
                          onClick={() => setEditor({ employeeId: p.scheda.id, data: g.data, turno: vivo })}
                          title={vivo && puoScrivere ? 'Modifica il turno, oppure trascinalo su un\'altra persona o un altro giorno' : undefined}
                          draggable={!!vivo && puoScrivere}
                          onDragStart={(e) => { if (!vivo) return; e.dataTransfer.setData('text/plain', vivo.id); e.dataTransfer.effectAllowed = 'move'; setTrascinato(vivo.id); }}
                          onDragEnd={() => setTrascinato(null)}
                          className={`w-full min-h-[40px] rounded-md px-1.5 py-1 text-xs text-center font-mono ${vivo && puoScrivere ? 'cursor-grab active:cursor-grabbing ' : ''}${vivo
                            ? vivo.stato === 'pubblicato' ? 'bg-blue-100 text-blue-900' : vivo.origine === 'manuale' ? 'bg-violet-100 text-violet-900' : 'bg-blue-50 text-blue-800 border border-dashed border-blue-300'
                            : nd ? 'bg-slate-100 text-slate-500 font-sans' : g.chiuso ? 'text-slate-300' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50 font-sans'}`}>
                          {vivo ? `${vivo.inizio}-${vivo.fine}` : nd ? nd : g.chiuso ? '' : 'riposo'}
                          {/* Nelle caselle solo l'orario: la pausa non si scrive (Patrizio, 12/11/2026), si vede aprendo il turno */}
                          {vivo && fe && <span className="block font-sans text-emerald-700">permesso {fe.ore} h</span>}
                        </button>
                        {annullato && !vivo && <span className="block text-[11px] text-slate-400 line-through text-center">{annullato.inizio}-{annullato.fine}</span>}
                      </td>
                    );
                  })}
                  <td className={`px-3 py-2 text-right tabular-nums ${p.ore != null && pianificate > p.ore + 0.01 ? 'text-amber-800 font-semibold' : 'text-emerald-800'}`}>
                    {oreInChiaro(pianificate)}{p.ore != null ? ` / ${p.ore}` : ''}
                    {portate > 0.01 && fuori.length > 0 && (
                      <span className="block text-[11px] font-normal text-slate-500 whitespace-nowrap">di cui {oreInChiaro(portate)} in {meseFuori}</span>
                    )}
                    {p.ore != null && pianificate - p.ore > 0.25 && (
                      <span className="block text-[11px] font-normal text-amber-800 whitespace-nowrap">{oreInChiaro(pianificate - p.ore)}{Math.round((pianificate - p.ore) * 60) % 30 === 0 ? ' h' : ''} straordinario</span>
                    )}
                    {p.inForza && p.ore != null && p.ore - pianificate > 0.25 && (
                      <span className="block text-[11px] font-normal text-slate-500 whitespace-nowrap"
                        title={fuori.length && !portate ? 'Ore di contratto della settimana ancora libere: il resto della settimana è nell\'altro mese' : 'Ore di contratto che il negozio non usa questa settimana: si coprono con ferie o permessi'}>
                        {oreInChiaro(p.ore - pianificate)}{Math.round((p.ore - pianificate) * 60) % 30 === 0 ? ' h' : ''} {fuori.length && !portate ? 'per il resto della settimana' : 'ferie/permessi'}{saldi.get(p.scheda.id) ? ` · maturate ${Math.round(saldi.get(p.scheda.id)!).toLocaleString('it-IT')} h` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!persone.length && (
              <tr><td colSpan={date.length + 2} className="px-3 py-10 text-center text-slate-400">Nessuna persona in organico in questo negozio nella settimana.</td></tr>
            )}
            <tr className="bg-slate-50">
              <td className="px-3 py-2 text-xs font-bold text-slate-600 uppercase">Copertura</td>
              {giorni.map((g) => {
                const sc = scoperture.filter((s) => s.data === g.data);
                return (
                  <td key={g.data} className="px-1.5 py-2 align-top text-xs">
                    {g.chiuso ? '' : !haFabbisogno ? <span className="text-slate-400">—</span> : sc.length === 0
                      ? <span className="text-emerald-700 font-semibold">coperto</span>
                      : sc.map((s) => <span key={s.dalle} className="block text-amber-800 font-semibold">manca {s.mancano} {s.dalle}-{s.alle}</span>)}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold">{oreInChiaro(totaleOre)} / {totaleContratto.toLocaleString('it-IT')}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        <span><span className="inline-block w-3 h-3 rounded bg-blue-50 border border-dashed border-blue-300 align-middle" /> proposta in bozza</span>
        <span><span className="inline-block w-3 h-3 rounded bg-violet-100 align-middle" /> messo a mano (il ricalcolo non lo tocca)</span>
        <span><span className="inline-block w-3 h-3 rounded bg-blue-100 align-middle" /> pubblicato</span>
        <span className="ml-auto">{bozze} in bozza · {pubblicati} pubblicati{esclusiDallaProposta.length ? ` · fuori dalla proposta (senza orario fisso): ${esclusiDallaProposta.map((p) => nomePersona(p.scheda)).join(', ')}` : ''}</span>
      </div>

      {mossa && (
        <SpostaTurnoModal turno={mossa.turno} versoId={mossa.versoId} versoData={mossa.versoData}
          arrivo={attivi.find((x) => x.employee_id === mossa.versoId && x.data === mossa.versoData && x.id !== mossa.turno.id) ?? null}
          nomeDi={nomeDi}
          avvisi={(m) => avvisiDellaMossa(contestoMosse, m, mossa.turno, mossa.versoId, mossa.versoData)}
          esegui={async (m) => { const msg = await eseguiMossa(m, mossa.turno, mossa.versoId, mossa.versoData); if (msg) { toast({ type: 'success', message: msg }); await dopoModifica([mossa.turno.employee_id, mossa.versoId]); } return !!msg; }}
          onClose={() => setMossa(null)} />
      )}
      {editor && (
        <EditorTurno
          companyId={companyId} outletId={outletId} employeeId={editor.employeeId} data={editor.data} turno={editor.turno}
          planId={pianiScelti.get(editor.data.slice(0, 7)) ?? null}
          nome={nomePersona(dati.schede.find((s) => s.id === editor.employeeId) ?? { nome: '', cognome: '' })}
          apre={giorni.find((g) => g.data === editor.data)!.apre} chiude={giorni.find((g) => g.data === editor.data)!.chiude}
          regole={regole} conMotivo={haMotivo} conAMano={ha408} giornoForte={!!regole.giorniPieni && giornoPieno(giorni.find((g) => g.data === editor.data)!)}
          passaggio={editor.turno ? (() => {
            const t = editor.turno!;
            return {
              colleghi: persone.map((x) => ({ id: x.scheda.id, nome: nomePersona(x.scheda) })),
              haTurno: (id: string) => attivi.some((x) => x.employee_id === id && x.data === editor.data),
              avvisi: (m: MossaTurno, versoId: string, ore: { inizio: string; fine: string }) => avvisiDellaMossa(contestoMosse, m, t, versoId, editor.data, ore),
              esegui: (m: MossaTurno, versoId: string, ore: { inizio: string; fine: string; pausa_minuti: number }) => {
                // la collega che riceve o affianca il turno: anche a lei si ricalcola lo straordinario
                const chiave = `${outletId}|${date[0]}`;
                daRicalcolare.current.set(chiave, (daRicalcolare.current.get(chiave) ?? new Set<string>()).add(versoId));
                return eseguiMossa(m, t, versoId, editor.data, ore);
              },
            };
          })() : undefined}
          onClose={() => setEditor(null)}
          onSalvato={async (msg) => {
            // prima i turni aggiornati (e lo straordinario dei giorni forti ricalcolato), poi si chiude: la tabella non mostra mai il dato vecchio
            await dopoModifica([editor.employeeId]);
            setEditor(null);
            if (msg) toast({ type: 'success', message: msg });
          }}
        />
      )}
    </div>
  );
}
