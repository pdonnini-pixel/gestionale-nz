// Finestra per mettere, spostare o togliere un turno a mano. La usano il piano
// settimanale e il piano del mese (Patrizio, 20/10/2026: dal riepilogo «Ore del
// mese» la responsabile HR entra nella casella e sistema le ore; se con la
// dipendente si concordano ore in piu', il turno si segna come straordinario).

import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import { formattaDataBreve } from '../lib/organico';
import { NOMI_GIORNO_BREVI, hhmm, minuti, oreLavorate, pausaDelTurno, pausaMinimaPerPresenza, pausaPagataDelTurno, pausaPer, presenzaGiusta, sovrapposizioneChiusura, type RegoleTurni } from '../lib/turni';
import { MOTIVI_STRAORDINARIO } from '../lib/ottimizzaTurni';
import { oreGiornata } from '../lib/pianoMensile';
import { oreTrasferta, type Trasferta } from '../lib/trasferte';
import { mossePossibili, type MossaTurno } from '../lib/spostaTurni';

export type TurnoModificabile = {
  id: string; inizio: string; fine: string; pausa_minuti: number;
  origine: string; stato: string; straordinario?: boolean; ore_straordinario?: number; straordinario_motivo?: string | null;
  /** lo straordinario l'ha scritto una persona (migration 408): il ricalcolo non lo tocca */
  straordinario_a_mano?: boolean | null;
};

/**
 * Il conto della persona, per vedere subito come cambia (Patrizio, 28/10/2026:
 * «ore da contratto» e «ore programmate», nient'altro). Mese e settimana del turno.
 */
export type ContoMese = {
  /** ore da contratto nel periodo (ferie, permessi e trasferte tolti); null = a chiamata */
  daLavorare: number | null;
  /** ore programmate nel periodo, senza il turno che si sta modificando (straordinario escluso) */
  ordinarieAltri: number;
  /** ore di straordinario concordato nel periodo, senza questo turno */
  straordinarioAltri: number;
  /** la settimana del turno, con le stesse voci */
  settimana?: { daLavorare: number | null; ordinarieAltri: number; straordinarioAltri: number; etichetta: string };
};

// due decimali: con la pausa da 10 minuti le ore non cadono sulla mezz'ora (7,83)
const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 });

/**
 * Per inserire ferie e permessi dal calendario del mese (Patrizio, 28/10/2026):
 * ore settimanali della persona (la giornata vale ore / 6), codice del negozio,
 * e se quel giorno ha gia' ferie o permessi.
 */
export type FerieDalCalendario = {
  oreSettimana: number; outletCode: string | null; giaInFerie: boolean;
  /** le ferie o il permesso gia' segnati quel giorno: da qui si tolgono */
  esistente?: { id: string; requestId: string; testo: string; statoRichiesta: string } | null;
};

/**
 * Per segnare una trasferta dal calendario (Patrizio, 28/10/2026): i negozi fra
 * cui scegliere la destinazione e la trasferta gia' segnata quel giorno.
 */
export type TrasfertaDalCalendario = { negozi: { id: string; nome: string }[]; esistente: Trasferta | null };

/**
 * Dare il turno a un'altra persona o affiancarla (Patrizio, 29/10/2026), con
 * l'orario scritto nella finestra: le operazioni le fa il piano del mese.
 */
export type PassaggioTurno = {
  colleghi: { id: string; nome: string }[];
  haTurno: (id: string) => boolean;
  avvisi: (m: MossaTurno, versoId: string, ore: { inizio: string; fine: string }) => string[];
  esegui: (m: MossaTurno, versoId: string, ore: { inizio: string; fine: string; pausa_minuti: number }) => Promise<string | null>;
};

export default function EditorTurno({
  companyId, outletId, employeeId, data, turno, planId, nome, apre, chiude, chiusura, regole, conto, ferie, trasferta, passaggio, riposo, conMotivo, conAMano, giornoForte, onClose, onSalvato,
}: {
  /** la colonna del motivo dello straordinario c'e' (migration 399) */
  conMotivo?: boolean;
  /** la colonna «straordinario scritto a mano» c'e' (migration 408): dove manca non si scrive e non si spiega */
  conAMano?: boolean;
  /** il giorno e' a massima intensita' in questo negozio: il motivo proposto e' «giorno forte» */
  giornoForte?: boolean;
  companyId: string; outletId: string; employeeId: string; data: string; turno: TurnoModificabile | null; planId: string | null;
  nome: string; apre: number; chiude: number;
  /** chiusura di meta' giornata del negozio quel giorno (446): chi la attraversa la conta come pausa */
  chiusura?: { dalle: number; alle: number };
  regole: RegoleTurni; conto?: ContoMese; ferie?: FerieDalCalendario; trasferta?: TrasfertaDalCalendario; passaggio?: PassaggioTurno;
  /** giorno di riposo scelto dalla responsabile HR nel piano del mese (Patrizio, 11/11/2026) */
  riposo?: { attivo: boolean };
  /** chi apre la finestra puo' rileggere i dati prima di chiuderla: finche' non ha finito i pulsanti restano fermi */
  onClose: () => void; onSalvato: (messaggio?: string, cosa?: { ferie?: boolean; senzaRicalcoloStraordinari?: boolean }) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const [inizio, setInizio] = useState(turno?.inizio ?? hh(apre));
  const [fine, setFine] = useState(turno?.fine ?? hh(Math.min(chiude, apre + regole.turnoMaxOre * 60 + pausaPer(regole.turnoMaxOre * 60, regole))));
  const [pausa, setPausa] = useState(turno?.pausa_minuti ?? 0);
  const [allungato, setAllungato] = useState<string | null>(null);
  // La pausa si scrive da sola mentre si compila l'orario, e all'uscita dal campo
  // il turno si allunga alla presenza giusta (Patrizio, 11/11/2026: 6 ore di lavoro
  // = 6 ore di presenza, 7 e mezza = 8, 8 = 9). Una pausa piu' lunga scritta a mano resta.
  // L'orario aperto: finche' nessuno lo cambia, un turno esistente non si tocca.
  const ultimoOrario = useRef(`${turno?.inizio ?? ''}|${turno?.fine ?? ''}`);
  const pausaAMano = useRef(false);
  const scriviOrario = (i: string, f: string, allunga: boolean) => {
    if (allunga && `${i}|${f}` === ultimoOrario.current) return;
    setInizio(i); setFine(f);
    if (!i || !f || f <= i) return;
    // Il turno attraversa la chiusura di meta' giornata (446): la pausa e' la chiusura, l'orario resta quello scritto.
    if (chiusura && sovrapposizioneChiusura({ chiusura }, minuti(i), minuti(f)) > 0) {
      const p0 = pausaDelTurno({ chiusura }, minuti(i), minuti(f), regole);
      setPausa((p) => (pausaAMano.current ? Math.max(p, p0) : p0));
      if (allunga) ultimoOrario.current = `${i}|${f}`;
      setAllungato(null);
      return;
    }
    const g = presenzaGiusta(minuti(i), minuti(f), regole, apre, chiude);
    // una pausa scritta a mano piu' lunga di quella giusta resta
    setPausa((p) => (pausaAMano.current ? Math.max(p, g.pausa) : g.pausa));
    if (allunga) ultimoOrario.current = `${hhmm(g.inizio)}|${hhmm(g.fine)}`;
    if (allunga && g.allungato) {
      setInizio(hhmm(g.inizio)); setFine(hhmm(g.fine));
      setAllungato(`Con ${fmt(g.lavoro / 60)} ore di lavoro la pausa è di ${g.pausa} minuti: il turno diventa ${hhmm(g.inizio)}-${hhmm(g.fine)}.`);
    } else if (!g.allungato) setAllungato(null);
  };
  // Straordinario a ore: allungando un turno di un'ora, straordinario e' solo
  // quell'ora (Patrizio, 21/10/2026). Si propone la differenza rispetto alle ore
  // ordinarie che il turno aveva; si puo' correggere a mano.
  const oreStraordPrima = Number(turno?.ore_straordinario ?? 0);
  const ordinariePrima = turno ? oreLavorate({ inizio: turno.inizio, fine: turno.fine, pausaMinuti: turno.pausa_minuti }) - oreStraordPrima : 0;
  // Tre scelte (Patrizio, 25/11/2026): lo calcola il sistema, nessuno, lo decido io. «Nessuno»
  // e' una decisione a mano come le altre: il turno resta senza straordinario anche quando poi
  // il sistema ricalcola gli altri turni della settimana («le tolgo e basta»). Il calcolo del
  // sistema esiste solo nei giorni forti dei negozi con i giorni caldi.
  const sistemaQui = !!conAMano && !!regole.giorniPieni && !!giornoForte;
  const aManoPrima = turno?.straordinario_a_mano === true;
  type SceltaStraord = 'sistema' | 'nessuno' | 'mano';
  // ricarico e allestimento li decide la direzione: non sono mai «del sistema», anche senza la colonna 408
  const motivoDiretto = oreStraordPrima > 0 && (turno?.straordinario_motivo === 'ricarico' || turno?.straordinario_motivo === 'allestimento');
  const sceltaIniziale: SceltaStraord = aManoPrima || motivoDiretto ? (oreStraordPrima > 0 ? 'mano' : 'nessuno')
    : sistemaQui ? 'sistema' : oreStraordPrima > 0 ? 'mano' : 'nessuno';
  const [scelta, setScelta] = useState<SceltaStraord>(sceltaIniziale);
  const [oreStraordScritte, setOreStraordScritte] = useState<string | null>(oreStraordPrima > 0 ? String(oreStraordPrima) : null);
  // Perche' lo straordinario (Patrizio, 11/11/2026): giorno forte, oppure la persona in piu' chiesta dalla direzione.
  const [motivoStraord, setMotivoStraord] = useState<string>(turno?.straordinario_motivo ?? (giornoForte ? 'giorno_forte' : 'ricarico'));
  // Un valore messo a mano non si sovrascrive (revisori, 12/11/2026): si scrive «a mano» solo se
  // chi apre la finestra cambia la scelta, le ore o il motivo.
  const [straordToccato, setStraordToccato] = useState(false);
  const scegli = (x: SceltaStraord) => { setScelta(x); setStraordToccato(true); };
  const [mostraPausa, setMostraPausa] = useState(false);
  type Pannello = 'riposo' | 'ferie' | 'collega' | 'trasferta';
  const [pannello, setPannello] = useState<Pannello | null>(null);
  const [salvo, setSalvo] = useState(false);

  // La pausa non e' mai lavoro (Patrizio, 21/10/2026): nessuna fino a 6 ore lavorate, 30' oltre 6, un'ora
  // da 8. Si impone la minima per la presenza scritta; la si puo' allungare, non accorciare.
  const pausaMinima = fine > inizio
    ? (chiusura ? pausaDelTurno({ chiusura }, minuti(inizio), minuti(fine), regole) : pausaMinimaPerPresenza(minuti(fine) - minuti(inizio), regole))
    : 0;
  const pausaVera = Math.max(pausa, pausaMinima);
  const ore = oreLavorate({ inizio, fine, pausaMinuti: pausaVera });
  const dentroChiusura = (t: string) => !!chiusura && !!t && minuti(t) > chiusura.dalle && minuti(t) < chiusura.alle;
  const errore = fine <= inizio ? 'La fine viene prima dell’inizio.' : ore <= 0 ? 'Turno vuoto.'
    : dentroChiusura(inizio) || dentroChiusura(fine) ? `Il negozio è chiuso dalle ${hhmm(chiusura!.dalle)} alle ${hhmm(chiusura!.alle)}: il turno non può cominciare o finire lì dentro.`
    : null;
  const giornoSett = new Date(`${data}T00:00:00Z`).getUTCDay() || 7;

  // Come cambia il mese della persona con questo turno.
  const oreTurno = errore ? 0 : ore;
  const proposte = Math.max(0, oreTurno - (turno ? ordinariePrima : 0)) || oreTurno;
  const lette = oreStraordScritte != null ? Number(oreStraordScritte.replace(',', '.')) : NaN;
  const oreStraord = scelta === 'nessuno' ? 0
    : scelta === 'sistema' ? Math.min(oreTurno, oreStraordPrima)
      : Math.min(oreTurno, Math.max(0, Number.isFinite(lette) ? lette : proposte));
  // Ore da contratto contro ore programmate, per la settimana e per il mese.
  const contoDi = (c: { daLavorare: number | null; ordinarieAltri: number; straordinarioAltri: number } | undefined) => c && c.daLavorare != null ? {
    contratto: c.daLavorare,
    programmate: c.ordinarieAltri + (oreTurno - oreStraord),
    straord: c.straordinarioAltri + oreStraord,
  } : null;

  const salva = async () => {
    if (errore) return;
    setSalvo(true);
    // Salvando senza uscire dal campo il turno si allunga lo stesso (11/11/2026);
    // un turno aperto e salvato senza cambiare l'orario resta com'era.
    let [i, f, p] = [inizio, fine, pausaVera];
    if (`${inizio}|${fine}` !== ultimoOrario.current && !(chiusura && sovrapposizioneChiusura({ chiusura }, minuti(inizio), minuti(fine)) > 0)) {
      const g = presenzaGiusta(minuti(inizio), minuti(fine), regole, apre, chiude);
      [i, f, p] = [hhmm(g.inizio), hhmm(g.fine), Math.max(pausaAMano.current ? pausa : 0, g.pausa)];
    }
    const motivoScritto = scelta === 'sistema' ? 'giorno_forte' : motivoStraord;
    // «nessuno» diventa una decisione a mano solo se l'ha scelto chi apre la finestra
    const aManoNuovo = scelta === 'mano' ? oreStraord > 0 : scelta === 'nessuno' ? straordToccato : false;
    const riga = { inizio: i, fine: f, pausa_minuti: p, origine: 'manuale' as const, straordinario: oreStraord > 0, ore_straordinario: oreStraord, ...(conMotivo ? { straordinario_motivo: oreStraord > 0 ? motivoScritto : null } : {}),
      ...(conAMano && (straordToccato || !turno) ? { straordinario_a_mano: aManoNuovo } : {}) };
    const { error } = turno
      ? await supabase.from('shifts').update(riga).eq('id', turno.id)
      : await supabase.from('shifts').insert([{ ...riga, company_id: companyId, outlet_id: outletId, employee_id: employeeId, data, stato: 'bozza', plan_id: planId }]);
    if (error) { setSalvo(false); toast({ type: 'error', message: error.message }); return; }
    // Straordinario tolto a mano: si toglie e basta, gli altri turni della settimana restano come sono
    // finche' non se ne cambia uno (Patrizio, 25/11/2026).
    // solo se prima c'era uno straordinario o non era gia' «nessuno» a mano: altrimenti il ricalcolo parte come sempre
    const tolto = scelta === 'nessuno' && straordToccato && (oreStraordPrima > 0 || !aManoPrima);
    await onSalvato(tolto && oreStraordPrima > 0 ? 'Turno salvato senza straordinario: gli altri turni della settimana non cambiano.' : undefined,
      tolto ? { senzaRicalcoloStraordinari: true } : undefined);
    setSalvo(false);
  };

  // Il turno di un piano non pubblicato si toglie; uno pubblicato si annulla.
  const togliTurno = async (motivo: string) => {
    if (!turno) return null;
    const { error } = turno.stato !== 'pubblicato' && (planId || (turno.origine === 'proposta' && turno.stato === 'bozza'))
      ? await supabase.from('shifts').delete().eq('id', turno.id)
      : await supabase.from('shifts').update({ stato: 'annullato', annullato_motivo: motivo }).eq('id', turno.id);
    return error;
  };
  const togli = async () => {
    if (!turno) return;
    setSalvo(true);
    const error = await togliTurno('Tolto a mano');
    if (error) { setSalvo(false); toast({ type: 'error', message: error.message }); return; }
    await onSalvato();
    setSalvo(false);
  };

  // Giorno di riposo scelto a mano (Patrizio, 11/11/2026): oltre ai sabati e alle
  // domeniche liberi della rotazione, la responsabile HR segna lei i giorni di
  // riposo di ognuno. Si registra come gli altri liberi del piano; il turno del
  // giorno, se c'e', si toglie e le sue ore tornano da assegnare.
  const segnaRiposo = async () => {
    if (!planId) return;
    setSalvo(true);
    // prima il riposo, poi il turno: se qualcosa si ferma la persona non resta senza turno e senza riposo
    const { error: e1 } = await supabase.from('shift_plan_weekend_off')
      .upsert([{ company_id: companyId, plan_id: planId, employee_id: employeeId, data }], { onConflict: 'plan_id,employee_id,data' });
    const error = e1 ?? (turno ? await togliTurno('Giorno di riposo') : null);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato(`Giorno di riposo per ${nome.split(' ')[0]}${turno ? ': il turno è tolto e le sue ore tornano da assegnare' : ''}.`);
  };
  const togliRiposo = async () => {
    if (!planId) return;
    setSalvo(true);
    const { error } = await supabase.from('shift_plan_weekend_off').delete().eq('plan_id', planId).eq('employee_id', employeeId).eq('data', data);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato(`Riposo tolto: ${nome.split(' ')[0]} torna disponibile per un turno in questo giorno.`);
  };

  // Ferie e permessi inseriti dal calendario (Patrizio, 28/10/2026): giornata,
  // mezza giornata o permesso a ore, gia' approvati (consumano subito il saldo,
  // con la stessa approvazione di Approvazioni ferie) oppure da approvare.
  // Con la giornata intera il turno del giorno si toglie.
  const [orePermesso, setOrePermesso] = useState('2');
  const [giaApprovata, setGiaApprovata] = useState(true);
  const giornata = ferie ? Math.round(oreGiornata(ferie.oreSettimana, regole) * 100) / 100 : 0;
  const inserisciFerie = async (tipo: 'giornata' | 'mezza_giornata' | 'ore') => {
    if (!ferie) return;
    const oreF = tipo === 'giornata' ? giornata : tipo === 'mezza_giornata' ? Math.round(giornata / 2 * 100) / 100
      : Math.round(Number(orePermesso.replace(',', '.')) * 2) / 2;
    if (!(oreF > 0)) { toast({ type: 'error', message: 'Scrivi le ore del permesso.' }); return; }
    setSalvo(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const testo = tipo === 'giornata' ? `Giornata di ferie (${fmt(oreF)} h)` : tipo === 'mezza_giornata' ? `Mezza giornata di ferie (${fmt(oreF)} h)` : `Permesso di ${fmt(oreF)} h`;
      const { data: r, error } = await supabase.from('leave_requests').insert({
        company_id: companyId, employee_id: employeeId, outlet_code: ferie.outletCode,
        stato: 'inviata', origine: 'gestionale', titolo: 'Inserita dal piano del mese',
        note_dipendente: `${testo} il ${formattaDataBreve(data)}, inserita dalla responsabile HR nel calendario del mese.`,
        compilata_da: u.user?.id ?? null, inviata_il: new Date().toISOString(),
      }).select('id').single();
      if (error) throw error;
      const requestId = (r as { id: string }).id;
      const { data: g, error: e2 } = await supabase.from('leave_request_days').insert([{
        company_id: companyId, request_id: requestId, data,
        voce: tipo === 'ore' ? 'F02' : 'F01', tipo, ore: oreF, nota: 'Inserita dal piano del mese',
      }]).select('id').single();
      if (e2) throw e2;
      // Gia' approvata: la stessa approvazione di Approvazioni ferie, che scala il saldo.
      let approvata = false;
      if (giaApprovata) {
        const { error: e4 } = await supabase.rpc('leave_decidi', { p_request_id: requestId, p_giorni_approvati: [(g as { id: string }).id] });
        if (e4) { toast({ type: 'warning', message: `${testo} inserita ma non approvata (${e4.message}): la trovi in Approvazioni ferie.`, duration: 10000 }); }
        else approvata = true;
      }
      if (tipo === 'giornata') { const e3 = await togliTurno('Ferie inserite dal calendario'); if (e3) throw e3; }
      onSalvato(`${testo} per ${nome.split(' ')[0]}: ${approvata ? 'approvata, consuma il saldo delle ferie'
        : 'da approvare in Approvazioni ferie'}.${tipo !== 'giornata' && turno ? ' Accorcia il turno se serve.' : ''}`, { ferie: true });
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Ferie non inserite.' });
    } finally {
      setSalvo(false);
    }
  };

  const [collega, setCollega] = useState('');
  const mosseCollega = collega && passaggio ? mossePossibili(passaggio.haTurno(collega), false) : [];
  const ETICHETTE: Record<MossaTurno, string> = { sposta: 'Dai il turno', affianca: 'Metti anche a lei', scambia: 'Scambia i turni', sostituisci: 'Dai il turno al posto del suo' };
  const passa = async (m: MossaTurno) => {
    if (!passaggio || errore) return;
    setSalvo(true);
    const msg = await passaggio.esegui(m, collega, { inizio, fine, pausa_minuti: pausaVera });
    if (msg) await onSalvato(msg);
    setSalvo(false);
  };

  // Trasferta (Patrizio, 28/10/2026): lavoro fuori dal negozio, con l'orario
  // scritto sopra. Vale come lavoro, non come presenza qui; se la destinazione e'
  // un negozio si sceglie se copre anche quel negozio. Il turno del giorno si toglie.
  const [destinazione, setDestinazione] = useState('');
  const [luogo, setLuogo] = useState('');
  const [copre, setCopre] = useState(false);
  const [motivo, setMotivo] = useState('');
  const segnaTrasferta = async () => {
    if (errore) return;
    const altro = destinazione === 'altro';
    if (!destinazione || (altro && !luogo.trim())) { toast({ type: 'error', message: 'Scegli dove va: un negozio oppure scrivi il luogo.' }); return; }
    setSalvo(true);
    try {
      const { error } = await supabase.from('employee_trasferte').insert([{
        company_id: companyId, employee_id: employeeId, outlet_id: outletId, data, inizio, fine, pausa_minuti: pausaVera,
        destinazione_outlet_id: altro ? null : destinazione, luogo: altro ? luogo.trim() : null,
        copre_destinazione: !altro && copre, motivo: motivo.trim() || null,
      }]);
      if (error) throw error;
      if (turno) { const e2 = await togliTurno('Trasferta'); if (e2) throw e2; }
      onSalvato(`Trasferta di ${nome.split(' ')[0]} segnata: ${fmt(ore)} ore di lavoro fuori dal negozio${!altro && copre ? ', coprono il negozio di destinazione' : ''}.`);
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Trasferta non segnata.' });
    } finally {
      setSalvo(false);
    }
  };
  const togliTrasferta = async () => {
    if (!trasferta?.esistente) return;
    setSalvo(true);
    const { error } = await supabase.from('employee_trasferte').delete().eq('id', trasferta.esistente.id);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato('Trasferta tolta: il giorno torna disponibile per un turno.');
  };

  // Togliere ferie o permesso dal calendario (Patrizio, 28/10/2026): il giorno
  // passa a «respinto» con la stessa decisione di Approvazioni ferie, cosi' il
  // saldo torna a posto e lo storico resta. Gli altri giorni della richiesta non cambiano.
  const togliFerie = async () => {
    const f = ferie?.esistente;
    if (!f) return;
    setSalvo(true);
    try {
      const { data: giorni, error } = await supabase.from('leave_request_days').select('id, stato').eq('request_id', f.requestId);
      if (error) throw error;
      const altri = ((giorni as { id: string; stato: string }[]) ?? []).filter((g) => g.id !== f.id);
      if (altri.some((g) => g.stato === 'richiesto')) {
        toast({ type: 'warning', message: 'La richiesta ha altri giorni ancora da decidere: togli questo giorno da Approvazioni ferie, dove decidi anche gli altri.', duration: 10000 });
        return;
      }
      const { error: e2 } = await supabase.rpc('leave_decidi', {
        p_request_id: f.requestId, p_giorni_approvati: altri.filter((g) => g.stato === 'approvato').map((g) => g.id), p_motivazione: 'Tolte dal piano del mese',
      });
      if (e2) throw e2;
      onSalvato(`${f.testo} tolte per ${nome.split(' ')[0]}: il giorno torna disponibile per un turno e il saldo delle ferie si aggiorna.`, { ferie: true });
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Ferie non tolte.' });
    } finally {
      setSalvo(false);
    }
  };

  // Il conto della settimana (o del mese, dove la settimana non c'e'), in una riga.
  const cSett = contoDi(conto?.settimana);
  const cConto = cSett ?? contoDi(conto);
  const titoloConto = cSett && conto?.settimana ? `Settimana ${conto.settimana.etichetta}` : 'Mese';
  const scarto = cConto ? cConto.programmate - cConto.contratto : 0;
  const straordAltri = cConto ? cConto.straord - oreStraord : 0;

  // Le altre cose che si possono fare su questo giorno: chiuse, si aprono una alla volta (25/11/2026).
  const riposoNelPiano = !!riposo && !!planId && !ferie?.giaInFerie;
  const azioni: { id: Pannello; nome: string }[] = [
    ...((riposoNelPiano && !riposo!.attivo) || turno ? [{ id: 'riposo' as const, nome: riposoNelPiano && !riposo!.attivo ? 'Riposo' : 'Togli il turno' }] : []),
    ...(ferie && !ferie.giaInFerie ? [{ id: 'ferie' as const, nome: 'Ferie o permesso' }] : []),
    ...(turno && passaggio ? [{ id: 'collega' as const, nome: 'Dai a una collega' }] : []),
    ...(trasferta && !trasferta.esistente ? [{ id: 'trasferta' as const, nome: 'Trasferta' }] : []),
  ];
  const nomeBreve = nome.split(' ')[0];
  const pausaPagata = errore ? 0 : pausaPagataDelTurno({ inizio, fine, pausaMinuti: pausaVera }, regole);
  const SCELTE: { id: SceltaStraord; nome: string; spiega: string }[] = [
    ...(sistemaQui ? [{ id: 'sistema' as const, nome: 'Lo calcola il sistema', spiega: 'Le ore oltre il contratto della settimana diventano straordinario nei giorni forti, e si aggiornano quando cambi i turni.' }] : []),
    { id: 'nessuno', nome: 'Nessuno straordinario', spiega: sistemaQui ? 'Questo turno resta senza straordinario, anche quando il sistema ricalcola gli altri turni.' : 'Tutte le ore del turno sono di contratto.' },
    { id: 'mano', nome: 'Lo decido io', spiega: 'Scrivi tu quante ore del turno sono straordinario: il sistema non le cambia.' },
  ];

  return (
    <Modal open onClose={onClose} title={`${nome} · ${NOMI_GIORNO_BREVI[giornoSett]} ${formattaDataBreve(data)}`}>
      <div className="space-y-4">
        {/* Quello che c'e' gia' in questo giorno */}
        {(riposoNelPiano && riposo!.attivo) || ferie?.esistente || trasferta?.esistente ? (
          <div className="space-y-2">
            {riposoNelPiano && riposo!.attivo && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <span>Giorno di riposo di {nomeBreve}.</span>
                <button type="button" onClick={togliRiposo} disabled={salvo} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-emerald-400 bg-white text-sm font-semibold hover:bg-emerald-100 disabled:opacity-50"><Trash2 size={14} /> Togli il riposo</button>
              </div>
            )}
            {ferie?.esistente && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <span>{ferie.esistente.testo}{ferie.esistente.statoRichiesta === 'inviata' ? ', da approvare' : ', approvate'}.</span>
                <button type="button" onClick={togliFerie} disabled={salvo} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-amber-400 bg-white text-sm font-semibold hover:bg-amber-100 disabled:opacity-50"><Trash2 size={14} /> Togli le ferie</button>
              </div>
            )}
            {trasferta?.esistente && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
                <span>Trasferta {trasferta.esistente.inizio}-{trasferta.esistente.fine}, {fmt(oreTrasferta(trasferta.esistente))} ore,
                  {' '}a {trasferta.esistente.destinazioneOutletId ? (trasferta.negozi.find((n) => n.id === trasferta.esistente!.destinazioneOutletId)?.nome ?? 'altro negozio') : trasferta.esistente.luogo}
                  {trasferta.esistente.copreDestinazione ? ', copre quel negozio' : ''}{trasferta.esistente.motivo ? ` · ${trasferta.esistente.motivo}` : ''}.</span>
                <button type="button" onClick={togliTrasferta} disabled={salvo} className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-indigo-300 bg-white text-sm font-semibold hover:bg-indigo-100 disabled:opacity-50"><Trash2 size={14} /> Togli la trasferta</button>
              </div>
            )}
          </div>
        ) : null}

        {/* 1. Orario */}
        <div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-semibold text-slate-600">Inizio<input type="time" step={1800} value={inizio} onChange={(e) => scriviOrario(e.target.value, fine, false)} onBlur={() => scriviOrario(inizio, fine, true)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-600">Fine<input type="time" step={1800} value={fine} onChange={(e) => scriviOrario(inizio, e.target.value, false)} onBlur={() => scriviOrario(inizio, fine, true)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
          </div>
          <p className={`mt-2 text-sm ${errore ? 'text-rose-700' : 'text-slate-700'}`}>
            {errore ?? <><b>{fmt(ore)} ore di lavoro</b>{pausaVera > 0 ? `, pausa ${pausaVera} minuti non pagata` : ', nessuna pausa'}
              {pausaPagata > 0 ? ` (più ${pausaPagata} minuti timbrati ma pagati)` : ''}.{' '}
              {!mostraPausa && <button type="button" onClick={() => setMostraPausa(true)} className="text-blue-700 underline underline-offset-2 text-xs">cambia la pausa</button>}</>}
          </p>
          {!turno && !ferie?.giaInFerie && !trasferta?.esistente && !(riposoNelPiano && riposo!.attivo) && (
            <p className="text-xs text-slate-500 mt-1">Oggi {nomeBreve} non ha un turno: scrivi l’orario e salva per darglielo.</p>
          )}
          {mostraPausa && (
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">Pausa in minuti
              <input type="number" min={0} max={180} step={5} value={pausa} aria-label="Pausa in minuti" onChange={(e) => { pausaAMano.current = true; setPausa(Number(e.target.value) || 0); }} className="w-24 min-h-[36px] rounded-lg border border-slate-300 px-2 text-sm" />
              <span className="text-xs text-slate-500">si può allungare, non accorciare</span>
            </label>
          )}
          {mostraPausa && pausa < pausaMinima && !errore && (
            <p className="mt-1 text-xs text-amber-800">La regola vuole almeno {pausaMinima} minuti per questo orario: conto quelli.</p>
          )}
          {allungato && !errore && <p className="mt-2 text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">{allungato}</p>}
        </div>

        {/* 2. Straordinario, con il conto della settimana */}
        <fieldset className="rounded-lg border border-slate-200 px-3 py-2.5">
          <legend className="px-1 text-sm font-semibold text-slate-800">Straordinario su questo turno</legend>
          <div className="space-y-1.5">
            {SCELTE.map((x) => (
              <label key={x.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 cursor-pointer ${scelta === x.id ? 'bg-slate-50' : ''}`}>
                <input type="radio" name="scelta-straordinario" checked={scelta === x.id} onChange={() => scegli(x.id)} className="mt-1" />
                <span className="text-sm">
                  <span className="font-medium text-slate-800">{x.nome}{x.id === 'sistema' && scelta === 'sistema' ? `: oggi ${fmt(oreStraord)} h` : ''}</span>
                  {scelta === x.id && <span className="block text-xs text-slate-500">{x.spiega}</span>}
                </span>
              </label>
            ))}
          </div>
          {scelta === 'mano' && (
            <div className="mt-2 flex flex-wrap items-center gap-2 pl-8 text-sm text-slate-700">
              <input type="text" inputMode="decimal" aria-label="Ore di straordinario del turno"
                value={oreStraordScritte ?? String(oreStraord).replace('.', ',')}
                onChange={(e) => { setOreStraordScritte(e.target.value); setStraordToccato(true); }}
                className="w-20 min-h-[36px] rounded-lg border border-amber-300 px-2 text-right tabular-nums" />
              <span>ore su {fmt(oreTurno)}</span>
              {conMotivo && (
                <select aria-label="Motivo dello straordinario" value={motivoStraord} onChange={(e) => { setMotivoStraord(e.target.value); setStraordToccato(true); }}
                  className="min-h-[36px] rounded-lg border border-amber-300 px-2 bg-white">
                  {MOTIVI_STRAORDINARIO.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                </select>
              )}
            </div>
          )}
          {cConto && (
            <div className="mt-3 border-t border-slate-200 pt-2 text-sm">
              <p className="text-slate-700">
                <span className="font-semibold">{titoloConto}</span> di {nomeBreve}: <span className="tabular-nums">{fmt(cConto.programmate)} h</span> ordinarie su <span className="tabular-nums">{fmt(cConto.contratto)}</span> di contratto
                {cConto.straord > 0.01 ? <>, più <span className="tabular-nums">{fmt(cConto.straord)} h</span> di straordinario{straordAltri > 0.01 && oreStraord > 0.01 ? ` (${fmt(oreStraord)} qui, ${fmt(straordAltri)} su altri turni)` : straordAltri > 0.01 ? ' su altri turni' : ''}</> : ''}.
              </p>
              <p className={`text-xs mt-0.5 ${Math.abs(scarto) <= 0.25 ? 'text-emerald-700' : scarto < 0 ? 'text-slate-600' : 'text-amber-800'}`}>
                {Math.abs(scarto) <= 0.25 ? 'In linea con il contratto.'
                  : scarto < 0 ? `${fmt(-scarto)} h ancora da assegnare (un turno, ferie o permesso).`
                    : `${fmt(scarto)} h oltre il contratto non segnate come straordinario.`}
                {scelta === 'sistema' && ' Il sistema le ricalcola quando salvi.'}
              </p>
            </div>
          )}
        </fieldset>

        {/* 3. Le altre cose su questo giorno, chiuse */}
        {azioni.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Altro su questo giorno</p>
            <div className="flex flex-wrap gap-2">
              {azioni.map((a) => (
                <button key={a.id} type="button" onClick={() => setPannello(pannello === a.id ? null : a.id)} aria-expanded={pannello === a.id}
                  className={`min-h-[36px] px-3 rounded-lg border text-sm font-medium ${pannello === a.id ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{a.nome}</button>
              ))}
            </div>

            {pannello === 'riposo' && (
              <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 text-sm text-emerald-900">
                {riposoNelPiano && !riposo!.attivo ? (
                  <>
                    <p className="text-xs">{turno ? 'Il turno di questo giorno si toglie e le sue ore tornano da assegnare; nel piano resta segnato il riposo.' : 'In questo giorno non si mettono turni.'}</p>
                    <button type="button" onClick={segnaRiposo} disabled={salvo} className="mt-2 min-h-[36px] px-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">Segna come giorno di riposo</button>
                  </>
                ) : (
                  <>
                    <p className="text-xs">Il turno di questo giorno si toglie{turno?.stato === 'pubblicato' ? ' (è pubblicato: resta annullato nello storico)' : ''}.</p>
                    <button type="button" onClick={togli} disabled={salvo} className="mt-2 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"><Trash2 size={14} /> Togli il turno</button>
                  </>
                )}
              </div>
            )}

            {pannello === 'ferie' && ferie && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap gap-3 mb-2 text-xs text-amber-900" role="radiogroup" aria-label="Stato della richiesta">
                  <label className="inline-flex items-center gap-1.5"><input type="radio" checked={giaApprovata} onChange={() => setGiaApprovata(true)} /> Già approvata (scala subito il saldo)</label>
                  <label className="inline-flex items-center gap-1.5"><input type="radio" checked={!giaApprovata} onChange={() => setGiaApprovata(false)} /> Da approvare</label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => inserisciFerie('giornata')} disabled={salvo}
                    className="min-h-[36px] px-3 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">Giornata ({fmt(giornata)} h)</button>
                  <button type="button" onClick={() => inserisciFerie('mezza_giornata')} disabled={salvo}
                    className="min-h-[36px] px-3 rounded-lg border border-amber-400 bg-white text-amber-900 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50">Mezza giornata ({fmt(giornata / 2)} h)</button>
                  <span className="text-xs text-amber-900">oppure permesso di</span>
                  <input type="text" inputMode="decimal" aria-label="Ore di permesso" value={orePermesso} onChange={(e) => setOrePermesso(e.target.value)}
                    className="w-14 min-h-[36px] rounded-lg border border-amber-300 px-2 text-right tabular-nums bg-white" />
                  <span className="text-xs text-amber-900">h</span>
                  <button type="button" onClick={() => inserisciFerie('ore')} disabled={salvo}
                    className="min-h-[36px] px-3 rounded-lg border border-amber-400 bg-white text-amber-900 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50">Inserisci permesso</button>
                </div>
                <p className="text-xs text-amber-900 mt-2">Con la giornata il turno si toglie; con mezza giornata o permesso il turno resta, da accorciare.</p>
              </div>
            )}

            {pannello === 'collega' && passaggio && turno && (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm">
                <p className="text-xs text-blue-900 mb-2">Con l'orario scritto sopra. Nel calendario puoi anche trascinare la casella.</p>
                <select value={collega} onChange={(e) => setCollega(e.target.value)} aria-label="Collega"
                  className="w-full min-h-[38px] rounded-lg border border-blue-300 bg-white px-2 text-sm">
                  <option value="">Scegli la persona…</option>
                  {passaggio.colleghi.filter((c) => c.id !== employeeId).map((c) => <option key={c.id} value={c.id}>{c.nome}{passaggio.haTurno(c.id) ? ' (ha già un turno quel giorno)' : ''}</option>)}
                </select>
                {collega && (
                  <div className="mt-2 space-y-2">
                    {mosseCollega.map((m) => {
                      const avvisi = errore ? [] : passaggio.avvisi(m, collega, { inizio, fine });
                      return (
                        <div key={m}>
                          <button type="button" onClick={() => passa(m)} disabled={salvo || !!errore}
                            className="min-h-[36px] px-3 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">{ETICHETTE[m]}</button>
                          {avvisi.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-amber-800">{avvisi.map((a) => <li key={a}>• {a}</li>)}</ul>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {pannello === 'trasferta' && trasferta && (
              <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-sm">
                <p className="text-xs text-indigo-900 mb-2">Lavoro fuori da questo negozio con l'orario scritto sopra ({errore ? '—' : `${fmt(ore)} ore`}): conta nelle ore della settimana, non come presenza qui. Il turno del giorno si toglie.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="text-xs font-semibold text-indigo-900">Dove
                    <select value={destinazione} onChange={(e) => { setDestinazione(e.target.value); if (e.target.value === 'altro') setCopre(false); }}
                      className="mt-1 w-full min-h-[38px] rounded-lg border border-indigo-300 bg-white px-2 text-sm">
                      <option value="">Scegli…</option>
                      {trasferta.negozi.filter((n) => n.id !== outletId).map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                      <option value="altro">Altro luogo…</option>
                    </select>
                  </label>
                  {destinazione === 'altro' && (
                    <label className="text-xs font-semibold text-indigo-900">Luogo
                      <input type="text" value={luogo} onChange={(e) => setLuogo(e.target.value)} placeholder="es. fiera di Milano" className="mt-1 w-full min-h-[38px] rounded-lg border border-indigo-300 bg-white px-2 text-sm" />
                    </label>
                  )}
                  <label className={`text-xs font-semibold text-indigo-900 ${destinazione === 'altro' ? 'sm:col-span-2' : ''}`}>Motivo
                    <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="es. allestimento vetrine" className="mt-1 w-full min-h-[38px] rounded-lg border border-indigo-300 bg-white px-2 text-sm" />
                  </label>
                </div>
                {destinazione && destinazione !== 'altro' && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-indigo-900">
                    <input type="checkbox" checked={copre} onChange={(e) => setCopre(e.target.checked)} className="mt-0.5" />
                    Le ore coprono anche quel negozio: nel suo piano conta come una persona presente.
                  </label>
                )}
                <button type="button" onClick={segnaTrasferta} disabled={salvo || !!errore}
                  className="mt-2 min-h-[36px] px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">Segna come trasferta</button>
              </div>
            )}
          </div>
        )}

        {/* Salva e Annulla sempre visibili, anche quando la finestra scorre */}
        <div className="sticky bottom-0 -mx-5 -mb-4 px-5 py-3 bg-white border-t border-slate-200 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">L'orario salvato non lo cambia il ricalcolo dei turni.</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm">Annulla</button>
            <button type="button" onClick={salva} disabled={!!errore || salvo} className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">Salva</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
