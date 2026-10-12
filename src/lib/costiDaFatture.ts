// Costi da fatture per outlet (vista v_costi_outlet_da_fatture, migrazioni 285, 294 e 297).
// Le fatture passive sono già ripartite sugli outlet dal database con le regole
// dei fornitori; qui si sommano per outlet sui mesi scelti e si raggruppano
// nelle colonne del riquadro. Dalla 294 la vista porta anche il costo del
// personale (gruppo 'personale', Prospetto dello studio paghe) e gli
// amministratori (gruppo 'amministratori', tenuti fuori dal totale come in
// Dipendenti). Funzioni pure, testate in costiDaFatture.test.ts.

export type RigaCostiDaFatture = {
  outlet_id: string | null
  outlet: string | null
  cost_center_key: string | null
  mese: number | null
  gruppo: string | null
  importo: number | null
}

export type CostiOutlet = {
  key: string
  nome: string
  isSede: boolean
  /** Costo lordo del personale (Prospetto paghe, senza amministratori) */
  personale: number
  merce: number
  affitti: number
  struttura: number
  altro: number
  senzaCategoria: number
  /** Costi dell'anno: tutto tranne allestimenti e amministratori */
  correnti: number
  /** Allestimenti e aperture: investimento di avvio, tenuto a parte */
  allestimenti: number
  /** Compensi e INPS gestione separata degli amministratori: fuori dal totale */
  amministratori: number
}

export type CostiDaFattureRiepilogo = {
  outlet: CostiOutlet[]
  nonAssegnato: CostiOutlet | null
  totale: CostiOutlet
  /** Ultimo mese (dentro il periodo) con il costo del personale caricato; null = nessuno */
  ultimoMesePersonale: number | null
}

const NON_ASSEGNATO = '__non_assegnato__'

function vuoto(key: string, nome: string, isSede: boolean): CostiOutlet {
  return { key, nome, isSede, personale: 0, merce: 0, affitti: 0, struttura: 0, altro: 0, senzaCategoria: 0, correnti: 0, allestimenti: 0, amministratori: 0 }
}

/** Colonna del riquadro per un gruppo della vista (macro_group della categoria). */
export function colonnaGruppo(gruppo: string | null): keyof Pick<CostiOutlet, 'personale' | 'merce' | 'affitti' | 'struttura' | 'altro' | 'senzaCategoria' | 'allestimenti' | 'amministratori'> {
  switch (gruppo) {
    case 'personale': return 'personale'
    case 'amministratori': return 'amministratori'
    case 'costo_venduto': return 'merce'
    case 'locazione': return 'affitti'
    case 'generali_amministrative': return 'struttura'
    case 'allestimenti': return 'allestimenti'
    // Spese pagate dalla cassa del negozio e commissioni Amex e Nexi (migrazione 297)
    case 'spese_cassa':
    case 'commissioni_incasso':
      return 'altro'
    case 'senza_categoria':
    case 'senza_fornitore':
    case null:
      return 'senzaCategoria'
    default: return 'altro'
  }
}

/**
 * Somma le righe della vista per outlet sui mesi scelti (null = tutto l'anno).
 * `sedeKeys` = cost_center_key della sede (ruolo 'hq'): la sede va in fondo.
 */
export function aggregaCostiDaFatture(
  righe: RigaCostiDaFatture[],
  mesi: number[] | null,
  sedeKeys: Set<string>,
): CostiDaFattureRiepilogo {
  const perOutlet = new Map<string, CostiOutlet>()
  const totale = vuoto('__totale__', 'Totale', false)
  let ultimoMesePersonale: number | null = null

  for (const r of righe) {
    if (mesi && (r.mese == null || !mesi.includes(r.mese))) continue
    const importo = Number(r.importo) || 0
    if (importo === 0) continue
    const key = r.outlet_id ?? NON_ASSEGNATO
    let o = perOutlet.get(key)
    if (!o) {
      const cc = (r.cost_center_key || '').toLowerCase()
      o = r.outlet_id
        ? vuoto(key, r.outlet || cc || '—', sedeKeys.has(cc))
        : vuoto(key, 'Non assegnato', false)
      perOutlet.set(key, o)
    }
    const col = colonnaGruppo(r.gruppo)
    o[col] += importo
    totale[col] += importo
    if (col === 'personale' && r.mese != null) ultimoMesePersonale = Math.max(ultimoMesePersonale ?? 0, r.mese)
    if (col !== 'allestimenti' && col !== 'amministratori') {
      o.correnti += importo
      totale.correnti += importo
    }
  }

  const tutti = [...perOutlet.values()]
  const outlet = tutti
    .filter(o => o.key !== NON_ASSEGNATO)
    .sort((a, b) => (a.isSede === b.isSede ? b.correnti - a.correnti : a.isSede ? 1 : -1))
  const nonAssegnato = perOutlet.get(NON_ASSEGNATO) ?? null
  return { outlet, nonAssegnato, totale, ultimoMesePersonale }
}
