// Finestra per mettere, spostare o togliere un turno a mano. La usano il piano
// settimanale e il piano del mese (Patrizio, 20/10/2026: dal riepilogo «Ore del
// mese» la responsabile HR entra nella casella e sistema le ore; se con la
// dipendente si concordano ore in piu', il turno si segna come straordinario).

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import { formattaDataBreve } from '../lib/organico';
import { NOMI_GIORNO_BREVI, minuti, oreLavorate, pausaMinimaPerPresenza, pausaPer, type RegoleTurni } from '../lib/turni';
import { oreGiornata } from '../lib/pianoMensile';
import { oreTrasferta, type Trasferta } from '../lib/trasferte';
import { mossePossibili, type MossaTurno } from '../lib/spostaTurni';

export type TurnoModificabile = {
  id: string; inizio: string; fine: string; pausa_minuti: number;
  origine: string; stato: string; straordinario?: boolean; ore_straordinario?: number;
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

const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 1 });

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
  companyId, outletId, employeeId, data, turno, planId, nome, apre, chiude, regole, conto, ferie, trasferta, passaggio, onClose, onSalvato,
}: {
  companyId: string; outletId: string; employeeId: string; data: string; turno: TurnoModificabile | null; planId: string | null;
  nome: string; apre: number; chiude: number; regole: RegoleTurni; conto?: ContoMese; ferie?: FerieDalCalendario; trasferta?: TrasfertaDalCalendario; passaggio?: PassaggioTurno;
  onClose: () => void; onSalvato: (messaggio?: string) => void;
}) {
  const { toast } = useToast();
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const [inizio, setInizio] = useState(turno?.inizio ?? hh(apre));
  const [fine, setFine] = useState(turno?.fine ?? hh(Math.min(chiude, apre + regole.turnoMaxOre * 60 + pausaPer(regole.turnoMaxOre * 60, regole))));
  const [pausa, setPausa] = useState(turno?.pausa_minuti ?? 0);
  // Straordinario a ore: allungando un turno di un'ora, straordinario e' solo
  // quell'ora (Patrizio, 21/10/2026). Si propone la differenza rispetto alle ore
  // ordinarie che il turno aveva; si puo' correggere a mano.
  const oreStraordPrima = Number(turno?.ore_straordinario ?? 0);
  const ordinariePrima = turno ? oreLavorate({ inizio: turno.inizio, fine: turno.fine, pausaMinuti: turno.pausa_minuti }) - oreStraordPrima : 0;
  const [straordinario, setStraordinario] = useState(oreStraordPrima > 0);
  const [oreStraordScritte, setOreStraordScritte] = useState<string | null>(oreStraordPrima > 0 ? String(oreStraordPrima) : null);
  const [salvo, setSalvo] = useState(false);

  // La pausa non e' mai lavoro (Patrizio, 21/10/2026): 30' da 6 ore lavorate, un'ora
  // da 8. Si impone la minima per la presenza scritta; la si puo' allungare, non accorciare.
  const pausaMinima = fine > inizio ? pausaMinimaPerPresenza(minuti(fine) - minuti(inizio), regole) : 0;
  const pausaVera = Math.max(pausa, pausaMinima);
  const ore = oreLavorate({ inizio, fine, pausaMinuti: pausaVera });
  const errore = fine <= inizio ? 'La fine viene prima dell’inizio.' : ore <= 0 ? 'Turno vuoto.' : null;
  const giornoSett = new Date(`${data}T00:00:00Z`).getUTCDay() || 7;

  // Come cambia il mese della persona con questo turno.
  const oreTurno = errore ? 0 : ore;
  const proposte = Math.max(0, oreTurno - (turno ? ordinariePrima : 0)) || oreTurno;
  const lette = oreStraordScritte != null ? Number(oreStraordScritte.replace(',', '.')) : NaN;
  const oreStraord = !straordinario ? 0 : Math.min(oreTurno, Math.max(0, Number.isFinite(lette) ? lette : proposte));
  // Ore da contratto contro ore programmate, per la settimana e per il mese.
  const contoDi = (c: { daLavorare: number | null; ordinarieAltri: number; straordinarioAltri: number } | undefined) => c && c.daLavorare != null ? {
    contratto: c.daLavorare,
    programmate: c.ordinarieAltri + (oreTurno - oreStraord),
    straord: c.straordinarioAltri + oreStraord,
  } : null;

  const salva = async () => {
    if (errore) return;
    setSalvo(true);
    const riga = { inizio, fine, pausa_minuti: pausaVera, origine: 'manuale' as const, straordinario: oreStraord > 0, ore_straordinario: oreStraord };
    const { error } = turno
      ? await supabase.from('shifts').update(riga).eq('id', turno.id)
      : await supabase.from('shifts').insert([{ ...riga, company_id: companyId, outlet_id: outletId, employee_id: employeeId, data, stato: 'bozza', plan_id: planId }]);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato();
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
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato();
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
      if (tipo === 'giornata') { const e3 = await togliTurno('Ferie inserite dal calendario'); if (e3) throw e3; }
      // Gia' approvata: la stessa approvazione di Approvazioni ferie, che scala il saldo.
      let approvata = false;
      if (giaApprovata) {
        const { error: e4 } = await supabase.rpc('leave_decidi', { p_request_id: requestId, p_giorni_approvati: [(g as { id: string }).id] });
        if (e4) { toast({ type: 'warning', message: `${testo} inserita ma non approvata (${e4.message}): la trovi in Approvazioni ferie.`, duration: 10000 }); }
        else approvata = true;
      }
      onSalvato(`${testo} per ${nome.split(' ')[0]}: ${approvata ? 'approvata, consuma il saldo delle ferie' : 'da approvare in Approvazioni ferie'}.${tipo !== 'giornata' && turno ? ' Accorcia il turno se serve.' : ''}`);
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
    setSalvo(false);
    if (msg) onSalvato(msg);
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
      onSalvato(`${f.testo} tolte per ${nome.split(' ')[0]}: il giorno torna disponibile per un turno e il saldo delle ferie si aggiorna.`);
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Ferie non tolte.' });
    } finally {
      setSalvo(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${nome} · ${NOMI_GIORNO_BREVI[giornoSett]} ${formattaDataBreve(data)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-slate-600">Inizio<input type="time" step={1800} value={inizio} onChange={(e) => setInizio(e.target.value)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Fine<input type="time" step={1800} value={fine} onChange={(e) => setFine(e.target.value)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Pausa (min)<input type="number" min={0} max={180} step={15} value={pausa} onChange={(e) => setPausa(Number(e.target.value) || 0)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
        </div>
        <p className="text-sm text-slate-600">
          {errore ?? <>Presenza {fmt((minuti(fine) - minuti(inizio)) / 60)} ore: <b>{fmt(ore)} ore di lavoro</b> e {pausaVera} minuti di pausa, che non si pagano.</>}
          {' '}Il turno diventa «messo a mano»: il ricalcolo non lo cambia.
        </p>
        {pausa < pausaMinima && !errore && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            La regola vuole almeno {pausaMinima} minuti di pausa (30 da 6 ore di lavoro, un'ora da 8): li conto io, la pausa scritta non basta.
          </p>
        )}

        <label className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer ${straordinario ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
          <input type="checkbox" checked={straordinario} onChange={(e) => { setStraordinario(e.target.checked); setOreStraordScritte(null); }} className="mt-0.5" />
          <span className="text-sm flex-1">
            <span className="font-semibold text-slate-800">Straordinario</span>
            <span className="block text-xs text-slate-500">Ore concordate con la dipendente in più del contratto: si contano a parte e non coprono le ore di contratto non usate. Allungando un turno, straordinario sono solo le ore aggiunte.</span>
          </span>
        </label>
        {straordinario && (
          <label className="flex items-center gap-2 text-sm text-slate-700 -mt-2 pl-3">
            Di queste, ore di straordinario:
            <input type="text" inputMode="decimal" aria-label="Ore di straordinario del turno"
              value={oreStraordScritte ?? String(oreStraord).replace('.', ',')}
              onChange={(e) => setOreStraordScritte(e.target.value)}
              className="w-20 min-h-[36px] rounded-lg border border-amber-300 px-2 text-right tabular-nums" />
            <span className="text-xs text-slate-500">su {fmt(oreTurno)} h del turno; il resto è ordinario</span>
          </label>
        )}

        {conto && (contoDi(conto.settimana) || contoDi(conto)) && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-sm space-y-2">
            {([[conto.settimana ? `La settimana ${conto.settimana.etichetta}` : null, contoDi(conto.settimana)], ['Il mese', contoDi(conto)]] as [string | null, ReturnType<typeof contoDi>][])
              .filter(([titolo, c]) => titolo && c).map(([titolo, c]) => {
                const scarto = c!.programmate - c!.contratto;
                return (
                  <div key={titolo}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{titolo} di {nome.split(' ')[0]} con questo turno</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div><span className="block text-xs text-slate-500">Ore da contratto</span><span className="font-semibold tabular-nums">{fmt(c!.contratto)} h</span></div>
                      <div><span className="block text-xs text-slate-500">Ore programmate</span><span className="font-semibold tabular-nums">{fmt(c!.programmate)} h</span></div>
                    </div>
                    <p className={`mt-1 text-sm font-medium ${Math.abs(scarto) <= 0.25 ? 'text-emerald-700' : scarto < 0 ? 'text-slate-700' : 'text-amber-800'}`}>
                      {Math.abs(scarto) <= 0.25 ? 'In linea con il contratto.'
                        : scarto < 0 ? `${fmt(-scarto)} h ancora da assegnare: in un turno dove servono, oppure come ferie o permesso.`
                          : `${fmt(scarto)} h in più del contratto: decidi se sono straordinario (segna il turno come straordinario) oppure se le togli.`}
                    </p>
                    {c!.straord > 0.25 && <p className="text-xs text-amber-800">Straordinario concordato: {fmt(c!.straord)} h, a parte.</p>}
                  </div>
                );
              })}
          </div>
        )}

        {turno && passaggio && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2.5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-900 mb-1">Dai questo turno a un'altra persona, o mettilo anche a lei</p>
            <p className="text-xs text-blue-900 mb-2">Con l'orario scritto in alto (lo puoi cambiare prima). Nel calendario puoi anche trascinare la casella.</p>
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

        {ferie?.esistente && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-sm text-amber-900">
            <p className="text-xs font-semibold uppercase tracking-wide mb-1">In questo giorno</p>
            <p>{ferie.esistente.testo}{ferie.esistente.statoRichiesta === 'inviata' ? ', da approvare' : ', approvate'}.</p>
            <button type="button" onClick={togliFerie} disabled={salvo}
              className="mt-2 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-amber-400 bg-white text-sm font-semibold hover:bg-amber-100 disabled:opacity-50"><Trash2 size={14} /> Togli le ferie</button>
          </div>
        )}

        {ferie && !ferie.giaInFerie && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900 mb-1">Ferie o permesso in questo giorno</p>
            <div className="flex flex-wrap gap-3 mb-2 text-xs text-amber-900" role="radiogroup" aria-label="Stato della richiesta">
              <label className="inline-flex items-center gap-1.5"><input type="radio" checked={giaApprovata} onChange={() => setGiaApprovata(true)} /> Già approvata: consuma subito il saldo</label>
              <label className="inline-flex items-center gap-1.5"><input type="radio" checked={!giaApprovata} onChange={() => setGiaApprovata(false)} /> Da approvare</label>
            </div>
            <p className="text-xs text-amber-900 mb-2">La mezza giornata vale metà delle ore di una giornata. Con la giornata intera il turno del giorno si toglie; con mezza giornata o permesso il turno resta, da accorciare.</p>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => inserisciFerie('giornata')} disabled={salvo}
                className="min-h-[36px] px-3 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50">Giornata di ferie ({fmt(giornata)} h)</button>
              <button type="button" onClick={() => inserisciFerie('mezza_giornata')} disabled={salvo}
                className="min-h-[36px] px-3 rounded-lg border border-amber-400 bg-white text-amber-900 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50">Mezza giornata ({fmt(giornata / 2)} h)</button>
              <span className="text-xs text-amber-900">oppure permesso di</span>
              <input type="text" inputMode="decimal" aria-label="Ore di permesso" value={orePermesso} onChange={(e) => setOrePermesso(e.target.value)}
                className="w-16 min-h-[36px] rounded-lg border border-amber-300 px-2 text-right tabular-nums bg-white" />
              <span className="text-xs text-amber-900">h</span>
              <button type="button" onClick={() => inserisciFerie('ore')} disabled={salvo}
                className="min-h-[36px] px-3 rounded-lg border border-amber-400 bg-white text-amber-900 text-sm font-semibold hover:bg-amber-100 disabled:opacity-50">Inserisci permesso</button>
            </div>
          </div>
        )}

        {trasferta?.esistente && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-sm text-indigo-900">
            <p className="text-xs font-semibold uppercase tracking-wide mb-1">Trasferta in questo giorno</p>
            <p>{trasferta.esistente.inizio}-{trasferta.esistente.fine}, {fmt(oreTrasferta(trasferta.esistente))} ore di lavoro
              {' '}a {trasferta.esistente.destinazioneOutletId ? (trasferta.negozi.find((n) => n.id === trasferta.esistente!.destinazioneOutletId)?.nome ?? 'altro negozio') : trasferta.esistente.luogo}
              {trasferta.esistente.copreDestinazione ? ', copre quel negozio' : ''}{trasferta.esistente.motivo ? ` · ${trasferta.esistente.motivo}` : ''}.</p>
            <button type="button" onClick={togliTrasferta} disabled={salvo} className="mt-2 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg border border-indigo-300 bg-white text-sm font-semibold hover:bg-indigo-100 disabled:opacity-50"><Trash2 size={14} /> Togli la trasferta</button>
          </div>
        )}
        {trasferta && !trasferta.esistente && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2.5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900 mb-1">Oppure: trasferta in questo giorno</p>
            <p className="text-xs text-indigo-900 mb-2">Lavoro fuori da questo negozio con l'orario scritto sopra ({errore ? '—' : `${fmt(ore)} ore`}): vale come lavoro nelle ore della settimana, non come presenza qui. Il turno del giorno si toglie.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs font-semibold text-indigo-900">Dove
                <select value={destinazione} onChange={(e) => { setDestinazione(e.target.value); if (e.target.value === 'altro') setCopre(false); }}
                  className="mt-1 w-full min-h-[38px] rounded-lg border border-indigo-300 bg-white px-2 text-sm">
                  <option value="">Scegli…</option>
                  {trasferta.negozi.filter((n) => n.id !== outletId).map((n) => <option key={n.id} value={n.id}>{n.nome}</option>)}
                  <option value="altro">Altro luogo…</option>
                </select>
              </label>
              {destinazione === 'altro' ? (
                <label className="text-xs font-semibold text-indigo-900">Luogo
                  <input type="text" value={luogo} onChange={(e) => setLuogo(e.target.value)} placeholder="es. fiera di Milano" className="mt-1 w-full min-h-[38px] rounded-lg border border-indigo-300 bg-white px-2 text-sm" />
                </label>
              ) : (
                <label className="text-xs font-semibold text-indigo-900">Motivo
                  <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="es. allestimento vetrine" className="mt-1 w-full min-h-[38px] rounded-lg border border-indigo-300 bg-white px-2 text-sm" />
                </label>
              )}
              {destinazione === 'altro' && (
                <label className="text-xs font-semibold text-indigo-900 sm:col-span-2">Motivo
                  <input type="text" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1 w-full min-h-[38px] rounded-lg border border-indigo-300 bg-white px-2 text-sm" />
                </label>
              )}
            </div>
            {destinazione && destinazione !== 'altro' && (
              <label className="mt-2 flex items-start gap-2 text-xs text-indigo-900">
                <input type="checkbox" checked={copre} onChange={(e) => setCopre(e.target.checked)} className="mt-0.5" />
                Le ore coprono anche quel negozio: nel suo piano contano come una persona presente.
              </label>
            )}
            <button type="button" onClick={segnaTrasferta} disabled={salvo || !!errore}
              className="mt-2 min-h-[36px] px-3 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">Segna come trasferta</button>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-200">
          {turno ? (
            <button type="button" onClick={togli} disabled={salvo} className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={15} /> Togli il turno</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm">Annulla</button>
            <button type="button" onClick={salva} disabled={!!errore || salvo} className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">Salva</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
