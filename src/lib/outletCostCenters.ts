// Distingue i cost_center di budget_entries che corrispondono a un PUNTO VENDITA
// reale (anagrafica outlets del tenant) dagli aggregati "virtuali" usati per far
// quadrare il bilancio ma che NON sono punti vendita: es. costi non divisi,
// rettifiche di bilancio, sede/magazzino, riga aggregata "all".
//
// Perche' serve: pagine come Margini per Outlet, Produttivita e Scenario Planning
// aggregano budget_entries per cost_center. Se non si escludono i cost_center
// virtuali, questi appaiono come falsi punti vendita: ricavi=0 e costi>0 generano
// falsi "margini critici", falsano le medie (fatturato medio/outlet, ricavi medi)
// e gonfiano il conteggio degli outlet.
//
// TENANT-SAFE: nessun valore hardcoded. La "verita'" e' l'anagrafica outlets del
// tenant attivo; un cost_center e' un outlet solo se combacia con il code o il name
// di un outlet reale. (I cost_center virtuali variano per tenant: su NZ sono
// 'all', 'rettifica_bilancio', 'sede_magazzino' — non vanno mai hardcodati.)

export interface OutletRef {
  code?: string | null
  name?: string | null
}

/** Costruisce l'insieme degli identificativi validi (code + name, normalizzati) degli outlet reali. */
export function buildOutletCostCenterSet(outlets: OutletRef[]): Set<string> {
  const set = new Set<string>()
  for (const o of outlets || []) {
    if (o.code) set.add(String(o.code).trim().toLowerCase())
    if (o.name) set.add(String(o.name).trim().toLowerCase())
  }
  return set
}

/** True se il cost_center corrisponde a un outlet reale dell'anagrafica. */
export function isOutletCostCenter(costCenter: string | null | undefined, validSet: Set<string>): boolean {
  if (!costCenter) return false
  return validSet.has(String(costCenter).trim().toLowerCase())
}
