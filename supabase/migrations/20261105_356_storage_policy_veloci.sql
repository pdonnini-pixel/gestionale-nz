-- =====================================================================
-- Migrazione 356 — Le ultime quattro policy «lente» (file media e chiusure)
-- =====================================================================
-- COSA MANCAVA: la 305 ha avvolto in una sottoselect le funzioni d'identita'
-- di tutte le policy, ma quattro policy di storage.objects (bucket media e
-- cash-closings) chiamano ancora get_my_role(), auth.uid() e auth.role()
-- «nude», ricalcolate per ogni file invece che una volta per richiesta.
-- Verifica del 05/11/2026: sono le uniche rimaste, identiche su NZ e Zago
-- (public e storage). Segnalato dalla revisione della migrazione 354.
--
-- COSA FA: ALTER POLICY con la stessa condizione di prima, cambiano solo
-- le chiamate, avvolte in (SELECT ...). Il significato non cambia, i ruoli
-- delle policy non cambiano. Nessun DROP, nessun file toccato. Rilanciabile.
--
-- PARITA' TENANT: dal 03/11/2026 NZ + Zago (niente Made).
-- =====================================================================

ALTER POLICY auth_del_media ON storage.objects
  USING ((bucket_id = 'media'::text)
     AND (((SELECT public.get_my_role()))::text <> 'viewer'::text)
     AND ((COALESCE(owner_id, (owner)::text) = ((SELECT auth.uid()))::text)
          OR (((SELECT public.get_my_role()))::text = 'super_advisor'::text)));

ALTER POLICY auth_update_media ON storage.objects
  USING ((bucket_id = 'media'::text)
     AND (((SELECT public.get_my_role()))::text <> 'viewer'::text)
     AND ((COALESCE(owner_id, (owner)::text) = ((SELECT auth.uid()))::text)
          OR (((SELECT public.get_my_role()))::text = 'super_advisor'::text)))
  WITH CHECK ((bucket_id = 'media'::text)
     AND (((SELECT public.get_my_role()))::text <> 'viewer'::text));

ALTER POLICY auth_write_media ON storage.objects
  WITH CHECK ((bucket_id = 'media'::text)
     AND ((SELECT auth.role()) = 'authenticated'::text)
     AND (((SELECT public.get_my_role()))::text <> 'viewer'::text));

ALTER POLICY cash_closings_delete ON storage.objects
  USING ((bucket_id = 'cash-closings'::text)
     AND ((COALESCE(owner_id, (owner)::text) = ((SELECT auth.uid()))::text)
          OR (((SELECT public.get_my_role()))::text = 'super_advisor'::text)));

-- Verifica (attese 0 righe: nessuna funzione d'identita' fuori da una
-- sottoselect nelle policy di public e storage):
--   WITH p AS (SELECT schemaname, tablename, policyname,
--                     coalesce(qual,'') || ' ' || coalesce(with_check,'') e
--                FROM pg_policies WHERE schemaname IN ('public','storage'))
--   SELECT schemaname, tablename, policyname FROM p
--    WHERE regexp_replace(e, '\(\s*SELECT\s+(public\.)?(get_my_company_id|get_my_role|jwt_company_id|auth\.uid|auth\.jwt|auth\.role)\(\)\s+AS\s+\w+\s*\)', '', 'g')
--          ~ '(get_my_company_id|get_my_role|jwt_company_id|auth\.uid|auth\.jwt|auth\.role)\(\)';
