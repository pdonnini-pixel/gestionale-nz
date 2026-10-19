// «Turni»: il piano settimanale di ogni negozio e, sotto, gli orari e il
// fabbisogno da cui si parte. Il negozio si sceglie qui; l'organico (chi
// c'e' e con che orario) arriva dall'organico di oggi.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { stimaOrariEFabbisogno } from '../lib/stimaNegozio';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { organicoAllaData, oggiRoma } from '../lib/organico';
import { caricaChiusurePerStima, caricaOrganico, nomeNegozio, puoDecidereFabbisogno, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';
import PianoTurni from './PianoTurni';
import OrariNegozio from './OrariNegozio';

type Props = { companyId?: string };

export default function TurniNegozi({ companyId }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const puoScrivere = puoTenereOrganico(profile?.role);
  const puoFabbisogno = puoDecidereFabbisogno(profile?.role);

  const [dati, setDati] = useState<DatiOrganico | null>(null);
  const [negozio, setNegozio] = useState('');
  const [sotto, setSotto] = useState<'piano' | 'orari'>('piano');
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
  const oreContratto = persone.filter((p) => p.outletId === negozio && p.stato === 'in_servizio').reduce((s, p) => s + (p.ore ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          {negozi.map((n) => (
            <button key={n.id} type="button" onClick={() => setNegozio(n.id)}
              className={`text-sm px-3 py-1.5 rounded-lg border ${negozio === n.id ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}>
              {nomeNegozio(n)} <span className={negozio === n.id ? 'text-slate-300' : 'text-slate-400'}>{n.persone}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {puoScrivere && (
          <button type="button" onClick={stimaTutti} disabled={stimo}
            title={puoFabbisogno ? 'Orari e fabbisogno stimati dai dati, solo per i negozi che non li hanno' : 'Orari stimati dai dati, solo per i negozi che non li hanno (il fabbisogno lo decide la direzione, profilo Super Advisor)'}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
            <Sparkles size={14} /> {stimo ? 'Stimo…' : 'Stima i negozi vuoti dai dati'}
          </button>
        )}
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 w-fit">
          {([{ k: 'piano' as const, label: 'Piano settimanale' }, { k: 'orari' as const, label: 'Orari e fabbisogno' }]).map((t) => (
            <button key={t.k} type="button" onClick={() => setSotto(t.k)}
              className={`text-sm px-3 py-1.5 rounded-md ${sotto === t.k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t.label}</button>
          ))}
        </div>
        </div>
      </div>

      {scelto && sotto === 'piano' && (
        <PianoTurni key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          dati={dati} puoScrivere={puoScrivere} onVaiOrari={() => setSotto('orari')} />
      )}
      {scelto && sotto === 'orari' && (
        <OrariNegozio key={`${scelto.id}-${versione}`} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} oreContratto={oreContratto}
          personeInServizio={persone.filter((p) => p.outletId === negozio && p.stato === 'in_servizio').length} />
      )}
    </div>
  );
}
