// «Servizi negozi» (Patrizio, 26/11/2026, migration 468): scarico merce e pulizie prima
// dell'apertura. Riquadro in fondo alla pagina Turni, accanto a «Regole e orari», «Eventi»,
// «Persone e riposi», «Traffico MODA» e «Trasferte»; stessa grafica delle altre schede.
// Il calendario delle consegne (CalendarioConsegne) lo usa anche la responsabile del negozio
// dalla sua pagina, passando dalle funzioni che controllano i suoi negozi.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useToast } from './Toast';
import { NOMI_GIORNO, hhmm, minuti } from '../lib/turni';
import { aggiungiGiorni, oggiRoma } from '../lib/organico';
import { consegneDelPeriodo, PERSONE_PULIZIE, PERSONE_SCARICO, type ConsegnaCalendario, type ServiziNegozio, type TipoServizio } from '../lib/serviziNegozio';
import { caricaServizi, salvaConsegna, salvaRicorrenti, salvaTetto, togliConsegna } from '../lib/serviziNegozioDb';

const inputCls = 'min-h-[36px] rounded-lg border border-slate-300 px-2 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500';
const btnPiccolo = 'inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50';
const GG = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
/** Quanti giorni avanti mostra il calendario delle consegne. */
export const GIORNI_CALENDARIO = 90;

interface RigaServizio { giorno: number; dalle: string; alle: string; persone: number; dedicate: string[] }
export interface PersonaNegozio { id: string; nome: string }

export function dataBreve(d: string): string {
  const g = new Date(`${d}T00:00:00Z`).getUTCDay();
  return `${GG[g === 0 ? 7 : g]} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
}
function durata(dalle: string, alle: string): string {
  const m = minuti(alle) - minuti(dalle);
  if (m <= 0) return '';
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60}'` : `${m / 60} ${m === 60 ? 'ora' : 'ore'}`;
}

function Interruttore({ acceso, onCambia, etichetta, disabled }: { acceso: boolean; onCambia: (v: boolean) => void; etichetta: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={acceso} aria-label={etichetta} disabled={disabled} onClick={() => onCambia(!acceso)}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${acceso ? 'bg-pink-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${acceso ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

/** Le righe ricorrenti di un tipo (giorno, fascia, persone), con aggiunta e rimozione. */
function RigheServizio({ righe, onCambia, puoScrivere, tipo, persone }: { righe: RigaServizio[]; onCambia: (r: RigaServizio[]) => void; puoScrivere: boolean; tipo: TipoServizio; persone: PersonaNegozio[] }) {
  const liberi = [1, 2, 3, 4, 5, 6, 7].filter((g) => !righe.some((r) => r.giorno === g));
  const cambia = (i: number, x: Partial<RigaServizio>) => onCambia(righe.map((r, j) => (j === i ? { ...r, ...x } : r)));
  return (
    <div className="space-y-2">
      {righe.map((r, i) => (
        <div key={r.giorno} className="flex flex-wrap items-end gap-2 py-2 border-t border-slate-100 text-sm">
          <label className="text-xs text-slate-600">Giorno<br />
            <select disabled={!puoScrivere} className={inputCls} value={r.giorno} onChange={(e) => cambia(i, { giorno: Number(e.target.value) })}>
              {[r.giorno, ...liberi].sort().map((g) => <option key={g} value={g}>{NOMI_GIORNO[g]}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">{tipo === 'scarico' ? 'Arriva alle' : 'Dalle'}<br />
            <input type="time" step={1800} disabled={!puoScrivere} className={inputCls} value={r.dalle} onChange={(e) => cambia(i, { dalle: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">{tipo === 'scarico' ? 'Scarico finito alle' : 'Alle'}<br />
            <input type="time" step={1800} disabled={!puoScrivere} className={inputCls} value={r.alle} onChange={(e) => cambia(i, { alle: e.target.value })} />
          </label>
          <label className="text-xs text-slate-600">Persone<br />
            <input type="number" min={1} max={10} disabled={!puoScrivere} className={`${inputCls} w-16`} value={r.persone} onChange={(e) => cambia(i, { persone: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} />
          </label>
          <span className="text-xs text-slate-500 pb-2">{durata(r.dalle, r.alle)}</span>
          {persone.length > 0 && (
            <div className="basis-full text-xs text-slate-600">
              <span className="mr-1.5">Persone dedicate (il piano le preferisce, se possono esserci):</span>
              {persone.map((pp) => {
                const on = r.dedicate.includes(pp.id);
                return (
                  <button key={pp.id} type="button" disabled={!puoScrivere} aria-pressed={on}
                    onClick={() => cambia(i, { dedicate: on ? r.dedicate.filter((x) => x !== pp.id) : [...r.dedicate, pp.id].sort() })}
                    className={`mr-1 mb-1 px-2 py-0.5 rounded-full border text-xs disabled:opacity-60 ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-300 text-slate-700'}`}>{pp.nome}</button>
                );
              })}
              {r.dedicate.some((id) => !persone.some((pp) => pp.id === id)) && <span className="text-amber-700"> · una persona dedicata non è più in servizio qui</span>}
            </div>
          )}
          {puoScrivere && (
            <button type="button" aria-label={`Togli ${NOMI_GIORNO[r.giorno]}`} onClick={() => onCambia(righe.filter((_, j) => j !== i))} className="p-1.5 rounded hover:bg-slate-100 mb-1"><Trash2 size={14} /></button>
          )}
        </div>
      ))}
      {puoScrivere && liberi.length > 0 && (
        <button type="button" className={btnPiccolo} onClick={() => onCambia([...righe, tipo === 'scarico'
          ? { giorno: liberi[0], dalle: '10:00', alle: '12:00', persone: PERSONE_SCARICO, dedicate: [] }
          : { giorno: liberi[0], dalle: '09:00', alle: '10:00', persone: PERSONE_PULIZIE, dedicate: [] }])}>
          <Plus size={13} /> Aggiungi un giorno
        </button>
      )}
    </div>
  );
}

/**
 * Il calendario delle consegne: le prossime consegne (abituali e del calendario) e il modulo per
 * spostarne, cambiarne o annullarne una. Lo usano il riquadro «Servizi negozi» e la responsabile.
 */
export function CalendarioConsegne({ servizi, dal, al, puoScrivere, onSalva, onTogli, occupato }: {
  servizi: ServiziNegozio; dal: string; al: string; puoScrivere: boolean; occupato?: boolean;
  onSalva: (c: Omit<ConsegnaCalendario, 'id'>) => Promise<void> | void;
  onTogli: (data: string) => Promise<void> | void;
}) {
  const elenco = useMemo(() => consegneDelPeriodo(dal, al, servizi), [dal, al, servizi]);
  const abituale = servizi.ricorrenti.find((r) => r.tipo === 'scarico');
  const vuota = { data: '', dalle: abituale?.dalle ?? '10:00', alle: abituale?.alle ?? '12:00', persone: abituale?.persone ?? PERSONE_SCARICO, annullata: false, nota: '' };
  const [nuova, setNuova] = useState(vuota);
  const aggiungi = async () => {
    if (!nuova.data) return;
    await onSalva({ data: nuova.data, dalle: nuova.dalle, alle: nuova.alle, persone: nuova.persone, annullata: nuova.annullata, nota: nuova.nota || null });
    setNuova(vuota);
  };
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800 mt-4">Calendario delle consegne</h4>
      <p className="text-xs text-slate-500">Il giorno abituale si ripete da solo. Qui si sposta, si cambia d’ora o si annulla la singola consegna; «nessuna consegna» vale anche quando chi consegna ha le chiavi e non serve personale.</p>
      <ul className="divide-y divide-slate-100 text-sm mt-1">
        {elenco.map((x) => (
          <li key={x.data} className="py-2 flex items-center justify-between gap-2">
            <span>
              <strong>{dataBreve(x.data)}</strong>
              {x.finestra
                ? <span className="text-slate-500"> · {hhmm(x.finestra.dalle)}-{hhmm(x.finestra.alle)}, {x.finestra.persone} {x.finestra.persone === 1 ? 'persona' : 'persone'}</span>
                : <span className="text-slate-500"> · nessuna consegna</span>}
              {x.riga?.nota ? <span className="text-slate-500"> · {x.riga.nota}</span> : null}
              {x.abituale
                ? <span className="ml-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-emerald-50 text-emerald-700">abituale</span>
                : x.finestra
                  ? <span className="ml-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700">dal calendario</span>
                  : <span className="ml-1.5 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-slate-100 text-slate-500">annullata</span>}
            </span>
            {puoScrivere && (x.riga
              ? <button type="button" aria-label="Togli la riga del calendario" title="Togli la riga: torna a valere la consegna abituale" disabled={occupato} onClick={() => void onTogli(x.data)} className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-50"><Trash2 size={14} /></button>
              : <button type="button" disabled={occupato} onClick={() => void onSalva({ data: x.data, dalle: null, alle: null, persone: null, annullata: true, nota: null })} className="text-xs text-slate-500 underline disabled:opacity-50">annulla</button>)}
          </li>
        ))}
        {!elenco.length && <li className="py-2 text-slate-400">Nessuna consegna nei prossimi {GIORNI_CALENDARIO} giorni.</li>}
      </ul>
      {puoScrivere && (
        <div className="pt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">Data<br /><input type="date" min={aggiungiGiorni(oggiRoma(), -7)} className={inputCls} value={nuova.data} onChange={(e) => setNuova((s) => ({ ...s, data: e.target.value }))} /></label>
          <label className="text-xs text-slate-600">Arriva alle<br /><input type="time" step={1800} disabled={nuova.annullata} className={inputCls} value={nuova.dalle} onChange={(e) => setNuova((s) => ({ ...s, dalle: e.target.value }))} /></label>
          <label className="text-xs text-slate-600">Finito alle<br /><input type="time" step={1800} disabled={nuova.annullata} className={inputCls} value={nuova.alle} onChange={(e) => setNuova((s) => ({ ...s, alle: e.target.value }))} /></label>
          <label className="text-xs text-slate-600">Persone<br /><input type="number" min={1} max={10} disabled={nuova.annullata} className={`${inputCls} w-16`} value={nuova.persone} onChange={(e) => setNuova((s) => ({ ...s, persone: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))} /></label>
          <label className="text-xs text-slate-600 flex-1 min-w-[140px]">Nota<br /><input className={`${inputCls} w-full`} maxLength={200} value={nuova.nota} placeholder="festivo, carico di Natale…" onChange={(e) => setNuova((s) => ({ ...s, nota: e.target.value }))} /></label>
          <label className="text-xs text-slate-600 flex items-center gap-1 pb-2"><input type="checkbox" checked={nuova.annullata} onChange={(e) => setNuova((s) => ({ ...s, annullata: e.target.checked }))} /> nessuna consegna</label>
          <button type="button" onClick={() => void aggiungi()} disabled={!nuova.data || occupato || (!nuova.annullata && minuti(nuova.alle) <= minuti(nuova.dalle))} className={btnPiccolo}><Plus size={13} /> Aggiungi</button>
        </div>
      )}
    </div>
  );
}

const righeDi = (s: ServiziNegozio | null, tipo: TipoServizio): RigaServizio[] =>
  (s?.ricorrenti ?? []).filter((r) => r.tipo === tipo).map(({ giorno, dalle, alle, persone, dedicate }) => ({ giorno, dalle, alle, persone, dedicate: [...(dedicate ?? [])].sort() })).sort((a, b) => a.giorno - b.giorno);

export default function ServiziNegozi({ companyId, outletId, nomeNegozio, puoScrivere, persone = [] }: { companyId?: string; outletId: string; nomeNegozio: string; puoScrivere: boolean; persone?: PersonaNegozio[] }) {
  const { toast } = useToast();
  const dal = oggiRoma();
  const al = aggiungiGiorni(dal, GIORNI_CALENDARIO);
  const [servizi, setServizi] = useState<ServiziNegozio | null>(null);
  const [mancano, setMancano] = useState(false);
  const [scarico, setScarico] = useState<RigaServizio[]>([]);
  const [pulizie, setPulizie] = useState<RigaServizio[]>([]);
  const [riceve, setRiceve] = useState(false);
  const [fa, setFa] = useState(false);
  const [tetto, setTetto] = useState<{ persone: number; giorni: number[] } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carica = useCallback(async () => {
    let s: ServiziNegozio | null;
    try { s = await caricaServizi(outletId, aggiungiGiorni(dal, -7), al); }
    catch (e) { toast({ type: 'error', message: `Servizi non caricati: ${e instanceof Error ? e.message : 'errore'}` }); return; }
    if (!s) { setMancano(true); return; }
    setMancano(false);
    setServizi(s);
    setScarico(righeDi(s, 'scarico')); setRiceve(righeDi(s, 'scarico').length > 0);
    setPulizie(righeDi(s, 'pulizie')); setFa(righeDi(s, 'pulizie').length > 0);
    setTetto(s.tetto ? { persone: s.tetto.persone, giorni: [...s.tetto.giorni].sort() } : null);
  }, [outletId, dal, al, toast]);
  useEffect(() => { void carica(); }, [carica]);

  const errori = (r: RigaServizio[]) => r.filter((x) => minuti(x.alle) <= minuti(x.dalle)).map((x) => NOMI_GIORNO[x.giorno]);
  const cambiato = !!servizi && (JSON.stringify(riceve ? scarico : []) !== JSON.stringify(righeDi(servizi, 'scarico'))
    || JSON.stringify(fa ? pulizie : []) !== JSON.stringify(righeDi(servizi, 'pulizie'))
    || JSON.stringify(tetto?.giorni.length ? tetto : null) !== JSON.stringify(servizi.tetto ? { persone: servizi.tetto.persone, giorni: [...servizi.tetto.giorni].sort() } : null));

  const salva = async () => {
    if (!companyId) return;
    const sbagliati = [...errori(riceve ? scarico : []), ...errori(fa ? pulizie : [])];
    if (sbagliati.length) { toast({ type: 'error', message: `L’ora di fine deve venire dopo quella di inizio: ${sbagliati.join(', ')}.` }); return; }
    setSalvando(true);
    try {
      await salvaRicorrenti(companyId, outletId, 'scarico', riceve ? scarico : []);
      await salvaRicorrenti(companyId, outletId, 'pulizie', fa ? pulizie : []);
      await salvaTetto(companyId, outletId, tetto?.giorni.length ? tetto : null);
      toast({ type: 'success', message: `Servizi di ${nomeNegozio} salvati. Valgono dai prossimi turni proposti dal sistema.` });
      await carica();
    } catch (e) {
      toast({ type: 'error', message: `Servizi non salvati: ${e instanceof Error ? e.message : 'errore'}` });
    } finally { setSalvando(false); }
  };

  const conCalendario = async (fai: () => Promise<void>, ok: string) => {
    setSalvando(true);
    try { await fai(); toast({ type: 'success', message: ok }); await carica(); }
    catch (e) { toast({ type: 'error', message: `Calendario non aggiornato: ${e instanceof Error ? e.message : 'errore'}` }); }
    finally { setSalvando(false); }
  };

  if (mancano) {
    return <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-500">I servizi del negozio non sono ancora disponibili su questo gestionale.</div>;
  }
  if (!servizi) return <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-400">Carico…</div>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Servizi negozi di {nomeNegozio}</h2>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <section className="bg-white border border-slate-200 rounded-xl p-4 min-w-0" aria-label="Scarico merce">
          <h2 className="text-base font-semibold text-slate-900">Scarico merce</h2>
          <p className="text-xs text-slate-500 mb-3">Quando arriva la merce. Durante lo scarico in negozio servono almeno quelle persone: se i turni le hanno già non si aggiunge niente, altrimenti la regola le mette, sopra MODA e sopra le fasce. Se la consegna cade all’apertura servono dall’apertura.</p>
          <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-100 text-sm">
            <span className="text-slate-700">Il negozio riceve la merce</span>
            <Interruttore acceso={riceve} disabled={!puoScrivere} etichetta="Il negozio riceve la merce" onCambia={(v) => {
              setRiceve(v);
              if (v && !scarico.length) setScarico([{ giorno: 2, dalle: '10:00', alle: '12:00', persone: PERSONE_SCARICO, dedicate: [] }]);
            }} />
          </div>
          {riceve && (
            <>
              <h4 className="text-sm font-semibold text-slate-800 mt-2">Consegna abituale</h4>
              <RigheServizio righe={scarico} onCambia={setScarico} puoScrivere={puoScrivere} tipo="scarico" persone={persone} />
              <CalendarioConsegne servizi={servizi} dal={dal} al={al} puoScrivere={puoScrivere} occupato={salvando}
                onSalva={(c) => companyId ? conCalendario(() => salvaConsegna(companyId, outletId, c), `Consegna del ${dataBreve(c.data)} salvata.`) : undefined}
                onTogli={(d) => conCalendario(() => togliConsegna(outletId, d), `Riga del ${dataBreve(d)} tolta: vale la consegna abituale.`)} />
            </>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4 min-w-0" aria-label="Pulizie prima dell’apertura">
          <h2 className="text-base font-semibold text-slate-900">Pulizie prima dell’apertura</h2>
          <p className="text-xs text-slate-500 mb-3">Il negozio apre per le pulizie, non per la vendita. Sono ore di lavoro e di contratto: il primo turno di quei giorni comincia prima. Non contano nelle ore sotto MODA.</p>
          <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-100 text-sm">
            <span className="text-slate-700">Il negozio fa le pulizie prima di aprire</span>
            <Interruttore acceso={fa} disabled={!puoScrivere} etichetta="Il negozio fa le pulizie prima di aprire" onCambia={(v) => {
              setFa(v);
              if (v && !pulizie.length) setPulizie([{ giorno: 1, dalle: '09:00', alle: '10:00', persone: PERSONE_PULIZIE, dedicate: [] }]);
            }} />
          </div>
          {fa && <RigheServizio righe={pulizie} onCambia={setPulizie} puoScrivere={puoScrivere} tipo="pulizie" persone={persone} />}
          {fa && pulizie.length > 0 && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 text-blue-900 p-3 text-xs mt-3">
              {pulizie.map((p) => `${NOMI_GIORNO[p.giorno]} dalle ${p.dalle}`).join(', ')}: chi apre fa {pulizie.length === 1 ? 'quel giorno' : 'quei giorni'} le ore delle pulizie in più, che entrano nelle ore della settimana.
            </div>
          )}
        </section>
        <section className="bg-white border border-slate-200 rounded-xl p-4 min-w-0" aria-label="Persone nella giornata">
          <h2 className="text-base font-semibold text-slate-900">Persone nella giornata</h2>
          <p className="text-xs text-slate-500 mb-3">Al massimo tante persone diverse nella giornata: il piano preferisce un turno lungo a due turni corti. Non vale nei giorni caldi, nei festivi, negli eventi e nel lunedì a due persone. Se con queste persone le ore di contratto non bastano, il tetto cede: nei feriali niente straordinari.</p>
          <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-100 text-sm">
            <span className="text-slate-700">Tetto di persone nella giornata</span>
            <Interruttore acceso={!!tetto} disabled={!puoScrivere} etichetta="Tetto di persone nella giornata"
              onCambia={(v) => setTetto(v ? { persone: 2, giorni: [2, 3, 4, 5] } : null)} />
          </div>
          {tetto && (
            <>
              <div className="flex items-center justify-between gap-3 py-2 border-t border-slate-100 text-sm">
                <span className="text-slate-700">Al massimo</span>
                <span className="flex items-center gap-1.5">
                  <input type="number" min={2} max={10} disabled={!puoScrivere} aria-label="Persone al massimo" className={`${inputCls} w-16`} value={tetto.persone}
                    onChange={(e) => setTetto((t) => (t ? { ...t, persone: Math.max(2, Math.min(10, Number(e.target.value) || 2)) } : t))} />
                  <span className="text-slate-600">persone diverse</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-t border-slate-100 text-sm">
                <span className="text-slate-700">Nei giorni</span>
                <span className="flex flex-wrap gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map((g) => {
                    const on = tetto.giorni.includes(g);
                    return (
                      <button key={g} type="button" disabled={!puoScrivere} aria-pressed={on}
                        onClick={() => setTetto((t) => (t ? { ...t, giorni: (on ? t.giorni.filter((x) => x !== g) : [...t.giorni, g]).sort() } : t))}
                        className={`px-2.5 py-1 rounded-lg border text-xs disabled:opacity-60 ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-300 text-slate-700'}`}>{GG[g]}</button>
                    );
                  })}
                </span>
              </div>
              {!tetto.giorni.length && <p className="text-xs text-amber-700">Scegli almeno un giorno, altrimenti il tetto non vale.</p>}
            </>
          )}
        </section>
      </div>
      {puoScrivere && (
        <div className="flex items-center justify-end gap-3">
          {cambiato && <span className="text-sm text-amber-700">Modifiche non salvate</span>}
          <button type="button" onClick={() => void salva()} disabled={salvando || !cambiato}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"><Save size={16} /> {salvando ? 'Salvo…' : 'Salva'}</button>
        </div>
      )}
    </div>
  );
}
