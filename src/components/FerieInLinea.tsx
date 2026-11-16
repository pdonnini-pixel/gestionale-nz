// «Ferie e permessi in linea con il mese» (Patrizio, 14/11/2026): il riquadro del piano del mese
// con quello che matura ognuna, quello che è già chiesto o approvato, le proposte del sistema da
// approvare, spostare o togliere, e il residuo previsto a fine mese. Niente da impostare.

import { useState } from 'react';
import { CalendarClock, Check, RefreshCw, Trash2 } from 'lucide-react';
import { NOME_VOCE, TESTO_RESTO, type MotivoResto, type QuadroVoce } from '../lib/ferieInLinea';

export interface PropostaInRiga {
  requestId: string; data: string; tipo: 'giornata' | 'ore'; ore: number;
  /** i giorni in cui si può spostare */
  giorniPossibili: string[];
}
export interface RigaFerieInLinea {
  id: string; nome: string;
  /** perché non ha proposte: senza riga nel tabulato delle paghe, oppure a chiamata */
  senza?: 'tabulato' | 'chiamata';
  voci: QuadroVoce[];
  proposte: PropostaInRiga[];
}

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const giorno = (d: string) => `${GIORNI[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

export default function FerieInLinea(props: {
  righe: RigaFerieInLinea[];
  /** quanto è costato in copertura alla creazione del piano */
  costo?: { oreProposte: number; senza: { scoperte: number; straordinario: number }; con: { scoperte: number; straordinario: number } };
  resti?: { nome: string; ore: number; motivo: MotivoResto }[];
  /** nessun tabulato delle paghe caricato per l'azienda: una riga sola, non una per persona */
  nessunTabulato?: boolean;
  puoModificare: boolean;
  /** un'azione è in corso: i pulsanti si fermano */
  occupato: boolean;
  onApprova: (requestId: string) => void;
  onApprovaTutte: () => void;
  onSposta: (requestId: string, data: string) => void;
  onTogli: (requestId: string) => void;
  onRicalcolaMese: () => void;
}) {
  const { righe, costo, resti, puoModificare, occupato } = props;
  const [sposta, setSposta] = useState<string | null>(null);
  const proposte = righe.flatMap((r) => r.proposte);
  const tot = (campo: 'matura' | 'approvate' | 'inAttesa' | 'proposte', voci: QuadroVoce[]) => voci.reduce((a, v) => a + v[campo], 0);
  const piuStraord = costo ? costo.con.straordinario - costo.senza.straordinario : 0;
  const piuScoperte = costo ? costo.con.scoperte - costo.senza.scoperte : 0;
  return (
    <section id="ferie-in-linea" className="rounded-xl border border-violet-200 bg-white">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-violet-100">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarClock size={16} className="text-violet-600" /> Ferie e permessi in linea con il mese</h3>
          <p className="text-xs text-slate-600 mt-0.5 max-w-3xl">
            Ogni mese si consuma quello che matura, così i residui non crescono. Il sistema propone i giorni più tranquilli, mai nei giorni caldi né negli eventi.
            Le proposte non valgono finché non le approvi: puoi anche spostarle o toglierle, e i turni si ricalcolano.
          </p>
        </div>
        {puoModificare && (
          <div className="flex flex-wrap gap-2">
            {proposte.length > 0 && (
              <button type="button" onClick={props.onApprovaTutte} disabled={occupato}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                <Check size={14} /> Approva tutte ({proposte.length})
              </button>
            )}
            <button type="button" onClick={props.onRicalcolaMese} disabled={occupato} title="Rifà i turni proposti dal sistema in tutto il mese con le ferie di adesso. I turni messi a mano e quelli pubblicati non si toccano."
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw size={14} /> Ricalcola il mese
            </button>
          </div>
        )}
      </header>

      {costo && costo.oreProposte > 0 && (piuStraord > 0.25 || piuScoperte > 0.25) && (
        <p className="mx-4 mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          Con le {fmt(costo.oreProposte)} ore proposte, rispetto allo stesso mese senza:
          {piuScoperte > 0.25 && <> <b>{fmt(piuScoperte)} ore in più sotto gli ingressi</b> (da {fmt(costo.senza.scoperte)} a {fmt(costo.con.scoperte)})</>}
          {piuScoperte > 0.25 && piuStraord > 0.25 && ' e'}
          {piuStraord > 0.25 && <> <b>{fmt(piuStraord)} ore di straordinario in più</b> (da {fmt(costo.senza.straordinario)} a {fmt(costo.con.straordinario)})</>}.
          Le persone minime delle fasce restano coperte come prima.
        </p>
      )}

      {props.nessunTabulato ? (
        <p className="px-4 py-3 text-sm text-slate-600">Nessun tabulato dello studio paghe caricato: il sistema non sa quanto matura ognuno e non propone niente. Le proposte arrivano con il primo tabulato caricato in Dipendenti.</p>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2 font-semibold">Persona</th>
              <th className="px-3 py-2 font-semibold text-right">Matura nel mese</th>
              <th className="px-3 py-2 font-semibold text-right">Già approvate</th>
              <th className="px-3 py-2 font-semibold text-right">Chieste, in attesa</th>
              <th className="px-3 py-2 font-semibold min-w-[21rem]">Proposte dal sistema</th>
              <th className="px-3 py-2 font-semibold text-right">Residuo a fine mese</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((r) => {
              const daMettere = r.voci.reduce((a, v) => a + v.daProporre, 0);
              return (
                <tr key={r.id} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-2 font-medium text-slate-900">{r.nome}</td>
                  {r.senza ? (
                    <td colSpan={5} className="px-3 py-2 text-xs text-slate-500">
                      {r.senza === 'tabulato'
                        ? 'Non è ancora nel tabulato dello studio paghe: il sistema non sa quanto matura e non propone niente. Le proposte arrivano con il primo tabulato che la contiene.'
                        : 'A chiamata: ferie e permessi le sono pagati ogni mese, non si propongono.'}
                    </td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="font-semibold">{fmt(tot('matura', r.voci))} h</span>
                        <span className="block text-[11px] text-slate-500">{r.voci.filter((v) => v.matura > 0).map((v) => `${NOME_VOCE[v.voce]} ${fmt(v.matura)}`).join(' · ')}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(tot('approvate', r.voci))} h</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(tot('inAttesa', r.voci))} h</td>
                      <td className="px-3 py-2">
                        {r.proposte.length === 0 && <span className="text-xs text-slate-500">{daMettere >= 1 ? `nessuna: restano ${fmt(daMettere)} h da mettere` : 'niente da proporre: è in linea'}</span>}
                        <ul className="space-y-1.5">
                          {r.proposte.map((p) => (
                            <li key={p.requestId} className="flex items-center gap-2 whitespace-nowrap">
                              <span className="inline-flex items-center rounded-md border border-dashed border-violet-400 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900">
                                {giorno(p.data)} · {p.tipo === 'giornata' ? `ferie (${fmt(p.ore)} h)` : `permesso ${fmt(p.ore)} h`}
                              </span>
                              {puoModificare && (sposta === p.requestId ? (
                                <select autoFocus disabled={occupato} defaultValue="" aria-label={`Sposta la proposta di ${r.nome} del ${giorno(p.data)}`}
                                  onBlur={() => setSposta(null)}
                                  onChange={(e) => { if (e.target.value) { props.onSposta(p.requestId, e.target.value); setSposta(null); } }}
                                  className="text-xs rounded-md border border-slate-300 px-1.5 py-1">
                                  <option value="">{p.giorniPossibili.length ? 'A quale giorno?' : 'Nessun altro giorno adatto'}</option>
                                  {p.giorniPossibili.map((d) => <option key={d} value={d}>{giorno(d)}</option>)}
                                </select>
                              ) : (
                                <>
                                  <button type="button" disabled={occupato} onClick={() => props.onApprova(p.requestId)} className="text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-50">Approva</button>
                                  <button type="button" disabled={occupato} onClick={() => setSposta(p.requestId)} className="text-xs font-semibold text-blue-700 hover:underline disabled:opacity-50">Sposta</button>
                                  <button type="button" disabled={occupato} onClick={() => props.onTogli(p.requestId)} title="Togli la proposta" aria-label={`Togli la proposta di ${r.nome} del ${giorno(p.data)}`}
                                    className="text-slate-400 hover:text-red-600 disabled:opacity-50"><Trash2 size={13} /></button>
                                </>
                              ))}
                            </li>
                          ))}
                        </ul>
                        {r.proposte.length > 0 && daMettere >= 1 && <span className="block mt-1 text-[11px] text-slate-500">restano {fmt(daMettere)} h da mettere</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="font-semibold">{fmt(r.voci.reduce((a, v) => a + v.residuoFineMese, 0))} h</span>
                        <span className="block text-[11px] text-slate-500">{r.voci.map((v) => `${NOME_VOCE[v.voce]} ${fmt(v.residuoFineMese)}`).join(' · ')}</span>
                        {tot('proposte', r.voci) > 0 && <span className="block text-[11px] text-violet-700">senza le proposte {fmt(r.voci.reduce((a, v) => a + v.residuoSenzaProposte, 0))} h</span>}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {!!resti?.length && (
        <p className="px-4 py-2.5 text-xs text-slate-600 border-t border-slate-100">
          Non proposte alla creazione del piano: {resti.map((x) => `${x.nome} ${fmt(x.ore)} h (${TESTO_RESTO[x.motivo]})`).join('; ')}.
        </p>
      )}
    </section>
  );
}
