// «Eventi» dei negozi: Black Friday, feste natalizie, saldi e simili
// (outlet_events, Patrizio 20/10/2026). Si inseriscono anche in corso
// d'anno (lo fa Veronica, profilo contabile). Un evento dura uno o piu'
// giorni e vale per uno, alcuni o tutti i negozi. Nei suoi giorni:
//  - serve piu' personale: le persone in piu' sono fabbisogno, quindi le
//    decide solo la direzione (super_advisor; il database lo controlla);
//  - niente ferie ne' permessi: la richiesta si blocca;
//  - se mancano persone la proposta dei turni chiede straordinari.
// I giorni di chiusura restano per negozio, in «Orari e fabbisogno».

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from './Toast';
import { formattaDataBreve, oggiRoma } from '../lib/organico';
import { nomeNegozio, type NegozioRif } from '../lib/organicoDati';
import type { EventoNegozio } from '../lib/turni';

type Props = {
  companyId: string;
  negozi: NegozioRif[];
  puoScrivere: boolean;
  puoFabbisogno: boolean;
  onSalvato?: () => void;
};

type Riga = EventoNegozio & { id?: string };

const vuoto = (): Riga => ({ nome: '', data_dal: '', data_al: '', outlet_ids: null, persone_extra: 0, blocca_ferie: true, straordinari: true, nota: '' });
const inputCls = 'min-h-[36px] rounded-lg border border-slate-300 px-2 text-sm disabled:bg-slate-50 disabled:text-slate-500';
const ESEMPI = ['Black Friday', 'Feste natalizie', 'Saldi invernali', 'Saldi estivi'];

export default function EventiNegozi({ companyId, negozi, puoScrivere, puoFabbisogno, onSalvato }: Props) {
  const { toast } = useToast();
  const [eventi, setEventi] = useState<Riga[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [modulo, setModulo] = useState<Riga | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [passati, setPassati] = useState(false);

  const carica = useCallback(async () => {
    setCaricamento(true);
    const { data, error } = await supabase.from('outlet_events').select('*').eq('company_id', companyId).order('data_dal');
    if (error) toast({ type: 'error', message: `Eventi non caricati: ${error.message}` });
    setEventi(((data as Riga[]) ?? []).map((e) => ({ ...e, nota: e.nota ?? '' })));
    setCaricamento(false);
  }, [companyId, toast]);
  useEffect(() => { carica(); }, [carica]);

  const oggi = oggiRoma();
  const visibili = eventi.filter((e) => passati || e.data_al >= oggi);
  const nomiNegozi = (ids: string[] | null) => (!ids || !ids.length
    ? 'Tutti i negozi'
    : ids.map((id) => nomeNegozio(negozi.find((n) => n.id === id))).join(', '));

  const salva = async () => {
    if (!modulo) return;
    const m = modulo;
    if (!m.nome.trim()) { toast({ type: 'error', message: 'Dai un nome all’evento.' }); return; }
    if (!m.data_dal || !m.data_al) { toast({ type: 'error', message: 'Indica il primo e l’ultimo giorno.' }); return; }
    if (m.data_al < m.data_dal) { toast({ type: 'error', message: 'L’ultimo giorno viene prima del primo.' }); return; }
    if (m.outlet_ids && !m.outlet_ids.length) { toast({ type: 'error', message: 'Scegli almeno un negozio, oppure «Tutti i negozi».' }); return; }
    setSalvo(true);
    const riga = {
      company_id: companyId, nome: m.nome.trim(), data_dal: m.data_dal, data_al: m.data_al, outlet_ids: m.outlet_ids,
      blocca_ferie: m.blocca_ferie, straordinari: m.straordinari, nota: m.nota?.trim() || null,
      // Le persone in piu' sono fabbisogno: chi non le decide non le manda.
      ...(puoFabbisogno ? { persone_extra: m.persone_extra } : {}),
    };
    const { error } = m.id
      ? await supabase.from('outlet_events').update(riga).eq('id', m.id)
      : await supabase.from('outlet_events').insert([riga]);
    setSalvo(false);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: `«${riga.nome}» salvato.` });
    setModulo(null);
    await carica();
    onSalvato?.();
  };

  const togli = async (e: Riga) => {
    if (!e.id || !window.confirm(`Togliere «${e.nome}» (${formattaDataBreve(e.data_dal)}-${formattaDataBreve(e.data_al)})?`)) return;
    const { error } = await supabase.from('outlet_events').delete().eq('id', e.id);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    await carica();
    onSalvato?.();
  };

  const scegliNegozio = (id: string, si: boolean) => setModulo((m) => {
    if (!m) return m;
    const ora = new Set(m.outlet_ids ?? []);
    if (si) ora.add(id); else ora.delete(id);
    return { ...m, outlet_ids: [...ora] };
  });

  if (caricamento) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Black Friday, feste natalizie, saldi: giorni singoli o periodi in cui serve più personale. Nei giorni di un evento
        <strong> non si prendono ferie né permessi</strong> e, se le persone non bastano, la proposta dei turni chiede
        <strong> straordinari</strong>. Le persone in più le decide la direzione. I giorni di chiusura di ogni negozio stanno in «Orari e fabbisogno».
      </div>

      <section className="bg-white border border-slate-200 rounded-xl">
        <div className="flex items-center justify-between gap-2 p-4 border-b border-slate-100 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1.5"><CalendarRange size={15} /> Eventi e periodi di punta</h3>
            <p className="text-xs text-slate-500">{passati ? 'Tutti, anche quelli finiti.' : 'In corso e in arrivo.'}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPassati((p) => !p)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50">
              {passati ? 'Solo in arrivo' : 'Mostra anche i passati'}
            </button>
            {puoScrivere && !modulo && (
              <button type="button" onClick={() => setModulo(vuoto())} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><Plus size={13} /> Nuovo evento</button>
            )}
          </div>
        </div>

        {modulo && (
          <div className="p-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-slate-600 flex-1 min-w-[180px]">Nome<br />
                <input className={`${inputCls} w-full`} value={modulo.nome} placeholder="Black Friday" onChange={(e) => setModulo({ ...modulo, nome: e.target.value })} />
              </label>
              <label className="text-xs text-slate-600">Dal<br />
                <input type="date" className={inputCls} value={modulo.data_dal} onChange={(e) => setModulo({ ...modulo, data_dal: e.target.value, data_al: modulo.data_al || e.target.value })} />
              </label>
              <label className="text-xs text-slate-600">Al<br />
                <input type="date" className={inputCls} value={modulo.data_al} min={modulo.data_dal || undefined} onChange={(e) => setModulo({ ...modulo, data_al: e.target.value })} />
              </label>
            </div>
            {!modulo.id && (
              <div className="flex flex-wrap gap-1.5">
                {ESEMPI.map((n) => (
                  <button key={n} type="button" onClick={() => setModulo({ ...modulo, nome: n })} className="text-xs px-2 py-1 rounded-full border border-slate-300 hover:bg-white">{n}</button>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs text-slate-700 flex items-center gap-1.5 font-medium">
                <input type="checkbox" checked={!modulo.outlet_ids} onChange={(e) => setModulo({ ...modulo, outlet_ids: e.target.checked ? null : [] })} /> Tutti i negozi
              </label>
              {modulo.outlet_ids && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {negozi.map((n) => (
                    <label key={n.id} className="text-xs text-slate-600 flex items-center gap-1.5">
                      <input type="checkbox" checked={modulo.outlet_ids!.includes(n.id)} onChange={(e) => scegliNegozio(n.id, e.target.checked)} /> {nomeNegozio(n)}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs text-slate-600">
                <span className="flex items-center gap-1">Persone in più in negozio {!puoFabbisogno && <Lock size={11} className="text-slate-400" />}</span>
                <input type="number" min={0} max={30} disabled={!puoFabbisogno} className={`${inputCls} w-20 mt-1`} value={modulo.persone_extra}
                  title={puoFabbisogno ? undefined : 'Le persone in più sono fabbisogno: le decide la direzione (profilo Super Advisor).'}
                  onChange={(e) => setModulo({ ...modulo, persone_extra: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <label className="text-xs text-slate-700 flex items-center gap-1.5 pb-2">
                <input type="checkbox" checked={modulo.blocca_ferie} onChange={(e) => setModulo({ ...modulo, blocca_ferie: e.target.checked })} /> Niente ferie né permessi
              </label>
              <label className="text-xs text-slate-700 flex items-center gap-1.5 pb-2">
                <input type="checkbox" checked={modulo.straordinari} onChange={(e) => setModulo({ ...modulo, straordinari: e.target.checked })} /> Straordinari se mancano persone
              </label>
            </div>
            {!puoFabbisogno && (
              <p className="text-xs text-slate-500">Le persone in più le decide la direzione (profilo Super Advisor): l’evento si salva comunque, con le ferie bloccate e gli straordinari.</p>
            )}
            <label className="text-xs text-slate-600 block">Nota<br />
              <input className={`${inputCls} w-full`} value={modulo.nota ?? ''} onChange={(e) => setModulo({ ...modulo, nota: e.target.value })} />
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={salva} disabled={salvo} className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">{salvo ? 'Salvo…' : 'Salva evento'}</button>
              <button type="button" onClick={() => setModulo(null)} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-lg border border-slate-300 hover:bg-white"><X size={13} /> Annulla</button>
            </div>
          </div>
        )}

        <ul className="divide-y divide-slate-100 text-sm">
          {visibili.map((e) => (
            <li key={e.id} className="px-4 py-2.5 flex items-start justify-between gap-2">
              <div>
                <div><strong>{e.nome}</strong> <span className="text-slate-500">· {e.data_dal === e.data_al ? formattaDataBreve(e.data_dal) : `${formattaDataBreve(e.data_dal)} - ${formattaDataBreve(e.data_al)}`}</span></div>
                <div className="text-xs text-slate-500">
                  {nomiNegozi(e.outlet_ids)}
                  {e.persone_extra ? ` · +${e.persone_extra} ${e.persone_extra === 1 ? 'persona' : 'persone'}` : ' · persone in più da decidere'}
                  {e.blocca_ferie ? ' · niente ferie né permessi' : ''}
                  {e.straordinari ? ' · straordinari se mancano persone' : ''}
                  {e.nota ? ` · ${e.nota}` : ''}
                </div>
              </div>
              {puoScrivere && (
                <div className="flex gap-1 shrink-0">
                  <button type="button" aria-label="Modifica l’evento" onClick={() => setModulo({ ...e })} className="p-1.5 rounded hover:bg-slate-100"><Pencil size={14} /></button>
                  <button type="button" aria-label="Togli l’evento" onClick={() => togli(e)} className="p-1.5 rounded hover:bg-slate-100"><Trash2 size={14} /></button>
                </div>
              )}
            </li>
          ))}
          {!visibili.length && <li className="px-4 py-3 text-slate-400">Nessun evento {passati ? '' : 'in arrivo'}.</li>}
        </ul>
      </section>
    </div>
  );
}
