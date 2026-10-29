// Esegue su `shifts` le scritture di una mossa (spostaTurni.ts). Comune al
// piano del mese e al piano settimanale (Patrizio, 29/10/2026).

import { supabase } from './supabase';
import { scrittureMossa, type MossaTurno, type TurnoRiga } from './spostaTurni';

export async function eseguiMossaSuShifts(args: {
  companyId: string; outletId: string; turni: TurnoRiga[];
  /** il piano del mese a cui appartiene un giorno (nella settimana a cavallo dei mesi puo' cambiare) */
  planDi: (data: string) => string | null;
  mossa: MossaTurno; turno: TurnoRiga; versoId: string; versoData: string;
  ore?: { inizio: string; fine: string; pausa_minuti: number };
}): Promise<void> {
  const s = scrittureMossa({ turni: args.turni }, args.mossa, args.turno, args.versoId, args.versoData, args.ore);
  if (s.inserisci) {
    const { error } = await supabase.from('shifts').insert([{ ...s.inserisci, company_id: args.companyId, outlet_id: args.outletId, plan_id: args.planDi(String(s.inserisci.data)) } as never]);
    if (error) throw error;
  }
  for (const a of s.aggiorna) {
    const valori = { ...a.valori, plan_id: args.planDi(String(a.valori.data)) };
    const { error } = await supabase.from('shifts').update(valori as never).eq('id', a.id);
    if (error) throw error;
  }
  if (s.togli) {
    // il turno sostituito: si toglie se non pubblicato, altrimenti si annulla e resta nello storico
    const { error } = s.togli.pubblicato
      ? await supabase.from('shifts').update({ stato: 'annullato', annullato_motivo: 'Sostituito dal calendario' }).eq('id', s.togli.id)
      : await supabase.from('shifts').delete().eq('id', s.togli.id);
    if (error) throw error;
  }
}
