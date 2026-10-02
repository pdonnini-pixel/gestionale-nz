-- 265 · Documenti banca: di che conto e' un estratto senza IBAN (R27)
--
-- Gli Excel di MPS e BCC Figline non portano l'IBAN del conto (Figline porta solo
-- quelli dei beneficiari dei bonifici). Prima di chiederlo a Sabrina il
-- gestionale guarda su quale conto ritrova le righe del file: stesso importo al
-- centesimo, data valuta entro 3 giorni. Misurato il 02/10/2026 sugli estratti
-- veri di agosto: Figline 190/190 sul conto BCC (2 per caso su MPS), MPS
-- 150/150 sul conto MPS (0 altrove).
--
-- Sola lettura, SECURITY INVOKER: la RLS di bank_transactions resta in vigore.
-- La scelta (vincitore netto o domanda) la fa il frontend, in
-- src/lib/documentiBanca.ts (contoDaiMovimenti).

CREATE OR REPLACE FUNCTION public.fn_bank_doc_guess_account(p_rows jsonb)
RETURNS TABLE (bank_account_id uuid, righe_trovate integer, righe integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH r AS (
    SELECT (x->>'row_no')::int AS n,
           COALESCE(NULLIF(x->>'value_date', '')::date, (x->>'date')::date) AS e,
           round((x->>'amount')::numeric, 2) AS a,
           COALESCE((x->>'sign_known')::boolean, true) AS sk
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) x
  )
  SELECT b.bank_account_id, count(DISTINCT r.n)::int, (SELECT count(*) FROM r)::int
  FROM r
  JOIN public.bank_transactions b
    ON b.company_id = public.get_my_company_id()
   AND b.transaction_date BETWEEN r.e - 3 AND r.e + 3
   AND CASE WHEN r.sk THEN b.amount = r.a ELSE abs(b.amount) = abs(r.a) END
  WHERE b.bank_account_id IS NOT NULL
  GROUP BY b.bank_account_id
  ORDER BY 2 DESC;
$function$;

REVOKE ALL ON FUNCTION public.fn_bank_doc_guess_account(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bank_doc_guess_account(jsonb) TO authenticated;
