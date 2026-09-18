// Canone dell'outlet o costo ricorrente di locazione: mai tutti e due.
//
// Il Cashflow Prospettico ha due fonti per l'affitto, nate in momenti diversi:
// il canone della scheda outlet (`outlets.rent_monthly`, voce «Canoni») e i
// costi ricorrenti (`recurring_costs`, voce «Ricorrenti»). Nessuna delle due
// guardava l'altra, quindi un outlet con il canone scritto in tutti e due i
// posti lo portava in cassa due volte: è successo con Roma Soratte, dove la
// scheda e la ricorrenza dicono entrambe 6.533,33 € al mese.
//
// Quando un centro di costo ha una ricorrenza attiva di categoria «Locazione
// outlet», il canone lo porta quella e il `rent_monthly` della scheda non va
// sommato. La ricorrenza vince perché è la più vicina alla cassa: porta
// l'importo lordo che si paga davvero e nello Scadenzario si azzera da sola
// quando arriva la fattura del locatore. Il campo della scheda resta dov'è e
// continua a servire alla scheda outlet e ai margini, che ragionano di costo
// netto e non di cassa.

export type RecurringCostRow = {
  cost_center?: unknown
  cost_category_id?: unknown
  is_active?: unknown
  amount?: unknown
}

export type RentOutletRow = {
  cost_center_key?: unknown
  rent_monthly?: unknown
}

/**
 * Centri di costo il cui canone è già coperto da un costo ricorrente attivo.
 * `rentCategoryIds` sono gli id delle categorie di canone (cost_categories con
 * codice LOC_OUTLET): le spese condominiali e di marketing, che stanno nello
 * stesso macro gruppo «locazione» ma non sono il canone, restano fuori.
 */
export function rentCoveredCostCenters(
  recurringCosts: readonly RecurringCostRow[] | null | undefined,
  rentCategoryIds: ReadonlySet<string>,
): Set<string> {
  const covered = new Set<string>()
  if (!recurringCosts || rentCategoryIds.size === 0) return covered
  for (const rc of recurringCosts) {
    if (rc.is_active === false) continue
    if (!(Number(rc.amount) > 0)) continue
    const categoryId = rc.cost_category_id == null ? '' : String(rc.cost_category_id)
    if (!rentCategoryIds.has(categoryId)) continue
    const costCenter = rc.cost_center == null ? '' : String(rc.cost_center)
    if (costCenter) covered.add(costCenter)
  }
  return covered
}

/**
 * Gli outlet il cui canone di scheda va ancora sommato in cassa: tutti quelli
 * che non hanno già una ricorrenza di canone sul proprio centro di costo.
 */
export function outletsWithOwnRent<T extends RentOutletRow>(
  outlets: readonly T[] | null | undefined,
  coveredCostCenters: ReadonlySet<string>,
): T[] {
  if (!outlets) return []
  if (coveredCostCenters.size === 0) return [...outlets]
  return outlets.filter(o => {
    const key = o.cost_center_key == null ? '' : String(o.cost_center_key)
    return !(key && coveredCostCenters.has(key))
  })
}
