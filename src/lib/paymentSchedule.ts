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

// ─────────────────────────────────────────────────────────────────────────────
// Calcolo delle scadenze dal piano del fornitore.
// Spostato qui da src/pages/scadenzario/modals.tsx (ondata modalità 2026-09):
// la stessa matematica serve al modal scadenza E all'anteprima nel form
// fornitore, e due copie diverberebbero. Replica lato client di
// fn_supplier_installment_schedule (migration 087).
// ─────────────────────────────────────────────────────────────────────────────

export type SupplierPlan = {
  base: PaymentBase
  gg: number
  nRate: number
  /** false quando il fornitore non ha un piano: valgono i default qui sotto. */
  hasPlan: boolean
}

/** Piano usato quando il fornitore non ne ha uno: 30 gg fine mese, rata unica. */
export const DEFAULT_PLAN: { base: PaymentBase; gg: number; nRate: number } = {
  base: 'fine_mese', gg: 30, nRate: 1,
}

export type PlanFields = {
  payment_base?: unknown
  prima_scadenza_gg?: unknown
  numero_rate?: unknown
  // L'index signature evita il "weak type check" di TS quando si passa una riga
  // fornitore generica (Record<string, unknown>) letta da Supabase.
  [k: string]: unknown
}

/** Stato del piano di un fornitore, allineato a fn_supplier_config_anomaly. */
export type PlanStatus = 'ok' | 'assente' | 'incompleto'
export const planStatus = (s: PlanFields | null | undefined): PlanStatus => {
  const base = String((s?.payment_base as string | undefined) || '').trim()
  if (!base) return 'assente'
  const gg = s?.prima_scadenza_gg
  const rate = Number(s?.numero_rate)
  if (gg == null || !Number.isFinite(Number(gg)) || Number(gg) < 0 || !(rate > 0)) return 'incompleto'
  return 'ok'
}

export const derivePlan = (sup: PlanFields | null | undefined): SupplierPlan => {
  const rawBase = String((sup?.payment_base as string | undefined) || '').trim()
  // prima_scadenza_gg == null => non impostato; 0 è un valore VALIDO (fine mese
  // data fattura = ultimo giorno del mese della fattura). Attenzione: Number(null)
  // è 0, quindi il "set" va deciso su != null, non sul valore.
  const ggRaw = sup?.prima_scadenza_gg
  const ggSet = ggRaw != null && Number.isFinite(Number(ggRaw))
  const gg = ggSet ? Number(ggRaw) : DEFAULT_PLAN.gg
  const nRate = Number(sup?.numero_rate)
  return {
    base: rawBase === 'data_fattura' ? 'data_fattura' : DEFAULT_PLAN.base,
    gg: gg >= 0 ? gg : DEFAULT_PLAN.gg,
    nRate: nRate > 0 ? nRate : DEFAULT_PLAN.nRate,
    hasPlan: !!sup && planStatus(sup) === 'ok',
  }
}

export type Installment = { dueDate: string; amount: number }

const pad2 = (n: number) => String(n).padStart(2, '0')
const toISODate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
/** Ultimo giorno di (mese di `emissioneISO` + `months`). */
const lastDayOfMonthPlus = (emissioneISO: string, months: number): string => {
  const d = new Date(emissioneISO + 'T00:00:00')
  return toISODate(new Date(d.getFullYear(), d.getMonth() + months + 1, 0))
}
const addDaysISO = (emissioneISO: string, days: number): string => {
  const d = new Date(emissioneISO + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

export const computeInstallments = (emissioneISO: string, plan: SupplierPlan, gross: number): Installment[] => {
  if (!emissioneISO) return []
  const n = Math.max(plan.nRate || 1, 1)
  const quota = round2((Number(gross) || 0) / n)
  let acc = 0
  const out: Installment[] = []
  for (let i = 1; i <= n; i++) {
    let due: string
    if (plan.base === 'fine_mese') {
      // N mesi solari da aggiungere al mese di emissione (= giorni/30 + rate precedenti).
      const months = Math.floor(plan.gg / 30) + (i - 1)
      due = lastDayOfMonthPlus(emissioneISO, months)
    } else {
      // Data fattura: a giorni.
      due = addDaysISO(emissioneISO, plan.gg + 30 * (i - 1))
    }
    const amount = i < n ? quota : round2((Number(gross) || 0) - acc)
    if (i < n) acc = round2(acc + quota)
    out.push({ dueDate: due, amount })
  }
  return out
}

// ─── Testi leggibili (per chi compila, non per chi legge il codice) ──────────

/**
 * Testo mostrato nelle tendine. Resta la NOTAZIONE COMPATTA usata in azienda
 * ("30/60 gg DFFM"), non una riscrittura a parole: è così che le condizioni
 * vengono dette e scritte con i fornitori. Solo il fine mese secco porta fra
 * parentesi la sua lettura in giorni, per non lasciarlo fuori dalla serie.
 */
export const scheduleModeText = (mode: PaymentScheduleMode): string => {
  if (mode.label === 'Fine mese') return 'Fine mese (0 gg DFFM)'
  return mode.label
}

/** Etichette dei gruppi nella tendina. */
export const SCHEDULE_GROUP_TEXT: Record<string, string> = {
  'Immediato': 'Più usate',
  'Fine mese (DFFM)': 'Fine mese (DFFM)',
  'Data fattura (D.F.)': 'Giorni dalla data fattura (D.F.)',
  'Personalizzata': 'Personalizzata',
}
