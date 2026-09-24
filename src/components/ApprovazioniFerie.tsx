// Approvazione delle richieste di ferie, e chi le approva.
//
// Fase 3 del piano ferie. Due cose in una pagina:
//   1. le richieste in attesa, da decidere anche solo in parte: si
//      tolgono i giorni che non si concedono e si scrive il perche';
//   2. l'elenco dei referenti, perche' chi decide non e' un ruolo. Sui
//      dati veri di New Zago, dei tre referenti nominati uno e' contabile,
//      una e' viewer (sola lettura) e uno non ha nemmeno un account: senza
//      un elenco, due su tre resterebbero fuori.
//
// La decisione passa dalla funzione leave_decidi: tocca i giorni, la
// richiesta e la traccia tutti insieme, e controlla i permessi in un posto
// solo. Il rifiuto, anche di un giorno solo, vuole sempre un motivo.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, UserPlus, Trash2, Mail,
  ShieldCheck, ChevronDown, ChevronRight, History,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import {
  ETICHETTE_VOCE_BREVI, formattaOre, formattaData, formattaDataLunga,
  totaliPerVoce, type VoceFerie, type GiornoRichiesto,
} from '../lib/ferieRichiesta';
import SovrapposizioniOutlet from './SovrapposizioniOutlet';

type Props = { companyId?: string; userId?: string | null };

type GiornoConId = GiornoRichiesto & { id: string; stato: string };

type Richiesta = {
  id: string;
  employee_id: string;
  stato: string;
  titolo: string | null;
  note_dipendente: string | null;
  motivazione: string | null;
  outlet_code: string | null;
  origine: string;
  inviata_il: string | null;
  decisa_il: string | null;
  decisa_da_nome: string | null;
  created_at: string;
  dipendente: string;
  /** Il punto vendita della persona, dall'anagrafica: serve a mostrare chi
   *  altro e' via negli stessi giorni. outlet_code sulla richiesta e' solo
   *  un'etichetta scritta al momento dell'invio. */
  outlet_id: string | null;
  outlet_nome: string | null;
  giorni: GiornoConId[];
};

type Referente = {
  id: string;
  user_id: string | null;
  email: string | null;
  nome: string;
  outlet_code: string | null;
  attivo: boolean;
};

type Utente = { id: string; nome: string; email: string | null; ruolo: string };

const ETICHETTE_STATO: Record<string, string> = {
  inviata: 'In attesa di risposta',
  approvata: 'Approvata',
  approvata_parziale: 'Approvata in parte',
  respinta: 'Respinta',
  ritirata: 'Ritirata',
  chiusa: 'Chiusa',
  bozza: 'Bozza',
};

const COLORE_STATO: Record<string, string> = {
  inviata: 'bg-amber-100 text-amber-700',
  approvata: 'bg-emerald-100 text-emerald-700',
  approvata_parziale: 'bg-emerald-50 text-emerald-700',
  respinta: 'bg-rose-100 text-rose-700',
  ritirata: 'bg-slate-100 text-slate-500',
  chiusa: 'bg-blue-100 text-blue-700',
  bozza: 'bg-slate-100 text-slate-600',
};

const VOCI_ORDINE: VoceFerie[] = ['F01', 'F02', 'F03'];

const periodo = (giorni: { data: string }[]): string => {
  if (!giorni.length) return 'senza giorni';
  const d = giorni.map((g) => g.data).sort();
  return d.length === 1 ? formattaData(d[0]) : `dal ${formattaData(d[0])} al ${formattaData(d[d.length - 1])}`;
};

export default function ApprovazioniFerie({ companyId, userId }: Props) {
  const { toast } = useToast();

  const [richieste, setRichieste] = useState<Richiesta[]>([]);
  const [referenti, setReferenti] = useState<Referente[]>([]);
  const [utenti, setUtenti] = useState<Utente[]>([]);
  const [outlet, setOutlet] = useState<string[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [salvataggio, setSalvataggio] = useState(false);

  // Per ogni richiesta aperta: quali giorni restano concessi e il motivo.
  const [aperta, setAperta] = useState<string | null>(null);
  const [concessi, setConcessi] = useState<Set<string>>(new Set());
  const [motivo, setMotivo] = useState('');
  const [vediDecise, setVediDecise] = useState(false);

  // Nuovo referente
  const [nuovoTipo, setNuovoTipo] = useState<'utente' | 'email'>('utente');
  const [nuovoUtente, setNuovoUtente] = useState('');
  const [nuovoNome, setNuovoNome] = useState('');
  const [nuovaEmail, setNuovaEmail] = useState('');
  const [nuovoOutlet, setNuovoOutlet] = useState('');

  const carica = useCallback(async () => {
    if (!companyId) return;
    setCaricamento(true);
    try {
      const [req, days, emp, appr, prof, out] = await Promise.all([
        supabase.from('leave_requests')
          .select('id, employee_id, stato, titolo, note_dipendente, motivazione, outlet_code, origine, inviata_il, decisa_il, decisa_da_nome, created_at')
          .eq('company_id', companyId)
          .neq('stato', 'bozza')
          .order('inviata_il', { ascending: false, nullsFirst: false }),
        supabase.from('leave_request_days')
          .select('id, request_id, data, voce, tipo, ore, nota, stato')
          .eq('company_id', companyId),
        supabase.from('employees').select('id, nome, cognome, first_name, last_name, outlet_id').eq('company_id', companyId),
        supabase.from('leave_approvers').select('id, user_id, email, nome, outlet_code, attivo')
          .eq('company_id', companyId).order('nome'),
        supabase.from('user_profiles').select('id, first_name, last_name, email, role')
          .eq('company_id', companyId).eq('is_active', true),
        supabase.from('outlets').select('id, name').eq('company_id', companyId).eq('is_active', true).order('name'),
      ]);

      const nomiOutlet = new Map<string, string>();
      for (const o of (out.data as { id: string; name: string }[]) ?? []) {
        nomiOutlet.set(String(o.id), o.name);
      }

      const nomi = new Map<string, string>();
      const outletDi = new Map<string, string | null>();
      for (const e of (emp.data as Record<string, unknown>[]) ?? []) {
        const cognome = (e.cognome as string) ?? (e.last_name as string) ?? '';
        const nome = (e.nome as string) ?? (e.first_name as string) ?? '';
        nomi.set(String(e.id), `${cognome} ${nome}`.trim());
        outletDi.set(String(e.id), (e.outlet_id as string) ?? null);
      }

      const perRichiesta = new Map<string, GiornoConId[]>();
      for (const g of (days.data as (GiornoConId & { request_id: string })[]) ?? []) {
        if (!perRichiesta.has(g.request_id)) perRichiesta.set(g.request_id, []);
        perRichiesta.get(g.request_id)!.push({ ...g, ore: Number(g.ore) });
      }

      setRichieste(((req.data as Omit<Richiesta, 'giorni' | 'dipendente' | 'outlet_id' | 'outlet_nome'>[]) ?? []).map((r) => {
        const outletId = outletDi.get(r.employee_id) ?? null;
        return {
          ...r,
          dipendente: nomi.get(r.employee_id) ?? 'Persona non trovata',
          outlet_id: outletId,
          outlet_nome: outletId ? nomiOutlet.get(outletId) ?? null : null,
          giorni: (perRichiesta.get(r.id) ?? []).sort((a, b) => a.data.localeCompare(b.data)),
        };
      }));

      setReferenti((appr.data as Referente[]) ?? []);
      setUtenti(((prof.data as Record<string, unknown>[]) ?? []).map((p) => ({
        id: String(p.id),
        nome: `${(p.first_name as string) ?? ''} ${(p.last_name as string) ?? ''}`.trim() || String(p.email ?? ''),
        email: (p.email as string) ?? null,
        ruolo: String(p.role ?? ''),
      })).sort((a, b) => a.nome.localeCompare(b.nome, 'it')));
      setOutlet(((out.data as { id: string; name: string }[]) ?? []).map((o) => o.name));
    } finally {
      setCaricamento(false);
    }
  }, [companyId]);

  useEffect(() => { void carica(); }, [carica]);

  const inAttesa = useMemo(() => richieste.filter((r) => r.stato === 'inviata'), [richieste]);
  const decise = useMemo(
    () => richieste.filter((r) => r.stato !== 'inviata').slice(0, 20),
    [richieste],
  );

  function apri(r: Richiesta) {
    if (aperta === r.id) { setAperta(null); return; }
    setAperta(r.id);
    // Si parte da tutto concesso: chi decide toglie quello che non va.
    setConcessi(new Set(r.giorni.map((g) => g.id)));
    setMotivo('');
  }

  function alterna(id: string) {
    setConcessi((prec) => {
      const s = new Set(prec);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  async function decidi(r: Richiesta, giorni: string[], testo: string) {
    if (giorni.length < r.giorni.length && !testo.trim()) {
      toast({ type: 'warning', message: 'Scrivi il motivo: chi riceve la risposta deve sapere perché.' });
      return;
    }
    setSalvataggio(true);
    try {
      const { data, error } = await supabase.rpc('leave_decidi', {
        p_request_id: r.id,
        p_giorni_approvati: giorni,
        p_motivazione: testo.trim() || undefined,
      });
      if (error) throw error;
      const esito = String(data);

      // Stesso discorso della richiesta: l'avviso per mail e' un di piu'.
      let mail: string | null = null;
      try {
        const { data: m } = await supabase.functions.invoke('leave-notify', {
          body: { request_id: r.id, momento: 'decisione' },
        });
        mail = (m as { data?: { mail?: string } } | null)?.data?.mail ?? null;
      } catch {
        mail = 'failed';
      }

      toast({
        type: esito === 'respinta' ? 'info' : 'success',
        message: (esito === 'approvata'
          ? `Approvate tutte le ${r.giorni.length} giornate di ${r.dipendente}.`
          : esito === 'respinta'
            ? `Richiesta di ${r.dipendente} respinta.`
            : `Concessi ${giorni.length} giorni su ${r.giorni.length} a ${r.dipendente}.`)
          + (mail === 'sent' ? ' Avviso mandato per mail.' : ''),
      });
      setAperta(null);
      await carica();
    } catch (e) {
      toast({ type: 'error', message: (e as Error).message });
    } finally {
      setSalvataggio(false);
    }
  }

  async function aggiungiReferente() {
    if (!companyId) return;
    const riga = nuovoTipo === 'utente'
      ? (() => {
          const u = utenti.find((x) => x.id === nuovoUtente);
          return u ? { user_id: u.id, email: u.email, nome: u.nome } : null;
        })()
      : (nuovoNome.trim() && nuovaEmail.trim()
          ? { user_id: null, email: nuovaEmail.trim(), nome: nuovoNome.trim() }
          : null);

    if (!riga) {
      toast({ type: 'warning', message: 'Scegli una persona, oppure scrivi nome e indirizzo.' });
      return;
    }

    const { error } = await supabase.from('leave_approvers').insert({
      company_id: companyId,
      ...riga,
      outlet_code: nuovoOutlet || null,
      created_by: userId ?? null,
    });
    if (error) {
      toast({ type: 'error', message: error.message.includes('duplicate') ? 'Questa persona è già fra i referenti.' : error.message });
      return;
    }
    toast({ type: 'success', message: `${riga.nome} è fra i referenti.` });
    setNuovoUtente(''); setNuovoNome(''); setNuovaEmail(''); setNuovoOutlet('');
    await carica();
  }

  async function togliReferente(r: Referente) {
    const { error } = await supabase.from('leave_approvers').update({ attivo: !r.attivo }).eq('id', r.id);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: r.attivo ? `${r.nome} non è più referente.` : `${r.nome} è di nuovo referente.` });
    await carica();
  }

  if (!companyId) return null;

  return (
    <div className="space-y-5">
      {/* In attesa */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex items-start gap-3 mb-4">
          <Clock className="text-amber-500 shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="font-semibold text-slate-800">
              {inAttesa.length === 0 ? 'Nessuna richiesta in attesa'
                : inAttesa.length === 1 ? 'Una richiesta in attesa'
                  : `${inAttesa.length} richieste in attesa`}
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              Si parte da tutto concesso: togli i giorni che non si possono dare e scrivi il perché.
              Chi riceve la risposta deve capirla senza telefonare.
            </p>
          </div>
        </div>

        {caricamento && <div className="text-sm text-slate-400">Carico…</div>}

        <div className="space-y-2">
          {inAttesa.map((r) => {
            const apertaQui = aperta === r.id;
            const t = totaliPerVoce(r.giorni);
            const tolti = r.giorni.length - concessi.size;
            return (
              <div key={r.id} className="border border-slate-200 rounded-lg">
                <button
                  type="button"
                  onClick={() => apri(r)}
                  className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left hover:bg-slate-50"
                >
                  {apertaQui ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
                  <span className="font-medium text-slate-800">{r.dipendente}</span>
                  {r.outlet_code && <span className="text-xs text-slate-500">{r.outlet_code}</span>}
                  <span className="text-sm text-slate-600">{r.titolo || periodo(r.giorni)}</span>
                  <span className="text-xs text-slate-400">
                    {r.giorni.length} {r.giorni.length === 1 ? 'giorno' : 'giorni'}
                    {VOCI_ORDINE.filter((v) => t[v]).map((v) => ` · ${ETICHETTE_VOCE_BREVI[v]} ${formattaOre(t[v])}`).join('')}
                  </span>
                </button>

                {apertaQui && (
                  <div className="border-t border-slate-100 p-3 space-y-3">
                    {r.note_dipendente && (
                      <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                        Nota di chi ha chiesto: {r.note_dipendente}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {r.giorni.map((g) => {
                        const ok = concessi.has(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => alterna(g.id)}
                            className={`inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1.5 ${
                              ok ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                                 : 'bg-rose-50 border-rose-200 text-rose-700 line-through'
                            }`}
                          >
                            {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            {formattaDataLunga(g.data)} · {ETICHETTE_VOCE_BREVI[g.voce]} · {formattaOre(g.ore)}
                          </button>
                        );
                      })}
                    </div>

                    <p className="text-xs text-slate-500">
                      Un clic su un giorno lo toglie o lo rimette. In verde quelli concessi.
                    </p>

                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                      <SovrapposizioniOutlet
                        companyId={companyId ?? null}
                        outletId={r.outlet_id}
                        outletNome={r.outlet_nome ?? r.outlet_code}
                        escludiEmployeeId={r.employee_id}
                        giorni={r.giorni.map((g) => g.data)}
                        compatto
                      />
                    </div>

                    {tolti > 0 && (
                      <div>
                        <label className="text-sm text-slate-600">
                          Perché {tolti === r.giorni.length ? 'non si può' : `${tolti === 1 ? 'quel giorno non si può' : `quei ${tolti} giorni non si possono`}`}
                          <textarea
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            rows={2}
                            placeholder="Es. in quei giorni il punto vendita resta scoperto."
                            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={salvataggio}
                        onClick={() => void decidi(r, [...concessi], motivo)}
                        className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
                      >
                        <CheckCircle2 size={15} />
                        {tolti === 0 ? 'Approva tutto' : tolti === r.giorni.length ? 'Respingi tutto' : `Concedi ${concessi.size} su ${r.giorni.length}`}
                      </button>
                      <button
                        type="button"
                        disabled={salvataggio}
                        onClick={() => { setConcessi(new Set()); }}
                        className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <XCircle size={15} /> Togli tutti i giorni
                      </button>
                      <button
                        type="button"
                        onClick={() => setConcessi(new Set(r.giorni.map((g) => g.id)))}
                        className="text-sm text-slate-500 hover:text-slate-800 px-2"
                      >
                        Rimetti tutto
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!caricamento && inAttesa.length === 0 && (
          <p className="text-sm text-slate-500">
            Le richieste compaiono qui appena vengono registrate nella scheda «Richieste».
          </p>
        )}
      </div>

      {/* Già decise */}
      {decise.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setVediDecise((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700"
          >
            <History size={16} className="text-slate-400" />
            Richieste già decise ({decise.length})
            {vediDecise ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>

          {vediDecise && (
            <div className="mt-3 space-y-2">
              {decise.map((r) => {
                const ok = r.giorni.filter((g) => g.stato === 'approvato').length;
                return (
                  <div key={r.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${COLORE_STATO[r.stato] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ETICHETTE_STATO[r.stato] ?? r.stato}
                      </span>
                      <span className="font-medium text-slate-800">{r.dipendente}</span>
                      <span className="text-sm text-slate-600">{r.titolo || periodo(r.giorni)}</span>
                      <span className="text-xs text-slate-400">
                        {ok} {ok === 1 ? 'giorno concesso' : 'giorni concessi'} su {r.giorni.length}
                      </span>
                      {r.decisa_da_nome && (
                        <span className="text-xs text-slate-400">
                          deciso da {r.decisa_da_nome}
                          {r.decisa_il ? ` il ${formattaData(r.decisa_il.slice(0, 10))}` : ''}
                        </span>
                      )}
                    </div>
                    {r.motivazione && (
                      <p className="mt-1.5 text-sm text-slate-600">Motivo: {r.motivazione}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Referenti */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-slate-400 shrink-0 mt-0.5" size={20} />
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-slate-800">Chi approva le ferie</h4>
            <p className="text-sm text-slate-600 mt-1">
              Chi è in questo elenco può decidere sulle richieste, qualunque sia il suo ruolo nel gestionale.
              Si può aggiungere anche qualcuno che non ha un accesso: in quel caso riceve soltanto l'avviso
              per mail. Chi gestisce il personale (super advisor, contabile, direzione operativa) decide comunque.
            </p>

            <div className="mt-3 space-y-1.5">
              {referenti.length === 0 && (
                <p className="text-sm text-slate-500">
                  Ancora nessun referente: per ora decidono solo i ruoli che gestiscono il personale.
                </p>
              )}
              {referenti.map((r) => (
                <div key={r.id} className={`flex flex-wrap items-center gap-2 text-sm rounded-lg border px-3 py-2 ${r.attivo ? 'border-slate-200' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>
                  <span className="font-medium">{r.nome}</span>
                  {r.user_id
                    ? <span className="text-xs text-emerald-700 bg-emerald-50 rounded px-1.5 py-0.5">decide nel gestionale</span>
                    : <span className="text-xs text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 inline-flex items-center gap-1"><Mail size={11} /> solo avviso</span>}
                  {r.email && <span className="text-xs text-slate-500">{r.email}</span>}
                  <span className="text-xs text-slate-400">{r.outlet_code || 'tutti i punti vendita'}</span>
                  <button
                    type="button"
                    onClick={() => void togliReferente(r)}
                    className="ml-auto text-xs text-slate-500 hover:text-rose-600 inline-flex items-center gap-1"
                  >
                    <Trash2 size={13} /> {r.attivo ? 'Togli' : 'Rimetti'}
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 w-fit">
                {([['utente', 'Una persona del gestionale'], ['email', 'Solo un indirizzo']] as const).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setNuovoTipo(k)}
                    className={`text-sm px-3 py-1.5 rounded-md ${nuovoTipo === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                {nuovoTipo === 'utente' ? (
                  <label className="text-sm">
                    <span className="text-slate-600">Persona</span>
                    <select
                      value={nuovoUtente}
                      onChange={(e) => setNuovoUtente(e.target.value)}
                      className="mt-1 block border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[220px]"
                    >
                      <option value="">Scegli…</option>
                      {utenti.map((u) => (
                        <option key={u.id} value={u.id}>{u.nome}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="text-sm">
                      <span className="text-slate-600">Nome</span>
                      <input
                        value={nuovoNome}
                        onChange={(e) => setNuovoNome(e.target.value)}
                        className="mt-1 block border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-slate-600">Indirizzo</span>
                      <input
                        type="email"
                        value={nuovaEmail}
                        onChange={(e) => setNuovaEmail(e.target.value)}
                        className="mt-1 block border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[220px]"
                      />
                    </label>
                  </>
                )}

                <label className="text-sm">
                  <span className="text-slate-600">Punto vendita</span>
                  <select
                    value={nuovoOutlet}
                    onChange={(e) => setNuovoOutlet(e.target.value)}
                    className="mt-1 block border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Tutti</option>
                    {outlet.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => void aggiungiReferente()}
                  className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-3 py-2 hover:bg-slate-50"
                >
                  <UserPlus size={15} /> Aggiungi
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 flex items-start gap-1.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-slate-400" />
        Ogni decisione resta scritta: chi ha deciso, quando, quali giorni e con quale motivo. Una richiesta
        decisa si può riaprire cambiando i giorni concessi, e anche questo lascia traccia.
      </p>
    </div>
  );
}
