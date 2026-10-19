// «Turni»: il piano settimanale di ogni negozio e, sotto, gli orari e il
// fabbisogno da cui si parte. Il negozio si sceglie qui; l'organico (chi
// c'e' e con che orario) arriva dall'organico di oggi.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { organicoAllaData, oggiRoma } from '../lib/organico';
import { caricaOrganico, nomeNegozio, puoDecidereFabbisogno, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';
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
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 w-fit">
          {([{ k: 'piano' as const, label: 'Piano settimanale' }, { k: 'orari' as const, label: 'Orari e fabbisogno' }]).map((t) => (
            <button key={t.k} type="button" onClick={() => setSotto(t.k)}
              className={`text-sm px-3 py-1.5 rounded-md ${sotto === t.k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{t.label}</button>
          ))}
        </div>
      </div>

      {scelto && sotto === 'piano' && (
        <PianoTurni key={scelto.id} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          dati={dati} puoScrivere={puoScrivere} onVaiOrari={() => setSotto('orari')} />
      )}
      {scelto && sotto === 'orari' && (
        <OrariNegozio key={scelto.id} companyId={companyId} outletId={scelto.id} nomeNegozio={nomeNegozio(scelto)}
          puoScrivere={puoScrivere} puoFabbisogno={puoFabbisogno} oreContratto={oreContratto} />
      )}
    </div>
  );
}
