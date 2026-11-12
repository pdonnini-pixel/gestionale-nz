// «Regole e orari» di un negozio: la base da cui si propongono i turni.
//
//  - Orari della settimana tipo: li inserisce chi tiene l'organico.
//  - Fabbisogno (quante persone servono in ogni fascia): lo decide Patrizio,
//    quindi lo modifica solo super_advisor; gli altri lo vedono.
//  - Giorni chiusi e orari diversi del negozio (Natale, Capodanno, vigilie
//    con chiusura anticipata): valgono al posto della settimana tipo e si
//    possono segnare in un colpo su tutti i negozi. Black Friday, feste e
//    saldi (piu' personale, niente ferie) non stanno qui: sono «Eventi».
//  - Regole: turno minimo e massimo, pausa, giorni di lavoro a settimana.
//
// Un solo salvataggio (Patrizio, 11/11/2026): qualunque «Salva» della pagina
// salva tutto quello che e' stato cambiato (orari, fabbisogno, regole), non
// solo il suo riquadro. Prima ogni riquadro salvava il suo: le fasce scritte e
// poi «Salva regole» restavano fuori, e cambiando negozio sparivano senza
// avviso. Chi esce con modifiche aperte viene fermato e sceglie.

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Copy, Lock, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import FasceEditor, { type FasciaSemplice } from './FasceEditor';
import RiposiNegozio from './RiposiNegozio';
import EventiDelNegozio from './EventiDelNegozio';
import { useToast } from './Toast';
import { Modal } from './ui/Modal';
import { supabase } from '../lib/supabase';
import {
  NOMI_GIORNO, REGOLE_DEFAULT, RIPOSO_LEGALE, costruisciGiorni, regoleDaRiga, giorniDellaSettimana, lunediDi, oreDaCoprire,
  type FasciaFabbisogno, type RegoleTurni,
} from '../lib/turni';
import { formattaDataBreve, oggiRoma } from '../lib/organico';
import { caricaChiusurePerStima } from '../lib/organicoDati';
import { stimaOrariEFabbisogno } from '../lib/stimaNegozio';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  puoScrivere: boolean;
  puoFabbisogno: boolean;
  /** ore settimanali di contratto delle persone in servizio nel negozio */
  oreContratto: number;
  /** quante persone sono in servizio nel negozio (tetto della stima) */
  personeInServizio: number;
  /** gli altri negozi, per segnare la stessa chiusura su tutti */
  altriNegozi?: { id: string; nome: string }[];
  onSalvato?: () => void;
  /** chi cambia negozio o scheda la chiama prima: false = si resta qui */
  guardia?: MutableRefObject<(() => Promise<boolean>) | null>;
  /** le persone in servizio nel negozio, per i giorni di riposo */
  persone?: { id: string; nome: string }[];
  /** scheda «Responsabile e vice»: i selettori li porta la pagina Turni */
  guida?: ReactNode;
  /** apre la pagina Eventi di prima (eventi per piu' negozi insieme) */
  onVaiEventi?: () => void;
};

type RigaOrario = { giorno: number; chiuso: boolean; apre: string; chiude: string };
type RigaFascia = FasciaFabbisogno & { id?: string; chiave: string };
type RigaSpeciale = { id?: string; data: string; chiuso: boolean; apre: string; chiude: string; persone_extra: number; nota: string };

const settimanaVuota = (): RigaOrario[] => [1, 2, 3, 4, 5, 6, 7].map((g) => ({ giorno: g, chiuso: false, apre: '', chiude: '' }));
const t5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');
const inputCls = 'min-h-[36px] rounded-lg border border-slate-300 px-2 text-sm disabled:bg-slate-50 disabled:text-slate-500';
let chiaveSeq = 0;
const nuovaChiave = () => `n${++chiaveSeq}`;

type Sezione = 'orari' | 'fasce' | 'regole';
const NOME_SEZIONE: Record<Sezione, string> = { orari: 'orari', fasce: 'fabbisogno', regole: 'regole dei turni' };
type SpecialeDb = { id: string; data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null };
const righeSpeciali = (dati: unknown): RigaSpeciale[] => ((dati as SpecialeDb[] | null) ?? [])
  .map((x) => ({ id: x.id, data: x.data, chiuso: x.chiuso, apre: t5(x.apre), chiude: t5(x.chiude), persone_extra: x.persone_extra, nota: x.nota ?? '' }));
const improntaFasce = (f: RigaFascia[]) => JSON.stringify(f.map((x) => [x.id ?? '', x.giorno, x.dalle, x.alle, x.persone]));

export default function OrariNegozio({ companyId, outletId, nomeNegozio, puoScrivere, puoFabbisogno, oreContratto, personeInServizio, altriNegozi = [], onSalvato, guardia, persone = [], guida, onVaiEventi }: Props) {
  const { toast } = useToast();
  const [orari, setOrari] = useState<RigaOrario[]>(settimanaVuota());
  const [fasce, setFasce] = useState<RigaFascia[]>([]);
  const [fasceIniziali, setFasceIniziali] = useState<string[]>([]);
  const [regole, setRegole] = useState<RegoleTurni>(REGOLE_DEFAULT);
  // Negozio da cui prendere il traffico MODA se questo non ne ha (Patrizio, 11/11/2026). undefined = colonna assente (tenant senza la 391).
  const [trafficoDa, setTrafficoDa] = useState<string | null | undefined>(undefined);
  // «Ore fino al contratto» (migration 395): dove la colonna non c'e' la scelta non compare e non si salva.
  const [haRiempi, setHaRiempi] = useState(false);
  // colonne della migration 399: dove mancano (tenant Made) le due scelte non si mostrano e non si salvano
  const [haProva, setHaProva] = useState(false);
  // colonne della migration 405 (riposi, straordinari pari, scelte dei giorni caldi): come sopra
  const [ha403, setHa403] = useState(false);
  // Persone per fascia: quale giorno si sta guardando (0 = i feriali insieme), e se i feriali si scrivono insieme.
  const [giornoFasce, setGiornoFasce] = useState<number>(0);
  const [ferialiInsieme, setFerialiInsieme] = useState(true);
  const [trafficoSalvato, setTrafficoSalvato] = useState<string | null | undefined>(undefined);
  const [speciali, setSpeciali] = useState<RigaSpeciale[]>([]);
  const [nuovoSpeciale, setNuovoSpeciale] = useState<RigaSpeciale>({ data: '', chiuso: true, apre: '', chiude: '', persone_extra: 0, nota: '' });
  const [suTutti, setSuTutti] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [salvo, setSalvo] = useState<string | null>(null);
  // Orari e fabbisogno salvati come stima (non ancora confermati da una persona).
  const [stimaSalvata, setStimaSalvata] = useState<{ orari: boolean; fasce: boolean }>({ orari: false, fasce: false });
  // Proposta dai dati appena calcolata, non ancora salvata.
  const [proposta, setProposta] = useState<string[] | null>(null);
  // Com'erano orari, fabbisogno e regole all'ultimo caricamento o salvataggio:
  // quello che e' diverso e' una modifica ancora da salvare.
  const [base, setBase] = useState<Record<Sezione, string>>({ orari: '', fasce: '', regole: '' });
  const [chiedeUscita, setChiedeUscita] = useState<((esce: boolean) => void) | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    const [o, f, s, r] = await Promise.all([
      supabase.from('outlet_opening_hours').select('*').eq('outlet_id', outletId),
      supabase.from('outlet_staffing_needs').select('*').eq('outlet_id', outletId).order('giorno').order('dalle'),
      supabase.from('outlet_special_days').select('*').eq('outlet_id', outletId).gte('data', oggiRoma()).order('data'),
      supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
    ]);
    const orariLetti = settimanaVuota();
    setStimaSalvata({
      orari: ((o.data as { origine?: string }[]) ?? []).some((x) => x.origine === 'stima'),
      fasce: ((f.data as { origine?: string }[]) ?? []).some((x) => x.origine === 'stima'),
    });
    setProposta(null);
    for (const x of (o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? []) {
      orariLetti[x.giorno - 1] = { giorno: x.giorno, chiuso: x.chiuso, apre: t5(x.apre), chiude: t5(x.chiude) };
    }
    setOrari(orariLetti);
    const ff = ((f.data as { id: string; giorno: number; dalle: string; alle: string; persone: number }[]) ?? [])
      .map((x) => ({ id: x.id, giorno: x.giorno, dalle: t5(x.dalle), alle: t5(x.alle), persone: x.persone, chiave: x.id }));
    setFasce(ff);
    // I feriali si scrivono insieme finche' sono uguali fra loro (o vuoti).
    const delGiorno = (g: number) => JSON.stringify(ff.filter((x) => x.giorno === g).map((x) => [x.dalle, x.alle, x.persone]));
    const uguali = [2, 3, 4, 5].every((g) => delGiorno(g) === delGiorno(1));
    setFerialiInsieme(uguali);
    setGiornoFasce((g) => (uguali ? (g >= 6 ? g : 0) : (g === 0 ? 1 : g)));
    setFasceIniziali(ff.map((x) => x.id!));
    setSpeciali(righeSpeciali(s.data));
    const regoleLette = regoleDaRiga(r.data as Parameters<typeof regoleDaRiga>[0]);
    setRegole(regoleLette);
    setBase({ orari: JSON.stringify(orariLetti), fasce: improntaFasce(ff), regole: JSON.stringify(regoleLette) });
    let letto: string | null | undefined;
    if (r.data != null) {
      letto = 'traffico_da_outlet_id' in (r.data as object) ? ((r.data as { traffico_da_outlet_id: string | null }).traffico_da_outlet_id ?? null) : undefined;
    } else {
      // Negozio senza regole salvate: si controlla se la colonna c'e' (sul tenant Made no, migration 391 assente).
      const prova = await supabase.from('outlet_shift_rules').select('traffico_da_outlet_id').limit(1);
      letto = prova.error ? undefined : null;
    }
    setTrafficoDa(letto);
    setTrafficoSalvato(letto);
    if (r.data != null) setHaRiempi('riempi_contratto' in (r.data as object));
    else setHaRiempi(!(await supabase.from('outlet_shift_rules').select('riempi_contratto').limit(1)).error);
    if (r.data != null) setHaProva('giorni_pieni' in (r.data as object));
    else setHaProva(!(await supabase.from('outlet_shift_rules').select('giorni_pieni').limit(1)).error);
    if (r.data != null) setHa403('riposi_min_settimana' in (r.data as object));
    else setHa403(!(await supabase.from('outlet_shift_rules').select('riposi_min_settimana' as 'giorni_pieni').limit(1)).error);
    setCaricamento(false);
  }, [outletId]);

  useEffect(() => { carica(); }, [carica]);

  // Dopo un giorno aggiunto o tolto si rileggono solo i giorni: ricaricare
  // tutto cancellerebbe orari, fasce e regole cambiati e non ancora salvati.
  const ricaricaSpeciali = async () => {
    const { data } = await supabase.from('outlet_special_days').select('*').eq('outlet_id', outletId).gte('data', oggiRoma()).order('data');
    setSpeciali(righeSpeciali(data));
  };

  const oreServono = useMemo(() => {
    const date = giorniDellaSettimana(lunediDi(oggiRoma()));
    return oreDaCoprire(costruisciGiorni(date, orari.map((o) => ({ ...o, apre: o.apre || null, chiude: o.chiude || null })), fasce, []));
  }, [orari, fasce]);

  const erroreOrari = orari.find((o) => !o.chiuso && (!o.apre || !o.chiude || o.chiude <= o.apre));
  const erroreFasce = fasce.find((f) => !f.dalle || !f.alle || f.alle <= f.dalle || f.persone < 0);

  // Cosa e' stato cambiato e non ancora salvato (solo quello che si puo' salvare).
  const aperte = useMemo(() => {
    const out: Sezione[] = [];
    if (caricamento) return out;
    if (puoScrivere && JSON.stringify(orari) !== base.orari) out.push('orari');
    if (puoFabbisogno && improntaFasce(fasce) !== base.fasce) out.push('fasce');
    if (puoScrivere && (JSON.stringify(regole) !== base.regole || trafficoDa !== trafficoSalvato)) out.push('regole');
    return out;
  }, [caricamento, puoScrivere, puoFabbisogno, orari, fasce, regole, base, trafficoDa, trafficoSalvato]);

  // Ognuna scrive la sua parte e torna il motivo se non ci riesce (null = salvata).
  const scriviOrari = async (): Promise<string | null> => {
    if (erroreOrari) return `${NOMI_GIORNO[erroreOrari.giorno]}: indica apertura e chiusura, oppure segna chiuso.`;
    const { error } = await supabase.from('outlet_opening_hours').upsert(orari.map((o) => ({
      company_id: companyId, outlet_id: outletId, giorno: o.giorno, chiuso: o.chiuso,
      apre: o.chiuso ? null : o.apre, chiude: o.chiuso ? null : o.chiude, origine: 'manuale', updated_at: new Date().toISOString(),
    })), { onConflict: 'outlet_id,giorno' });
    if (error) return error.message;
    setBase((b) => ({ ...b, orari: JSON.stringify(orari) }));
    setStimaSalvata((x) => ({ ...x, orari: false }));
    return null;
  };

  const scriviFasce = async (): Promise<string | null> => {
    if (erroreFasce) return `${NOMI_GIORNO[erroreFasce.giorno]}: una fascia ha orari non validi.`;
    const doppia = fasce.find((f, i) => fasce.some((g, j) => j !== i && g.giorno === f.giorno && g.dalle === f.dalle));
    if (doppia) return `${NOMI_GIORNO[doppia.giorno]}: due fasce iniziano alle ${doppia.dalle}, cambia l'orario di una delle due.`;
    // Quello che arriva nel database si segna subito, riga per riga: se una
    // scrittura fallisce a meta', la pagina sa quali fasce sono gia' salvate.
    // Una fascia che cambia giorno o ora d'inizio si toglie e si riscrive: aggiornandole una alla
    // volta due righe potrebbero avere per un attimo lo stesso inizio, che il database non ammette.
    const com = new Map((JSON.parse(base.fasce || '[]') as [string, number, string, string, number][]).map((x) => [x[0], x]));
    const scritte: RigaFascia[] = fasce.map((f) => {
      const prima = f.id ? com.get(f.id) : undefined;
      return prima && (prima[1] !== f.giorno || prima[2] !== f.dalle) ? { ...f, id: undefined } : { ...f };
    });
    let rimaste = fasceIniziali;
    let motivo: string | null = null;
    try {
      const tolte = fasceIniziali.filter((id) => !scritte.some((f) => f.id === id));
      if (tolte.length) {
        const { error } = await supabase.from('outlet_staffing_needs').delete().in('id', tolte);
        if (error) throw error;
        rimaste = rimaste.filter((id) => !tolte.includes(id));
      }
      // Prima le fasce gia' salvate, poi le nuove.
      for (const f of [...scritte.filter((x) => x.id), ...scritte.filter((x) => !x.id)]) {
        const riga = { company_id: companyId, outlet_id: outletId, giorno: f.giorno, dalle: f.dalle, alle: f.alle, persone: f.persone, origine: 'manuale', updated_at: new Date().toISOString() };
        if (f.id) {
          const { error } = await supabase.from('outlet_staffing_needs').update(riga).eq('id', f.id);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from('outlet_staffing_needs').insert([riga]).select('id').single();
          if (error) throw error;
          f.id = (data as { id: string }).id;
          rimaste = [...rimaste, f.id];
        }
      }
    } catch (e) {
      motivo = e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'errore';
    }
    setFasce(scritte);
    setFasceIniziali(rimaste);
    if (motivo) return motivo;
    setBase((b) => ({ ...b, fasce: improntaFasce(scritte) }));
    setStimaSalvata((x) => ({ ...x, fasce: false }));
    return null;
  };

  const scriviRegole = async (): Promise<string | null> => {
    if (regole.pausaLungaOltreOre < regole.pausaOltreOre) return 'la pausa lunga deve scattare dopo quella normale.';
    if (regole.turnoMinOre > regole.turnoMaxOre) return 'il turno minimo non può superare il turno massimo.';
    if (regole.sogliaFeriali < 1 || regole.sogliaWeekend < 1) return 'gli ingressi per addetto devono essere almeno 1.';
    if (regole.riposiMinSettimana != null && regole.riposiMinSettimana < RIPOSO_LEGALE) return 'per legge c’è almeno un giorno di riposo a settimana.';
    const { error } = await supabase.from('outlet_shift_rules').upsert([{
      outlet_id: outletId, company_id: companyId, turno_min_ore: regole.turnoMinOre, turno_max_ore: regole.turnoMaxOre,
      pausa_oltre_ore: regole.pausaOltreOre, pausa_minuti: regole.pausaMinuti,
      pausa_lunga_oltre_ore: regole.pausaLungaOltreOre, pausa_lunga_minuti: regole.pausaLungaMinuti, giorni_lavoro_max: regole.giorniLavoroMax,
      soglia_ingressi_feriali: regole.sogliaFeriali, soglia_ingressi_weekend: regole.sogliaWeekend, due_persone: regole.duePersone,
      ...(trafficoDa !== undefined ? { traffico_da_outlet_id: trafficoDa } : {}),
      ...(haRiempi ? { riempi_contratto: !!regole.riempiContratto } : {}),
      ...(haProva ? { pausa_corta_pagata: !!regole.pausaCortaPagata, giorni_pieni: !!regole.giorniPieni } : {}),
      ...(ha403 ? {
        riposi_min_settimana: regole.riposiMinSettimana ?? null, straordinari_pari: regole.straordinariPari ?? null,
        caldi_tutti_al_lavoro: regole.caldiTutti ?? null, caldi_straordinari: regole.caldiStraordinari ?? null,
        caldi_fasce_festivi: regole.caldiFasceFestivi == null ? null : regole.caldiFasceFestivi === 7 ? 'domenica' : 'sabato',
        caldi_guida_apre_chiude: regole.caldiGuidaApreChiude ?? null, caldi_ore_apertura: regole.caldiOreApertura ?? null,
      } : {}),
      updated_at: new Date().toISOString(),
    }], { onConflict: 'outlet_id' });
    if (error) return error.message;
    setBase((b) => ({ ...b, regole: JSON.stringify(regole) }));
    setTrafficoSalvato(trafficoDa);
    return null;
  };

  // Un solo salvataggio: il riquadro del pulsante premuto piu' tutto quello che
  // e' stato cambiato negli altri. Dice cosa ha salvato e cosa no, e perche'.
  const salva = async (richieste: Sezione[]): Promise<boolean> => {
    const sezioni = (['orari', 'regole', 'fasce'] as Sezione[]).filter((x) => richieste.includes(x) || aperte.includes(x));
    setSalvo('salva');
    const fatte: string[] = [];
    let tutto = true;
    for (const x of sezioni) {
      const motivo = await (x === 'orari' ? scriviOrari() : x === 'fasce' ? scriviFasce() : scriviRegole());
      if (motivo) { tutto = false; toast({ type: 'error', message: `${nomeNegozio}, ${NOME_SEZIONE[x]} non salvato: ${motivo}`, duration: 12000 }); }
      else fatte.push(NOME_SEZIONE[x]);
    }
    setSalvo(null);
    if (fatte.length) {
      toast({ type: 'success', message: `${nomeNegozio}: salvato ${fatte.join(', ')}.${tutto ? ' Non resta niente da salvare.' : ''}` });
      onSalvato?.();
    }
    if (tutto) setProposta(null);
    return tutto;
  };

  // Uscita con modifiche aperte. Chi cambia negozio o scheda passa dalla
  // guardia e sceglie; se la pagina viene tolta per un'altra strada (altra
  // sezione di Dipendenti, altra pagina) almeno un avviso lo dice.
  const aperteRef = useRef(aperte);
  aperteRef.current = aperte;
  const nomeRef = useRef(nomeNegozio);
  nomeRef.current = nomeNegozio;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const uscitaDecisa = useRef(false);
  useEffect(() => {
    if (!guardia) return;
    guardia.current = () => (aperteRef.current.length === 0
      ? Promise.resolve(true)
      : new Promise<boolean>((fine) => setChiedeUscita(() => fine)));
    return () => { guardia.current = null; };
  }, [guardia]);
  useEffect(() => () => {
    if (aperteRef.current.length && !uscitaDecisa.current) {
      toastRef.current({ type: 'error', duration: 15000, message: `${nomeRef.current}: le modifiche a ${aperteRef.current.map((x) => NOME_SEZIONE[x]).join(', ')} non sono state salvate.` });
    }
  }, []);
  useEffect(() => {
    if (!aperte.length) return;
    const avvisa = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', avvisa);
    return () => window.removeEventListener('beforeunload', avvisa);
  }, [aperte.length]);
  const rispondiUscita = async (scelta: 'salva' | 'scarta' | 'resta') => {
    const fine = chiedeUscita;
    if (!fine) return;
    let esce = scelta === 'scarta';
    if (scelta === 'salva') esce = await salva([]);
    if (esce) uscitaDecisa.current = true;
    setChiedeUscita(null);
    fine(esce);
  };

  const aggiungiSpeciale = async () => {
    const s = nuovoSpeciale;
    if (!s.data) { toast({ type: 'error', message: 'Indica la data.' }); return; }
    if (!s.chiuso && (!s.apre || !s.chiude)) { toast({ type: 'error', message: 'Indica l’orario del giorno, oppure segna chiuso.' }); return; }
    if (!s.chiuso && s.chiude <= s.apre) { toast({ type: 'error', message: 'La chiusura viene prima dell’apertura.' }); return; }
    setSalvo('speciali');
    // Le persone in piu' (fabbisogno) di una riga gia' salvata restano come sono:
    // qui non si toccano, il piu' personale passa dagli «Eventi».
    const negozi = [outletId, ...(suTutti ? altriNegozi.map((n) => n.id) : [])];
    const { error } = await supabase.from('outlet_special_days').upsert(negozi.map((id) => ({
      company_id: companyId, outlet_id: id, data: s.data, chiuso: s.chiuso,
      apre: s.chiuso ? null : s.apre, chiude: s.chiuso ? null : s.chiude, nota: s.nota || null,
    })), { onConflict: 'outlet_id,data' });
    setSalvo(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    if (suTutti) toast({ type: 'success', message: `${formattaDataBreve(s.data)} segnato su ${negozi.length} negozi.` });
    setNuovoSpeciale({ data: '', chiuso: true, apre: '', chiude: '', persone_extra: 0, nota: '' });
    setSuTutti(false);
    await ricaricaSpeciali();
    onSalvato?.();
  };

  const togliSpeciale = async (id: string) => {
    const { error } = await supabase.from('outlet_special_days').delete().eq('id', id);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    await ricaricaSpeciali();
    onSalvato?.();
  };

  // Proposta dai dati: chiusure di cassa (ora di chiusura, incasso per giorno)
  // e ore di contratto del negozio. Riempie il modulo, non salva: chi guarda
  // controlla e salva. Il fabbisogno lo propone solo a chi puo' deciderlo.
  const proponiDaiDati = async () => {
    setSalvo('stima');
    try {
      const chiusure = (await caricaChiusurePerStima(companyId)).filter((c) => c.outlet_id === outletId);
      const stima = stimaOrariEFabbisogno(chiusure, oreContratto, personeInServizio);
      setOrari(stima.orari.map((o) => ({ giorno: o.giorno, chiuso: o.chiuso, apre: o.apre ?? '', chiude: o.chiude ?? '' })));
      if (puoFabbisogno) setFasce(stima.fasce.map((f) => ({ ...f, chiave: nuovaChiave() })));
      setProposta(stima.spiegazione);
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Stima non riuscita.' });
    } finally {
      setSalvo(null);
    }
  };

  const copiaOrariLunedi = () => setOrari((o) => o.map((x) => (x.giorno === 1 ? x : { ...o[0], giorno: x.giorno })));
  // ── Persone per fascia: un giorno alla volta, con i feriali insieme finche' sono uguali ──
  const schedeGiorni = ferialiInsieme
    ? [{ g: 0, nome: 'Feriali' }, { g: 6, nome: 'Sabato' }, { g: 7, nome: 'Domenica' }]
    : [1, 2, 3, 4, 5, 6, 7].map((g) => ({ g, nome: NOMI_GIORNO[g] }));
  const giornoScelto = schedeGiorni.some((t) => t.g === giornoFasce) ? giornoFasce : schedeGiorni[0].g;
  const giornoVero = giornoScelto === 0 ? 1 : giornoScelto;
  const fasceDelGiornoScelto: FasciaSemplice[] = fasce.filter((f) => f.giorno === giornoVero).sort((a, b) => a.dalle.localeCompare(b.dalle))
    .map((f) => ({ dalle: f.dalle, alle: f.alle, persone: f.persone, chiave: f.chiave }));
  const orarioDelGiornoScelto = { apre: orari[giornoVero - 1]?.apre || '10:00', chiude: orari[giornoVero - 1]?.chiude || '20:00' };
  // Riscrive le fasce di uno o piu' giorni tenendo, dove si puo', la riga gia' salvata (per chiave o per posizione).
  const scriviGiorni = (giorniDa: number[], nuove: FasciaSemplice[]) => setFasce((tutte) => {
    const altre = tutte.filter((f) => !giorniDa.includes(f.giorno));
    const rifatte = giorniDa.flatMap((g) => {
      const prima = tutte.filter((f) => f.giorno === g).sort((a, b) => a.dalle.localeCompare(b.dalle));
      return nuove.map((n, k): RigaFascia => {
        const vecchia = prima.find((f) => f.chiave === n.chiave) ?? (g !== giornoVero ? prima[k] : undefined);
        return { giorno: g, dalle: n.dalle, alle: n.alle, persone: n.persone, id: vecchia?.id, chiave: vecchia?.chiave ?? nuovaChiave() };
      });
    });
    return [...altre, ...rifatte].sort((a, b) => a.giorno - b.giorno || a.dalle.localeCompare(b.dalle));
  });
  const cambiaFasceDelGiorno = (nuove: FasciaSemplice[]) => scriviGiorni(giornoScelto === 0 ? [1, 2, 3, 4, 5] : [giornoScelto], nuove);
  const copiaFasceDa = (g: number) => cambiaFasceDelGiorno(fasce.filter((f) => f.giorno === g).sort((a, b) => a.dalle.localeCompare(b.dalle))
    .map((f) => ({ dalle: f.dalle, alle: f.alle, persone: f.persone })));

  if (caricamento) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const mancano = oreServono - oreContratto;
  const salvando = salvo === 'salva';
  const elencoAperte = aperte.map((x) => NOME_SEZIONE[x]).join(', ');

  return (
    <div className="space-y-4">
      {aperte.length > 0 && (
        <div role="status" className="sticky top-2 z-20 rounded-xl border border-amber-300 bg-amber-50 shadow-sm p-3 flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
          <span><strong>Modifiche non ancora salvate</strong> per {nomeNegozio}: {elencoAperte}.</span>
          <button type="button" onClick={() => salva([])} disabled={salvando}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
            <Save size={15} /> {salvando ? 'Salvo…' : 'Salva tutto'}
          </button>
        </div>
      )}
      <Modal open={chiedeUscita !== null} onClose={() => rispondiUscita('resta')} title="Modifiche non salvate" closeOnBackdrop={false}>
        <p className="text-sm text-slate-700">Per {nomeNegozio} hai cambiato {elencoAperte || 'qualcosa'} senza salvare. Se esci adesso queste modifiche si perdono.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => rispondiUscita('resta')} className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Resta qui</button>
          <button type="button" onClick={() => rispondiUscita('scarta')} disabled={salvando} className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">Esci senza salvare</button>
          <button type="button" onClick={() => rispondiUscita('salva')} disabled={salvando} className="min-h-[40px] px-3.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{salvando ? 'Salvo…' : 'Salva ed esci'}</button>
        </div>
      </Modal>
      {puoScrivere && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">Non sai da dove partire? La proposta legge le chiusure di cassa del negozio e le ore di contratto di chi ci lavora.</p>
          <button type="button" onClick={proponiDaiDati} disabled={salvo === 'stima'}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
            <Sparkles size={15} /> {salvo === 'stima' ? 'Calcolo…' : 'Proponi dai dati'}
          </button>
        </div>
      )}
      {proposta && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <strong>Proposta dai dati, non ancora salvata.</strong> Controlla e salva {puoFabbisogno ? 'orari e fabbisogno' : 'gli orari (il fabbisogno lo decide la direzione, profilo Super Advisor)'}.
          <ul className="list-disc pl-5 mt-1 space-y-0.5">{proposta.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {!proposta && (stimaSalvata.orari || stimaSalvata.fasce) && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          {stimaSalvata.orari && stimaSalvata.fasce ? 'Orari e fabbisogno' : stimaSalvata.orari ? 'Gli orari' : 'Il fabbisogno'} di {nomeNegozio} sono stimati dai dati e non ancora confermati: controlla e salva per confermarli.
        </div>
      )}
      <div className={`rounded-xl border p-4 flex flex-wrap gap-x-8 gap-y-2 text-sm ${oreServono > 0 && mancano > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
        <span>Ore da coprire in una settimana tipo: <strong className="tabular-nums">{oreServono.toLocaleString('it-IT')}</strong></span>
        <span>Ore di contratto delle persone in servizio: <strong className="tabular-nums">{oreContratto.toLocaleString('it-IT')}</strong></span>
        {oreServono > 0 && (mancano > 0
          ? <span className="font-semibold text-amber-900">Mancano {mancano.toLocaleString('it-IT')} ore</span>
          : <span className="font-semibold text-emerald-800">Le ore bastano: {(-mancano).toLocaleString('it-IT')} in più, che la proposta lascia per ferie e permessi</span>)}
        {oreServono === 0 && <span className="text-slate-500">Senza fabbisogno la proposta dei turni usa solo le ore di contratto.</span>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Scheda n={1} titolo="Orario del negozio" sotto="Quando è aperto. I turni stanno dentro questo orario."
          azione={puoScrivere && <button type="button" onClick={copiaOrariLunedi} className={btnPiccolo}><Copy size={13} /> Lunedì su tutti</button>}>
          <table className="w-full text-sm">
            <tbody>
              {orari.map((o, i) => (
                <tr key={o.giorno} className="border-b border-slate-100">
                  <td className="py-1.5 font-medium w-24">{NOMI_GIORNO[o.giorno]}</td>
                  <td className="px-2 py-1.5">
                    <label className="text-xs text-slate-600 flex items-center gap-1.5">
                      <input type="checkbox" disabled={!puoScrivere} checked={o.chiuso}
                        onChange={(e) => setOrari((x) => x.map((r, j) => (j === i ? { ...r, chiuso: e.target.checked } : r)))} /> chiuso
                    </label>
                  </td>
                  <td className="px-1 py-1.5">
                    <label className="sr-only" htmlFor={`apre-${o.giorno}`}>Apre</label>
                    <input id={`apre-${o.giorno}`} type="time" step={1800} disabled={!puoScrivere || o.chiuso} className={inputCls} value={o.apre}
                      onChange={(e) => setOrari((x) => x.map((r, j) => (j === i ? { ...r, apre: e.target.value } : r)))} />
                  </td>
                  <td className="px-1 py-1.5">
                    <label className="sr-only" htmlFor={`chiude-${o.giorno}`}>Chiude</label>
                    <input id={`chiude-${o.giorno}`} type="time" step={1800} disabled={!puoScrivere || o.chiuso} className={inputCls} value={o.chiude}
                      onChange={(e) => setOrari((x) => x.map((r, j) => (j === i ? { ...r, chiude: e.target.value } : r)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="text-sm font-semibold text-slate-800 mt-4">Giorni chiusi e orari diversi</h4>
          <p className="text-xs text-slate-500">Natale, Capodanno, vigilie con chiusura anticipata: valgono al posto dell’orario solito.</p>
          <ul className="divide-y divide-slate-100 text-sm mt-1">
            {speciali.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-2">
                <span>
                  <strong>{formattaDataBreve(s.data)}</strong>{s.nota ? ` · ${s.nota}` : ''}
                  <span className="text-slate-500"> · {s.chiuso ? 'chiuso' : `${s.apre || 'orario solito'}${s.chiude ? `-${s.chiude}` : ''}`}{s.persone_extra ? `, ${s.persone_extra > 0 ? '+' : ''}${s.persone_extra} persone` : ''}</span>
                </span>
                {puoScrivere && s.id && (
                  <button type="button" aria-label="Togli il giorno" onClick={() => togliSpeciale(s.id!)} className="p-1.5 rounded hover:bg-slate-100"><Trash2 size={14} /></button>
                )}
              </li>
            ))}
            {!speciali.length && <li className="py-2 text-slate-400">Nessun giorno di chiusura o con orario diverso nei prossimi mesi.</li>}
          </ul>
          {puoScrivere && (
            <div className="pt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600">Data<br /><input type="date" className={inputCls} value={nuovoSpeciale.data} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, data: e.target.value }))} /></label>
              <label className="text-xs text-slate-600 flex items-center gap-1 pb-2"><input type="checkbox" checked={nuovoSpeciale.chiuso} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, chiuso: e.target.checked }))} /> chiuso</label>
              <label className="text-xs text-slate-600">Apre<br /><input type="time" step={1800} disabled={nuovoSpeciale.chiuso} className={inputCls} value={nuovoSpeciale.apre} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, apre: e.target.value }))} /></label>
              <label className="text-xs text-slate-600">Chiude<br /><input type="time" step={1800} disabled={nuovoSpeciale.chiuso} className={inputCls} value={nuovoSpeciale.chiude} onChange={(e) => setNuovoSpeciale((s) => ({ ...s, chiude: e.target.value }))} /></label>
              <label className="text-xs text-slate-600 flex-1 min-w-[140px]">Nota<br /><input className={`${inputCls} w-full`} value={nuovoSpeciale.nota} placeholder="Natale, vigilia…" onChange={(e) => setNuovoSpeciale((s) => ({ ...s, nota: e.target.value }))} /></label>
              {altriNegozi.length > 0 && (
                <label className="text-xs text-slate-600 flex items-center gap-1 pb-2"><input type="checkbox" checked={suTutti} onChange={(e) => setSuTutti(e.target.checked)} /> anche negli altri {altriNegozi.length} negozi</label>
              )}
              <button type="button" onClick={aggiungiSpeciale} disabled={salvo === 'speciali'} className={btnPiccolo}><Plus size={13} /> Aggiungi</button>
            </div>
          )}
        </Scheda>

        <Scheda n={2} titolo="Persone in negozio" lucchetto={!puoFabbisogno}
          sotto={puoFabbisogno ? 'Il minimo di persone, fascia per fascia. Dove gli ingressi MODA chiedono di più, le persone aumentano.' : 'Il minimo di persone, fascia per fascia. Lo decide la direzione (profilo Super Advisor): qui lo vedi, non lo modifichi.'}>
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Giorno delle fasce">
            {schedeGiorni.map((t) => (
              <button key={t.g} type="button" role="tab" aria-selected={giornoScelto === t.g} onClick={() => setGiornoFasce(t.g)}
                className={`min-h-[36px] px-3 rounded-lg text-sm font-semibold ${giornoScelto === t.g ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}>{t.nome}</button>
            ))}
            {puoFabbisogno && (
              <select aria-label="Copia le fasce da un altro giorno" value="" onChange={(e) => { if (e.target.value) copiaFasceDa(Number(e.target.value)); }}
                className="min-h-[36px] rounded-lg border border-dashed border-slate-400 px-2 text-sm bg-white">
                <option value="">Copia da…</option>
                {[1, 2, 3, 4, 5, 6, 7].filter((g) => g !== (giornoScelto === 0 ? 1 : giornoScelto) && fasce.some((f) => f.giorno === g)).map((g) => <option key={g} value={g}>{NOMI_GIORNO[g]}</option>)}
              </select>
            )}
          </div>
          <div className="mt-3">
            <FasceEditor fasce={fasceDelGiornoScelto} apre={orarioDelGiornoScelto.apre} chiude={orarioDelGiornoScelto.chiude} bloccato={!puoFabbisogno} onCambia={cambiaFasceDelGiorno} />
          </div>
          {puoFabbisogno && (
            <button type="button" onClick={() => { setFerialiInsieme((v) => !v); setGiornoFasce(ferialiInsieme ? 1 : 0); }} className="mt-2 text-xs underline text-slate-600">
              {ferialiInsieme ? 'I feriali non sono tutti uguali: scrivili giorno per giorno' : 'Scrivi i feriali tutti insieme (da lunedì a venerdì uguali al giorno scelto)'}
            </button>
          )}
          <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
            <Riga etichetta="Ingressi MODA per addetto all’ora (provvisorio)">
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <input aria-label="Ingressi per addetto, feriali" type="number" min={1} max={200} disabled={!puoScrivere} className={`${inputCls} w-16 text-center`} value={regole.sogliaFeriali} onChange={(e) => setRegole((r) => ({ ...r, sogliaFeriali: Number(e.target.value) || 0 }))} /> feriali
                <input aria-label="Ingressi per addetto, sabato, domenica e festivi" type="number" min={1} max={200} disabled={!puoScrivere} className={`${inputCls} w-16 text-center ml-2`} value={regole.sogliaWeekend} onChange={(e) => setRegole((r) => ({ ...r, sogliaWeekend: Number(e.target.value) || 0 }))} /> weekend
              </span>
            </Riga>
            {trafficoDa !== undefined && altriNegozi.length > 0 && (
              <Riga etichetta="Se il negozio non ha ingressi suoi, usa quelli di">
                <select aria-label="Negozio di riferimento per il traffico MODA" disabled={!puoScrivere} className={inputCls} value={trafficoDa ?? ''} onChange={(e) => setTrafficoDa(e.target.value || null)}>
                  <option value="">media degli altri negozi</option>
                  {altriNegozi.map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                </select>
              </Riga>
            )}
            <Riga etichetta="Senza fasce salvate: sempre almeno due persone, salvo la prima e l’ultima ora">
              <Interruttore acceso={regole.duePersone} disabled={!puoScrivere} etichetta="Almeno due persone senza fasce salvate" onCambia={(v) => setRegole((r) => ({ ...r, duePersone: v }))} />
            </Riga>
          </div>
        </Scheda>

        {haProva && (
          <Scheda n={3} titolo="Giorni caldi" sotto="Sabato, domenica, festivi e giorni di evento. Le persone le decidono le fasce del sabato e della domenica, con gli ingressi MODA sopra."
            azione={<Interruttore acceso={!!regole.giorniPieni} disabled={!puoScrivere} etichetta="Giorni caldi" onCambia={(v) => setRegole((r) => ({ ...r, giorniPieni: v }))} />}>
            {!regole.giorniPieni && <p className="text-sm text-slate-500">Spenti: festivi ed eventi seguono le fasce del loro giorno e nessuno supera il contratto.</p>}
            {regole.giorniPieni && !ha403 && <p className="text-sm text-slate-500">Accesi. Le scelte di dettaglio (chi apre e chi chiude, fasce dei festivi) arrivano con il prossimo aggiornamento del database.</p>}
            {regole.giorniPieni && ha403 && (
              <div>
                <Riga etichetta="Lavorano tutte, senza riposi in quei giorni"><Interruttore acceso={regole.caldiTutti ?? true} disabled={!puoScrivere} etichetta="Nei giorni caldi lavorano tutte" onCambia={(v) => setRegole((r) => ({ ...r, caldiTutti: v }))} /></Riga>
                <Riga etichetta="Straordinari ammessi"><Interruttore acceso={regole.caldiStraordinari ?? true} disabled={!puoScrivere} etichetta="Straordinari ammessi nei giorni caldi" onCambia={(v) => setRegole((r) => ({ ...r, caldiStraordinari: v }))} /></Riga>
                <Riga etichetta="Festivi e giorni speciali usano le fasce di">
                  <select aria-label="Fasce dei festivi e dei giorni speciali" disabled={!puoScrivere} className={inputCls} value={regole.caldiFasceFestivi === 7 ? '7' : '6'} onChange={(e) => setRegole((r) => ({ ...r, caldiFasceFestivi: e.target.value === '7' ? 7 : 6 }))}>
                    <option value="6">Sabato</option><option value="7">Domenica</option>
                  </select>
                </Riga>
                <Riga etichetta="Responsabile e vice: una apre, l’altra chiude, a turno"><Interruttore acceso={regole.caldiGuidaApreChiude ?? false} disabled={!puoScrivere} etichetta="Responsabile e vice: apertura e chiusura a turno" onCambia={(v) => setRegole((r) => ({ ...r, caldiGuidaApreChiude: v }))} /></Riga>
                <Riga etichetta="Chi apre resta (ore)">
                  <input aria-label="Ore di chi fa l'apertura nei giorni caldi" type="number" min={4} max={12} step={0.5} disabled={!puoScrivere} className={`${inputCls} w-20 text-center`} value={regole.caldiOreApertura ?? 9} onChange={(e) => setRegole((r) => ({ ...r, caldiOreApertura: Number(e.target.value) || 9 }))} />
                </Riga>
              </div>
            )}
          </Scheda>
        )}

        <Scheda n={4} titolo="Pause" sotto={regole.pausaCortaPagata ? 'Si timbrano sempre. Quella corta non si toglie dalle ore.' : 'Non sono lavoro: si tolgono dalle ore.'}>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-800"><th className="py-1.5 font-semibold">Turno</th><th className="py-1.5 font-semibold">Pausa</th><th className="py-1.5 font-semibold">Si toglie dalle ore</th></tr></thead>
            <tbody>
              <tr className="border-b border-slate-100"><td className="py-2">Fino a <input aria-label="Ore senza pausa" type="number" min={1} max={12} step={0.5} disabled={!puoScrivere} className={`${inputCls} w-16 text-center mx-1`} value={regole.pausaOltreOre} onChange={(e) => setRegole((r) => ({ ...r, pausaOltreOre: Number(e.target.value) || 0 }))} /> ore</td><td className="py-2">nessuna</td><td className="py-2">–</td></tr>
              <tr className="border-b border-slate-100"><td className="py-2">{regole.pausaCortaPagata ? 'Fino a' : 'Sotto le'} <input aria-label="Ore da cui la pausa è lunga" type="number" min={1} max={12} step={0.5} disabled={!puoScrivere} className={`${inputCls} w-16 text-center mx-1`} value={regole.pausaLungaOltreOre} onChange={(e) => setRegole((r) => ({ ...r, pausaLungaOltreOre: Number(e.target.value) || 0 }))} /> ore</td>
                <td className="py-2"><input aria-label="Minuti della pausa corta" type="number" min={0} max={120} step={5} disabled={!puoScrivere} className={`${inputCls} w-16 text-center mr-1`} value={regole.pausaMinuti} onChange={(e) => setRegole((r) => ({ ...r, pausaMinuti: Number(e.target.value) || 0 }))} /> min</td>
                <td className="py-2">{haProva ? <Interruttore acceso={!regole.pausaCortaPagata} disabled={!puoScrivere} etichetta="La pausa corta si toglie dalle ore" onCambia={(v) => setRegole((r) => ({ ...r, pausaCortaPagata: !v }))} /> : 'sì'}</td></tr>
              <tr><td className="py-2">Sopra</td>
                <td className="py-2"><input aria-label="Minuti della pausa lunga" type="number" min={0} max={120} step={5} disabled={!puoScrivere} className={`${inputCls} w-16 text-center mr-1`} value={regole.pausaLungaMinuti} onChange={(e) => setRegole((r) => ({ ...r, pausaLungaMinuti: Number(e.target.value) || 0 }))} /> min</td>
                <td className="py-2">sì</td></tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-2">{regole.pausaCortaPagata
            ? `Le soglie si contano sulle ore di turno. Esempio: 10-18 vale 8 ore, con ${regole.pausaMinuti} minuti timbrati e non tolti; 10-19 vale ${(9 - regole.pausaLungaMinuti / 60).toLocaleString('it-IT')} ore.`
            : 'Le soglie si contano sulle ore lavorate. La pausa ha solo una durata: si fa quando il negozio lo permette.'}</p>
        </Scheda>

        <Scheda n={5} titolo="Riposi" sotto="Per legge c’è sempre almeno un giorno di riposo a settimana.">
          {ha403 ? (
            <Riga etichetta="Riposi a settimana a testa, almeno (se possibile)">
              <input aria-label="Riposi minimi a settimana" type="number" min={RIPOSO_LEGALE} max={3} disabled={!puoScrivere} className={`${inputCls} w-16 text-center`} value={regole.riposiMinSettimana ?? RIPOSO_LEGALE}
                onChange={(e) => setRegole((r) => ({ ...r, riposiMinSettimana: Math.max(RIPOSO_LEGALE, Math.min(3, Number(e.target.value) || RIPOSO_LEGALE)) }))} />
            </Riga>
          ) : (
            <Riga etichetta="Giorni di lavoro a settimana, al massimo">
              <input aria-label="Giorni di lavoro a settimana, al massimo" type="number" min={1} max={6} disabled={!puoScrivere} className={`${inputCls} w-16 text-center`} value={Math.min(6, regole.giorniLavoroMax)} onChange={(e) => setRegole((r) => ({ ...r, giorniLavoroMax: Math.max(1, Math.min(6, Number(e.target.value) || 6)) }))} />
            </Riga>
          )}
          <p className="text-xs text-slate-500 mb-2">I riposi si distribuiscono fra tutte: non tre a una persona e uno a un’altra. Sotto 1 non si scende mai.</p>
          <RiposiNegozio companyId={companyId} persone={persone} puoScrivere={puoScrivere} />
        </Scheda>

        <Scheda n={6} titolo="Ore e straordinari" sotto="Il contratto è a settimana, da lunedì a domenica.">
          <Riga etichetta="Turno più corto e più lungo (ore)">
            <span className="flex items-center gap-1">
              <input aria-label="Turno minimo nella giornata, ore" type="number" min={1} max={12} step={0.5} disabled={!puoScrivere} className={`${inputCls} w-16 text-center`} value={regole.turnoMinOre} onChange={(e) => setRegole((r) => ({ ...r, turnoMinOre: Number(e.target.value) || 0 }))} />
              <span className="text-slate-400">–</span>
              <input aria-label="Turno massimo, ore" type="number" min={1} max={12} step={0.5} disabled={!puoScrivere} className={`${inputCls} w-16 text-center`} value={regole.turnoMaxOre} onChange={(e) => setRegole((r) => ({ ...r, turnoMaxOre: Number(e.target.value) || 0 }))} />
            </span>
          </Riga>
          {ha403 && (
            <>
              <Riga etichetta="Giorni di lavoro a settimana, al massimo">
                <input aria-label="Giorni di lavoro a settimana, al massimo" type="number" min={1} max={6} disabled={!puoScrivere} className={`${inputCls} w-16 text-center`} value={Math.min(6, regole.giorniLavoroMax)} onChange={(e) => setRegole((r) => ({ ...r, giorniLavoroMax: Math.max(1, Math.min(6, Number(e.target.value) || 6)) }))} />
              </Riga>
              <Riga etichetta="Straordinari divisi in parti uguali fra tutte"><Interruttore acceso={!!regole.straordinariPari} disabled={!puoScrivere} etichetta="Straordinari divisi in parti uguali" onCambia={(v) => setRegole((r) => ({ ...r, straordinariPari: v }))} /></Riga>
            </>
          )}
          {haRiempi && (
            <Riga etichetta="Ore fino al contratto: le ore che gli ingressi non chiedono vanno comunque in turno"><Interruttore acceso={!!regole.riempiContratto} disabled={!puoScrivere} etichetta="Ore fino al contratto" onCambia={(v) => setRegole((r) => ({ ...r, riempiContratto: v }))} /></Riga>
          )}
          <ul className="text-xs text-slate-500 list-disc pl-4 mt-2 space-y-1">
            <li>Nei feriali nessuno supera le ore di contratto. Gli straordinari si fanno solo nei giorni caldi e negli eventi che li ammettono, a ore e mezz’ore.</li>
            <li>La persona in più chiesta dalla direzione per ricarico del magazzino o allestimento si aggiunge a mano nella settimana: nella finestra del turno si segna «Straordinario» e si sceglie il motivo.</li>
          </ul>
        </Scheda>

        {guida && (
          <Scheda n={7} titolo="Responsabile e vice" sotto="Le sole a fare il versamento. Il lunedì una delle due è in negozio.">{guida}</Scheda>
        )}

        <div className="xl:col-span-2 min-w-0">
          <Scheda n={8} titolo="Eventi e giorni speciali" sotto="">
            <EventiDelNegozio companyId={companyId} outletId={outletId} nomeNegozio={nomeNegozio} negozi={[{ id: outletId, nome: nomeNegozio }, ...altriNegozi]}
              puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} onSalvato={onSalvato} onVaiEventi={onVaiEventi} />
          </Scheda>
        </div>
      </div>
      {puoScrivere && (
        <div className="flex justify-end">
          <button type="button" onClick={() => salva(['orari', 'regole', ...(puoFabbisogno ? ['fasce' as const] : [])])} disabled={salvando}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"><Save size={16} /> {salvando ? 'Salvo…' : 'Salva'}</button>
        </div>
      )}
    </div>
  );
}

const btnPiccolo = 'inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50';

function Scheda({ n, titolo, sotto, azione, lucchetto, children }: { n: number; titolo: string; sotto: string; azione?: ReactNode; lucchetto?: boolean; children: ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 min-w-0" aria-label={titolo}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <span className="inline-flex w-6 h-6 rounded-full bg-slate-900 text-white text-xs items-center justify-center shrink-0">{n}</span>
            {titolo} {lucchetto && <Lock size={13} className="text-slate-400" />}
          </h3>
          {sotto && <p className="text-xs text-slate-500 mt-0.5">{sotto}</p>}
        </div>
        {azione}
      </div>
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}

function Riga({ etichetta, children }: { etichetta: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-100 text-sm">
      <span className="text-slate-700">{etichetta}</span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

function Interruttore({ acceso, onCambia, etichetta, disabled }: { acceso: boolean; onCambia: (v: boolean) => void; etichetta: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={acceso} aria-label={etichetta} disabled={disabled} onClick={() => onCambia(!acceso)}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${acceso ? 'bg-pink-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${acceso ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}
