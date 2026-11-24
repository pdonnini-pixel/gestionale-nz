// «Vendite e ingressi» (Patrizio, 24/11/2026). Ogni mese Sabrina (New Zago) e
// Veronica (Zago) trascinano qui il report MODA «Statistica Situazione Vendite
// con Conversion Rate» per giorno e ora; la pagina mostra il report del mese:
// persone entrate, conversione, scontrini, pezzi, sconto, vendite e resa, il
// confronto con il mese prima e con l'anno prima, il calendario, le ore e la
// quadratura con le chiusure di cassa. Importi tutti imponibili (senza IVA).
//
// Chi vede cosa: super_advisor, ceo, cfo, coo, contabile tutti i negozi; la
// responsabile tutto, ma solo dei suoi negozi (lo decide la funzione
// vendite_ingressi_report, migration 464). Caricano solo i profili che tengono
// l'organico (puoTenereOrganico): i turni leggono gli stessi dati.
//
// Calcoli: src/lib/venditeIngressi.ts. Lettura del PDF: src/lib/trafficoModa.ts.
// Caricamento: src/components/TrafficoModa.tsx.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, FileUp, AlertTriangle, Loader2, Info } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import TrafficoModa from '../components/TrafficoModa';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useCompany } from '../hooks/useCompany';
import { puoTenereOrganico, type NegozioRif } from '../lib/organicoDati';
import { meseLeggibile } from '../lib/trafficoModa';
import {
  leggiReportVI, somma, derivate, scomponi, scartoCassa, mesePrima, meseAnnoPrima, ultimoGiorno, giorniDel,
  mappaOre, oreAperte, variazione, SOGLIA_CASSA, type ReportVI, type Misure, type Derivate,
} from '../lib/venditeIngressi';

type Tab = 'report' | 'carica';

const it0 = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 0 });
const it1 = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const it2 = (v: number) => v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (v: number | null) => (v == null ? '—' : `${it0(v)} €`);
const eur2 = (v: number | null) => (v == null ? '—' : `${it2(v)} €`);
const pct = (v: number | null, dec = 2) => (v == null ? '—' : `${dec === 1 ? it1(v) : it2(v)}%`);
const num2 = (v: number | null) => (v == null ? '—' : it2(v));
const meseCorrente = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }).slice(0, 7);
const GIORNI_SETT = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const INIZIALI = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

/** Sfondo di una cella di mappa: dal chiaro al blu pieno. */
const cellaCalda = (t: number) => {
  const a = Math.max(0, Math.min(1, t));
  return { backgroundColor: `rgba(37, 99, 235, ${(0.06 + a * 0.84).toFixed(3)})`, color: a > 0.5 ? '#fff' : '#0f172a' };
};

function Sezione({ titolo, comeSiLegge, children, azioni }: { titolo: string; comeSiLegge: string; children: ReactNode; azioni?: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
        <h2 className="font-bold text-slate-800">{titolo}</h2>
        {azioni}
      </div>
      <p className="text-xs text-slate-500 mb-3 max-w-3xl">{comeSiLegge}</p>
      {children}
    </section>
  );
}

function Scelta<T extends string>({ valore, opzioni, onChange, etichetta }: { valore: T; opzioni: [T, string][]; onChange: (v: T) => void; etichetta: string }) {
  return (
    <div role="group" aria-label={etichetta} className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
      {opzioni.map(([k, t]) => (
        <button key={k} type="button" aria-pressed={valore === k} onClick={() => onChange(k)}
          className={`px-3 min-h-[36px] ${valore === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

function Delta({ v, inverso = false, punti = false }: { v: number | null; inverso?: boolean; punti?: boolean }) {
  if (v == null) return <span className="text-slate-400">—</span>;
  const buono = inverso ? v < 0 : v > 0;
  const colore = Math.abs(v) < 0.05 ? 'text-slate-500' : buono ? 'text-emerald-700' : 'text-red-600';
  return <span className={colore}>{v > 0 ? '+' : ''}{it1(v)}{punti ? ' punti' : '%'}</span>;
}

export default function VenditeIngressi() {
  const { profile } = useAuth();
  const { company } = useCompany();
  const companyId = company?.id ?? null;
  const puoCaricare = puoTenereOrganico(profile?.role);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'carica' && puoCaricare ? 'carica' : 'report';
  const meseUrl = /^\d{4}-\d{2}$/.test(params.get('mese') ?? '') ? params.get('mese')! : null;
  const negozioUrl = params.get('negozio') ?? 'tutti';

  const [report, setReport] = useState<ReportVI | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const [versione, setVersione] = useState(0);
  const [negoziCarica, setNegoziCarica] = useState<NegozioRif[]>([]);
  const [metricaCal, setMetricaCal] = useState<'ingressi' | 'conversione' | 'vendite'>('ingressi');
  const [metricaOre, setMetricaOre] = useState<'ingressi' | 'conversione'>('ingressi');
  const [confronto, setConfronto] = useState<'anno' | 'mese'>('anno');

  const imposta = (p: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [k, v] of Object.entries(p)) { if (v == null) n.delete(k); else n.set(k, v); }
    setParams(n, { replace: true });
  };

  // Il report del mese. Senza mese scelto si apre sull'ultimo mese con dati.
  useEffect(() => {
    if (!companyId || tab !== 'report') return;
    let vivo = true;
    setCaricamento(true);
    (async () => {
      const chiedi = async (mese: string) => {
        const { data, error } = await supabase.rpc('vendite_ingressi_report', { p_mese: `${mese}-01` });
        if (error) throw error;
        return leggiReportVI(data);
      };
      let r = await chiedi(meseUrl ?? meseCorrente());
      if (!meseUrl && !r.giorni.some((g) => g.data.startsWith(r.mese)) && r.mesi.length) r = await chiedi(r.mesi[0]);
      if (vivo) { setReport(r); setErrore(null); }
    })().catch((e: unknown) => {
      if (!vivo) return;
      const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Report non caricato.';
      const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
      // Dove la migration 464 non c'e' la funzione manca: si dice in chiaro.
      setErrore(code === 'PGRST202' || /Could not find the function/i.test(msg) ? 'questa sezione non è ancora attiva su questo gestionale.' : msg);
    })
      .finally(() => { if (vivo) setCaricamento(false); });
    return () => { vivo = false; };
  }, [companyId, tab, meseUrl, versione]);

  // I negozi per il caricamento (solo chi carica legge outlets).
  useEffect(() => {
    if (!companyId || !puoCaricare) return;
    void supabase.from('outlets').select('id, code, name, is_active, opening_date').eq('company_id', companyId).order('name')
      .then(({ data }) => setNegoziCarica((data as NegozioRif[] | null) ?? []));
  }, [companyId, puoCaricare]);

  const mese = report?.mese ?? meseUrl ?? meseCorrente();
  const scelti = useMemo(() => {
    if (!report) return undefined;
    return negozioUrl !== 'tutti' && report.negozi.some((x) => x.id === negozioUrl) ? new Set([negozioUrl]) : undefined;
  }, [report, negozioUrl]);

  const calcoli = useMemo(() => {
    if (!report) return null;
    const fine = ultimoGiorno(report.giorni, mese);
    const ora = giorniDel(report.giorni, mese, 31, scelti);
    // I confronti usano gli stessi giorni del mese (fino all'ultimo caricato) e i negozi presenti nel mese.
    const presenti = new Set(ora.map((g) => g.outletId));
    const prima = giorniDel(report.giorni, mesePrima(mese), fine, presenti);
    const anno = giorniDel(report.giorni, meseAnnoPrima(mese), fine, presenti);
    const mOra = somma(ora); const mPrima = somma(prima); const mAnno = somma(anno);
    return { fine, ora, presenti, mOra, mPrima, mAnno, dOra: derivate(mOra), dPrima: derivate(mPrima), dAnno: derivate(mAnno) };
  }, [report, mese, scelti]);

  const nomeNeg = (id: string) => report?.negozi.find((x) => x.id === id)?.nome ?? '—';

  // ── Viste ─────────────────────────────────────────────────────────────────
  const intestazione = (
    <PageHeader
      title="Vendite e ingressi"
      subtitle={report?.soloSuoi ? 'I numeri del tuo negozio dal report MODA, mese per mese. Importi senza IVA.' : 'Il report MODA di ogni negozio, mese per mese: chi entra, chi compra, quanto e a che margine. Importi senza IVA.'}
      actions={puoCaricare ? (
        <Scelta etichetta="Sezione" valore={tab} onChange={(t) => imposta({ tab: t === 'report' ? null : t })}
          opzioni={[['report', 'Report del mese'], ['carica', 'Carica i file']]} />
      ) : undefined}
    />
  );

  if (tab === 'carica') {
    return (
      <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-4">
        {intestazione}
        {companyId && (
          <TrafficoModa companyId={companyId} negozi={negoziCarica} puoScrivere={puoCaricare} />
        )}
        <button type="button" onClick={() => { setVersione((v) => v + 1); imposta({ tab: null, mese: null }); }}
          className="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:underline min-h-[44px]">
          <BarChart3 size={16} /> Torna al report del mese
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-4 pb-8">
      {intestazione}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="vi-mese">Mese</label>
        <select id="vi-mese" value={mese} onChange={(e) => imposta({ mese: e.target.value })}
          className="rounded-lg border border-slate-300 bg-white px-3 min-h-[40px] text-base sm:text-sm">
          {[...new Set([mese, ...(report?.mesi ?? [])])].sort().reverse().map((m) => <option key={m} value={m}>{meseLeggibile(m)}</option>)}
        </select>
        {report && report.negozi.length > 1 && (
          <>
            <label className="text-sm text-slate-600 ml-2" htmlFor="vi-negozio">Negozio</label>
            <select id="vi-negozio" value={scelti ? negozioUrl : 'tutti'} onChange={(e) => imposta({ negozio: e.target.value === 'tutti' ? null : e.target.value })}
              className="rounded-lg border border-slate-300 bg-white px-3 min-h-[40px] text-base sm:text-sm">
              <option value="tutti">Tutti i negozi</option>
              {report.negozi.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </>
        )}
        {caricamento && <Loader2 size={18} className="animate-spin text-slate-400" aria-label="Caricamento" />}
      </div>

      {errore && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">Report non caricato: {errore}</div>}

      {report && report.negozi.length === 0 && !caricamento && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          {report.soloSuoi
            ? 'Non ci sono ancora dati per il tuo negozio, oppure il negozio non ti è stato assegnato: chiedi all’amministrazione.'
            : <>Non ci sono ancora report MODA caricati. {puoCaricare && <button type="button" className="text-blue-700 underline" onClick={() => imposta({ tab: 'carica' })}>Carica il primo file</button>}</>}
        </div>
      )}

      {report && calcoli && calcoli.ora.length === 0 && report.negozi.length > 0 && !caricamento && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Per {meseLeggibile(mese)} non c’è ancora il report MODA.{puoCaricare && <> <button type="button" className="underline" onClick={() => imposta({ tab: 'carica' })}>Caricalo qui</button>.</>}
        </div>
      )}

      {report && calcoli && calcoli.ora.length > 0 && (
        <Report report={report} mese={mese} calcoli={calcoli} scelti={scelti} nomeNeg={nomeNeg} puoCaricare={puoCaricare}
          vaiACarica={() => imposta({ tab: 'carica' })}
          metricaCal={metricaCal} setMetricaCal={setMetricaCal} metricaOre={metricaOre} setMetricaOre={setMetricaOre}
          confronto={confronto} setConfronto={setConfronto} />
      )}
    </div>
  );
}

type Calcoli = {
  fine: number; ora: ReportVI['giorni']; presenti: Set<string>;
  mOra: Misure; mPrima: Misure; mAnno: Misure; dOra: Derivate; dPrima: Derivate; dAnno: Derivate;
};

function Report(props: {
  report: ReportVI; mese: string; calcoli: Calcoli; scelti: Set<string> | undefined; nomeNeg: (id: string) => string;
  puoCaricare: boolean; vaiACarica: () => void;
  metricaCal: 'ingressi' | 'conversione' | 'vendite'; setMetricaCal: (m: 'ingressi' | 'conversione' | 'vendite') => void;
  metricaOre: 'ingressi' | 'conversione'; setMetricaOre: (m: 'ingressi' | 'conversione') => void;
  confronto: 'anno' | 'mese'; setConfronto: (c: 'anno' | 'mese') => void;
}) {
  const { report, mese, calcoli, scelti, nomeNeg } = props;
  const { mOra, mPrima, mAnno, dOra, dPrima, dAnno, ora, fine } = calcoli;
  const senzaImporti = mOra.giorni - mOra.giorniConImporti;

  // Riquadri: valore del mese, differenza con il mese prima e con lo stesso mese dell'anno prima.
  const kpi: { t: string; v: string; mp: number | null; ap: number | null; punti?: boolean; inverso?: boolean; nota?: string }[] = [
    { t: 'Persone entrate', v: it0(mOra.ingressi), mp: variazione(mOra.ingressi, mPrima.ingressi || null), ap: variazione(mOra.ingressi, mAnno.ingressi || null) },
    { t: 'Conversione', v: pct(dOra.conversione), punti: true,
      mp: dOra.conversione != null && dPrima.conversione != null ? dOra.conversione - dPrima.conversione : null,
      ap: dOra.conversione != null && dAnno.conversione != null ? dOra.conversione - dAnno.conversione : null },
    { t: 'Scontrini', v: it0(mOra.scontrini), mp: variazione(mOra.scontrini, mPrima.scontrini || null), ap: variazione(mOra.scontrini, mAnno.scontrini || null) },
    { t: 'Scontrino medio', v: eur2(dOra.scontrinoMedio), mp: variazione(dOra.scontrinoMedio, dPrima.scontrinoMedio), ap: variazione(dOra.scontrinoMedio, dAnno.scontrinoMedio) },
    { t: 'Pezzi per scontrino', v: num2(dOra.pezziPerScontrino), mp: variazione(dOra.pezziPerScontrino, dPrima.pezziPerScontrino), ap: variazione(dOra.pezziPerScontrino, dAnno.pezziPerScontrino) },
    { t: 'Sconto medio sul listino', v: pct(dOra.sconto, 1), punti: true, inverso: true,
      mp: dOra.sconto != null && dPrima.sconto != null ? dOra.sconto - dPrima.sconto : null,
      ap: dOra.sconto != null && dAnno.sconto != null ? dOra.sconto - dAnno.sconto : null },
    { t: 'Vendite (imponibile)', v: eur0(mOra.giorniConImporti ? mOra.reale : null),
      mp: mPrima.importiCompleti && mOra.importiCompleti ? variazione(mOra.reale, mPrima.reale) : null,
      ap: mAnno.importiCompleti && mOra.importiCompleti ? variazione(mOra.reale, mAnno.reale) : null },
    { t: 'Resa (imponibile)', v: eur0(dOra.resa), nota: dOra.resaPct == null ? undefined : `${it1(dOra.resaPct)}% delle vendite`,
      mp: mPrima.importiCompleti && mOra.importiCompleti ? variazione(dOra.resa, dPrima.resa) : null,
      ap: mAnno.importiCompleti && mOra.importiCompleti ? variazione(dOra.resa, dAnno.resa) : null },
  ];

  // Tabella dei negozi.
  const righe = [...calcoli.presenti].map((id) => {
    const m = somma(ora.filter((g) => g.outletId === id));
    const d = derivate(m);
    return { id, nome: nomeNeg(id), m, d, cassa: scartoCassa(report.cassa.get(id), m.reale, m.importiCompleti) };
  }).sort((a, b) => (b.m.reale - a.m.reale) || (b.m.ingressi - a.m.ingressi));

  // Perche' sono cambiate le vendite, negozio per negozio.
  const meseConfronto = props.confronto === 'anno' ? meseAnnoPrima(mese) : mesePrima(mese);
  const scomp = righe.map((r) => {
    const base = somma(giorniDel(report.giorni, meseConfronto, fine, new Set([r.id])));
    return { nome: r.nome, s: scomponi(base, r.m) };
  }).filter((x): x is { nome: string; s: NonNullable<ReturnType<typeof scomponi>> } => x.s != null);
  const tutteVendite = scomp.length > 0 && scomp.every((x) => x.s.base === 'vendite');
  const scompMax = Math.max(1, ...scomp.flatMap((x) => [Math.abs(x.s.traffico), Math.abs(x.s.conversione), Math.abs(x.s.scontrino)]));

  // Calendario.
  const giorniMese = Number(new Date(Date.UTC(Number(mese.slice(0, 4)), Number(mese.slice(5, 7)), 0)).getUTCDate());
  const valCal = (g: (typeof ora)[number] | undefined) => !g ? null
    : props.metricaCal === 'ingressi' ? g.ingressi
      : props.metricaCal === 'vendite' ? (g.importi ? g.reale : null)
        : g.ingressi ? (g.scontrini / g.ingressi) * 100 : null;
  const maxCal = Math.max(1, ...ora.map((g) => valCal(g) ?? 0));
  const perGiorno = new Map(ora.map((g) => [`${g.outletId}|${Number(g.data.slice(8, 10))}`, g]));

  // Ore per giorno della settimana.
  const ore = report.ore.filter((o) => calcoli.presenti.has(o.outletId));
  const mappa = mappaOre(ore, scelti);
  const fasce = oreAperte(ore);
  const valOra = (d: number, h: number) => {
    const x = mappa.get(`${d}|${h}`);
    if (!x) return null;
    return props.metricaOre === 'ingressi' ? x.ingressi : x.ingressi ? (x.scontrini / x.ingressi) * 100 : null;
  };
  const tuttiOre = fasce.flatMap((h) => [1, 2, 3, 4, 5, 6, 7].map((d) => valOra(d, h) ?? 0));
  const maxOre = props.metricaOre === 'ingressi' ? Math.max(1, ...tuttiOre) : 20;

  return (
    <>
      {senzaImporti > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            {senzaImporti === mOra.giorni
              ? `I giorni di ${meseLeggibile(mese)} hanno solo persone entrate e scontrini: pezzi, vendite e costi non sono ancora caricati.`
              : `${senzaImporti} giorni su ${mOra.giorni} hanno solo persone entrate e scontrini: gli importi qui sotto valgono per gli altri.`}
            {' '}Ricaricando lo stesso PDF MODA si aggiungono da soli, senza toccare il resto.
            {props.puoCaricare && <> <button type="button" className="underline" onClick={props.vaiACarica}>Carica i file</button>.</>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border border-slate-200 rounded-2xl overflow-hidden">
        {kpi.map((k) => (
          <div key={k.t} className="bg-white p-3 sm:p-4">
            <div className="text-xs text-slate-500">{k.t}</div>
            <div className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums whitespace-nowrap">{k.v}</div>
            {k.nota && <div className="text-xs text-slate-500">{k.nota}</div>}
            <div className="mt-1 text-xs flex flex-wrap gap-x-3 tabular-nums">
              <span>mese prima <Delta v={k.mp} punti={k.punti} inverso={k.inverso} /></span>
              <span>anno prima <Delta v={k.ap} punti={k.punti} inverso={k.inverso} /></span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 -mt-2">
        I confronti usano gli stessi giorni ({fine < giorniMese ? `dal 1 al ${fine}` : 'mese intero'}) e gli stessi negozi. Dove manca il mese di confronto, o i suoi importi, compare «—».
      </p>

      <Sezione titolo="L’albero delle vendite" comeSiLegge="Le vendite sono persone entrate × conversione × scontrino medio. Quando cambiano, uno di questi tre numeri è cambiato: il confronto qui sotto dice quale.">
        <div className="grid grid-cols-2 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1.2fr] gap-2 items-stretch">
          {[
            { v: it0(mOra.ingressi), t: 'persone entrate', s: 'contapersone, colonna N.P.' },
            { op: '×' },
            { v: pct(dOra.conversione), t: 'conversione', s: 'scontrini ÷ persone entrate' },
            { op: '×' },
            { v: eur2(dOra.scontrinoMedio), t: 'scontrino medio', s: dOra.pezziPerScontrino == null ? 'vendite ÷ scontrini' : `${num2(dOra.pezziPerScontrino)} pezzi × ${eur2(dOra.prezzoMedio)}` },
            { op: '=' },
            { v: eur0(mOra.giorniConImporti ? mOra.reale : null), t: 'vendite (imponibile)', s: dOra.resa == null ? 'importi non caricati' : `meno ${eur0(mOra.costo)} di costo merce = ${eur0(dOra.resa)} di resa`, res: true },
          ].map((x, i) => 'op' in x
            ? <div key={i} className="hidden md:grid place-items-center text-2xl font-bold text-slate-400">{x.op}</div>
            : (
              <div key={i} className={`rounded-xl p-3 border ${x.res ? 'bg-slate-900 text-white border-slate-900 col-span-2 md:col-span-1' : 'bg-slate-50 border-slate-200'}`}>
                <div className="text-lg sm:text-xl font-bold tabular-nums whitespace-nowrap">{x.v}</div>
                <div className={`text-sm ${x.res ? 'text-slate-200' : 'text-slate-600'}`}>{x.t}</div>
                <div className={`text-xs mt-1 pt-1 border-t ${x.res ? 'border-slate-600 text-slate-300' : 'border-slate-200 text-slate-500'}`}>{x.s}</div>
              </div>
            ))}
        </div>
      </Sezione>

      <Sezione titolo="I negozi del mese" comeSiLegge={`In verde il migliore della colonna, in rosso il peggiore. «Cassa» confronta le vendite MODA con l’incasso netto delle chiusure di cassa: MODA è di solito un po’ sotto, perché esclude vendite libere, buoni e acconti; oltre il ${SOGLIA_CASSA}% è da guardare.`}>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-slate-500 border-b-2 border-slate-800">
                {['Negozio', 'Persone entrate', 'Conv.', 'Scontrini', 'Scontrino medio', 'Pezzi/ scontr.', 'Sconto', 'Vendite', 'Resa', 'Ricarico reale', 'Cassa'].map((h, i) => (
                  <th key={h} className={`py-2 px-2 font-semibold align-bottom ${i ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {righe.map((r) => {
                const estremi = (vals: (number | null)[], v: number | null, inverso = false) => {
                  const xs = vals.filter((x): x is number => x != null);
                  if (v == null || xs.length < 2) return '';
                  const best = inverso ? Math.min(...xs) : Math.max(...xs); const worst = inverso ? Math.max(...xs) : Math.min(...xs);
                  return v === best ? 'text-emerald-700 font-semibold' : v === worst ? 'text-red-600 font-semibold' : '';
                };
                const col = (f: (x: (typeof righe)[number]) => number | null) => righe.map(f);
                return (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-2 px-2 text-left whitespace-nowrap font-medium text-slate-800">{r.nome}</td>
                    <td className={`py-2 px-2 text-right ${estremi(col((x) => x.m.ingressi), r.m.ingressi)}`}>{it0(r.m.ingressi)}</td>
                    <td className={`py-2 px-2 text-right ${estremi(col((x) => x.d.conversione), r.d.conversione)}`}>{pct(r.d.conversione)}</td>
                    <td className="py-2 px-2 text-right">{it0(r.m.scontrini)}</td>
                    <td className={`py-2 px-2 text-right whitespace-nowrap ${estremi(col((x) => x.d.scontrinoMedio), r.d.scontrinoMedio)}`}>{eur2(r.d.scontrinoMedio)}</td>
                    <td className="py-2 px-2 text-right">{num2(r.d.pezziPerScontrino)}</td>
                    <td className={`py-2 px-2 text-right ${estremi(col((x) => x.d.sconto), r.d.sconto, true)}`}>{pct(r.d.sconto, 1)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{eur0(r.m.giorniConImporti ? r.m.reale : null)}</td>
                    <td className={`py-2 px-2 text-right whitespace-nowrap ${estremi(col((x) => x.d.resaPct), r.d.resaPct)}`}>{r.d.resa == null ? '—' : `${eur0(r.d.resa)} · ${it1(r.d.resaPct ?? 0)}%`}</td>
                    <td className="py-2 px-2 text-right">{num2(r.d.ricaricoReale)}</td>
                    <td className={`py-2 px-2 text-right ${r.cassa != null && Math.abs(r.cassa) > SOGLIA_CASSA ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{r.cassa == null ? '—' : `${r.cassa > 0 ? '−' : '+'}${it1(Math.abs(r.cassa))}%`}</td>
                  </tr>
                );
              })}
            </tbody>
            {righe.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-slate-800 font-semibold">
                  <td className="py-2 px-2">Totale</td>
                  <td className="py-2 px-2 text-right">{it0(mOra.ingressi)}</td>
                  <td className="py-2 px-2 text-right">{pct(dOra.conversione)}</td>
                  <td className="py-2 px-2 text-right">{it0(mOra.scontrini)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{eur2(dOra.scontrinoMedio)}</td>
                  <td className="py-2 px-2 text-right">{num2(dOra.pezziPerScontrino)}</td>
                  <td className="py-2 px-2 text-right">{pct(dOra.sconto, 1)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{eur0(mOra.giorniConImporti ? mOra.reale : null)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{dOra.resa == null ? '—' : `${eur0(dOra.resa)} · ${it1(dOra.resaPct ?? 0)}%`}</td>
                  <td className="py-2 px-2 text-right">{num2(dOra.ricaricoReale)}</td>
                  <td className="py-2 px-2 text-right">—</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Sezione>

      <Sezione
        titolo={props.confronto === 'anno' ? 'Rispetto a un anno fa: più gente o più bravi a vendere?' : 'Rispetto al mese prima: più gente o più bravi a vendere?'}
        comeSiLegge={tutteVendite
          ? 'La differenza di vendite di ogni negozio è divisa in tre: quanto viene dalle persone entrate in più o in meno (grigio), quanto dalla conversione (blu) e quanto dallo scontrino medio (verde). Le tre parti sommate danno la differenza.'
          : 'Dove un mese non ha gli importi, si scompongono gli scontrini: quanti vengono dalle persone entrate in più o in meno (grigio) e quanti dalla conversione (blu).'}
        azioni={<Scelta etichetta="Confronto" valore={props.confronto} onChange={props.setConfronto} opzioni={[['anno', 'Anno prima'], ['mese', 'Mese prima']]} />}>
        {scomp.length === 0
          ? <p className="text-sm text-slate-500">Per {meseLeggibile(meseConfronto)} non ci sono dati di questi negozi.</p>
          : (
            <div className="space-y-1">
              {scomp.map(({ nome, s }) => {
                const barra = (v: number, colore: string) => {
                  const w = `${((Math.abs(v) / scompMax) * 100).toFixed(1)}%`;
                  return v < 0
                    ? [<div key="n" className="flex justify-end"><div className={`h-3 ${colore}`} style={{ width: w }} /></div>, <div key="p" />]
                    : [<div key="n" />, <div key="p"><div className={`h-3 ${colore}`} style={{ width: w }} /></div>];
                };
                const diff = s.ora - s.prima;
                const parti: [number, string][] = [[s.traffico, 'bg-slate-400'], [s.conversione, 'bg-blue-600'], ...(s.base === 'vendite' ? [[s.scontrino, 'bg-emerald-600'] as [number, string]] : [])];
                return (
                  <div key={nome} className="grid grid-cols-[6.5rem_1fr_1fr_5.5rem] sm:grid-cols-[9rem_1fr_1fr_7rem] items-center gap-2 py-1.5 border-b border-slate-100 text-sm">
                    <div className="truncate">{nome}</div>
                    <div className="space-y-0.5">{parti.map(([v, c], i) => <div key={i}>{barra(v, c)[0]}</div>)}</div>
                    <div className="space-y-0.5">{parti.map(([v, c], i) => <div key={i}>{barra(v, c)[1]}</div>)}</div>
                    <div className={`text-right font-semibold tabular-nums whitespace-nowrap ${diff >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                      {diff > 0 ? '+' : diff < 0 ? '−' : ''}{s.base === 'vendite' ? eur0(Math.abs(diff)) : `${it0(Math.abs(diff))} scontr.`}
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-4 pt-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 bg-slate-400 inline-block" /> persone entrate</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 bg-blue-600 inline-block" /> conversione</span>
                {tutteVendite && <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 bg-emerald-600 inline-block" /> scontrino medio</span>}
                <span>a sinistra quello che toglie, a destra quello che aggiunge</span>
              </div>
            </div>
          )}
      </Sezione>

      <Sezione titolo="Il mese giorno per giorno" comeSiLegge="Una riga per negozio, un quadrato per giorno: più è scuro, più alto è il valore. Sabato e domenica sono in grassetto. Passando sopra un quadrato si leggono i numeri del giorno."
        azioni={<Scelta etichetta="Metrica del calendario" valore={props.metricaCal} onChange={props.setMetricaCal} opzioni={[['ingressi', 'Persone entrate'], ['conversione', 'Conversione'], ['vendite', 'Vendite']]} />}>
        <div className="overflow-x-auto">
          <div className="grid gap-0.5 min-w-[640px]" style={{ gridTemplateColumns: `8rem repeat(${giorniMese}, minmax(0, 1fr))` }}>
            <div />
            {Array.from({ length: giorniMese }, (_, i) => {
              const gs = (new Date(Date.UTC(Number(mese.slice(0, 4)), Number(mese.slice(5, 7)) - 1, i + 1)).getUTCDay() + 6) % 7;
              return <div key={i} className={`text-center text-[11px] leading-tight ${gs > 4 ? 'font-bold text-slate-800' : 'text-slate-400'}`}>{i + 1}<br />{INIZIALI[gs]}</div>;
            })}
            {[...calcoli.presenti].sort((a, b) => nomeNeg(a).localeCompare(nomeNeg(b), 'it')).map((id) => (
              <div key={id} className="contents">
                <div className="text-xs text-slate-700 truncate pr-1 self-center">{nomeNeg(id)}</div>
                {Array.from({ length: giorniMese }, (_, i) => {
                  const g = perGiorno.get(`${id}|${i + 1}`);
                  const v = valCal(g);
                  return (
                    <div key={i} className="h-7 rounded-sm" style={v == null ? { backgroundColor: '#f1f5f9' } : cellaCalda(v / (props.metricaCal === 'conversione' ? 20 : maxCal))}
                      title={g ? `${nomeNeg(id)}, ${i + 1}/${mese.slice(5, 7)}: ${it0(g.ingressi)} persone entrate, ${it0(g.scontrini)} scontrini, conversione ${pct(g.ingressi ? (g.scontrini / g.ingressi) * 100 : null)}${g.importi ? `, ${eur0(g.reale)}` : ''}` : `${nomeNeg(id)}, ${i + 1}/${mese.slice(5, 7)}: nessun dato`} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </Sezione>

      <Sezione titolo="Le ore della settimana" comeSiLegge={`Righe i giorni della settimana, colonne le fasce orarie, sommati su tutto il mese${scelti ? '' : ' e su tutti i negozi'}. «Persone entrate» dice dove arriva la gente, «Conversione» dove la si serve. La conversione dell’ultima ora è gonfiata: chi entra poco prima paga nell’ora dopo.`}
        azioni={<Scelta etichetta="Metrica delle ore" valore={props.metricaOre} onChange={props.setMetricaOre} opzioni={[['ingressi', 'Persone entrate'], ['conversione', 'Conversione']]} />}>
        {fasce.length === 0 ? <p className="text-sm text-slate-500">Nessuna ora con persone entrate.</p> : (
          <div className="overflow-x-auto">
            <div className="grid gap-0.5 min-w-[560px]" style={{ gridTemplateColumns: `6.5rem repeat(${fasce.length}, minmax(0, 1fr))` }}>
              <div />
              {fasce.map((h) => <div key={h} className="text-center text-[11px] text-slate-500">{h}-{h + 1}</div>)}
              {GIORNI_SETT.map((nome, i) => (
                <div key={nome} className="contents">
                  <div className={`text-xs self-center ${i > 4 ? 'font-bold text-slate-800' : 'text-slate-700'}`}>{nome}</div>
                  {fasce.map((h) => {
                    const v = valOra(i + 1, h);
                    const x = mappa.get(`${i + 1}|${h}`);
                    return (
                      <div key={h} className="h-8 rounded-sm grid place-items-center text-[11px] tabular-nums" style={v == null ? { backgroundColor: '#f1f5f9', color: '#94a3b8' } : cellaCalda(v / maxOre)}
                        title={x ? `${nome} ${h}-${h + 1}: ${it0(x.ingressi)} persone entrate, ${it0(x.scontrini)} scontrini` : undefined}>
                        {v == null ? '' : props.metricaOre === 'ingressi' ? it0(v) : it1(v)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </Sezione>

      {dOra.resa != null && mOra.teorico > 0 && (
        <Sezione titolo="Dal prezzo di listino alla resa" comeSiLegge="Si parte dalla merce venduta a prezzo pieno, si tolgono gli sconti e si arriva all’incassato; poi si toglie il costo d’acquisto della merce venduta e resta la resa. È il margine commerciale, non quello del conto economico: personale, affitti e il resto non ci sono.">
          <div className="space-y-2">
            {[
              { t: 'Listino', da: 0, a: mOra.teorico, c: 'bg-slate-400' },
              { t: 'Sconti', da: mOra.reale, a: mOra.teorico, c: 'bg-red-500', meno: true },
              { t: 'Incassato', da: 0, a: mOra.reale, c: 'bg-slate-800' },
              { t: 'Costo merce', da: mOra.reale - mOra.costo, a: mOra.reale, c: 'bg-red-500', meno: true },
              { t: 'Resa', da: 0, a: mOra.reale - mOra.costo, c: 'bg-emerald-600' },
            ].map((x) => (
              <div key={x.t} className="grid grid-cols-[6.5rem_1fr_7rem] sm:grid-cols-[8rem_1fr_8rem] items-center gap-2 text-sm">
                <div>{x.t}</div>
                <div className="relative h-6 bg-slate-50 rounded-sm">
                  <div className={`absolute top-0 bottom-0 ${x.c}`} style={{ left: `${(x.da / mOra.teorico) * 100}%`, width: `${((x.a - x.da) / mOra.teorico) * 100}%` }} />
                </div>
                <div className="text-right tabular-nums whitespace-nowrap">{x.meno ? '−' : ''}{eur0(x.a - x.da)}</div>
              </div>
            ))}
            <p className="text-xs text-slate-500 pt-1">
              Su 100 € di listino: {it1((mOra.reale / mOra.teorico) * 100)} incassati e {it1(((mOra.reale - mOra.costo) / mOra.teorico) * 100)} di resa.
              Ricarico {num2(dOra.ricaricoTeorico)} sul listino, {num2(dOra.ricaricoReale)} sull’incassato.
            </p>
          </div>
        </Sezione>
      )}

      <details className="bg-white rounded-2xl border border-slate-200 p-4 text-sm text-slate-700">
        <summary className="cursor-pointer flex items-center gap-1.5 font-medium text-slate-800"><Info size={15} /> Le colonne di MODA e come si calcolano</summary>
        <ul className="mt-2 ml-4 list-disc space-y-1 text-xs">
          <li><strong>N.P.</strong>: persone entrate, dal contapersone. <strong>Scontr</strong>: scontrini. <strong>C.R.</strong>: conversione, scontrini ÷ persone entrate.</li>
          <li><strong>Qta Vend</strong>: pezzi venduti. <strong>UPT</strong>: pezzi per scontrino.</li>
          <li><strong>Valore teorico</strong>: vendite a prezzo di listino. <strong>Valore reale</strong>: vendite incassate. <strong>Scon %</strong>: 1 − reale ÷ teorico.</li>
          <li><strong>Prz.Medi</strong>: prezzo medio di un pezzo, reale ÷ pezzi. <strong>Scontrino medio</strong>: reale ÷ scontrini (MODA non lo stampa).</li>
          <li><strong>V.Acq</strong>: costo d’acquisto della merce venduta, a costo medio. <strong>Ricarichi</strong>: teorico ÷ costo e reale ÷ costo. <strong>Resa</strong>: reale − costo.</li>
          <li>Tutti gli importi sono imponibili, senza IVA, ed escludono vendite libere, buoni e acconti.</li>
        </ul>
      </details>
      {props.puoCaricare && (
        <button type="button" onClick={props.vaiACarica} className="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:underline min-h-[44px]">
          <FileUp size={16} /> Carica un report MODA
        </button>
      )}
    </>
  );
}
