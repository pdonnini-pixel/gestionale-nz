import { useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ETICHETTE_VOCE_BREVI, formattaData, type VoceFerie } from '../lib/ferieRichiesta';

type RigaVia = {
  data: string;
  employee_id: string;
  nominativo: string;
  voce: VoceFerie;
  ore: number;
  confermato: boolean;
};

type Props = {
  companyId: string | null;
  /** Punto vendita di cui guardare i colleghi. Senza, non si mostra niente. */
  outletId: string | null;
  outletNome?: string | null;
  /** La persona della richiesta in corso: non si conta come collega. */
  escludiEmployeeId?: string | null;
  /** I giorni da controllare, in formato YYYY-MM-DD. */
  giorni: string[];
  /** Compatto per il pannello di approvazione, esteso sotto il calendario. */
  compatto?: boolean;
};

/**
 * CHI ALTRO E' VIA, nello stesso punto vendita, nei giorni che si stanno
 * scegliendo o approvando.
 *
 * Il verbo conta: «via», non «assente» e non «presenti». Il gestionale sa
 * chi ha ferie o permessi, non sa chi e' di turno e non conosce malattie,
 * maternita' o infortuni. Contare i presenti sarebbe una promessa che non
 * possiamo mantenere; dire chi ha gia' chiesto quei giorni e' un fatto.
 *
 * Le bozze non compaiono, come non scalano il saldo: non sono ancora una
 * richiesta di nessuno.
 */
export default function SovrapposizioniOutlet({
  companyId, outletId, outletNome, escludiEmployeeId, giorni, compatto,
}: Props) {
  const [righe, setRighe] = useState<RigaVia[]>([]);
  const [caricamento, setCaricamento] = useState(false);

  const chiave = giorni.slice().sort().join(',');

  useEffect(() => {
    let vivo = true;
    const date = chiave ? chiave.split(',') : [];
    if (!companyId || !outletId || date.length === 0) { setRighe([]); return; }
    setCaricamento(true);
    void (async () => {
      const { data } = await supabase
        .from('v_leave_giorni_outlet')
        .select('data, employee_id, nominativo, voce, ore, confermato')
        .eq('company_id', companyId)
        .eq('outlet_id', outletId)
        .in('data', date);
      if (!vivo) return;
      setRighe(((data as RigaVia[]) ?? []).filter((r) => r.employee_id !== escludiEmployeeId));
      setCaricamento(false);
    })();
    return () => { vivo = false; };
  }, [companyId, outletId, escludiEmployeeId, chiave]);

  const perGiorno = useMemo(() => {
    const m = new Map<string, RigaVia[]>();
    for (const r of righe) {
      if (!m.has(r.data)) m.set(r.data, []);
      m.get(r.data)!.push(r);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [righe]);

  if (!outletId) {
    return (
      <p className="text-xs text-slate-500">
        Senza punto vendita non si possono vedere i colleghi. Assegnalo in Organico.
      </p>
    );
  }
  if (caricamento) return <p className="text-xs text-slate-400">Controllo i colleghi…</p>;
  if (!giorni.length) return null;

  if (!perGiorno.length) {
    return (
      <p className="text-xs text-slate-500">
        Nessun altro di {outletNome ?? 'questo punto vendita'} è via in questi giorni.
      </p>
    );
  }

  return (
    <div className={compatto ? 'space-y-1' : 'space-y-2'}>
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
        <Users size={14} className="text-amber-600" />
        Chi altro è già via a {outletNome ?? 'questo punto vendita'}
      </div>
      <ul className="space-y-1">
        {perGiorno.map(([data, lista]) => (
          <li key={data} className="text-xs text-slate-700">
            <span className="font-medium">{formattaData(data)}</span>
            {': '}
            {lista.map((r, i) => (
              <span key={`${r.employee_id}-${r.voce}`}>
                {i > 0 && ', '}
                {r.nominativo}
                <span className="text-slate-500">
                  {' ('}{ETICHETTE_VOCE_BREVI[r.voce]}
                  {r.confermato ? '' : ', da decidere'}
                  {')'}
                </span>
              </span>
            ))}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-slate-500">
        Sono ferie e permessi registrati qui dentro. Chi è di turno e le altre assenze
        (malattia, maternità) il gestionale non le conosce.
      </p>
    </div>
  );
}
