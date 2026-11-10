// «Traffico MODA» (Dipendenti → Turni): si caricano i report MODA «Statistica
// Situazione Vendite con Conversion Rate» (negozio, giorno, ora) e gli ingressi
// per ora finiscono in outlet_traffic_hourly, la fonte del fabbisogno dei turni.
// Prima di questa scheda i report li caricava Claude a mano (20 e 29/10/2026).
//
// Regola fissa dei caricamenti (Patrizio, 08/10/2026): il file si salva da solo;
// si chiede conferma solo se SOSTITUIREBBE giorni gia' presenti con numeri
// diversi o se i totali del report non tornano; alla fine si dice che e'
// finito; la pagina mostra i mesi appena arrivati; piu' file si lavorano uno
// alla volta. Il confronto con quello che c'e' si fa sul database.
//
// Lettura del PDF e confronti: src/lib/trafficoModa.ts.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { FileUp, Loader2, Check, AlertTriangle, CheckCircle2, Info, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { extractPdfItems } from '../lib/pdfText';
import {
  leggiReportModa, totaliCheNonTornano, giornoIncompleto, abbinaNegozio, confrontaGiorni,
  giorniMancanti, periodoLeggibile, meseLeggibile,
  type GiornoModa, type EsitoGiorno, type RigaTrafficoDb,
} from '../lib/trafficoModa';
import { nomeNegozio, type NegozioRif } from '../lib/organicoDati';
import { oggiRoma, aggiungiGiorni } from '../lib/organico';

type Props = { companyId: string; negozi: NegozioRif[]; puoScrivere: boolean };

type NonAbbinato = { codice: string; descrizione: string; giorni: GiornoModa[] };
type Attesa = {
  /** giorni che cambierebbero numeri gia' presenti, o con i totali che non tornano */
  diversi: (EsitoGiorno & { totaleNonTorna?: boolean })[];
  nonAbbinati: NonAbbinato[];
  scelte: Record<string, string>;
};
type Voce = {
  id: number;
  file: File;
  stato: 'in_coda' | 'lettura' | 'salvataggio' | 'salvato' | 'da_confermare' | 'errore';
  nota?: string;
  attesa?: Attesa;
};

const fmt = (n: number) => n.toLocaleString('it-IT');
const dataIt = (d: string) => d.split('-').reverse().join('/');
const giorni = (n: number) => (n === 1 ? '1 giorno' : `${fmt(n)} giorni`);

/** Le date con traffico per negozio, lette a pagine (mille righe per richiesta). */
async function caricaCopertura(companyId: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let da = 0; ; da += 1000) {
    const { data, error } = await supabase.from('outlet_traffic_hourly').select('outlet_id, data')
      .eq('company_id', companyId).order('data').order('outlet_id').order('ora').range(da, da + 999);
    if (error) throw error;
    const righe = (data as { outlet_id: string; data: string }[]) ?? [];
    for (const r of righe) {
      if (!out.has(r.outlet_id)) out.set(r.outlet_id, new Set());
      out.get(r.outlet_id)!.add(r.data);
    }
    if (righe.length < 1000) break;
  }
  return out;
}

/** Quello che c'e' gia' nel database per questi negozi e queste date. */
async function caricaEsistenti(companyId: string, outletIds: string[], dal: string, al: string): Promise<RigaTrafficoDb[]> {
  const out: RigaTrafficoDb[] = [];
  if (!outletIds.length) return out;
  for (let da = 0; ; da += 1000) {
    const { data, error } = await supabase.from('outlet_traffic_hourly').select('outlet_id, data, ora, ingressi, scontrini')
      .eq('company_id', companyId).in('outlet_id', outletIds).gte('data', dal).lte('data', al)
      .order('outlet_id').order('data').order('ora').range(da, da + 999);
    if (error) throw error;
    const righe = (data as RigaTrafficoDb[]) ?? [];
    out.push(...righe);
    if (righe.length < 1000) break;
  }
  return out;
}

export default function TrafficoModa({ companyId, negozi, puoScrivere }: Props) {
  const [voci, setVoci] = useState<Voce[]>([]);
  const [drag, setDrag] = useState(false);
  const [copertura, setCopertura] = useState<Map<string, Set<string>> | null>(null);
  const [erroreCopertura, setErroreCopertura] = useState<string | null>(null);
  /** i mesi arrivati con i file di questa sessione: la tabella li mette in evidenza */
  const [appena, setAppena] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const tabellaRef = useRef<HTMLDivElement>(null);
  const catena = useRef<Promise<void>>(Promise.resolve());
  const prossimo = useRef(1);

  const ricaricaCopertura = useCallback(async () => {
    try { setCopertura(await caricaCopertura(companyId)); setErroreCopertura(null); }
    catch (e) { setErroreCopertura(e instanceof Error ? e.message : 'errore'); }
  }, [companyId]);
  useEffect(() => { void ricaricaCopertura(); }, [ricaricaCopertura]);

  const aggiorna = (id: number, p: Partial<Voce>) => setVoci((vs) => vs.map((v) => (v.id === id ? { ...v, ...p } : v)));

  /** Scrive le righe (inserisce o sostituisce l'ora del negozio). */
  const salvaRighe = async (righe: RigaTrafficoDb[], nomeFile: string) => {
    const adesso = new Date().toISOString();
    for (let i = 0; i < righe.length; i += 500) {
      const { error } = await supabase.from('outlet_traffic_hourly').upsert(
        righe.slice(i, i + 500).map((r) => ({ ...r, company_id: companyId, fonte: 'moda', file_name: nomeFile.slice(0, 200), updated_at: adesso })),
        { onConflict: 'outlet_id,data,ora' },
      );
      if (error) throw error;
    }
  };

  /**
   * Confronta con il database i giorni gia' abbinati a un negozio: salva da
   * solo quelli nuovi, salta quelli uguali, restituisce quelli che
   * cambierebbero numeri gia' presenti.
   */
  const elabora = async (coppie: { outletId: string; giorno: GiornoModa }[], nomeFile: string, nonTornano: Set<string>) => {
    if (!coppie.length) return { salvati: [] as EsitoGiorno[], uguali: 0, diversi: [] as Attesa['diversi'] };
    const date = coppie.map((c) => c.giorno.data).sort();
    const esistenti = await caricaEsistenti(companyId, [...new Set(coppie.map((c) => c.outletId))], date[0], date[date.length - 1]);
    const esiti = confrontaGiorni(coppie, esistenti);
    const chiave = (e: EsitoGiorno) => `${e.outletId}|${e.data}`;
    const salvati = esiti.filter((e) => e.stato === 'nuovo' && !nonTornano.has(chiave(e)));
    const diversi = esiti
      .filter((e) => e.stato === 'diverso' || (e.stato === 'nuovo' && nonTornano.has(chiave(e))))
      .map((e) => ({ ...e, totaleNonTorna: nonTornano.has(chiave(e)) }));
    await salvaRighe(salvati.flatMap((e) => e.righe), nomeFile);
    return { salvati, uguali: esiti.filter((e) => e.stato === 'uguale').length, diversi };
  };

  const frase = (salvati: EsitoGiorno[], uguali: number) => {
    const parti: string[] = [];
    if (salvati.length) {
      const neg = new Set(salvati.map((e) => e.outletId)).size;
      const ore = salvati.reduce((a, e) => a + e.righe.length, 0);
      const mesi = [...new Set(salvati.map((e) => e.data.slice(0, 7)))].sort();
      parti.push(`salvati ${giorni(salvati.length)} (${fmt(ore)} ore) di ${neg === 1 ? '1 negozio' : `${neg} negozi`}, ${mesi.map(meseLeggibile).join(', ')}`);
    }
    if (uguali) parti.push(`${giorni(uguali)} c'erano già, uguali`);
    return parti.join('; ');
  };

  const segnaMesi = (esiti: EsitoGiorno[]) => {
    if (!esiti.length) return;
    setAppena((s) => new Set([...s, ...esiti.map((e) => e.data.slice(0, 7))]));
  };

  /** Un file dall'inizio alla fine. */
  const lavora = async (v: Voce) => {
    aggiorna(v.id, { stato: 'lettura', nota: undefined });
    try {
      const r = leggiReportModa(await extractPdfItems(v.file));
      aggiorna(v.id, { stato: 'salvataggio' });
      const incompleto = giornoIncompleto(r);
      const nonTornano = new Set<string>();
      const coppie: { outletId: string; giorno: GiornoModa }[] = [];
      const nonAbbinati: NonAbbinato[] = [];
      const abbinati = new Map<string, string>();
      for (const n of r.negozi) {
        const o = abbinaNegozio(n.codice, n.descrizione, negozi.map((x) => ({ id: x.id, name: x.name ?? '', code: x.code ?? null })));
        const gg = n.giorni.filter((g) => g.ore.length && g.data !== incompleto);
        if (!o) { if (gg.length) nonAbbinati.push({ codice: n.codice, descrizione: n.descrizione, giorni: gg }); continue; }
        abbinati.set(n.codice, o.id);
        for (const g of gg) coppie.push({ outletId: o.id, giorno: g });
      }
      for (const t of totaliCheNonTornano(r)) {
        const id = abbinati.get(t.codice);
        if (id) nonTornano.add(`${id}|${t.data}`);
      }
      const { salvati, uguali, diversi } = await elabora(coppie, v.file.name, nonTornano);
      segnaMesi(salvati);

      const note: string[] = [];
      const periodo = r.dal && r.al ? `Report ${periodoLeggibile(r.dal, r.al)}` : 'Report';
      const fatto = frase(salvati, uguali);
      note.push(`${periodo}: ${fatto || 'nessun giorno nuovo'}`);
      if (incompleto) note.push(`il ${dataIt(incompleto)} non è caricato: il report è stato stampato quel giorno${r.stampa?.ora ? ` alle ${r.stampa.ora}` : ''}, a negozio aperto. Arriverà con il report successivo`);
      if (!r.impostazioniStandard) note.push('attenzione: il report non è «senza IVA, escluse vendite libere, buoni e acconti» come al solito; gli ingressi valgono lo stesso, gli scontrini possono essere diversi');
      if (diversi.length || nonAbbinati.length) {
        aggiorna(v.id, { stato: 'da_confermare', nota: note.join('. ') + '.', attesa: { diversi, nonAbbinati, scelte: {} } });
      } else {
        aggiorna(v.id, { stato: 'salvato', nota: note.join('. ') + '.' });
      }
    } catch (e) {
      aggiorna(v.id, { stato: 'errore', nota: e instanceof Error ? e.message : 'Lettura non riuscita.' });
    }
    await ricaricaCopertura();
  };

  const leggi = (files: FileList | File[]) => {
    const nuove: Voce[] = [...files].map((file) => ({ id: prossimo.current++, file, stato: 'in_coda' as const }));
    setVoci((vs) => [...vs, ...nuove]);
    for (const v of nuove) {
      if (!/\.pdf$/i.test(v.file.name)) {
        aggiorna(v.id, { stato: 'errore', nota: 'Serve il PDF del report MODA «Conversion Rate».' });
        continue;
      }
      // Uno alla volta, ciascuno fino in fondo.
      catena.current = catena.current.then(() => lavora(v));
    }
  };

  /** Conferma: sostituisce i giorni diversi e carica i negozi scelti a mano. */
  const conferma = async (v: Voce) => {
    if (!v.attesa) return;
    const { diversi, nonAbbinati, scelte } = v.attesa;
    aggiorna(v.id, { stato: 'salvataggio' });
    try {
      await salvaRighe(diversi.flatMap((e) => e.righe), v.file.name);
      segnaMesi(diversi);
      const scelti = nonAbbinati.filter((n) => scelte[n.codice]);
      const altri = await elabora(scelti.flatMap((n) => n.giorni.map((g) => ({ outletId: scelte[n.codice], giorno: g }))), v.file.name, new Set());
      segnaMesi(altri.salvati);
      const saltati = nonAbbinati.filter((n) => !scelte[n.codice]);
      const parti = [
        diversi.length ? `sostituiti ${giorni(diversi.length)}` : '',
        frase(altri.salvati, altri.uguali),
        saltati.length ? `non caricati, senza negozio: ${saltati.map((n) => `${n.codice} «${n.descrizione}»`).join(', ')}` : '',
      ].filter(Boolean);
      if (altri.diversi.length) {
        aggiorna(v.id, { stato: 'da_confermare', nota: `${v.nota ?? ''} Poi: ${parti.join('; ')}.`, attesa: { diversi: altri.diversi, nonAbbinati: [], scelte: {} } });
      } else {
        aggiorna(v.id, { stato: 'salvato', nota: `${v.nota ?? ''} Poi: ${parti.join('; ') || 'niente da cambiare'}.`, attesa: undefined });
      }
    } catch (e) {
      aggiorna(v.id, { stato: 'errore', nota: e instanceof Error ? e.message : 'Salvataggio non riuscito.' });
    }
    await ricaricaCopertura();
  };

  const lasciaCosi = (v: Voce) => aggiorna(v.id, {
    stato: 'salvato', attesa: undefined,
    nota: `${v.nota ?? ''} I giorni già presenti sono rimasti come erano${v.attesa?.nonAbbinati.length ? '; i negozi non riconosciuti non sono stati caricati' : ''}.`,
  });

  // ── Chiusura del caricamento ─────────────────────────────────────────────
  const inCorso = voci.some((v) => v.stato === 'in_coda' || v.stato === 'lettura' || v.stato === 'salvataggio');
  const daConfermare = voci.filter((v) => v.stato === 'da_confermare').length;
  const errori = voci.filter((v) => v.stato === 'errore').length;
  const salvati = voci.filter((v) => v.stato === 'salvato').length;
  const chiusura = voci.length === 0 || inCorso ? null
    : daConfermare === 0 && errori === 0
      ? { ok: true, titolo: 'Finito, tutti i dati sono aggiornati', testo: `${salvati === 1 ? '1 report caricato' : `${salvati} report caricati`}. I piani dei turni usano già il traffico nuovo; i mesi arrivati sono evidenziati nella tabella qui sotto.` }
      : {
        ok: false,
        titolo: salvati ? 'Quasi finito' : 'Niente di salvato',
        testo: [
          daConfermare ? `${daConfermare === 1 ? '1 report aspetta' : `${daConfermare} report aspettano`} la tua conferma: cambierebbe giorni già caricati, o c'è un negozio da scegliere (il dettaglio è accanto al file)` : '',
          errori ? `${errori === 1 ? '1 file non è riuscito' : `${errori} file non sono riusciti`}: il motivo è scritto accanto` : '',
        ].filter(Boolean).join('; ') + '.',
      };

  // Appena finito, la tabella si mostra sui mesi arrivati.
  useEffect(() => {
    if (chiusura && appena.size) tabellaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [chiusura?.titolo, appena.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tabella dei mesi caricati ────────────────────────────────────────────
  const ieri = aggiungiGiorni(oggiRoma(), -1);
  const mesi = useMemo(() => {
    if (!copertura) return [];
    const tutte = [...copertura.values()].flatMap((s) => [...s]);
    const primo = tutte.length ? tutte.reduce((a, b) => (a < b ? a : b)).slice(0, 7) : ieri.slice(0, 7);
    // al massimo gli ultimi 18 mesi
    const limite = (() => { const d = new Date(`${ieri.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 17); return d.toISOString().slice(0, 7); })();
    const out: string[] = [];
    const d = new Date(`${(primo > limite ? primo : limite)}-01T00:00:00Z`);
    while (d.toISOString().slice(0, 7) <= ieri.slice(0, 7)) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
    return out;
  }, [copertura, ieri]);
  const righeNegozi = useMemo(() => negozi
    .filter((n) => (copertura?.get(n.id)?.size ?? 0) > 0 || (n.is_active !== false && !!n.opening_date))
    .sort((a, b) => nomeNegozio(a).localeCompare(nomeNegozio(b), 'it')), [negozi, copertura]);

  const cella = (n: NegozioRif, mese: string) => {
    const presenti = copertura?.get(n.id) ?? new Set<string>();
    const inizio = n.opening_date && n.opening_date > `${mese}-01` ? n.opening_date : `${mese}-01`;
    const [a, m] = mese.split('-').map(Number);
    const fine = [new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10), ieri].sort()[0];
    if (inizio > fine) return { testo: '', titolo: 'negozio non ancora aperto', tono: 'vuoto' as const };
    let attesi = 0; let caricati = 0;
    for (let d = inizio; d <= fine; d = aggiungiGiorni(d, 1)) { attesi++; if (presenti.has(d)) caricati++; }
    const mancano = giorniMancanti(mese, new Set([...presenti, ...[...Array(31)].map((_, i) => `${mese}-${String(i + 1).padStart(2, '0')}`).filter((d) => d < inizio)]), fine);
    return {
      testo: caricati ? `${caricati}/${attesi}` : '–',
      titolo: caricati === attesi ? `${meseLeggibile(mese)}: tutti i giorni` : `${meseLeggibile(mese)}: ${caricati} giorni su ${attesi}${mancano ? `; mancano ${mancano}` : ''}`,
      tono: caricati === 0 ? 'vuoto' as const : caricati >= attesi ? 'pieno' as const : 'parziale' as const,
    };
  };

  const trascina = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setDrag(false); if (puoScrivere && e.dataTransfer.files?.length) leggi(e.dataTransfer.files); },
  };

  return (
    <div className="space-y-4">
      {puoScrivere && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <FileUp size={18} className="text-blue-600" />
            <h3 className="font-bold text-slate-800">Carica i report MODA</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Trascina qui il PDF «Statistica Situazione Vendite con Conversion Rate» per negozio, giorno e ora, anche più di uno.
            Il gestionale legge gli ingressi di ogni ora e li salva da solo. Ti chiede di confermare solo se un giorno era già
            caricato con numeri diversi, o se i totali del report non tornano. Quando ha finito te lo dice qui sotto.
          </p>
          <div
            {...trascina}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${drag ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 text-slate-500'}`}
          >
            Trascina i PDF o <span className="text-blue-600 font-medium">sceglili dal computer</span>
            <input ref={inputRef} type="file" multiple accept=".pdf" className="hidden" aria-label="Report MODA in PDF"
              onChange={(e) => { if (e.target.files?.length) leggi(e.target.files); e.target.value = ''; }} />
          </div>

          {voci.length > 0 && (
            <ul className="mt-3 space-y-2">
              {voci.map((v) => (
                <li key={v.id} className="text-sm border border-slate-100 rounded-lg px-3 py-2">
                  <div className="flex items-start gap-2">
                    {(v.stato === 'in_coda' || v.stato === 'lettura' || v.stato === 'salvataggio') && <Loader2 size={16} className="animate-spin text-slate-400 mt-0.5 shrink-0" />}
                    {v.stato === 'salvato' && <Check size={16} className="text-green-600 mt-0.5 shrink-0" />}
                    {(v.stato === 'errore' || v.stato === 'da_confermare') && <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-800 break-all">{v.file.name}</div>
                      <div className="text-xs text-slate-500">
                        {v.stato === 'in_coda' && 'In coda…'}
                        {v.stato === 'lettura' && 'Lettura del PDF…'}
                        {v.stato === 'salvataggio' && 'Confronto con i dati già caricati e salvataggio…'}
                        {v.nota}
                      </div>
                    </div>
                  </div>

                  {v.stato === 'da_confermare' && v.attesa && (
                    <div className="mt-2 ml-6 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-2">
                      {v.attesa.diversi.length > 0 && (
                        <div>
                          <div className="font-semibold mb-1">
                            {v.attesa.diversi.length === 1 ? '1 giorno cambierebbe' : `${v.attesa.diversi.length} giorni cambierebbero`} rispetto a quello che c'è già
                          </div>
                          <ul className="space-y-0.5 max-h-48 overflow-auto">
                            {v.attesa.diversi.map((e) => (
                              <li key={`${e.outletId}|${e.data}`}>
                                {nomeNegozio(negozi.find((n) => n.id === e.outletId))}, {dataIt(e.data)}:{' '}
                                {e.totaleNonTorna
                                  ? `nel report la somma delle ore non torna con il totale del giorno (${fmt(e.ingressiFile)} ingressi nelle ore)`
                                  : e.ingressiDb === e.ingressiFile
                                    ? `ingressi uguali (${fmt(e.ingressiFile)}), cambiano scontrini o ore`
                                    : `${fmt(e.ingressiDb)} ingressi oggi, ${fmt(e.ingressiFile)} nel report`}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {v.attesa.nonAbbinati.length > 0 && (
                        <div>
                          <div className="font-semibold mb-1">Negozi del report che il gestionale non riconosce: scegli a quale corrispondono</div>
                          {v.attesa.nonAbbinati.map((n) => (
                            <label key={n.codice} className="flex flex-wrap items-center gap-2 mb-1">
                              <span>{n.codice} «{n.descrizione}» ({giorni(n.giorni.length)})</span>
                              <select value={v.attesa!.scelte[n.codice] ?? ''} className="rounded border border-amber-300 bg-white px-1 py-0.5"
                                onChange={(ev) => aggiorna(v.id, { attesa: { ...v.attesa!, scelte: { ...v.attesa!.scelte, [n.codice]: ev.target.value } } })}>
                                <option value="">non caricare</option>
                                {negozi.map((x) => <option key={x.id} value={x.id}>{nomeNegozio(x)}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button type="button" onClick={() => void conferma(v)}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium inline-flex items-center gap-1">
                          {v.attesa.diversi.length ? 'Sostituisci con il report' : 'Carica'} <Check size={13} />
                        </button>
                        <button type="button" onClick={() => lasciaCosi(v)}
                          className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white hover:bg-amber-100 font-medium">
                          Lascia com'è
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {chiusura && (
            <div role="status" className={`mt-3 rounded-xl border p-3 flex items-start gap-2.5 ${chiusura.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
              {chiusura.ok ? <CheckCircle2 size={20} className="shrink-0 text-emerald-600" /> : <AlertTriangle size={20} className="shrink-0" />}
              <div>
                <div className="font-semibold text-sm">{chiusura.titolo}</div>
                <div className="text-xs mt-0.5">{chiusura.testo}</div>
              </div>
            </div>
          )}

          <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer flex items-center gap-1 text-slate-500"><Info size={13} /> Quale report e cosa succede dopo</summary>
            <ul className="mt-2 ml-4 list-disc space-y-1">
              <li><strong>Il report</strong>: in MODA «Statistica Situazione Vendite con Conversion Rate», raggruppato per Negozio, Giorno e Ora, senza IVA, escluse vendite libere, buoni e acconti, stampato in PDF. Può contenere tutti i negozi e qualunque periodo, anche nove mesi insieme.</li>
              <li><strong>Cosa si salva</strong>: per ogni negozio, giorno e ora gli ingressi (colonna N.P.) e gli scontrini. Gli importi non si salvano.</li>
              <li><strong>Controlli</strong>: la somma delle ore deve tornare con il totale del giorno stampato nel report. Il giorno in cui il report è stato stampato non si carica, perché a negozio aperto non è finito.</li>
              <li><strong>Conferma</strong>: solo se un giorno era già caricato con numeri diversi, se i totali non tornano o se un negozio del report non si riconosce. I giorni nuovi si salvano subito.</li>
              <li><strong>Dopo</strong>: il piano del mese e il piano settimanale calcolano il fabbisogno da questo traffico (ingressi diviso la soglia del negozio, in «Regole dei turni»).</li>
            </ul>
          </details>
        </div>
      )}

      <div ref={tabellaRef} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={18} className="text-slate-500" />
          <h3 className="font-bold text-slate-800">Giorni di traffico caricati</h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Per ogni negozio e mese, i giorni con il traffico MODA su quelli da caricare (fino a ieri, dall'apertura del negozio).
          Passa sopra una casella per vedere i giorni che mancano. {appena.size > 0 && 'In blu i mesi appena caricati.'}
        </p>
        {erroreCopertura && <div className="text-sm text-red-600">Tabella non caricata: {erroreCopertura}</div>}
        {!copertura && !erroreCopertura && <div className="text-sm text-slate-400">Caricamento…</div>}
        {copertura && (
          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-0.5">
              <thead>
                <tr>
                  <th className="text-left font-medium text-slate-500 pr-2 sticky left-0 bg-white">Negozio</th>
                  {mesi.map((m) => (
                    <th key={m} className={`font-medium px-1 whitespace-nowrap ${appena.has(m) ? 'text-blue-700' : 'text-slate-500'}`}>
                      {meseLeggibile(m).slice(0, 3)} {m.slice(2, 4)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {righeNegozi.map((n) => (
                  <tr key={n.id}>
                    <td className="pr-2 py-0.5 text-slate-700 whitespace-nowrap sticky left-0 bg-white">{nomeNegozio(n)}</td>
                    {mesi.map((m) => {
                      const c = cella(n, m);
                      const colore = c.tono === 'pieno' ? 'bg-emerald-50 text-emerald-800' : c.tono === 'parziale' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-400';
                      return (
                        <td key={m} title={c.titolo}
                          className={`text-center px-1.5 py-1 rounded tabular-nums ${colore} ${appena.has(m) ? 'ring-2 ring-blue-400' : ''}`}>
                          {c.testo}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
