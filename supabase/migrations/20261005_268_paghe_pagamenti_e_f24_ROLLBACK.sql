-- ROLLBACK della migration 268 (paghe: pagamenti e F24).
-- Toglie solo cio' che la 268 ha aggiunto: tabelle nuove, funzioni nuove, cron.
-- Nessun dato preesistente viene toccato (bank_transactions, buste paga e costo
-- lordo non erano stati modificati dalla 268).
-- Le domande gia' aperte in bank_document_questions (kind stipendio_non_abbinato,
-- buste_non_pagate, f24_paghe) restano: si archiviano a mano se servisse.

BEGIN;
SELECT cron.unschedule('payroll-sync-daily');
DROP FUNCTION IF EXISTS public.payroll_sync_all();
DROP FUNCTION IF EXISTS public.save_payroll_f24_items(uuid, integer, integer, jsonb);
DROP FUNCTION IF EXISTS public.payroll_sync_now();
DROP FUNCTION IF EXISTS public.fn_payroll_sync(uuid);
DROP FUNCTION IF EXISTS public.fn_f24_scadenza(date);
DROP FUNCTION IF EXISTS public.fn_it_num(text);
DROP FUNCTION IF EXISTS public.fn_payroll_subset_k(uuid[], numeric[], numeric, integer);
DROP FUNCTION IF EXISTS public.fn_payroll_subset(uuid[], numeric[], numeric);
DROP TABLE IF EXISTS public.payroll_f24_checks;
DROP TABLE IF EXISTS public.payroll_f24_items;
DROP TABLE IF EXISTS public.payroll_payment_links;
COMMIT;
