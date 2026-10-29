// «Piano ferie»: per ogni negozio, quante ore di ferie ha in tasca ogni
// persona, quante sono gia' programmate e quante resterebbero a fine anno,
// con le ferie dei prossimi tre mesi su una riga del tempo.
//
// I saldi vengono dal tabulato dello studio paghe (v_leave_disponibilita,
// vedi PIANO_FERIE_NOTES.md): qui non si ricalcola la maturazione. In piu'
// si incrociano le ferie con il fabbisogno del negozio: i giorni in cui,
// con quelle ferie, restano meno persone di quelle che servono.
//
// Il fabbisogno viene dal traffico MODA come nei turni (Patrizio, 29/10/2026):
// le ore di contratto di tutto l'organico distribuite come gli ingressi
// attesi, settimana per settimana (le «ore necessarie» del piano del mese).
// Servono le persone del momento di punta. «Orari e fabbisogno» vale solo
// per un negozio senza traffico.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import {
  organicoAllaData, personaAllaData, nomePersona, formattaDataBreve, oggiRoma, aggiungiGiorni, giorniTra,
  type PersonaOggi,
} from '../lib/organico';
import { caricaGiorniFerie, caricaOrganico, caricaStoricoNegozio, nomeNegozio, type DatiOrganico } from '../lib/organicoDati';
import { attesoDelleDate, fabbisognoPienoDaTraffico, type StoricoTraffico } from '../lib/pianoMensile';
import {
  costruisciGiorni, giorniDellaSettimana, lunediDi, personeInPiu,
  type FasciaFabbisogno, type GiornoSpeciale, type OrarioGiornoTipo,
} from '../lib/turni';

type Props = { companyId?: string };

type Saldo = {
  employee_id: string; voce: string; saldo_alla_data: string | null; residuo: number; da_fruire: number;
  ore_in_attesa: number; ore_approvate: number; residuo_disponibile: number; da_fruire_disponibile: number;
};

const GIORNI = 92;
const STATI_APPROVATE = ['approvata', 'approvata_parziale', 'chiusa'];
const fmt = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 1 });

export default function PianoFerie({ companyId }: Props) {
  const { toast } = useToast();
  const oggi = oggiRoma();
  const fine = aggiungiGiorni(oggi, GIORNI - 1);
  const [dati, setDati] = useState<DatiOrganico | null>(null);
  const [saldi, setSaldi] = useState<Saldo[]>([]);
  const [ferie, setFerie] = useState<Awaited<ReturnType<typeof caricaGiorniFerie>>>([]);
  const [orari, setOrari] = useState<(OrarioGiornoTipo & { outlet_id: string })[]>([]);
  const [fasce, setFasce] = useState<(FasciaFabbisogno & { outlet_id: string })[]>([]);
  const [speciali, setSpeciali] = useState<(GiornoSpeciale & { outlet_id: string })[]>([]);
  const [negozio, setNegozio] = useState('');
  // Traffico MODA del negozio scelto (o forma media degli altri).
  const [storico, setStorico] = useState<{ outletId: string; storico: StoricoTraffico; propria: boolean } | null>(null);

  const carica = useCallback(async () => {
    if (!companyId) return;
    try {
      const [d, s, f, o, n, sp] = await Promise.all([
        caricaOrganico(companyId),
        supabase.from('v_leave_disponibilita').select('*').eq('company_id', companyId),
        caricaGiorniFerie(companyId, oggi, fine),
        supabase.from('outlet_opening_hours').select('outlet_id, giorno, chiuso, apre, chiude').eq('company_id', companyId),
        supabase.from('outlet_staffing_needs').select('outlet_id, giorno, dalle, alle, persone').eq('company_id', companyId),
        supabase.from('outlet_special_days').select('outlet_id, data, chiuso, apre, chiude, persone_extra, nota').eq('company_id', companyId).gte('data', oggi).lte('data', fine),
      ]);
      setDati(d);
      setSaldi(((s.data as Record<string, unknown>[]) ?? []).map((r) => ({
        employee_id: String(r.employee_id), voce: String(r.voce), saldo_alla_data: (r.saldo_alla_data as string) ?? null,
        residuo: Number(r.residuo ?? 0), da_fruire: Number(r.da_fruire ?? 0), ore_in_attesa: Number(r.ore_in_attesa ?? 0),
        ore_approvate: Number(r.ore_approvate ?? 0), residuo_disponibile: Number(r.residuo_disponibile ?? 0),
        da_fruire_disponibile: Number(r.da_fruire_disponibile ?? 0),
      })));
      setFerie(f);
      setOrari((o.data as (OrarioGiornoTipo & { outlet_id: string })[]) ?? []);
      setFasce((n.data as (FasciaFabbisogno & { outlet_id: string })[]) ?? []);
      setSpeciali((sp.data as (GiornoSpeciale & { outlet_id: string })[]) ?? []);
    } catch (e) {
      toast({ type: 'error', message: `Piano ferie non caricato: ${e instanceof Error ? e.message : 'errore'}` });
    }
  }, [companyId, oggi, fine, toast]);
  useEffect(() => { carica(); }, [carica]);

  const persone = useMemo(() => (dati ? organicoAllaData(dati.schede, dati.eventi, oggi).filter((p) => p.stato === 'in_servizio' || p.stato === 'assente') : []), [dati, oggi]);
  const negozi = useMemo(() => (dati?.negozi ?? []).filter((n) => persone.some((p) => p.outletId === n.id)), [dati, persone]);
  useEffect(() => { if (!negozio && negozi.length) setNegozio(negozi[0].id); }, [negozi, negozio]);
  useEffect(() => {
    if (!companyId || !negozio) return;
    let vivo = true;
    caricaStoricoNegozio(companyId, negozio)
      .then((st) => { if (vivo) setStorico({ outletId: negozio, ...st }); })
      .catch(() => { if (vivo) setStorico(null); });
    return () => { vivo = false; };
  }, [companyId, negozio]);

  const delNegozio = persone.filter((p) => p.outletId === negozio)
    .sort((a, b) => nomePersona(a.scheda).localeCompare(nomePersona(b.scheda), 'it'));

  const saldoFerie = (id: string) => saldi.find((s) => s.employee_id === id && s.voce === 'F01');
  const permessi = (id: string) => saldi.filter((s) => s.employee_id === id && s.voce !== 'F01').reduce((a, s) => a + s.da_fruire_disponibile, 0);
  const giorniDi = (id: string) => ferie.filter((f) => f.employee_id === id && f.stato_richiesta !== 'ritirata' && f.stato_richiesta !== 'respinta' && f.stato_richiesta !== 'bozza' && f.stato_giorno !== 'respinto');

  // I giorni in cui, con le ferie, il negozio resta sotto il fabbisogno.
  const fabbisogno = useMemo(() => {
    if (!dati || !negozio) return null;
    // Settimane intere: le ore di contratto valgono da lunedi' a domenica.
    const date: string[] = [];
    for (let l = lunediDi(oggi); l <= fine; l = aggiungiGiorni(l, 7)) date.push(...giorniDellaSettimana(l));
    const sp = speciali.filter((x) => x.outlet_id === negozio);
    const base = costruisciGiorni(date, orari.filter((o) => o.outlet_id === negozio), fasce.filter((f) => f.outlet_id === negozio), sp,
      [], dati.negozi.find((n) => n.id === negozio)?.opening_date ?? null);
    const presenti = (d: string) => dati.schede.map((x) => personaAllaData(x, dati.eventi, d)).filter((p) => p.outletId === negozio && p.stato === 'in_servizio');
    const moda = storico?.outletId === negozio ? attesoDelleDate(storico.storico, date) : null;
    if (!moda || !moda.atteso.size) return { giorni: base, presenti, moda: null };
    // Le ore settimanali di chi e' in forza in quella settimana, ferie comprese.
    const oreSettimana = (lun: string) => dati.schede.reduce((a, x) => {
      const p = giorniDellaSettimana(lun).map((d) => personaAllaData(x, dati.eventi, d)).find((q) => q.outletId === negozio && q.stato === 'in_servizio');
      return a + (p?.ore ?? 0);
    }, 0);
    return {
      giorni: fabbisognoPienoDaTraffico(base, moda.atteso, oreSettimana, (d) => presenti(d).length, personeInPiu(date, sp)),
      presenti,
      moda: { fonti: moda.fonti, propria: storico?.propria ?? false },
    };
  }, [dati, negozio, orari, fasce, speciali, storico, oggi, fine]);

  const conflitti = useMemo(() => {
    if (!fabbisogno) return [];
    const out: { data: string; servono: number; restano: number; chi: string[] }[] = [];
    for (const g of fabbisogno.giorni) {
      if (g.data < oggi || g.data > fine || g.chiuso || !g.fabbisogno.length) continue;
      const servono = Math.max(...g.fabbisogno);
      if (servono <= 0) continue;
      const presenti = fabbisogno.presenti(g.data);
      const via = presenti.filter((p) => ferie.some((f) => f.employee_id === p.scheda.id && f.data === g.data && f.tipo === 'giornata'
        && ['inviata', ...STATI_APPROVATE].includes(f.stato_richiesta) && f.stato_giorno !== 'respinto'));
      if (!via.length) continue;
      const restano = presenti.length - via.length;
      if (restano < servono) out.push({ data: g.data, servono, restano, chi: via.map((p) => nomePersona(p.scheda)) });
    }
    return out;
  }, [fabbisogno, ferie, oggi, fine]);

  if (!companyId) return null;
  if (!dati) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const tot = delNegozio.reduce((acc, p) => {
    const s = saldoFerie(p.scheda.id);
    if (s) { acc.residuo += s.residuo; acc.impegnate += s.ore_approvate + s.ore_in_attesa; acc.fine += s.da_fruire_disponibile; }
    return acc;
  }, { residuo: 0, impegnate: 0, fine: 0 });
  const dataSaldo = saldi.find((s) => s.saldo_alla_data)?.saldo_alla_data ?? null;
  const haFabbisogno = !!fabbisogno?.moda || fasce.some((f) => f.outlet_id === negozio && f.persone > 0);
  const mesi = [0, 1, 2].map((k) => {
    const d = new Date(`${oggi}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + k, 1);
    return { label: d.toLocaleDateString('it-IT', { month: 'long', timeZone: 'UTC' }), left: Math.max(0, giorniTra(oggi, d.toISOString().slice(0, 10))) / GIORNI * 100 };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {negozi.map((n) => (
          <button key={n.id} type="button" onClick={() => setNegozio(n.id)}
            className={`text-sm px-3 py-1.5 rounded-lg border ${negozio === n.id ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-300 hover:bg-slate-50'}`}>
            {nomeNegozio(n)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Ore di ferie in tasca{dataSaldo ? ` al ${formattaDataBreve(dataSaldo)}` : ''} (tabulato dello studio)</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{fmt(tot.residuo)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Già approvate o chieste dopo quella data</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{fmt(tot.impegnate)}</div>
        </div>
        <div className={`rounded-xl p-4 border ${tot.fine > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
          <div className={`text-xs ${tot.fine > 0 ? 'text-amber-900' : 'text-slate-500'}`}>Da godere entro fine anno, se non si programma altro</div>
          <div className={`text-2xl font-semibold tabular-nums mt-1 ${tot.fine > 0 ? 'text-amber-900' : ''}`}>{fmt(tot.fine)}</div>
        </div>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[920px]">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2 font-semibold w-48">Persona</th>
              <th className="px-3 py-2 font-semibold text-right">In tasca</th>
              <th className="px-3 py-2 font-semibold text-right">Programmate</th>
              <th className="px-3 py-2 font-semibold text-right">Restano a fine anno</th>
              <th className="px-3 py-2 font-semibold">
                <div className="relative h-4">
                  {mesi.map((m) => <span key={m.label} className="absolute capitalize" style={{ left: `${m.left}%` }}>{m.label}</span>)}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {delNegozio.map((p) => <RigaPersona key={p.scheda.id} p={p} saldo={saldoFerie(p.scheda.id)} permessi={permessi(p.scheda.id)} giorni={giorniDi(p.scheda.id)} oggi={oggi} />)}
            {!delNegozio.length && <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-400">Nessuna persona in questo negozio.</td></tr>}
          </tbody>
        </table>
        <div className="flex flex-wrap gap-4 px-3 py-2 border-t border-slate-100 text-xs text-slate-600">
          <span><span className="inline-block w-4 h-2.5 rounded-sm bg-emerald-700 align-middle" /> approvate</span>
          <span><span className="inline-block w-4 h-2.5 rounded-sm bg-emerald-300 align-middle" /> chieste, in attesa</span>
          <span>Le ore contano l'orario di ciascuno: una giornata vale le ore settimanali diviso cinque. «Restano a fine anno» comprende quello che maturerà fino a dicembre.</span>
        </div>
      </section>

      <section className={`rounded-xl border p-4 ${conflitti.length ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
        <h3 className="text-sm font-semibold text-slate-800">Ferie e fabbisogno del negozio</h3>
        {fabbisogno?.moda && (
          <p className="text-xs text-slate-500 mt-0.5">
            Fabbisogno dal {fabbisogno.moda.propria ? 'traffico MODA del negozio' : 'traffico MODA medio degli altri negozi'}: le ore di contratto di tutti distribuite come gli ingressi, contano le persone del momento di punta.
          </p>
        )}
        {!haFabbisogno ? (
          <p className="text-sm text-slate-600 mt-1">Questo negozio non ha traffico MODA e il fabbisogno non è ancora indicato: non si può dire se le ferie lasciano scoperto il negozio.</p>
        ) : conflitti.length === 0 ? (
          <p className="text-sm text-emerald-800 mt-1 flex items-center gap-1.5"><CheckCircle2 size={15} /> Nei prossimi tre mesi le ferie chieste e approvate non lasciano il negozio sotto il fabbisogno.</p>
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
            {conflitti.map((c) => (
              <li key={c.data} className="flex gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span><strong>{formattaDataBreve(c.data)}</strong>: servono {c.servono} persone{fabbisogno?.moda ? ' nel momento di punta' : ''}, con le ferie di {c.chi.join(', ')} ne restano {c.restano}.</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RigaPersona({ p, saldo, permessi, giorni, oggi }: {
  p: PersonaOggi; saldo: Saldo | undefined; permessi: number;
  giorni: Awaited<ReturnType<typeof caricaGiorniFerie>>; oggi: string;
}) {
  const giornata = p.ore ? p.ore / 5 : null;
  const molto = saldo && p.ore ? saldo.da_fruire_disponibile >= p.ore * 2 : false;
  return (
    <tr className="border-b border-slate-100">
      <td className="px-3 py-2.5">
        <div className="font-medium text-slate-900">{nomePersona(p.scheda)}</div>
        <div className="text-xs text-slate-500">
          {p.stato === 'assente' ? `${p.assenza?.motivo ?? 'assente'}: saldo fermo` : `${p.ore ?? '—'} h${giornata ? ` · ${fmt(giornata)} h al giorno` : ''}`}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{saldo ? fmt(saldo.residuo) : <span className="text-slate-400">—</span>}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{saldo ? fmt(saldo.ore_approvate + saldo.ore_in_attesa) : '—'}</td>
      <td className="px-3 py-2.5 text-right">
        {saldo ? <span className={`tabular-nums font-semibold ${molto ? 'text-amber-800' : 'text-slate-800'}`}>{fmt(saldo.da_fruire_disponibile)} h</span> : <span className="text-xs text-slate-400">nessun saldo dallo studio</span>}
        {permessi > 0 && <div className="text-xs text-slate-500">+ {fmt(permessi)} h di permessi</div>}
        {molto && <div className="text-xs text-amber-800">più di due settimane</div>}
      </td>
      <td className="px-3 py-2.5">
        <div className="relative h-5 rounded bg-slate-100" aria-label={`${giorni.length} giorni di ferie nei prossimi tre mesi`}>
          {giorni.map((g) => {
            const i = giorniTra(oggi, g.data);
            if (i < 0 || i >= GIORNI) return null;
            const ok = STATI_APPROVATE.includes(g.stato_richiesta) && g.stato_giorno === 'approvato';
            return <span key={`${g.data}-${g.ore}`} title={`${formattaDataBreve(g.data)} · ${g.ore} h${ok ? '' : ' (in attesa)'}`}
              className={`absolute top-0 h-5 rounded-sm ${ok ? 'bg-emerald-700' : 'bg-emerald-300'}`}
              style={{ left: `${(i / GIORNI) * 100}%`, width: `${Math.max(100 / GIORNI, 0.8)}%` }} />;
          })}
        </div>
      </td>
    </tr>
  );
}
