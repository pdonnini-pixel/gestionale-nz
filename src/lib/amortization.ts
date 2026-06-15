/**
 * amortization.ts — Calcolo piano di ammortamento alla francese (rata costante).
 *
 * Deterministico: dato lo STESSO set di parametri confermati dall'operatore
 * produce SEMPRE lo stesso piano. Nessun valore inventato — se un parametro
 * obbligatorio manca o non è valido, ritorna piano vuoto (l'UI mostra
 * empty-state).
 *
 * Usato da:
 *  - pagina Finanziamenti (tab Banche) per mostrare la tabella rate
 *  - (estensione futura) Cashflow Prospettico per le uscite CERTE
 *
 * NB: questo è il piano CALCOLATO dai parametri, NON l'estrazione del PDF
 * della banca. Il PDF resta la prova archiviata (tabella documents); il
 * parsing automatico del PDF è volutamente fuori scope (da tarare per
 * banca: MPS / BCC / Intesa).
 */

export type AmortizationFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'annual'

/** Numero di rate per anno per ciascuna periodicità. */
export const PERIODS_PER_YEAR: Record<AmortizationFrequency, number> = {
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
}

/**
 * Mappa i valori `installment_frequency` salvati su `loans` (testo libero,
 * sia inglese che italiano) verso il tipo canonico. Ritorna null se non
 * riconosciuto — il chiamante decide il fallback (di norma 'monthly').
 */
export function normalizeFrequency(raw: string | null | undefined): AmortizationFrequency | null {
  if (!raw) return null
  const v = raw.trim().toLowerCase()
  if (['monthly', 'mensile', 'mese', 'm'].includes(v)) return 'monthly'
  if (['quarterly', 'trimestrale', 'trimestre', 'q'].includes(v)) return 'quarterly'
  if (['semiannual', 'semestrale', 'semestre', 'semi-annual', 's'].includes(v)) return 'semiannual'
  if (['annual', 'annuale', 'anno', 'yearly', 'y', 'a'].includes(v)) return 'annual'
  return null
}

export interface AmortizationParams {
  /** Capitale finanziato (importo erogato). > 0 */
  principal: number
  /** Tasso annuo nominale in PERCENTUALE (es. 4.5 = 4,5%). >= 0 */
  annualRatePct: number
  /** Numero TOTALE di rate del piano. Intero > 0 */
  numberOfInstallments: number
  /** Periodicità delle rate. */
  frequency: AmortizationFrequency
  /** Data della prima rata (ISO 'YYYY-MM-DD'). */
  firstPaymentDate: string
}

export interface AmortizationRow {
  /** Numero progressivo rata (1-based). */
  number: number
  /** Data scadenza rata (ISO 'YYYY-MM-DD'). */
  date: string
  /** Quota interessi della rata. */
  interest: number
  /** Quota capitale della rata. */
  principal: number
  /** Rata totale (capitale + interessi). */
  installment: number
  /** Capitale residuo DOPO il pagamento della rata. */
  remaining: number
}

export interface AmortizationPlan {
  rows: AmortizationRow[]
  /** Rata costante teorica (alla francese). */
  installment: number
  /** Somma di tutte le quote interessi. */
  totalInterest: number
  /** Somma di tutte le rate (capitale + interessi). */
  totalPaid: number
}

const EMPTY_PLAN: AmortizationPlan = { rows: [], installment: 0, totalInterest: 0, totalPaid: 0 }

/** Arrotonda a 2 decimali in modo stabile (evita il drift di floating point). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Aggiunge `count` periodi alla data in base alla periodicità.
 * Usa solo aritmetica sui mesi (UTC) per evitare problemi di fuso/DST.
 */
function addPeriods(isoDate: string, count: number, frequency: AmortizationFrequency): string {
  const monthsPerPeriod: Record<AmortizationFrequency, number> = {
    monthly: 1, quarterly: 3, semiannual: 6, annual: 12,
  }
  const [y, m, d] = isoDate.split('-').map(Number)
  // Date base in UTC; il giorno viene clampato a fine mese se necessario.
  const base = new Date(Date.UTC(y, (m - 1) + count * monthsPerPeriod[frequency], 1))
  const targetYear = base.getUTCFullYear()
  const targetMonth = base.getUTCMonth()
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  const mm = String(targetMonth + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${targetYear}-${mm}-${dd}`
}

/** Verifica che i parametri siano validi e completi (no NaN, no demo). */
export function isValidAmortizationParams(p: Partial<AmortizationParams> | null | undefined): p is AmortizationParams {
  if (!p) return false
  if (typeof p.principal !== 'number' || !isFinite(p.principal) || p.principal <= 0) return false
  if (typeof p.annualRatePct !== 'number' || !isFinite(p.annualRatePct) || p.annualRatePct < 0) return false
  if (typeof p.numberOfInstallments !== 'number' || !Number.isInteger(p.numberOfInstallments) || p.numberOfInstallments <= 0) return false
  if (!p.frequency || !(p.frequency in PERIODS_PER_YEAR)) return false
  if (!p.firstPaymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(p.firstPaymentDate)) return false
  return true
}

/**
 * Calcola il piano di ammortamento alla francese (rata costante).
 *
 * Formula rata: R = C · i / (1 − (1+i)^(−n))
 *  - C = capitale
 *  - i = tasso periodale (tasso annuo / periodi per anno)
 *  - n = numero rate
 *
 * Caso i = 0 (tasso nullo): rata = C / n, interessi = 0.
 *
 * L'ultima rata assorbe gli arrotondamenti così che il residuo finale sia
 * esattamente 0 (nessun centesimo fantasma).
 *
 * Ritorna EMPTY_PLAN se i parametri non sono validi.
 */
export function computeAmortization(params: Partial<AmortizationParams> | null | undefined): AmortizationPlan {
  if (!isValidAmortizationParams(params)) return EMPTY_PLAN

  const { principal, annualRatePct, numberOfInstallments, frequency, firstPaymentDate } = params
  const periodsPerYear = PERIODS_PER_YEAR[frequency]
  const periodRate = (annualRatePct / 100) / periodsPerYear

  let installment: number
  if (periodRate === 0) {
    installment = principal / numberOfInstallments
  } else {
    installment = principal * periodRate / (1 - Math.pow(1 + periodRate, -numberOfInstallments))
  }
  const installmentR = round2(installment)

  const rows: AmortizationRow[] = []
  let remaining = principal
  let totalInterest = 0
  let totalPaid = 0

  for (let k = 1; k <= numberOfInstallments; k++) {
    const interestRaw = remaining * periodRate
    let interest = round2(interestRaw)
    let principalQuota = round2(installmentR - interest)
    let rata = installmentR

    if (k === numberOfInstallments) {
      // Ultima rata: chiudi esattamente il residuo, niente centesimi fantasma.
      principalQuota = round2(remaining)
      rata = round2(principalQuota + interest)
    }

    remaining = round2(remaining - principalQuota)
    if (Math.abs(remaining) < 0.005) remaining = 0

    totalInterest = round2(totalInterest + interest)
    totalPaid = round2(totalPaid + rata)

    rows.push({
      number: k,
      date: addPeriods(firstPaymentDate, k - 1, frequency),
      interest,
      principal: principalQuota,
      installment: rata,
      remaining,
    })
  }

  return { rows, installment: installmentR, totalInterest, totalPaid }
}
