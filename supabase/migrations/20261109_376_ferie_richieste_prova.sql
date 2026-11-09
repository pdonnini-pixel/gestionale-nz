-- =====================================================================
-- Migrazione 376 — Ferie e permessi: le richieste del dipendente di prova
-- =====================================================================
-- Patrizio (09/11/2026): vuole vedere nel gestionale anche il permesso nato
-- dalla conferma di un caso del dipendente di prova, per provare il giro.
-- Il dipendente di prova resta nascosto in tutte le tabelle (368): questa
-- funzione legge solo le sue richieste, per chi decide le ferie o segue il
-- personale, e il gestionale le mostra a parte con l'etichetta «prova».
-- NO DATA LOSS: solo una funzione. Tenant: NZ e Zago.
-- Rollback: 20261109_376_ferie_richieste_prova_ROLLBACK.sql
-- =====================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.ferie_richieste_prova()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NOT (public.posso_decidere_ferie() OR public.timbrature_gestore()) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', q.id, 'persona', btrim(COALESCE(e.nome, e.first_name, '') || ' ' || COALESCE(e.cognome, e.last_name, '')),
             'stato', q.stato, 'titolo', q.titolo, 'compilata_da_nome', q.compilata_da_nome,
             'decisa_da_nome', q.decisa_da_nome, 'created_at', q.created_at,
             'giorni', COALESCE((SELECT jsonb_agg(jsonb_build_object('data', d.data, 'voce', d.voce, 'tipo', d.tipo, 'ore', d.ore, 'stato', d.stato) ORDER BY d.data, d.voce)
                                   FROM public.leave_request_days d WHERE d.request_id = q.id), '[]'::jsonb))
           ORDER BY q.created_at DESC)
      FROM public.leave_requests q JOIN public.employees e ON e.id = q.employee_id
     WHERE e.is_demo AND q.company_id = public.get_my_company_id()
       AND q.created_at > now() - interval '60 days'), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.ferie_richieste_prova() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ferie_richieste_prova() TO authenticated, service_role;

COMMIT;
