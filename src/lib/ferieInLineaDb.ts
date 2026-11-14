// Letture e scritture per le ferie «in linea con il mese» (Patrizio, 14/11/2026, migration 410).
// Le proposte del piano sono richieste in bozza con origine 'piano_mese' e il piano che le ha
// generate: non scalano il saldo, il dipendente non le vede nell'app, e diventano vere solo con
// ferie_proposta_approva (che passa da leave_decidi: scala di chi decide; il lunedì lo controllano i trigger sui giorni).
// Una richiesta per persona e per giorno, così ogni proposta si approva, si sposta o si toglie da sola.
// Dove la 410 non c'è (tenant senza migration) `ha410` è falso e non si propone niente.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { PropostaFerie, RateoPersona, VoceFerie } from './ferieInLinea';

const db = supabase as unknown as SupabaseClient;

const ultimoDelMese = (anno: number, mese: number) => `${anno}-${String(mese).padStart(2, '0')}-${String(new Date(Date.UTC(anno, mese, 0)).getUTCDate()).padStart(2, '0')}`;

type RigaRateo = {
  employee_id: string | null; voce: string; rateo_annuo: number | null; residuo: number | null;
  data_assunzione: string | null; data_cessazione: string | null;
  leave_accrual_imports: { periodo_anno: number; periodo_mese: number; attivo: boolean } | { periodo_anno: number; periodo_mese: number; attivo: boolean }[];
};

/** Fra le righe del tabulato di una persona e una voce tiene la più recente; a parità di mese, il contratto ancora aperto. */
export function rateiPiuRecenti(righe: {
  employeeId: string; voce: VoceFerie; rateoAnnuo: number | null; residuo: number | null; anno: number; mese: number;
  assunzione: string | null; cessazione: string | null;
}[]): RateoPersona[] {
  const migliori = new Map<string, (typeof righe)[number]>();
  for (const r of righe) {
    const k = `${r.employeeId}|${r.voce}`;
    const m = migliori.get(k);
    const piuRecente = !m || r.anno * 12 + r.mese > m.anno * 12 + m.mese;
    const stessoMese = !!m && r.anno === m.anno && r.mese === m.mese;
    // stesso tabulato, due contratti: vale quello ancora aperto, poi quello cominciato dopo
    const meglio = stessoMese && ((!r.cessazione && !!m.cessazione) || ((!!r.cessazione === !!m.cessazione) && (r.assunzione ?? '') > (m.assunzione ?? '')));
    if (piuRecente || meglio) migliori.set(k, r);
  }
  return [...migliori.values()].map((r) => ({
    employeeId: r.employeeId, voce: r.voce, rateoAnnuo: r.rateoAnnuo, residuo: r.residuo, saldoAllaData: ultimoDelMese(r.anno, r.mese),
  }));
}

/** I ratei dell'ultimo tabulato delle paghe, per persona e voce. `disponibile` falso = non si leggono (niente proposte). */
export async function caricaRatei(companyId: string): Promise<{ disponibile: boolean; ratei: RateoPersona[] }> {
  const { data, error } = await db.from('leave_accrual_rows')
    .select('employee_id, voce, rateo_annuo, residuo, data_assunzione, data_cessazione, leave_accrual_imports!inner(periodo_anno, periodo_mese, attivo)')
    .eq('company_id', companyId).eq('leave_accrual_imports.attivo', true).not('employee_id', 'is', null);
  if (error) return { disponibile: false, ratei: [] };
  const righe = ((data as unknown as RigaRateo[]) ?? []).flatMap((x) => {
    const imp = Array.isArray(x.leave_accrual_imports) ? x.leave_accrual_imports[0] : x.leave_accrual_imports;
    if (!x.employee_id || !imp || !['F01', 'F02', 'F03'].includes(x.voce)) return [];
    return [{
      employeeId: x.employee_id, voce: x.voce as VoceFerie, rateoAnnuo: x.rateo_annuo == null ? null : Number(x.rateo_annuo),
      residuo: x.residuo == null ? null : Number(x.residuo), anno: imp.periodo_anno, mese: imp.periodo_mese,
      assunzione: x.data_assunzione, cessazione: x.data_cessazione,
    }];
  });
  return { disponibile: true, ratei: rateiPiuRecenti(righe) };
}

export interface GiornoFerieDb {
  id: string; request_id: string; employee_id: string; data: string; voce: VoceFerie; ore: number; tipo: string;
  stato_richiesta: string; stato_giorno: string; origine: string | null; plan_id: string | null; creato_il: string;
}

/**
 * I giorni di ferie e permesso con la voce, l'origine e il piano che li ha proposti. Sono tutte
 * le richieste: dall'app, dal gestionale, dai moduli e le proposte del piano. `ha410` falso =
 * la colonna del piano manca: si leggono lo stesso i giorni, ma non ci sono proposte.
 */
export async function caricaGiorniConVoce(companyId: string, dal: string, al: string): Promise<{ ha410: boolean; giorni: GiornoFerieDb[] }> {
  type Riga = {
    id: string; request_id: string; data: string; ore: number; tipo: string; voce: string; stato: string; created_at: string;
    leave_requests: { employee_id: string; stato: string; origine?: string | null; plan_id?: string | null } | { employee_id: string; stato: string; origine?: string | null; plan_id?: string | null }[];
  };
  const leggi = (campi: string) => db.from('leave_request_days')
    .select(`id, request_id, data, ore, tipo, voce, stato, created_at, leave_requests!inner(${campi})`)
    .eq('company_id', companyId).gte('data', dal).lte('data', al);
  let ha410 = true;
  let r = await leggi('employee_id, stato, origine, plan_id');
  if (r.error) { ha410 = false; r = await leggi('employee_id, stato, origine'); }
  if (r.error) throw r.error;
  const giorni = ((r.data as unknown as Riga[]) ?? []).flatMap((d) => {
    const q = Array.isArray(d.leave_requests) ? d.leave_requests[0] : d.leave_requests;
    if (!q?.employee_id) return [];
    return [{
      id: d.id, request_id: d.request_id, employee_id: q.employee_id, data: d.data, voce: d.voce as VoceFerie, ore: Number(d.ore), tipo: d.tipo,
      stato_richiesta: q.stato, stato_giorno: d.stato, origine: q.origine ?? null, plan_id: q.plan_id ?? null, creato_il: d.created_at,
    }];
  });
  return { ha410, giorni };
}

/** Una proposta del piano ancora da decidere: bozza con origine piano_mese. */
export const eProposta = (g: { stato_richiesta: string; origine: string | null }): boolean => g.stato_richiesta === 'bozza' && g.origine === 'piano_mese';

/** Salva le proposte del piano: una richiesta in bozza per persona e per giorno. */
export async function salvaProposte(args: {
  companyId: string; planId: string; outletCode: string | null; titolo: string; proposte: PropostaFerie[]; utenteId: string | null; utenteNome: string | null;
}): Promise<void> {
  const gruppi = new Map<string, PropostaFerie[]>();
  for (const p of args.proposte) gruppi.set(`${p.employeeId}|${p.data}`, [...(gruppi.get(`${p.employeeId}|${p.data}`) ?? []), p]);
  for (const gruppo of gruppi.values()) {
    const { data, error } = await db.from('leave_requests').insert({
      company_id: args.companyId, employee_id: gruppo[0].employeeId, outlet_code: args.outletCode, stato: 'bozza', origine: 'piano_mese',
      plan_id: args.planId, titolo: args.titolo, compilata_da: args.utenteId, compilata_da_nome: args.utenteNome,
    }).select('id').single();
    if (error) throw error;
    const { error: e2 } = await db.from('leave_request_days').insert(gruppo.map((p) => ({
      company_id: args.companyId, request_id: (data as { id: string }).id, data: p.data, voce: p.voce, tipo: p.tipo, ore: p.ore, nota: 'Proposta del piano del mese',
    })));
    if (e2) throw e2;
  }
}

/** Toglie le proposte del piano ancora da decidere (bozze). Quelle già approvate sono ferie vere e restano. */
export async function togliProposteDelPiano(planId: string): Promise<void> {
  const { error } = await db.from('leave_requests').delete().eq('plan_id', planId).eq('origine', 'piano_mese').eq('stato', 'bozza');
  if (error) throw error;
}

/** Toglie una proposta (la bozza intera: è di una persona e di un giorno). */
export async function togliProposta(requestId: string): Promise<void> {
  const { error } = await db.from('leave_requests').delete().eq('id', requestId).eq('origine', 'piano_mese').eq('stato', 'bozza');
  if (error) throw error;
}

/** Sposta una proposta a un altro giorno. */
export async function spostaProposta(requestId: string, nuovaData: string): Promise<void> {
  const { error } = await db.from('leave_request_days').update({ data: nuovaData }).eq('request_id', requestId);
  if (error) throw error;
}

/** Approva una proposta: diventa una richiesta vera, decisa con la scala di chi può decidere. */
export async function approvaProposta(requestId: string): Promise<void> {
  const { error } = await db.rpc('ferie_proposta_approva', { p_request_id: requestId });
  if (error) throw error;
}
