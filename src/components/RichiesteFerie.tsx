// Richieste di ferie e permessi: il modulo, il calendario, i saldi.
//
// Fase 2 del piano ferie. I dipendenti non hanno ancora un accesso al
// gestionale, quindi qui dentro entra l'amministrazione: sceglie la
// persona, vede quante ore ha davvero (residuo delle paghe meno quello
// che ha gia' chiesto), segna i giorni sul calendario e salva. Il modulo
// si esporta in PDF o in Excel, uno per persona, da mandare o da stampare
// finche' il giro si fa ancora a mano.
//
// Il conto e' in ORE, come nel tabulato: una giornata vale l'orario
// settimanale diviso cinque, che quasi mai fa otto.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Save,
  Send, Trash2, AlertTriangle, Info, CheckCircle2, Clock, Undo2, Users,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import SceltaPersona from './SceltaPersona';
import type { DipendenteRif } from '../lib/rateiParse';
import {
  ETICHETTE_VOCE, ETICHETTE_VOCE_BREVI, ETICHETTE_TIPO, MESI, GIORNI_BREVI,
  grigliaDelMese, eDomenica, etichettaFestivita, oreGiornata, oreDelGiorno,
  giornateDaOre, totaliPerVoce, verificaRichiesta, formattaOre, formattaData,
  formattaGiornate, round2,
  type VoceFerie, type TipoGiorno, type GiornoRichiesto, type DisponibilitaVoce, type Avviso,
} from '../lib/ferieRichiesta';
import { esportaModuloPdf, esportaModuloExcel, type ModuloFerie } from '../lib/ferieExport';

type Props = { companyId?: string; userId?: string | null };

type PersonaAnagrafica = DipendenteRif & {
  oreSettimanaliPaghe: number | null;
  oreSettimanaliAnagrafica: number | null;
  outlet: string | null;
};

type RichiestaSalvata = {
  id: string;
  employee_id: string;
  stato: string;
  titolo: string | null;
  note_dipendente: string | null;
  origine: string;
  outlet_code: string | null;
  inviata_il: string | null;
  created_at: string;
  giorni: GiornoRichiesto[];
};

const VOCI_ORDINE: VoceFerie[] = ['F01', 'F02', 'F03'];

const ETICHETTE_STATO: Record<string, string> = {
  bozza: 'Bozza',
  inviata: 'Inviata, in attesa di risposta',
  approvata: 'Approvata',
  approvata_parziale: 'Approvata in parte',
  respinta: 'Respinta',
  ritirata: 'Ritirata',
  chiusa: 'Chiusa',
};

const COLORE_STATO: Record<string, string> = {
  bozza: 'bg-slate-100 text-slate-600',
  inviata: 'bg-amber-100 text-amber-700',
  approvata: 'bg-emerald-100 text-emerald-700',
  approvata_parziale: 'bg-emerald-50 text-emerald-700',
  respinta: 'bg-rose-100 text-rose-700',
  ritirata: 'bg-slate-100 text-slate-500',
  chiusa: 'bg-blue-100 text-blue-700',
};

const ETICHETTE_ORIGINE: Record<string, string> = {
  gestionale: 'compilata qui',
  modulo_cartaceo: 'da modulo cartaceo',
  mail: 'arrivata per mail',
};

const chiave = (data: string, voce: VoceFerie) => `${data}|${voce}`;

export default function RichiesteFerie({ companyId, userId }: Props) {
  const { toast } = useToast();

  const [anagrafica, setAnagrafica] = useState<PersonaAnagrafica[]>([]);
  const [disponibilita, setDisponibilita] = useState<Record<string, DisponibilitaVoce[]>>({});
  const [richieste, setRichieste] = useState<RichiestaSalvata[]>([]);
  const [azienda, setAzienda] = useState('');
  const [caricamento, setCaricamento] = useState(true);
  const [salvataggio, setSalvataggio] = useState(false);

  const [personaId, setPersonaId] = useState<string | null>(null);
  const [mese, setMese] = useState(() => {
    const d = new Date();
    return { anno: d.getFullYear(), mese: d.getMonth() + 1 };
  });

  // Il "pennello": cosa si segna quando si clicca su un giorno.
  const [voceAttiva, setVoceAttiva] = useState<VoceFerie>('F01');
  const [tipoAttivo, setTipoAttivo] = useState<TipoGiorno>('giornata');
  const [orePermesso, setOrePermesso] = useState(2);

  const [scelti, setScelti] = useState<Map<string, GiornoRichiesto>>(new Map());
  const [titolo, setTitolo] = useState('');
  const [note, setNote] = useState('');
  const [origine, setOrigine] = useState<'gestionale' | 'modulo_cartaceo' | 'mail'>('modulo_cartaceo');
  const [bozzaId, setBozzaId] = useState<string | null>(null);

  // ── Caricamento ────────────────────────────────────────────────────
  const carica = useCallback(async () => {
    if (!companyId) return;
    setCaricamento(true);
    try {
      const [emp, alloc, disp, req, days, comp] = await Promise.all([
        supabase.from('employees')
          .select('id, matricola, nome, cognome, first_name, last_name, data_assunzione, hire_date, is_active, ore_settimanali, ore_settimanali_paghe')
          .eq('company_id', companyId),
        supabase.from('employee_outlet_allocations')
          .select('employee_id, outlet_code, is_primary, allocation_pct')
          .eq('company_id', companyId),
        supabase.from('v_leave_disponibilita').select('*').eq('company_id', companyId),
        supabase.from('leave_requests')
          .select('id, employee_id, stato, titolo, note_dipendente, origine, outlet_code, inviata_il, created_at')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false }),
        supabase.from('leave_request_days')
          .select('request_id, data, voce, tipo, ore, nota')
          .eq('company_id', companyId),
        supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
      ]);

      const perEmp = new Map<string, { outlet_code: string; is_primary: boolean | null; allocation_pct: number }[]>();
      for (const a of (alloc.data as { employee_id: string; outlet_code: string; is_primary: boolean | null; allocation_pct: number }[]) ?? []) {
        if (!perEmp.has(a.employee_id)) perEmp.set(a.employee_id, []);
        perEmp.get(a.employee_id)!.push(a);
      }

      const persone: PersonaAnagrafica[] = ((emp.data as Record<string, unknown>[]) ?? []).map((d) => {
        const allocazioni = perEmp.get(String(d.id)) ?? [];
        const principale = allocazioni.find((x) => x.is_primary)
          ?? [...allocazioni].sort((a, b) => Number(b.allocation_pct) - Number(a.allocation_pct))[0];
        return {
          id: String(d.id),
          matricola: (d.matricola as string) ?? null,
          nome: (d.nome as string) ?? (d.first_name as string) ?? null,
          cognome: (d.cognome as string) ?? (d.last_name as string) ?? null,
          dataAssunzione: (d.data_assunzione as string) ?? (d.hire_date as string) ?? null,
          isActive: d.is_active !== false,
          oreSettimanaliPaghe: d.ore_settimanali_paghe != null ? Number(d.ore_settimanali_paghe) : null,
          oreSettimanaliAnagrafica: d.ore_settimanali != null ? Number(d.ore_settimanali) : null,
          outlet: principale?.outlet_code ?? null,
        };
      }).sort((a, b) => `${a.cognome ?? ''} ${a.nome ?? ''}`.localeCompare(`${b.cognome ?? ''} ${b.nome ?? ''}`, 'it'));

      const perPersona: Record<string, DisponibilitaVoce[]> = {};
      for (const r of (disp.data as (DisponibilitaVoce & { employee_id: string; periodo_anno: number; periodo_mese: number })[]) ?? []) {
        if (!r.employee_id) continue;
        if (!perPersona[r.employee_id]) perPersona[r.employee_id] = [];
        perPersona[r.employee_id].push(r);
      }

      const giorniPerRichiesta = new Map<string, GiornoRichiesto[]>();
      for (const g of (days.data as (GiornoRichiesto & { request_id: string })[]) ?? []) {
        if (!giorniPerRichiesta.has(g.request_id)) giorniPerRichiesta.set(g.request_id, []);
        giorniPerRichiesta.get(g.request_id)!.push({ ...g, ore: Number(g.ore) });
      }

      setAnagrafica(persone);
      setDisponibilita(perPersona);
      setRichieste(((req.data as Omit<RichiestaSalvata, 'giorni'>[]) ?? []).map((r) => ({
        ...r, giorni: giorniPerRichiesta.get(r.id) ?? [],
      })));
      setAzienda((comp.data as { name?: string } | null)?.name ?? '');
    } finally {
      setCaricamento(false);
    }
  }, [companyId]);

  useEffect(() => { void carica(); }, [carica]);

  // ── La persona scelta ──────────────────────────────────────────────
  const persona = useMemo(
    () => anagrafica.find((p) => p.id === personaId) ?? null,
    [anagrafica, personaId],
  );

  const saldi = useMemo<DisponibilitaVoce[]>(
    () => (personaId ? disponibilita[personaId] ?? [] : []),
    [disponibilita, personaId],
  );

  // La giornata: quella calcolata dal database sul rateo quando c'e' (stesso
  // numero, un conto solo), altrimenti dall'orario settimanale diviso cinque.
  const orario = useMemo(() => {
    const daSaldo = saldi.find((s) => s.ore_giornata_dedotte)?.ore_giornata_dedotte ?? null;
    if (daSaldo) return { ore: Number(daSaldo), fonte: 'paghe' as const };
    return oreGiornata(persona?.oreSettimanaliPaghe, persona?.oreSettimanaliAnagrafica);
  }, [saldi, persona]);

  const periodoTabulato = useMemo(() => {
    const r = saldi[0] as (DisponibilitaVoce & { periodo_anno?: number; periodo_mese?: number }) | undefined;
    return r?.periodo_anno && r?.periodo_mese ? `${MESI[r.periodo_mese]} ${r.periodo_anno}` : null;
  }, [saldi]);

  const giorniScelti = useMemo(() => [...scelti.values()].sort((a, b) => a.data.localeCompare(b.data)), [scelti]);
  const totali = useMemo(() => totaliPerVoce(giorniScelti), [giorniScelti]);

  const avvisi = useMemo<Avviso[]>(
    () => (personaId && giorniScelti.length ? verificaRichiesta(giorniScelti, saldi, orario.ore) : []),
    [personaId, giorniScelti, saldi, orario.ore],
  );
  const bloccanti = avvisi.filter((a) => a.gravita === 'blocco');

  const richiestePersona = useMemo(
    () => (personaId ? richieste.filter((r) => r.employee_id === personaId) : richieste),
    [richieste, personaId],
  );

  // ── Calendario ─────────────────────────────────────────────────────
  const griglia = useMemo(() => grigliaDelMese(mese.anno, mese.mese), [mese]);

  const spostaMese = (delta: number) => {
    setMese((m) => {
      const d = new Date(Date.UTC(m.anno, m.mese - 1 + delta, 1));
      return { anno: d.getUTCFullYear(), mese: d.getUTCMonth() + 1 };
    });
  };

  const clickGiorno = (data: string) => {
    if (!persona) {
      toast({ type: 'info', message: 'Prima scegli la persona: le ore di una giornata dipendono dal suo orario.' });
      return;
    }
    setScelti((prec) => {
      const m = new Map(prec);
      const k = chiave(data, voceAttiva);
      if (m.has(k)) { m.delete(k); return m; }
      const ore = oreDelGiorno(tipoAttivo, orario.ore, orePermesso);
      if (!ore) {
        toast({ type: 'warning', message: 'Indica quante ore di permesso, prima di segnare il giorno.' });
        return prec;
      }
      m.set(k, { data, voce: voceAttiva, tipo: tipoAttivo, ore });
      return m;
    });
  };

  const oreDelGiornoScelte = (data: string): GiornoRichiesto[] =>
    VOCI_ORDINE.map((v) => scelti.get(chiave(data, v))).filter((x): x is GiornoRichiesto => !!x);

  const svuota = () => { setScelti(new Map()); setBozzaId(null); setTitolo(''); setNote(''); };

  // ── Salvataggio ────────────────────────────────────────────────────
  async function salva(nuovoStato: 'bozza' | 'inviata') {
    if (!companyId || !persona) return;
    if (!giorniScelti.length) {
      toast({ type: 'warning', message: 'Non c\'è nessun giorno da salvare.' });
      return;
    }
    if (nuovoStato === 'inviata' && bloccanti.length) {
      toast({ type: 'error', message: bloccanti[0].testo });
      return;
    }

    setSalvataggio(true);
    try {
      let requestId = bozzaId;

      if (requestId) {
        const { error } = await supabase.from('leave_requests').update({
          stato: nuovoStato,
          titolo: titolo || null,
          note_dipendente: note || null,
          origine,
          outlet_code: persona.outlet,
          inviata_il: nuovoStato === 'inviata' ? new Date().toISOString() : null,
        }).eq('id', requestId);
        if (error) throw error;
        await supabase.from('leave_request_days').delete().eq('request_id', requestId);
      } else {
        const { data, error } = await supabase.from('leave_requests').insert({
          company_id: companyId,
          employee_id: persona.id,
          outlet_code: persona.outlet,
          stato: nuovoStato,
          titolo: titolo || null,
          note_dipendente: note || null,
          origine,
          compilata_da: userId ?? null,
          inviata_il: nuovoStato === 'inviata' ? new Date().toISOString() : null,
        }).select('id').single();
        if (error) throw error;
        requestId = (data as { id: string }).id;
      }

      const { error: errGiorni } = await supabase.from('leave_request_days').insert(
        giorniScelti.map((g) => ({
          company_id: companyId,
          request_id: requestId,
          data: g.data,
          voce: g.voce,
          tipo: g.tipo,
          ore: g.ore,
          nota: g.nota ?? null,
        })),
      );
      if (errGiorni) throw errGiorni;

      // L'avviso ai referenti e' un di piu': se la mail non e' configurata
      // (o non parte) la richiesta resta registrata lo stesso, e in
      // gestionale l'avviso c'e' comunque.
      let mail: string | null = null;
      if (nuovoStato === 'inviata' && requestId) {
        try {
          const { data } = await supabase.functions.invoke('leave-notify', {
            body: { request_id: requestId, momento: 'richiesta' },
          });
          mail = (data as { data?: { mail?: string } } | null)?.data?.mail ?? null;
        } catch {
          mail = 'failed';
        }
      }

      toast({
        type: 'success',
        message: nuovoStato === 'bozza'
          ? 'Bozza salvata: resta qui finché non la mandi.'
          : `Richiesta registrata: ${giorniScelti.length} ${giorniScelti.length === 1 ? 'giorno' : 'giorni'} per ${[persona.cognome, persona.nome].filter(Boolean).join(' ')}.`
            + (mail === 'sent' ? ' I referenti sono stati avvisati per mail.'
              : mail === 'skipped' ? ' Nessuna mail: i referenti non hanno ancora un indirizzo.'
                : mail === 'failed' ? ' La mail ai referenti non è partita: l\'avviso resta comunque nel gestionale.' : ''),
      });
      svuota();
      await carica();
    } catch (e) {
      toast({ type: 'error', message: `Non sono riuscito a salvare: ${(e as Error).message}` });
    } finally {
      setSalvataggio(false);
    }
  }

  async function riapriBozza(r: RichiestaSalvata) {
    setPersonaId(r.employee_id);
    setBozzaId(r.id);
    setTitolo(r.titolo ?? '');
    setNote(r.note_dipendente ?? '');
    setOrigine((r.origine as 'gestionale' | 'modulo_cartaceo' | 'mail') ?? 'gestionale');
    const m = new Map<string, GiornoRichiesto>();
    for (const g of r.giorni) m.set(chiave(g.data, g.voce), g);
    setScelti(m);
    if (r.giorni.length) {
      const prima = [...r.giorni].sort((a, b) => a.data.localeCompare(b.data))[0].data;
      setMese({ anno: Number(prima.slice(0, 4)), mese: Number(prima.slice(5, 7)) });
    }
  }

  async function ritira(r: RichiestaSalvata) {
    const { error } = await supabase.from('leave_requests')
      .update({ stato: 'ritirata' }).eq('id', r.id);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: 'Richiesta ritirata. Resta negli archivi con la sua storia.' });
    await carica();
  }

  // ── Export ─────────────────────────────────────────────────────────
  const moduloDi = useCallback((p: PersonaAnagrafica, giorni: GiornoRichiesto[], stato?: string): ModuloFerie => {
    const suoi = disponibilita[p.id] ?? [];
    const o = oreGiornata(p.oreSettimanaliPaghe, p.oreSettimanaliAnagrafica);
    return {
      azienda,
      dipendente: {
        nominativo: [p.cognome, p.nome].filter(Boolean).join(' '),
        matricola: p.matricola,
        outlet: p.outlet,
        oreSettimanali: p.oreSettimanaliPaghe ?? p.oreSettimanaliAnagrafica,
        oreGiornata: o.ore,
        fonteOrario: o.fonte,
      },
      saldi: suoi,
      giorni,
      titolo: titolo || null,
      note: note || null,
      stato: stato ? ETICHETTE_STATO[stato] ?? stato : null,
    };
  }, [azienda, disponibilita, titolo, note]);

  async function esporta(formato: 'pdf' | 'xlsx', tutti: boolean) {
    try {
      if (tutti) {
        const moduli = anagrafica.filter((p) => p.isActive).map((p) => moduloDi(p, []));
        if (!moduli.length) { toast({ type: 'warning', message: 'Non c\'è nessuno in forza da stampare.' }); return; }
        await (formato === 'pdf' ? esportaModuloPdf(moduli) : esportaModuloExcel(moduli));
        toast({ type: 'success', message: `Moduli in bianco per ${moduli.length} persone: uno per pagina, con i saldi già stampati sopra.` });
        return;
      }
      if (!persona) { toast({ type: 'warning', message: 'Scegli prima la persona.' }); return; }
      const m = moduloDi(persona, giorniScelti);
      await (formato === 'pdf' ? esportaModuloPdf(m) : esportaModuloExcel(m));
    } catch (e) {
      toast({ type: 'error', message: `Export non riuscito: ${(e as Error).message}` });
    }
  }

  // ── Interfaccia ────────────────────────────────────────────────────
  if (!companyId) return null;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <CalendarDays className="text-blue-600 shrink-0 mt-0.5" size={20} />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800">Richiesta di ferie e permessi</h3>
            <p className="text-sm text-slate-600 mt-1">
              Scegli la persona, segna i giorni sul calendario e salva. Le ore le calcola il gestionale
              dall'orario che risulta dal tabulato delle paghe. Finché i dipendenti non hanno un accesso,
              il modulo si esporta in PDF o in Excel: si manda, si fa compilare, e i giorni si riportano qui.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SceltaPersona
            dipendenti={anagrafica}
            valore={personaId}
            onScegli={(id) => { setPersonaId(id); svuota(); }}
            placeholder={caricamento ? 'Carico l\'anagrafica…' : 'Scegli la persona…'}
            classeBottone="w-[260px]"
          />
          {persona && (
            <div className="text-sm text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>{persona.outlet ?? 'Nessun punto vendita'}</span>
              <span>
                {orario.fonte === 'paghe' && `${persona.oreSettimanaliPaghe} ore a settimana (dalle paghe)`}
                {orario.fonte === 'anagrafica' && `${persona.oreSettimanaliAnagrafica} ore a settimana (da anagrafica)`}
                {orario.fonte === 'ripiego' && 'orario non noto'}
                {' · '}una giornata vale {formattaOre(orario.ore)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Saldi */}
      {persona && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {VOCI_ORDINE.map((voce) => {
            const s = saldi.find((x) => x.voce === voce);
            const oggi = s?.residuo_disponibile ?? s?.residuo ?? null;
            const fineAnno = s?.da_fruire_disponibile ?? s?.da_fruire ?? null;
            const inQuesta = totali[voce];
            const dopo = oggi != null ? round2(oggi - inQuesta) : null;
            return (
              <div key={voce} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">{ETICHETTE_VOCE[voce]}</div>
                {s ? (
                  <>
                    <div className="mt-1 text-2xl font-semibold text-slate-800">{formattaOre(oggi)}</div>
                    <div className="text-xs text-slate-500">
                      {formattaGiornate(oggi, orario.ore)} disponibili oggi
                    </div>
                    <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                      <div>Entro fine anno: {formattaOre(fineAnno)}</div>
                      {!!s.ore_in_attesa && <div className="text-amber-700">Già in attesa: {formattaOre(s.ore_in_attesa)}</div>}
                      {!!inQuesta && (
                        <div className={dopo != null && dopo < 0 ? 'text-rose-600 font-medium' : 'text-blue-700 font-medium'}>
                          In questa richiesta: {formattaOre(inQuesta)} → restano {formattaOre(dopo)}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-2 text-sm text-slate-400">
                    Nessun saldo: questa persona non compare nell'ultimo tabulato delle paghe.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Calendario */}
      {persona && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
              {VOCI_ORDINE.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVoceAttiva(v)}
                  className={`text-sm px-3 py-1.5 rounded-md ${voceAttiva === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {ETICHETTE_VOCE_BREVI[v]}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
              {(['giornata', 'mezza_giornata', 'ore'] as TipoGiorno[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipoAttivo(t)}
                  className={`text-sm px-3 py-1.5 rounded-md ${tipoAttivo === t ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {t === 'giornata' ? 'Giornata' : t === 'mezza_giornata' ? 'Mezza' : 'Ore'}
                </button>
              ))}
            </div>

            {tipoAttivo === 'ore' && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="number"
                  min={0.5}
                  max={orario.ore}
                  step={0.5}
                  value={orePermesso}
                  onChange={(e) => setOrePermesso(Number(e.target.value))}
                  className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                />
                ore per giorno
              </label>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button type="button" onClick={() => spostaMese(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="Mese precedente">
                <ChevronLeft size={18} />
              </button>
              <div className="text-sm font-medium text-slate-700 w-40 text-center">
                {MESI[mese.mese]} {mese.anno}
              </div>
              <button type="button" onClick={() => spostaMese(1)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" aria-label="Mese successivo">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {GIORNI_BREVI.map((g) => (
              <div key={g} className="text-xs text-slate-400 py-1">{g}</div>
            ))}
            {Array.from({ length: griglia.offset }, (_, i) => <div key={`v${i}`} />)}
            {griglia.giorni.map((data) => {
              const segnati = oreDelGiornoScelte(data);
              const festa = etichettaFestivita(data);
              const domenica = eDomenica(data);
              const ore = segnati.reduce((s, g) => s + g.ore, 0);
              return (
                <button
                  key={data}
                  type="button"
                  onClick={() => clickGiorno(data)}
                  title={festa ?? undefined}
                  className={[
                    'aspect-square sm:aspect-auto sm:min-h-[62px] rounded-lg border p-1 text-left transition-colors',
                    segnati.length
                      ? 'border-blue-500 bg-blue-50'
                      : festa || domenica
                        ? 'border-slate-100 bg-slate-50 text-slate-400'
                        : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/40',
                  ].join(' ')}
                >
                  <div className="flex items-baseline justify-between">
                    <span className={`text-sm ${segnati.length ? 'font-semibold text-blue-800' : ''}`}>
                      {Number(data.slice(8, 10))}
                    </span>
                    {!!ore && <span className="text-[10px] text-blue-700">{ore.toLocaleString('it-IT')}h</span>}
                  </div>
                  {!!segnati.length && (
                    <div className="mt-0.5 space-y-0.5">
                      {segnati.map((g) => (
                        <div key={g.voce} className="text-[10px] leading-tight text-blue-700 truncate">
                          {ETICHETTE_VOCE_BREVI[g.voce]}{g.tipo === 'mezza_giornata' ? ' ½' : g.tipo === 'ore' ? ' ore' : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {!segnati.length && festa && (
                    <div className="text-[10px] leading-tight text-slate-400 truncate">{festa}</div>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-slate-500">
            Un clic segna il giorno con la voce e il tipo scelti qui sopra, un altro clic lo toglie.
            Le domeniche e le festività restano grigie: si possono segnare lo stesso, ma il gestionale avvisa.
          </p>
        </div>
      )}

      {/* Giorni scelti, avvisi, salvataggio */}
      {persona && !!giorniScelti.length && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-slate-800">
              {giorniScelti.length} {giorniScelti.length === 1 ? 'giorno scelto' : 'giorni scelti'}
            </h4>
            <button type="button" onClick={svuota} className="text-sm text-slate-500 hover:text-rose-600 flex items-center gap-1">
              <Trash2 size={14} /> Ricomincia
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {giorniScelti.map((g) => (
              <span key={chiave(g.data, g.voce)} className="inline-flex items-center gap-2 text-xs bg-blue-50 text-blue-800 border border-blue-200 rounded-lg px-2 py-1">
                {formattaData(g.data)} · {ETICHETTE_VOCE_BREVI[g.voce]} · {ETICHETTE_TIPO[g.tipo].toLowerCase()} · {formattaOre(g.ore)}
                <button
                  type="button"
                  onClick={() => setScelti((p) => { const m = new Map(p); m.delete(chiave(g.data, g.voce)); return m; })}
                  className="text-blue-400 hover:text-rose-600"
                  aria-label={`Togli il ${formattaData(g.data)}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {!!avvisi.length && (
            <div className="space-y-1.5">
              {avvisi.map((a, i) => (
                <div
                  key={i}
                  className={[
                    'flex items-start gap-2 text-sm rounded-lg px-3 py-2 border',
                    a.gravita === 'blocco' ? 'bg-rose-50 border-rose-200 text-rose-800'
                      : a.gravita === 'attenzione' ? 'bg-amber-50 border-amber-200 text-amber-800'
                        : 'bg-slate-50 border-slate-200 text-slate-600',
                  ].join(' ')}
                >
                  {a.gravita === 'nota' ? <Info size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
                  <span>{a.testo}</span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-slate-600">Titolo della richiesta</span>
              <input
                value={titolo}
                onChange={(e) => setTitolo(e.target.value)}
                placeholder="Ferie di Natale"
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">Come è arrivata</span>
              <select
                value={origine}
                onChange={(e) => setOrigine(e.target.value as typeof origine)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="modulo_cartaceo">Modulo compilato a mano</option>
                <option value="mail">Per mail</option>
                <option value="gestionale">Compilata qui insieme alla persona</option>
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-slate-600">Note</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={salvataggio}
              onClick={() => void salva('inviata')}
              className="inline-flex items-center gap-2 bg-blue-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
            >
              <Send size={15} /> {bozzaId ? 'Registra la richiesta' : 'Registra la richiesta'}
            </button>
            <button
              type="button"
              disabled={salvataggio}
              onClick={() => void salva('bozza')}
              className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
            >
              <Save size={15} /> Salva come bozza
            </button>
            <button
              type="button"
              onClick={() => void esporta('pdf', false)}
              className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-4 py-2 hover:bg-slate-50"
            >
              <FileDown size={15} /> PDF
            </button>
            <button
              type="button"
              onClick={() => void esporta('xlsx', false)}
              className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-4 py-2 hover:bg-slate-50"
            >
              <FileSpreadsheet size={15} /> Excel
            </button>
          </div>
        </div>
      )}

      {/* Modulo in bianco */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Users className="text-slate-400 shrink-0 mt-0.5" size={20} />
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-slate-800">Moduli da far compilare</h4>
            <p className="text-sm text-slate-600 mt-1">
              Un foglio per persona, con i suoi saldi già stampati sopra e le righe da riempire a mano.
              Serve adesso che i dipendenti non hanno un accesso: si manda, torna compilato, e i giorni
              si riportano qui sopra.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!persona}
                onClick={() => void (persona && esportaModuloPdf(moduloDi(persona, [])))}
                className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
              >
                <FileDown size={15} /> Solo per la persona scelta
              </button>
              <button
                type="button"
                onClick={() => void esporta('pdf', true)}
                className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-3 py-1.5 hover:bg-slate-50"
              >
                <FileDown size={15} /> PDF per tutti quelli in forza
              </button>
              <button
                type="button"
                onClick={() => void esporta('xlsx', true)}
                className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 text-sm rounded-lg px-3 py-1.5 hover:bg-slate-50"
              >
                <FileSpreadsheet size={15} /> Excel per tutti quelli in forza
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Richieste già registrate */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <h4 className="font-medium text-slate-800 mb-3">
          {personaId ? 'Le richieste di questa persona' : 'Richieste registrate'}
        </h4>

        {caricamento && <div className="text-sm text-slate-400">Carico…</div>}

        {!caricamento && !richiestePersona.length && (
          <p className="text-sm text-slate-500">
            Non c'è ancora nessuna richiesta. La prima nasce qui sopra: scegli la persona, segna i giorni e salva.
          </p>
        )}

        <div className="space-y-2">
          {richiestePersona.map((r) => {
            const p = anagrafica.find((x) => x.id === r.employee_id);
            const t = totaliPerVoce(r.giorni);
            const o = oreGiornata(p?.oreSettimanaliPaghe, p?.oreSettimanaliAnagrafica);
            const date = [...r.giorni].map((g) => g.data).sort();
            return (
              <div key={r.id} className="border border-slate-200 rounded-lg p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${COLORE_STATO[r.stato] ?? 'bg-slate-100 text-slate-600'}`}>
                    {ETICHETTE_STATO[r.stato] ?? r.stato}
                  </span>
                  {!personaId && p && (
                    <span className="text-sm font-medium text-slate-800">
                      {[p.cognome, p.nome].filter(Boolean).join(' ')}
                    </span>
                  )}
                  <span className="text-sm text-slate-600">
                    {r.titolo || (date.length
                      ? date.length === 1
                        ? formattaData(date[0])
                        : `dal ${formattaData(date[0])} al ${formattaData(date[date.length - 1])}`
                      : 'senza giorni')}
                  </span>
                  <span className="text-xs text-slate-400">
                    {r.giorni.length} {r.giorni.length === 1 ? 'giorno' : 'giorni'}
                    {VOCI_ORDINE.filter((v) => t[v]).map((v) => ` · ${ETICHETTE_VOCE_BREVI[v]} ${formattaOre(t[v])}`).join('')}
                    {' · '}{giornateDaOre(r.giorni.reduce((s, g) => s + g.ore, 0), o.ore).toLocaleString('it-IT', { maximumFractionDigits: 1 })} giornate
                  </span>
                  <span className="text-xs text-slate-400">{ETICHETTE_ORIGINE[r.origine] ?? r.origine}</span>

                  <div className="ml-auto flex items-center gap-2">
                    {r.stato === 'bozza' && (
                      <button type="button" onClick={() => void riapriBozza(r)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                        <Clock size={13} /> Riprendi
                      </button>
                    )}
                    {r.stato === 'inviata' && (
                      <button type="button" onClick={() => void ritira(r)} className="text-xs text-slate-500 hover:text-rose-600 flex items-center gap-1">
                        <Undo2 size={13} /> Ritira
                      </button>
                    )}
                    {p && (
                      <button
                        type="button"
                        onClick={() => void esportaModuloPdf(moduloDi(p, r.giorni, r.stato))}
                        className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
                      >
                        <FileDown size={13} /> PDF
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!!richiestePersona.length && (
          <p className="mt-3 text-xs text-slate-500 flex items-start gap-1.5">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald-500" />
            Ogni passaggio resta scritto: chi ha compilato, quando, e ogni cambio di stato. Una richiesta
            inviata non si cancella, si ritira.
          </p>
        )}
      </div>
    </div>
  );
}
