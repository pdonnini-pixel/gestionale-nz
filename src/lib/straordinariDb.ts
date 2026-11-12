// Lo straordinario «giorno forte» riscritto dopo una modifica a mano ai turni
// (Patrizio, 12/11/2026). Comune al piano settimanale e al piano del mese.

import { supabase } from './supabase';
import { straordinariDaRiscrivere, type TurnoSalvato } from './ottimizzaTurni';

/**
 * Rilegge i turni salvati di una settimana (o del pezzo a video), ricalcola lo
 * straordinario dei giorni forti e riscrive solo i turni il cui valore cambia.
 * Non tocca lo straordinario segnato per ricarico o allestimento. Dove manca la
 * colonna del motivo (migration 399) non fa niente: li' i giorni caldi non ci sono.
 * Restituisce quanti turni ha riscritto.
 */
export async function riallineaStraordinariForti(args: {
  companyId: string; outletId: string;
  /** le date della settimana a video */
  date: string[];
  /** il piano del mese a cui appartiene un giorno: valgono solo i turni di quel piano (null = turni senza piano) */
  planDi: (data: string) => string | null;
  /** ore di contratto della settimana per persona, gia' tolte ferie, trasferte e ore dell'altro mese */
  contratto: Map<string, number>;
  giorniForti: Set<string>;
}): Promise<number> {
  if (!args.date.length || !args.giorniForti.size || !args.contratto.size) return 0;
  const { data, error } = await supabase.from('shifts')
    .select('id, employee_id, data, inizio, fine, pausa_minuti, stato, plan_id, ore_straordinario, straordinario_motivo' as never)
    .eq('company_id', args.companyId).eq('outlet_id', args.outletId).in('data', args.date).neq('stato', 'annullato');
  if (error) return 0;
  const righe = (data as unknown as { id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null; plan_id: string | null; ore_straordinario: number | null; straordinario_motivo: string | null }[]) ?? [];
  const turni: TurnoSalvato[] = righe
    .filter((x) => (x.plan_id ?? null) === (args.planDi(x.data) ?? null))
    .map((x) => ({ id: x.id, employeeId: x.employee_id, data: x.data, inizio: x.inizio.slice(0, 5), fine: x.fine.slice(0, 5), pausaMinuti: x.pausa_minuti ?? 0, oreStraordinario: Number(x.ore_straordinario ?? 0), motivo: x.straordinario_motivo }));
  const cambi = straordinariDaRiscrivere(turni, args.contratto, args.giorniForti);
  for (const c of cambi) {
    const { error: e } = await supabase.from('shifts')
      .update({ straordinario: c.ore > 0, ore_straordinario: c.ore, straordinario_motivo: c.ore > 0 ? 'giorno_forte' : null } as never).eq('id', c.id);
    if (e) throw e;
  }
  return cambi.length;
}
