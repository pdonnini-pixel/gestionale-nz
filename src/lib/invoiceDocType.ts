// Helper riusabile per la fatturazione: mappa Tipo Documento FatturaPA (TDxx)
// -> etichetta in chiaro. Imponibile/IVA sono ora persistiti in colonna (backfill
// + trigger), quindi la derivazione runtime dall'XML e' stata rimossa.

const TD_LABELS: Record<string, string> = {
  TD01: 'Fattura',
  TD02: 'Acconto/anticipo su fattura',
  TD03: 'Acconto/anticipo su parcella',
  TD04: 'Nota di credito',
  TD05: 'Nota di debito',
  TD06: 'Parcella',
  TD16: 'Integrazione reverse charge interno',
  TD17: 'Autofattura servizi estero',
  TD18: 'Integrazione beni intra-UE',
  TD19: 'Integrazione/autofattura beni art.17 c.2',
  TD20: 'Autofattura per regolarizzazione',
  TD21: 'Autofattura per splafonamento',
  TD22: 'Estrazione beni da deposito IVA',
  TD23: 'Estrazione beni da deposito IVA con versamento',
  TD24: 'Fattura differita',
  TD25: 'Fattura differita (art.21 c.4)',
  TD26: 'Cessione beni ammortizzabili',
  TD27: 'Autofattura per autoconsumo',
  TD28: 'Acquisti da San Marino (cartacea)',
}

/** Etichetta in chiaro per un codice Tipo Documento; fallback generico per i non mappati. */
export function tipoDocumentoLabel(code: string | null | undefined): string {
  if (!code) return '—'
  const c = String(code).toUpperCase().trim()
  return TD_LABELS[c] ?? `Altro documento (${c})`
}
