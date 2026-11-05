-- ROLLBACK della migrazione 356: riporta le quattro policy alla forma con le
-- funzioni «nude». Stesso significato, solo piu' lente.
ALTER POLICY auth_del_media ON storage.objects
  USING ((bucket_id = 'media'::text) AND ((get_my_role())::text <> 'viewer'::text)
     AND ((COALESCE(owner_id, (owner)::text) = (auth.uid())::text) OR ((get_my_role())::text = 'super_advisor'::text)));
ALTER POLICY auth_update_media ON storage.objects
  USING ((bucket_id = 'media'::text) AND ((get_my_role())::text <> 'viewer'::text)
     AND ((COALESCE(owner_id, (owner)::text) = (auth.uid())::text) OR ((get_my_role())::text = 'super_advisor'::text)))
  WITH CHECK ((bucket_id = 'media'::text) AND ((get_my_role())::text <> 'viewer'::text));
ALTER POLICY auth_write_media ON storage.objects
  WITH CHECK ((bucket_id = 'media'::text) AND (auth.role() = 'authenticated'::text) AND ((get_my_role())::text <> 'viewer'::text));
ALTER POLICY cash_closings_delete ON storage.objects
  USING ((bucket_id = 'cash-closings'::text)
     AND ((COALESCE(owner_id, (owner)::text) = (auth.uid())::text) OR ((get_my_role())::text = 'super_advisor'::text)));
