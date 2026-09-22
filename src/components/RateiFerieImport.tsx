// Import del tabulato "Situazione ratei di ferie e permessi" delle paghe.
//
// E' il primo pezzo del piano ferie: da qui entra nel gestionale il residuo
// vero di ogni persona, che nessuna tabella sapeva. Il gestionale non calcola
// la maturazione, la legge dal documento dello studio paghe.
//
// Cosa fa, in ordine:
//   1. legge il PDF (pagine ruotate: coordinate di display)
//   2. controlla la quadratura con i totali ditta stampati in fondo
//   3. aggancia ogni persona all'anagrafica, e dice con quale criterio
//   4. archivia il file in "Paghe e personale" e salva righe e saldi
//
// Non chiede niente che possa ricavare da solo: l'abbinamento a mano si
// presenta solo per le righe che il documento non basta a decidere.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CheckCircle2, AlertTriangle, Upload, FileText, RefreshCw, Users, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { archiviaFile, avvisoArchiviazioneFallita } from '../lib/archivioFile';
import {
  parseRatei, isTabulatoRatei, abbinaDipendente, oreSettimanaliDaRateo, oreGiornataDaRateo,
  normNome, VOCI, type RateiParsed, type RateoRow, type Abbinamento, type DipendenteRif,
} from '../lib/rateiParse';

type Props = { companyId?: string; userId?: string | null };

type Persona = {
  chiave: string;
  nominativo: string;
  matricola: string | null;
  dataAssunzione: string | null;
  dataCessazione: string | null;
  righe: RateoRow[];
  abbinamento: Abbinamento;
  /** Scelta fatta a mano in anteprima: vince su quella proposta. */
  scelta: string | null;
};

type ImportSalvato = {
  id: string;
  periodo_anno: number;
  periodo_mese: number;
  azienda_nome: string | null;
  file_name: string | null;
  persone: number;
  righe_lette: number;
  righe_agganciate: number;
  quadratura_ok: boolean | null;
  created_at: string;
};

const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const ore = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;


/**
 * Scelta della persona con ricerca.
 *
 * Un elenco di sessanta nomi in ordine di database non si legge: qui si
 * digita un pezzo di cognome (o la matricola) e restano le righe che
 * corrispondono, in ordine alfabetico. Serve solo per gli abbinamenti che il
 * documento non basta a decidere.
 */
function SceltaPersona({ dipendenti, valore, onScegli }: {
  dipendenti: DipendenteRif[];
  valore: string | null;
  onScegli: (id: string | null) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const [q, setQ] = useState('');
  const scelto = dipendenti.find((d) => d.id === valore) ?? null;

  const filtrati = useMemo(() => {
    const t = normNome(q);
    const num = q.replace(/\D/g, '');
    return dipendenti.filter((d) => {
      if (!t && !num) return true;
      const nome = normNome(`${d.cognome ?? ''} ${d.nome ?? ''}`);
      return (t && nome.includes(t)) || (num && (d.matricola ?? '').includes(num));
    });
  }, [q, dipendenti]);

  const etichetta = (d: DipendenteRif) =>
    `${[d.cognome, d.nome].filter(Boolean).join(' ')}${d.matricola ? ` · ${d.matricola}` : ''}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setAperto((v) => !v); setQ(''); }}
        className={`text-sm rounded-lg px-2.5 py-1.5 bg-white text-left w-full max-w-[240px] border ${scelto ? 'border-slate-300 text-slate-800' : 'border-amber-300 text-slate-500'}`}
      >
        {scelto ? etichetta(scelto) : 'Scegli la persona…'}
      </button>

      {aperto && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setAperto(false)} />
          <div className="absolute z-30 mt-1 w-[280px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-slate-100">
              <Search size={14} className="text-slate-400 shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setAperto(false); }}
                placeholder="Cognome o matricola"
                className="w-full text-sm outline-none"
              />
              {q && <button type="button" onClick={() => setQ('')} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtrati.length === 0 && (
                <div className="px-3 py-3 text-sm text-slate-400">Nessuno con questo nome.</div>
              )}
              {filtrati.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => { onScegli(d.id); setAperto(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${d.id === valore ? 'bg-blue-50 font-medium' : ''}`}
                >
                  {[d.cognome, d.nome].filter(Boolean).join(' ')}
                  <span className="text-slate-400"> · {d.matricola ?? 'senza matricola'}</span>
                  {!d.isActive && <span className="text-rose-600"> · cessata</span>}
                </button>
              ))}
            </div>
            {scelto && (
              <button
                type="button"
                onClick={() => { onScegli(null); setAperto(false); }}
                className="w-full text-left px-3 py-2 text-xs text-slate-500 border-t border-slate-100 hover:bg-slate-50"
              >
                Togli la scelta
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function RateiFerieImport({ companyId, userId }: Props) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [caricamento, setCaricamento] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [letto, setLetto] = useState<RateiParsed | null>(null);
  const [persone, setPersone] = useState<Persona[]>([]);
  const [dipendenti, setDipendenti] = useState<DipendenteRif[]>([]);
  const [storico, setStorico] = useState<ImportSalvato[]>([]);

  const caricaStorico = useCallback(async () => {
    if (!companyId) return;
    const { data } = await supabase
      .from('leave_accrual_imports')
      .select('id, periodo_anno, periodo_mese, azienda_nome, file_name, persone, righe_lette, righe_agganciate, quadratura_ok, created_at')
      .eq('company_id', companyId)
      .eq('attivo', true)
      .order('periodo_anno', { ascending: false })
      .order('periodo_mese', { ascending: false });
    setStorico((data as ImportSalvato[]) ?? []);
  }, [companyId]);

  useEffect(() => { void caricaStorico(); }, [caricaStorico]);

  useEffect(() => {
    if (!companyId) return;
    void (async () => {
      const { data } = await supabase
        .from('employees')
        .select('id, matricola, nome, cognome, first_name, last_name, data_assunzione, hire_date, is_active')
        .eq('company_id', companyId);
      const righe = ((data as Record<string, unknown>[]) ?? []).map((d) => ({
        id: String(d.id),
        matricola: (d.matricola as string) ?? null,
        nome: (d.nome as string) ?? (d.first_name as string) ?? null,
        cognome: (d.cognome as string) ?? (d.last_name as string) ?? null,
        dataAssunzione: (d.data_assunzione as string) ?? (d.hire_date as string) ?? null,
        isActive: d.is_active !== false,
      }));
      // In ordine alfabetico: l'ordine del database non dice niente a nessuno.
      righe.sort((a, b) =>
        `${a.cognome ?? ''} ${a.nome ?? ''}`.localeCompare(`${b.cognome ?? ''} ${b.nome ?? ''}`, 'it'));
      setDipendenti(righe);
    })();
  }, [companyId]);

  const [trascina, setTrascina] = useState(false);

  const onFile = async (f: File | null) => {
    if (!f) return;
    setFile(f); setLetto(null); setPersone([]); setCaricamento(true);
    try {
      // pdfjs pesa ~350KB gzip: si carica solo quando serve davvero.
      const { extractPdfItemsOriented } = await import('../lib/pdfText');
      const pagine = await extractPdfItemsOriented(f);
      if (!isTabulatoRatei(pagine)) {
        toast({ type: 'error', message: 'Questo non sembra il tabulato "Situazione ratei di ferie e permessi".' });
        setCaricamento(false);
        return;
      }
      const r = parseRatei(pagine);
      setLetto(r);

      const perPersona = new Map<string, RateoRow[]>();
      for (const riga of r.righe) {
        const k = `${riga.matricola ?? ''}|${riga.nominativo}`;
        if (!perPersona.has(k)) perPersona.set(k, []);
        perPersona.get(k)!.push(riga);
      }
      setPersone([...perPersona.entries()].map(([chiave, righe]) => ({
        chiave,
        nominativo: righe[0].nominativo,
        matricola: righe[0].matricola,
        dataAssunzione: righe[0].dataAssunzione,
        dataCessazione: righe[0].dataCessazione,
        righe,
        abbinamento: abbinaDipendente(righe[0], dipendenti),
        scelta: null,
      })));
    } catch (e) {
      toast({ type: 'error', message: `Lettura del PDF non riuscita: ${(e as Error).message}` });
    } finally {
      setCaricamento(false);
    }
  };

  const daConfermare = useMemo(
    () => persone.filter((p) => !p.scelta && (p.abbinamento.daConfermare || !p.abbinamento.employeeId)),
    [persone],
  );
  const agganciate = useMemo(
    () => persone.filter((p) => p.scelta || p.abbinamento.employeeId).length,
    [persone],
  );

  const salva = async () => {
    if (!companyId || !letto || !letto.periodo || !file) return;
    setSalvataggio(true);
    try {
      const { anno, mese } = letto.periodo;

      // Un reimport dello stesso mese non cancella niente: spegne il vecchio.
      const { data: vecchi } = await supabase
        .from('leave_accrual_imports')
        .select('id')
        .eq('company_id', companyId).eq('periodo_anno', anno).eq('periodo_mese', mese).eq('attivo', true);

      const archiviato = await archiviaFile({
        file, companyId, userId, modulo: 'Personale',
        funzione: 'Situazione ratei di ferie e permessi',
        year: anno, month: mese,
        referenceTable: 'leave_accrual_imports',
      });
      if (archiviato.errore) toast({ type: 'warning', message: avvisoArchiviazioneFallita(file.name, archiviato.errore) });

      const { data: imp, error: errImp } = await supabase
        .from('leave_accrual_imports')
        .insert({
          company_id: companyId,
          periodo_anno: anno, periodo_mese: mese,
          azienda_codice: letto.aziendaCodice, azienda_nome: letto.aziendaNome,
          file_name: file.name,
          storage_bucket: archiviato.bucket, storage_path: archiviato.path,
          documento_id: archiviato.id,
          persone: persone.length,
          righe_lette: letto.righe.length,
          righe_agganciate: agganciate,
          totali_ditta: letto.totaliDitta,
          quadratura_ok: letto.quadraturaOk,
          scarti: letto.quadratura,
          created_by: userId,
        })
        .select('id').single();
      if (errImp) throw errImp;
      const importId = (imp as { id: string }).id;

      const righeDb = persone.flatMap((p) => {
        const employeeId = p.scelta ?? p.abbinamento.employeeId;
        return p.righe.map((r) => ({
          company_id: companyId,
          import_id: importId,
          matricola: r.matricola,
          nominativo: r.nominativo,
          data_assunzione: r.dataAssunzione,
          data_cessazione: r.dataCessazione,
          voce: r.voce,
          voce_label: r.voceLabel,
          unita: r.unita,
          rateo_annuo: r.rateoAnnuo,
          mesi: r.mesi,
          residuo_prec: r.residuoPrec,
          goduto_prec: r.godutoPrec,
          saldo_prec: r.saldoPrec,
          maturato: r.maturato,
          goduto: r.goduto,
          saldo_corso: r.saldoCorso,
          residuo: r.residuo,
          da_maturare: r.daMaturare,
          da_fruire: r.daFruire,
          non_indennizzabile: r.nonIndennizzabile,
          da_godere_anno: r.daGodereAnno,
          employee_id: employeeId,
          match_metodo: p.scelta ? 'manuale' : p.abbinamento.metodo,
          match_note: p.abbinamento.nota,
          match_confermato_da: p.scelta ? userId : null,
          match_confermato_il: p.scelta ? new Date().toISOString() : null,
        }));
      });
      const { error: errRighe } = await supabase.from('leave_accrual_rows').insert(righeDb);
      if (errRighe) throw errRighe;

      // Orario settimanale dal rateo: si scrive accanto a quello a mano,
      // non al suo posto.
      for (const p of persone) {
        const employeeId = p.scelta ?? p.abbinamento.employeeId;
        const ferie = p.righe.find((r) => r.voce === 'F01');
        const oreSett = oreSettimanaliDaRateo(ferie?.rateoAnnuo ?? null);
        if (!employeeId || oreSett == null) continue;
        await supabase.from('employees').update({
          ore_settimanali_paghe: oreSett,
          ore_settimanali_paghe_at: new Date().toISOString(),
          ore_settimanali_paghe_import_id: importId,
        }).eq('id', employeeId);
      }

      if (vecchi?.length) {
        await supabase.from('leave_accrual_imports')
          .update({ attivo: false, sostituito_da: importId })
          .in('id', vecchi.map((v: { id: string }) => v.id));
      }

      toast({ type: 'success', message: `Ratei di ${MESI[mese]} ${anno} importati: ${persone.length} persone, ${agganciate} agganciate.` });
      setFile(null); setLetto(null); setPersone([]);
      if (fileRef.current) fileRef.current.value = '';
      void caricaStorico();
    } catch (e) {
      toast({ type: 'error', message: `Salvataggio non riuscito: ${(e as Error).message}` });
    } finally {
      setSalvataggio(false);
    }
  };

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); if (!trascina) setTrascina(true); }}
        onDragLeave={(e) => { e.preventDefault(); setTrascina(false); }}
        onDrop={(e) => {
          e.preventDefault(); setTrascina(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void onFile(f);
        }}
        className={`border rounded-xl p-5 transition-colors ${trascina ? 'bg-blue-50 border-blue-400 border-dashed' : 'bg-white border-slate-200'}`}
      >
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[260px]">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <CalendarClock size={17} className="text-blue-600" /> Ratei di ferie e permessi
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Trascina qui la stampa «Situazione ratei di ferie e permessi» che lo studio paghe pubblica
              ogni mese, oppure usa il pulsante. Da lì il gestionale prende il residuo di ferie, permessi
              ex festività e ROL di ogni persona, e l'orario settimanale del contratto. I numeri non
              vengono ricalcolati: sono quelli delle paghe.
            </p>
            {trascina && (
              <p className="text-sm text-blue-700 font-medium mt-2">Lascia il file per leggerlo.</p>
            )}
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={caricamento || salvataggio}
            className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium flex items-center gap-1.5"
          >
            {caricamento ? <RefreshCw size={15} className="animate-spin" /> : <Upload size={15} />}
            {caricamento ? 'Lettura…' : 'Carica il tabulato'}
          </button>
          <input
            ref={fileRef} type="file" accept=".pdf" className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      {letto && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Azienda</div>
              <div className="font-medium text-slate-800">{letto.aziendaNome ?? '—'} {letto.aziendaCodice ? <span className="text-slate-400">· {letto.aziendaCodice}</span> : null}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Periodo</div>
              <div className="font-medium text-slate-800">{letto.periodo ? `${MESI[letto.periodo.mese]} ${letto.periodo.anno}` : 'non trovato'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Persone</div>
              <div className="font-medium text-slate-800">{persone.length}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-400">Agganciate</div>
              <div className="font-medium text-slate-800">{agganciate} / {persone.length}</div>
            </div>
          </div>

          <div className={`px-5 py-3 text-sm flex items-start gap-2 ${letto.quadraturaOk ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
            {letto.quadraturaOk
              ? <><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                  <div>
                    <strong>Lettura completa.</strong> Le somme delle righe lette coincidono con i totali dell'azienda
                    stampati in fondo al documento, su tutte le voci.
                  </div>
                </>
              : <><AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                  <div>
                    <strong>Da guardare prima di salvare.</strong>
                    <ul className="list-disc ml-5 mt-1 space-y-0.5">
                      {letto.avvisi.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                </>}
          </div>

          {daConfermare.length > 0 && (
            <div className="px-5 py-3 text-sm bg-blue-50 text-blue-900 flex items-start gap-2">
              <Users size={16} className="mt-0.5 shrink-0 text-blue-600" />
              <div>
                <strong>{daConfermare.length} {daConfermare.length === 1 ? 'persona va confermata' : 'persone vanno confermate'}.</strong>{' '}
                Le altre {persone.length - daConfermare.length} sono state riconosciute dal documento.
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Persona</th>
                  <th className="px-4 py-2 font-medium">Contratto</th>
                  <th className="px-4 py-2 font-medium text-right">{VOCI.F01}</th>
                  <th className="px-4 py-2 font-medium text-right">{VOCI.F02}</th>
                  <th className="px-4 py-2 font-medium text-right">{VOCI.F03}</th>
                  <th className="px-4 py-2 font-medium">Nel gestionale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {persone.map((p) => {
                  const f01 = p.righe.find((r) => r.voce === 'F01');
                  const f02 = p.righe.find((r) => r.voce === 'F02');
                  const f03 = p.righe.find((r) => r.voce === 'F03');
                  const oreSett = oreSettimanaliDaRateo(f01?.rateoAnnuo ?? null);
                  const oreGg = oreGiornataDaRateo(f01?.rateoAnnuo ?? null);
                  const scelto = p.scelta ?? p.abbinamento.employeeId;
                  const daFare = !scelto || (p.abbinamento.daConfermare && !p.scelta);
                  return (
                    <tr key={p.chiave} className={daFare ? 'bg-amber-50/50' : undefined}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-800">{p.nominativo}</div>
                        <div className="text-xs text-slate-400">
                          matricola {p.matricola ?? '—'}
                          {p.dataCessazione && <span className="text-rose-600 font-medium"> · cessata il {p.dataCessazione.split('-').reverse().join('/')}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {oreSett != null ? <>{oreSett} h/sett <span className="text-slate-400">· giornata {oreGg} h</span></> : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={(f01?.residuo ?? 0) < 0 ? 'text-rose-600 font-medium' : ''}>{ore(f01?.residuo)}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{ore(f02?.residuo)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{ore(f03?.residuo)}</td>
                      <td className="px-4 py-2.5">
                        {daFare ? (
                          <div>
                            <SceltaPersona
                              dipendenti={dipendenti}
                              valore={scelto}
                              onScegli={(id) => setPersone((prev) => prev.map((x) => x.chiave === p.chiave ? { ...x, scelta: id } : x))}
                            />
                            <div className="text-xs text-amber-700 mt-1 max-w-[260px]">{p.abbinamento.nota}</div>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} /> riconosciuta</span>
                            <div className="text-slate-400 mt-0.5">{p.scelta ? 'scelta a mano' : p.abbinamento.nota}</div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm text-slate-500">
              {letto.periodo
                ? <>Salvando, i saldi di <strong>{MESI[letto.periodo.mese]} {letto.periodo.anno}</strong> diventano quelli correnti e il file finisce in archivio.</>
                : <>Senza il periodo di elaborazione il documento non si può salvare.</>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setFile(null); setLetto(null); setPersone([]); if (fileRef.current) fileRef.current.value = ''; }}
                className="px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm hover:bg-slate-50"
              >Annulla</button>
              <button
                onClick={() => void salva()}
                disabled={salvataggio || !letto.periodo || !letto.righe.length}
                className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium"
              >{salvataggio ? 'Salvataggio…' : `Salva i ratei (${persone.length} persone)`}</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 font-medium text-slate-700 flex items-center gap-2">
          <FileText size={15} className="text-slate-400" /> Tabulati importati
        </div>
        {storico.length === 0 ? (
          <div className="px-5 py-6 text-sm text-slate-500">
            Nessun tabulato importato: finché non ce n'è uno, il gestionale non sa quante ferie ha
            ciascuno. L'elenco si popola quando carichi un tabulato e premi <strong>Salva i ratei</strong>:
            caricare il file e guardare l'anteprima non salva niente.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Periodo</th>
                <th className="px-4 py-2 font-medium">Azienda</th>
                <th className="px-4 py-2 font-medium text-right">Persone</th>
                <th className="px-4 py-2 font-medium text-right">Righe</th>
                <th className="px-4 py-2 font-medium">Lettura</th>
                <th className="px-4 py-2 font-medium">File</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {storico.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{MESI[s.periodo_mese]} {s.periodo_anno}</td>
                  <td className="px-4 py-2.5 text-slate-600">{s.azienda_nome ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.persone}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{s.righe_agganciate} / {s.righe_lette}</td>
                  <td className="px-4 py-2.5">
                    {s.quadratura_ok
                      ? <span className="inline-flex items-center gap-1 text-emerald-700 text-xs"><CheckCircle2 size={13} /> quadra</span>
                      : <span className="inline-flex items-center gap-1 text-amber-700 text-xs"><AlertTriangle size={13} /> da guardare</span>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{s.file_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
