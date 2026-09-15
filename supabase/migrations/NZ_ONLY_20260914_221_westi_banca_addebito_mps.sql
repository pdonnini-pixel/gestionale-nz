-- NZ_ONLY 20260914_221 — Westi S.r.l. (concedente Roma Soratte): banca di
-- addebito SEPA = conto MPS, su indicazione di Patrizio del 14/09/2026.
-- Completa il profilo di pagamento creato dalla 220 (metodo rid): senza banca
-- il canone non entrava nelle previsioni di cassa per conto.
-- Il conto è risolto per nome banca e stato attivo, non per id.
-- Applicata e verificata su NZ il 14/09/2026 (1 conto MPS attivo, IBAN ···1460).

BEGIN;

WITH mps AS (
  SELECT id FROM public.bank_accounts
  WHERE company_id = (SELECT id FROM public.companies WHERE vat_number = '07362100484')
    AND is_active = true AND bank_name ILIKE '%MPS%'
  ORDER BY created_at LIMIT 1
)
UPDATE public.suppliers s
SET payment_bank_account_id = (SELECT id FROM mps),
    note = replace(coalesce(note, ''), 'Banca di addebito SEPA: da indicare (mandato alla stipula).', 'Banca di addebito SEPA: MPS (indicazione di Patrizio, 14/09/2026).'),
    updated_at = now()
WHERE s.partita_iva = '06227950968';

COMMIT;

-- Verifica:
-- SELECT s.name, s.payment_method, b.bank_name, right(b.iban, 4)
-- FROM suppliers s JOIN bank_accounts b ON b.id = s.payment_bank_account_id
-- WHERE s.partita_iva = '06227950968';
