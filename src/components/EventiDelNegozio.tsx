// «Eventi e giorni speciali» di UN negozio (Patrizio, 12/11/2026).
//  - Giorno speciale singolo: vale come un sabato.
//  - Periodo speciale, dal giorno X al giorno Y: regole proprie del negozio.
// La finestra «Nuovo» va in quattro passi: cosa e quando, controllo sugli
// ingressi MODA dell'anno prima, da dove si prendono le regole, conferma.
// Dove il database non ha ancora le colonne nuove (migration 405) l'elenco si
// vede lo stesso e per creare si usa la pagina Eventi di prima.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CalendarRange, Lock, Plus, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { Modal } from './ui/Modal';
import FasceEditor, { type FasciaSemplice } from './FasceEditor';
import { formattaDataBreve, oggiRoma } from '../lib/organico';
import { REGOLE_DEFAULT, RIPOSO_LEGALE, eventiDelNegozio, regoleDaRiga, type EventoNegozio, type FasciaFabbisogno, type RegoleEvento, type RegoleTurni } from '../lib/turni';
import { controlloModaPeriodo, eventiInConflitto, eventoDaRiga, fasceDelGiorno, regoleDiPartenza, type ControlloModa, type OrigineRegole } from '../lib/eventiTurni';
import { caricaEventi, caricaIngressiGiornalieri } from '../lib/regoleNuoveDb';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  negozi: { id: string; nome: string }[];
  puoScrivere: boolean;
  puoFabbisogno: boolean;
  onSalvato?: () => void;
  /** apre la pagina Eventi di prima (eventi per piu' negozi insieme) */
  onVaiEventi?: () => void;
};

type Bozza = {
  id?: string; tipo: 'giorno' | 'periodo'; nome: string; dal: string; al: string;
  origine: OrigineRegole; daEvento: string; regole: RegoleEvento;
};

const db = supabase as unknown as SupabaseClient;
const inputCls = 'min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm disabled:bg-slate-50 disabled:text-slate-500';
const date = (e: Pick<EventoNegozio, 'data_dal' | 'data_al'>) => (e.data_dal === e.data_al ? formattaDataBreve(e.data_dal) : `${formattaDataBreve(e.data_dal)} – ${formattaDataBreve(e.data_al)}`);

function Interruttore({ acceso, onCambia, etichetta, disabled }: { acceso: boolean; onCambia: (v: boolean) => void; etichetta: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={acceso} aria-label={etichetta} disabled={disabled} onClick={() => onCambia(!acceso)}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${acceso ? 'bg-pink-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${acceso ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

/** Il verdetto del controllo MODA, in parole. */
export function verdettoModa(c: ControlloModa | null): { testo: string; colore: 'verde' | 'grigio' | 'ambra' } {
  if (!c || c.esito === 'senza_dati') return { testo: 'Nessun ingresso dell’anno prima da confrontare', colore: 'grigio' };
  const pct = `${c.scostamentoPct! > 0 ? '+' : ''}${c.scostamentoPct!.toLocaleString('it-IT')}%`;
  if (c.esito === 'sopra') return { testo: `${pct} sulle settimane vicine: periodo forte`, colore: 'verde' };
  if (c.esito === 'sotto') return { testo: `${pct} sulle settimane vicine: più debole`, colore: 'ambra' };
  return { testo: `${pct}: nella media delle settimane vicine`, colore: 'grigio' };
}
const COLORE = { verde: 'bg-emerald-100 text-emerald-800', grigio: 'bg-slate-200 text-slate-700', ambra: 'bg-amber-100 text-amber-900' };

export default function EventiDelNegozio({ companyId, outletId, nomeNegozio, negozi, puoScrivere, puoFabbisogno, onSalvato, onVaiEventi }: Props) {
  const { toast } = useToast();
  const [tutti, setTutti] = useState<(EventoNegozio & { controllo?: ControlloModa | null })[]>([]);
  const [conRegole, setConRegole] = useState(false);
  const [caricamento, setCaricamento] = useState(true);
  const [regoleNegozio, setRegoleNegozio] = useState<RegoleTurni>(REGOLE_DEFAULT);
  const [fasceNegozio, setFasceNegozio] = useState<FasciaFabbisogno[]>([]);
  const [orarioSabato, setOrarioSabato] = useState<{ apre: string; chiude: string }>({ apre: '10:00', chiude: '20:00' });
  const [bozza, setBozza] = useState<Bozza | null>(null);
  const [passo, setPasso] = useState(1);
  const [controllo, setControllo] = useState<ControlloModa | null>(null);
  const [fonte, setFonte] = useState<'propria' | 'riferimento' | 'nessuna' | null>(null);
  const [leggo, setLeggo] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const ingressi = useRef<Map<string, number> | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    try {
      const [ev, r, f, o] = await Promise.all([
        caricaEventi(companyId, '2000-01-01', '2100-12-31'),
        supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle(),
        supabase.from('outlet_staffing_needs').select('giorno, dalle, alle, persone, origine').eq('outlet_id', outletId),
        supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude').eq('outlet_id', outletId).eq('giorno', 6).maybeSingle(),
      ]);
      setConRegole(ev.conRegole);
      setTutti(ev.righe.map((x) => eventoDaRiga(x)).sort((a, b) => a.data_dal.localeCompare(b.data_dal)));
      setRegoleNegozio(regoleDaRiga(r.data as Parameters<typeof regoleDaRiga>[0]));
      setFasceNegozio(((f.data as FasciaFabbisogno[]) ?? []).map((x) => ({ ...x, dalle: x.dalle.slice(0, 5), alle: x.alle.slice(0, 5) })));
      const sab = o.data as { apre: string | null; chiude: string | null } | null;
      if (sab?.apre && sab?.chiude) setOrarioSabato({ apre: sab.apre.slice(0, 5), chiude: sab.chiude.slice(0, 5) });
    } catch (e) {
      toast({ type: 'error', message: `Eventi non caricati: ${e instanceof Error ? e.message : 'errore'}` });
    } finally {
      setCaricamento(false);
    }
  }, [companyId, outletId, toast]);
  useEffect(() => { ingressi.current = null; carica(); }, [carica]);

  const oggi = oggiRoma();
  const delNegozio = useMemo(() => eventiDelNegozio(tutti, outletId).filter((e) => e.data_al >= oggi), [tutti, outletId, oggi]);
  const daCopiare = useMemo(() => tutti.filter((e) => e.tipo === 'periodo' && e.regole && e.id !== bozza?.id), [tutti, bozza?.id]);
  const nomeDi = (ids: string[] | null) => (!ids || !ids.length ? 'tutti i negozi' : ids.map((id) => negozi.find((n) => n.id === id)?.nome ?? '').filter(Boolean).join(', '));

  const apriNuovo = () => {
    setBozza({ tipo: 'periodo', nome: '', dal: '', al: '', origine: 'sabato', daEvento: '', regole: regoleDiPartenza('sabato', regoleNegozio) });
    setControllo(null); setPasso(1);
  };
  const apri = (e: EventoNegozio) => {
    setBozza({
      id: e.id, tipo: e.tipo === 'giorno' ? 'giorno' : 'periodo', nome: e.nome, dal: e.data_dal, al: e.data_al,
      origine: e.regole_origine ?? 'sabato', daEvento: '', regole: e.regole ?? regoleDiPartenza('sabato', regoleNegozio),
    });
    setControllo(null); setPasso(1);
  };

  const conflitti = bozza && bozza.dal && bozza.al
    ? eventiInConflitto(tutti, { id: bozza.id, nome: bozza.nome, data_dal: bozza.dal, data_al: bozza.tipo === 'giorno' ? bozza.dal : bozza.al, outlet_ids: [outletId], tipo: bozza.tipo })
    : [];
  const errorePasso1 = !bozza ? null
    : !bozza.nome.trim() ? 'Dai un nome.'
      : !bozza.dal ? 'Indica il giorno.'
        : bozza.tipo === 'periodo' && !bozza.al ? 'Indica l’ultimo giorno.'
          : bozza.tipo === 'periodo' && bozza.al < bozza.dal ? 'L’ultimo giorno viene prima del primo.'
            : conflitti.length ? `In quei giorni c’è già «${conflitti[0].nome}» (${date(conflitti[0])}, ${nomeDi(conflitti[0].outlet_ids)}): due eventi sugli stessi giorni dello stesso negozio non si possono avere.`
              : null;

  const controllaModa = async (b: Bozza) => {
    setLeggo(true);
    try {
      if (!ingressi.current) {
        const r = await caricaIngressiGiornalieri(companyId, outletId);
        ingressi.current = r.ingressi; setFonte(r.fonte);
      }
      setControllo(controlloModaPeriodo(ingressi.current, b.dal, b.al));
    } catch { setControllo(null); setFonte('nessuna'); }
    finally { setLeggo(false); }
  };

  const avanti = async () => {
    if (!bozza) return;
    if (passo === 1) {
      if (errorePasso1) { toast({ type: 'error', message: errorePasso1 }); return; }
      if (bozza.tipo === 'giorno') { setPasso(4); return; }
      setPasso(2); await controllaModa(bozza); return;
    }
    setPasso((p) => Math.min(4, p + 1));
  };
  const indietro = () => setPasso((p) => (bozza?.tipo === 'giorno' ? 1 : Math.max(1, p - 1)));

  const scegliOrigine = (origine: OrigineRegole, daEvento = '') => {
    if (!bozza) return;
    const sorgente = origine === 'evento' ? tutti.find((e) => e.id === daEvento) : null;
    const partenza = regoleDiPartenza(origine, regoleNegozio, sorgente);
    // «Le scrivo qui»: si parte dalle fasce del sabato del negozio, da cambiare.
    const regole = origine === 'manuale' ? { ...partenza, fasce: fasceDelGiorno(fasceNegozio, 6) } : partenza;
    setBozza({ ...bozza, origine, daEvento, regole });
  };
  const cambiaRegola = (patch: Partial<RegoleEvento>) => setBozza((b) => (b ? { ...b, regole: { ...b.regole, ...patch } } : b));

  const salva = async () => {
    if (!bozza) return;
    setSalvo(true);
    const periodo = bozza.tipo === 'periodo';
    const r = bozza.regole;
    const originale = bozza.id ? tutti.find((e) => e.id === bozza.id) : undefined;
    // Le fasce sono fabbisogno: chi non le decide non le cambia (restano quelle salvate).
    const fasce = puoFabbisogno ? r.fasce : originale?.regole?.fasce;
    const regole: RegoleEvento | null = periodo ? { ...r, ...(fasce && fasce.length ? { fasce } : { fasce: undefined }), riposi_min: Math.max(RIPOSO_LEGALE, r.riposi_min ?? RIPOSO_LEGALE) } : null;
    if (regole && !regole.fasce) delete regole.fasce;
    const riga = {
      company_id: companyId, nome: bozza.nome.trim(), data_dal: bozza.dal, data_al: periodo ? bozza.al : bozza.dal, outlet_ids: [outletId],
      tipo: bozza.tipo, regole, regole_origine: periodo ? bozza.origine : 'sabato', controllo_moda: periodo ? controllo : null,
      // Dalla 407 ferie e permessi si decidono separati (regole.ferie, regole.permessi);
      // blocca_ferie resta vero solo quando sono spenti tutti e due.
      blocca_ferie: periodo ? (!r.ferie && !r.permessi) : true,
      straordinari: periodo ? (r.straordinari ?? true) : true,
    };
    const { error } = bozza.id ? await db.from('outlet_events').update(riga).eq('id', bozza.id) : await db.from('outlet_events').insert([riga]);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: `«${riga.nome}» non salvato: ${error.message}` }); return; }
    toast({ type: 'success', message: `«${riga.nome}» salvato per ${nomeNegozio}: vale dalla prossima proposta dei turni.` });
    setBozza(null);
    await carica();
    onSalvato?.();
  };

  const togli = async (e: EventoNegozio) => {
    if (!e.id || !window.confirm(`Togliere «${e.nome}» (${date(e)})?`)) return;
    const { error } = await supabase.from('outlet_events').delete().eq('id', e.id);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    await carica();
    onSalvato?.();
  };

  if (caricamento) return <p className="text-sm text-slate-400">Caricamento…</p>;

  const v = verdettoModa(controllo);
  const fasceMostrate: FasciaSemplice[] = bozza?.regole.fasce ?? fasceDelGiorno(fasceNegozio, bozza?.origine === 'domenica' ? 7 : 6);
  const massimoBarra = Math.max(1, ...(controllo?.barre.map((b) => b.mediaGiorno ?? 0) ?? [1]));
  const PASSI = [{ n: 1, t: 'Cosa e quando' }, { n: 2, t: 'Controllo MODA' }, { n: 3, t: 'Le regole' }, { n: 4, t: 'Conferma' }];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs text-slate-500 max-w-2xl">Un <strong>giorno speciale</strong> vale come un sabato. Un <strong>periodo speciale</strong> va da un giorno a un altro e ha regole sue: il sistema guarda gli ingressi MODA dello stesso periodo dell’anno prima e ti dice se sono stati sopra la media.</p>
        {puoScrivere && (conRegole
          ? <button type="button" onClick={apriNuovo} className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg bg-pink-600 text-white text-sm font-semibold hover:bg-pink-700"><Plus size={15} /> Nuovo</button>
          : onVaiEventi && <button type="button" onClick={onVaiEventi} className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50"><CalendarRange size={15} /> Apri gli eventi</button>)}
      </div>
      {!conRegole && <p className="text-xs text-slate-500">Giorni e periodi con regole proprie si potranno creare qui dopo il prossimo aggiornamento del database. Per ora gli eventi si inseriscono dalla pagina Eventi.</p>}

      <ul className="divide-y divide-slate-100 text-sm border-t border-slate-100">
        {delNegozio.map((e) => (
          <li key={e.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong>{e.nome}</strong> <span className="inline-block rounded-full bg-slate-200 text-slate-700 text-[11px] font-semibold px-2 py-0.5">{e.tipo === 'giorno' ? 'giorno' : e.tipo === 'periodo' ? 'periodo' : 'evento'}</span>
              <span className="text-slate-500"> · {date(e)}</span>
              <div className="text-xs text-slate-500">
                {e.tipo === 'giorno' ? 'come un sabato' : e.tipo === 'periodo' ? `regole ${e.regole_origine === 'domenica' ? 'come la domenica' : e.regole_origine === 'evento' ? 'copiate da un altro evento' : e.regole_origine === 'manuale' ? 'scritte a mano' : 'come un sabato'}` : `evento per ${nomeDi(e.outlet_ids)}`}
                {e.blocca_ferie ? ' · richieste di ferie e permessi bloccate' : e.regole?.ferie === false ? ' · richieste di ferie bloccate' : e.regole?.permessi === false ? ' · richieste di permessi bloccate' : ''}{e.straordinari ? ' · straordinari ammessi' : ''}
              </div>
            </div>
            {puoScrivere && (
              <div className="flex gap-1">
                {e.tipo && conRegole
                  ? <button type="button" onClick={() => apri(e)} className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50">Apri</button>
                  : onVaiEventi && <button type="button" onClick={onVaiEventi} className="min-h-[36px] px-3 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-50">Apri negli eventi</button>}
                {e.tipo && <button type="button" aria-label={`Togli ${e.nome}`} onClick={() => togli(e)} className="p-2 rounded-lg hover:bg-slate-100"><Trash2 size={14} /></button>}
              </div>
            )}
          </li>
        ))}
        {!delNegozio.length && <li className="py-3 text-slate-400">Nessun giorno o periodo speciale in arrivo per {nomeNegozio}.</li>}
      </ul>

      <Modal open={bozza !== null} onClose={() => setBozza(null)} title={bozza?.id ? `Modifica «${bozza.nome}»` : 'Nuovo giorno o periodo speciale'} maxWidthClass="max-w-3xl" closeOnBackdrop={false}>
        {bozza && (
          <div className="space-y-4 text-sm">
            <p className="text-xs text-slate-500 -mt-1">Per il negozio: <strong className="text-slate-800">{nomeNegozio}</strong></p>
            <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Passi">
              {PASSI.map((p) => {
                const saltato = bozza.tipo === 'giorno' && (p.n === 2 || p.n === 3);
                return (
                  <li key={p.n} aria-current={passo === p.n ? 'step' : undefined}
                    className={`rounded-lg border px-2.5 py-1.5 ${passo === p.n ? 'border-pink-500 bg-pink-50' : 'border-slate-200'} ${saltato ? 'opacity-40' : ''}`}>
                    <span className="font-semibold">{p.n} · {p.t}</span>
                  </li>
                );
              })}
            </ol>

            {passo === 1 && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo">
                  {([{ k: 'giorno' as const, t: 'Giorno singolo', d: 'vale come un sabato' }, { k: 'periodo' as const, t: 'Periodo', d: 'da un giorno a un altro, con regole sue' }]).map((x) => (
                    <button key={x.k} type="button" role="radio" aria-checked={bozza.tipo === x.k} onClick={() => setBozza({ ...bozza, tipo: x.k })}
                      className={`text-left rounded-lg border-2 px-3 py-2 min-w-[200px] ${bozza.tipo === x.k ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}>
                      <span className="font-semibold block">{x.t}</span><span className="text-xs text-slate-500">{x.d}</span>
                    </button>
                  ))}
                </div>
                <label className="block text-xs text-slate-600">Nome<br />
                  <input className={`${inputCls} w-full`} value={bozza.nome} placeholder={bozza.tipo === 'giorno' ? 'Immacolata' : 'Black Friday'} onChange={(e) => setBozza({ ...bozza, nome: e.target.value })} />
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="text-xs text-slate-600">{bozza.tipo === 'giorno' ? 'Giorno' : 'Dal'}<br />
                    <input type="date" className={inputCls} value={bozza.dal} onChange={(e) => setBozza({ ...bozza, dal: e.target.value, al: bozza.al && bozza.al >= e.target.value ? bozza.al : e.target.value })} />
                  </label>
                  {bozza.tipo === 'periodo' && (
                    <label className="text-xs text-slate-600">Al<br />
                      <input type="date" className={inputCls} value={bozza.al} min={bozza.dal || undefined} onChange={(e) => setBozza({ ...bozza, al: e.target.value })} />
                    </label>
                  )}
                </div>
                {bozza.tipo === 'giorno' && <p className="text-xs text-slate-500">Un giorno singolo non chiede altro: quel giorno il negozio usa le persone per fascia del sabato, con gli ingressi MODA sopra, e valgono le regole dei giorni caldi.</p>}
                {bozza.dal && errorePasso1 && bozza.nome.trim() && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">{errorePasso1}</p>}
              </div>
            )}

            {passo === 2 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">Ingressi medi al giorno nello stesso periodo dell’anno prima (con 3 giorni di margine prima e dopo), accanto agli stessi giorni delle settimane vicine.{fonte === 'riferimento' ? ' Questo negozio non ha storico: uso gli ingressi del suo negozio di riferimento.' : ''}</p>
                {leggo && <p className="text-slate-400">Leggo gli ingressi…</p>}
                {!leggo && controllo && controllo.esito !== 'senza_dati' && (
                  <>
                    <div className="flex items-end gap-2 h-36 pt-5" role="img" aria-label={`Ingressi medi al giorno: ${controllo.barre.map((b) => `${b.etichetta} ${b.mediaGiorno ?? 'senza dati'}`).join(', ')}`}>
                      {controllo.barre.map((b) => (
                        <div key={b.etichetta} className="flex-1 flex flex-col items-center justify-end h-full">
                          <span className="text-[11px] font-bold">{b.mediaGiorno != null ? b.mediaGiorno.toLocaleString('it-IT') : '–'}</span>
                          <div className={`w-full rounded-t-md ${b.periodo ? 'bg-pink-600' : 'bg-slate-300'}`} style={{ height: `${Math.max(3, ((b.mediaGiorno ?? 0) / massimoBarra) * 100)}%` }} />
                          <span className="text-[10px] text-slate-500 text-center leading-tight mt-1 h-6">{b.etichetta}</span>
                        </div>
                      ))}
                    </div>
                    <p><span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${COLORE[v.colore]}`}>{v.testo}</span></p>
                    {controllo.proposta && (
                      <p className="text-xs text-slate-600">L’anno prima i giorni più forti sono stati dal {formattaDataBreve(controllo.picco.dal)} al {formattaDataBreve(controllo.picco.al)}.{' '}
                        <button type="button" className="underline font-semibold text-blue-700" onClick={() => { const b = { ...bozza, dal: controllo.proposta!.dal, al: controllo.proposta!.al }; setBozza(b); controllaModa(b); }}>
                          Sposta le date al {formattaDataBreve(controllo.proposta.dal)} – {formattaDataBreve(controllo.proposta.al)}
                        </button>
                      </p>
                    )}
                    {controllo.esito !== 'sopra' && <p className="text-xs text-slate-600">Gli ingressi non sono stati sopra la media: puoi tenere il periodo lo stesso, decidi tu.</p>}
                  </>
                )}
                {!leggo && (!controllo || controllo.esito === 'senza_dati') && <p className="text-slate-600">Non ci sono ingressi MODA dell’anno prima per questi giorni: non posso dirti se è un periodo forte. Puoi andare avanti lo stesso.</p>}
              </div>
            )}

            {passo === 3 && (
              <div className="space-y-3">
                <div>
                  <h4 className="font-semibold">Da dove prendo le regole</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1.5" role="radiogroup" aria-label="Da dove prendo le regole">
                    {([{ k: 'sabato' as const, t: 'Come un sabato', d: 'persone per fascia del sabato e regole dei giorni caldi' }, { k: 'domenica' as const, t: 'Come la domenica', d: 'persone per fascia della domenica' }, { k: 'manuale' as const, t: 'Le scrivo qui', d: 'parto dal sabato e cambio quello che serve' }]).map((x) => (
                      <button key={x.k} type="button" role="radio" aria-checked={bozza.origine === x.k} onClick={() => scegliOrigine(x.k)}
                        className={`text-left rounded-lg border-2 px-3 py-2 ${bozza.origine === x.k ? 'border-pink-500 bg-pink-50' : 'border-slate-200'}`}>
                        <span className="font-semibold block">{x.t}</span><span className="text-xs text-slate-500">{x.d}</span>
                      </button>
                    ))}
                    <div className={`rounded-lg border-2 px-3 py-2 ${bozza.origine === 'evento' ? 'border-pink-500 bg-pink-50' : 'border-slate-200'}`}>
                      <label className="font-semibold block" htmlFor="copia-evento">Copia da un altro evento</label>
                      <select id="copia-evento" className={`${inputCls} w-full mt-1`} value={bozza.origine === 'evento' ? bozza.daEvento : ''} disabled={!daCopiare.length}
                        onChange={(e) => (e.target.value ? scegliOrigine('evento', e.target.value) : scegliOrigine('sabato'))}>
                        <option value="">{daCopiare.length ? 'scegli…' : 'nessun periodo salvato da copiare'}</option>
                        {daCopiare.map((e) => <option key={e.id} value={e.id}>{e.nome} · {date(e)} · {nomeDi(e.outlet_ids)}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="border-t-2 border-slate-900 pt-2">
                  <h4 className="font-semibold">Le regole di questo periodo</h4>
                  <p className="text-xs text-slate-500">Valgono solo dal {formattaDataBreve(bozza.dal)} al {formattaDataBreve(bozza.al)}, solo per {nomeNegozio}. Cambiale una per una.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 mt-1">
                    <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 flex-wrap">
                      <span>Orario del negozio</span>
                      <span className="flex items-center gap-1">
                        <input aria-label="Apre" type="time" step={1800} className={`${inputCls} w-[104px]`} value={bozza.regole.apre ?? ''} onChange={(e) => cambiaRegola({ apre: e.target.value || null })} />
                        <span className="text-slate-400">–</span>
                        <input aria-label="Chiude" type="time" step={1800} className={`${inputCls} w-[104px]`} value={bozza.regole.chiude ?? ''} onChange={(e) => cambiaRegola({ chiude: e.target.value || null })} />
                      </span>
                      <span className="text-xs text-slate-500 w-full">Vuoto = l’orario solito del negozio.</span>
                    </div>
                    {([
                      { k: 'moda' as const, t: 'Gli ingressi MODA aggiungono persone', d: true },
                      { k: 'tutti' as const, t: 'Lavorano tutte, senza riposi in questi giorni', d: true },
                      { k: 'straordinari' as const, t: 'Straordinari ammessi', d: true },
                      { k: 'guida' as const, t: 'Responsabile e vice: una apre, l’altra chiude, a turno', d: true },
                      { k: 'ferie' as const, t: 'Richieste di ferie ammesse', d: false },
                      { k: 'permessi' as const, t: 'Richieste di permesso ammesse', d: false },
                    ]).map((x) => (
                      <div key={x.k} className="flex items-center justify-between gap-3 py-2 border-b border-slate-100">
                        <span>{x.t}</span>
                        <Interruttore acceso={bozza.regole[x.k] ?? x.d} onCambia={(val) => cambiaRegola({ [x.k]: val })} etichetta={x.t} />
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100">
                      <span>Riposi nella settimana, almeno</span>
                      <input aria-label="Riposi minimi nella settimana" type="number" min={RIPOSO_LEGALE} max={3} className={`${inputCls} w-16 text-center`} value={bozza.regole.riposi_min ?? RIPOSO_LEGALE}
                        onChange={(e) => cambiaRegola({ riposi_min: Math.max(RIPOSO_LEGALE, Math.min(3, Number(e.target.value) || RIPOSO_LEGALE)) })} />
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Per legge c’è sempre almeno un giorno di riposo a settimana: sotto 1 non si scende.</p>
                  <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-2">Ferie e permessi si decidono separati: in questi giorni dall’app si chiede solo quello che lasci acceso. Quello che spegni passa solo come eccezione, se nella scheda 9 «Ferie e permessi» il negozio ha scritto chi approva le eccezioni; altrimenti la richiesta è rifiutata.</p>
                </div>
                <div>
                  <h4 className="font-semibold flex items-center gap-1.5">Persone per fascia {!puoFabbisogno && <Lock size={13} className="text-slate-400" />}</h4>
                  <p className="text-xs text-slate-500 mb-1.5">{bozza.regole.fasce ? 'Fasce scritte per questo periodo.' : `Sono quelle ${bozza.origine === 'domenica' ? 'della domenica' : 'del sabato'} del negozio: se le cambi nel negozio, cambiano anche qui.`}{!puoFabbisogno ? ' Le persone per fascia le decide la direzione (profilo Super Advisor): qui le vedi.' : ''}</p>
                  <FasceEditor fasce={fasceMostrate} apre={bozza.regole.apre || orarioSabato.apre} chiude={bozza.regole.chiude || orarioSabato.chiude}
                    bloccato={!puoFabbisogno || !bozza.regole.fasce} onCambia={(f) => cambiaRegola({ fasce: f.map(({ dalle, alle, persone }) => ({ dalle, alle, persone })) })} />
                  {puoFabbisogno && !bozza.regole.fasce && (
                    <button type="button" onClick={() => cambiaRegola({ fasce: fasceMostrate.map(({ dalle, alle, persone }) => ({ dalle, alle, persone })) })} className="mt-2 text-xs underline font-semibold text-blue-700">Scrivi fasce apposta per questo periodo</button>
                  )}
                  {puoFabbisogno && bozza.regole.fasce && (
                    <button type="button" onClick={() => cambiaRegola({ fasce: null })} className="mt-2 ml-3 text-xs underline text-slate-600">Torna alle fasce del negozio</button>
                  )}
                </div>
              </div>
            )}

            {passo === 4 && (
              <div className="space-y-2">
                <h4 className="font-semibold">Riepilogo</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>{bozza.nome}</strong>, {bozza.tipo === 'giorno' ? `giorno speciale del ${formattaDataBreve(bozza.dal)}` : `periodo dal ${formattaDataBreve(bozza.dal)} al ${formattaDataBreve(bozza.al)}`}, per {nomeNegozio}.</li>
                  {bozza.tipo === 'giorno' && <li>Vale come un sabato: persone per fascia del sabato con gli ingressi MODA sopra, regole dei giorni caldi, richieste di ferie e permessi bloccate.</li>}
                  {bozza.tipo === 'periodo' && (
                    <>
                      <li>Ingressi dell’anno prima: {v.testo.toLowerCase()}.</li>
                      <li>Regole {bozza.origine === 'domenica' ? 'come la domenica' : bozza.origine === 'evento' ? 'copiate da un altro evento' : bozza.origine === 'manuale' ? 'scritte a mano' : 'come un sabato'}{bozza.regole.fasce ? ', con fasce proprie' : ''}{bozza.regole.apre && bozza.regole.chiude ? `, negozio aperto ${bozza.regole.apre}-${bozza.regole.chiude}` : ''}.</li>
                      <li>{(bozza.regole.tutti ?? true) ? 'Lavorano tutte' : 'I riposi restano possibili'}; straordinari {(bozza.regole.straordinari ?? true) ? 'ammessi' : 'non ammessi'}; almeno {bozza.regole.riposi_min ?? RIPOSO_LEGALE} {(bozza.regole.riposi_min ?? RIPOSO_LEGALE) === 1 ? 'riposo' : 'riposi'} a settimana.</li>
                      <li>Richieste dall’app: {bozza.regole.ferie && bozza.regole.permessi ? 'ferie e permessi ammessi' : bozza.regole.ferie ? 'ferie ammesse, permessi bloccati' : bozza.regole.permessi ? 'permessi ammessi, ferie bloccate' : 'ferie e permessi bloccati'}.</li>
                    </>
                  )}
                </ul>
                <p className="text-xs text-slate-500">I turni già pubblicati non cambiano: le regole valgono dalla prossima proposta.</p>
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setBozza(null)} className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Annulla</button>
              <div className="flex gap-2">
                {passo > 1 && <button type="button" onClick={indietro} className="min-h-[40px] px-3.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Indietro</button>}
                {passo < 4
                  ? <button type="button" onClick={avanti} disabled={leggo} className="min-h-[40px] px-4 rounded-lg bg-pink-600 text-white text-sm font-semibold hover:bg-pink-700 disabled:opacity-50">Avanti</button>
                  : <button type="button" onClick={salva} disabled={salvo} className="min-h-[40px] px-4 rounded-lg bg-pink-600 text-white text-sm font-semibold hover:bg-pink-700 disabled:opacity-50">{salvo ? 'Salvo…' : 'Conferma e salva'}</button>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
