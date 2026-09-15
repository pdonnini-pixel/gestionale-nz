// ============================================================================
// DEDUPE PER GLI UPSERT A LOTTO
// ============================================================================
// Postgres rifiuta l'intero lotto quando la stessa chiave di conflitto compare
// due volte nello stesso INSERT ... ON CONFLICT DO UPDATE:
//
//   ON CONFLICT DO UPDATE command cannot affect row a second time  (SQLSTATE 21000)
//
// PostgREST lo restituisce come HTTP 500, quindi in interfaccia arriva un
// «errore» generico e l'import non scrive niente, pur avendo gia' registrato il
// log del carico. Caso reale: elenco netti di maggio 2026, una persona presente
// su due filiali del PDF, due righe con lo stesso dipendente e lo stesso mese.
//
// Le funzioni qui sotto normalizzano il lotto PRIMA di mandarlo al database.

/** Chiavi che compaiono piu' di una volta nel lotto. */
export function duplicateKeys<T>(rows: T[], keyOf: (r: T) => string): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) {
    const k = keyOf(r);
    if (seen.has(k)) dup.add(k); else seen.add(k);
  }
  return [...dup];
}

/**
 * Fonde le righe con la stessa chiave sommando i campi numerici indicati.
 * Serve dove due righe sono due pezzi dello stesso dato (stessa persona su due
 * filiali, due mensilita' nello stesso file): il totale del file resta quadrato.
 * I campi non numerici restano quelli della prima riga incontrata.
 */
export function mergeSumByKey<T extends Record<string, any>>(
  rows: T[],
  keyOf: (r: T) => string,
  sumFields: string[],
): { rows: T[]; mergedKeys: string[] } {
  const byKey = new Map<string, T>();
  const mergedKeys: string[] = [];
  for (const row of rows) {
    const k = keyOf(row);
    const prev = byKey.get(k);
    if (!prev) { byKey.set(k, { ...row }); continue; }
    if (!mergedKeys.includes(k)) mergedKeys.push(k);
    for (const f of sumFields) {
      const a = (prev as Record<string, any>)[f];
      const b = (row as Record<string, any>)[f];
      if (a == null && b == null) continue;
      (prev as Record<string, any>)[f] = Number(a ?? 0) + Number(b ?? 0);
    }
  }
  return { rows: [...byKey.values()], mergedKeys };
}

/**
 * Tiene solo l'ultima riga per ogni chiave. Serve dove due righe sono due
 * versioni dello stesso dato (una griglia salvata due volte, un valore corretto
 * dopo il primo inserimento): l'ultima vince, come farebbe il DO UPDATE.
 */
export function keepLastByKey<T>(rows: T[], keyOf: (r: T) => string): { rows: T[]; mergedKeys: string[] } {
  const byKey = new Map<string, T>();
  const mergedKeys: string[] = [];
  for (const row of rows) {
    const k = keyOf(row);
    if (byKey.has(k) && !mergedKeys.includes(k)) mergedKeys.push(k);
    byKey.set(k, row);
  }
  return { rows: [...byKey.values()], mergedKeys };
}

/**
 * Messaggio leggibile per gli errori che l'utente non tecnico incontrerebbe
 * come stringa inglese cruda del database.
 */
export function readableDbError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message || '';
  if (e?.code === '21000' || /affect row a second time/i.test(msg)) {
    return 'Il file contiene la stessa persona (o lo stesso outlet) più volte nello stesso mese: le righe doppie vanno unite prima del salvataggio.';
  }
  if (e?.code === '23505') return 'Esiste già una riga con gli stessi dati per quel mese.';
  if (e?.code === '23503') return 'Un riferimento del file non esiste in anagrafica.';
  if (e?.code === '42501') return 'Il tuo utente non ha i permessi per scrivere questo dato.';
  return msg || 'Errore imprevisto';
}
