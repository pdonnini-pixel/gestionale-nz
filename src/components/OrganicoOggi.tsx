// «Organico di oggi»: chi lavora davvero in azienda, negozio per negozio.
//
// Parte dall'anagrafica (i documenti dello studio paghe) e ci aggiunge i
// cambiamenti segnati da chi tiene l'organico (organico.ts). Qui si vede lo
// stato di ognuno, le decisioni da prendere (contratti scaduti o in
// scadenza) e si segna un cambiamento. La seconda scheda confronta i
// cambiamenti con i documenti dello studio (ConfrontoStudio).

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Plus, Search, UserPlus } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import {
  organicoAllaData, decisioniDaPrendere, contaNellOrganico, formattaDataBreve, nomePersona, oggiRoma,
  descriviEvento, ETICHETTE_STATO_OGGI, type PersonaOggi, type TipoEvento,
} from '../lib/organico';
import { caricaOrganico, nomeNegozio, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';
import SegnaCambiamento from './SegnaCambiamento';

const ConfrontoStudio = lazy(() => import('./ConfrontoStudio'));

type Props = { companyId?: string };

const COLORE_STATO: Record<string, string> = {
  in_servizio: 'bg-emerald-50 text-emerald-800',
  assente: 'bg-slate-100 text-slate-700',
  scaduto: 'bg-amber-100 text-amber-900',
  cessato: 'bg-slate-100 text-slate-500',
  non_ancora_assunto: 'bg-blue-50 text-blue-800',
};

function etichettaContratto(p: PersonaOggi): string {
  const c = p.contratto === 'indeterminato' ? 'Indeterminato'
    : p.contratto === 'determinato' ? 'Determinato'
    : p.contratto && /chiamata/.test(p.contratto) ? 'A chiamata'
    : p.contratto ?? 'Contratto non indicato';
  const liv = p.scheda.livello ? ` · ${p.scheda.livello.replace(/\s*Livello/i, '° liv.')}` : '';
  return c + liv;
}

function statoTesto(p: PersonaOggi): string {
  if (p.stato === 'assente' && p.assenza) return `${p.assenza.motivo ? p.assenza.motivo.charAt(0).toUpperCase() + p.assenza.motivo.slice(1) : 'Assente'} dal ${formattaDataBreve(p.assenza.dal)}`;
  if (p.stato === 'scaduto') return `Scaduto il ${formattaDataBreve(p.scadenza)}: deciso?`;
  if (p.stato === 'cessato' && p.ultimoGiorno) return `Uscita il ${formattaDataBreve(p.ultimoGiorno)}`;
  if (p.stato === 'in_servizio' && p.giorniAllaScadenza != null && p.giorniAllaScadenza <= 30 && !p.ultimoGiorno) return `Scade il ${formattaDataBreve(p.scadenza)}`;
  if (p.stato === 'in_servizio' && p.ultimoGiorno) return `Ultimo giorno ${formattaDataBreve(p.ultimoGiorno)}`;
  if (p.stato === 'non_ancora_assunto') return `Entra il ${formattaDataBreve(p.scheda.data_assunzione)}`;
  return ETICHETTE_STATO_OGGI[p.stato];
}

function prossimaData(p: PersonaOggi): string {
  if (p.assenza?.rientro) return `rientro previsto ${formattaDataBreve(p.assenza.rientro)}`;
  if (p.prossimi.length) return descriviEvento(p.prossimi[0]);
  if (p.scadenza && p.stato !== 'cessato') return `scadenza ${formattaDataBreve(p.scadenza)}`;
  return '';
}

export default function OrganicoOggi({ companyId }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const puoScrivere = puoTenereOrganico(profile?.role);

  const [sotto, setSotto] = useState<'organico' | 'confronto'>('organico');
  const [dati, setDati] = useState<DatiOrganico | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [data, setData] = useState(oggiRoma());
  const [filtroNegozio, setFiltroNegozio] = useState('');
  const [cerca, setCerca] = useState('');
  const [mostraUsciti, setMostraUsciti] = useState(false);
  const [modale, setModale] = useState<{ employeeId?: string | null; tipo?: TipoEvento | null; nuova?: boolean } | null>(null);

  const carica = useCallback(async () => {
    if (!companyId) return;
    setCaricamento(true);
    try {
      // Prima si chiudono i cambiamenti che lo studio ha gia' confermato.
      if (puoScrivere) await supabase.rpc('organico_riconcilia');
      setDati(await caricaOrganico(companyId));
    } catch (e) {
      toast({ type: 'error', message: `Organico non caricato: ${e instanceof Error ? e.message : 'errore'}` });
    } finally {
      setCaricamento(false);
    }
  }, [companyId, puoScrivere, toast]);

  useEffect(() => { carica(); }, [carica]);

  const persone = useMemo(() => (dati ? organicoAllaData(dati.schede, dati.eventi, data) : []), [dati, data]);
  const negozioDi = useCallback((id: string | null) => dati?.negozi.find((n) => n.id === id), [dati]);

  const visibili = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return persone
      .filter((p) => mostraUsciti ? true : (contaNellOrganico(p) || p.stato === 'non_ancora_assunto'))
      .filter((p) => !filtroNegozio || p.outletId === filtroNegozio)
      .filter((p) => !q || nomePersona(p.scheda).toLowerCase().includes(q) || (p.scheda.matricola ?? '').includes(q));
  }, [persone, cerca, filtroNegozio, mostraUsciti]);

  const gruppi = useMemo(() => {
    const m = new Map<string, PersonaOggi[]>();
    for (const p of visibili) {
      const k = p.outletId ?? '';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return [...m.entries()]
      .map(([k, lista]) => ({
        id: k,
        nome: nomeNegozio(negozioDi(k || null)),
        lista: lista.sort((a, b) => nomePersona(a.scheda).localeCompare(nomePersona(b.scheda), 'it')),
      }))
      .sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.nome.localeCompare(b.nome, 'it'));
  }, [visibili, negozioDi]);

  const nelOrganico = persone.filter(contaNellOrganico);
  const inServizio = persone.filter((p) => p.stato === 'in_servizio');
  const oreSettimana = inServizio.reduce((s, p) => s + (p.ore ?? 0), 0);
  const assenti = persone.filter((p) => p.stato === 'assente');
  const decisioni = decisioniDaPrendere(persone, 30);
  const daConfermare = (dati?.eventi ?? []).filter((e) => e.stato === 'da_confermare');
  const negoziConPersone = (dati?.negozi ?? []).filter((n) => nelOrganico.some((p) => p.outletId === n.id) || n.is_active);

  if (!companyId) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 w-fit">
          {([
            { k: 'organico' as const, label: 'Organico' },
            { k: 'confronto' as const, label: `Confronto con lo studio${daConfermare.length ? ` (${daConfermare.length})` : ''}` },
          ]).map((t) => (
            <button key={t.k} type="button" onClick={() => setSotto(t.k)}
              className={`text-sm px-3 py-1.5 rounded-md ${sotto === t.k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {puoScrivere && sotto === 'organico' && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setModale({ nuova: true })}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-slate-300 bg-white text-sm font-medium hover:bg-slate-50">
              <UserPlus size={15} /> Aggiungi una persona
            </button>
            <button type="button" onClick={() => setModale({})}
              className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700">
              <Plus size={15} /> Segna un cambiamento
            </button>
          </div>
        )}
      </div>

      {sotto === 'confronto' ? (
        <Suspense fallback={<div className="text-slate-400 py-12 text-center">Caricamento…</div>}>
          <ConfrontoStudio companyId={companyId} dati={dati} onCambiato={carica} />
        </Suspense>
      ) : caricamento && !dati ? (
        <div className="text-slate-400 py-12 text-center">Caricamento…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Al lavoro {data === oggiRoma() ? 'oggi' : `il ${formattaDataBreve(data)}`}</div>
              <div className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">{inServizio.length}</div>
              <div className="text-xs text-slate-500">{oreSettimana.toLocaleString('it-IT')} ore a settimana</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Assenti per un periodo</div>
              <div className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">{assenti.length}</div>
              <div className="text-xs text-slate-500">maternità, malattia lunga, aspettativa</div>
            </div>
            <div className={`rounded-xl p-4 border ${decisioni.length ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
              <div className={`text-xs ${decisioni.length ? 'text-amber-900' : 'text-slate-500'}`}>Contratti da decidere (entro 30 giorni)</div>
              <div className={`text-2xl font-semibold mt-1 tabular-nums ${decisioni.length ? 'text-amber-900' : 'text-slate-900'}`}>{decisioni.length}</div>
              <div className={`text-xs ${decisioni.length ? 'text-amber-900' : 'text-slate-500'}`}>scaduti o in scadenza: proroga o no</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs text-slate-500">Da confermare con lo studio</div>
              <div className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">{daConfermare.length}</div>
              <button type="button" onClick={() => setSotto('confronto')} className="text-xs text-blue-700 hover:underline">Apri il confronto</button>
            </div>
          </div>

          <div className="flex flex-col xl:flex-row gap-4 items-start">
            <section className="flex-1 min-w-0 w-full bg-white border border-slate-200 rounded-xl">
              <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
                <button type="button" onClick={() => setFiltroNegozio('')}
                  className={`text-sm px-3 py-1.5 rounded-lg border ${!filtroNegozio ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}>
                  Tutti i negozi
                </button>
                {negoziConPersone.map((n) => (
                  <button key={n.id} type="button" onClick={() => setFiltroNegozio(n.id)}
                    className={`text-sm px-3 py-1.5 rounded-lg border ${filtroNegozio === n.id ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}>
                    {nomeNegozio(n)}
                  </button>
                ))}
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <label className="text-sm text-slate-600 flex items-center gap-1.5">
                    Alla data
                    <input type="date" value={data} onChange={(e) => e.target.value && setData(e.target.value)}
                      className="min-h-[36px] rounded-lg border border-slate-300 px-2 text-sm" />
                  </label>
                  <label className="relative">
                    <span className="sr-only">Cerca</span>
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="search" value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Nome o matricola"
                      className="min-h-[36px] w-44 rounded-lg border border-slate-300 pl-8 pr-2 text-sm" />
                  </label>
                  <label className="text-sm text-slate-600 flex items-center gap-1.5">
                    <input type="checkbox" checked={mostraUsciti} onChange={(e) => setMostraUsciti(e.target.checked)} />
                    anche chi non è più in forza
                  </label>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                      <th className="px-3 py-2 font-semibold">Persona</th>
                      <th className="px-3 py-2 font-semibold">Contratto</th>
                      <th className="px-3 py-2 font-semibold text-right">Ore</th>
                      <th className="px-3 py-2 font-semibold">Stato</th>
                      <th className="px-3 py-2 font-semibold">Prossima data</th>
                      <th className="px-3 py-2"><span className="sr-only">Azioni</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {gruppi.map((g) => (
                      <GruppoNegozio key={g.id || 'senza'} nome={g.nome} lista={g.lista} puoScrivere={puoScrivere}
                        onModifica={(id, tipo) => setModale({ employeeId: id, tipo })} />
                    ))}
                    {!gruppi.length && (
                      <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-400">Nessuna persona con questi filtri.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="w-full xl:w-80 shrink-0 space-y-3">
              <section className="bg-white border border-slate-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-1.5"><CalendarClock size={15} /> Da decidere</h3>
                {decisioni.length === 0 ? (
                  <p className="text-sm text-slate-500">Nessun contratto scaduto o in scadenza nei prossimi 30 giorni.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {decisioni.map((d) => (
                      <li key={d.persona.scheda.id} className="flex items-start justify-between gap-2 text-sm">
                        <span>
                          <span className="font-medium text-slate-800">{nomePersona(d.persona.scheda)}</span>
                          <span className="text-slate-500"> · {nomeNegozio(negozioDi(d.persona.outletId))}</span>
                          <span className={`block text-xs ${d.motivo === 'scaduto' ? 'text-amber-800' : 'text-slate-500'}`}>{d.testo}</span>
                        </span>
                        {puoScrivere && (
                          <button type="button" onClick={() => setModale({ employeeId: d.persona.scheda.id, tipo: 'proroga' })}
                            className="shrink-0 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">Decidi</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {assenti.length > 0 && (
                <section className="bg-white border border-slate-200 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-slate-800 mb-2">Assenti per un periodo</h3>
                  <ul className="space-y-1.5 text-sm">
                    {assenti.map((p) => (
                      <li key={p.scheda.id}>
                        <span className="font-medium">{nomePersona(p.scheda)}</span>
                        <span className="text-slate-500"> · {statoTesto(p)}{p.assenza?.rientro ? `, rientro ${formattaDataBreve(p.assenza.rientro)}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {!puoScrivere && (
                <p className="text-xs text-slate-500 flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  Puoi consultare l'organico. Lo aggiornano i profili contabilità o superiori.</p>
              )}
            </aside>
          </div>
        </>
      )}

      {modale && dati && (
        <SegnaCambiamento
          open
          onClose={() => setModale(null)}
          onSalvato={carica}
          companyId={companyId}
          persone={persone}
          negozi={dati.negozi}
          employeeId={modale.employeeId}
          tipoIniziale={modale.tipo}
          nuovaPersona={modale.nuova}
        />
      )}
    </div>
  );
}

function GruppoNegozio({ nome, lista, puoScrivere, onModifica }: {
  nome: string; lista: PersonaOggi[]; puoScrivere: boolean; onModifica: (id: string, tipo: TipoEvento | null) => void;
}) {
  const ore = lista.filter((p) => p.stato === 'in_servizio').reduce((s, p) => s + (p.ore ?? 0), 0);
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={6} className="px-3 py-2 text-xs font-bold text-slate-600 uppercase tracking-wide">
          {nome} · {lista.length} {lista.length === 1 ? 'persona' : 'persone'} · {ore.toLocaleString('it-IT')} ore in servizio
        </td>
      </tr>
      {lista.map((p) => (
        <tr key={p.scheda.id} className="border-b border-slate-100">
          <td className="px-3 py-2.5">
            <div className="font-medium text-slate-900">{nomePersona(p.scheda)}</div>
            {p.daConfermare.length > 0 && (
              <div className="text-xs text-blue-700">{p.daConfermare.length === 1 ? '1 cambiamento' : `${p.daConfermare.length} cambiamenti`} da confermare con lo studio</div>
            )}
          </td>
          <td className="px-3 py-2.5 text-slate-700">{etichettaContratto(p)}</td>
          <td className="px-3 py-2.5 text-right tabular-nums">{p.ore ?? '—'}</td>
          <td className="px-3 py-2.5">
            <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${p.stato === 'in_servizio' && p.giorniAllaScadenza != null && p.giorniAllaScadenza <= 30 && !p.ultimoGiorno ? COLORE_STATO.scaduto : COLORE_STATO[p.stato] ?? ''}`}>
              {statoTesto(p)}
            </span>
          </td>
          <td className="px-3 py-2.5 text-slate-600 text-xs">{prossimaData(p)}</td>
          <td className="px-3 py-2.5 text-right">
            {puoScrivere && p.stato !== 'cessato' && (
              <button type="button" onClick={() => onModifica(p.scheda.id, p.stato === 'scaduto' ? 'proroga' : null)}
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">
                {p.stato === 'scaduto' ? 'Decidi' : 'Segna'}
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
