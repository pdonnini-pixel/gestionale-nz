/**
 * Codice del centro di costo dal nome dell'outlet: minuscolo, senza accenti,
 * spazi e simboli sostituiti da `_` («ROMA SORATTE» → «roma_soratte»,
 * «SEDE / MAGAZZINO» → «sede_magazzino»).
 *
 * È la convenzione di tutta la catena contabile: `cost_centers.code`,
 * `outlets.cost_center_key`, `budget_entries.cost_center`,
 * `chart_of_accounts.outlet_link` (migration 20260610_062:
 * cost_center_key = lower(name)). Il form dei centri di costo in Impostazioni
 * forzava il MAIUSCOLO, creando codici che non combaciavano con nulla.
 */
export function slugCostCenter(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}
