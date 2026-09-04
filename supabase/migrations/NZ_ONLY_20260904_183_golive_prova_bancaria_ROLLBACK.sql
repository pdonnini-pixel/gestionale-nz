-- =============================================================================
-- ROLLBACK NZ_ONLY 183 — le 12 chiusure go-live tornano senza prova bancaria
-- =============================================================================
-- Restano pagate: si toglie solo il collegamento al movimento e si rimette la
-- data convenzionale del go-live.
-- =============================================================================

BEGIN;

UPDATE public.bank_transactions
SET is_reconciled = false, reconciled_at = NULL, reconciled_invoice_id = NULL
WHERE id IN ('8650610f-3aeb-4f8a-9967-13b4a4f78ace','fa60f964-5e48-49c9-a495-63be6d9d97d3',
             '3a7dba9b-7a70-4b89-881f-4f87e657da8d','7403049b-9a98-491f-a637-855d2c8ae8b3',
             'be13f644-fe89-465e-99d6-9d1a0c2b6ead','e8816b70-c99d-412c-9c5e-874a29cf6790',
             '6a62f0a1-32b6-45a5-9a88-2a309363b9a2','c252154d-b776-472f-a22b-cafae472e460',
             'dc67d1cb-515d-40bf-8c2e-ece22c005b8c','dcbb23ed-cede-4aaa-91fb-648ac31e00b4',
             '6409106f-4dad-43e2-a054-428e8210b4d8','34df1ba5-912d-4318-a0e3-a15520f3c0ea');

UPDATE public.payables
SET bank_transaction_id = NULL, payment_date = '2026-06-17', updated_at = now()
WHERE id IN ('13323c39-7c31-4934-911c-b827f44a75dc','3f7ce38d-d37a-46cc-b4ec-e4676224e5e4',
             '7fd4818b-ebb7-4029-8b24-ed22c001a5ee','61a23290-4770-45b3-868b-f689627b0d89',
             '7576297c-ee33-4298-8b83-7bfd2ab2c0f4','a8f8f4cd-d2ec-4891-af67-21f065d0823d',
             '79175165-308c-44c9-9aa0-7e34fbef7874','faf77f11-ea1a-4310-aad1-1befd1e08cd4',
             'c9fd9e0e-97a8-4229-b969-998cc68fdfd3','7cd3a0e3-53b6-4248-a469-e260884f7161',
             '7d0c066f-0fb8-48d5-8758-599ed939d5df','25ef4fe9-5f51-4c48-a6ec-7df2196ad616');

DELETE FROM public.reconciliation_log
WHERE notes LIKE 'prova bancaria per una chiusura go-live (04/09/2026)%';

COMMIT;
