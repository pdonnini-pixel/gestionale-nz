-- NZ_ONLY_20260916_237_giornate_senza_incasso_e_chiusure_ROLLBACK.sql
--
-- Toglie le sedici giornate scritte dalla 237 e nient'altro. Il filtro e' triplo: il marcatore
-- lasciato in `notes`, l'importo a zero e l'assenza di righe canale collegate. Cosi' una
-- giornata che nel frattempo qualcuno avesse compilato davvero non viene toccata.

BEGIN;

DELETE FROM public.outlet_daily_closings c
 WHERE c.notes = 'chiusura-237'
   AND c.total_receipts = 0
   AND c.channels_total = 0
   AND c.cash_deposit = 0
   AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_lines l WHERE l.closing_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_expenses e WHERE e.closing_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.outlet_daily_closing_attachments a WHERE a.closing_id = c.id);

COMMIT;

-- VERIFICA (deve tornare zero)
-- SELECT count(*) FROM public.outlet_daily_closings WHERE notes = 'chiusura-237';
