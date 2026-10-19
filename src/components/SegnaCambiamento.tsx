// «Segna un cambiamento»: il modulo con cui chi tiene l'organico registra
// cio' che succede a una persona prima che lo studio paghe lo riporti
// (maternita', proroga, non rinnovo, cambio d'orario...), oppure aggiunge una
// persona nuova. La scheda dello studio non si tocca: si scrive un
// cambiamento (employee_events) con la sua data.
//
// Prima di salvare mostra cosa succede: i turni che la persona non potra'
// fare e le ferie gia' approvate dopo quella data. Salvando, i turni non
// piu' possibili si tolgono (le proposte in bozza) o si annullano con il
// motivo (quelli messi a mano o pubblicati): non si cancella niente che
// qualcuno abbia deciso.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, FileUp, Info } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useToast } from './Toast';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import {
  ETICHETTE_TIPO_EVENTO, DESCRIZIONE_TIPO_EVENTO, aggiungiGiorni, formattaDataBreve, nomePersona, oggiRoma,
  type PersonaOggi, type TipoEvento,
} from '../lib/organico';
import { nomeNegozio, type NegozioRif } from '../lib/organicoDati';

type Props = {
  open: boolean;
  onClose: () => void;
  onSalvato: () => void;
  companyId: string;
  persone: PersonaOggi[];
  negozi: NegozioRif[];
  /** persona gia' scelta (dal pulsante sulla riga) */
  employeeId?: string | null;
  tipoIniziale?: TipoEvento | null;
  /** true = aggiungi una persona nuova */
  nuovaPersona?: boolean;
};

const TIPI_PERSONA: TipoEvento[] = [
  'assenza_lunga', 'non_rinnovo', 'proroga', 'cessazione',
  'cambio_orario', 'cambio_negozio', 'trasformazione_indeterminato', 'rientro', 'altro',
];

const MOTIVI_ASSENZA = ['maternità', 'malattia lunga', 'infortunio', 'aspettativa', 'altro'];
const MOTIVI_USCITA = ['licenziamento', 'dimissioni', 'fine periodo di prova', 'risoluzione consensuale', 'altro'];

const inputCls = 'w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

export default function SegnaCambiamento({
  open, onClose, onSalvato, companyId, persone, negozi, employeeId, tipoIniziale, nuovaPersona,
}: Props) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const autore = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || null;
  const oggi = oggiRoma();

  const [chi, setChi] = useState<string>('');
  const [tipo, setTipo] = useState<TipoEvento>('assenza_lunga');
  const [motivo, setMotivo] = useState('');
  const [dal, setDal] = useState(oggi);
  const [al, setAl] = useState('');
  const [ore, setOre] = useState('');
  const [negozio, setNegozio] = useState('');
  const [nota, setNota] = useState('');
  const [file, setFile] = useState<File | null>(null);
  // persona nuova
  const [nome, setNome] = useState('');
  const [cognome, setCognome] = useState('');
  const [contratto, setContratto] = useState('determinato');
  const [livello, setLivello] = useState('4 Livello');

  const [effetti, setEffetti] = useState<{ turni: number; turniDaAnnullare: number; ferie: number } | null>(null);
  const [salvo, setSalvo] = useState(false);

  const persona = persone.find((p) => p.scheda.id === chi) ?? null;

  // Ogni apertura riparte pulita, con la persona e il tipo passati.
  useEffect(() => {
    if (!open) return;
    setChi(employeeId ?? '');
    const t = nuovaPersona ? 'assunzione' : (tipoIniziale ?? 'assenza_lunga');
    setTipo(t);
    setMotivo(''); setAl(''); setOre(''); setNegozio(''); setNota(''); setFile(null);
    setNome(''); setCognome(''); setContratto('determinato'); setLivello('4 Livello');
    setDal(oggi);
    setEffetti(null);
  }, [open, employeeId, tipoIniziale, nuovaPersona, oggi]);

  // Date proposte in base al tipo: il non rinnovo finisce alla scadenza, la
  // proroga parte il giorno dopo.
  useEffect(() => {
    if (!persona) return;
    if (tipo === 'non_rinnovo' && persona.scadenza) setDal(persona.scadenza);
    if (tipo === 'proroga' && persona.scadenza) setDal(aggiungiGiorni(persona.scadenza, 1));
    if ((tipo === 'cambio_orario' || tipo === 'proroga' || tipo === 'trasformazione_indeterminato') && persona.ore != null) setOre(String(persona.ore));
  }, [tipo, persona]);

  // Cosa succede: turni e ferie dopo la data, per chi esce o si assenta.
  const toglieDaiTurni = tipo === 'assenza_lunga' || tipo === 'cessazione' || tipo === 'non_rinnovo' || tipo === 'cambio_negozio';
  const primoGiornoFuori = tipo === 'cessazione' || tipo === 'non_rinnovo' ? aggiungiGiorni(dal, 1) : dal;
  useEffect(() => {
    let vivo = true;
    if (!open || !chi || nuovaPersona || !toglieDaiTurni || !dal) { setEffetti(null); return; }
    (async () => {
      const fineAssenza = tipo === 'assenza_lunga' && al ? al : null;
      let q = supabase.from('shifts').select('id, origine, stato, data')
        .eq('company_id', companyId).eq('employee_id', chi).neq('stato', 'annullato').gte('data', primoGiornoFuori);
      if (fineAssenza) q = q.lt('data', fineAssenza);
      const [{ data: turni }, { data: ferie }] = await Promise.all([
        q,
        supabase.from('leave_request_days').select('data, stato, leave_requests!inner(employee_id, stato)')
          .eq('company_id', companyId).eq('leave_requests.employee_id', chi).gte('data', primoGiornoFuori).eq('stato', 'approvato'),
      ]);
      if (!vivo) return;
      const t = (turni as { origine: string; stato: string }[]) ?? [];
      setEffetti({
        turni: t.length,
        turniDaAnnullare: t.filter((x) => !(x.origine === 'proposta' && x.stato === 'bozza')).length,
        ferie: ((ferie as unknown[]) ?? []).length,
      });
    })();
    return () => { vivo = false; };
  }, [open, chi, tipo, dal, al, primoGiornoFuori, companyId, nuovaPersona, toglieDaiTurni]);

  const errore = useMemo((): string | null => {
    if (nuovaPersona) {
      if (!nome.trim() || !cognome.trim()) return 'Servono nome e cognome.';
      if (!negozio) return 'Scegli il negozio.';
      if (!ore || Number(ore) <= 0 || Number(ore) > 48) return 'Indica le ore settimanali.';
      if (contratto === 'determinato' && !al) return 'Per un determinato serve la scadenza.';
      if (al && al < dal) return 'La scadenza viene prima dell’assunzione.';
      return null;
    }
    if (!chi) return 'Scegli la persona.';
    if (!dal) return 'Serve la data.';
    if (tipo === 'proroga' && !al) return 'Indica la nuova scadenza.';
    if (al && al < dal) return 'La seconda data viene prima della prima.';
    if (tipo === 'cambio_orario' && (!ore || Number(ore) <= 0 || Number(ore) > 48)) return 'Indica le nuove ore settimanali.';
    if ((tipo === 'proroga' || tipo === 'trasformazione_indeterminato') && ore && (Number(ore) <= 0 || Number(ore) > 48)) return 'Le ore settimanali vanno da 1 a 48.';
    if (tipo === 'cambio_negozio' && !negozio) return 'Scegli il negozio.';
    if (tipo === 'altro' && !nota.trim()) return 'Scrivi cosa è successo.';
    return null;
  }, [nuovaPersona, nome, cognome, negozio, ore, contratto, al, dal, chi, tipo, nota]);

  const caricaDocumento = async (empId: string): Promise<{ path: string; nome: string } | null> => {
    if (!file) return null;
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `employee-documents/${empId}/${dal}_variazione_${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('employee-documents').upload(path, file);
    if (upErr) throw new Error(`Documento non caricato: ${upErr.message}`);
    const [y, m] = dal.split('-').map(Number);
    // Il documento resta anche nella scheda della persona, come storico.
    await supabase.from('employee_documents').insert([{
      employee_id: empId, company_id: companyId, doc_type: 'variazione', year: y, month: m,
      file_name: file.name, file_path: path, file_size: file.size, status: 'archiviato',
    }]);
    return { path, nome: file.name };
  };

  const salva = async () => {
    if (errore || salvo) return;
    setSalvo(true);
    try {
      if (nuovaPersona) {
        const { data: nuovoId, error } = await supabase.rpc('organico_nuova_persona', {
          p_nome: nome.trim(), p_cognome: cognome.trim(), p_outlet_id: negozio,
          p_contratto_tipo: contratto, p_ore_settimanali: Number(ore),
          p_data_assunzione: dal, p_scadenza: contratto === 'determinato' ? al : (null as unknown as string),
          p_livello: livello, p_nota: nota.trim(), p_autore_nome: autore ?? '',
        });
        if (error) throw error;
        if (file && nuovoId) {
          const doc = await caricaDocumento(String(nuovoId));
          if (doc) {
            await supabase.from('employee_events').update({ documento_path: doc.path, documento_nome: doc.nome })
              .eq('employee_id', String(nuovoId)).eq('tipo', 'assunzione');
          }
        }
        toast({ type: 'success', message: `${cognome.trim()} ${nome.trim()} aggiunta all'organico dal ${formattaDataBreve(dal)}.` });
      } else {
        const doc = await caricaDocumento(chi);
        const { error } = await supabase.from('employee_events').insert([{
          company_id: companyId,
          employee_id: chi,
          tipo,
          motivo: motivo || null,
          data_dal: dal,
          data_al: al || null,
          // Proroga e passaggio a indeterminato possono cambiare l'orario:
          // le ore si scrivono solo se sono diverse da quelle di oggi.
          ore_settimanali: tipo === 'cambio_orario' ? Number(ore)
            : (tipo === 'proroga' || tipo === 'trasformazione_indeterminato') && ore && Number(ore) !== persona?.ore ? Number(ore)
            : null,
          outlet_id: tipo === 'cambio_negozio' ? negozio : null,
          contratto_tipo: tipo === 'trasformazione_indeterminato' ? 'indeterminato' : null,
          nota: nota.trim() || null,
          documento_path: doc?.path ?? null,
          documento_nome: doc?.nome ?? null,
          created_by_nome: autore,
        }]);
        if (error) throw error;

        // I turni che la persona non puo' piu' fare.
        let tolti = 0;
        if (toglieDaiTurni) {
          const fineAssenza = tipo === 'assenza_lunga' && al ? al : null;
          let q = supabase.from('shifts').select('id, origine, stato')
            .eq('company_id', companyId).eq('employee_id', chi).neq('stato', 'annullato').gte('data', primoGiornoFuori);
          if (fineAssenza) q = q.lt('data', fineAssenza);
          const { data: turni } = await q;
          const tutti = (turni as { id: string; origine: string; stato: string }[]) ?? [];
          const bozze = tutti.filter((t) => t.origine === 'proposta' && t.stato === 'bozza').map((t) => t.id);
          const decisi = tutti.filter((t) => !(t.origine === 'proposta' && t.stato === 'bozza')).map((t) => t.id);
          if (bozze.length) await supabase.from('shifts').delete().in('id', bozze);
          if (decisi.length) {
            await supabase.from('shifts').update({
              stato: 'annullato',
              annullato_motivo: `${ETICHETTE_TIPO_EVENTO[tipo]} dal ${formattaDataBreve(dal)}`,
            }).in('id', decisi);
          }
          tolti = tutti.length;
        }
        toast({
          type: 'success',
          message: `Cambiamento segnato${persona ? ` per ${nomePersona(persona.scheda)}` : ''}.${tolti ? ` ${tolti} turni tolti: rifai la proposta di quelle settimane in «Turni».` : ''}`,
        });
      }
      onSalvato();
      onClose();
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Salvataggio non riuscito.' });
    } finally {
      setSalvo(false);
    }
  };

  const personeOrdinate = useMemo(() => [...persone]
    .filter((p) => p.stato !== 'cessato' || p.scheda.id === chi)
    .sort((a, b) => nomePersona(a.scheda).localeCompare(nomePersona(b.scheda), 'it')), [persone, chi]);
  const negoziAttivi = negozi.filter((n) => n.is_active !== false);

  return (
    <Modal open={open} onClose={onClose} title={nuovaPersona ? 'Aggiungi una persona' : 'Segna un cambiamento'}
      maxWidthClass="max-w-3xl" closeOnBackdrop={false}>
      <div className="flex flex-col md:flex-row gap-5">
        <div className="flex-1 min-w-0 space-y-4">
          {nuovaPersona ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={labelCls} htmlFor="sc-nome">Nome</label><input id="sc-nome" className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} /></div>
                <div><label className={labelCls} htmlFor="sc-cognome">Cognome</label><input id="sc-cognome" className={inputCls} value={cognome} onChange={(e) => setCognome(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="sc-negozio">Negozio</label>
                  <select id="sc-negozio" className={inputCls} value={negozio} onChange={(e) => setNegozio(e.target.value)}>
                    <option value="">Scegli…</option>
                    {negoziAttivi.map((n) => <option key={n.id} value={n.id}>{nomeNegozio(n)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls} htmlFor="sc-contratto">Contratto</label>
                  <select id="sc-contratto" className={inputCls} value={contratto} onChange={(e) => setContratto(e.target.value)}>
                    <option value="determinato">Tempo determinato</option>
                    <option value="indeterminato">Tempo indeterminato</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls} htmlFor="sc-ore">Ore settimanali</label><input id="sc-ore" type="number" min={1} max={48} step={0.5} className={inputCls} value={ore} onChange={(e) => setOre(e.target.value)} /></div>
                <div>
                  <label className={labelCls} htmlFor="sc-livello">Livello</label>
                  <select id="sc-livello" className={inputCls} value={livello} onChange={(e) => setLivello(e.target.value)}>
                    {['1 Livello', '2 Livello', '3 Livello', '4 Livello', '5 Livello', '6 Livello'].map((l) => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div><label className={labelCls} htmlFor="sc-dal">Assunta dal</label><input id="sc-dal" type="date" className={inputCls} value={dal} onChange={(e) => setDal(e.target.value)} /></div>
              </div>
              {contratto === 'determinato' && (
                <div className="max-w-[220px]"><label className={labelCls} htmlFor="sc-al">Scadenza del contratto</label><input id="sc-al" type="date" className={inputCls} value={al} onChange={(e) => setAl(e.target.value)} /></div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className={labelCls} htmlFor="sc-chi">Chi</label>
                <select id="sc-chi" className={inputCls} value={chi} onChange={(e) => setChi(e.target.value)}>
                  <option value="">Scegli la persona…</option>
                  {personeOrdinate.map((p) => (
                    <option key={p.scheda.id} value={p.scheda.id}>
                      {nomePersona(p.scheda)} · {nomeNegozio(negozi.find((n) => n.id === p.outletId))}
                    </option>
                  ))}
                </select>
                {persona && (
                  <p className="text-xs text-slate-500 mt-1">
                    {persona.contratto ?? 'contratto non indicato'}{persona.ore != null ? ` · ${persona.ore} ore` : ''}
                    {persona.scadenza ? ` · scadenza ${formattaDataBreve(persona.scadenza)}` : ''}
                  </p>
                )}
              </div>

              <fieldset>
                <legend className={labelCls}>Cosa è successo</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TIPI_PERSONA.map((t) => (
                    <button key={t} type="button" onClick={() => setTipo(t)} aria-pressed={tipo === t}
                      className={`text-left rounded-lg border px-3 py-2 min-h-[44px] ${tipo === t ? 'border-blue-600 ring-1 ring-blue-600 bg-blue-50' : 'border-slate-300 hover:bg-slate-50'}`}>
                      <span className="block text-sm font-semibold text-slate-800">{ETICHETTE_TIPO_EVENTO[t]}</span>
                      <span className="block text-xs text-slate-500">{DESCRIZIONE_TIPO_EVENTO[t]}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {(tipo === 'assenza_lunga' || tipo === 'cessazione') && (
                <div>
                  <label className={labelCls} htmlFor="sc-motivo">Motivo</label>
                  <select id="sc-motivo" className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                    <option value="">Scegli…</option>
                    {(tipo === 'assenza_lunga' ? MOTIVI_ASSENZA : MOTIVI_USCITA).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls} htmlFor="sc-dal">
                    {tipo === 'cessazione' || tipo === 'non_rinnovo' ? 'Ultimo giorno di lavoro' : tipo === 'proroga' ? 'Dal' : 'Da quando'}
                  </label>
                  <input id="sc-dal" type="date" className={inputCls} value={dal} onChange={(e) => setDal(e.target.value)} />
                </div>
                {tipo === 'assenza_lunga' && (
                  <div><label className={labelCls} htmlFor="sc-al">Rientro previsto (se lo sai)</label><input id="sc-al" type="date" className={inputCls} value={al} onChange={(e) => setAl(e.target.value)} /></div>
                )}
                {tipo === 'proroga' && (
                  <div><label className={labelCls} htmlFor="sc-al">Nuova scadenza</label><input id="sc-al" type="date" className={inputCls} value={al} onChange={(e) => setAl(e.target.value)} /></div>
                )}
                {(tipo === 'proroga' || tipo === 'trasformazione_indeterminato') && (
                  <div>
                    <label className={labelCls} htmlFor="sc-ore-rinnovo">Ore settimanali {tipo === 'proroga' ? 'dal rinnovo' : 'da indeterminato'}</label>
                    <input id="sc-ore-rinnovo" type="number" min={1} max={48} step={0.5} className={inputCls} value={ore} onChange={(e) => setOre(e.target.value)} />
                    <p className="text-xs text-slate-500 mt-1">
                      {persona?.ore != null && ore && Number(ore) !== persona.ore
                        ? `Da ${persona.ore} a ${ore} ore dal ${formattaDataBreve(dal)}.`
                        : 'Cambiale solo se il nuovo contratto ha più o meno ore.'}
                    </p>
                  </div>
                )}
                {tipo === 'cambio_orario' && (
                  <div><label className={labelCls} htmlFor="sc-ore">Nuove ore settimanali</label><input id="sc-ore" type="number" min={1} max={48} step={0.5} className={inputCls} value={ore} onChange={(e) => setOre(e.target.value)} /></div>
                )}
                {tipo === 'cambio_negozio' && (
                  <div>
                    <label className={labelCls} htmlFor="sc-negozio">Nuovo negozio</label>
                    <select id="sc-negozio" className={inputCls} value={negozio} onChange={(e) => setNegozio(e.target.value)}>
                      <option value="">Scegli…</option>
                      {negoziAttivi.map((n) => <option key={n.id} value={n.id}>{nomeNegozio(n)}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </>
          )}

          <div>
            <label className={labelCls} htmlFor="sc-nota">Nota per lo studio paghe {tipo === 'altro' ? '' : '(facoltativa)'}</label>
            <textarea id="sc-nota" rows={2} className={`${inputCls} py-2`} value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap border border-dashed border-slate-300 rounded-lg p-3">
            <span className="text-sm text-slate-600">{file ? file.name : 'Documento (facoltativo): lettera, PEC, certificato'}</span>
            <label className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 cursor-pointer">
              <FileUp size={15} /> {file ? 'Cambia file' : 'Allega un file'}
              <input type="file" accept=".pdf,image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        <aside className="md:w-72 shrink-0 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 text-sm">
          <h3 className="font-semibold text-slate-800">Cosa succede quando salvi</h3>
          {nuovaPersona ? (
            <>
              <p className="text-slate-600">La persona entra nell'organico dal {formattaDataBreve(dal)} e si può mettere nei turni del negozio.</p>
              <p className="text-slate-600">Resta segnata «da confermare» finché lo studio paghe non elabora il suo primo cedolino.</p>
            </>
          ) : (
            <>
              {toglieDaiTurni && (
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="flex items-center gap-1.5 text-xs text-slate-500"><CalendarClock size={13} /> Turni dal {formattaDataBreve(primoGiornoFuori)}</div>
                  <p className="mt-1 text-slate-800">
                    {effetti == null ? '…' : effetti.turni === 0 ? 'Nessun turno già pianificato.' : `${effetti.turni} turni non si potranno fare: si tolgono${effetti.turniDaAnnullare ? ` (${effetti.turniDaAnnullare} già decisi restano visibili come annullati)` : ''}.`}
                  </p>
                </div>
              )}
              {toglieDaiTurni && effetti && effetti.ferie > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900 flex gap-2">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                  <span>{effetti.ferie} giorni di ferie già approvati dopo quella data: vanno ritirati dalla richiesta in «Ferie e permessi».</span>
                </div>
              )}
              <div className="bg-white border border-slate-200 rounded-lg p-3 flex gap-2 text-slate-700">
                <Info size={15} className="shrink-0 mt-0.5 text-slate-400" />
                <span>Resta «da confermare» finché un documento dello studio non dice la stessa cosa. La scheda dello studio non cambia.</span>
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        {errore && <span className="text-sm text-amber-700 mr-auto">{errore}</span>}
        <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button type="button" onClick={salva} disabled={!!errore || salvo}
          className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {salvo ? 'Salvo…' : 'Salva'}
        </button>
      </div>
    </Modal>
  );
}
