// La scheda della persona, una pagina intera (Patrizio, 16/11/2026: «è necessario fare
// solo una scheda. Se clicco su un dipendente mi si deve aprire una pagina intera con
// tutte le funzioni del dipendente»). Sostituisce la finestra «Scheda» e la finestra
// «Modifica» di Dipendenti: da qualunque punto si arrivi, si apre questa.
//
// Indirizzo: /dipendenti/<persona>[/<sezione>] (src/lib/dipendenteSlug.ts). La modifica
// dei dati si fa dentro la sezione Contratto, con le stesse regole di prima:
// «Correggi dati» (organico_correggi_persona, migration 334) e, per chi scrive
// l'anagrafica e solo per chi ha gia' i documenti dello studio, «Tutti i dati».
// Ripartizione, cessazione e «Segna un cambiamento» restano finestre, aperte da qui.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ChevronDown, Edit2, Eye, Percent, Plus, RefreshCw, Save, Trash2, Upload } from 'lucide-react';
import type { Row } from '../types/business';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useCompanyLabels } from '../hooks/useCompanyLabels';
import { useToast } from '../components/Toast';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import AccordiOrario from '../components/AccordiOrario';
import ChiaviNegozio from '../components/ChiaviNegozio';
import { isSellingOutlet } from '../hooks/useOutlets';
import RiposiNegozio from '../components/RiposiNegozio';
import CorreggiPersona, { assunzioneInAttesa } from '../components/CorreggiPersona';
import SegnaCambiamento from '../components/SegnaCambiamento';
import { caricaOrganico, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';
import { organicoAllaData, type PersonaOggi } from '../lib/organico';
import { parseItNum, norm } from '../lib/payrollParse';
import { keepLastByKey, readableDbError } from '../lib/upsertDedupe';
import { CONTRATTO_OPTS, contrattoLabel, moduloDa, moduloInRiga, type ModuloAnagrafica } from '../lib/anagraficaDipendente';
import { SEZIONI_SCHEDA, percorsoDipendente, risolviDipendente, segmentoDipendente, sezioneDa, type SezioneScheda } from '../lib/dipendenteSlug';
import { caricaGiorniLiberi, caricaRiposi, impostaGiornoLibero, type GiornoLibero } from '../lib/regoleNuoveDb';
import { NOMI_GIORNO_BREVI } from '../lib/turni';
import { ETICHETTE_VOCE } from '../lib/ferieRichiesta';
import { possoGestireDivise } from '../lib/diviseDb';
import DiviseAcquistiPersona from '../components/DiviseAcquistiPersona';
import { DOC_RAPPORTO_OPTS, docRapportoLabel, dataDelGruppo, riconosciDocumento } from '../lib/documentiRapporto';
import { espandiZip } from '../lib/zipFiles';
import { useConferma } from '../components/ui/Conferma'

type Employee = Row<'employees'>;
type EmployeeCost = Row<'employee_costs'>;
type EmployeeDocument = Row<'employee_documents'>;
type Allocazione = Row<'employee_outlet_allocations'>;
type OutletRow = { id: string; name: string; code: string | null; is_active: boolean | null;
  outlet_type?: string | null; cost_center_key?: string | null;
  referente_employee_id?: string | null; vice_referente_employee_id?: string | null };
type Saldo = { voce: string; residuo: number | null; da_fruire: number | null; ore_in_attesa: number | null; ore_approvate: number | null; residuo_disponibile: number | null; saldo_alla_data: string | null };
type Richiesta = { id: string; titolo: string | null; stato: string; created_at: string; inviata_il: string | null; origine: string };

/** Chi scrive direttamente l'anagrafica (RLS employees_write). */
const RUOLI_ANAGRAFICA = ['super_advisor', 'contabile'];
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
const eurFmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATO_RICHIESTA: Record<string, string> = { bozza: 'bozza', in_attesa: 'in attesa', approvata: 'approvata', respinta: 'respinta', annullata: 'annullata' };

const campo = (e: Employee | null, k: string): unknown => (e ? (e as unknown as Record<string, unknown>)[k] : null);
const testo = (v: unknown) => (v == null || v === '' ? '—' : String(v));
const dataIt = (d: unknown) => (d ? new Date(String(d)).toLocaleDateString('it-IT') : '—');
const nomeCompleto = (e: Employee) => `${e.nome || e.first_name || ''} ${e.cognome || e.last_name || ''}`.trim() || '—';

const docInfo = (d: EmployeeDocument) => (d.extracted_data && typeof d.extracted_data === 'object' && !Array.isArray(d.extracted_data) ? d.extracted_data as Record<string, unknown> : {});
const docDate = (d: EmployeeDocument) => String(docInfo(d).data_documento || d.uploaded_at || d.created_at || '').slice(0, 10);

export default function SchedaDipendente() {
  const { persona: segmento, sezione: segSezione } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [cerca, setCerca] = useSearchParams();
  const { profile } = useAuth();
  const { toast } = useToast();
  const companyId = profile?.company_id || '';
  const ruolo = profile?.role ?? '';
  const puoAnagrafica = RUOLI_ANAGRAFICA.includes(ruolo);
  const puoOrganico = puoTenereOrganico(profile?.role);
  // il profilo di sola lettura non carica documenti e non salva netti: il database li rifiuterebbe
  const solaLettura = ruolo === 'viewer';
  const sezione = sezioneDa(segSezione);

  const [tutti, setTutti] = useState<Employee[]>([]);
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [allocs, setAllocs] = useState<Allocazione[]>([]);
  const [costi, setCosti] = useState<EmployeeCost[]>([]);
  const [docs, setDocs] = useState<EmployeeDocument[]>([]);
  const [organico, setOrganico] = useState<DatiOrganico | null>(null);
  const [organicoFallito, setOrganicoFallito] = useState(false);
  const [saldi, setSaldi] = useState<Saldo[] | null>(null);
  const [richieste, setRichieste] = useState<Richiesta[] | null>(null);
  // Divise e acquisti (migration 422): la sezione la vede solo chi gestisce; null = non disponibile (Made)
  // undefined = ancora in lettura; null = divise e acquisti non attivi su questo gestionale
  const [possoDivise, setPossoDivise] = useState<boolean | null | undefined>(undefined);
  useEffect(() => { possoGestireDivise().then(setPossoDivise).catch(() => setPossoDivise(null)); }, []);
  const [caricata, setCaricata] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  // L'id dell'ultima persona aperta: dopo aver corretto nome o cognome lo slug vecchio
  // dell'indirizzo non trova piu' nessuno, ma la persona e' la stessa (revisore, 16/11/2026).
  const ultimoId = useRef<string | null>(null);
  const { persona: emp, omonimi } = useMemo(() => risolviDipendente(segmento, tutti, ultimoId.current), [segmento, tutti]);
  useEffect(() => { if (emp) ultimoId.current = emp.id; }, [emp]);

  const caricaTutto = useCallback(async () => {
    if (!companyId) return;
    setErrore(null);
    const [e, o] = await Promise.all([
      supabase.from('employees').select('*').eq('company_id', companyId),
      // '*': referente e vice (migration 393) possono mancare dove la migration non c'e'
      supabase.from('outlets').select('*').eq('company_id', companyId).order('name'),
    ]);
    if (e.error) {
      console.error('[scheda dipendente] lettura dei dipendenti', e.error);
      setErrore('Non riesco a leggere la scheda: riprova fra poco.'); setCaricata(true); return;
    }
    setTutti((e.data as Employee[]) ?? []);
    setOutlets((o.data as OutletRow[]) ?? []);
    setCaricata(true);
  }, [companyId]);

  const caricaPersona = useCallback(async (id: string) => {
    const [a, c, d, s, r] = await Promise.all([
      supabase.from('employee_outlet_allocations').select('*').eq('employee_id', id),
      supabase.from('employee_costs').select('*').eq('employee_id', id),
      supabase.from('employee_documents').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
      supabase.from('v_leave_disponibilita').select('voce, residuo, da_fruire, ore_in_attesa, ore_approvate, residuo_disponibile, saldo_alla_data').eq('employee_id', id),
      supabase.from('leave_requests').select('id, titolo, stato, created_at, inviata_il, origine').eq('employee_id', id).order('created_at', { ascending: false }).limit(20),
    ]);
    setAllocs((a.data as Allocazione[]) ?? []);
    setCosti((c.data as EmployeeCost[]) ?? []);
    setDocs(((d.data as EmployeeDocument[]) ?? []).filter((x) => x.doc_type !== 'cedolino'));
    setSaldi(s.error ? null : ((s.data as Saldo[]) ?? []));
    setRichieste(r.error ? null : ((r.data as Richiesta[]) ?? []));
  }, []);

  const caricaOrganicoPersona = useCallback(async () => {
    if (!companyId) return;
    try { setOrganico(await caricaOrganico(companyId)); setOrganicoFallito(false); } catch { setOrganico(null); setOrganicoFallito(true); }
  }, [companyId]);

  useEffect(() => { void caricaTutto(); void caricaOrganicoPersona(); }, [caricaTutto, caricaOrganicoPersona]);
  useEffect(() => { if (emp?.id) void caricaPersona(emp.id); }, [emp?.id, caricaPersona]);

  // L'indirizzo giusto: lo slug al posto dell'id, la sezione nota (come la scheda outlet).
  const segmentoGiusto = emp ? segmentoDipendente(emp, tutti) : null;
  useEffect(() => {
    if (!emp || !segmentoGiusto) return;
    const giusto = percorsoDipendente(segmentoGiusto, sezione);
    if (location.pathname !== giusto) navigate({ pathname: giusto, search: location.search }, { replace: true });
  }, [emp, segmentoGiusto, sezione, location.pathname, location.search, navigate]);

  const persona: PersonaOggi | null = useMemo(() => {
    if (!organico || !emp) return null;
    const oggi = new Date().toISOString().slice(0, 10);
    return organicoAllaData(organico.schede, organico.eventi, oggi).find((p) => p.scheda.id === emp.id) ?? null;
  }, [organico, emp]);

  // Modifica: «Correggi dati» o «Tutti i dati dell'anagrafica», dentro la sezione Contratto.
  const [modo, setModo] = useState<'lettura' | 'correggi' | 'anagrafica'>('lettura');
  const ass = persona && organico ? assunzioneInAttesa(organico.eventi, persona.scheda.id) : null;
  const puoModificare = puoOrganico || puoAnagrafica;
  const apriModifica = useCallback(() => {
    if (puoOrganico && persona) setModo('correggi');
    else if (puoAnagrafica) setModo('anagrafica');
  }, [puoOrganico, puoAnagrafica, persona]);
  // Arrivando da «Modifica» nell'elenco (?modifica=1) si apre subito la modifica.
  useEffect(() => {
    // si aspetta l'organico, ma se non si riesce a leggere il parametro si toglie lo stesso
    if (cerca.get('modifica') !== '1' || !emp || (puoOrganico && !persona && organico === null && !organicoFallito)) return;
    apriModifica();
    const n = new URLSearchParams(cerca); n.delete('modifica'); setCerca(n, { replace: true });
  }, [cerca, emp, persona, organico, organicoFallito, puoOrganico, apriModifica, setCerca]);

  const [segna, setSegna] = useState(false);
  const [ripartizione, setRipartizione] = useState(false);
  const [cessa, setCessa] = useState(false);
  const [riattiva, setRiattiva] = useState(false);

  const tornaIndietro = () => {
    if (window.history.length > 1 && (location.state as { daElenco?: boolean } | null)?.daElenco) navigate(-1);
    else navigate('/dipendenti?view=oggi');
  };
  const vaiSezione = (k: SezioneScheda) => { if (segmentoGiusto) navigate(percorsoDipendente(segmentoGiusto, k)); };
  const ricarica = async () => { await caricaTutto(); await caricaOrganicoPersona(); if (emp) await caricaPersona(emp.id); };

  if (!caricata) return <div className="flex items-center justify-center py-24"><div className="w-8 h-8 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" /></div>;
  if (!errore && !emp && omonimi.length > 1) {
    return (
      <div className="max-w-xl mx-auto mt-16 bg-white border border-slate-200 rounded-xl p-6">
        <p className="font-semibold text-slate-900">Ci sono più persone con questo nome</p>
        <p className="text-sm text-slate-500 mt-1">Scegli quella giusta: ognuna ha il suo indirizzo.</p>
        <ul className="mt-3 divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {omonimi.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => navigate(percorsoDipendente(o.id, sezione))} className="w-full text-left px-3 py-2.5 hover:bg-slate-50">
                <span className="font-medium text-slate-900">{nomeCompleto(o)}</span>
                <span className="block text-xs text-slate-500">
                  {[outlets.find((x) => x.id === o.outlet_id)?.name ?? null, o.matricola ? `matricola ${o.matricola}` : null, o.is_active === false ? 'cessata' : null].filter(Boolean).join(' · ') || 'senza negozio'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (errore || !emp) {
    return (
      <div className="max-w-xl mx-auto mt-16 bg-white border border-slate-200 rounded-xl p-6 text-center">
        <p className="font-semibold text-slate-900">{errore ? 'Non riesco a leggere i dipendenti' : 'Persona non trovata'}</p>
        <p className="text-sm text-slate-500 mt-1">{errore ?? 'L\'indirizzo non corrisponde a nessuna persona di questa azienda: aprila dall\'elenco.'}</p>
        <button type="button" onClick={() => navigate('/dipendenti?view=oggi')} className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium">Vai all'elenco dei dipendenti</button>
      </div>
    );
  }

  const outletName = outlets.find((o) => o.id === emp.outlet_id)?.name ?? (allocs.map((a) => a.outlet_code).join(', ') || null);
  const contratto = String(campo(emp, 'contratto_tipo') || campo(emp, 'contract_type') || '');
  const ore = campo(emp, 'ore_settimanali');
  const isTD = contratto === 'determinato';
  const attiva = emp.is_active !== false;
  const qualifica = campo(emp, 'qualifica') || emp.role_description;
  const livello = emp.livello || campo(emp, 'level');
  // Apertura e chiusura valgono solo nei negozi (Patrizio, 17/11/2026: chi e' in sede o in magazzino
  // non apre e non chiude un negozio). Referente e vice sono sempre abilitate: niente da indicare.
  const negozio = outlets.find((o) => o.id === emp.outlet_id) ?? null;
  const inNegozio = !!negozio && isSellingOutlet({ outlet_type: negozio.outlet_type ?? null }) && negozio.cost_center_key !== 'sede_magazzino';
  const eGuida = !!negozio && (negozio.referente_employee_id === emp.id || negozio.vice_referente_employee_id === emp.id);
  const apreChiudeDaIndicare = inNegozio && !eGuida && 'puo_aprire' in (emp as unknown as Record<string, unknown>) && (campo(emp, 'puo_aprire') == null || campo(emp, 'puo_chiudere') == null);
  const scadenza = campo(emp, 'scadenza_td');

  return (
    <div className="min-h-screen bg-white">
    <div className="p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Testata come la scheda del punto vendita: chi è, a colpo d'occhio, e le azioni sulla persona */}
      <div className="flex items-start gap-3 sm:gap-4 flex-wrap">
        <button type="button" onClick={tornaIndietro} className="p-2 rounded-lg hover:bg-slate-100 transition text-slate-600" aria-label="Torna all'elenco dei dipendenti" title="Torna all'elenco"><ArrowLeft size={20} /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 break-words">{nomeCompleto(emp)}</h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${attiva ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{attiva ? 'In servizio' : `Cessata${emp.data_cessazione ? ` il ${dataIt(emp.data_cessazione)}` : ''}`}</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            {[outletName, qualifica ? String(qualifica) : null, livello ? String(livello) : null, emp.matricola ? `matricola ${emp.matricola}` : null, emp.data_assunzione || emp.hire_date ? `assunta il ${dataIt(emp.data_assunzione || emp.hire_date)}` : null].filter(Boolean).join(' · ')}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-800">{contrattoLabel(contratto)}{ore != null ? ` · ${Number(ore).toLocaleString('it-IT')} h` : ''}</span>
            {apreChiudeDaIndicare && attiva && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">Apertura e chiusura: da indicare</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:justify-end">
          {puoOrganico && attiva && persona && <button type="button" onClick={() => setSegna(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition text-slate-700" title="Un cambiamento che vale da una data: orario, negozio, proroga, cessazione…">Segna un cambiamento</button>}
          {puoAnagrafica && <button type="button" onClick={() => setRipartizione(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-violet-200 hover:bg-violet-50 transition text-violet-700" title="Come si divide il costo fra i negozi"><Percent size={15} /> Ripartizione</button>}
          {puoAnagrafica && attiva && <button type="button" onClick={() => setCessa(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-red-200 hover:bg-red-50 transition text-red-600"><Trash2 size={15} /> Cessa</button>}
          {puoAnagrafica && !attiva && <button type="button" onClick={() => setRiattiva(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-emerald-200 hover:bg-emerald-50 transition text-emerald-700"><RefreshCw size={15} /> Riattiva</button>}
        </div>
      </div>

      {/* Avvisi che contano */}
      {attiva && ((isTD && scadenza) || apreChiudeDaIndicare) && (
        <div className="flex flex-wrap gap-2">
          {isTD && scadenza ? (
            <div className="text-sm px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-900">
              <b>Il contratto scade il {dataIt(scadenza)}</b> · proroghe {testo(campo(emp, 'proroghe'))} usate, {testo(campo(emp, 'proroghe_disponibili'))} disponibili
            </div>
          ) : null}
          {apreChiudeDaIndicare && (
            <button type="button" onClick={() => vaiSezione('turni')} className="text-sm px-3 py-2 rounded-xl border border-blue-200 bg-blue-50 text-blue-900 text-left">
              <b>Apertura e chiusura da indicare</b>: finché non lo dici, nel suo negozio la regola di chi apre e chi chiude non si applica
            </button>
          )}
        </div>
      )}

      {/* Sezioni */}
      <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5 overflow-x-auto" role="tablist">
        {SEZIONI_SCHEDA.filter((s) => s.k !== 'divise' || possoDivise === true).map((s) => (
          <button key={s.k} type="button" role="tab" aria-selected={sezione === s.k} onClick={() => vaiSezione(s.k)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition whitespace-nowrap ${sezione === s.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {sezione === 'contratto' && (
        <section className="bg-white border border-slate-200 rounded-xl">
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-900">Contratto e anagrafica</h2>
            {modo === 'lettura' && puoModificare && (puoAnagrafica || persona) && (
              <button type="button" onClick={apriModifica} className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-blue-600 hover:bg-blue-50 inline-flex items-center gap-1"><Edit2 size={14} /> Modifica</button>
            )}
          </div>
          <div className="p-4">
            {modo === 'correggi' && persona && organico ? (
              <CorreggiPersona inline persona={persona} eventi={organico.eventi} negozi={organico.negozi}
                onClose={() => setModo('lettura')} onSalvato={() => { void ricarica(); }}
                onAltriDati={puoAnagrafica && !ass ? () => setModo('anagrafica') : undefined} />
            ) : modo === 'anagrafica' && puoAnagrafica ? (
              <ModuloAnagraficaInline emp={emp} tutti={tutti} outlets={outlets}
                onAnnulla={() => setModo('lettura')}
                onSalvato={async () => { setModo('lettura'); await ricarica(); }} />
            ) : (
              <ContrattoLettura emp={emp} outletName={outletName} />
            )}
          </div>
        </section>
      )}

      {sezione === 'turni' && (
        <section className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            {inNegozio && (
              <ChiaviNegozio employeeId={emp.id} outletId={emp.outlet_id ?? null}
                onCambiato={(campoC, valore) => setTutti((t) => t.map((x) => (x.id === emp.id ? ({ ...x, [campoC]: valore } as Employee) : x)))} />
            )}
            <AccordiOrario employeeId={emp.id} companyId={companyId} outletId={emp.outlet_id ?? null}
              oreSettimanali={ore != null ? Number(ore) : null} />
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="font-semibold text-slate-900">Giorni di riposo</h2>
            <p className="text-xs text-slate-500 mb-3">Giorni in cui riposa di preferenza e giorni in cui non riposa mai. Per legge c’è sempre almeno un giorno di riposo a settimana; quanti riposi a testa si decide nelle regole del negozio.</p>
            <RiposiNegozio companyId={companyId} persone={[{ id: emp.id, nome: nomeCompleto(emp) }]} puoScrivere={puoOrganico} />
            <GiornoLiberoPersona companyId={companyId} employeeId={emp.id} outletId={emp.outlet_id ?? null} puoScrivere={puoOrganico} />
          </div>
        </section>
      )}

      {sezione === 'ferie' && (
        <FeriePersona saldi={saldi} richieste={richieste} onVai={() => navigate('/dipendenti?view=ferie')} />
      )}

      {sezione === 'documenti' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <DocumentiRapporto employeeId={emp.id} companyId={companyId} cognome={emp.cognome || emp.last_name || null} docs={docs} puoCaricare={!solaLettura} onChanged={async () => { await caricaPersona(emp.id); }} />
        </section>
      )}

      {sezione === 'netti' && (
        <NettiAnno key={emp.id} employeeId={emp.id} companyId={companyId} costi={costi} puoSalvare={!solaLettura}
          onSalvato={async () => { await caricaPersona(emp.id); toast({ type: 'success', message: 'Netti salvati' }); }} />
      )}

      {sezione === 'divise' && (possoDivise === true ? (
        <DiviseAcquistiPersona companyId={companyId} employeeId={emp.id} nome={nomeCompleto(emp)} superAdvisor={ruolo === 'super_advisor'}
          negozi={outlets.map((o) => ({ id: o.id, name: o.name }))} />
      ) : possoDivise === undefined ? (
        <section className="bg-white border border-slate-200 rounded-xl p-6 flex justify-center"><RefreshCw className="animate-spin text-blue-600" size={20} /></section>
      ) : possoDivise === false || possoDivise === null ? (
        <section className="bg-white border border-slate-200 rounded-xl p-4 text-sm text-slate-600">
          {possoDivise === null ? 'Divise e acquisti non sono attivi in questo gestionale.' : 'Divise e acquisti li vede solo chi è nell’elenco scelto dal Super Advisor.'}
        </section>
      ) : null)}

      {segna && persona && organico && (
        <SegnaCambiamento open onClose={() => setSegna(false)} onSalvato={() => { void ricarica(); }}
          companyId={companyId} persone={organicoAllaData(organico.schede, organico.eventi, new Date().toISOString().slice(0, 10))}
          negozi={organico.negozi} employeeId={emp.id} tipoIniziale={null} />
      )}
      {ripartizione && (
        <RipartizioneModal employeeId={emp.id} companyId={companyId} allocs={allocs} outlets={outlets}
          onClose={() => setRipartizione(false)} onSalvato={async () => { setRipartizione(false); await caricaPersona(emp.id); }} />
      )}
      {cessa && (
        <CessaModal emp={emp} onClose={() => setCessa(false)} onSalvato={async () => { setCessa(false); await ricarica(); }} />
      )}
      <ConfirmModal open={riattiva} title="Riattiva dipendente" variant="primary" confirmLabel="Riattiva"
        message={`Vuoi riportare «${nomeCompleto(emp)}» tra gli attivi? La data di cessazione verrà azzerata.`}
        onClose={() => setRiattiva(false)}
        onConfirm={async () => {
          setRiattiva(false);
          const { error } = await supabase.from('employees').update({ is_active: true, data_cessazione: null, termination_date: null }).eq('id', emp.id);
          if (error) { toast({ type: 'error', message: 'Riattivazione non riuscita: ' + error.message }); return; }
          toast({ type: 'success', message: 'Dipendente riattivato' });
          await ricarica();
        }} />
    </div>
    </div>
  );
}

// ── Giorno libero fisso (employee_giorno_libero, migration 395) ─────────────────────
// Stesse regole del piano settimanale (PianoTurni): il selettore c'e' solo dove manca la
// tabella dei riposi preferiti (employee_riposi, 405); altrove il giorno scelto dal sistema si
// mostra e i riposi si decidono qui sopra. Dove il negozio ha i riposi minimi scritti il giorno
// fisso non si usa. Dove la tabella manca (Made) non si vede niente.
function GiornoLiberoPersona({ companyId, employeeId, outletId, puoScrivere }: { companyId: string; employeeId: string; outletId: string | null; puoScrivere: boolean }) {
  const { toast } = useToast();
  const [stato, setStato] = useState<{ disponibile: boolean; giorno: GiornoLibero | null; conRiposi: boolean; turnazione: boolean } | null>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [gl, rp, rg] = await Promise.all([
        caricaGiorniLiberi(companyId).catch(() => ({ mappa: new Map<string, GiornoLibero>(), disponibile: false })),
        caricaRiposi(companyId).catch(() => ({ preferiti: new Map<string, number[]>(), mai: new Map<string, number[]>(), disponibile: false })),
        outletId ? supabase.from('outlet_shift_rules').select('*').eq('outlet_id', outletId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!vivo) return;
      const regola = rg.data as { riposi_min_settimana?: number | null } | null;
      setStato({ disponibile: gl.disponibile, giorno: gl.mappa.get(employeeId) ?? null, conRiposi: rp.disponibile, turnazione: regola?.riposi_min_settimana != null });
    })();
    return () => { vivo = false; };
  }, [companyId, employeeId, outletId]);
  if (!stato || !stato.disponibile) return null;
  const nome = (g: number) => NOMI_GIORNO_BREVI[g]?.toLowerCase() ?? String(g);
  const cambia = async (giorno: number | null) => {
    try {
      await impostaGiornoLibero(companyId, employeeId, giorno);
      setStato((s) => (s ? { ...s, giorno: giorno == null ? null : { giorno, origine: 'manuale' } } : s));
    } catch (e) {
      toast({ type: 'error', message: `Giorno libero non salvato: ${e instanceof Error ? e.message : 'errore'}` });
    }
  };
  return (
    <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
      <span className="font-medium text-slate-800">Giorno libero fisso: </span>
      {stato.turnazione ? (
        <span className="text-slate-500">in questo negozio i riposi li decide la turnazione, con i giorni scelti qui sopra: il giorno libero fisso non si usa.</span>
      ) : !stato.conRiposi ? (
        <select disabled={!puoScrivere} value={stato.giorno?.giorno ?? ''} onChange={(e) => void cambia(e.target.value ? Number(e.target.value) : null)}
          aria-label="Giorno libero fisso" className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-sm text-slate-700">
          <option value="">da scegliere</option>
          {[1, 2, 3, 4, 5, 6, 7].map((g) => <option key={g} value={g}>{nome(g)}</option>)}
        </select>
      ) : stato.giorno ? (
        <span className="text-slate-600">{nome(stato.giorno.giorno)} <span className="text-slate-400">({stato.giorno.origine === 'manuale' ? 'deciso a mano' : 'scelto dal sistema'})</span></span>
      ) : (
        <span className="text-slate-500">non ancora scelto: lo sceglie il sistema alla prima proposta dei turni.</span>
      )}
    </div>
  );
}

// ── Contratto in lettura (quello che mostrava la finestra «Scheda») ──────────────────
function ContrattoLettura({ emp, outletName }: { emp: Employee; outletName: string | null }) {
  const pct = campo(emp, 'part_time_pct');
  const ore = campo(emp, 'ore_settimanali');
  const isTD = String(campo(emp, 'contratto_tipo') || '') === 'determinato';
  const note = String(campo(emp, 'note') || emp.notes || '');
  const filiale = campo(emp, 'filiale');
  const Cella = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="min-w-0"><div className="text-xs text-slate-400">{label}</div><div className="font-medium text-slate-900 break-words">{children}</div></div>
  );
  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
        <Cella label="Tipo contratto">{contrattoLabel(String(campo(emp, 'contratto_tipo') || campo(emp, 'contract_type') || ''))}</Cella>
        <Cella label="Ore a settimana"><span className="tabular-nums">{ore != null ? `${Number(ore).toLocaleString('it-IT')} h` : '—'}</span> <span className="text-xs font-normal text-slate-400">({pct == null || pct === '' ? 'tempo pieno' : `${Number(pct).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`})</span></Cella>
        <Cella label="Sede">{testo(outletName)}</Cella>
        <Cella label="Qualifica e livello">{testo(campo(emp, 'qualifica') || emp.role_description)} · {testo(emp.livello || campo(emp, 'level'))}</Cella>
        <Cella label="Data assunzione">{dataIt(emp.data_assunzione || emp.hire_date)}</Cella>
        <Cella label="Matricola"><span className="tabular-nums">{testo(emp.matricola)}</span></Cella>
        <div className="col-span-2 min-w-0"><div className="text-xs text-slate-400">Codice fiscale</div><div className="font-medium tabular-nums text-sm break-all">{testo(emp.codice_fiscale || campo(emp, 'fiscal_code'))}</div></div>
      </div>
      {isTD && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-950">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">Tempo determinato</span>
            <span>scade il <b>{dataIt(campo(emp, 'scadenza_td'))}</b></span>
            <span className="text-amber-900/80">durata {testo(campo(emp, 'durata_mesi'))} mesi</span>
            <span className="text-amber-900/80">proroghe {testo(campo(emp, 'proroghe'))} usate, {testo(campo(emp, 'proroghe_disponibili'))} disponibili</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-amber-900/80">
            {campo(emp, 'stato_td') ? <span className="break-words">{String(campo(emp, 'stato_td'))}</span> : null}
            <span>mesi disponibili: {testo(campo(emp, 'mesi_disp_senza_causale'))} senza causale, {testo(campo(emp, 'mesi_disp_con_causale'))} con causale</span>
          </div>
        </div>
      )}
      {filiale ? <div className="text-xs text-slate-400 mt-3">Filiale (da file contratti): {String(filiale)}</div> : null}
      {note && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-slate-500 hover:text-slate-700 inline-flex items-center gap-1 [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" /> Note e storico delle modifiche
          </summary>
          <div className="text-xs text-slate-500 mt-1 whitespace-pre-line break-words">{note}</div>
        </details>
      )}
    </div>
  );
}

// ── «Tutti i dati dell'anagrafica»: era la finestra «Modifica dipendente» ──────────────
function ModuloAnagraficaInline({ emp, tutti, outlets, onAnnulla, onSalvato }: {
  emp: Employee; tutti: Employee[]; outlets: OutletRow[]; onAnnulla: () => void; onSalvato: () => Promise<void>;
}) {
  const labels = useCompanyLabels();
  const { toast } = useToast();
  const [form, setForm] = useState<ModuloAnagrafica>(() => moduloDa(emp as unknown as Record<string, unknown>));
  const [salvo, setSalvo] = useState(false);
  const set = (k: keyof ModuloAnagrafica, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isTD = form.contratto === 'determinato';
  const inp = 'w-full min-h-[38px] px-3 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const Campo = ({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) => (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}><span className="text-xs text-slate-500 mb-1 block">{label}</span>{children}</label>
  );

  const salva = async () => {
    if (!form.nome.trim() || !form.cognome.trim()) { toast({ type: 'error', message: 'Nome e cognome sono obbligatori' }); return; }
    if (!form.data_assunzione) { toast({ type: 'error', message: 'La data di inizio contratto è obbligatoria' }); return; }
    // La matricola identifica la persona nel software paghe: una sola per azienda.
    const matricola = form.matricola.trim();
    if (matricola) {
      const doppia = tutti.find((e) => norm(e.matricola) === norm(matricola) && e.id !== emp.id);
      if (doppia) { toast({ type: 'error', message: `La matricola ${matricola} è già assegnata a ${nomeCompleto(doppia)}: correggi il numero, oppure apri la scheda di quella persona se è la stessa.` }); return; }
    }
    setSalvo(true);
    try {
      const { error } = await supabase.from('employees').update(moduloInRiga({ ...form }) as never).eq('id', emp.id);
      if (error) throw error;
      toast({ type: 'success', message: 'Dipendente aggiornato' });
      await onSalvato();
    } catch (err) {
      const e = err as { code?: string; message?: string };
      toast({ type: 'error', message: e?.code === '23505' && /matricola/i.test(e?.message || '')
        ? `La matricola ${matricola} è già usata da un'altra persona di questa azienda: correggila prima di salvare.`
        : 'Errore nel salvataggio: ' + readableDbError(err, labels) });
    } finally { setSalvo(false); }
  };

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo label="Cognome *"><input value={form.cognome} onChange={(e) => set('cognome', e.target.value)} className={inp} /></Campo>
        <Campo label="Nome *"><input value={form.nome} onChange={(e) => set('nome', e.target.value)} className={inp} /></Campo>
        <Campo label="Matricola"><input value={form.matricola} onChange={(e) => set('matricola', e.target.value)} className={inp} /></Campo>
        <Campo label="Codice fiscale"><input value={form.codice_fiscale} onChange={(e) => set('codice_fiscale', e.target.value)} className={inp} /></Campo>
        <Campo label="Qualifica">
          <select value={form.qualifica} onChange={(e) => set('qualifica', e.target.value)} className={inp}>
            <option value="">—</option>
            <option value="Impiegato">Impiegato</option>
            <option value="Operaio">Operaio</option>
            <option value="Amministratore">Amministratore</option>
            {!['Impiegato', 'Operaio', 'Amministratore', ''].includes(form.qualifica) && <option value={form.qualifica}>{form.qualifica}</option>}
          </select>
        </Campo>
        <Campo label="Livello"><input value={form.livello} onChange={(e) => set('livello', e.target.value)} placeholder="es. 4 Livello" className={inp} /></Campo>
        <Campo label="Tipo contratto">
          <select value={form.contratto} onChange={(e) => set('contratto', e.target.value)} className={inp}>
            {CONTRATTO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            {!CONTRATTO_OPTS.some((o) => o.v === form.contratto) && <option value={form.contratto}>{form.contratto}</option>}
          </select>
        </Campo>
        <Campo label="% part time"><input value={form.part_time_pct} onChange={(e) => set('part_time_pct', e.target.value)} inputMode="decimal" placeholder="(tempo pieno)" className={`${inp} tabular-nums`} /></Campo>
        <Campo label="Data inizio contratto *"><input type="date" value={form.data_assunzione} onChange={(e) => set('data_assunzione', e.target.value)} className={inp} /></Campo>
        <Campo label="Filiale / sede">
          <select value={form.outlet_id} onChange={(e) => set('outlet_id', e.target.value)} className={inp}>
            <option value="">—</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {form.filiale && <span className="text-[11px] text-slate-400 mt-1 block">da file: {form.filiale}</span>}
        </Campo>
        {!isTD && (
          <Campo label="Data fine">
            <div className="text-sm text-slate-400 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50">{form.contratto === 'indeterminato' ? 'Aperta: si scrive alla cessazione' : '—'}</div>
          </Campo>
        )}
        <Campo label="Note" full><input value={form.note} onChange={(e) => set('note', e.target.value)} className={inp} /></Campo>
      </div>
      {isTD && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <div className="text-xs font-semibold text-amber-800 mb-2">Tempo determinato</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Campo label="Scadenza"><input type="date" value={form.scadenza_td} onChange={(e) => set('scadenza_td', e.target.value)} className={inp} /></Campo>
            <Campo label="Durata (mesi)"><input value={form.durata_mesi} onChange={(e) => set('durata_mesi', e.target.value)} inputMode="decimal" className={`${inp} tabular-nums`} /></Campo>
            <Campo label="Proroghe usate"><input value={form.proroghe} onChange={(e) => set('proroghe', e.target.value)} inputMode="numeric" className={`${inp} tabular-nums`} /></Campo>
            <Campo label="Proroghe disponibili"><input value={form.proroghe_disponibili} onChange={(e) => set('proroghe_disponibili', e.target.value)} inputMode="numeric" className={`${inp} tabular-nums`} /></Campo>
            <Campo label="Mesi disp. senza causale"><input value={form.mesi_disp_senza_causale} onChange={(e) => set('mesi_disp_senza_causale', e.target.value)} inputMode="decimal" className={`${inp} tabular-nums`} /></Campo>
            <Campo label="Mesi disp. con causale"><input value={form.mesi_disp_con_causale} onChange={(e) => set('mesi_disp_con_causale', e.target.value)} inputMode="decimal" className={`${inp} tabular-nums`} /></Campo>
            <Campo label="Stato" full><input value={form.stato_td} onChange={(e) => set('stato_td', e.target.value)} placeholder="es. Prorogabile/Riassumibile" className={inp} /></Campo>
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        <button type="button" onClick={onAnnulla} className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button type="button" onClick={salva} disabled={salvo} className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"><Save size={15} /> {salvo ? 'Salvo…' : 'Salva'}</button>
      </div>
    </div>
  );
}

// ── Ferie e permessi della persona: saldi dal tabulato e richieste, in lettura ──────
function FeriePersona({ saldi, richieste, onVai }: { saldi: Saldo[] | null; richieste: Richiesta[] | null; onVai: () => void }) {
  const ore = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`);
  return (
    <section className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="font-semibold text-slate-900">Saldi dal tabulato delle paghe</h2>
          <button type="button" onClick={onVai} className="text-sm font-medium text-blue-700 hover:underline">Vai a Ferie e permessi</button>
        </div>
        {saldi === null ? (
          <p className="text-sm text-slate-500">I saldi non si leggono da qui: aprili in Ferie e permessi.</p>
        ) : saldi.length === 0 ? (
          <p className="text-sm text-slate-500">Questa persona non è ancora nel tabulato delle paghe.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-3 font-medium">Voce</th><th className="py-2 pr-3 font-medium text-right">Residuo</th><th className="py-2 pr-3 font-medium text-right">In attesa</th><th className="py-2 pr-3 font-medium text-right">Approvate</th><th className="py-2 pr-3 font-medium text-right">Disponibile</th><th className="py-2 font-medium">Saldo al</th>
              </tr></thead>
              <tbody>
                {saldi.map((s) => (
                  <tr key={s.voce} className="border-b border-slate-50">
                    <td className="py-2 pr-3">{ETICHETTE_VOCE[s.voce as keyof typeof ETICHETTE_VOCE] ?? s.voce}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{ore(s.residuo)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{ore(s.ore_in_attesa)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{ore(s.ore_approvate)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{ore(s.residuo_disponibile)}</td>
                    <td className="py-2 text-slate-500">{dataIt(s.saldo_alla_data)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h2 className="font-semibold text-slate-900 mb-2">Richieste</h2>
        {richieste === null ? (
          <p className="text-sm text-slate-500">Le richieste non si leggono da qui: aprile in Ferie e permessi.</p>
        ) : richieste.length === 0 ? (
          <p className="text-sm text-slate-500">Nessuna richiesta di ferie o permessi.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {richieste.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-slate-800">{r.titolo || 'Ferie e permessi'}{r.origine === 'piano_mese' ? <span className="text-xs text-slate-400"> · proposta dal piano del mese</span> : null}</span>
                <span className="text-xs text-slate-500">{STATO_RICHIESTA[r.stato] ?? r.stato} · {dataIt(r.inviata_il || r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-400 mt-2">Le richieste si chiedono, si approvano e si spostano in Ferie e permessi: qui c'è il riepilogo della persona.</p>
      </div>
    </section>
  );
}

// ── Documenti del rapporto: storico, un documento nuovo si aggiunge ─────────────────
// Si trascinano (o si scelgono) uno o più PDF, anche dentro uno zip: tipo, data e
// descrizione si leggono dal nome del file, ogni file si salva da solo, uno alla
// volta, e alla fine un riquadro dice che è finito (regola fissa dei caricamenti).
type EsitoDoc = { nome: string; stato: 'attesa' | 'ok' | 'gia' | 'errore'; testo?: string };

function DocumentiRapporto({ employeeId, companyId, cognome, docs, puoCaricare, onChanged }: { employeeId: string; companyId: string; cognome: string | null; docs: EmployeeDocument[]; puoCaricare: boolean; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [tipo, setTipo] = useState('auto');
  const [data, setData] = useState('');
  const [descr, setDescr] = useState('');
  const [busy, setBusy] = useState(false);
  const [sopra, setSopra] = useState(false);
  const [esiti, setEsiti] = useState<EsitoDoc[]>([]);
  const [chiusura, setChiusura] = useState<{ ok: boolean; testo: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ordinati = [...docs].sort((a, b) => docDate(b).localeCompare(docDate(a)));

  const apri = async (d: EmployeeDocument) => {
    if (!d.file_path) return;
    // La finestra si apre subito (click dell'utente), poi riceve il file: evita il blocco popup.
    const w = window.open('', '_blank');
    const { data: blob, error } = await supabase.storage.from('employee-documents').download(d.file_path);
    if (error || !blob) { w?.close(); toast({ type: 'error', message: 'Impossibile aprire il documento' }); return; }
    // Il tipo si decide dall'estensione con una lista chiusa, mai dal Content-Type salvato:
    // un file caricato come text/html non deve mai aprirsi come pagina (revisore sicurezza).
    const est = (d.file_path.split('.').pop() || '').toLowerCase();
    const tipoMime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as Record<string, string>)[est] || 'application/pdf';
    const url = URL.createObjectURL(new Blob([blob], { type: tipoMime }));
    if (w) w.location.href = url; else window.open(url, '_blank');
  };

  const carica = async (scelti: File[]) => {
    if (!scelti.length) return;
    if (busy) { toast({ type: 'error', message: 'Aspetta che finisca il caricamento in corso, poi trascina di nuovo questi file.' }); return; }
    setBusy(true);
    setChiusura(null);
    try {
      const AMMESSI = /\.(pdf|png|jpe?g)$/i;
      const espansi = await espandiZip(scelti, { estensioni: ['pdf', 'png', 'jpg', 'jpeg'] });
      const files = espansi.files.filter((f) => AMMESSI.test(f.file.name));
      const problemi = [...espansi.problemi, ...espansi.files.filter((f) => !AMMESSI.test(f.file.name)).map((f) => ({ zip: f.file.name, testo: 'qui si archiviano solo PDF e immagini (png, jpg)' }))];
      const lista: EsitoDoc[] = [
        ...files.map((f) => ({ nome: f.file.name, stato: 'attesa' as const })),
        ...problemi.map((p) => ({ nome: p.zip, stato: 'errore' as const, testo: p.testo })),
      ];
      setEsiti(lista);
      // Il controllo dei doppioni si fa sul database, non sulla pagina.
      const { data: presenti, error: errPres } = await supabase.from('employee_documents').select('file_name, file_size').eq('employee_id', employeeId);
      if (errPres) throw errPres;
      // Doppione = stesso nome E stessa dimensione: una seconda «Proroga.pdf» diversa entra nello storico.
      const chiave = (nome: string | null, size: number | null) => `${(nome || '').toLowerCase()}|${size ?? ''}`;
      const gia = new Set(((presenti as { file_name: string | null; file_size: number | null }[]) ?? []).map((r) => chiave(r.file_name, r.file_size)));
      const dataGruppo = dataDelGruppo(files.map((f) => f.file.name));
      const aggiorna = (i: number, e: Partial<EsitoDoc>) => setEsiti((prev) => prev.map((x, k) => (k === i ? { ...x, ...e } : x)));
      let archiviati = 0;
      let saltati = 0;
      let errori = problemi.length;
      // Uno alla volta, ciascuno fino in fondo.
      for (let i = 0; i < files.length; i++) {
        const file = files[i].file;
        if (gia.has(chiave(file.name, file.size))) { saltati++; aggiorna(i, { stato: 'gia', testo: 'già archiviato, non l\'ho ricaricato' }); continue; }
        try {
          const r = riconosciDocumento(file.name, { tipoScelto: tipo, dataScelta: data, dataGruppo, cognome, descrizioneScelta: files.length === 1 ? descr : '' });
          const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
          const path = `employee-documents/${employeeId}/${r.data}_${r.tipo}_${Date.now()}_${i}.${ext}`;
          const MIME: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
          const { error: upErr } = await supabase.storage.from('employee-documents').upload(path, file, { contentType: MIME[ext] || 'application/pdf' });
          if (upErr) throw upErr;
          const [y, m] = r.data.split('-').map(Number);
          const { error } = await supabase.from('employee_documents').insert([{
            employee_id: employeeId, company_id: companyId, doc_type: r.tipo, year: y, month: m,
            file_name: file.name, file_path: path, file_size: file.size, status: 'archiviato',
            extracted_data: { data_documento: r.data, descrizione: r.descrizione || null, data_da: r.dataDa },
          }]);
          if (error) {
            await supabase.storage.from('employee-documents').remove([path]);
            throw error;
          }
          gia.add(chiave(file.name, file.size));
          archiviati++;
          aggiorna(i, { stato: 'ok', testo: `${docRapportoLabel(r.tipo)} · ${new Date(r.data).toLocaleDateString('it-IT')}${r.dataDa === 'oggi' ? ' (data di oggi: il nome non la diceva)' : ''}` });
        } catch (err) {
          errori++;
          aggiorna(i, { stato: 'errore', testo: (err as Error)?.message || 'errore' });
        }
      }
      if (!files.length && !problemi.length) {
        setChiusura({ ok: false, testo: 'Nel file scelto non c\'era nessun PDF o immagine da archiviare.' });
      } else if (errori === 0) {
        setChiusura({ ok: true, testo: `Finito, tutti i documenti sono archiviati${archiviati ? ` (${archiviati} nuovi` : ' ('}${saltati ? `${archiviati ? ', ' : ''}${saltati} già presenti` : ''}).` });
      } else {
        setChiusura({ ok: false, testo: `Finito con ${errori} ${errori === 1 ? 'file non archiviato' : 'file non archiviati'}: vedi le righe in rosso e riprova solo quelli. ${archiviati} archiviati.` });
      }
      setDescr(''); setData('');
      if (archiviati) await onChanged();
    } catch (err) {
      setChiusura({ ok: false, testo: 'Caricamento non riuscito: ' + ((err as Error)?.message || '') });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-semibold text-slate-900">Documenti del rapporto</h2>
        <span className="text-xs text-slate-500">{ordinati.length ? `${ordinati.length} ${ordinati.length === 1 ? 'documento' : 'documenti'}` : 'nessuno'}</span>
      </div>
      {ordinati.length === 0 ? (
        <div className="text-sm text-slate-400 mb-3">Nessun documento archiviato.</div>
      ) : (
        <ul className="divide-y divide-slate-100 mb-3">
          {ordinati.map((d) => {
            const info = docInfo(d);
            const dd = docDate(d);
            return (
              <li key={d.id} className="py-2 flex items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-slate-700">{docRapportoLabel(d.doc_type)} <span className="text-slate-400 font-normal tabular-nums">· {dd ? new Date(dd).toLocaleDateString('it-IT') : '—'}</span></div>
                  {info.descrizione ? <div className="text-xs text-slate-500">{String(info.descrizione)}</div> : null}
                  <div className="text-[11px] text-slate-400 truncate">{d.file_name}</div>
                </div>
                {d.file_path && (
                  <button type="button" onClick={() => apri(d)} className="shrink-0 p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50" title="Apri il documento" aria-label={`Apri ${d.file_name ?? 'il documento'}`}><Eye size={15} /></button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!puoCaricare ? (
        <div className="text-xs text-slate-400">Con il profilo di sola lettura i documenti si guardano ma non si caricano.</div>
      ) : (<>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!busy) setSopra(true); else e.dataTransfer.dropEffect = 'none'; }}
        onDragLeave={() => setSopra(false)}
        onDrop={(e) => { e.preventDefault(); setSopra(false); void carica(Array.from(e.dataTransfer.files || [])); }}
        className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${sopra ? 'border-blue-400 bg-blue-50' : 'border-slate-200'}`}
      >
        <p className="text-sm text-slate-600">Trascina qui i PDF, anche più di uno o in uno zip: tipo e data si leggono dal nome del file e si salvano da soli.</p>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="mt-2 px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-blue-600 hover:bg-blue-50 inline-flex items-center gap-1 disabled:opacity-60"><Upload size={14} /> {busy ? 'Caricamento…' : 'Scegli i file'}</button>
      </div>
      <input ref={fileRef} type="file" multiple accept="application/pdf,image/*,.zip,application/zip,application/x-zip-compressed" className="hidden" onChange={(e) => { void carica(Array.from(e.target.files || [])); }} />
      <details className="mt-2">
        <summary className="text-xs text-slate-500 cursor-pointer">Se il nome del file non dice tipo o data</summary>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="px-2 py-1.5 text-sm rounded-lg border border-slate-200" aria-label="Tipo di documento">
            <option value="auto">Tipo: dal nome del file</option>
            {DOC_RAPPORTO_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="px-2 py-1.5 text-sm rounded-lg border border-slate-200" title="Data se il nome del file non la dice (altrimenti oggi)" aria-label="Data del documento se il nome del file non la dice" />
          <input value={descr} onChange={(e) => setDescr(e.target.value)} placeholder="Descrizione (un file solo)" className="px-2 py-1.5 text-sm rounded-lg border border-slate-200" />
        </div>
      </details>
      {esiti.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" aria-live="polite">
          {esiti.map((e, i) => (
            <li key={`${e.nome}-${i}`} className={e.stato === 'ok' ? 'text-emerald-700' : e.stato === 'gia' ? 'text-slate-500' : e.stato === 'errore' ? 'text-rose-700' : 'text-slate-400'}>
              {e.stato === 'ok' ? '✓' : e.stato === 'gia' ? '•' : e.stato === 'errore' ? '✗' : '…'} {e.nome}{e.testo ? ` · ${e.testo}` : e.stato === 'attesa' ? ' · in coda' : ''}
            </li>
          ))}
        </ul>
      )}
      {chiusura && (
        <div role="status" className={`mt-2 rounded-lg border px-3 py-2 text-sm ${chiusura.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{chiusura.testo}</div>
      )}
      <div className="text-xs text-slate-400 mt-1.5">I documenti restano come storico: uno nuovo si aggiunge, non sostituisce i precedenti. Un file con lo stesso nome e la stessa dimensione di uno già archiviato non si ricarica.</div>
      </>)}
    </div>
  );
}

// ── Netti dell'anno: come nella finestra di prima, con il cambio d'anno ─────────────
function NettiAnno({ employeeId, companyId, costi, puoSalvare, onSalvato }: { employeeId: string; companyId: string; costi: EmployeeCost[]; puoSalvare: boolean; onSalvato: () => Promise<void> }) {
  // conferme dentro il gestionale, non del browser (Patrizio, 26/11/2026)
  const { conferma } = useConferma()
  const { toast } = useToast();
  const annoOggi = new Date().getFullYear();
  const anni = useMemo(() => {
    const s = new Set<number>([annoOggi - 2, annoOggi - 1, annoOggi, annoOggi + 1, ...costi.map((c) => c.year)]);
    return [...s].sort((a, b) => b - a);
  }, [costi, annoOggi]);
  const [anno, setAnno] = useState(annoOggi);
  const nettiDi = useCallback((a: number): Record<number, string> => {
    const out: Record<number, string> = {};
    for (let m = 1; m <= 12; m++) {
      const c = costi.find((x) => x.year === a && x.month === m);
      out[m] = c?.netto != null ? eurFmt.format(Number(c.netto)) : '';
    }
    return out;
  }, [costi]);
  const iniziali = useMemo(() => nettiDi(anno), [nettiDi, anno]);
  const [vals, setVals] = useState<Record<number, string>>(iniziali);
  useEffect(() => { setVals(iniziali); }, [iniziali]);
  const [salvo, setSalvo] = useState(false);
  const totale = Object.values(vals).reduce<number>((s, v) => s + (parseItNum(v) || 0), 0);
  const mesiCompilati = Object.values(vals).filter((v) => parseItNum(v) != null).length;

  const cambiaAnno = async (a: number) => {
    const sporco = Object.keys(iniziali).some((m) => (vals[Number(m)] ?? '') !== iniziali[Number(m)]);
    if (sporco && !(await conferma({ titolo: 'Cambiare anno?', testo: `Hai netti del ${anno} non salvati: cambiando anno si perdono.`, ok: 'Cambia lo stesso', annulla: 'Resta qui', pericolo: true }))) return;
    setAnno(a);
  };

  const salva = async () => {
    setSalvo(true);
    try {
      const righe: Record<string, unknown>[] = [];
      for (let m = 1; m <= 12; m++) {
        const n = parseItNum(vals[m]);
        const cera = iniziali[m] !== '';
        // Cedolino «manuale»: vale come totale del mese e non cancella i cedolini degli import.
        const base = { employee_id: employeeId, company_id: companyId, year: anno, month: m, tipo: 'manuale', source: 'scheda_dipendente', updated_at: new Date().toISOString() };
        if (n != null) righe.push({ ...base, netto: n });
        else if (cera) righe.push({ ...base, netto: null });
      }
      if (righe.length) {
        const { rows } = keepLastByKey(righe, (r) => `${r.employee_id}|${r.year}|${r.month}|${r.tipo}`);
        const { error } = await supabase.from('employee_cost_slips').upsert(rows as never, { onConflict: 'company_id,employee_id,year,month,tipo' });
        if (error) throw error;
      }
      await onSalvato();
    } catch (err) {
      toast({ type: 'error', message: 'Errore nel salvataggio: ' + ((err as Error)?.message || '') });
    } finally { setSalvo(false); }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="font-semibold text-slate-900 inline-flex items-center gap-2">Netti del
          <select value={anno} onChange={(e) => cambiaAnno(Number(e.target.value))} aria-label="Anno dei netti" className="px-1.5 py-0.5 text-sm font-semibold rounded-md border border-slate-300 bg-white">
            {anni.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </h2>
        <span className="text-sm text-slate-500">{mesiCompilati} mesi · <b className="tabular-nums text-emerald-700">{eurFmt.format(totale)}&nbsp;€</b></span>
      </div>
      <p className="mb-3 text-xs text-slate-600 leading-relaxed">
        Il <b>netto del mese</b> come arriva dalla busta paga. La 13ª (dicembre) e la 14ª (giugno) arrivano dall'Elenco netti come cedolini a parte; se scrivi tu il netto, mettici anche la mensilità aggiuntiva. I valori scritti a mano sono provvisori: l'Elenco netti del mese li sostituisce con il dato ufficiale.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {MESI.map((nome, i) => {
          const m = i + 1;
          return (
            <label key={m} className="block">
              <span className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                {nome}
                {m === 12 && <span className="text-[10px] px-1 rounded bg-amber-50 text-amber-700">+13ª</span>}
                {m === 6 && <span className="text-[10px] px-1 rounded bg-amber-50 text-amber-700">+14ª</span>}
              </span>
              <div className="relative">
                <input value={vals[m] ?? ''} onChange={(e) => setVals((s) => ({ ...s, [m]: e.target.value }))} placeholder="—" inputMode="decimal"
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-slate-200 tabular-nums text-right pr-6" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">€</span>
              </div>
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        {!puoSalvare ? <span className="text-xs text-slate-400">Con il profilo di sola lettura i netti si guardano ma non si salvano.</span> : (
        <button type="button" onClick={salva} disabled={salvo} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 inline-flex items-center gap-1.5"><Save size={15} /> {salvo ? 'Salvataggio…' : 'Salva netti'}</button>
        )}
      </div>
    </section>
  );
}

// ── Ripartizione del costo fra i negozi (era la finestra «Allocazione per outlet») ──
function RipartizioneModal({ employeeId, companyId, allocs, outlets, onClose, onSalvato }: {
  employeeId: string; companyId: string; allocs: Allocazione[]; outlets: OutletRow[]; onClose: () => void; onSalvato: () => Promise<void>;
}) {
  const [righe, setRighe] = useState<{ outlet_code: string; allocation_pct: number }[]>(() => {
    const cur = allocs.map((a) => ({ outlet_code: a.outlet_code, allocation_pct: Number(a.allocation_pct || 0) }));
    return cur.length ? cur : [{ outlet_code: '', allocation_pct: 100 }];
  });
  const [errore, setErrore] = useState('');
  // i negozi attivi, piu' quelli non piu' attivi che hanno gia' una quota (come CorreggiPersona):
  // altrimenti la riga apparirebbe vuota e la quota resterebbe senza che si veda
  const giaUsati = new Set(allocs.map((a) => a.outlet_code).filter(Boolean));
  const attivi = [
    ...outlets.filter((o) => o.is_active !== false || giaUsati.has(o.name)),
    ...[...giaUsati].filter((c) => !outlets.some((o) => o.name === c)).map((c) => ({ id: `codice-${c}`, name: c, code: null, is_active: false })),
  ];
  const salva = async () => {
    const totale = righe.reduce((s, a) => s + (Number(a.allocation_pct) || 0), 0);
    if (totale > 100.01) { setErrore(`Le quote sommano ${totale.toFixed(1)}%: il massimo è 100%`); return; }
    if (righe.some((a) => !a.outlet_code)) { setErrore('Scegli un negozio per ogni riga'); return; }
    try {
      await supabase.from('employee_outlet_allocations').delete().eq('employee_id', employeeId);
      const nuove = righe.filter((a) => a.outlet_code && Number(a.allocation_pct) > 0)
        .map((a) => ({ employee_id: employeeId, company_id: companyId, outlet_code: a.outlet_code, allocation_pct: Number(a.allocation_pct) || 0 }));
      if (nuove.length) {
        const { error } = await supabase.from('employee_outlet_allocations').insert(nuove);
        if (error) throw error;
      }
      await onSalvato();
    } catch (err) {
      setErrore('Errore nel salvataggio: ' + ((err as Error)?.message || ''));
    }
  };
  return (
    <Modal open onClose={onClose} title="Ripartizione del costo fra i negozi" maxWidthClass="max-w-lg">
      <div className="space-y-3">
        {righe.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <select value={a.outlet_code} onChange={(e) => setRighe((p) => p.map((x, j) => (j === i ? { ...x, outlet_code: e.target.value } : x)))}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-slate-200" aria-label="Negozio">
              <option value="">Scegli il negozio…</option>
              {attivi.map((o) => <option key={o.id} value={o.name}>{o.name}{o.is_active === false ? ' (non più attivo)' : ''}</option>)}
            </select>
            <div className="relative w-28">
              <input type="number" value={a.allocation_pct} min={0} max={100} aria-label="Quota"
                onChange={(e) => setRighe((p) => p.map((x, j) => (j === i ? { ...x, allocation_pct: Number(e.target.value) } : x)))}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 pr-7 tabular-nums" />
              <Percent size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <button type="button" onClick={() => setRighe((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" title="Togli il negozio" aria-label="Togli il negozio"><Trash2 size={16} /></button>
          </div>
        ))}
        <button type="button" onClick={() => setRighe((p) => [...p, { outlet_code: '', allocation_pct: 0 }])} className="text-sm text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"><Plus size={14} /> Aggiungi un negozio</button>
        {errore && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} />{errore}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
          <button type="button" onClick={() => void salva()} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 inline-flex items-center gap-1.5"><Save size={15} /> Salva</button>
        </div>
      </div>
    </Modal>
  );
}

// ── Cessazione: il record resta in archivio ─────────────────────────────────────────
function CessaModal({ emp, onClose, onSalvato }: { emp: Employee; onClose: () => void; onSalvato: () => Promise<void> }) {
  const { toast } = useToast();
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const conferma = async () => {
    if (!data) { toast({ type: 'error', message: 'Indica la data di cessazione' }); return; }
    const { error } = await supabase.from('employees').update({ is_active: false, data_cessazione: data, termination_date: data }).eq('id', emp.id);
    if (error) { toast({ type: 'error', message: 'Errore nella cessazione: ' + error.message }); return; }
    toast({ type: 'success', message: 'Dipendente cessato (resta in archivio)' });
    await onSalvato();
  };
  return (
    <Modal open onClose={onClose} title="Cessazione dipendente" maxWidthClass="max-w-md">
      <p className="text-sm text-slate-600 mb-4">
        Cessazione di <strong>{nomeCompleto(emp)}</strong>. La scheda <strong>non viene cancellata</strong>: resta in archivio fra i cessati con la data indicata.
      </p>
      <label className="block"><span className="text-xs text-slate-500 mb-1 block">Data di cessazione *</span>
        <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200" />
      </label>
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Annulla</button>
        <button type="button" onClick={() => void conferma()} className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700">Conferma cessazione</button>
      </div>
    </Modal>
  );
}
