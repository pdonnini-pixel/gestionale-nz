-- ============================================================================
-- NZ_ONLY_20260807_149_riba_method_fix_4_fornitori.sql
-- FIX DATO (solo NZ) — metodo pagamento rate dei 4 fornitori RiBa
-- ----------------------------------------------------------------------------
-- Contesto: GRUPPO FB, MIAN, SHINE, TANESINI pagano tutti a RICEVUTA BANCARIA
-- (confermato dallo scadenzario autentico MPS di Patrizio, piano 60-90-120 F.M;
-- TANESINI 60-90). Molte loro RATE erano pero' taggate 'bonifico_ordinario' (il
-- default che scatta quando il piano viene generato senza il metodo del fornitore),
-- percio' NON venivano riconosciute come RiBa (fn_payable_is_riba usa il metodo
-- della singola payable). Risultato: sparivano dal compose distinta / auto-chiusura.
--
-- Fix (eseguito il 2026-08-07 via SQL, qui versionato per traccia): per le 189
-- payables di questi 4 fornitori con metodo esplicito NON-riba, il metodo e' stato
-- impostato al termine RiBa CORRETTO derivato dalla scadenza reale della rata:
--   mesi(scadenza − fattura): <=2 -> riba_60 ; =3 -> riba_90 ; >=4 -> riba_120.
-- TANESINI (piano 60-90): eventuali 120 riportati a riba_90.
--
-- NON distruttivo: solo UPDATE del metodo (nessun DELETE, nessuna riapertura di
-- scadenze chiuse). Backup integrale delle righe in public.riba_method_fix_backup_20260807.
-- Le rate senza metodo (NULL, 49 righe) NON toccate: gia' RiBa via fornitore.
-- ============================================================================

-- Snapshot di backup (gia' creato in sessione; idempotente).
CREATE TABLE IF NOT EXISTS public.riba_method_fix_backup_20260807 AS
SELECT p.*
FROM public.payables p
JOIN public.suppliers s ON s.id = p.supplier_id
WHERE s.partita_iva IN ('02206840395','03612621213','05363951210','09215381212')
  AND NOT COALESCE(p.is_placeholder,false)
  AND p.payment_method::text NOT LIKE 'riba%'
  AND p.payment_method IS NOT NULL;

-- Correzione metodo con termine derivato dalla scadenza.
WITH d AS (
  SELECT p.id,
    ((extract(year from p.due_date)::int*12 + extract(month from p.due_date)::int)
   - (extract(year from p.invoice_date)::int*12 + extract(month from p.invoice_date)::int)) AS mdiff,
    (SELECT partita_iva FROM public.suppliers s WHERE s.id = p.supplier_id) AS vat
  FROM public.payables p
  WHERE p.id IN (SELECT id FROM public.riba_method_fix_backup_20260807)
)
UPDATE public.payables p
SET payment_method = (CASE
      WHEN d.mdiff <= 2 THEN 'riba_60'
      WHEN d.mdiff = 3 THEN 'riba_90'
      WHEN d.vat = '02206840395' THEN 'riba_90'   -- TANESINI: piano 60-90, niente 120
      ELSE 'riba_120'
    END)::payment_method,
    updated_at = now()
FROM d
WHERE p.id = d.id;

-- ROLLBACK (ripristino metodo originale dal backup):
--   UPDATE public.payables p SET payment_method = b.payment_method, updated_at = now()
--   FROM public.riba_method_fix_backup_20260807 b WHERE b.id = p.id;
