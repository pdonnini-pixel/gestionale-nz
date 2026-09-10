-- 20260910_206 — Scadenze aperte con Ri.Ba. dichiarata in fattura ma metodo «bonifico»
--
-- PERCHE'. Righe nate prima che il bridge leggesse il codice MP dal JSON del payload: la
-- fattura dice MP12 (Ri.Ba., che la banca presenta da sola) mentre la scadenza dice
-- bonifico, cioe' un pagamento che partirebbe a mano. E' il modo piu' rapido per pagare
-- due volte lo stesso debito. Su NZ erano 4 righe per 10.970,12 aperti (MARF 2026-FVI-000166
-- e faliero grafica 208/2026).
--
-- Si allinea solo la FAMIGLIA: le righe gia' riba_60 o riba_90 restano dove sono, perche'
-- li' il termine e' una scelta dell'azienda e non un errore. Stesso principio per le
-- divergenze volute: Amazon che dichiara MP05 e va a carta per anagrafica (201) e i
-- locatori outlet a addebito diretto (NZ_ONLY 202) non rientrano nel criterio.
--
-- Date, importi e stato restano identici (verificato a secco su NZ prima di applicare).
-- Backup in payables_backup_riba_20260910 + una riga di audit per scadenza.
-- Rollback in _ROLLBACK.sql

CREATE TABLE IF NOT EXISTS public.payables_backup_riba_20260910 AS
  SELECT p.*
    FROM public.payables p
    JOIN public.electronic_invoices ei ON ei.id = p.electronic_invoice_id
   WHERE coalesce(p.status::text, '') NOT IN ('pagato', 'annullato', 'nota_credito')
     AND coalesce(p.is_placeholder, false) = false
     AND ei.payment_method = 'MP12'
     AND p.payment_method::text NOT LIKE 'riba%';
ALTER TABLE public.payables_backup_riba_20260910 ENABLE ROW LEVEL SECURITY;

INSERT INTO public.payable_actions (payable_id, action_type, payment_method, note, performed_at, operator_name)
SELECT b.id, 'allineamento_metodo_fattura', 'riba_30'::payment_method,
       'Metodo allineato alla modalita'' MP12 (Ri.Ba.) dichiarata in fattura: era ' || b.payment_method::text,
       now(), 'sistema'
  FROM public.payables_backup_riba_20260910 b;

UPDATE public.payables p SET
  payment_method       = 'riba_30'::payment_method,
  payment_method_code  = coalesce(p.payment_method_code, 'MP12'),
  payment_method_label = public.fn_sdi_mp_label('MP12'),
  updated_at = now()
WHERE p.id IN (SELECT id FROM public.payables_backup_riba_20260910);

-- VERIFICA (deve tornare 0): scadenze aperte ancora incoerenti con la modalita' dichiarata
-- SELECT count(*) FROM public.payables p
--   JOIN public.electronic_invoices ei ON ei.id = p.electronic_invoice_id
--  WHERE coalesce(p.status::text,'') NOT IN ('pagato','annullato','nota_credito')
--    AND coalesce(p.is_placeholder,false) = false
--    AND ((ei.payment_method = 'MP12' AND p.payment_method::text NOT LIKE 'riba%')
--      OR (ei.payment_method IN ('MP16','MP19','MP20','MP21')
--          AND p.payment_method::text NOT IN ('rid','sdd_core','sdd_b2b')));
