/**
 * Passa NULL a un argomento di una funzione SQL chiamata con `supabase.rpc`.
 *
 * Il generatore di tipi di Supabase scrive ogni argomento senza DEFAULT come
 * obbligatorio e non nullo (`p_outlet_id: string`), anche quando la funzione
 * non e' STRICT e tratta NULL come un valore con un significato preciso
 * («nessun negozio», «nessun responsabile»). Invece di correggere a mano
 * `src/types/database.ts`, che si rigenera da solo, si dichiara qui, nel
 * punto della chiamata, che quel NULL e' voluto.
 *
 * Usarlo solo dove la funzione SQL gestisce NULL: verificare con
 * `SELECT proisstrict, prosrc FROM pg_proc WHERE proname = '...'`.
 */
export function sqlNull<T>(valore: T | null): T {
  return valore as T;
}
