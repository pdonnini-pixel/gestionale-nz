// Fonte unica per i metodi di pagamento fornitore.
// Allineata all'enum DB `payment_method` (supabase/migrations/20260417_000_baseline_schema.sql):
//   bonifico_ordinario, bonifico_urgente, bonifico_sepa, riba_30, riba_60, riba_90,
//   riba_120, rid, sdd_core, sdd_b2b, rimessa_diretta, carta_credito, carta_debito,
//   assegno, contanti, compensazione, f24, mav, rav, bollettino_postale, altro
//
// Evita mappe di label duplicate e disallineate tra le pagine (Fornitori,
// Scheda contabile, Scadenzario): qui c'e' l'elenco completo + i fallback v1.

export type PaymentMethodOptionGroup = {
  group: string
  items: { value: string; label: string }[]
}

// Opzioni raggruppate per la tendina "Metodo pagamento" (form fornitore).
export const PAYMENT_METHOD_OPTIONS: PaymentMethodOptionGroup[] = [
  { group: 'Bonifico', items: [
    { value: 'bonifico_ordinario', label: 'Bonifico Ordinario' },
    { value: 'bonifico_urgente', label: 'Bonifico Urgente' },
    { value: 'bonifico_sepa', label: 'Bonifico SEPA' },
  ] },
  { group: 'RIBA', items: [
    { value: 'riba_30', label: 'Ri.Ba. 30gg' },
    { value: 'riba_60', label: 'Ri.Ba. 60gg' },
    { value: 'riba_90', label: 'Ri.Ba. 90gg' },
    { value: 'riba_120', label: 'Ri.Ba. 120gg' },
  ] },
  { group: 'RID / SDD', items: [
    { value: 'rid', label: 'RID' },
    { value: 'sdd_core', label: 'SDD Core' },
    { value: 'sdd_b2b', label: 'SDD B2B' },
  ] },
  { group: 'Altro', items: [
    { value: 'rimessa_diretta', label: 'Rimessa Diretta' },
    { value: 'carta_credito', label: 'Carta di Credito' },
    { value: 'carta_debito', label: 'Carta di Debito' },
    { value: 'assegno', label: 'Assegno' },
    { value: 'contanti', label: 'Contanti' },
    { value: 'compensazione', label: 'Compensazione' },
    { value: 'f24', label: 'F24' },
    { value: 'mav', label: 'MAV' },
    { value: 'rav', label: 'RAV' },
    { value: 'bollettino_postale', label: 'Bollettino Postale' },
    { value: 'altro', label: 'Altro' },
  ] },
]

// Label leggibile per ogni valore dell'enum + fallback v1 (dati legacy).
export const PAYMENT_METHOD_LABELS: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  PAYMENT_METHOD_OPTIONS.forEach(g => g.items.forEach(i => { map[i.value] = i.label }))
  // fallback per vecchi valori text non presenti nell'enum
  map.bonifico = 'Bonifico'
  map.riba = 'Ri.Ba.'
  map.rid = 'RID'
  map.carta = 'Carta'
  return map
})()

// Default enum-valido per metodo mancante (mai il valore text legacy 'bonifico',
// che farebbe fallire il cast sulla colonna enum default_payment_method).
export const DEFAULT_PAYMENT_METHOD = 'bonifico_ordinario'

// Insieme dei valori VALIDI dell'enum payment_method (esclude i fallback legacy).
export const VALID_PAYMENT_METHODS = new Set<string>(
  PAYMENT_METHOD_OPTIONS.flatMap(g => g.items.map(i => i.value)),
)

// Normalizza un valore metodo verso un valore enum VALIDO.
// - se e' gia' un valore enum valido -> lo restituisce
// - mappe legacy note e NON ambigue (colonna text storica) -> valore enum
// - valori legacy ambigui ('riba', 'carta') o ignoti -> '' (il chiamante ripiega
//   sulla colonna enum default_payment_method, sempre valida, o sul default)
export const normalizePaymentMethod = (raw: string | null | undefined): string => {
  const v = String(raw || '')
  if (VALID_PAYMENT_METHODS.has(v)) return v
  if (v === 'bonifico') return 'bonifico_ordinario'
  return ''
}

// Metodi per cui la banca di pagamento e' OBBLIGATORIA (serve per lo storno nei
// cashflow). Deve restare allineato a fn_supplier_config_anomaly nel DB
// (migration 087): riba_*, rid, sdd_core, sdd_b2b, carta_credito, carta_debito.
export const BANK_REQUIRED_METHODS = new Set<string>([
  'riba_30', 'riba_60', 'riba_90', 'riba_120',
  'rid', 'sdd_core', 'sdd_b2b', 'carta_credito', 'carta_debito',
])

export const isBankRequired = (method: string | null | undefined): boolean =>
  BANK_REQUIRED_METHODS.has(String(method || ''))

// Etichetta leggibile per un metodo (con fallback al valore grezzo).
export const paymentMethodLabel = (method: string | null | undefined): string =>
  PAYMENT_METHOD_LABELS[String(method || '')] || String(method || '')
