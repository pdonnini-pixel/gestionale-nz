// «Turni»: il piano settimanale di ogni negozio e, sotto, gli orari e il
// fabbisogno da cui si parte. Il negozio si sceglie qui; l'organico (chi
// c'e' e con che orario) arriva dall'organico di oggi. Qui si sceglie anche
// la referente del negozio, e nella scheda «Eventi» si segnano Black
// Friday, feste e saldi, che valgono per piu' negozi insieme.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { stimaOrariEFabbisogno } from '../lib/stimaNegozio';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { organicoAllaData, oggiRoma, nomePersona } from '../lib/organico';
import { caricaChiusurePerStima, caricaOrganico, nomeNegozio, puoDecidereFabbisogno, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';
import PianoTurni from './PianoTurni';
import OrariNegozio from './OrariNegozio';
import EventiNegozi from './EventiNegozi';
import PianiMensili from './PianiMensili';

type Props = { companyId?: string };

export default function TurniNegozi({ companyId }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const puoScrivere = puoTenereOrganico(profile?.role);
  const puoFabbisogno = puoDecidereFabbisogno(profile?.role);

  const [dati, setDati] = useState<DatiOrganico | null>(null);
  const [negozio, setNegozio] = useState('');
  const [sotto, setSotto] = useState<'mese' | 'piano' | 'orari' | 'eventi'>('mese');
  const [versione, setVersione] = useState(0);
  const [stimo, setStimo] = useState(false);

  const carica = useCallback(async () => {
    if (!companyId) return;
    try { setDati(await caricaOrganico(companyId)); }
    catch (e) { toast({ type: 'error', message: `Organico non caricato: ${e instanceof Error ? e.message : 'errore'}` }); }
  }, [companyId, toast]);
  useEffect(() => { carica(); }, [carica]);

  const oggi = oggiRoma();
  const persone = useMemo(() => (dati ? organicoAllaData(dati.schede, dati.eventi, oggi) : []), [dati, oggi]);
  const negozi = useMemo(() => (dati?.negozi ?? [])
    .filter((n) => n.is_active !== false)
    .map((n) => ({ ...n, persone: persone.filter((p) => p.outletId === n.id && p.stato === 'in_servizio').length })), [dati, persone]);

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
          ? `Stima fatta per ${fatti.join(', ')}: da controllare e confermare in «Orari e fabbisogno».${saltati.length ? ` Senza chiusure di cassa, da inserire a mano: ${saltati.join(', ')}.` : ''}`
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
    const { error } = await supabase.rpc('organico_imposta_referente', { p_outlet_id: scelto.id, p_employee_id: employeeId || null });
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: employeeId ? `Referente di ${nomeNegozio(scelto)} salvata.` : `${nomeNegozio(scelto)} è senza referente.` });
    await carica();
  };
  const oreContratto = persone.filter((p) => p.outletId === negozio && p.stato === 'in_servizio').reduce((s, p) => s + (p.ore ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Prima cosa si fa (le quattro schede), poi su quale negozio. */}
      <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto" aria-label="Sezioni dei turni">
        {([{ k: 'mese' as const, label: 'Piano del mese' }, { k: 'piano' as const, label: 'Piano settimanale' }, { k: 'orari' as const, label: 'Orari e fabbisogno' }, { k: 'eventi' as const, label: 'Eventi' }]).map((t) => (
          <button key={t.k} type="button" onClick={() => setSotto(t.k)} aria-current={sotto === t.k ? 'page' : undefined}
            className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${sotto === t.k ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t.label}</button>
        ))}
      </nav>

      {sotto !== 'eventi' && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Negozio">
            {negozi.map((n) => (
              <button key={n.id} type="button" role="tab" aria-selected={negozio === n.id} onClick={() => setNegozio(n.id)}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${negozio === n.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700 hover:border-slate-400'}`}>
                {nomeNegozio(n)} <span className={`ml-0.5 text-xs ${negozio === n.id ? 'text-slate-300' : 'text-slate-400'}`}>{n.persone}</span>
              </button>
            ))}
          </div>
          {scelto && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <UserRound size={15} className="text-slate-400" />
              <span>Referente</span>
              {puoScrivere ? (
                <select aria-label="Referente del negozio" value={scelto.referente_employee_id ?? ''} onChange={(e) => impostaReferente(e.target.value)}
                  className="min-h-[34px] rounded-lg border border-slate-300 px-2 text-sm bg-white">
                  <option value="">nessuna</option>
                  {sceltePossibili.map((s) => <option key={s.id} value={s.id}>{nomePersona(s)}</option>)}
                </select>
              ) : (
                <strong className="text-slate-800">{referente ? nomePersona(referente) : 'nessuna'}</strong>
              )}
            </label>
          )}
        </div>
      )}

      {sotto === 'orari' && puoScrivere && (
        <div className="flex justify-end">
          <button type="button" onClick={stimaTutti} disabled={stimo}
            title={puoFabbisogno ? 'Orari e fabbisogno stimati dai dati, solo per i negozi che non li hanno' : 'Orari stimati dai dati, solo per i negozi che non li hanno (il fabbisogno lo decide la direzione, profilo Super Advisor)'}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50">
            <Sparkles size={14} /> {stimo ? 'Stimo…' : 'Stima i negozi vuoti dai dati'}
          </button>
        </div>
      )}

      {sotto === 'eventi' && (
        <EventiNegozi companyId={companyId} negozi={negozi} puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} onSalvato={() => setVersione((v) => v + 1)} />
      )}
      {scelto && sotto === 'mese' && (
        <PianiMensili key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          dati={dati} puoScrivere={puoScrivere} />
      )}
      {scelto && sotto === 'piano' && (
        <PianoTurni key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          dati={dati} puoScrivere={puoScrivere} onVaiOrari={() => setSotto('orari')} />
      )}
      {scelto && sotto === 'orari' && (
        <OrariNegozio key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} oreContratto={oreContratto}
          altriNegozi={negozi.filter((n) => n.id !== scelto.id).map((n) => ({ id: n.id, nome: nomeNegozio(n) }))}
          personeInServizio={persone.filter((p) => p.outletId === negozio && p.stato === 'in_servizio').length} />
      )}
    </div>
  );
}
