// Caricamento dei report MODA «Statistica Situazione Vendite con Conversion
// Rate» per giorno e ora. Sta nella sezione «Vendite e ingressi» (Patrizio,
// 24/11/2026: ci caricano ogni mese Sabrina per New Zago e Veronica per Zago);
// in Dipendenti → Turni → «Traffico MODA» resta solo la tabella dei giorni
// caricati, con il collegamento qui (soloTabella).
// Del report si salva tutto, per negozio, giorno e ora, in outlet_traffic_hourly:
// ingressi e scontrini (il fabbisogno dei turni), pezzi, valore teorico, valore
// reale e costo d'acquisto (il report della sezione). Importi imponibili.
// Ricaricare un file non somma niente: ogni ora si sostituisce, e un giorno
// salvato e' esattamente quello del file.
//
// Regola fissa dei caricamenti (Patrizio, 08/10/2026): il file si salva da solo;
// si chiede conferma solo se SOSTITUIREBBE giorni gia' presenti con numeri
// diversi o se i totali del report non tornano; alla fine si dice che e'
// finito; la pagina mostra i mesi appena arrivati; piu' file si lavorano uno
// alla volta. Il confronto con quello che c'e' si fa sul database.
//
// Lettura del PDF e confronti: src/lib/trafficoModa.ts.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Loader2, Check, AlertTriangle, CheckCircle2, Info, Clock, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { extractPdfItems } from '../lib/pdfText';
import { espandiZip, isZip } from '../lib/zipFiles';
import {
  leggiReportModa, totaliCheNonTornano, giornoIncompleto, abbinaNegozio, confrontaGiorni,
  giorniMancanti, periodoLeggibile, meseLeggibile,
  type GiornoModa, type EsitoGiorno, type RigaTrafficoDb,
} from '../lib/trafficoModa';
import { nomeNegozio, type NegozioRif } from '../lib/organicoDati';
import { oggiRoma, aggiungiGiorni } from '../lib/organico';

type Props = {
  companyId: string;
  negozi: NegozioRif[];
  puoScrivere: boolean;
  /** solo la tabella dei giorni caricati, con il collegamento a «Vendite e ingressi» (scheda dei Turni) */
  soloTabella?: boolean;
};

type NonAbbinato = { codice: string; descrizione: string; giorni: GiornoModa[]; nonTornano: string[] };
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
  /** cose rimaste fuori anche a file finito (giorno di stampa, giorni lasciati com'erano, negozi non caricati): il riquadro finale le dice */
  resta?: string[];
  /** giorni scritti nel database da questo file (anche prima della conferma) */
  giorniSalvati?: number;
  /** lo zip da cui e' uscito il file */
  daZip?: string | null;
};

const fmt = (n: number) => n.toLocaleString('it-IT');
const dataIt = (d: string) => d.split('-').reverse().join('/');
const giorni = (n: number) => (n === 1 ? '1 giorno' : `${fmt(n)} giorni`);

/** Giorni di chiusura: settimana tipo chiusa (1 = lunedi') e giorni speciali chiusi. Non sono giorni «mancanti». */
type Chiusure = { settimana: Map<string, Set<number>>; date: Map<string, Set<string>> };
const giornoIso = (d: string) => { const g = new Date(`${d}T00:00:00Z`).getUTCDay(); return g === 0 ? 7 : g; };

/** Le date con traffico per negozio, lette a pagine (mille righe per richiesta). */
async function caricaChiusure(companyId: string): Promise<Chiusure> {
  const [o, s] = await Promise.all([
    supabase.from('outlet_opening_hours').select('outlet_id, giorno, chiuso').eq('company_id', companyId).eq('chiuso', true),
    supabase.from('outlet_special_days').select('outlet_id, data, chiuso').eq('company_id', companyId).eq('chiuso', true),
  ]);
  const out: Chiusure = { settimana: new Map(), date: new Map() };
  for (const r of (o.data as { outlet_id: string; giorno: number }[] | null) ?? []) {
    if (!out.settimana.has(r.outlet_id)) out.settimana.set(r.outlet_id, new Set());
    out.settimana.get(r.outlet_id)!.add(Number(r.giorno));
  }
  for (const r of (s.data as { outlet_id: string; data: string }[] | null) ?? []) {
    if (!out.date.has(r.outlet_id)) out.date.set(r.outlet_id, new Set());
    out.date.get(r.outlet_id)!.add(r.data);
  }
  return out;
}

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
    const { data, error } = await supabase.from('outlet_traffic_hourly').select('outlet_id, data, ora, ingressi, scontrini, pezzi, valore_teorico, vendite, costo_acquisto')
      .eq('company_id', companyId).in('outlet_id', outletIds).gte('data', dal).lte('data', al)
      .order('outlet_id').order('data').order('ora').range(da, da + 999);
    if (error) throw error;
    const righe = (data as RigaTrafficoDb[]) ?? [];
    out.push(...righe);
    if (righe.length < 1000) break;
  }
  return out;
}

/** I codici negozio di MODA gia' scelti a mano una volta (outlet_moda_codici, migration 464). */
async function caricaCodiciModa(companyId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.from('outlet_moda_codici').select('codice, outlet_id').eq('company_id', companyId);
  if (error) return new Map(); // senza la tabella si torna ad abbinare per nome, come prima
  return new Map(((data as { codice: string; outlet_id: string }[]) ?? []).map((r) => [r.codice.toUpperCase(), r.outlet_id]));
}

export default function TrafficoModa({ companyId, negozi, puoScrivere, soloTabella = false }: Props) {
  const [voci, setVoci] = useState<Voce[]>([]);
  const [drag, setDrag] = useState(false);
  const [copertura, setCopertura] = useState<Map<string, Set<string>> | null>(null);
  const [erroreCopertura, setErroreCopertura] = useState<string | null>(null);
  const [chiusure, setChiusure] = useState<Chiusure>({ settimana: new Map(), date: new Map() });
  /** i mesi arrivati con i file di questa sessione: la tabella li mette in evidenza */
  const [appena, setAppena] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const tabellaRef = useRef<HTMLDivElement>(null);
  const catena = useRef<Promise<void>>(Promise.resolve());
  const prossimo = useRef(1);

  const ricaricaCopertura = useCallback(async () => {
    try {
      const [c, ch] = await Promise.all([caricaCopertura(companyId), caricaChiusure(companyId)]);
      setCopertura(c); setChiusure(ch); setErroreCopertura(null);
    }
    catch (e) { setErroreCopertura(e instanceof Error ? e.message : 'errore'); }
  }, [companyId]);
  useEffect(() => { void ricaricaCopertura(); }, [ricaricaCopertura]);

  const aggiorna = (id: number, p: Partial<Voce>) => setVoci((vs) => vs.map((v) => (v.id === id ? { ...v, ...p } : v)));

  /** I giorni appena salvati entrano nella tabella senza rileggere tutto il database. */
  const segnaCopertura = (esiti: EsitoGiorno[]) => setCopertura((c) => {
    const out = new Map([...(c ?? new Map<string, Set<string>>())].map(([k, v]) => [k, new Set(v)]));
    for (const e of esiti) {
      if (!out.has(e.outletId)) out.set(e.outletId, new Set());
      out.get(e.outletId)!.add(e.data);
    }
    return out;
  });

  /**
   * Scrive i giorni (inserisce o sostituisce le ore del report), a blocchi di
   * giorni interi: se un blocco fallisce, i giorni prima sono salvati per
   * intero e l'errore dice quanti.
   */
  const salvaGiorni = async (esiti: EsitoGiorno[], nomeFile: string) => {
    const adesso = new Date().toISOString();
    let fatti = 0;
    // Le ore del database che il file non ha si tolgono prima, cosi' il giorno
    // salvato e' esattamente quello del file e niente si somma. Succede solo nei
    // giorni «diversi», dopo la conferma di chi carica.
    for (const e of esiti) {
      if (!e.oreDaTogliere.length) continue;
      const { error } = await supabase.from('outlet_traffic_hourly').delete()
        .eq('company_id', companyId).eq('outlet_id', e.outletId).eq('data', e.data).in('ora', e.oreDaTogliere);
      if (error) throw new Error(`Salvataggio interrotto: ${error.message}. Nessun giorno salvato.`);
    }
    for (let i = 0; i < esiti.length;) {
      const blocco: EsitoGiorno[] = [];
      let righe = 0;
      while (i < esiti.length && (blocco.length === 0 || righe + esiti[i].righe.length <= 500)) { righe += esiti[i].righe.length; blocco.push(esiti[i++]); }
      const { error } = await supabase.from('outlet_traffic_hourly').upsert(
        blocco.flatMap((e) => e.righe).map(({ vendite, ...r }) => ({ ...r, ...(vendite != null ? { vendite } : {}), company_id: companyId, fonte: 'moda', file_name: nomeFile.slice(0, 200), updated_at: adesso })),
        { onConflict: 'outlet_id,data,ora' },
      );
      if (error) {
        segnaCopertura(esiti.slice(0, fatti));
        throw new Error(`Salvataggio interrotto: ${error.message}. ${fatti ? `${giorni(fatti)} erano già salvati per intero; ricarica lo stesso file per completare.` : 'Nessun giorno salvato.'}`);
      }
      fatti += blocco.length;
    }
    segnaCopertura(esiti);
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
    // Nuovi e «completa» (stessi ingressi e scontrini, il file aggiunge gli importi) si salvano da soli.
    const salvati = esiti.filter((e) => (e.stato === 'nuovo' || e.stato === 'completa') && !nonTornano.has(chiave(e)));
    const diversi = esiti
      .filter((e) => e.stato === 'diverso' || ((e.stato === 'nuovo' || e.stato === 'completa') && nonTornano.has(chiave(e))))
      .map((e) => ({ ...e, totaleNonTorna: nonTornano.has(chiave(e)) }));
    await salvaGiorni(salvati, nomeFile);
    return { salvati, uguali: esiti.filter((e) => e.stato === 'uguale').length, diversi };
  };

  const frase = (salvati: EsitoGiorno[], uguali: number) => {
    const parti: string[] = [];
    const nuovi = salvati.filter((e) => e.stato !== 'completa');
    const completati = salvati.filter((e) => e.stato === 'completa');
    if (nuovi.length) {
      const neg = new Set(nuovi.map((e) => e.outletId)).size;
      const ore = nuovi.reduce((a, e) => a + e.righe.length, 0);
      const mesi = [...new Set(nuovi.map((e) => e.data.slice(0, 7)))].sort();
      parti.push(`${nuovi.length === 1 ? 'salvato' : 'salvati'} ${giorni(nuovi.length)} (${fmt(ore)} ore) di ${neg === 1 ? '1 negozio' : `${neg} negozi`}, ${mesi.map(meseLeggibile).join(', ')}`);
    }
    if (completati.length) {
      const mesi = [...new Set(completati.map((e) => e.data.slice(0, 7)))].sort();
      parti.push(`${completati.length === 1 ? 'a 1 giorno già caricato' : `a ${giorni(completati.length)} già caricati`} si sono aggiunti pezzi, valori e costi (${mesi.map(meseLeggibile).join(', ')}); ingressi e scontrini erano uguali`);
    }
    if (uguali) parti.push(uguali === 1 ? "1 giorno c'era già, uguale" : `${giorni(uguali)} c'erano già, uguali`);
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
      // Il 29/10/2026 un report con impostazioni diverse ha dovuto essere rifatto:
      // non si salva niente finche' non e' quello di sempre.
      if (!r.impostazioniStandard) {
        throw new Error('Il report non è stampato con le impostazioni di sempre: deve dire «Importi Vendite SENZA Iva» e «sono ESCLUSE Vendite libere, Buoni e Acconti». Non è stato salvato niente: va ristampato da MODA con quelle impostazioni.');
      }
      aggiorna(v.id, { stato: 'salvataggio' });
      const codiciModa = await caricaCodiciModa(companyId);
      const incompleto = giornoIncompleto(r);
      const nonTornano = new Set<string>();
      const coppie: { outletId: string; giorno: GiornoModa }[] = [];
      const nonAbbinati: NonAbbinato[] = [];
      const abbinati = new Map<string, string>();
      const sbagliati = totaliCheNonTornano(r);
      for (const n of r.negozi) {
        const ricordato = codiciModa.get(n.codice.toUpperCase());
        const o = (ricordato && negozi.some((x) => x.id === ricordato) ? { id: ricordato } : null)
          ?? abbinaNegozio(n.codice, n.descrizione, negozi.map((x) => ({ id: x.id, name: x.name ?? '', code: x.code ?? null })));
        const gg = n.giorni.filter((g) => g.ore.length && g.data !== incompleto);
        if (!o) {
          if (gg.length) nonAbbinati.push({ codice: n.codice, descrizione: n.descrizione, giorni: gg, nonTornano: sbagliati.filter((t) => t.codice === n.codice).map((t) => t.data) });
          continue;
        }
        abbinati.set(n.codice, o.id);
        for (const g of gg) coppie.push({ outletId: o.id, giorno: g });
      }
      for (const t of sbagliati) {
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
      if (!r.importi) note.push('il report non ha le colonne di pezzi, valori e costi: si sono salvati solo ingressi e scontrini');
      if (v.daZip) note.push(`dallo zip «${v.daZip}»`);
      const resta: string[] = [];
      if (incompleto) resta.push(`manca il ${dataIt(incompleto)} (giorno di stampa del report): arriverà con il report successivo`);
      if (diversi.length || nonAbbinati.length) {
        aggiorna(v.id, { stato: 'da_confermare', nota: note.join('. ') + '.', attesa: { diversi, nonAbbinati, scelte: {} }, resta, giorniSalvati: salvati.length });
      } else {
        aggiorna(v.id, { stato: 'salvato', nota: note.join('. ') + '.', resta, giorniSalvati: salvati.length });
      }
    } catch (e) {
      aggiorna(v.id, { stato: 'errore', nota: e instanceof Error ? e.message : 'Lettura non riuscita.' });
    }
  };

  const leggi = async (lista: FileList | File[]) => {
    const tutti = [...lista];
    // Gli zip si aprono nel browser: dentro si tengono i PDF.
    const { files, problemi } = tutti.some(isZip) ? await espandiZip(tutti, { estensioni: ['pdf'] }) : { files: tutti.map((file) => ({ file, daZip: null })), problemi: [] };
    const nuove: Voce[] = files.map(({ file, daZip }) => ({ id: prossimo.current++, file, daZip, stato: 'in_coda' as const }));
    const rotti: Voce[] = problemi.map((p) => ({ id: prossimo.current++, file: new File([], p.zip), stato: 'errore' as const, nota: `Zip non aperto: ${p.testo}.` }));
    setVoci((vs) => [...vs, ...nuove, ...rotti]);
    for (const v of nuove) {
      if (!/\.pdf$/i.test(v.file.name)) {
        aggiorna(v.id, { stato: 'errore', nota: 'Serve il PDF del report MODA «Conversion Rate» (anche dentro uno zip).' });
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
      await salvaGiorni(diversi, v.file.name);
      segnaMesi(diversi);
      const scelti = nonAbbinati.filter((n) => scelte[n.codice]);
      // La scelta si ricorda: dal prossimo file questo codice MODA si riconosce da solo.
      if (scelti.length) {
        const { error } = await supabase.from('outlet_moda_codici').upsert(
          scelti.map((n) => ({ company_id: companyId, codice: n.codice.toUpperCase(), descrizione: n.descrizione.slice(0, 200), outlet_id: scelte[n.codice] })),
          { onConflict: 'company_id,codice' },
        );
        if (error) console.warn('[TrafficoModa] codice MODA non ricordato:', error.message);
      }
      const altri = await elabora(
        scelti.flatMap((n) => n.giorni.map((g) => ({ outletId: scelte[n.codice], giorno: g }))),
        v.file.name,
        new Set(scelti.flatMap((n) => n.nonTornano.map((d) => `${scelte[n.codice]}|${d}`))),
      );
      segnaMesi(altri.salvati);
      const saltati = nonAbbinati.filter((n) => !scelte[n.codice]);
      const giorniSalvati = (v.giorniSalvati ?? 0) + diversi.length + altri.salvati.length;
      const resta = [...(v.resta ?? []), ...(saltati.length ? [`${saltati.map((n) => `${n.codice} «${n.descrizione}»`).join(', ')} non ${saltati.length === 1 ? 'è stato caricato' : 'sono stati caricati'}: nessun negozio scelto`] : [])];
      const parti = [
        diversi.length ? `sostituiti ${giorni(diversi.length)}` : '',
        frase(altri.salvati, altri.uguali),
        saltati.length ? `non caricati, senza negozio: ${saltati.map((n) => `${n.codice} «${n.descrizione}»`).join(', ')}` : '',
      ].filter(Boolean);
      if (altri.diversi.length) {
        aggiorna(v.id, { stato: 'da_confermare', nota: `${v.nota ?? ''} Poi: ${parti.join('; ')}.`, attesa: { diversi: altri.diversi, nonAbbinati: [], scelte: {} }, resta, giorniSalvati });
      } else {
        aggiorna(v.id, { stato: 'salvato', nota: `${v.nota ?? ''} Poi: ${parti.join('; ') || 'niente da cambiare'}.`, attesa: undefined, resta, giorniSalvati });
      }
    } catch (e) {
      aggiorna(v.id, { stato: 'errore', nota: e instanceof Error ? e.message : 'Salvataggio non riuscito.' });
    }
  };

  /** «Lascia com'è»: niente si cambia, ma il riquadro finale lo ricorda. */
  const lasciaCosi = (v: Voce) => {
    const a = v.attesa;
    const resta = [...(v.resta ?? [])];
    if (a?.diversi.length) resta.push(a.diversi.length === 1 ? '1 giorno già caricato è rimasto come prima, diverso dal report' : `${a.diversi.length} giorni già caricati sono rimasti come prima, diversi dal report`);
    if (a?.nonAbbinati.length) resta.push(`${a.nonAbbinati.map((n) => `${n.codice} «${n.descrizione}»`).join(', ')} non ${a.nonAbbinati.length === 1 ? 'è stato caricato' : 'sono stati caricati'}: nessun negozio scelto`);
    aggiorna(v.id, { stato: 'salvato', attesa: undefined, resta, nota: `${v.nota ?? ''} Hai scelto di lasciare com'era.` });
  };

  // ── Chiusura del caricamento ─────────────────────────────────────────────
  const inCorso = voci.some((v) => v.stato === 'in_coda' || v.stato === 'lettura' || v.stato === 'salvataggio');
  const daConfermare = voci.filter((v) => v.stato === 'da_confermare').length;
  const errori = voci.filter((v) => v.stato === 'errore').length;
  const salvati = voci.filter((v) => v.stato === 'salvato').length;
  const resta = [...new Set(voci.filter((v) => v.stato === 'salvato').flatMap((v) => v.resta ?? []))];
  const caricati = `${salvati === 1 ? '1 report lavorato' : `${salvati} report lavorati`}. Il report del mese e i piani dei turni usano già i dati nuovi; i mesi arrivati sono evidenziati nella tabella qui sotto.`;
  const maiuscola = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const chiusura = voci.length === 0 || inCorso ? null
    : daConfermare === 0 && errori === 0
      ? resta.length === 0
        ? { ok: true, titolo: 'Finito, tutti i dati sono aggiornati', testo: caricati }
        : { ok: false, titolo: 'Finito, con qualcosa rimasto fuori', testo: `${caricati} ${resta.map(maiuscola).join('. ')}.` }
      : {
        ok: false,
        titolo: voci.some((v) => (v.giorniSalvati ?? 0) > 0) ? 'Quasi finito' : 'Niente di salvato ancora',
        testo: [
          daConfermare ? `${daConfermare === 1 ? '1 report aspetta' : `${daConfermare} report aspettano`} la tua conferma: cambierebbe giorni già caricati, o c'è un negozio da scegliere (il dettaglio è accanto al file)` : '',
          errori ? `${errori === 1 ? '1 file non è riuscito' : `${errori} file non sono riusciti`}: il motivo è scritto accanto` : '',
          ...resta,
        ].filter(Boolean).map(maiuscola).join('. ') + '.',
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
    const chiuso = (d: string) => !!chiusure.settimana.get(n.id)?.has(giornoIso(d)) || !!chiusure.date.get(n.id)?.has(d);
    let attesi = 0; let caricati = 0;
    const nonDovuti = new Set<string>();
    for (let d = `${mese}-01`; d <= fine; d = aggiungiGiorni(d, 1)) {
      if (d < inizio || (chiuso(d) && !presenti.has(d))) { nonDovuti.add(d); continue; }
      attesi++; if (presenti.has(d)) caricati++;
    }
    const mancano = giorniMancanti(mese, new Set([...presenti, ...nonDovuti]), fine);
    return {
      testo: caricati ? `${caricati}/${attesi}` : '–',
      titolo: caricati >= attesi ? `${meseLeggibile(mese)}: tutti i giorni${nonDovuti.size && inizio === `${mese}-01` ? ' (esclusi quelli di chiusura)' : ''}` : `${meseLeggibile(mese)}: ${caricati} giorni su ${attesi}${mancano ? `; mancano ${mancano}` : ''}`,
      tono: caricati === 0 ? 'vuoto' as const : caricati >= attesi ? 'pieno' as const : 'parziale' as const,
    };
  };

  const trascina = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: (e: DragEvent) => { e.preventDefault(); setDrag(false); if (puoScrivere && e.dataTransfer.files?.length) void leggi(e.dataTransfer.files); },
  };

  return (
    <div className="space-y-4">
      {soloTabella && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <FileUp size={18} className="text-blue-600" />
              <h3 className="font-bold text-slate-800">I report MODA si caricano in «Vendite e ingressi»</h3>
            </div>
            <p className="text-xs text-slate-500">
              Lì si trascina ogni mese il report per giorno e ora: i turni leggono gli stessi dati, e qui sotto vedi quali giorni sono arrivati.
            </p>
          </div>
          <Link to="/vendite-ingressi?tab=carica" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium px-4 min-h-[44px] hover:bg-blue-700">
            Vai a Vendite e ingressi <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {puoScrivere && !soloTabella && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-1">
            <FileUp size={18} className="text-blue-600" />
            <h3 className="font-bold text-slate-800">Carica i report MODA</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Trascina qui il PDF «Statistica Situazione Vendite con Conversion Rate» per giorno e ora: quello con tutti i negozi
            oppure uno per negozio, anche più file insieme o uno zip. Il gestionale salva tutto da solo: ingressi, scontrini,
            pezzi, valori e costi (importi senza IVA). Se ricarichi un file già caricato non si somma niente: i giorni uguali
            restano come sono. Ti chiede di confermare solo se un giorno era già caricato con numeri diversi, se i totali del
            report non tornano o se un negozio non si riconosce. Quando ha finito te lo dice qui sotto.
          </p>
          <div
            {...trascina}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center text-sm transition-colors ${drag ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 text-slate-500'}`}
          >
            Trascina i PDF o lo zip, oppure <span className="text-blue-600 font-medium">sceglili dal computer</span>
            <input ref={inputRef} type="file" multiple accept=".pdf,.zip,application/pdf,application/zip" className="hidden" aria-label="Report MODA in PDF o zip"
              onChange={(e) => { if (e.target.files?.length) void leggi(e.target.files); e.target.value = ''; }} />
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
                                {[
                                  e.totaleNonTorna ? `nel report la somma delle ore (${fmt(e.ingressiFile)} ingressi) non torna con il totale del giorno` : '',
                                  e.stato === 'nuovo' ? 'giorno non ancora caricato'
                                    : e.ingressiDb === e.ingressiFile ? `ingressi uguali (${fmt(e.ingressiFile)}), cambiano scontrini o ore`
                                      : `${fmt(e.ingressiDb)} ingressi già caricati, ${fmt(e.ingressiFile)} nel report`,
                                ].filter(Boolean).join('; ')}
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
              <li><strong>Il report</strong>: in MODA «Statistica Situazione Vendite con Conversion Rate», raggruppato per Negozio, Giorno e Ora (tutti i negozi) oppure per Giorno e Ora (un negozio), senza IVA, escluse vendite libere, buoni e acconti, stampato in PDF. Qualunque periodo, anche nove mesi insieme. Il report per giorno (Negozio, Mese, Giorno) non ha le ore e non si carica.</li>
              <li><strong>Cosa si salva</strong>: per ogni negozio, giorno e ora le persone entrate (colonna N.P.), gli scontrini, i pezzi, il valore teorico e reale e il costo d'acquisto. Tutti gli importi sono imponibili. Sconto, prezzo medio, ricarichi e resa si calcolano nel report.</li>
              <li><strong>Ricaricare</strong>: non si somma mai niente. Un giorno uguale resta com'è; un giorno che aveva solo ingressi e scontrini riceve pezzi e importi da solo; un giorno con numeri diversi si sostituisce per intero, dopo la tua conferma.</li>
              <li><strong>Controlli</strong>: la somma delle ore deve tornare con il totale del giorno stampato nel report. Il giorno in cui il report è stato stampato non si carica, perché a negozio aperto non è finito. Un report con impostazioni diverse (per esempio con l'IVA) si rifiuta.</li>
              <li><strong>Negozi</strong>: si riconoscono dal codice MODA (BARB, FIR2...). Se un codice è nuovo lo scegli una volta e il gestionale lo ricorda.</li>
              <li><strong>Dopo</strong>: il report del mese di «Vendite e ingressi» e i piani dei turni usano subito i dati nuovi.</li>
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
