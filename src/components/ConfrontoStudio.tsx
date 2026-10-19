// «Confronto con lo studio»: i cambiamenti segnati in azienda contro i
// documenti dello studio paghe, e l'ultimo mese di cedolini contro
// l'organico.
//
// La regola e' quella dell'anagrafica: il documento dello studio e' il
// dato vero. Quando dice la stessa cosa, il cambiamento si chiude da solo
// (organico_riconcilia, chiamata all'apertura dell'organico). Quando dice
// altro si chiede: «Vale lo studio» annulla il cambiamento, «Resta il
// nostro» lo lascia aperto (va scritto allo studio). Le assenze lunghe non
// compaiono in nessun documento letto qui: si confermano a mano.
//
// Alla fine, come per ogni caricamento: «Finito» se non resta niente,
// altrimenti cosa resta.

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from './Toast';
import { supabase } from '../lib/supabase';
import {
  confrontoEvento, confrontaConCedolini, descriviEvento, formattaDataBreve, nomePersona,
  ETICHETTE_TIPO_EVENTO, type EventoOrganico,
} from '../lib/organico';
import { nomeNegozio, puoTenereOrganico, type DatiOrganico } from '../lib/organicoDati';

type Props = { companyId: string; dati: DatiOrganico | null; onCambiato: () => void };

const MESI = ['', 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export default function ConfrontoStudio({ companyId, dati, onCambiato }: Props) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const puoScrivere = puoTenereOrganico(profile?.role);
  const [cedolini, setCedolini] = useState<{ employee_id: string; year: number; month: number }[] | null>(null);
  const [lavoro, setLavoro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    supabase.from('employee_cost_slips').select('employee_id, year, month')
      .eq('company_id', companyId).eq('tipo', 'normale')
      .then(({ data }) => { if (vivo) setCedolini(((data as { employee_id: string; year: number; month: number }[]) ?? []).filter((c) => c.employee_id)); });
    return () => { vivo = false; };
  }, [companyId]);

  const ultimoMese = useMemo(() => {
    if (!cedolini?.length) return null;
    const k = Math.max(...cedolini.map((c) => c.year * 100 + c.month));
    return { anno: Math.floor(k / 100), mese: k % 100 };
  }, [cedolini]);

  const schedaDi = (id: string) => dati?.schede.find((s) => s.id === id);
  const negozio = (id: string) => nomeNegozio(dati?.negozi.find((n) => n.id === id));

  const righe = useMemo(() => {
    if (!dati) return [];
    return dati.eventi
      .filter((e) => e.stato === 'da_confermare')
      .map((e) => {
        const s = schedaDi(e.employee_id);
        const inizio = Number(e.data_dal.slice(0, 4)) * 100 + Number(e.data_dal.slice(5, 7));
        const haCedolino = !!cedolini?.some((c) => c.employee_id === e.employee_id && c.year * 100 + c.month >= inizio);
        return { e, s, c: s ? confrontoEvento(e, s, haCedolino, negozio) : null };
      })
      .sort((a, b) => (a.c?.esito === 'diverso' ? 0 : 1) - (b.c?.esito === 'diverso' ? 0 : 1) || a.e.data_dal.localeCompare(b.e.data_dal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dati, cedolini]);

  const anomalie = useMemo(() => {
    if (!dati || !cedolini || !ultimoMese) return [];
    const pagati = new Set(cedolini.filter((c) => c.year === ultimoMese.anno && c.month === ultimoMese.mese).map((c) => c.employee_id));
    return confrontaConCedolini(dati.schede, dati.eventi, pagati, ultimoMese.anno, ultimoMese.mese);
  }, [dati, cedolini, ultimoMese]);

  const confermati = useMemo(() => (dati?.eventi ?? [])
    .filter((e) => e.stato === 'confermato')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, 8), [dati]);

  const esito = async (e: EventoOrganico, stato: 'confermato' | 'annullato', nota: string) => {
    setLavoro(e.id);
    const { error } = await supabase.from('employee_events').update({ stato, esito_nota: nota }).eq('id', e.id);
    setLavoro(null);
    if (error) { toast({ type: 'error', message: error.message }); return; }
    toast({ type: 'success', message: stato === 'confermato' ? 'Segnato come confermato.' : 'Cambiamento annullato: vale il dato dello studio.' });
    onCambiato();
  };

  if (!dati || !cedolini) return <div className="text-slate-400 py-12 text-center">Caricamento…</div>;

  const diversi = righe.filter((r) => r.c?.esito === 'diverso').length;
  const daFare = righe.length + anomalie.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-xs text-slate-500">Cambiamenti confermati di recente</div><div className="text-2xl font-semibold text-emerald-700 tabular-nums">{confermati.length}</div></div>
        <div className={`rounded-xl p-4 border ${diversi ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}><div className={`text-xs ${diversi ? 'text-amber-900' : 'text-slate-500'}`}>Diversi dallo studio: da decidere</div><div className={`text-2xl font-semibold tabular-nums ${diversi ? 'text-amber-900' : ''}`}>{diversi}</div></div>
        <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-xs text-slate-500">Nostri, lo studio non li riporta ancora</div><div className="text-2xl font-semibold tabular-nums">{righe.length - diversi}</div></div>
        <div className="bg-white border border-slate-200 rounded-xl p-4"><div className="text-xs text-slate-500">Cedolini {ultimoMese ? `di ${MESI[ultimoMese.mese]}` : ''} diversi dall'organico</div><div className="text-2xl font-semibold tabular-nums">{anomalie.length}</div></div>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <h3 className="px-4 pt-4 text-sm font-semibold text-slate-800">Cambiamenti da confermare</h3>
        <table className="w-full text-sm min-w-[820px] mt-2">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2 font-semibold">Persona</th>
              <th className="px-4 py-2 font-semibold">Segnato in azienda</th>
              <th className="px-4 py-2 font-semibold">Dice lo studio</th>
              <th className="px-4 py-2 font-semibold">Esito</th>
              <th className="px-4 py-2"><span className="sr-only">Azioni</span></th>
            </tr>
          </thead>
          <tbody>
            {righe.map(({ e, s, c }) => (
              <tr key={e.id} className="border-b border-slate-100 align-top">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{s ? nomePersona(s) : '—'}</div>
                  <div className="text-xs text-slate-500">{s?.outlet_id ? negozio(s.outlet_id) : ''}</div>
                </td>
                <td className="px-4 py-2.5">
                  <div>{descriviEvento(e, negozio)}</div>
                  <div className="text-xs text-slate-500">{ETICHETTE_TIPO_EVENTO[e.tipo]}{e.created_by_nome ? ` · da ${e.created_by_nome}` : ''}{e.created_at ? ` il ${formattaDataBreve(e.created_at)}` : ''}</div>
                  {e.nota && <div className="text-xs text-slate-500 italic">{e.nota}</div>}
                </td>
                <td className="px-4 py-2.5 text-slate-700">{c?.studio ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {c?.esito === 'diverso' && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900">Diverso</span>}
                  {c?.esito === 'non_riportato' && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-800 inline-flex items-center gap-1"><Clock size={12} /> In attesa dello studio</span>}
                  {c?.esito === 'non_verificabile' && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">Da confermare a mano</span>}
                  {c?.esito === 'uguale' && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800">Uguale</span>}
                </td>
                <td className="px-4 py-2.5">
                  {puoScrivere && (
                    <div className="flex flex-wrap gap-1.5 justify-end">
                      {(c?.esito === 'non_verificabile' || c?.esito === 'uguale' || c?.esito === 'non_riportato') && (
                        <button type="button" disabled={lavoro === e.id} onClick={() => esito(e, 'confermato', 'Confermato a mano: lo studio lo ha registrato.')}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">Lo studio l'ha registrato</button>
                      )}
                      {c?.esito === 'diverso' && (
                        <>
                          <button type="button" disabled={lavoro === e.id} onClick={() => esito(e, 'annullato', `Vale il dato dello studio: ${c.studio}.`)}
                            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-50">Vale lo studio</button>
                          <span className="text-xs text-slate-500 self-center">oppure scrivi allo studio</span>
                        </>
                      )}
                      <button type="button" disabled={lavoro === e.id} onClick={() => esito(e, 'annullato', 'Annullato: era un errore.')}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50">Era un errore</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!righe.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Nessun cambiamento in attesa.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-800">
          Cedolini {ultimoMese ? `di ${MESI[ultimoMese.mese]} ${ultimoMese.anno}` : ''} e organico
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">Chi entra o esce durante il mese non compare: è normale che abbia o non abbia la busta. Gli assenti per un periodo non sono un'anomalia.</p>
        {!ultimoMese ? (
          <p className="text-sm text-slate-500 mt-3">Nessun cedolino caricato.</p>
        ) : anomalie.length === 0 ? (
          <p className="text-sm text-emerald-700 mt-3 flex items-center gap-1.5"><CheckCircle2 size={15} /> Chi è stato pagato è nell'organico, e chi è nell'organico è stato pagato.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {anomalie.map((a) => (
              <li key={a.persona.scheda.id} className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
                <span><strong>{nomePersona(a.persona.scheda)}</strong> {a.testo}.{' '}
                  <span className="text-slate-500">{a.tipo === 'pagata_fuori_organico'
                    ? 'Se lavora, aggiungila all’organico; se non lavora più, va segnata l’uscita.'
                    : 'Se è assente per un periodo (maternità, malattia lunga) segnalo; altrimenti chiedi allo studio.'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div role="status" className={`rounded-xl p-4 border text-sm ${daFare === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
        {daFare === 0
          ? <strong>Finito: l'organico è allineato con i documenti dello studio.</strong>
          : <><strong>Restano {daFare} cose da chiarire</strong>: {righe.length} cambiamenti in attesa dello studio{diversi ? ` (${diversi} diversi da decidere)` : ''} e {anomalie.length} differenze fra cedolini e organico.</>}
      </div>
    </div>
  );
}
