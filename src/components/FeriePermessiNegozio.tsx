// Scheda 9 di «Regole e orari»: ferie e permessi del negozio (Patrizio, 12/11/2026).
//
// Chi approva (referente del negozio, HR, tutte e due; ne basta una o servono entrambe), in quali
// giorni si possono chiedere dall'app, evento per evento, e chi e' HR (elenco che cambia solo il
// Super Advisor). Il blocco vero lo fa il database (migration 407): qui si scelgono le regole.
// Finche' la scheda non e' salvata il negozio si comporta come prima; dove la migration manca la
// scheda non compare.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Save, UserPlus, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import {
  aggiungiHr, caricaEventi, caricaHr, caricaRegoleFerie, salvaFerieEvento, salvaRegoleFerie, togliHr,
} from '../lib/regoleNuoveDb';
import {
  ammesseNellEvento, chiApprovaInParole, erroriRegoleFerie, eventoConFerie, regoleFerieDaRiga, regoleFerieDiPartenza, rigaDaRegoleFerie,
  type ChiApprova, type QuandoSiChiede, type RegoleFerie,
} from '../lib/ferieRegole';

type Props = {
  companyId: string;
  outletId: string;
  nomeNegozio: string;
  puoScrivere: boolean;
  /** l'elenco HR lo cambia solo il Super Advisor */
  superAdvisor: boolean;
  /** nel negozio i giorni caldi sono accesi e lavorano tutte: la proposta di partenza li spegne */
  giorniCaldiTutti: boolean;
};

type RigaEvento = { id: string; nome: string; dal: string; al: string; tipo: string | null; regole: Record<string, unknown> | null; bloccaFerie: boolean; altriNegozi: boolean };
type Utente = { id: string; nome: string; ruolo: string };

const oggi = () => new Date().toISOString().slice(0, 10);
const piuGiorni = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const gg = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** chi puo' decidere le ferie per il suo profilo, senza altro (posso_decidere_ferie nel database) */
const RUOLI_CHE_DECIDONO = ['super_advisor', 'coo', 'contabile'];
/** profili che non possono essere HR: hanno gia' un loro posto (la referente) o non entrano nel gestionale */
const RUOLI_FUORI = ['responsabile', 'dipendente', 'operatore_cassa'];

export default function FeriePermessiNegozio({ companyId, outletId, nomeNegozio, puoScrivere, superAdvisor, giorniCaldiTutti }: Props) {
  const { toast } = useToast();
  const [disponibile, setDisponibile] = useState<boolean | null>(null);
  const [salvata, setSalvata] = useState(false);
  const [regole, setRegole] = useState<RegoleFerie>(regoleFerieDiPartenza(giorniCaldiTutti));
  const [impronta, setImpronta] = useState('');
  const [eventi, setEventi] = useState<RigaEvento[]>([]);
  const [conRegoleEvento, setConRegoleEvento] = useState(false);
  const [hr, setHr] = useState<string[]>([]);
  const [utenti, setUtenti] = useState<Utente[]>([]);
  const [referentiFerie, setReferentiFerie] = useState<Set<string>>(new Set());
  const [nuovoHr, setNuovoHr] = useState('');
  const [salvo, setSalvo] = useState(false);

  const carica = useCallback(async () => {
    const [r, h, ev, prof, appr] = await Promise.all([
      caricaRegoleFerie(outletId),
      caricaHr(companyId),
      caricaEventi(companyId, oggi(), piuGiorni(400)).catch(() => ({ righe: [] as Record<string, unknown>[], conRegole: false })),
      supabase.from('user_profiles').select('id, first_name, last_name, role').eq('company_id', companyId).eq('is_active', true),
      supabase.from('leave_approvers').select('user_id, attivo').eq('company_id', companyId),
    ]);
    setDisponibile(r.disponibile && h.disponibile);
    setSalvata(!!r.riga);
    const lette = r.riga ? regoleFerieDaRiga(r.riga) : regoleFerieDiPartenza(giorniCaldiTutti);
    setRegole(lette);
    setImpronta(r.riga ? JSON.stringify(lette) : '');
    setHr(h.utenti);
    setConRegoleEvento(ev.conRegole);
    setEventi(ev.righe
      .filter((x) => !Array.isArray(x.outlet_ids) || !(x.outlet_ids as string[]).length || (x.outlet_ids as string[]).includes(outletId))
      .map((x) => ({
        id: String(x.id), nome: String(x.nome ?? ''), dal: String(x.data_dal ?? ''), al: String(x.data_al ?? x.data_dal ?? ''),
        tipo: (x.tipo as string | null) ?? null,
        regole: x.regole && typeof x.regole === 'object' ? (x.regole as Record<string, unknown>) : null,
        bloccaFerie: !!x.blocca_ferie,
        altriNegozi: !Array.isArray(x.outlet_ids) || (x.outlet_ids as string[]).length !== 1,
      }))
      .sort((a, b) => a.dal.localeCompare(b.dal)));
    setUtenti(((prof.data as { id: string; first_name: string | null; last_name: string | null; role: string | null }[] | null) ?? [])
      .filter((u) => !RUOLI_FUORI.includes(u.role ?? ''))
      .map((u) => ({ id: u.id, nome: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || 'Senza nome', ruolo: u.role ?? '' }))
      .sort((a, b) => a.nome.localeCompare(b.nome)));
    setReferentiFerie(new Set(((appr.data as { user_id: string | null; attivo: boolean }[] | null) ?? []).filter((a) => a.attivo && a.user_id).map((a) => a.user_id as string)));
  }, [companyId, outletId, giorniCaldiTutti]);

  useEffect(() => { setDisponibile(null); void carica(); }, [carica]);

  if (disponibile === null) return <p className="text-sm text-slate-500">Carico…</p>;
  if (!disponibile) {
    return <p className="text-sm text-slate-500">Le regole di ferie e permessi per negozio arrivano con il prossimo aggiornamento del database. Per ora le richieste funzionano come sempre.</p>;
  }

  const cambiata = JSON.stringify(regole) !== impronta;
  const errori = erroriRegoleFerie(regole);
  const bloccanti = errori.filter((e) => e.includes('nessuno:'));

  const setChi = (k: keyof RegoleFerie['approva'], campo: keyof ChiApprova, v: boolean) =>
    setRegole((r) => ({ ...r, approva: { ...r.approva, [k]: { ...r.approva[k], [campo]: v } } }));
  const setQuando = (k: keyof RegoleFerie['quando'], campo: keyof QuandoSiChiede, v: boolean) =>
    setRegole((r) => ({ ...r, quando: { ...r.quando, [k]: { ...r.quando[k], [campo]: v } } }));

  const salva = async () => {
    if (bloccanti.length) { toast({ type: 'warning', message: bloccanti[0] }); return; }
    setSalvo(true);
    const err = await salvaRegoleFerie(companyId, outletId, rigaDaRegoleFerie(regole));
    setSalvo(false);
    if (err) { toast({ type: 'error', message: err }); return; }
    toast({ type: 'success', message: `Ferie e permessi di ${nomeNegozio}: regole salvate. Valgono da adesso per le richieste dall’app.` });
    await carica();
  };

  const cambiaEvento = async (e: RigaEvento, campo: keyof QuandoSiChiede, v: boolean) => {
    const ora = ammesseNellEvento({ nome: e.nome, data_dal: e.dal, data_al: e.al, blocca_ferie: e.bloccaFerie,
      ferie: typeof e.regole?.ferie === 'boolean' ? e.regole.ferie : null, permessi: typeof e.regole?.permessi === 'boolean' ? e.regole.permessi : null });
    const nuovo = eventoConFerie(e.regole, { ...ora, [campo]: v });
    setEventi((l) => l.map((x) => (x.id === e.id ? { ...x, regole: nuovo.regole, bloccaFerie: nuovo.blocca_ferie } : x)));
    const err = await salvaFerieEvento(e.id, nuovo.regole, nuovo.blocca_ferie);
    if (err) { toast({ type: 'error', message: err }); await carica(); }
  };

  const aggiungi = async () => {
    if (!nuovoHr) return;
    const err = await aggiungiHr(companyId, nuovoHr);
    if (err) { toast({ type: 'error', message: err.includes('row-level security') ? 'L’elenco HR lo cambia solo il Super Advisor.' : err }); return; }
    setNuovoHr('');
    await carica();
  };
  const togli = async (id: string) => {
    const err = await togliHr(companyId, id);
    if (err) toast({ type: 'error', message: err });
    await carica();
  };

  const righeChi: { k: keyof RegoleFerie['approva']; nome: string }[] = [
    { k: 'ferie', nome: 'Ferie' }, { k: 'permessi', nome: 'Permessi' }, { k: 'eccezioni', nome: 'Eccezioni nei giorni spenti' },
  ];
  const righeQuando: { k: keyof RegoleFerie['quando']; nome: string }[] = [
    { k: 'feriali', nome: 'Feriali normali' }, { k: 'weekend', nome: 'Sabato e domenica' }, { k: 'festivi', nome: 'Festivi e giorni speciali' },
  ];
  const hrDettaglio = hr.map((id) => utenti.find((u) => u.id === id) ?? { id, nome: 'Utente non più attivo', ruolo: '' });

  return (
    <div className="space-y-4">
      {!salvata && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Questa scheda non è ancora stata salvata per {nomeNegozio}: le richieste funzionano come sempre. Qui sotto c’è una proposta; vale solo dopo «Salva ferie e permessi».
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900">Chi approva</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-1">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-900">
                  <th className="py-1 pr-2 font-semibold"></th><th className="py-1 px-2 font-semibold">Referente del negozio</th><th className="py-1 px-2 font-semibold">HR</th><th className="py-1 pl-2 font-semibold">Quante approvazioni</th>
                </tr>
              </thead>
              <tbody>
                {righeChi.map(({ k, nome }) => {
                  const c = regole.approva[k];
                  const due = c.referente && c.hr;
                  return (
                    <tr key={k} className="border-b border-slate-100">
                      <td className="py-2 pr-2 font-semibold text-slate-800">{nome}</td>
                      <td className="py-2 px-2"><Interruttore acceso={c.referente} disabled={!puoScrivere} etichetta={`${nome}: approva la referente`} onCambia={(v) => setChi(k, 'referente', v)} /></td>
                      <td className="py-2 px-2"><Interruttore acceso={c.hr} disabled={!puoScrivere} etichetta={`${nome}: approva l'HR`} onCambia={(v) => setChi(k, 'hr', v)} /></td>
                      <td className="py-2 pl-2">
                        {due ? (
                          <div className="flex flex-wrap gap-1">
                            <Scelta attiva={!c.entrambe} disabled={!puoScrivere} onClick={() => setChi(k, 'entrambe', false)}>ne basta una</Scelta>
                            <Scelta attiva={c.entrambe} disabled={!puoScrivere} onClick={() => setChi(k, 'entrambe', true)}>servono tutte e due</Scelta>
                          </div>
                        ) : <span className="text-xs text-slate-500">{chiApprovaInParole(c)}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">La referente è il profilo «responsabile» scelto in Dipendenti → Presenze → Chi conferma. Il Super Advisor può sempre decidere.</p>

          <h4 className="text-sm font-semibold text-slate-900 mt-4">Chi è HR</h4>
          <p className="text-xs text-slate-500">Vale per tutti i negozi dell’azienda. Lo cambia solo il Super Advisor. Finché l’elenco è vuoto, dal lato HR approva chi approvava prima.</p>
          <ul className="mt-2 space-y-1">
            {hrDettaglio.length === 0 && <li className="text-sm text-slate-500">Nessuno in elenco.</li>}
            {hrDettaglio.map((u) => {
              const puoDecidere = RUOLI_CHE_DECIDONO.includes(u.ruolo) || referentiFerie.has(u.id);
              return (
                <li key={u.id} className="flex items-center justify-between gap-2 text-sm border border-slate-200 rounded-lg px-2 py-1.5">
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-800">{u.nome}</span>
                    {!puoDecidere && <span className="block text-xs text-amber-800">Con il suo profilo vede le richieste ma non può ancora approvarle: va aggiunta anche fra i «Referenti ferie» (Ferie e permessi → Approvazioni).</span>}
                  </span>
                  {superAdvisor && (
                    <button type="button" onClick={() => togli(u.id)} aria-label={`Togli ${u.nome} dall'elenco HR`} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50"><X size={14} /> Togli</button>
                  )}
                </li>
              );
            })}
          </ul>
          {superAdvisor && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <select value={nuovoHr} onChange={(e) => setNuovoHr(e.target.value)} aria-label="Persona da aggiungere all'elenco HR" className="min-h-[40px] rounded-lg border border-slate-300 px-2 text-sm max-w-full">
                <option value="">Scegli una persona…</option>
                {utenti.filter((u) => !hr.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
              <button type="button" onClick={aggiungi} disabled={!nuovoHr} className="inline-flex items-center gap-1 min-h-[40px] text-sm font-semibold px-3 rounded-lg bg-slate-900 text-white disabled:opacity-50"><UserPlus size={16} /> Aggiungi all’HR</button>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-slate-900">Quando si possono chiedere dall’app</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mt-1">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-900">
                  <th className="py-1 pr-2 font-semibold">Giorni</th><th className="py-1 px-2 font-semibold">Ferie</th><th className="py-1 pl-2 font-semibold">Permessi</th>
                </tr>
              </thead>
              <tbody>
                {righeQuando.map(({ k, nome }) => (
                  <tr key={k} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-800">{nome}</td>
                    <td className="py-2 px-2"><Interruttore acceso={regole.quando[k].ferie} disabled={!puoScrivere} etichetta={`${nome}: ferie`} onCambia={(v) => setQuando(k, 'ferie', v)} /></td>
                    <td className="py-2 pl-2"><Interruttore acceso={regole.quando[k].permessi} disabled={!puoScrivere} etichetta={`${nome}: permessi`} onCambia={(v) => setQuando(k, 'permessi', v)} /></td>
                  </tr>
                ))}
                {eventi.map((e) => {
                  const a = ammesseNellEvento({ nome: e.nome, data_dal: e.dal, data_al: e.al, blocca_ferie: e.bloccaFerie,
                    ferie: typeof e.regole?.ferie === 'boolean' ? e.regole.ferie : null, permessi: typeof e.regole?.permessi === 'boolean' ? e.regole.permessi : null });
                  return (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2">
                        <span className="font-semibold text-slate-800">{e.nome}</span> <span className="text-slate-500">· {e.dal === e.al ? gg(e.dal) : `${gg(e.dal)}-${gg(e.al)}`}</span>
                        {e.altriNegozi && <span className="block text-xs text-slate-500">evento di più negozi: la scelta vale per tutti</span>}
                      </td>
                      <td className="py-2 px-2"><Interruttore acceso={a.ferie} disabled={!puoScrivere || !conRegoleEvento} etichetta={`${e.nome}: ferie`} onCambia={(v) => cambiaEvento(e, 'ferie', v)} /></td>
                      <td className="py-2 pl-2"><Interruttore acceso={a.permessi} disabled={!puoScrivere || !conRegoleEvento} etichetta={`${e.nome}: permessi`} onCambia={(v) => cambiaEvento(e, 'permessi', v)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Ogni evento ha la sua riga e si salva appena lo tocchi; quello che scrivi sull’evento vale più delle righe dei giorni. Dove è spento, la richiesta dall’app non parte come richiesta normale: {regole.approva.eccezioni.referente || regole.approva.eccezioni.hr
              ? `la dipendente può chiederla come eccezione, e la decide ${chiApprovaInParole(regole.approva.eccezioni)}.`
              : 'viene rifiutata, perché nessuno approva le eccezioni.'}
          </p>
          <p className="text-xs text-slate-500 mt-1">Responsabile e vice non possono essere assenti insieme di lunedì: la seconda richiesta viene bloccata, anche quando una delle due è scelta dal sistema perché non è ancora stata caricata.</p>
        </div>
      </div>

      {errori.map((e) => <p key={e} className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{e}</p>)}
      {puoScrivere && (
        <div className="flex justify-end">
          <button type="button" onClick={salva} disabled={salvo || (!cambiata && salvata) || bloccanti.length > 0}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"><Save size={16} /> {salvo ? 'Salvo…' : 'Salva ferie e permessi'}</button>
        </div>
      )}
    </div>
  );
}

function Interruttore({ acceso, onCambia, etichetta, disabled }: { acceso: boolean; onCambia: (v: boolean) => void; etichetta: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={acceso} aria-label={etichetta} disabled={disabled} onClick={() => onCambia(!acceso)}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-50 ${acceso ? 'bg-pink-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${acceso ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

function Scelta({ attiva, onClick, disabled, children }: { attiva: boolean; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={attiva} disabled={disabled} onClick={onClick}
      className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border disabled:opacity-60 ${attiva ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-300'}`}>{children}</button>
  );
}
