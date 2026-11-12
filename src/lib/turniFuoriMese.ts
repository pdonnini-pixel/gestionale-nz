// Quali turni dei giorni dell'altro mese contano in una settimana a cavallo (12/11/2026).
//
// Il piano del mese e il piano settimanale tolgono dalla settimana le ore e i giorni gia'
// lavorati nei giorni dell'altro mese: da li' vengono il contratto che resta e il riposo di
// legge. Fino al 12/11/2026 delle bozze contavano solo quelle del piano «scelto»: a Roma
// Soratte il piano di dicembre e' stato creato un minuto prima che quello di novembre fosse
// scelto, e contava i turni settimanali vecchi invece di quelli del piano appena fatto.
//
// La regola, per ogni negozio e mese (la stessa della vista del piano settimanale):
//  - c'e' un piano scelto: valgono i suoi turni, e solo i suoi (quelli settimanali del mese
//    non si vedono piu');
//  - non c'e': valgono i turni senza piano (settimanali, a mano, pubblicati); se in quei
//    giorni non ce ne sono, valgono quelli del piano vero piu' recente, anche se in bozza.
// Le simulazioni non contano mai.

export interface PianoDelMese {
  id: string;
  outlet_id: string;
  /** primo giorno del mese, 'YYYY-MM-01' */
  mese: string;
  stato: string;
  simulazione?: boolean | null;
  created_at?: string | null;
}

export interface TurnoConPiano {
  data: string;
  plan_id: string | null;
  outlet_id: string;
}

export function turniCheValgono<T extends TurnoConPiano>(righe: T[], piani: PianoDelMese[]): T[] {
  const veri = piani.filter((p) => !p.simulazione);
  const chiave = (outlet: string, mese: string) => `${outlet}|${mese.slice(0, 7)}`;
  const scelto = new Map<string, string>();
  const recente = new Map<string, PianoDelMese>();
  for (const p of veri) {
    const k = chiave(p.outlet_id, p.mese);
    if (p.stato === 'scelto') scelto.set(k, p.id);
    const r = recente.get(k);
    if (!r || String(p.created_at ?? '') > String(r.created_at ?? '')) recente.set(k, p);
  }
  const senzaPiano = new Set(righe.filter((x) => !x.plan_id).map((x) => chiave(x.outlet_id, x.data)));
  return righe.filter((x) => {
    const k = chiave(x.outlet_id, x.data);
    const s = scelto.get(k);
    if (s) return x.plan_id === s;
    if (!x.plan_id) return true;
    return !senzaPiano.has(k) && recente.get(k)?.id === x.plan_id;
  });
}
