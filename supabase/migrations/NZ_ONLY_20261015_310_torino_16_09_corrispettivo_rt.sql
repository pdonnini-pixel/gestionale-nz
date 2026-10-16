-- =====================================================================
-- NZ_ONLY 310 — Torino 16/09/2026: il corrispettivo trasmesso entra nel ricavo
-- =====================================================================
-- La foto della chiusura RT (attachment e25d113c-a469-45ef-9444-fd0d93d44662,
-- letta il 16/09/2026 alle 20:15 ora di Roma) riporta nelle note del lettore
-- «corrispettivo -175,60 per effetto degli annulli»: vendite 85,90, annulli
-- 261,50. Il registro corrispettivi Torino di settembre dello studio Poli
-- (15/10/2026) ha lo stesso -175,60. Prima della 309 il lettore non aveva il
-- campo fiscal_total: lo si aggiunge alla lettura, con il valore che la foto
-- gia' riportava. Il trigger della 309 riproietta il ricavo del giorno:
-- daily_revenue Torino 16/09 da 85,90 a -175,60.
--
-- Backup (valori prima): extracted senza fiscal_total; daily_revenue
-- 1a410449-0ce3-44b0-ac00-1fbef8e5c478 gross 85.90, net 70.41.
-- Rollback: UPDATE ... SET extracted = extracted - 'fiscal_total' - 'fiscal_total_fonte'
-- sullo stesso attachment (il trigger riproietta 85,90).
-- =====================================================================
BEGIN;

UPDATE public.outlet_daily_closing_attachments
   SET extracted = extracted
         || jsonb_build_object(
              'fiscal_total', -175.60,
              'fiscal_total_fonte', 'Aggiunto il 15/10/2026 dalle note della lettura (corrispettivo -175,60) e confermato dal registro corrispettivi dello studio Poli.')
 WHERE id = 'e25d113c-a469-45ef-9444-fd0d93d44662'
   AND NOT (extracted ? 'fiscal_total');

-- Il consuntivo ricavi di settembre (fotografia del 12/10/2026) aveva Torino
-- a 35.932,60 netti: si allinea al registro dello studio, 35.718,26
-- (differenza 214,34 = 261,50 / 1,22). Valore prima: 35932.60.
UPDATE public.budget_confronto
   SET amount = 35718.26, updated_at = now()
 WHERE year = 2026 AND month = 9 AND entry_type = 'cons_monthly'
   AND account_code LIKE '5101%' AND cost_center = 'torino'
   AND amount = 35932.60;

COMMIT;

-- Verifica: atteso -175.60 | -143.93
-- SELECT gross_revenue, net_revenue, notes FROM public.daily_revenue
--  WHERE id = '1a410449-0ce3-44b0-ac00-1fbef8e5c478';
