// ─── DIFF NON DISTRUTTIVO PER budget_confronto ────────────────────────────
// Estratto come funzione pura per essere testabile in isolamento (vedi
// budgetConfrontoDiff.test.ts).
//
// Contesto (Patrizio 03/06/2026, ticket 9bf52ecc): il vecchio "Salva Confronto"
// faceva delete(company+cost_center+year) + insert(stato React). Se lo stato era
// parziale o derivato dal bilancio, cancellava in silenzio i dati MANUALI di
// Lilian. Questa funzione calcola il diff tra lo stato desiderato (rows costruite
// dallo stato React) e quello attuale del DB, così il salvataggio tocca SOLO le
// celle effettivamente cambiate e rimuove SOLO le chiavi che l'utente ha
// esplicitamente azzerato (e solo dopo conferma esplicita, lato chiamante).

export type ConfrontoRow = {
  company_id: string
  cost_center: string
  account_code: string
  year: number
  month: number
  entry_type: string
  amount: number
  rettifica_amount?: number | null
  rettifica_pct?: number | null
  stato?: string
  updated_at?: string
}

// Riga letta dal DB (subset di colonne usato per il confronto).
export type ExistingConfrontoRow = {
  id: string
  entry_type: string
  account_code: string
  month: number
  amount: number | null
  rettifica_amount?: number | null
  rettifica_pct?: number | null
}

export type ConfrontoDiff = {
  toUpsert: ConfrontoRow[]      // righe nuove o modificate → upsert mirato
  toDeleteIds: string[]         // id DB di celle che l'utente ha azzerato/rimosso
  toDeleteRows: ExistingConfrontoRow[]
  totalBefore: number
  totalAfter: number
  countBefore: number
  countAfter: number
}

const EPS = 0.005

const norm = (v: number | null | undefined): number =>
  typeof v === 'number' && !isNaN(v) ? v : 0

const approxEq = (a: number | null | undefined, b: number | null | undefined): boolean =>
  Math.abs(norm(a) - norm(b)) < EPS

// Chiave logica di una cella confronto. month=0 = valore annuale.
const cfKey = (entryType: string, accountCode: string, month: number): string =>
  `${entryType}|${accountCode}|${month}`

export function computeConfrontoDiff(
  desired: ConfrontoRow[],
  existing: ExistingConfrontoRow[],
): ConfrontoDiff {
  const existingMap = new Map<string, ExistingConfrontoRow>()
  for (const e of existing) existingMap.set(cfKey(e.entry_type, e.account_code, e.month), e)

  const desiredKeys = new Set<string>()
  const toUpsert: ConfrontoRow[] = []
  for (const d of desired) {
    const k = cfKey(d.entry_type, d.account_code, d.month)
    desiredKeys.add(k)
    const e = existingMap.get(k)
    const unchanged =
      !!e &&
      approxEq(d.amount, e.amount) &&
      approxEq(d.rettifica_amount, e.rettifica_amount) &&
      approxEq(d.rettifica_pct, e.rettifica_pct)
    if (!unchanged) toUpsert.push(d)
  }

  // Righe presenti nel DB ma non più nello stato desiderato = l'utente le ha
  // svuotate/azzerate. Sono le UNICHE candidate alla cancellazione.
  const toDeleteRows = existing.filter(
    e => !desiredKeys.has(cfKey(e.entry_type, e.account_code, e.month)),
  )
  const toDeleteIds = toDeleteRows.map(e => e.id)

  const totalBefore = existing.reduce((s, e) => s + norm(e.amount), 0)
  const totalAfter = desired.reduce((s, d) => s + norm(d.amount), 0)

  return {
    toUpsert,
    toDeleteIds,
    toDeleteRows,
    totalBefore,
    totalAfter,
    countBefore: existing.length,
    countAfter: desired.length,
  }
}
