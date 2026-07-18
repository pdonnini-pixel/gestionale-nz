// Helper di paginazione per aggirare il cap di 1000 righe per richiesta di
// PostgREST (Supabase). Documentato in produzione: un semplice .select() oltre
// le 1000 righe TRONCA il risultato SENZA errore, falsando KPI, totali ed export.
// .range(0, 9999) o .limit(5000) NON aggirano il cap: il server risponde comunque
// al massimo max_rows righe. L'unico modo affidabile e' paginare in blocchi da 1000
// finche' la sorgente e' esaurita.
//
// Uso:
//   const rows = await fetchAllPaged(
//     (from, to) => supabase.from('budget_entries')
//       .select('...').eq('company_id', cid).order('id', { ascending: true }).range(from, to),
//     'budget_entries',
//   )
//
// IMPORTANTE: la query DEVE avere un .order() su una colonna UNIVOCA (es. id).
// Senza ordine stabile la paginazione su richieste HTTP separate puo' perdere o
// duplicare righe al confine tra le pagine.

const PAGE_SIZE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PagedQuery = (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message?: string } | null }>

export async function fetchAllPaged<T = Record<string, unknown>>(
  makeQuery: PagedQuery,
  label = 'query',
): Promise<T[]> {
  const acc: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(`[fetchAllPaged] ${label}:`, error?.message)
      break
    }
    const batch = (data || []) as T[]
    acc.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  return acc
}
