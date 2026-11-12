// «Turni» (riorganizzata il 12/11/2026): si parte dal NEGOZIO, poi i tre passi (prepara il
// mese, sistema la settimana, pubblica e invia) e, in basso, il resto del negozio (regole e
// orari, eventi, persone e riposi, traffico MODA, trasferte).
// Prima: il piano settimanale di ogni negozio e, sotto, gli orari e il
// fabbisogno da cui si parte. Il negozio si sceglie qui; l'organico (chi
// c'e' e con che orario) arriva dall'organico di oggi. Qui si sceglie anche
// la referente del negozio e la sua vice, e nella scheda «Eventi» si segnano Black
// Friday, feste e saldi, che valgono per piu' negozi insieme. In «Traffico
// MODA» si caricano i report degli ingressi per ora, da cui viene il fabbisogno.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sqlNull } from '../lib/sqlNull';
import { stimaOrariEFabbisogno } from '../lib/stimaNegozio';
import { riassuntoOrari, type OrarioGiornoTipo } from '../lib/turni';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { organicoAllaData, oggiRoma, nomePersona } from '../lib/organico';
import { caricaChiusurePerStima, caricaOrganico, nomeNegozio, puoDecidereFabbisogno, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';
import PianoTurni from './PianoTurni';
import OrariNegozio from './OrariNegozio';
import EventiNegozi from './EventiNegozi';
import PianiMensili from './PianiMensili';
import TrasferteNegozi from './TrasferteNegozi';
import TrafficoModa from './TrafficoModa';
import EventiDelNegozio from './EventiDelNegozio';
import RiposiNegozio from './RiposiNegozio';
import { guidaConRipiego } from '../lib/guidaNegozio';

type Props = {
  companyId?: string;
  /** se indicati, la pagina mostra solo questi negozi (chi ne vede uno solo non ha il selettore) */
  soloNegozi?: string[];
};

export default function TurniNegozi({ companyId, soloNegozi }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const puoScrivere = puoTenereOrganico(profile?.role);
  const puoFabbisogno = puoDecidereFabbisogno(profile?.role);

  const [dati, setDati] = useState<DatiOrganico | null>(null);
  const [negozio, setNegozio] = useState('');
  const [sotto, setSotto] = useState<'mese' | 'piano' | 'pubblica' | 'orari' | 'eventi' | 'persone' | 'trasferte' | 'traffico'>('mese');
  const [versione, setVersione] = useState(0);
  // «Regole e orari» con modifiche non salvate: prima di cambiare negozio
  // o scheda si chiede (salva, lascia perdere, resta).
  const guardiaOrari = useRef<(() => Promise<boolean>) | null>(null);
  const seSiPuo = async (fai: () => void) => {
    if (guardiaOrari.current && !(await guardiaOrari.current())) return;
    fai();
  };
  const [stimo, setStimo] = useState(false);
  const [viceSpento, setViceSpento] = useState(false);
  const [trafficoVisto, setTrafficoVisto] = useState(false);
  useEffect(() => { if (sotto === 'traffico') setTrafficoVisto(true); }, [sotto]);

  const carica = useCallback(async () => {
    if (!companyId) return;
    try { setDati(await caricaOrganico(companyId)); }
    catch (e) { toast({ type: 'error', message: `Organico non caricato: ${e instanceof Error ? e.message : 'errore'}` }); }
  }, [companyId, toast]);
  useEffect(() => { carica(); }, [carica]);

  // Gli orari del negozio scelto, sempre in vista: chi fa i turni non deve
  // ricordarli a memoria (Patrizio, 21/10/2026).
  const [orari, setOrari] = useState<OrarioGiornoTipo[] | null>(null);
  useEffect(() => {
    if (!negozio) return;
    let vivo = true;
    setOrari(null);
    supabase.from('outlet_opening_hours').select('giorno, chiuso, apre, chiude').eq('outlet_id', negozio)
      .then(({ data }) => { if (vivo) setOrari((data as OrarioGiornoTipo[]) ?? []); });
    return () => { vivo = false; };
  }, [negozio, versione]);

  const oggi = oggiRoma();
  const persone = useMemo(() => (dati ? organicoAllaData(dati.schede, dati.eventi, oggi) : []), [dati, oggi]);
  const negozi = useMemo(() => (dati?.negozi ?? [])
    .filter((n) => n.is_active !== false && (!soloNegozi || soloNegozi.includes(n.id)))
    .map((n) => ({ ...n, persone: persone.filter((p) => p.outletId === n.id && p.stato === 'in_servizio').length })), [dati, persone, soloNegozi]);

  // Si parte dal negozio con piu' persone.
  useEffect(() => {
    if (!negozio && negozi.length) setNegozio([...negozi].sort((a, b) => b.persone - a.persone)[0].id);
  }, [negozi, negozio]);

  // Orari (e, per Patrizio, fabbisogno) stimati dai dati per tutti i negozi
  // che non li hanno ancora: si scrivono solo dove manca tutto, con
  // origine = 'stima', e restano da confermare. I negozi senza chiusure di
  // cassa (sede, negozi non ancora aperti) restano fuori: li si inserisce a mano.
  const stimaTutti = async () => {
    if (!companyId) return;
    if (guardiaOrari.current && !(await guardiaOrari.current())) return;
    setStimo(true);
    try {
      const [chiusure, conOrari, conFasce] = await Promise.all([
        caricaChiusurePerStima(companyId),
        supabase.from('outlet_opening_hours').select('outlet_id').eq('company_id', companyId),
        supabase.from('outlet_staffing_needs').select('outlet_id').eq('company_id', companyId),
      ]);
      const haOrari = new Set(((conOrari.data as { outlet_id: string }[]) ?? []).map((r) => r.outlet_id));
      const haFasce = new Set(((conFasce.data as { outlet_id: string }[]) ?? []).map((r) => r.outlet_id));
      const fatti: string[] = [];
      const saltati: string[] = [];
      for (const n of negozi) {
        const ch = chiusure.filter((c) => c.outlet_id === n.id);
        const lavorano = persone.filter((p) => p.outletId === n.id && p.stato === 'in_servizio');
        const scriviOrari = !haOrari.has(n.id);
        const scriviFasce = puoFabbisogno && !haFasce.has(n.id);
        if (!scriviOrari && !scriviFasce) continue;
        if (!ch.length) { saltati.push(nomeNegozio(n)); continue; }
        const st = stimaOrariEFabbisogno(ch, lavorano.reduce((s, p) => s + (p.ore ?? 0), 0), lavorano.length);
        if (scriviOrari) {
          const { error } = await supabase.from('outlet_opening_hours').insert(st.orari.map((o) => ({
            company_id: companyId, outlet_id: n.id, giorno: o.giorno, chiuso: o.chiuso, apre: o.apre, chiude: o.chiude, origine: 'stima',
          })));
          if (error) throw error;
        }
        if (scriviFasce && st.fasce.length) {
          const { error } = await supabase.from('outlet_staffing_needs').insert(st.fasce.map((f) => ({
            company_id: companyId, outlet_id: n.id, giorno: f.giorno, dalle: f.dalle, alle: f.alle, persone: f.persone, origine: 'stima',
          })));
          if (error) throw error;
        }
        fatti.push(nomeNegozio(n));
      }
      toast({
        type: fatti.length ? 'success' : 'info',
        message: fatti.length
          ? `Stima fatta per ${fatti.join(', ')}: da controllare e confermare in «Regole e orari».${saltati.length ? ` Senza chiusure di cassa, da inserire a mano: ${saltati.join(', ')}.` : ''}`
          : saltati.length ? `Nessuna stima possibile: senza chiusure di cassa ${saltati.join(', ')}.` : 'Tutti i negozi hanno già orari e fabbisogno.',
        duration: 12000,
      });
      setVersione((v) => v + 1);
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Stima non riuscita.' });
    } finally {
      setStimo(false);
    }
  };

  if (!companyId) return null;
  if (!dati) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const scelto = negozi.find((n) => n.id === negozio);
  // Chi puo' fare la referente: le persone in servizio nel negozio, piu'
  // quella gia' scelta se nel frattempo non lo e' piu'.
  const delNegozio = persone.filter((p) => p.outletId === negozio && p.stato === 'in_servizio');
  const referente = scelto?.referente_employee_id ? dati.schede.find((s) => s.id === scelto.referente_employee_id) : undefined;
  const sceltePossibili = [...delNegozio.map((p) => p.scheda), ...(referente && !delNegozio.some((p) => p.scheda.id === referente.id) ? [referente] : [])]
    .sort((a, b) => nomePersona(a).localeCompare(nomePersona(b), 'it'));
  const impostaReferente = async (employeeId: string) => {
    if (!scelto) return;
    const { error } = await supabase.rpc('organico_imposta_referente', { p_outlet_id: scelto.id, p_employee_id: sqlNull(employeeId || null) });
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: employeeId ? `Responsabile di ${nomeNegozio(scelto)} salvato: vale anche in Organico, Utenti e modulo ferie.` : `${nomeNegozio(scelto)} è senza responsabile.` });
    await carica();
  };
  // Vice responsabile (migration 393): fa il versamento quando la responsabile
  // non c'e'. Stesse persone, tolta la responsabile. Dove il database non ha
  // ancora la colonna o la funzione, il selettore non compare.
  const vice = scelto?.vice_referente_employee_id ? dati.schede.find((s) => s.id === scelto.vice_referente_employee_id) : undefined;
  const scelteVice = [...delNegozio.map((p) => p.scheda), ...(vice && !delNegozio.some((p) => p.scheda.id === vice.id) ? [vice] : [])]
    .filter((s) => s.id !== scelto?.referente_employee_id)
    .sort((a, b) => nomePersona(a).localeCompare(nomePersona(b), 'it'));
  const impostaVice = async (employeeId: string) => {
    if (!scelto) return;
    const { error } = await supabase.rpc('organico_imposta_vice' as never, { p_outlet_id: scelto.id, p_employee_id: sqlNull(employeeId || null) } as never);
    if (error) {
      // Funzione non ancora nel database: si toglie il selettore, senza errori a video.
      const e = error as { code?: string; message?: string };
      if (e.code === 'PGRST202' || e.code === '42883' || /could not find the function/i.test(e.message ?? '')) { setViceSpento(true); return; }
      toast({ type: 'error', message: error.message });
      return;
    }
    toast({ type: 'success', message: employeeId ? `Vice responsabile di ${nomeNegozio(scelto)} salvato: il lunedì una fra responsabile e vice deve essere in negozio per il versamento.` : `${nomeNegozio(scelto)} è senza vice responsabile.` });
    await carica();
  };
  const mostraVice = !!dati.viceDisponibile && !viceSpento;
  const oreContratto = persone.filter((p) => p.outletId === negozio && p.stato === 'in_servizio').reduce((s, p) => s + (p.ore ?? 0), 0);

  // Finche' responsabile o vice non sono scelte, per i turni il sistema usa chi ha piu' ore di
  // contratto e, a parita', chi e' assunta da piu' tempo (Patrizio, 12/11/2026): qui lo si dice.
  const provvisoria = guidaConRipiego(scelto?.referente_employee_id ?? null, mostraVice ? (scelto?.vice_referente_employee_id ?? null) : null,
    delNegozio.map((p) => ({ id: p.scheda.id, ore: p.ore ?? 0, assunta: p.scheda.data_assunzione ?? null })));
  const nomeDi = (id: string | null) => { const s = id ? dati.schede.find((x) => x.id === id) : undefined; return s ? nomePersona(s) : null; };
  const selettoriGuida = scelto ? (
    <div className="space-y-2 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span className="text-slate-700">Responsabile</span>
        {puoScrivere ? (
          <select aria-label="Responsabile del negozio" value={scelto.referente_employee_id ?? ''} onChange={(e) => impostaReferente(e.target.value)}
            className="min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm bg-white max-w-[60%]">
            <option value="">da scegliere</option>
            {sceltePossibili.map((s) => <option key={s.id} value={s.id}>{nomePersona(s)}</option>)}
          </select>
        ) : <strong className="text-slate-800">{referente ? nomePersona(referente) : 'da scegliere'}</strong>}
      </label>
      {mostraVice && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-slate-700">Vice responsabile</span>
          {puoScrivere ? (
            <select aria-label="Vice responsabile del negozio" value={scelto.vice_referente_employee_id ?? ''} onChange={(e) => impostaVice(e.target.value)}
              className="min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm bg-white max-w-[60%]">
              <option value="">da scegliere</option>
              {scelteVice.map((s) => <option key={s.id} value={s.id}>{nomePersona(s)}</option>)}
            </select>
          ) : <strong className="text-slate-800">{vice ? nomePersona(vice) : 'da scegliere'}</strong>}
        </label>
      )}
      {(provvisoria.provvisoria.responsabile || (mostraVice && provvisoria.provvisoria.vice)) && (
        <p className="text-xs text-slate-500">
          Finché {provvisoria.provvisoria.responsabile && provvisoria.provvisoria.vice ? 'mancano' : 'manca'} {[provvisoria.provvisoria.responsabile ? 'la responsabile' : '', mostraVice && provvisoria.provvisoria.vice ? 'la vice' : ''].filter(Boolean).join(' e ')}, nei negozi con i giorni caldi accesi il sistema usa per i turni chi ha più ore di contratto e, a parità, chi è assunta da più tempo: oggi{' '}
          {[provvisoria.provvisoria.responsabile ? `${nomeDi(provvisoria.responsabile) ?? 'nessuno'} come responsabile` : '', mostraVice && provvisoria.provvisoria.vice ? `${nomeDi(provvisoria.vice) ?? 'nessuno'} come vice` : ''].filter(Boolean).join(', ')}.
        </p>
      )}
    </div>
  ) : null;
  const personeDelNegozio = delNegozio.map((p) => ({ id: p.scheda.id, nome: nomePersona(p.scheda) })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  const PASSI = [
    { k: 'mese' as const, n: 1, t: 'Prepara il mese', d: 'Il sistema propone i turni di tutto il mese con le regole del negozio.' },
    { k: 'piano' as const, n: 2, t: 'Sistema la settimana', d: 'Guardi la settimana e sposti quello che serve. Le regole che saltano sono segnate.' },
    { k: 'pubblica' as const, n: 3, t: 'Pubblica e invia', d: 'Le persone la vedono nell’app. Stampi o condividi il foglio.' },
  ];
  const RESTO = [
    { k: 'orari' as const, t: 'Regole e orari', d: 'Orario, persone per fascia, giorni caldi, pause, riposi.' },
    { k: 'eventi' as const, t: 'Eventi e giorni speciali', d: 'Giorni singoli e periodi con regole proprie.' },
    { k: 'persone' as const, t: 'Persone e riposi', d: 'Responsabile, vice e giorni di riposo di ognuno.' },
    { k: 'traffico' as const, t: 'Traffico MODA', d: 'Gli ingressi su cui si calcolano le persone.' },
    { k: 'trasferte' as const, t: 'Trasferte', d: 'Chi va a lavorare in un altro negozio.' },
  ];

  return (
    <div className="space-y-4">
      {/* Si parte dal negozio (Patrizio, 12/11/2026): chi ne vede uno solo trova subito il suo. */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <div className="text-xs text-slate-500">Negozio</div>
            {negozi.length > 1 ? (
              <select aria-label="Negozio" value={negozio} onChange={(e) => { const id = e.target.value; if (id !== negozio) seSiPuo(() => setNegozio(id)); }}
                className="min-h-[44px] rounded-lg border-2 border-slate-900 px-3 text-base font-semibold bg-white">
                {negozi.map((n) => <option key={n.id} value={n.id}>{nomeNegozio(n)} · {n.persone} {n.persone === 1 ? 'persona' : 'persone'}</option>)}
              </select>
            ) : <div className="text-lg font-semibold text-slate-900">{scelto ? nomeNegozio(scelto) : 'Nessun negozio'}</div>}
          </div>
          {scelto && (
            <div className="text-sm">
              <div className="text-xs text-slate-500">Responsabile</div>
              <strong className="text-slate-900">{referente ? nomePersona(referente) : 'da scegliere'}</strong>
              {mostraVice && <span className="text-slate-500"> · vice: {vice ? nomePersona(vice) : 'da scegliere'}</span>}
            </div>
          )}
        </div>
        {scelto && orari && (
          <button type="button" onClick={() => seSiPuo(() => setSotto('orari'))} title="Gli orari si cambiano in «Regole e orari»"
            className="inline-flex items-center gap-1.5 text-sm text-slate-700 hover:text-blue-700">
            <Clock size={15} className="text-slate-400" />
            <span className="text-slate-500">Aperto</span>
            <strong className="font-semibold">{orari.length ? riassuntoOrari(orari) : 'orari non inseriti'}</strong>
          </button>
        )}
      </div>

      <nav className="grid grid-cols-1 md:grid-cols-3 gap-3" aria-label="I tre passi dei turni">
        {PASSI.map((p) => (
          <button key={p.k} type="button" onClick={() => { if (p.k !== sotto) seSiPuo(() => setSotto(p.k)); }} aria-current={sotto === p.k ? 'step' : undefined}
            className={`text-left rounded-xl border-2 p-3.5 flex gap-3 items-start bg-white transition-colors ${sotto === p.k ? 'border-pink-500 ring-2 ring-pink-100' : 'border-slate-200 hover:border-slate-400'}`}>
            <span className={`w-8 h-8 rounded-full text-white font-bold flex items-center justify-center shrink-0 ${sotto === p.k ? 'bg-pink-600' : 'bg-slate-900'}`}>{p.n}</span>
            <span><span className="block font-semibold text-slate-900">{p.t}</span><span className="block text-xs text-slate-500">{p.d}</span></span>
          </button>
        ))}
      </nav>

      {sotto === 'orari' && puoScrivere && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Regole e orari{scelto ? ` di ${nomeNegozio(scelto)}` : ''}</h2>
          <button type="button" onClick={stimaTutti} disabled={stimo}
            title={puoFabbisogno ? 'Orari e fabbisogno stimati dai dati, solo per i negozi che non li hanno' : 'Orari stimati dai dati, solo per i negozi che non li hanno (il fabbisogno lo decide la direzione, profilo Super Advisor)'}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
            <Sparkles size={14} /> {stimo ? 'Stimo…' : 'Stima i negozi vuoti dai dati'}
          </button>
        </div>
      )}

      {scelto && sotto === 'eventi' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-base font-semibold text-slate-900 mb-2">Giorni e periodi speciali di {nomeNegozio(scelto)}</h2>
          <EventiDelNegozio key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
            negozi={negozi.map((n) => ({ id: n.id, nome: nomeNegozio(n) }))} puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} onSalvato={() => setVersione((v) => v + 1)} />
        </section>
      )}
      {sotto === 'eventi' && negozi.length > 1 && (
        <div>
          <h2 className="text-base font-semibold text-slate-900 mb-2">Eventi per più negozi insieme</h2>
          <EventiNegozi companyId={companyId} negozi={negozi} puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} onSalvato={() => setVersione((v) => v + 1)} />
        </div>
      )}
      {scelto && sotto === 'persone' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-slate-900">Responsabile e vice</h2>
            <p className="text-xs text-slate-500 mb-3">Le sole a fare il versamento. Il lunedì una delle due è in negozio.</p>
            {selettoriGuida}
          </section>
          <section className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="text-base font-semibold text-slate-900">Giorni di riposo</h2>
            <p className="text-xs text-slate-500 mb-3">Per legge c’è sempre almeno un giorno di riposo a settimana. Quanti riposi a testa si decide in «Regole e orari».</p>
            <RiposiNegozio key={scelto.id} companyId={companyId} persone={personeDelNegozio} puoScrivere={puoScrivere} />
          </section>
        </div>
      )}
      {sotto === 'trasferte' && companyId && dati && (
        <TrasferteNegozi companyId={companyId} dati={dati} puoScrivere={puoScrivere} />
      )}
      {/* Resta montata dopo la prima apertura: un report lungo continua a caricarsi
          e il suo esito (con le eventuali conferme) e' ancora li' quando si torna. */}
      {trafficoVisto && (
        <div hidden={sotto !== 'traffico'}>
          <TrafficoModa companyId={companyId} negozi={dati.negozi} puoScrivere={puoScrivere} />
        </div>
      )}
      {scelto && sotto === 'mese' && (
        <PianiMensili key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          dati={dati} puoScrivere={puoScrivere} />
      )}
      {scelto && (sotto === 'piano' || sotto === 'pubblica') && (
        <PianoTurni key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          dati={dati} puoScrivere={puoScrivere} onVaiOrari={() => setSotto('orari')} passo={sotto === 'pubblica' ? 3 : 2} />
      )}
      {scelto && sotto === 'orari' && (
        <OrariNegozio key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} oreContratto={oreContratto} guardia={guardiaOrari}
          altriNegozi={negozi.filter((n) => n.id !== scelto.id).map((n) => ({ id: n.id, nome: nomeNegozio(n) }))}
          personeInServizio={delNegozio.length} persone={personeDelNegozio} guida={selettoriGuida}
          onVaiEventi={negozi.length > 1 ? () => seSiPuo(() => setSotto('eventi')) : undefined} />
      )}

      <div>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Il resto del negozio</h2>
        <nav className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5" aria-label="Il resto del negozio">
          {RESTO.map((r) => (
            <button key={r.k} type="button" onClick={() => { if (r.k !== sotto) seSiPuo(() => setSotto(r.k)); }} aria-current={sotto === r.k ? 'page' : undefined}
              className={`text-left rounded-xl border p-3 bg-white ${sotto === r.k ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-400'}`}>
              <span className="block font-semibold text-sm text-slate-900">{r.t}</span>
              <span className="block text-xs text-slate-500">{r.d}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
