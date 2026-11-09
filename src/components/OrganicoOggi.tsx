// «Organico»: chi lavora davvero in azienda, negozio per negozio. E' la
// scheda unica del personale (Patrizio, 03/11/2026): ha preso il posto della
// vecchia anagrafica «Organico». Dal nome si apre la scheda del dipendente
// (documenti, ripartizione, cessazione); «Modifica» corregge i dati; costi e
// cedolini stanno in «Costi & cedolini».
//
// Parte dall'anagrafica (i documenti dello studio paghe) e ci aggiunge i
// cambiamenti segnati da chi tiene l'organico (organico.ts). Qui si vede lo
// stato di ognuno, le decisioni da prendere (contratti scaduti o in
// scadenza) e si segna un cambiamento. La seconda scheda confronta i
// cambiamenti con i documenti dello studio (ConfrontoStudio).

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, FileUp, Plus, Search, UserPlus, UserRound } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import { sqlNull } from '../lib/sqlNull';
import {
  organicoAllaData, decisioniDaPrendere, contaNellOrganico, formattaDataBreve, nomePersona, oggiRoma,
  descriviEvento, ETICHETTE_STATO_OGGI, type PersonaOggi, type TipoEvento,
} from '../lib/organico';
import { caricaOrganico, nomeNegozio, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';
import SegnaCambiamento from './SegnaCambiamento';
import CorreggiPersona from './CorreggiPersona';

const ConfrontoStudio = lazy(() => import('./ConfrontoStudio'));

type Props = {
  companyId?: string;
  /** cresce quando la pagina ha salvato qualcosa: si ricarica */
  versione?: number;
  /** cresce quando la pagina chiede «Aggiungi una persona» */
  richiestaNuova?: number;
  /** la pagina chiede «Modifica» per una persona (dalla sua scheda) */
  richiestaModifica?: { id: string; n: number } | null;
  /** apre la scheda del dipendente (documenti, ripartizione, cessazione) */
  onScheda?: (employeeId: string) => void;
  /** apre tutti i dati dell'anagrafica (solo chi scrive l'anagrafica) */
  onAltriDati?: (employeeId: string) => void;
  /** carica l'elenco dipendenti mandato dallo studio (solo chi scrive l'anagrafica) */
  onImportElenco?: () => void;
  /** la richiesta (nuova o modifica) e' stata aperta: la pagina la azzera,
   *  cosi' tornando sulla scheda non si riapre da sola */
  onRichiestaGestita?: () => void;
};

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

export default function OrganicoOggi({ companyId, versione = 0, richiestaNuova = 0, richiestaModifica = null, onScheda, onAltriDati, onImportElenco, onRichiestaGestita }: Props) {
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
  const [daCorreggere, setDaCorreggere] = useState<string | null>(null);

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

  useEffect(() => { carica(); }, [carica, versione]);
  useEffect(() => {
    if (richiestaNuova > 0 && puoScrivere) { setSotto('organico'); setModale({ nuova: true }); onRichiestaGestita?.(); }
  }, [richiestaNuova, puoScrivere, onRichiestaGestita]);
  useEffect(() => {
    if (richiestaModifica && puoScrivere) { setSotto('organico'); setDaCorreggere(richiestaModifica.id); onRichiestaGestita?.(); }
  }, [richiestaModifica, puoScrivere, onRichiestaGestita]);

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

  // Responsabile del negozio (outlets.referente_employee_id, storico nella
  // 337): si sceglie fra chi lavora nel negozio a quella data. Lo leggono anche
  // Turni, Utenti (account di cassa) e il modulo ferie, quindi cambiandolo qui
  // si aggiorna dappertutto.
  const responsabileDi = useCallback((outletId: string): InfoResponsabile => {
    const negozio = negozioDi(outletId);
    const id = negozio?.referente_employee_id ?? null;
    const persona = id ? persone.find((p) => p.scheda.id === id) : undefined;
    const candidati = persone
      .filter((p) => p.outletId === outletId && (p.stato === 'in_servizio' || p.stato === 'non_ancora_assunto' || p.stato === 'assente'))
      .map((p) => ({ id: p.scheda.id, nome: nomePersona(p.scheda) }));
    if (persona && !candidati.some((c) => c.id === persona.scheda.id)) candidati.push({ id: persona.scheda.id, nome: nomePersona(persona.scheda) });
    candidati.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
    // Non c'e' piu' se e' uscito o se ora lavora in un altro negozio.
    const nonCePiu = !!persona && (!contaNellOrganico(persona) || persona.outletId !== outletId);
    return { id, nome: persona ? nomePersona(persona.scheda) : null, dal: dati?.responsabileDal?.[outletId] ?? null, candidati, nonCePiu };
  }, [negozioDi, persone, dati]);

  const impostaResponsabile = async (outletId: string, employeeId: string) => {
    const { error } = await supabase.rpc('organico_imposta_referente_dal', {
      p_outlet_id: outletId, p_employee_id: sqlNull(employeeId || null), p_dal: oggiRoma(),
    });
    if (error) { toast({ type: 'error', message: `Responsabile non salvato: ${error.message}` }); return; }
    const n = nomeNegozio(negozioDi(outletId));
    const chi = employeeId ? persone.find((p) => p.scheda.id === employeeId) : undefined;
    toast({ type: 'success', message: chi ? `${nomePersona(chi.scheda)} è responsabile di ${n} da oggi.` : `${n} è senza responsabile da oggi.` });
    await carica();
  };

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
        {sotto === 'confronto' && onImportElenco && (
          <button type="button" onClick={onImportElenco}
            title="Carica l'elenco dipendenti mandato dallo studio paghe e allinea l'anagrafica"
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg border border-blue-200 bg-white text-sm font-medium text-blue-700 hover:bg-blue-50">
            <FileUp size={15} /> Elenco dello studio
          </button>
        )}
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
                        responsabile={g.id ? responsabileDi(g.id) : null}
                        onResponsabile={g.id ? (empId) => impostaResponsabile(g.id, empId) : undefined}
                        onModifica={(id, tipo) => setModale({ employeeId: id, tipo })} onCorreggi={setDaCorreggere} onScheda={onScheda} />
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

      {daCorreggere && dati && (() => {
        const p = persone.find((x) => x.scheda.id === daCorreggere);
        return p ? (
          <CorreggiPersona
            onClose={() => setDaCorreggere(null)}
            onSalvato={carica}
            persona={p}
            eventi={dati.eventi}
            negozi={dati.negozi}
            onAltriDati={onAltriDati ? () => { setDaCorreggere(null); onAltriDati(p.scheda.id); } : undefined}
          />
        ) : null;
      })()}
    </div>
  );
}

type InfoResponsabile = {
  id: string | null;
  nome: string | null;
  /** da quando lo e' (storico 337) */
  dal: string | null;
  candidati: { id: string; nome: string }[];
  /** il responsabile segnato e' uscito o lavora in un altro negozio */
  nonCePiu: boolean;
};

function GruppoNegozio({ nome, lista, puoScrivere, responsabile, onResponsabile, onModifica, onCorreggi, onScheda }: {
  nome: string; lista: PersonaOggi[]; puoScrivere: boolean;
  responsabile: InfoResponsabile | null; onResponsabile?: (employeeId: string) => void;
  onModifica: (id: string, tipo: TipoEvento | null) => void;
  onCorreggi: (id: string) => void; onScheda?: (id: string) => void;
}) {
  const ore = lista.filter((p) => p.stato === 'in_servizio').reduce((s, p) => s + (p.ore ?? 0), 0);
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={6} className="px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
              {nome} · {lista.length} {lista.length === 1 ? 'persona' : 'persone'} · {ore.toLocaleString('it-IT')} ore in servizio
            </span>
            {responsabile && (
              <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <UserRound size={14} className="text-slate-400" />
                <span>Responsabile</span>
                {puoScrivere && onResponsabile ? (
                  <select aria-label={`Responsabile di ${nome}`} value={responsabile.id ?? ''} onChange={(e) => onResponsabile(e.target.value)}
                    className="min-h-[32px] rounded-lg border border-slate-300 px-2 text-xs bg-white text-slate-800">
                    <option value="">nessuno</option>
                    {responsabile.candidati.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                ) : (
                  <strong className="text-slate-800">{responsabile.nome ?? 'nessuno'}</strong>
                )}
                {responsabile.id && responsabile.dal && !responsabile.nonCePiu && (
                  <span className="text-slate-400">dal {formattaDataBreve(responsabile.dal)}</span>
                )}
                {responsabile.nonCePiu && (
                  <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                    <AlertTriangle size={12} /> non lavora più qui: scegli il nuovo
                  </span>
                )}
                {!responsabile.id && (
                  <span className="text-amber-700">da scegliere</span>
                )}
              </span>
            )}
          </div>
        </td>
      </tr>
      {lista.map((p) => (
        <tr key={p.scheda.id} className="border-b border-slate-100">
          <td className="px-3 py-2.5">
            {onScheda ? (
              <button type="button" onClick={() => onScheda(p.scheda.id)} title="Apri la scheda: documenti, ripartizione, cessazione"
                className="font-medium text-slate-900 hover:text-blue-700 hover:underline text-left">{nomePersona(p.scheda)}</button>
            ) : (
              <div className="font-medium text-slate-900">{nomePersona(p.scheda)}</div>
            )}
            {responsabile?.id === p.scheda.id && (
              <span className="inline-block mt-0.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">Responsabile</span>
            )}
            {p.scheda.matricola && <div className="text-[11px] text-slate-400 tabular-nums">matr. {p.scheda.matricola}</div>}
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
            {puoScrivere && (
              <span className="inline-flex flex-wrap justify-end gap-1.5">
                <button type="button" onClick={() => onCorreggi(p.scheda.id)}
                  title="Correggi i dati: nome, livello e, finché lo studio non manda i documenti, negozio, contratto, ore e date"
                  className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">
                  Modifica
                </button>
                {p.stato !== 'cessato' && (
                  <button type="button" onClick={() => onModifica(p.scheda.id, p.stato === 'scaduto' ? 'proroga' : null)}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">
                    {p.stato === 'scaduto' ? 'Decidi' : 'Segna'}
                  </button>
                )}
              </span>
            )}
          </td>
        </tr>
      ))}
    </>
  );
}
