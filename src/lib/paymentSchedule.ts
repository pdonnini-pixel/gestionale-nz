// Fonte unica delle MODALITA' DI PAGAMENTO (piano scadenze fornitore).
//
// Il piano vive sul fornitore in tre colonne (migration 087):
//   payment_base      'data_fattura' | 'fine_mese'
//   prima_scadenza_gg giorni alla prima rata (0 = a vista / fine mese secco)
//   numero_rate       quante rate, ognuna +30 gg (data fattura) o +1 mese (fine mese)
//
// La combinazione (prima_scadenza_gg, numero_rate) copre gia' tutte le
// dilazioni multiple: 30 gg x 2 rate = "30/60", 30 gg x 4 rate = "30/60/90/120",
// 90 gg x 2 rate = "90/120". Qui si costruiscono le etichette leggibili e
// l'elenco COMPLETO delle combinazioni da mostrare nelle tendine, cosi' le
// pagine non riscrivono liste parziali (prima la revisione pagamenti offriva
// solo 30/60, 30/60/90, 60/90 e 60/90/120: mancavano 30/60/90/120 e 90/120).

export type PaymentBase = 'data_fattura' | 'fine_mese'

export type PaymentScheduleMode = {
  /** Etichetta mostrata e salvata (es. "30/60/90 gg DFFM"). */
  label: string
  base: PaymentBase | null
  /** Giorni alla prima scadenza. */
  prima: number | null
  /** Numero di rate. */
  rate: number | null
  /** Modalita' "data fissa del mese": il giorno lo indica l'utente a fianco. */
  dataFissa?: boolean
}

export type PaymentScheduleGroup = { group: string; items: PaymentScheduleMode[] }

/** Suffisso dell'etichetta in base al calcolo delle scadenze. */
export const baseSuffix = (base: PaymentBase | string | null | undefined): string =>
  base === 'data_fattura' ? ' gg D.F.' : ' gg DFFM'

/** Giorni di ogni rata: prima, prima+30, prima+60, … */
export const installmentDays = (prima: number, rate: number): number[] => {
  const n = Math.max(Number(rate) || 1, 1)
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(prima + 30 * i)
  return out
}

/**
 * Etichetta leggibile del piano: "60/90/120 gg DFFM".
 * gg == null => piano non impostato. gg === 0 => "Fine mese" (base fine mese,
 * ultimo giorno del mese della fattura) o "A Vista" (base data fattura).
 */
export function scheduleLabel(
  base: string | null | undefined,
  gg: number | null | undefined,
  rate: number | null | undefined,
): string {
  if (gg == null) return 'da definire'
  const g = Number(gg)
  if (g === 0) return base === 'fine_mese' ? 'Fine mese' : 'A Vista'
  return installmentDays(g, Number(rate) || 1).join('/') + baseSuffix(base)
}

/** Etichetta -> piano. Accetta anche combinazioni non in elenco (es. "45/75 gg DFFM"). */
export function parseScheduleLabel(label: string): {
  base: PaymentBase | null
  prima: number | null
  rate: number | null
  dataFissa: boolean
} {
  const l = String(label || '').trim()
  if (/^Data fissa/i.test(l)) return { base: null, prima: null, rate: null, dataFissa: true }
  if (/^A Vista$/i.test(l)) return { base: 'data_fattura', prima: 0, rate: 1, dataFissa: false }
  if (/^Fine mese$/i.test(l)) return { base: 'fine_mese', prima: 0, rate: 1, dataFissa: false }
  const m = l.match(/^([\d/]+)\s*gg\s*(DFFM|D\.F\.)$/i)
  if (m) {
    const parts = m[1].split('/').map(Number).filter(n => !isNaN(n))
    const base: PaymentBase = /D\.F\./i.test(m[2]) ? 'data_fattura' : 'fine_mese'
    return { base, prima: parts[0] ?? null, rate: parts.length || 1, dataFissa: false }
  }
  return { base: null, prima: null, rate: null, dataFissa: false }
}

// Dilazioni standard: prima scadenza a 30/60/90/120 gg, con tutte le rate
// successive fino a 120 gg. Genera 30, 30/60, 30/60/90, 30/60/90/120, 60,
// 60/90, 60/90/120, 90, 90/120, 120.
const PRIME_GG = [30, 60, 90, 120]
const ULTIMA_GG = 120

const modesForBase = (base: PaymentBase): PaymentScheduleMode[] =>
  PRIME_GG.flatMap(prima => {
    const maxRate = Math.floor((ULTIMA_GG - prima) / 30) + 1
    return Array.from({ length: maxRate }, (_, i) => {
      const rate = i + 1
      return { label: scheduleLabel(base, prima, rate), base, prima, rate }
    })
  })

/** Tutte le modalita' a fine mese (DFFM). */
export const SCHEDULE_MODES_FINE_MESE = modesForBase('fine_mese')
/** Tutte le modalita' a data fattura (D.F.). */
export const SCHEDULE_MODES_DATA_FATTURA = modesForBase('data_fattura')

export const SCHEDULE_MODE_A_VISTA: PaymentScheduleMode = { label: 'A Vista', base: 'data_fattura', prima: 0, rate: 1 }
export const SCHEDULE_MODE_FINE_MESE: PaymentScheduleMode = { label: 'Fine mese', base: 'fine_mese', prima: 0, rate: 1 }
export const SCHEDULE_MODE_DATA_FISSA: PaymentScheduleMode = { label: 'Data fissa mese', base: null, prima: null, rate: null, dataFissa: true }

/** Elenco completo raggruppato per la tendina "Modalita' (scadenze)". */
export const SCHEDULE_MODE_GROUPS: PaymentScheduleGroup[] = [
  { group: 'Immediato', items: [SCHEDULE_MODE_A_VISTA, SCHEDULE_MODE_FINE_MESE] },
  { group: 'Fine mese (DFFM)', items: SCHEDULE_MODES_FINE_MESE },
  { group: 'Data fattura (D.F.)', items: SCHEDULE_MODES_DATA_FATTURA },
  { group: 'Personalizzata', items: [SCHEDULE_MODE_DATA_FISSA] },
]

/** Tutte le etichette, nell'ordine dei gruppi. */
export const SCHEDULE_MODE_LABELS: string[] = SCHEDULE_MODE_GROUPS.flatMap(g => g.items.map(i => i.label))

/** Piano (base+gg+rate) -> etichetta dell'elenco, se combacia con una standard. */
export const findScheduleMode = (
  base: string | null | undefined,
  gg: number | null | undefined,
  rate: number | null | undefined,
): PaymentScheduleMode | undefined => {
  const label = scheduleLabel(base, gg, rate)
  return SCHEDULE_MODE_GROUPS.flatMap(g => g.items).find(m => m.label === label)
}
