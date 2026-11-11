-- 391 — Distinta di rimborso: l'IBAN di chi viene rimborsato è facoltativo
--
-- Patrizio, 11/11/2026: la distinta è la disposizione che mandiamo
-- all'amministrazione, ed è l'amministrazione a fare il bonifico. L'IBAN del
-- dipendente lo ha già chi paga: chi prepara la distinta non deve conoscerlo.
-- Resta obbligatorio il nome, che è quello che l'aggancio cerca nella causale.
-- Solo un vincolo allentato, nessun dato toccato. Tenant: NZ + Zago.

ALTER TABLE public.payable_reimbursements
  ALTER COLUMN beneficiary_iban DROP NOT NULL;

COMMENT ON COLUMN public.payable_reimbursements.beneficiary_iban IS
  'IBAN di chi viene rimborsato. Facoltativo (migration 391): lo conosce chi esegue il bonifico. Se c''è, deve avere la forma di un IBAN.';
