-- ============================================================================
-- 307 — I due indici di bank_transactions che mancavano su Made
-- ============================================================================
-- Trovati dall'audit di parità del 20/10/2026 (vedi AUDIT_PARITA_TENANT.md):
-- Made aveva 446 indici contro i 448 di NZ e Zago. I due mancanti sono indici
-- parziali su bank_transactions, usati dalle query che risalgono dal movimento
-- alla fattura e al fornitore.
--
-- Additiva e idempotente: IF NOT EXISTS, nessun dato toccato, nessun vincolo.
-- Applicata su Made (NZ e Zago li avevano già); dopo l'applicazione i tre tenant
-- hanno 448 indici con la stessa impronta.
--
-- Rollback: non previsto. Togliere un indice presente sugli altri due tenant
-- rifarebbe la divergenza che questa migration chiude; se mai servisse, un
-- DROP INDEX va deciso con Patrizio.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bank_tx_invoice_id
  ON public.bank_transactions USING btree (invoice_id) WHERE (invoice_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_bank_tx_supplier_id
  ON public.bank_transactions USING btree (supplier_id) WHERE (supplier_id IS NOT NULL);

-- Verifica (deve dare 448 e la stessa impronta sui tre tenant)
--   SELECT count(*) AS n,
--          left(md5(string_agg(indexname || '=' || md5(indexdef), E'\n' ORDER BY indexname)), 10) AS h
--     FROM pg_indexes WHERE schemaname = 'public';
