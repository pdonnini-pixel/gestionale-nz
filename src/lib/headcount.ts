// ============================================================================
// ORGANICO GRANITICO — fonte unica del numero di dipendenti.
// ============================================================================
// Regola (audit AUDIT_PERSONALE_2026-09-02.md, sezione 1):
//
//   L'organico di un outlet in un mese è l'insieme delle PERSONE che hanno un
//   cedolino caricato per quel mese. Non l'anagrafica, non il numero di
//   allocazioni, non `employees.outlet_id`. Se a luglio arrivano 5 cedolini
//   dove a giugno ne arrivavano 6, da luglio quell'outlet ha 5 persone.
//
// Conseguenze implementate qui:
//  - conta solo le righe con `netto` valorizzato (il carico dei netti è ciò che
//    "granisce" il mese);
//  - esclude gli amministratori: hanno una sezione dedicata e non sono addetti;
//  - NON filtra `is_active`: chi è stato pagato a marzo era in forza a marzo,
//    anche se cessa a maggio. La cessazione non riscrive il passato;
//  - deduplica per PERSONA (codice fiscale, altrimenti cognome+nome): la stessa
//    persona con due matricole è una testa sola;
//  - un mese senza cedolini non vale zero: vale "non ancora caricato", e chi
//    chiama usa `resolvePeriod` per ricadere sull'ultimo mese granito.
//
// Funzioni pure: nessuna query, nessun accesso a Supabase. Test in headcount.test.ts.

export interface HeadcountEmployee {
  id: string;
  role_description?: string | null;
  codice_fiscale?: string | null;
  fiscal_code?: string | null;
  nome?: string | null;
  cognome?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface HeadcountCost {
  employee_id: string | null;
  year: number;
  month: number;
  netto?: number | null;
}

export interface HeadcountAllocation {
  employee_id: string | null;
  outlet_code: string | null;
}

export interface Period {
  year: number;
  month: number;
}

/** Periodo effettivamente usato + stato del dato, per l'etichetta in UI. */
export interface ResolvedPeriod {
  /** Periodo da cui leggere i numeri (può essere diverso da quello richiesto). */
  period: Period | null;
  /** true = il mese richiesto ha cedolini propri. */
  isGranited: boolean;
  /** Periodo richiesto, riportato per l'etichetta "nessun cedolino per …". */
  requested: Period;
}

/** Amministratore: escluso dall'organico (voce separata, non è un addetto). */
export const isAdminEmployee = (e: Pick<HeadcountEmployee, 'role_description'>): boolean =>
  /amministrat/i.test(e.role_description || '');

/**
 * Chiave di identità della PERSONA: codice fiscale se c'è, altrimenti
 * cognome+nome normalizzati, altrimenti l'id. Serve a non contare due volte
 * chi ha più matricole.
 */
export function personKey(e: HeadcountEmployee | undefined, fallbackId?: string | null): string {
  if (!e) return fallbackId ? `id:${fallbackId}` : '';
  const cf = (e.codice_fiscale || e.fiscal_code || '').trim().toLowerCase();
  if (cf) return `cf:${cf}`;
  const cognome = (e.cognome || e.last_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const nome = (e.nome || e.first_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const name = `${cognome} ${nome}`.trim();
  return name ? `nm:${name}` : `id:${e.id}`;
}

const byId = (employees: HeadcountEmployee[]): Record<string, HeadcountEmployee> => {
  const m: Record<string, HeadcountEmployee> = {};
  employees.forEach((e) => { m[e.id] = e; });
  return m;
};

const isGranitedRow = (c: HeadcountCost): boolean => c.netto != null && c.employee_id != null;

/** Mesi con almeno un cedolino, dal più recente. Opzionalmente entro un anno. */
export function granitedPeriods(costs: HeadcountCost[], year?: number): Period[] {
  const seen = new Set<string>();
  const out: Period[] = [];
  for (const c of costs) {
    if (!isGranitedRow(c)) continue;
    if (year != null && c.year !== year) continue;
    const k = `${c.year}-${c.month}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ year: c.year, month: c.month });
  }
  return out.sort((a, b) => b.year - a.year || b.month - a.month);
}

/** Ultimo mese con cedolini caricati (il "mese granito"). null se non ce ne sono. */
export function lastGranitedPeriod(costs: HeadcountCost[], year?: number): Period | null {
  return granitedPeriods(costs, year)[0] || null;
}

/**
 * Periodo da usare: quello richiesto se ha cedolini, altrimenti l'ultimo mese
 * granito (prima dentro l'anno richiesto, poi in assoluto). La UI mostra
 * l'etichetta «al mese X» quando `isGranited` è false.
 */
export function resolvePeriod(costs: HeadcountCost[], requested: Period): ResolvedPeriod {
  const hasOwn = costs.some((c) => isGranitedRow(c) && c.year === requested.year && c.month === requested.month);
  if (hasOwn) return { period: requested, isGranited: true, requested };
  const fallback = lastGranitedPeriod(costs, requested.year) || lastGranitedPeriod(costs);
  return { period: fallback, isGranited: false, requested };
}

/** employee_id con cedolino nel mese (amministratori esclusi). */
export function paidEmployeeIds(
  costs: HeadcountCost[],
  employees: HeadcountEmployee[],
  period: Period | null,
): Set<string> {
  const out = new Set<string>();
  if (!period) return out;
  const map = byId(employees);
  for (const c of costs) {
    if (!isGranitedRow(c) || c.year !== period.year || c.month !== period.month) continue;
    const e = map[c.employee_id as string];
    if (e && isAdminEmployee(e)) continue;
    out.add(c.employee_id as string);
  }
  return out;
}

/** Organico aziendale del mese: PERSONE distinte con cedolino, admin esclusi. */
export function companyHeadcount(
  costs: HeadcountCost[],
  employees: HeadcountEmployee[],
  period: Period | null,
): number {
  const map = byId(employees);
  const persons = new Set<string>();
  paidEmployeeIds(costs, employees, period).forEach((id) => persons.add(personKey(map[id], id)));
  return persons.size;
}

/**
 * Organico per outlet nel mese: chiave = outlet_code delle allocazioni,
 * valore = insieme delle persone. Chi è allocato su più outlet conta in
 * ciascuno (ma una sola volta nel totale aziendale).
 */
export function headcountByOutlet(
  costs: HeadcountCost[],
  employees: HeadcountEmployee[],
  allocations: HeadcountAllocation[],
  period: Period | null,
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  const paid = paidEmployeeIds(costs, employees, period);
  if (paid.size === 0) return out;
  const map = byId(employees);
  for (const a of allocations) {
    if (!a.employee_id || !a.outlet_code || !paid.has(a.employee_id)) continue;
    (out[a.outlet_code] ||= new Set()).add(personKey(map[a.employee_id], a.employee_id));
  }
  return out;
}

/** Conteggio per outlet, pronto da usare come numero. */
export function headcountCountByOutlet(
  costs: HeadcountCost[],
  employees: HeadcountEmployee[],
  allocations: HeadcountAllocation[],
  period: Period | null,
): Record<string, number> {
  const sets = headcountByOutlet(costs, employees, allocations, period);
  const out: Record<string, number> = {};
  Object.entries(sets).forEach(([k, v]) => { out[k] = v.size; });
  return out;
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/** Etichetta discorsiva del periodo, per i badge: "marzo 2026". */
export const periodLabel = (p: Period | null): string =>
  p ? `${MESI[p.month - 1] || p.month} ${p.year}` : '—';
