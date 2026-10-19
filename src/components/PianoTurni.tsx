// «Piano settimanale»: i turni di un negozio, persone per giorni.
//
// Chi c'e' viene dall'organico di oggi (anagrafica + cambiamenti), meno le
// ferie approvate a giornata intera. «Proponi i turni» rifa' solo le
// proposte in bozza: i turni messi a mano e quelli gia' pubblicati restano.
// Ogni modifica fatta su un turno lo rende «manuale», e il ricalcolo non lo
// tocca piu'. Sotto ogni giorno: se la copertura basta o cosa manca.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Info, RefreshCw, Send, Trash2 } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import {
  personaAllaData, nomePersona, formattaDataBreve, oggiRoma, aggiungiGiorni, contaNellOrganico,
  type PersonaOggi,
} from '../lib/organico';
import { caricaGiorniFerie, type DatiOrganico } from '../lib/organicoDati';
import {
  NOMI_GIORNO_BREVI, REGOLE_DEFAULT, costruisciGiorni, regoleDaRiga, pausaPer, giorniDellaSettimana, lunediDi, oreLavorate,
  proponiSettimana, scopertureDelGiorno, type GiornoPiano, type RegoleTurni, type Turno,
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
  id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number;
  origine: 'proposta' | 'manuale'; stato: 'bozza' | 'pubblicato' | 'annullato'; annullato_motivo: string | null;
};

const t5 = (t: string) => t.slice(0, 5);
const STATI_FERIE_APPROVATE = ['approvata', 'approvata_parziale', 'chiusa'];

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
  const [caricamento, setCaricamento] = useState(true);
  const [lavoro, setLavoro] = useState(false);
  const [editor, setEditor] = useState<{ employeeId: string; data: string; turno: TurnoDb | null } | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const [o, f, s, r, t, fe] = await Promise.all([
        supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude, origine').eq('outlet_id', outletId),
        supabase.from('outlet_staffing_needs').select('giorno, dalle, alle, persone, origine').eq('outlet_id', outletId),
        supabase.from('outlet_special_days').select('data, chiuso, apre, chiude, persone_extra, nota').eq('outlet_id', outletId).gte('data', date[0]).lte('data', date[6]),
        supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
        supabase.from('shifts').select('id, employee_id, data, inizio, fine, pausa_minuti, origine, stato, annullato_motivo')
          .eq('company_id', companyId).eq('outlet_id', outletId).gte('data', date[0]).lte('data', date[6]).order('inizio'),
        caricaGiorniFerie(companyId, date[0], date[6]),
      ]);
      const orari = (o.data as { giorno: number; chiuso: boolean; apre: string | null; chiude: string | null }[]) ?? [];
      const fasce = (f.data as { giorno: number; dalle: string; alle: string; persone: number }[]) ?? [];
      setHaOrari(orari.length > 0);
      setStimati([...orari, ...fasce].some((x) => (x as { origine?: string }).origine === 'stima'));
      setHaFabbisogno(fasce.some((x) => x.persone > 0));
      setGiorni(costruisciGiorni(date, orari, fasce, (s.data as { data: string; chiuso: boolean; apre: string | null; chiude: string | null; persone_extra: number; nota: string | null }[]) ?? []));
      setRegole(regoleDaRiga(r.data as Parameters<typeof regoleDaRiga>[0]));
      setTurni(((t.data as TurnoDb[]) ?? []).map((x) => ({ ...x, inizio: t5(x.inizio), fine: t5(x.fine) })));
      setFerie(fe);
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
    && STATI_FERIE_APPROVATE.includes(f.stato_richiesta) && f.stato_giorno === 'approvato'), [ferie]);

  const motivoNonDisponibile = useCallback((pg: PersonaOggi, empId: string, data: string): string | null => {
    if (pg.stato === 'assente') return pg.assenza?.motivo ?? 'assente';
    if (pg.stato === 'cessato') return 'non più in forza';
    if (pg.stato === 'non_ancora_assunto') return 'non ancora assunta';
    if (pg.stato === 'scaduto') return 'contratto scaduto';
    if (pg.outletId !== outletId) return 'in un altro negozio';
    const fe = inFerie(empId, data);
    if (fe && fe.tipo === 'giornata') return 'ferie';
    return null;
  }, [outletId, inFerie]);

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
          ore: p.ore as number,
          nonDisponibile: new Set(date.filter((d, i) => motivoNonDisponibile(p.perGiorno[i], p.scheda.id, d) != null)),
        }));
      const esito = proponiSettimana({ giorni, persone: candidati, regole, fissi });
      if (esito.turni.length) {
        const { error } = await supabase.from('shifts').insert(esito.turni.map((t) => ({
          company_id: companyId, outlet_id: outletId, employee_id: t.employeeId, data: t.data,
          inizio: t.inizio, fine: t.fine, pausa_minuti: t.pausaMinuti, origine: 'proposta', stato: 'bozza',
        })));
        if (error) throw error;
      }
      toast({
        type: esito.scoperture.length ? 'warning' : 'success',
        message: esito.scoperture.length
          ? `Proposta fatta: ${esito.turni.length} turni. Restano ${esito.scoperture.length} fasce scoperte, le vedi sotto ogni giorno.`
          : `Proposta fatta: ${esito.turni.length} turni, tutto coperto.`,
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
    const { error } = await supabase.from('shifts').update({ stato: 'pubblicato' })
      .eq('company_id', companyId).eq('outlet_id', outletId).eq('stato', 'bozza').gte('data', date[0]).lte('data', date[6]);
    setLavoro(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: `Turni della settimana pubblicati per ${nomeNegozio}.` });
    carica();
  };

  if (caricamento && !giorni.length) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const bozze = attivi.filter((t) => t.stato === 'bozza').length;
  const pubblicati = attivi.filter((t) => t.stato === 'pubblicato').length;
  const annullatiPubblicati = turni.filter((t) => t.stato === 'annullato').length;
  const scoperture = giorni.flatMap((g) => scopertureDelGiorno(g, turniPerCalcolo));
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
          <Info size={15} className="shrink-0 mt-0.5" /> Il fabbisogno di {nomeNegozio} non è ancora indicato (lo decide Patrizio): la proposta distribuisce le ore di contratto, ma non può dire se bastano.
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
                    return (
                      <td key={g.data} className="px-1.5 py-1.5 align-top">
                        <button type="button" disabled={!puoScrivere || g.chiuso}
                          onClick={() => setEditor({ employeeId: p.scheda.id, data: g.data, turno: vivo })}
                          className={`w-full min-h-[40px] rounded-md px-1.5 py-1 text-xs text-center font-mono ${vivo
                            ? vivo.stato === 'pubblicato' ? 'bg-blue-100 text-blue-900' : vivo.origine === 'manuale' ? 'bg-violet-100 text-violet-900' : 'bg-blue-50 text-blue-800 border border-dashed border-blue-300'
                            : nd ? 'bg-slate-100 text-slate-500 font-sans' : g.chiuso ? 'text-slate-300' : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50 font-sans'}`}>
                          {vivo ? `${vivo.inizio}-${vivo.fine}` : nd ? nd : g.chiuso ? '' : 'riposo'}
                          {vivo && fe && <span className="block font-sans text-emerald-700">permesso {fe.ore} h</span>}
                        </button>
                        {annullato && !vivo && <span className="block text-[11px] text-slate-400 line-through text-center">{annullato.inizio}-{annullato.fine}</span>}
                      </td>
                    );
                  })}
                  <td className={`px-3 py-2 text-right tabular-nums ${p.ore != null && Math.abs(pianificate - p.ore) > 0.01 ? 'text-amber-800 font-semibold' : 'text-emerald-800'}`}>
                    {pianificate.toLocaleString('it-IT')}{p.ore != null ? `/${p.ore}` : ''}
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

      {editor && (
        <EditorTurno
          companyId={companyId} outletId={outletId} editor={editor}
          nome={nomePersona(dati.schede.find((s) => s.id === editor.employeeId) ?? { nome: '', cognome: '' })}
          giorno={giorni.find((g) => g.data === editor.data)!}
          regole={regole}
          onClose={() => setEditor(null)}
          onSalvato={() => { setEditor(null); carica(); }}
        />
      )}
    </div>
  );
}

function EditorTurno({ companyId, outletId, editor, nome, giorno, regole, onClose, onSalvato }: {
  companyId: string; outletId: string; editor: { employeeId: string; data: string; turno: TurnoDb | null };
  nome: string; giorno: GiornoPiano; regole: RegoleTurni; onClose: () => void; onSalvato: () => void;
}) {
  const { toast } = useToast();
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const [inizio, setInizio] = useState(editor.turno?.inizio ?? hh(giorno.apre));
  const [fine, setFine] = useState(editor.turno?.fine ?? hh(Math.min(giorno.chiude, giorno.apre + regole.turnoMinOre * 60)));
  const [pausa, setPausa] = useState(editor.turno?.pausa_minuti ?? 0);
  const [salvo, setSalvo] = useState(false);

  const ore = oreLavorate({ inizio, fine, pausaMinuti: pausa });
  const errore = fine <= inizio ? 'La fine viene prima dell’inizio.' : ore <= 0 ? 'Turno vuoto.' : null;
  // Pausa prevista dalle regole (30' da 6 ore lavorate, un'ora da 8): si
  // suggerisce, non si impone, perche' il turno messo a mano e' una scelta.
  const pausaDovuta = errore ? 0 : pausaPer(ore * 60, regole);

  const salva = async () => {
    if (errore) return;
    setSalvo(true);
    const riga = { inizio, fine, pausa_minuti: pausa, origine: 'manuale' as const };
    const { error } = editor.turno
      ? await supabase.from('shifts').update(riga).eq('id', editor.turno.id)
      : await supabase.from('shifts').insert([{ ...riga, company_id: companyId, outlet_id: outletId, employee_id: editor.employeeId, data: editor.data, stato: 'bozza' }]);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato();
  };

  const togli = async () => {
    if (!editor.turno) return;
    setSalvo(true);
    const t = editor.turno;
    const { error } = t.origine === 'proposta' && t.stato === 'bozza'
      ? await supabase.from('shifts').delete().eq('id', t.id)
      : await supabase.from('shifts').update({ stato: 'annullato', annullato_motivo: 'Tolto a mano' }).eq('id', t.id);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    onSalvato();
  };

  return (
    <Modal open onClose={onClose} title={`${nome} · ${NOMI_GIORNO_BREVI[giorno.giorno]} ${formattaDataBreve(editor.data)}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs font-semibold text-slate-600">Inizio<input type="time" step={1800} value={inizio} onChange={(e) => setInizio(e.target.value)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Fine<input type="time" step={1800} value={fine} onChange={(e) => setFine(e.target.value)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Pausa (min)<input type="number" min={0} max={180} step={15} value={pausa} onChange={(e) => setPausa(Number(e.target.value) || 0)} className="mt-1 w-full min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm" /></label>
        </div>
        <p className="text-sm text-slate-600">{errore ?? `${ore.toLocaleString('it-IT')} ore di lavoro.`} Il turno diventa «messo a mano»: il ricalcolo non lo cambia.</p>
        {pausa < pausaDovuta && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Con {ore.toLocaleString('it-IT')} ore di lavoro la regola prevede {pausaDovuta} minuti di pausa.{' '}
            <button type="button" onClick={() => setPausa(pausaDovuta)} className="font-semibold underline">Metti {pausaDovuta} minuti</button>
          </p>
        )}
        <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-200">
          {editor.turno ? (
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
