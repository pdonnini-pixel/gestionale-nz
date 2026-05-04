// Interfacce business condivise per il typing delle 25 pagine residue.
// Vedi PROMPT_TS_STRICT_COMPLETION.md / STRICT_COMPLETION_NOTES.md.

import type { Database } from './database'

// ─── Helpers da database.ts ─────────────────────────────────────

export type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type Insert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type Update<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

export type ViewRow<T extends keyof Database['public']['Views']> =
  Database['public']['Views'][T]['Row']

export type Enum<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// ─── Tipi business per pattern comuni ────────────────────────────

// Outlet code: i 7 outlet ufficiali + sede magazzino + valori speciali
// usati in budget_entries.cost_center per voci aggregate/rettifiche.
// `string` di fallback consente cost_center custom in DB.
export type OutletCode =
  | 'sede_magazzino'
  | 'valdichiana'
  | 'barberino'
  | 'franciacorta'
  | 'palmanova'
  | 'brugnato'
  | 'valmontone'
  | 'torino'
  | 'spese_non_divise'
  | 'rettifica_bilancio'
  | 'all'
  | string

// Pattern Record per dati per-outlet
export type ByOutlet<T> = Partial<Record<OutletCode, T>>

// Pattern Record per dati per-account-code (es. 510100, CAT_69)
export type ByAccountCode<T> = Record<string, T>

// Pattern annidato: outlet × account
export type ByOutletAndAccount<T> = ByOutlet<ByAccountCode<T>>

// Mese 1-12
export type MonthNum = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

// Pattern per dati per-mese
export type ByMonth<T> = Partial<Record<MonthNum, T>>

// ─── Form state generico ─────────────────────────────────────────

export interface FormState<T> {
  data: T
  dirty: boolean
  saving: boolean
  errors: Partial<Record<keyof T, string>>
}

// ─── API response wrapper ────────────────────────────────────────

export interface ApiResult<T> {
  data: T | null
  error: string | null
  loading: boolean
}

// ─── Tipi business specifici ─────────────────────────────────────

// BudgetEntry estesa con importi sempre numerici (non null|number)
export interface BudgetEntryParsed extends Row<'budget_entries'> {
  budget_amount_num: number  // sempre number, derivato da budget_amount ?? 0
  actual_amount_num: number  // sempre number, derivato da actual_amount ?? 0
}

// Toast per UI (componente Toast in components/Toast.tsx)
export type ToastKind = 'ok' | 'error' | 'warning' | 'info'

export interface ToastState {
  msg: string
  kind: ToastKind
}

// Modal generico open/close
export interface ModalState<T = null> {
  open: boolean
  data: T
}

// ─── Helper per Supabase response error ──────────────────────────

export interface SupabaseError {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

// Type guard per restringere unknown → SupabaseError
export function isSupabaseError(x: unknown): x is SupabaseError {
  return typeof x === 'object' && x !== null && 'message' in x &&
    typeof (x as { message: unknown }).message === 'string'
}

// Estrae messaggio di errore da unknown (fallback "Errore sconosciuto")
export function errorMessage(e: unknown, fallback = 'Errore sconosciuto'): string {
  if (e instanceof Error) return e.message
  if (isSupabaseError(e)) return e.message
  if (typeof e === 'string') return e
  return fallback
}
