// «Piano settimanale»: i turni di un negozio, persone per giorni.
//
// Chi c'e' viene dall'organico di oggi (anagrafica + cambiamenti), meno le
// ferie approvate a giornata intera. «Proponi i turni» rifa' solo le
// proposte in bozza: i turni messi a mano e quelli gia' pubblicati restano.
// Ogni modifica fatta su un turno lo rende «manuale», e il ricalcolo non lo
// tocca piu'. Sotto ogni giorno: se la copertura basta o cosa manca.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Info, RefreshCw, Send, Trash2 } from 'lucide-react';
import { almenoDuePersone } from '../lib/pianoMensile';
import EditorTurno from './EditorTurno';
import SpostaTurnoModal from './SpostaTurnoModal';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import {
  personaAllaData, nomePersona, formattaDataBreve, oggiRoma, aggiungiGiorni, contaNellOrganico,
  type PersonaOggi,
} from '../lib/organico';
import { caricaDisponibilita, caricaGiorniFerie, puoLavorareIl, type DatiOrganico } from '../lib/organicoDati';
import { fasceDelle, fasciaIl, type Accordo } from '../lib/accordiOrario';
import { avvisiMossa as avvisiDellaMossa, esitoMossa, mossePossibili, type ContestoSpostamenti, type MossaTurno } from '../lib/spostaTurni';
import { eseguiMossaSuShifts } from '../lib/spostaTurniDb';
import { caricaTrasferte, copertureVerso, oreTrasferta, type Trasferta } from '../lib/trasferte';
import {
  NOMI_GIORNO_BREVI, REGOLE_DEFAULT, costruisciGiorni, regoleDaRiga, pausaPer, giorniDellaSettimana, lunediDi, oreLavorate,
  proponiSettimana, scopertureDelGiorno, collocaPause, eventiDelNegozio, type EventoNegozio, type GiornoPiano, type RegoleTurni, type Turno,
} from '../lib/turni';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  dati: DatiOrganico;
  puoScrivere: boolean;
  onVaiOrari: () => void;
};

type TurnoDb = {
  id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number; plan_id: string | null;
  origine: 'proposta' | 'manuale'; stato: 'bozza' | 'pubblicato' | 'annullato'; annullato_motivo: string | null;
};

const t5 = (t: string) => t.slice(0, 5);
// Nei turni contano le ferie approvate e anche quelle chieste e in attesa
// (Patrizio, 20/10/2026: «prendile in considerazione»): una richiesta
// respinta torna disponibile al ricalcolo, un giorno respinto no.
const STATI_FERIE_APPROVATE = ['inviata', 'approvata', 'approvata_parziale', 'chiusa'];
const GIORNI_FERIE_VALIDI = ['richiesto', 'approvato'];

export default function PianoTurni({ companyId, outletId, nomeNegozio, dati, puoScrivere, onVaiOrari }: Props) {
  const { toast } = useToast();
  const [lunedi, setLunedi] = useState(lunediDi(oggiRoma()));
  const date = useMemo(() => giorniDellaSettimana(lunedi), [lunedi]);
  const [giorni, setGiorni] = useState<GiornoPiano[]>([]);
  const [haOrari, setHaOrari] = useState(true);
  const [haFabbisogno, setHaFabbisogno] = useState(true);
  const [stimati, setStimati] = useState(false);
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
  // Turno trascinato e mossa da confermare (Patrizio, 29/10/2026: come nel piano del mese).
  const [trascinato, setTrascinato] = useState<string | null>(null);
  const [mossa, setMossa] = useState<{ turno: TurnoDb; versoId: string; versoData: string } | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const [o, f, s, r, t, fe, sl, ev, pi, disp, tr] = await Promise.all([
        supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude, origine').eq('outlet_id', outletId),
        supabase.from('outlet_staffing_needs').select('giorno, dalle, alle, persone, origine').eq('outlet_id', outletId),
        supabase.from('outlet_special_days').select('data, chiuso, apre, chiude, persone_extra, nota').eq('outlet_id', outletId).gte('data', date[0]).lte('data', date[6]),
        supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
        supabase.from('shifts').select('id, employee_id, data, inizio, fine, pausa_minuti, origine, stato, annullato_motivo, plan_id, straordinario, ore_straordinario')
          .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', date[0]).lte('data', date[6]).order('inizio'),
        caricaGiorniFerie(companyId, date[0], date[6]),
        supabase.from('v_leave_disponibilita').select('employee_id, residuo_disponibile').eq('company_id', companyId),
        // Eventi della settimana (Black Friday, feste, saldi): piu' persone e straordinari se mancano
        supabase.from('outlet_events').select('nome, data_dal, data_al, outlet_ids, persone_extra, blocca_ferie, straordinari')
          .eq('company_id', companyId).lte('data_dal', date[6]).gte('data_al', date[0]),
        // Piani del mese scelti per i mesi di questa settimana: nei loro giorni valgono i loro turni.
        supabase.from('shift_plans').select('id, mese').eq('outlet_id', outletId).eq('stato', 'scelto')
          .in('mese', [...new Set([date[0], date[6]].map((d) => `${d.slice(0, 7)}-01`))]),
        caricaDisponibilita(companyId).catch(() => new Map<string, Accordo>()),
        caricaTrasferte(companyId, date[0], date[6]).catch(() => [] as Trasferta[]),
      ]);
      setDisponibilita(disp);
      setTrasferte(tr);
      const pianoDelMese = new Map(((pi.data as { id: string; mese: string }[]) ?? []).map((x) => [x.mese.slice(0, 7), x.id]));
      setPianiScelti(pianoDelMese);
      const orari = (o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [];
      const fasce = (f.data as { giorno: number; dalle: string; alle: string; persone: number }[]) ?? [];
      setHaOrari(orari.length > 0);
      setStimati([...orari, ...fasce].some((x) => (x as { origine?: string }).origine === 'stima'));
      setHaFabbisogno(fasce.some((x) => x.persone > 0));
      setGiorni(costruisciGiorni(date, orari, fasce,
        (s.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? [],
        eventiDelNegozio((ev.data as EventoNegozio[]) ?? [], outletId), dati.negozi.find((n) => n.id === outletId)?.opening_date ?? null));
      setRegole(regoleDaRiga(r.data as Parameters<typeof regoleDaRiga>[0]));
      // Si vedono i turni del piano scelto per quel mese, oppure quelli fatti settimana per settimana.
      setTurni(((t.data as TurnoDb[]) ?? [])
        .filter((x) => (x.plan_id ?? null) === (pianoDelMese.get(x.data.slice(0, 7)) ?? null))
        .map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine) })));
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
  }, [companyId, outletId, date, toast]);

  useEffect(() => { carica(); }, [carica]);

  // Chi lavora in questo negozio nella settimana, giorno per giorno.
  const persone = useMemo(() => {
    const out: { scheda: PersonaOggi['scheda']; perGiorno: PersonaOggi[]; ore: number | null }[] = [];
    for (const s of dati.schede) {
      const perGiorno = date.map((d) => personaAllaData(s, dati.eventi, d));
      const qui = perGiorno.some((p) => p.outletId === outletId && (contaNellOrganico(p)))
        || turni.some((t) => t.employee_id === s.id && t.stato !== 'annullato');
      if (!qui || perGiorno.every((p) => p.stato === 'fuori_organico')) continue;
      const oreSett = perGiorno.find((p) => p.outletId === outletId && p.stato === 'in_servizio')?.ore ?? perGiorno[0].ore;
      out.push({ scheda: s, perGiorno, ore: oreSett });
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

  const attivi = turni.filter((t) => t.stato !== 'annullato');
  const turniPerCalcolo: Turno[] = attivi.map((t) => ({ employeeId: t.employee_id, data: t.data, inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }));
  const esclusiDallaProposta = persone.filter((p) => p.ore == null || p.ore <= 0);

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
      const candidati = persone
        .filter((p) => p.ore != null && p.ore > 0)
        .map((p) => ({
          id: p.scheda.id,
          // le ore gia' coperte da ferie e permessi approvati in settimana non si lavorano
          ore: Math.max(0, (p.ore as number) - date.reduce((a, d) => a + Number(inFerie(p.scheda.id, d)?.ore ?? 0), 0)
            // le ore di trasferta sono lavoro gia' fatto fuori dal negozio
            - trasferte.filter((x) => x.employeeId === p.scheda.id).reduce((a, x) => a + oreTrasferta(x), 0)),
          nonDisponibile: new Set(date.filter((d, i) => motivoNonDisponibile(p.perGiorno[i], p.scheda.id, d) != null)),
          saldoOre: saldi.get(p.scheda.id) ?? 0,
          // accordi della scheda: le fasce orarie in cui puo' lavorare
          fasce: fasceDelle(disponibilita, p.scheda.id, date),
        }));
      // chi viene qui in trasferta e copre il negozio conta come presenza
      const fissiTutti = [...fissi, ...copertureVerso(trasferte, outletId)];
      const proposta = proponiSettimana({ giorni, persone: candidati, regole, fissi: fissiTutti });
      // Mai un giorno con una persona sola (Patrizio, 28/10/2026); i turni a mano non si toccano.
      const esito = { ...proposta, turni: almenoDuePersone(giorni, proposta.turni, candidati, [], regole, fissiTutti) };
      if (esito.turni.length) {
        const { error } = await supabase.from('shifts').insert(esito.turni.map((t) => ({
          company_id: companyId, outlet_id: outletId, employee_id: t.employeeId, data: t.data,
          inizio: t.inizio, fine: t.fine, pausa_minuti: t.pausaMinuti, origine: 'proposta', stato: 'bozza',
          plan_id: pianiScelti.get(t.data.slice(0, 7)) ?? null,
        })));
        if (error) throw error;
      }
      const libere = Object.values(esito.ore).reduce((a, o) => a + Math.max(0, o.contratto - o.pianificate), 0);
      const straord = Object.values(esito.ore).reduce((a, o) => a + (o.straordinario ?? 0), 0);
      const perFerie = (libere > 0.25 ? ` ${libere.toLocaleString('it-IT')} ore di contratto non servono: restano per ferie e permessi, le vedi nella colonna Ore.` : '')
        + (straord > 0.25 ? ` Per l'evento servono ${straord.toLocaleString('it-IT')} ore di straordinario.` : '');
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

  const pubblica = async () => {
    setLavoro(true);
    // Solo i turni che si vedono: quelli del piano scelto del mese o quelli settimanali, non le varianti scartate.
    const daPubblicare = turni.filter((t) => t.stato === 'bozza').map((t) => t.id);
    const { error } = await supabase.from('shifts').update({ stato: 'pubblicato' }).in('id', daPubblicare.length ? daPubblicare : ['00000000-0000-0000-0000-000000000000']);
    setLavoro(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: `Turni della settimana pubblicati per ${nomeNegozio}.` });
    carica();
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

  if (caricamento && !giorni.length) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const bozze = attivi.filter((t) => t.stato === 'bozza').length;
  const pubblicati = attivi.filter((t) => t.stato === 'pubblicato').length;
  const annullatiPubblicati = turni.filter((t) => t.stato === 'annullato').length;
  const scoperture = giorni.flatMap((g) => scopertureDelGiorno(g, turniPerCalcolo));
  // Dove cade la pausa di ciascuno: sfalsata in modo che il negozio resti coperto (chi e' in pausa non conta).
  const pausaDi = new Map(giorni.flatMap((g) => collocaPause(g, turniPerCalcolo)).map((x) => [`${x.employeeId}|${x.data}`, x]));
  const totaleOre = persone.reduce((s, p) => s + attivi.filter((t) => t.employee_id === p.scheda.id).reduce((a, t) => a + oreLavorate({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }), 0), 0);
  const totaleContratto = persone.reduce((s, p) => s + (p.ore ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Settimana prima" onClick={() => setLunedi(aggiungiGiorni(lunedi, -7))} className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50"><ChevronLeft size={16} /></button>
          <span className="text-sm font-semibold text-slate-800 min-w-[200px] text-center">Settimana {formattaDataBreve(date[0])} – {formattaDataBreve(date[6])}</span>
          <button type="button" aria-label="Settimana dopo" onClick={() => setLunedi(aggiungiGiorni(lunedi, 7))} className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50"><ChevronRight size={16} /></button>
          {lunedi !== lunediDi(oggiRoma()) && (
            <button type="button" onClick={() => setLunedi(lunediDi(oggiRoma()))} className="text-xs text-blue-700 hover:underline">questa settimana</button>
          )}
        </div>
        {puoScrivere && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={proponi} disabled={lavoro || !haOrari}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={15} /> {attivi.length ? 'Ricalcola la proposta' : 'Proponi i turni'}
            </button>
            <button type="button" onClick={pubblica} disabled={lavoro || bozze === 0}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              <Send size={15} /> Pubblica al negozio{bozze ? ` (${bozze})` : ''}
            </button>
          </div>
        )}
      </div>

      {!haOrari && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex flex-wrap items-center gap-2">
          <AlertTriangle size={15} /> Mancano gli orari di {nomeNegozio}: senza, il sistema non sa quando servono le persone.
          <button type="button" onClick={onVaiOrari} className="underline font-semibold">Inserisci gli orari</button>
        </div>
      )}
      {haOrari && !haFabbisogno && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" /> Il fabbisogno di {nomeNegozio} non è ancora indicato (lo decide la direzione, profilo Super Advisor): la proposta distribuisce le ore di contratto, ma non può dire se bastano.
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
                <th key={g.data} className="px-1.5 py-2 font-semibold">
                  {NOMI_GIORNO_BREVI[g.giorno]} {g.data.slice(8, 10)}
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
              const pianificate = suoi.reduce((a, t) => a + oreLavorate({ inizio: t.inizio, fine: t.fine, pausaMinuti: t.pausa_minuti }), 0);
              return (
                <tr key={p.scheda.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{nomePersona(p.scheda)}</div>
                    <div className="text-xs text-slate-500">{p.ore != null ? `${p.ore} h` : 'a chiamata'}</div>
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
                          {vivo && pausaDi.get(`${p.scheda.id}|${g.data}`) && (
                            <span className="block font-sans text-[11px] opacity-75">pausa {pausaDi.get(`${p.scheda.id}|${g.data}`)!.dalle}-{pausaDi.get(`${p.scheda.id}|${g.data}`)!.alle}</span>
                          )}
                          {vivo && fe && <span className="block font-sans text-emerald-700">permesso {fe.ore} h</span>}
                        </button>
                        {annullato && !vivo && <span className="block text-[11px] text-slate-400 line-through text-center">{annullato.inizio}-{annullato.fine}</span>}
                      </td>
                    );
                  })}
                  <td className={`px-3 py-2 text-right tabular-nums ${p.ore != null && pianificate > p.ore + 0.01 ? 'text-amber-800 font-semibold' : 'text-emerald-800'}`}>
                    {pianificate.toLocaleString('it-IT')}{p.ore != null ? `/${p.ore}` : ''}
                    {p.ore != null && pianificate - p.ore > 0.25 && (
                      <span className="block text-[11px] font-normal text-amber-800 whitespace-nowrap">{(pianificate - p.ore).toLocaleString('it-IT')} h straordinario</span>
                    )}
                    {p.ore != null && p.ore - pianificate > 0.25 && (
                      <span className="block text-[11px] font-normal text-slate-500 whitespace-nowrap"
                        title="Ore di contratto che il negozio non usa questa settimana: si coprono con ferie o permessi">
                        {(p.ore - pianificate).toLocaleString('it-IT')} h ferie/permessi{saldi.get(p.scheda.id) ? ` · maturate ${Math.round(saldi.get(p.scheda.id)!).toLocaleString('it-IT')} h` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!persone.length && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-400">Nessuna persona in organico in questo negozio nella settimana.</td></tr>
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
              <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold">{totaleOre.toLocaleString('it-IT')}/{totaleContratto.toLocaleString('it-IT')}</td>
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
          esegui={async (m) => { const msg = await eseguiMossa(m, mossa.turno, mossa.versoId, mossa.versoData); if (msg) { toast({ type: 'success', message: msg }); carica(); } return !!msg; }}
          onClose={() => setMossa(null)} />
      )}
      {editor && (
        <EditorTurno
          companyId={companyId} outletId={outletId} employeeId={editor.employeeId} data={editor.data} turno={editor.turno}
          planId={pianiScelti.get(editor.data.slice(0, 7)) ?? null}
          nome={nomePersona(dati.schede.find((s) => s.id === editor.employeeId) ?? { nome: '', cognome: '' })}
          apre={giorni.find((g) => g.data === editor.data)!.apre} chiude={giorni.find((g) => g.data === editor.data)!.chiude}
          regole={regole}
          passaggio={editor.turno ? (() => {
            const t = editor.turno!;
            return {
              colleghi: persone.map((x) => ({ id: x.scheda.id, nome: nomePersona(x.scheda) })),
              haTurno: (id: string) => attivi.some((x) => x.employee_id === id && x.data === editor.data),
              avvisi: (m: MossaTurno, versoId: string, ore: { inizio: string; fine: string }) => avvisiDellaMossa(contestoMosse, m, t, versoId, editor.data, ore),
              esegui: (m: MossaTurno, versoId: string, ore: { inizio: string; fine: string; pausa_minuti: number }) => eseguiMossa(m, t, versoId, editor.data, ore),
            };
          })() : undefined}
          onClose={() => setEditor(null)}
          onSalvato={(msg) => { setEditor(null); if (msg) toast({ type: 'success', message: msg }); carica(); }}
        />
      )}
    </div>
  );
}
