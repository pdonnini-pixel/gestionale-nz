-- ============================================================================
-- NZ_ONLY_20260807_150_riba_term_fix_already_riba.sql
-- FIX DATO (solo NZ) — termine RiBa (60/90/120) coerente anche sulle rate GIA' RiBa
-- ----------------------------------------------------------------------------
-- Seguito di NZ_ONLY_149: dopo aver portato a RiBa le 189 rate mis-taggate, alcune
-- rate GIA' taggate riba avevano il TERMINE impreciso (es. una rata a 120gg segnata
-- riba_60). Qui il termine e' stato riallineato alla scadenza reale della rata:
--   mesi(scadenza − fattura): <=2 -> riba_60 ; =3 -> riba_90 ; >=4 -> riba_120.
--   TANESINI (piano 60-90): cap a riba_90.
-- Sono state toccate SOLO le rate con termine diverso da quello derivato (65 righe).
--
-- NON distruttivo: solo UPDATE del termine. Backup integrale delle rate riba dei
-- 4 fornitori in public.riba_method_fix2_backup_20260807. Eseguito 2026-08-07 via
-- SQL; qui versionato per traccia.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.riba_method_fix2_backup_20260807 AS
SELECT p.* FROM public.payables p JOIN public.suppliers s ON s.id=p.supplier_id
WHERE s.partita_iva IN ('02206840395','03612621213','05363951210','09215381212')
  AND NOT COALESCE(p.is_placeholder,false)
  AND p.payment_method::text LIKE 'riba%';

WITH d AS (
  SELECT p.id, s.partita_iva vat, p.payment_method::text cur,
    ((extract(year from p.due_date)::int*12+extract(month from p.due_date)::int)
   -(extract(year from p.invoice_date)::int*12+extract(month from p.invoice_date)::int)) mdiff
  FROM public.payables p JOIN public.suppliers s ON s.id=p.supplier_id
  WHERE s.partita_iva IN ('02206840395','03612621213','05363951210','09215381212')
    AND NOT COALESCE(p.is_placeholder,false)
    AND p.payment_method::text LIKE 'riba%'
), derived AS (
  SELECT id, cur,
    (CASE WHEN mdiff<=2 THEN 'riba_60' WHEN mdiff=3 THEN 'riba_90'
          WHEN vat='02206840395' THEN 'riba_90' ELSE 'riba_120' END) AS nuovo
  FROM d
)
UPDATE public.payables p
SET payment_method = derived.nuovo::payment_method, updated_at = now()
FROM derived
WHERE p.id = derived.id AND derived.cur <> derived.nuovo;

-- ROLLBACK (ripristino termine originale dal backup):
--   UPDATE public.payables p SET payment_method = b.payment_method, updated_at = now()
--   FROM public.riba_method_fix2_backup_20260807 b WHERE b.id = p.id;
