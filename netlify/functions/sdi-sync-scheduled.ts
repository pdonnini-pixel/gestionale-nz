// Netlify Function — SDI Sync mTLS (DEPRECATA / PARCHEGGIATA il 16/06/2026)
//
// PERCHÉ È PARCHEGGIATA
// Questo era l'unico scheduler attivo del canale AdE via mTLS (cron Netlify
// "0 */6 * * *"). Da 2026-05-13 ogni run falliva con ERR_OSSL_PEM_NO_START_LINE
// (certificato client PEM nel Vault malformato/vuoto): 137 run consecutive,
// tutte status='partial', fatture_count=0. Generava un errore ricorrente ogni
// 6h in sdi_sync_log → falsi negativi nel nuovo Report Sincronizzazioni.
//
// Il canale fatture passive è stato sostituito da A-Cube REST
// (acube_sdi_sync_inbound_production + pg_cron "acube-sdi-sync-inbound-every-6h",
// vedi migrazioni 073/074).
//
// COSA È STATO FATTO (parcheggio, NON cancellazione)
// - Rimosso il wrapper `schedule(...)`: Netlify non lo esegue più su cron, quindi
//   non scrive più righe d'errore in sdi_sync_log ogni 6h.
// - Mantenuto come stub on-demand: se invocato restituisce 410 con la spiegazione,
//   NON tocca l'AdE e NON scrive sync log.
// - NON sono stati cancellati: la edge function Supabase `sdi-sync`, il core
//   `./lib/sdi-sync-core`, né lo storico in `sdi_sync_log` (seedato in sync_runs).
//
// RIATTIVAZIONE
// Quando il certificato mTLS sarà valido, ripristinare l'import di `schedule` e
// l'handler originale dalla cronologia git (commit precedente a questo).

const DEPRECATION_NOTE =
  "sdi-sync-scheduled è deprecata dal 16/06/2026: canale AdE mTLS non operativo " +
  "(certificato PEM non valido). Le fatture passive sono sincronizzate da A-Cube REST " +
  "(cron Supabase acube-sdi-sync-inbound-every-6h). Vedi Report Sincronizzazioni.";

// Handler on-demand NON schedulato: nessuna chiamata AdE, nessuna scrittura log.
export const handler = async () => {
  console.warn("[sdi-sync-scheduled] PARCHEGGIATA — no-op. " + DEPRECATION_NOTE);
  return {
    statusCode: 410,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deprecated: true, message: DEPRECATION_NOTE }),
  };
};
