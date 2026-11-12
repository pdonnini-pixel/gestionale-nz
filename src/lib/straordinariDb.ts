// Lo straordinario «giorno forte» riscritto dopo una modifica a mano ai turni
// (Patrizio, 12/11/2026). Comune al piano settimanale e al piano del mese.
//
// Regole (revisori, 12/11/2026):
//  * uno straordinario scritto a mano non si sovrascrive mai (`shifts.straordinario_a_mano`);
//  * si ricalcola solo per le persone toccate dalla modifica, nella loro settimana;
//  * i turni di un mese chiuso non si riscrivono;
//  * dove la colonna `straordinario_a_mano` non c'e' (prima della 408) non si ricalcola affatto;
//  * un errore vero si dice: mai un ricalcolo a meta' passato sotto silenzio.

import { supabase } from './supabase';
import { ricalcoloStraordinari, type TurnoSalvato } from './ottimizzaTurni';

/** La riga di `shifts` che serve al ricalcolo. */
export type RigaStraordinario = {
  id: string; employee_id: string; data: string; inizio: string; fine: string; pausa_minuti: number | null;
  plan_id: string | null; ore_straordinario: number | null; straordinario_motivo: string | null; straordinario_a_mano: boolean | null;
};

/** Com'e' andato il ricalcolo. */
export type EsitoStraordinari = {
  /** quanti turni ha riscritto */
  riscritti: number;
  /** la colonna «scritto a mano» non c'e': non ha ricalcolato niente */
  saltato: boolean;
  /** persone a cui, per i turni di un mese chiuso, lo straordinario scritto non corrisponde alle ore oltre il contratto */
  nonTorna: string[];
};

/** Il ricalcolo non e' arrivato in fondo: lo straordinario non e' aggiornato per tutte. */
export class StraordinariNonAggiornati extends Error {
  constructor(public riscritti: number, public falliti: number, dettaglio: string) {
    super(`Lo straordinario dei giorni forti non è aggiornato per tutte (${falliti} ${falliti === 1 ? 'turno non scritto' : 'turni non scritti'}): ${dettaglio}. Si ricalcola al prossimo salvataggio.`);
    this.name = 'StraordinariNonAggiornati';
  }
}

const COLONNA_MANCANTE = ['42703', 'PGRST204'];
const meseDi = (data: string) => data.slice(0, 7);

/** Il contratto delle sole persone toccate dalla modifica: il ricalcolo non esce da li'. */
export function contrattoDi(contratto: Map<string, number>, persone: Iterable<string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of new Set(persone)) { const ore = contratto.get(id); if (ore != null) out.set(id, ore); }
  return out;
}

/** Le righe lette diventano turni per il ricalcolo; quelli di un mese chiuso restano fermi. */
export function turniPerRicalcolo(righe: RigaStraordinario[], planDi: (data: string) => string | null, mesiChiusi: Set<string>): TurnoSalvato[] {
  return righe
    .filter((x) => (x.plan_id ?? null) === (planDi(x.data) ?? null))
    .map((x) => ({
      id: x.id, employeeId: x.employee_id, data: x.data, inizio: x.inizio.slice(0, 5), fine: x.fine.slice(0, 5), pausaMinuti: x.pausa_minuti ?? 0,
      oreStraordinario: Number(x.ore_straordinario ?? 0), motivo: x.straordinario_motivo, aMano: x.straordinario_a_mano === true, bloccato: mesiChiusi.has(meseDi(x.data)),
    }));
}

/**
 * Rilegge i turni salvati della settimana (o del pezzo a video) delle persone toccate,
 * ricalcola lo straordinario dei giorni forti e riscrive solo i turni il cui valore cambia.
 * Non tocca lo straordinario scritto a mano, quello per ricarico o allestimento, i giorni
 * non forti e i turni di un mese chiuso. Sui turni pubblicati scrive lo stesso: il giorno
 * di pubblicazione lo conserva il trigger della 408 (`shifts.pubblicato_il`).
 *
 * Errori: colonna mancante = nessun ricalcolo, in silenzio (`saltato`); ogni altro errore
 * di lettura o di scrittura viene lanciato. Se una scrittura fallisce le altre si provano
 * lo stesso, poi si lancia `StraordinariNonAggiornati`.
 */
export async function riallineaStraordinariForti(args: {
  companyId: string; outletId: string;
  /** le date della settimana a video */
  date: string[];
  /** le sole persone toccate dalla modifica (in uno spostamento fra due persone, tutte e due) */
  persone: string[];
  /** il piano del mese a cui appartiene un giorno: valgono solo i turni di quel piano (null = turni senza piano) */
  planDi: (data: string) => string | null;
  /** ore di contratto della settimana per persona, gia' tolte ferie, trasferte e ore dell'altro mese */
  contratto: Map<string, number>;
  giorniForti: Set<string>;
}): Promise<EsitoStraordinari> {
  const niente: EsitoStraordinari = { riscritti: 0, saltato: false, nonTorna: [] };
  const contratto = contrattoDi(args.contratto, args.persone);
  if (!args.date.length || !args.giorniForti.size || !contratto.size) return niente;
  const { data, error } = await supabase.from('shifts')
    .select('id, employee_id, data, inizio, fine, pausa_minuti, plan_id, ore_straordinario, straordinario_motivo, straordinario_a_mano' as never)
    .eq('company_id', args.companyId).eq('outlet_id', args.outletId).in('data', args.date).in('employee_id', [...contratto.keys()]).neq('stato', 'annullato');
  if (error) {
    if (COLONNA_MANCANTE.includes((error as { code?: string }).code ?? '')) return { ...niente, saltato: true };
    throw new Error(`Non riesco a rileggere i turni per ricalcolare lo straordinario: ${error.message}`);
  }
  const righe = (data as unknown as RigaStraordinario[]) ?? [];

  // I mesi chiusi con lo stesso criterio della pagina e del trigger: li' un UPDATE fallisce.
  const mesiChiusi = new Set<string>();
  for (const mese of new Set(righe.map((x) => meseDi(x.data)))) {
    const { data: chiuso, error: e } = await supabase.rpc('turni_mese_chiuso', { p_company: args.companyId, p_data: `${mese}-01` });
    if (e) throw new Error(`Non riesco a sapere se ${mese} è un mese chiuso: ${e.message}`);
    if (chiuso === true) mesiChiusi.add(mese);
  }

  const { cambi, nonTorna } = ricalcoloStraordinari(turniPerRicalcolo(righe, args.planDi, mesiChiusi), contratto, args.giorniForti);
  let riscritti = 0;
  const falliti: string[] = [];
  for (const c of cambi) {
    const { error: e } = await supabase.from('shifts')
      .update({ straordinario: c.ore > 0, ore_straordinario: c.ore, straordinario_motivo: c.ore > 0 ? 'giorno_forte' : null, straordinario_a_mano: false } as never).eq('id', c.id);
    if (e) falliti.push(e.message); else riscritti++;
  }
  if (falliti.length) throw new StraordinariNonAggiornati(riscritti, falliti.length, falliti[0]);
  return { riscritti, saltato: false, nonTorna };
}

/** Il giorno di pubblicazione di un gruppo di turni pubblicati: `pubblicato_il` (408), altrimenti l'ultimo aggiornamento. */
export function giornoDiPubblicazione(turni: { pubblicato_il?: string | null; updated_at?: string | null }[]): string | null {
  const ultimo = turni.map((t) => t.pubblicato_il ?? t.updated_at ?? '').sort().pop();
  if (!ultimo) return null;
  const quando = new Date(ultimo);
  // il giorno in ora di Roma: una pubblicazione dopo mezzanotte non finisce sul giorno prima
  return Number.isNaN(quando.getTime()) ? ultimo.slice(0, 10) : quando.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
}
